// isd-simple-git — VS Code extension
// All git actions in one right-click menu entry: isd.git-tool
'use strict';

const vscode = require('vscode');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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

/**
 * Create a new commit that restores <file> to its state just before a chosen
 * bad commit, then write the original working-tree content back to disk so
 * the user's local file is unchanged.
 */
async function doUntrackFile(targets) {
  const filePath = targets[0];
  const cwd = cwdOf(filePath);

  // Resolve repo root
  let repoRoot = cwd;
  try {
    const r = await git(['rev-parse', '--show-toplevel'], cwd);
    repoRoot = r.stdout.trim().replace(/\//g, path.sep);
  } catch (_) { /* use cwd */ }

  const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');

  // Show commit log for this file so the user can pick the bad commit
  const { stdout: logOut } = await git(['log', '--oneline', '--', relPath], repoRoot);
  const items = logOut.split(/\r?\n/).filter(Boolean);
  if (!items.length) {
    vscode.window.showInformationMessage('No commits found for this file.');
    return;
  }

  const sel = await vscode.window.showQuickPick(items, {
    title: 'Untrack — Pick the Bad Commit',
    placeHolder: 'Select the commit that introduced the unwanted change',
  });
  if (!sel) return;

  const badSha = sel.split(' ')[0];

  // The commit must have a parent (we restore to parent state)
  let parentSha;
  try {
    const r = await git(['rev-parse', `${badSha}^`], repoRoot);
    parentSha = r.stdout.trim();
  } catch (_) {
    vscode.window.showErrorMessage(`Commit ${badSha.slice(0, 7)} has no parent — cannot revert to a previous state.`);
    return;
  }

  // Verify the file existed in the parent commit
  try {
    await git(['cat-file', '-e', `${parentSha}:${relPath}`], repoRoot);
  } catch (_) {
    vscode.window.showErrorMessage(`"${path.basename(filePath)}" did not exist before ${badSha.slice(0, 7)}.`);
    return;
  }

  // Snapshot current working-tree content BEFORE we touch anything
  let workingContent;
  try {
    workingContent = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    vscode.window.showErrorMessage('Cannot read current file: ' + e.message);
    return;
  }

  // Ask for the commit message
  const defaultMsg = `revert: untrack "${path.basename(filePath)}" changes from ${badSha.slice(0, 7)}`;
  const msg = await vscode.window.showInputBox({
    prompt: 'Commit message for the revert commit',
    value: defaultMsg,
  });
  if (msg === undefined) return; // Escape = cancel

  // Snapshot which OTHER files are currently staged so we can preserve them
  const { stdout: statusOut } = await git(['status', '--porcelain'], repoRoot);
  const otherStaged = statusOut.split(/\r?\n/)
    .filter(Boolean)
    .filter(line => line[0] !== ' ' && line[0] !== '?' && line.slice(3).split(' -> ').pop().trim() !== relPath)
    .map(line => line.slice(3).split(' -> ').pop().trim());

  // Restore the file to exactly its state in parentSha (also stages it)
  try {
    await git(['checkout', parentSha, '--', relPath], repoRoot);
  } catch (e) {
    vscode.window.showErrorMessage('Failed to restore pre-commit state: ' + e.message);
    return;
  }

  // Temporarily unstage other files so this commit only touches our file
  if (otherStaged.length) {
    try { await git(['restore', '--staged', ...otherStaged], repoRoot); } catch (_) { /* best-effort */ }
  }

  // Commit
  try {
    await git(['commit', '-m', msg], repoRoot);
  } catch (e) {
    // Roll back: restore working file and re-stage others
    fs.writeFileSync(filePath, workingContent, 'utf8');
    if (otherStaged.length) {
      try { await git(['add', ...otherStaged], repoRoot); } catch (_) {}
    }
    vscode.window.showErrorMessage('git commit failed: ' + e.message);
    return;
  }

  // Re-stage any files that were staged before we started
  if (otherStaged.length) {
    try { await git(['add', ...otherStaged], repoRoot); } catch (_) { /* best-effort */ }
  }

  // Finally, write the original working-tree content back — user's file is untouched
  fs.writeFileSync(filePath, workingContent, 'utf8');

  vscode.window.showInformationMessage(
    `Done! Reverted "${path.basename(filePath)}" changes from ${badSha.slice(0, 7)} in a new commit. Your working file is unchanged.`
  );
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

// ─── runner actions ─────────────────────────────────────────────────────────

async function doRunPs1(filePath) {
  const t = vscode.window.createTerminal({ name: `PS1: ${path.basename(filePath)}` });
  t.show();
  // announce and wait a short time so VS Code has time to initialise env
  t.sendText(`echo 載入腳本中...`);
  t.sendText(`Start-Sleep -Milliseconds 2500`);
  // use explicit powershell invocation so user's shell profile isn't required
  t.sendText(`powershell -NoExit -ExecutionPolicy Bypass -File "${filePath}"`);
}

async function doRunCmd(filePath) {
  // Launch an integrated cmd.exe terminal so batch files run correctly
  const t = vscode.window.createTerminal({ name: `CMD: ${path.basename(filePath)}`, shellPath: 'cmd.exe' });
  t.show();
  // echo + short wait to allow VS Code to finish initializing environment
  t.sendText(`echo 載入腳本中...`);
  t.sendText(`powershell -Command Start-Sleep -Milliseconds 2500`);
  // use CALL so the batch file runs in the current cmd process
  t.sendText(`call "${filePath}"`);
}

async function doRunSh(filePath) {
  const t = vscode.window.createTerminal({ name: `SH: ${path.basename(filePath)}` });
  t.show();
  t.sendText(`echo 載入腳本中...`);
  t.sendText(`sleep 2.5`);
  t.sendText(`bash "${filePath}"`);
}

async function doRunPs1Admin(filePath) {
  const pick = await vscode.window.showWarningMessage(
    `以 Administrator 身分執行「${path.basename(filePath)}」會另外開一個視窗。要改在整合終端以一般權限執行，還是以管理員開新視窗？`,
    { modal: true },
    '在整合終端執行（一般權限）',
    '以管理員模式開新視窗'
  );
  if (!pick) return;
  if (pick === '在整合終端執行（一般權限）') {
    return doRunPs1(filePath);
  }
  // Open elevated external PowerShell window (UAC) and set working directory
  const safeFile = filePath.replace(/"/g, '""');
  const wd = path.dirname(filePath).replace(/"/g, '""');
  const cmd = `Start-Process powershell.exe -Verb RunAs -WorkingDirectory \"${wd}\" -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File','\"${safeFile}\"'`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], err => {
    if (err) vscode.window.showErrorMessage('啟動管理員 PS1 失敗: ' + err.message);
  });
}

async function doRunCmdAdmin(filePath) {
  const pick = await vscode.window.showWarningMessage(
    `以 Administrator 身分 (CMD) 執行「${path.basename(filePath)}」會另外開一個視窗。要改在整合終端以一般權限執行，還是以管理員開新視窗？`,
    { modal: true },
    '在整合終端執行（一般權限）',
    '以管理員模式開新視窗'
  );
  if (!pick) return;
  if (pick === '在整合終端執行（一般權限）') {
    return doRunCmd(filePath);
  }
  // Start elevated cmd.exe with working directory set to the file's folder
  const wd = path.dirname(filePath).replace(/"/g, '""');
  const base = path.basename(filePath).replace(/"/g, '""');
  const cmd = `Start-Process cmd.exe -Verb RunAs -WorkingDirectory \"${wd}\" -ArgumentList '/k','"${base}"'`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], err => {
    if (err) vscode.window.showErrorMessage('啟動管理員 CMD 失敗: ' + err.message);
  });
}

async function doRunShSudo(filePath) {
  const pick = await vscode.window.showWarningMessage(
    `以 sudo 執行「${path.basename(filePath)}」？要在整合終端執行或用 sudo 執行？`,
    { modal: true },
    '在整合終端執行（一般權限）',
    '以 sudo 執行'
  );
  if (!pick) return;
  if (pick === '在整合終端執行（一般權限）') return doRunSh(filePath);
  const t = vscode.window.createTerminal({ name: `SH (sudo): ${path.basename(filePath)}` });
  t.show();
  t.sendText(`sudo bash "${filePath}"`);
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

    vscode.commands.registerCommand('git-add.untrackFile', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doUntrackFile(t).catch(e => vscode.window.showErrorMessage('Untrack File failed: ' + e.message));
    }),

    vscode.commands.registerCommand('isd.run-ps1', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doRunPs1(t[0]).catch(e => vscode.window.showErrorMessage('Run PS1 failed: ' + e.message));
    }),

    vscode.commands.registerCommand('isd.run-cmd', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doRunCmd(t[0]).catch(e => vscode.window.showErrorMessage('Run CMD failed: ' + e.message));
    }),

    vscode.commands.registerCommand('isd.run-sh', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doRunSh(t[0]).catch(e => vscode.window.showErrorMessage('Run SH failed: ' + e.message));
    }),

    vscode.commands.registerCommand('isd.run-ps1-admin', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doRunPs1Admin(t[0]).catch(e => vscode.window.showErrorMessage('Run PS1 Admin failed: ' + e.message));
    }),

    vscode.commands.registerCommand('isd.run-cmd-admin', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doRunCmdAdmin(t[0]).catch(e => vscode.window.showErrorMessage('Run CMD Admin failed: ' + e.message));
    }),

    vscode.commands.registerCommand('isd.run-sh-sudo', (uri, uris) => {
      const t = resolveTargets(uri, uris);
      if (!t.length) { vscode.window.showErrorMessage('No file selected.'); return; }
      doRunShSudo(t[0]).catch(e => vscode.window.showErrorMessage('Run SH sudo failed: ' + e.message));
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
        { label: '$(discard) Untrack File from Commit…', description: 'New commit reverts a file; working copy preserved', id: 'untrackFile' },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { kind: vscode.QuickPickItemKind.Separator },
        { label: '$(check) Commit -m', id: 'commit' },
        { kind: vscode.QuickPickItemKind.Separator, label: 'Script Runner' },
        { label: '$(terminal-powershell) Run PS1  (Windows)',         description: 'PowerShell',   id: 'runPs1' },
        { label: '$(terminal-cmd) Run CMD  (Windows)',                description: 'CMD',          id: 'runCmd' },
        { label: '$(terminal-bash) Run SH  (Linux / Mac)',            description: 'Bash',         id: 'runSh' },
        { kind: vscode.QuickPickItemKind.Separator, label: 'Script Runner — Elevated' },
        { label: '$(shield) Run PS1 as Admin  (Windows)',             description: 'UAC 提示',    id: 'runPs1Admin' },
        { label: '$(shield) Run CMD as Admin  (Windows)',             description: 'UAC 提示',    id: 'runCmdAdmin' },
        { label: '$(shield) Run SH with sudo  (Linux / Mac)',         description: 'sudo 提示',   id: 'runShSudo' },
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
        case 'untrackFile':        await vscode.commands.executeCommand('git-add.untrackFile',        uri, uris); break;
        case 'runPs1':            await vscode.commands.executeCommand('isd.run-ps1',               uri, uris); break;
        case 'runCmd':            await vscode.commands.executeCommand('isd.run-cmd',               uri, uris); break;
        case 'runSh':             await vscode.commands.executeCommand('isd.run-sh',                uri, uris); break;
        case 'runPs1Admin':       await vscode.commands.executeCommand('isd.run-ps1-admin',         uri, uris); break;
        case 'runCmdAdmin':       await vscode.commands.executeCommand('isd.run-cmd-admin',         uri, uris); break;
        case 'runShSudo':         await vscode.commands.executeCommand('isd.run-sh-sudo',           uri, uris); break;
      }
    }),
  ];

  context.subscriptions.push(...cmds);
}

function deactivate() {}

module.exports = { activate, deactivate };
