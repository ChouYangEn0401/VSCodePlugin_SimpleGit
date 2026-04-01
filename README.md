# isd-simple-git

Simple, lightweight VS Code helper to run common Git actions from the editor/explorer: add, force-add, unstage, stage hunks, view file log in a pop-up, and commit with a message.

---

## 安裝方式

## Installation

There are two common ways to try or install this extension:

1) Developer test (quick, per-workspace testing)

- Open this project folder in VS Code and press F5 (or Run → Start Debugging). This launches an Extension Development Host where the extension is active for testing only.

2) Install for your user (normal use)

- Build a VSIX package (`vsce package`) or copy the extension folder to your user extensions directory:

```
%USERPROFILE%\.vscode\extensions\isd-simple-git-0.0.1
```

- Restart VS Code. Installing under the user extensions folder makes the extension available to that user across all workspaces.

Note: VS Code does not provide a built-in "workspace-only" install for published extensions. Running via F5 (Extension Development Host) affects only your testing window. If you need a workspace-scoped workflow, include this extension in your repo and instruct teammates to run it via F5 or install the VSIX locally.

---

## 使用方式


## Usage

This extension exposes a single central command and menu entry: `ISD: Git Tool` (command id: `isd.git-tool`). It groups all actions in one place so you don't have many scattered menu items.

- In Explorer: select one or more files (Ctrl+Click / Shift+Click), right-click → **ISD: Git Tool**.
- In Editor: right-click inside the file → **ISD: Git Tool**.

When invoked a small menu appears with the following actions:

- `Git Add` — run `git add <files>`
- `Git Add -f (Force)` — run `git add -f <files>` (bypass `.gitignore`)
- `Stage File` — `git add` the current file
- `Unstage (restore staged)` — `git restore --staged <file>`
- `Stage Selection (built-in)` — delegates to VS Code builtin `git.stageSelectedRanges` if available
- `Stage Hunks (patch-based)` — parses `git diff -U0` and stages only hunks overlapping your selection(s) using `git apply --cached` (Sourcetree-like behavior)
- `Show File Log` — pick a commit and view `git show` in a small popup window; close with the X button when done
- `Commit -m` — prompts for a commit message and runs `git commit -m "message"`

---


## Notes & tips

- Multi-select files in Explorer (Ctrl+Click / Shift+Click) and open `ISD: Git Tool` to operate on them together.
- `Stage Hunks` works by selecting ranges in the editor. It is line-based under the hood (git diffs are line-oriented). If you need character-level staging, that's not directly supported by git patches; the plugin approximates the Sourcetree behavior by staging hunks that overlap your selection.
- `Show File Log` opens a small pop-up (webview panel) showing the full `git show` output. Close it using the X (Close) button in the panel.

## Project structure

```
isd-simple-git/
├── extension.js   # extension implementation
├── package.json   # extension manifest (commands + menus)
└── README.md      # this file
```
---

## 開發與 F5 測試

本專案已包含 `./.vscode/launch.json`，可直接使用 Run 窗格或 F5 啟動 Extension Development Host：

- 打開本專案資料夾（確保只開這個專案）
- 在左側 Run（或按 Ctrl+Shift+D），選擇 **Run Extension**，按 F5
- 或直接按 F5（如果 VS Code 把 F5 綁給 Python，請在 Run 窗格選 `Run Extension` 再按 F5）

啟動後會跳一個新的 VS Code 視窗（Extension Development Host），在那裡右鍵檔案測試功能，並用 Help → Toggle Developer Tools → Console 查看除錯訊息。

---

## 故障排除（常見）

- 如果按下後沒有任何反應，先在 Extension Host 的命令面板（Ctrl+Shift+P）搜尋 `Git Add`，確認命令已載入。
- 如果 Console 顯示 `spawn git ENOENT` 或找不到 `git`：請在系統能執行 `git --version`，或在 VS Code 設定加入 `"git.path": "C:\\Program Files\\Git\\cmd\\git.exe"`，然後重啟。
- 如果出現關於 `.gitignore` 的錯誤（被忽略的路徑），請使用 `Git Add -f (Force)` 選項，或檢查 `.gitignore`。

---


If you'd like, I can produce a minimal VSIX and instructions to publish the extension on GitHub as a release artifact for easy installation.

---

如果要我把 `Stage Selection` 做成更高階的行為（像 Sourcetree 的逐行/逐段 stage），我可以改為產生 patch 並用 `git apply --cached` 來進行，需我實作請回覆「要」。

---

如果你要我把 README 再簡化成一頁快速指令卡（只保留三行指令），我可以立刻產出。 
```
