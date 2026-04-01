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
}

function deactivate() {}

module.exports = { activate, deactivate };
