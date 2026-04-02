// isd-simple-git — VS Code extension
// All git actions in one right-click menu entry: isd.git-tool
'use strict';

const vscode = require('vscode');
const { execFile, spawn } = require('child_process');
const path = require('path');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Resolve target file paths from context args or the active editor. */
function resolveTargets(uri, uris) {
  if (uris && uris.length > 0) return uris.map(u => u.fsPath);
  if (uri) return [uri.fsPath];
  const editor = vscode.window.activeTextEditor;
  if (editor) return [editor.document.uri.fsPath];
  return [];
}

/** Find the git repo root (cwd) from a file path. */
function cwdOf(filePath) {
  return path.dirname(filePath);
}

/** Run a git command and return a promise with { stdout, stderr }. */
function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

/** Write stdin to a spawned process and return exit code. */
function gitStdin(args, cwd, input) {
  return new Promise(resolve => {
    const cp = spawn('git', args, { cwd });
    let errBuf = '';
    cp.stderr.on('data', chunk => { errBuf += chunk; });
    cp.stdin.end(input, 'utf8');
    cp.on('close', code => resolve({ code, stderr: errBuf }));
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ─── actions ────────────────────────────────────────────────────────────────

async function doAdd(targets, force) {
  const cwd = cwdOf(targets[0]);
  const args = force ? ['add', '-f', ...targets] : ['add', ...targets];
  await git(args, cwd);
  const names = targets.map(f => path.basename(f)).join(', ');
  vscode.window.showInformationMessage(`${force ? 'Force-' : ''}Staged: ${names}`);
}

async function doUnstage(targets) {
  const cwd = cwdOf(targets[0]);
  await git(['restore', '--staged', ...targets], cwd);
  const names = targets.map(f => path.basename(f)).join(', ');
  vscode.window.showInformationMessage(`Unstaged: ${names}`);
}

async function doCommit(cwd) {
  const msg = await vscode.window.showInputBox({
    prompt: 'Commit message',
    placeHolder: 'feat: describe your change'
  });
  if (!msg) return;
  await git(['commit', '-m', msg], cwd);
  vscode.window.showInformationMessage('Committed.');
}

async function doStashFile(targets) {
  const cwd = cwdOf(targets[0]);
  let repoRoot = cwd;
  try {
    const r = await git(['rev-parse', '--show-toplevel'], cwd);
    repoRoot = r.stdout.trim().replace(/\//g, path.sep);
  } catch (_) { /* use cwd */ }

  const msg = await vscode.window.showInputBox({
    prompt: 'Stash message (optional — press Enter to skip)',
    placeHolder: 'WIP: describe the stash'
  });
  if (msg === undefined) return; // cancelled (Escape)

  const args = ['stash', 'push'];
  if (msg) args.push('-m', msg);
  args.push('--', ...targets);

  await git(args, repoRoot);
  const names = targets.map(f => path.basename(f)).join(', ');
  vscode.window.showInformationMessage(`Stashed: ${names}`);
}

async function doShowLog(file) {
  const cwd = cwdOf(file);
  const { stdout } = await git(['log', '--oneline', '--', file], cwd);
  const items = stdout.split(/\r?\n/).filter(Boolean);
  if (items.length === 0) {
    vscode.window.showInformationMessage('No commits found for this file.');
    return;
  }

  const sel = await vscode.window.showQuickPick(items, { placeHolder: 'Select a commit to inspect' });
  if (!sel) return;

  const sha = sel.split(' ')[0];
  const { stdout: detail } = await git(['show', sha], cwd);

  const panel = vscode.window.createWebviewPanel(
    'isdGitLog',
    `${path.basename(file)} @ ${sha.slice(0, 7)}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false }
  );

  panel.webview.html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
  <style>
    body { font-family: Consolas, 'Courier New', monospace; font-size: 13px; padding: 12px 16px; }
    button { position: fixed; top: 10px; right: 14px; padding: 4px 12px; cursor: pointer; }
    pre { white-space: pre-wrap; word-break: break-all; }
    .add { color: #4caf50; }
    .del { color: #f44336; }
    .hdr { color: #2196f3; }
  </style>
</head>
<body>
  <button id="close">Close ✕</button>
  <pre id="content">${escapeHtml(detail).replace(/^(\+[^+].*)$/mg, '<span class="add">$1</span>')
                                         .replace(/^(-[^-].*)$/mg, '<span class="del">$1</span>')
                                         .replace(/^(@@.*)$/mg, '<span class="hdr">$1</span>')}</pre>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('close').addEventListener('click', () => vscode.postMessage({ command: 'close' }));
  </script>
</body>
</html>`;

  const sub = panel.webview.onDidReceiveMessage(msg => { if (msg.command === 'close') panel.dispose(); });
  panel.onDidDispose(() => sub.dispose());
}

/**
 * Stage only the lines overlapping the current editor selections.
 * Strategy: use `git diff -U0`, trim each hunk to include ONLY the selected
 * lines (+/- lines that fall within the selection), rebuild a minimal patch,
 * and apply with `git apply --cached`.
 */
async function doStageSelectedLines() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showErrorMessage('No active editor.'); return; }

  const filePath = editor.document.uri.fsPath;
  const cwd = cwdOf(filePath);

  const sels = editor.selections.filter(s => !s.isEmpty);
  if (sels.length === 0) {
    vscode.window.showInformationMessage('Select one or more ranges first.');
    return;
  }

  // Merge overlapping line ranges (1-based)
  const merged = [];
  for (const s of [...sels].sort((a, b) => a.start.line - b.start.line)) {
    const r = { start: s.start.line + 1, end: s.end.line + 1 };
    if (merged.length && r.start <= merged[merged.length - 1].end + 1) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end);
    } else {
      merged.push(r);
    }
  }

  // First: if the built-in git supports staging selected ranges, use it
  try {
    // Try two common invocation patterns
    const uri = editor.document.uri;
    let ok = false;
    try { await vscode.commands.executeCommand('git.stageSelectedRanges', uri, editor.selections); ok = true; }
    catch (e) {
      try { await vscode.commands.executeCommand('git.stageSelectedRanges', editor); ok = true; }
      catch (e2) { ok = false; }
    }
    if (ok) {
      vscode.window.showInformationMessage('Used built-in Git to stage selected ranges.');
      return;
    }
  } catch (_) {
    // ignore and fall back to patch-based
  }

  let diffOut;
  try {
    const res = await git(['diff', '-U0', '--', filePath], cwd);
    diffOut = res.stdout;
  } catch (e) {
    vscode.window.showErrorMessage('git diff failed: ' + e.message);
    return;
  }

  if (!diffOut.trim()) {
    vscode.window.showInformationMessage('No unstaged changes in this file.');
    return;
  }

  // Parse into header + hunks
  const rawLines = diffOut.split(/\r?\n/);
  const header = [];
  let i = 0;
  while (i < rawLines.length && !rawLines[i].startsWith('@@ ')) header.push(rawLines[i++]);

  const hunks = [];
  while (i < rawLines.length) {
    if (!rawLines[i].startsWith('@@ ')) { i++; continue; }
    const hunkHeader = rawLines[i++];
    const m = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(hunkHeader);
    if (!m) continue;
    const oldStart = parseInt(m[1]);
    const oldCount = m[2] !== undefined ? parseInt(m[2]) : 1;
    const newStart = parseInt(m[3]);
    const newCount = m[4] !== undefined ? parseInt(m[4]) : 1;
    const body = [];
    while (i < rawLines.length && !rawLines[i].startsWith('@@ ')) body.push(rawLines[i++]);
    hunks.push({ hunkHeader, oldStart, oldCount, newStart, newCount, body });
  }

  // For each hunk that overlaps a selection, trim its body to only selected + lines
  const patchHunks = [];

  for (const hunk of hunks) {
    const hunkNewEnd = hunk.newStart + Math.max(0, hunk.newCount) - 1;
    const overlaps = merged.some(r => !(r.end < hunk.newStart || r.start > hunkNewEnd));
    if (!overlaps) continue;

    // Walk body lines; track current new-side line number
    let newLine = hunk.newStart;
    const kept = [];
    for (const bl of hunk.body) {
      if (bl === '\\ No newline at end of file' || bl === '') { kept.push(bl); continue; }
      const type = bl[0]; // '+', '-', ' '
      if (type === '+') {
        // only keep '+' lines that fall within a selected range
        const inSel = merged.some(r => newLine >= r.start && newLine <= r.end);
        if (inSel) kept.push(bl);
        else kept.push(' ' + bl.slice(1)); // treat as context (unchanged)
        newLine++;
      } else if (type === '-') {
        kept.push(bl);
      } else {
        kept.push(bl);
        newLine++;
      }
    }

    // Recount the hunk header based on kept lines
    let newAdded = 0, newRemoved = 0, ctxLines = 0;
    for (const bl of kept) {
      if (!bl || bl === '\\ No newline at end of file') continue;
      const ch = bl[0];
      if (ch === '+') newAdded++;
      else if (ch === '-') newRemoved++;
      else if (ch === ' ') ctxLines++;
    }
    const oldCount = newRemoved + ctxLines;
    const newCount = newAdded + ctxLines;
    const newHeader = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;

    patchHunks.push([newHeader, ...kept].join('\n'));
  }

  if (patchHunks.length === 0) {
    vscode.window.showInformationMessage('No hunks overlap your selection. Select lines that contain changes (+/- lines).');
    return;
  }

  // Calculate repo-relative path for patch header
  let repoRoot = cwd;
  try {
    const r = await git(['rev-parse', '--show-toplevel'], cwd);
    repoRoot = r.stdout.trim().replace(/\//g, path.sep);
  } catch (_) { /* use cwd */ }

  const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const patch = [
    `diff --git a/${relPath} b/${relPath}`,
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    ...patchHunks,
    ''
  ].join('\n');

  // apply with -p1 (default for unified diffs from git)
  const result = await gitStdin(['apply', '--cached', '-p1'], repoRoot, patch);

  if (result.code === 0) {
    vscode.window.showInformationMessage('Selected lines staged.');
    return;
  }

  // Show debug output
  const out = vscode.window.createOutputChannel('ISD Git');
  out.clear();
  out.appendLine('=== PATCH SENT ===');
  out.appendLine(patch);
  out.appendLine('=== git apply stderr ===');
  out.appendLine(result.stderr || '(empty)');
  out.show(true);
  vscode.window.showErrorMessage('git apply --cached failed — see "ISD Git" Output panel.');
}

// ─── activation ─────────────────────────────────────────────────────────────

function activate(context) {

  // Individual commands (also callable from Command Palette)
  const cmds = [

    vscode.commands.registerCommand('git-add.add', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doAdd(t, false).catch(e => vscode.window.showErrorMessage('Git Add failed: ' + e.message));
    }),

    vscode.commands.registerCommand('git-add.addForce', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doAdd(t, true).catch(e => vscode.window.showErrorMessage('Git Add -f failed: ' + e.message));
    }),

    vscode.commands.registerCommand('git-add.unstage', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doUnstage(t).catch(e => vscode.window.showErrorMessage('Git Unstage failed: ' + e.message));
    }),

    vscode.commands.registerCommand('git-add.stageSelectedLines', () => {
      doStageSelectedLines().catch(e => vscode.window.showErrorMessage('Stage lines failed: ' + e.message));
    }),

    vscode.commands.registerCommand('git-add.showLog', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doShowLog(t[0]).catch(e => vscode.window.showErrorMessage('Git Log failed: ' + e.message));
    }),

    vscode.commands.registerCommand('git-add.commit', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      const cwd = t.length ? cwdOf(t[0]) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!cwd) { vscode.window.showErrorMessage('Cannot determine repository path.'); return; }
      doCommit(cwd).catch(e => vscode.window.showErrorMessage('Git Commit failed: ' + e.message));
    }),

    vscode.commands.registerCommand('git-add.stashFile', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doStashFile(t).catch(e => vscode.window.showErrorMessage('Git Stash failed: ' + e.message));
    }),

    // ── Central entry point shown in right-click menus ──────────────────────
    vscode.commands.registerCommand('isd.git-tool', async (uri, uris) => {
      const targets = resolveTargets(uri, uris);
      const label = targets.map(f => path.basename(f)).join(', ') || '(active editor / workspace)';

      // kind: 'sep' items are visual dividers; pick ignores them
      const items = [
        { label: '$(add) Stage', id: 'add' },
        { label: '$(warning) Stage (Force)', id: 'addForce' },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { label: '$(arrow-left) Unstage', id: 'unstage' },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { label: '$(list-unordered) Stage Selected Lines (patch)', id: 'stageSelectedLines' },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { label: '$(archive) Stash This File', id: 'stashFile' },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { label: '$(history) File Log', id: 'showLog' },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { label: '$(check) Commit -m', id: 'commit' },
      ];

      const pick = await vscode.window.showQuickPick(items, {
        title: 'ISD Git Tool',
        placeHolder: label,
      });
      if (!pick || !pick.id) return;

      switch (pick.id) {
        case 'add':                await vscode.commands.executeCommand('git-add.add',                uri, uris); break;
        case 'addForce':           await vscode.commands.executeCommand('git-add.addForce',           uri, uris); break;
        case 'unstage':            await vscode.commands.executeCommand('git-add.unstage',            uri, uris); break;
        case 'stageSelectedLines': await vscode.commands.executeCommand('git-add.stageSelectedLines'            ); break;
        case 'showLog':            await vscode.commands.executeCommand('git-add.showLog',            uri, uris); break;
        case 'commit':             await vscode.commands.executeCommand('git-add.commit',             uri, uris); break;
        case 'stashFile':          await vscode.commands.executeCommand('git-add.stashFile',          uri, uris); break;
      }
    }),
  ];

  context.subscriptions.push(...cmds);
}

function deactivate() {}

module.exports = { activate, deactivate };
