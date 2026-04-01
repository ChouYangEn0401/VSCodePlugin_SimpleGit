const vscode = require('vscode');
const { execFile } = require('child_process');
const path = require('path');

function activate(context) {
  const disposable = vscode.commands.registerCommand('git-add.addFile', async (uri, uris) => {
    // Support multi-select in explorer (uris), or single file (uri), or active editor
    const targets = uris && uris.length > 0
      ? uris.map(u => u.fsPath)
      : uri
        ? [uri.fsPath]
        : vscode.window.activeTextEditor
          ? [vscode.window.activeTextEditor.document.uri.fsPath]
          : [];

    if (targets.length === 0) {
      vscode.window.showErrorMessage('Git Add: No file selected.');
      return;
    }

    const fileList = targets.map(f => path.basename(f)).join(', ');

    const choice = await vscode.window.showQuickPick(
      [
        {
          label: '$(add) Git Add',
          description: 'git add',
          detail: `Stage: ${fileList}`,
          force: false
        },
        {
          label: '$(warning) Git Add -f  (Force)',
          description: 'git add -f',
          detail: `Force stage (bypass .gitignore): ${fileList}`,
          force: true
        }
      ],
      {
        title: `Git Add — ${targets.length} file(s) selected`,
        placeHolder: 'Choose an action'
      }
    );

    if (!choice) return; // user dismissed

    const args = choice.force
      ? ['add', '-f', ...targets]
      : ['add', ...targets];

    const cwd = path.dirname(targets[0]);

    execFile('git', args, { cwd }, (error, _stdout, stderr) => {
      if (error) {
        vscode.window.showErrorMessage(`Git Add failed: ${stderr || error.message}`);
        return;
      }
      const label = choice.force ? 'Git Added -f (Force)' : 'Git Added';
      vscode.window.showInformationMessage(`${label}: ${fileList}`);
    });
  });

  context.subscriptions.push(disposable);

  // Stage current file (file-level)
  const stageFile = vscode.commands.registerCommand('git-add.stageFile', (uri, uris) => {
    const targets = uris && uris.length > 0
      ? uris.map(u => u.fsPath)
      : uri
        ? [uri.fsPath]
        : vscode.window.activeTextEditor
          ? [vscode.window.activeTextEditor.document.uri.fsPath]
          : [];

    if (targets.length === 0) {
      vscode.window.showErrorMessage('Git Add: No file selected.');
      return;
    }

    const cwd = path.dirname(targets[0]);
    execFile('git', ['add', ...targets], { cwd }, (error, _stdout, stderr) => {
      if (error) {
        vscode.window.showErrorMessage(`Git Add failed: ${stderr || error.message}`);
        return;
      }
      const names = targets.map(f => path.basename(f)).join(', ');
      vscode.window.showInformationMessage(`Git Added: ${names}`);
    });
  });

  // Unstage (git restore --staged)
  const unstage = vscode.commands.registerCommand('git-add.unstage', (uri, uris) => {
    const targets = uris && uris.length > 0
      ? uris.map(u => u.fsPath)
      : uri
        ? [uri.fsPath]
        : vscode.window.activeTextEditor
          ? [vscode.window.activeTextEditor.document.uri.fsPath]
          : [];

    if (targets.length === 0) {
      vscode.window.showErrorMessage('Git Unstage: No file selected.');
      return;
    }

    const cwd = path.dirname(targets[0]);
    execFile('git', ['restore', '--staged', ...targets], { cwd }, (error, _stdout, stderr) => {
      if (error) {
        vscode.window.showErrorMessage(`Git Unstage failed: ${stderr || error.message}`);
        return;
      }
      const names = targets.map(f => path.basename(f)).join(', ');
      vscode.window.showInformationMessage(`Unstaged: ${names}`);
    });
  });

  // Stage selection (delegates to built-in git if available)
  const stageSelection = vscode.commands.registerCommand('git-add.stageSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor to stage selection from.');
      return;
    }
    const selections = editor.selections.filter(s => !s.isEmpty);
    if (selections.length === 0) {
      vscode.window.showInformationMessage('Select a range first to stage.');
      return;
    }

    // Try to call built-in git command to stage selected ranges
    try {
      // Many VS Code installations provide `git.stageSelectedRanges`
      // Accepts (uri, ranges) in some versions; we'll attempt both patterns.
      const uri = editor.document.uri;
      // Try two invocation forms for compatibility
      let ok = false;
      try {
        await vscode.commands.executeCommand('git.stageSelectedRanges', uri, selections);
        ok = true;
      } catch (e) {
        try {
          await vscode.commands.executeCommand('git.stageSelectedRanges', editor);
          ok = true;
        } catch (e2) {
          ok = false;
        }
      }

      if (!ok) {
        vscode.window.showInformationMessage('Staging selected ranges is not supported by the built-in Git on this VS Code. Use Command Palette → "Git: Stage Selected Ranges" if available.');
      }
    } catch (err) {
      vscode.window.showErrorMessage('Failed to stage selection: ' + (err && err.message ? err.message : String(err)));
    }
  });

  // Show file log (simple git log --oneline)
  const showLog = vscode.commands.registerCommand('git-add.showLog', (uri, uris) => {
    const targets = uris && uris.length > 0
      ? uris.map(u => u.fsPath)
      : uri
        ? [uri.fsPath]
        : vscode.window.activeTextEditor
          ? [vscode.window.activeTextEditor.document.uri.fsPath]
          : [];

    if (targets.length === 0) {
      vscode.window.showErrorMessage('Git Log: No file selected.');
      return;
    }

    const file = targets[0];
    const cwd = path.dirname(file);
    execFile('git', ['log', '--oneline', '--', file], { cwd }, (error, stdout, stderr) => {
      if (error) {
        vscode.window.showErrorMessage(`Git Log failed: ${stderr || error.message}`);
        return;
      }
      const items = stdout.split(/\r?\n/).filter(Boolean);
      if (items.length === 0) {
        vscode.window.showInformationMessage('No commits for this file.');
        return;
      }
      vscode.window.showQuickPick(items, { placeHolder: 'Select commit to view' }).then(sel => {
        if (!sel) return;
        const sha = sel.split(' ')[0];
        execFile('git', ['show', '--quiet', sha], { cwd }, (err2, full, stderr2) => {
          if (err2) {
            vscode.window.showErrorMessage(`git show failed: ${stderr2 || err2.message}`);
            return;
          }
          const channel = vscode.window.createOutputChannel('Git Log');
          channel.clear();
          channel.appendLine(full);
          channel.show(true);
        });
      });
    });
  });

  context.subscriptions.push(stageFile, unstage, stageSelection, showLog);
}

function deactivate() {}

module.exports = { activate, deactivate };
