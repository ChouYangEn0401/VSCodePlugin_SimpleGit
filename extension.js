const vscode = require('vscode');
const { execFile, spawn } = require('child_process');
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

  // Stage hunks (patch-based) -- parse `git diff -U0` and apply only hunks overlapping selection
  const stageHunks = vscode.commands.registerCommand('git-add.stageHunks', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor to stage hunks from.');
      return;
    }
    const document = editor.document;
    const uri = document.uri;
    const filePath = uri.fsPath;
    const cwd = path.dirname(filePath);

    // Compute selection line ranges (1-based for git diff headers)
    const selections = editor.selections.filter(s => !s.isEmpty);
    if (selections.length === 0) {
      vscode.window.showInformationMessage('Select one or more ranges first to stage hunks.');
      return;
    }
    // Merge selections into ranges
    const ranges = selections.map(s => ({
      start: s.start.line + 1,
      end: s.end.line + 1
    }));
    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of ranges) {
      if (!merged.length) merged.push(r);
      else {
        const last = merged[merged.length - 1];
        if (r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
        else merged.push(r);
      }
    }

    // Get diff hunks with zero context
    execFile('git', ['diff', '-U0', '--', filePath], { cwd }, (err, stdout, stderr) => {
      if (err) {
        vscode.window.showErrorMessage(`git diff failed: ${stderr || err.message}`);
        return;
      }
      if (!stdout) {
        vscode.window.showInformationMessage('No changes to stage for this file.');
        return;
      }

      // Parse diff into header + hunks
      const lines = stdout.split(/\r?\n/);
      let headerLines = [];
      const hunks = [];
      let i = 0;
      // collect header until first hunk @@
      while (i < lines.length && !lines[i].startsWith('@@ ')) {
        headerLines.push(lines[i]);
        i++;
      }

      while (i < lines.length) {
        if (!lines[i].startsWith('@@ ')) { i++; continue; }
        const hunkHeader = lines[i];
        const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(hunkHeader);
        let newStart = 0, newCount = 0;
        if (m) {
          newStart = parseInt(m[1], 10);
          newCount = m[2] ? parseInt(m[2], 10) : 1;
        }
        const hunkLines = [hunkHeader];
        i++;
        while (i < lines.length && !lines[i].startsWith('@@ ')) {
          hunkLines.push(lines[i]);
          i++;
        }
        hunks.push({ newStart, newCount, lines: hunkLines });
      }

      // select hunks overlapping merged ranges
      const selectedHunks = hunks.filter(h => {
        const hStart = h.newStart;
        const hEnd = h.newStart + Math.max(0, h.newCount) - 1;
        return merged.some(r => !(r.end < hStart || r.start > hEnd));
      });

      if (selectedHunks.length === 0) {
        vscode.window.showInformationMessage('No diff hunks overlap your selection(s). Try expanding selection lines.');
        return;
      }

      // Build patch: headerLines (up to +++ b/...) then selected hunks
      const patchParts = [];
      // include header lines but ensure file path lines exist
      patchParts.push(...headerLines);
      // append selected hunks
      for (const h of selectedHunks) patchParts.push(...h.lines);
      const patch = patchParts.join('\n') + '\n';

      // apply patch to index with fallback strategies
      const tryApply = async () => {
        const variants = [ ['apply', '--cached', '-p0'], ['apply', '--cached', '-p1'], ['apply', '--cached', '--unidiff-zero'] ];
        for (const args of variants) {
          const cp = spawn('git', args, { cwd });
          let stderrBuf = '';
          cp.stdin.end(patch);
          cp.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });
          const code = await new Promise(resolve => cp.on('close', resolve));
          if (code === 0) return { ok: true };
          // record last stderr
          var lastErr = stderrBuf;
        }
        return { ok: false, stderr: lastErr };
      };

      tryApply().then(result => {
        if (result.ok) {
          vscode.window.showInformationMessage('Selected hunks staged.');
          return;
        }
        // show detailed output to Output channel for debugging
        const out = vscode.window.createOutputChannel('ISD Git');
        out.clear();
        out.appendLine('--- PATCH ---');
        out.appendLine(patch);
        out.appendLine('--- git apply stderr ---');
        out.appendLine(result.stderr || 'no stderr');
        out.show(true);
        vscode.window.showErrorMessage('git apply --cached failed; see ISD Git output for details.');
      });
    });
  });

  // Stage selected lines (wrapper to stageHunks behaviour)
  const stageSelectedLines = vscode.commands.registerCommand('git-add.stageSelectedLines', async () => {
    // simply call stageHunks logic (it already uses line-based matching)
    await vscode.commands.executeCommand('git-add.stageHunks');
  });

  context.subscriptions.push(stageHunks);

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
          // Show in a small webview panel with a close button
          const panel = vscode.window.createWebviewPanel(
            'gitLog',
            `Git: ${path.basename(file)}@${sha}`,
            vscode.ViewColumn.Active,
            { enableScripts: true }
          );

          function escapeHtml(unsafe) {
            return unsafe.replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
          }

          panel.webview.html = `<!doctype html>
            <html>
            <head>
              <meta charset="utf-8" />
              <style>body{font-family:Consolas,monospace;padding:12px}button{position:fixed;right:12px;top:12px}</style>
            </head>
            <body>
              <button id="close">Close ✕</button>
              <pre>${escapeHtml(full)}</pre>
              <script>
                const vscode = acquireVsCodeApi();
                document.getElementById('close').addEventListener('click', () => vscode.postMessage({command: 'close'}));
              </script>
            </body>
            </html>`;

          const disposer = panel.webview.onDidReceiveMessage(msg => {
            if (msg && msg.command === 'close') {
              panel.dispose();
            }
          });
          panel.onDidDispose(() => disposer.dispose());
        });
      });
    });
  });

  // Commit with message
  const commitCmd = vscode.commands.registerCommand('git-add.commit', async (uri, uris) => {
    const targets = (uris && uris.length > 0)
      ? uris.map(u => u.fsPath)
      : uri
        ? [uri.fsPath]
        : vscode.window.activeTextEditor
          ? [vscode.window.activeTextEditor.document.uri.fsPath]
          : [];

    const cwd = targets.length > 0 ? path.dirname(targets[0]) : (vscode.workspace.rootPath || undefined);
    const msg = await vscode.window.showInputBox({ prompt: 'Commit message (git commit -m)' });
    if (!msg) return;
    execFile('git', ['commit', '-m', msg], { cwd }, (err, _stdout, stderr) => {
      if (err) {
        vscode.window.showErrorMessage(`git commit failed: ${stderr || err.message}`);
        return;
      }
      vscode.window.showInformationMessage('Committed.');
    });
  });

  // Helper to normalize targets
  function getTargets(uri, uris) {
    return uris && uris.length > 0
      ? uris.map(u => u.fsPath)
      : uri
        ? [uri.fsPath]
        : vscode.window.activeTextEditor
          ? [vscode.window.activeTextEditor.document.uri.fsPath]
          : [];
  }

  // Central command: isd.git-tool (single entry point)
  const central = vscode.commands.registerCommand('isd.git-tool', async (uri, uris) => {
    const targets = getTargets(uri, uris);
    const fileList = targets.map(f => path.basename(f)).join(', ');
    const choices = [
      { label: '$(add) Git Add', id: 'add' },
      { label: '$(warning) Git Add -f (Force)', id: 'addf' },
      { label: '────────', id: 'sep1' },
      { label: '$(files) Stage File', id: 'stageFile' },
      { label: '$(arrow-left) Unstage (restore staged)', id: 'unstage' },
      { label: '────────', id: 'sep2' },
      { label: '$(diff) Stage Selected Lines (built-in)', id: 'stageSelection' },
      { label: '$(list-unordered) Stage Selected Lines (line-based)', id: 'stageSelectedLines' },
      { label: '$(list-unordered) Stage Hunks (patch-based)', id: 'stageHunks' },
      { label: '────────', id: 'sep3' },
      { label: '$(history) Show File Log', id: 'showLog' },
      { label: '$(check) Commit -m', id: 'commit' }
    ];

    const pick = await vscode.window.showQuickPick(choices, { placeHolder: fileList ? `Targets: ${fileList}` : 'No file selected (will use active editor / workspace)' });
    if (!pick) return;

    switch (pick.id) {
      case 'add':
        await vscode.commands.executeCommand('git-add.addFile', uri, uris);
        break;
      case 'addf': {
        const t = getTargets(uri, uris);
        if (t.length === 0) { vscode.window.showErrorMessage('No file selected'); return; }
        execFile('git', ['add', '-f', ...t], { cwd: path.dirname(t[0]) }, (err, _s, stderr) => {
          if (err) { vscode.window.showErrorMessage(`Git Add -f failed: ${stderr || err.message}`); return; }
          vscode.window.showInformationMessage(`Git Added -f: ${t.map(x => path.basename(x)).join(', ')}`);
        });
        break;
      }
      case 'stageFile':
        await vscode.commands.executeCommand('git-add.stageFile', uri, uris);
        break;
      case 'unstage':
        await vscode.commands.executeCommand('git-add.unstage', uri, uris);
        break;
      case 'stageSelection':
        await vscode.commands.executeCommand('git-add.stageSelection');
        break;
      case 'stageSelectedLines':
        await vscode.commands.executeCommand('git-add.stageSelectedLines');
        break;
      case 'stageHunks':
        await vscode.commands.executeCommand('git-add.stageHunks');
        break;
      case 'sep1':
      case 'sep2':
      case 'sep3':
        // separator - do nothing
        break;
      case 'showLog':
        await vscode.commands.executeCommand('git-add.showLog', uri, uris);
        break;
      case 'commit':
        await vscode.commands.executeCommand('git-add.commit', uri, uris);
        break;
    }
  });

  context.subscriptions.push(stageFile, unstage, stageSelection, stageHunks, showLog, commitCmd, central);
}

function deactivate() {}

module.exports = { activate, deactivate };
