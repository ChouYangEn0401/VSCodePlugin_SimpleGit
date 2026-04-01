# isd-simple-git

> A lightweight VS Code extension that adds a single **ISD: Git Tool** entry to your right-click menu, giving you the most-used Git actions without leaving the editor.

---

## Features

| Action | Description |
|---|---|
| **Stage** | `git add <files>` — stage one or many files |
| **Stage (Force)** | `git add -f <files>` — bypass `.gitignore` |
| **Unstage** | `git restore --staged <files>` |
| **Stage Selected Lines** | Stage only the lines you highlighted (patch-based, no third-party deps) |
| **File Log** | Browse commit history for a file; click a commit to view a syntax-highlighted diff popup |
| **Commit -m** | Type a commit message and commit in one step |

All actions are grouped behind a single right-click entry **ISD: Git Tool** to keep the menu clean.

---

## Requirements

- VS Code 1.60 or later
- `git` must be available in your `PATH`

---

## Installation

### Option A — Copy folder (fastest, no build needed)

1. Copy the entire project folder into your VS Code extensions directory:

   **Windows**
   ```
   %USERPROFILE%\.vscode\extensions\isd-simple-git-0.1.0
   ```

   **macOS / Linux**
   ```
   ~/.vscode/extensions/isd-simple-git-0.1.0
   ```

2. Restart VS Code.  
3. Right-click any file in the Explorer or Editor → you will see **ISD: Git Tool**.

> **Scope note:**  
> Installing in `.vscode/extensions` inside your user home directory applies the extension to **all** your VS Code workspaces.  
> If you only want it active for one project, ask teammates to install it themselves, or distribute it as a `.vsix` file (see below).

---

### Option B — Install from VSIX (share with others)

1. Build the package (requires `vsce`):

   ```bash
   npm install -g @vscode/vsce
   vsce package
   ```

   This produces a file like `isd-simple-git-0.1.0.vsix`.

2. Install it in VS Code:

   ```bash
   code --install-extension isd-simple-git-0.1.0.vsix
   ```

   Or via the UI: Extensions panel → `•••` menu → **Install from VSIX…**

---

### Option C — Developer / test mode (F5)

1. Open this project folder in VS Code.
2. In the Run panel (Ctrl+Shift+D) select **Run Extension**, then press F5.  
   A second VS Code window (**Extension Development Host**) opens with the extension active.
3. Test your changes there; the main VS Code window is unaffected.

---

## Usage

### Stage / Unstage files

1. In the Explorer, select one or more files (`Ctrl+Click` / `Shift+Click`).
2. Right-click → **ISD: Git Tool** → choose **Stage** or **Unstage**.

### Stage selected lines

1. Open a modified file in the editor.
2. Select the lines you want to stage (any number of ranges; `Ctrl+Click` for disjoint ranges).
3. Right-click → **ISD: Git Tool** → **Stage Selected Lines**.

> This works by parsing `git diff -U0`, keeping only the hunks that overlap your selection, and applying them to the index via `git apply --cached`.  
> If it fails, the **ISD Git** Output panel shows the patch and the error message to help diagnose.

### View file history

1. Right-click a file → **ISD: Git Tool** → **File Log**.
2. Pick a commit from the dropdown.
3. A popup panel shows a syntax-highlighted diff. Click **Close ✕** when done.

### Commit

1. Right-click → **ISD: Git Tool** → **Commit -m**.
2. Type your message and press Enter.

---

## Command Palette

Every action is also accessible from the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---|---|
| `ISD: Git Tool` | Open the full action menu |
| `ISD Git: Stage` | Stage selected file(s) |
| `ISD Git: Stage (Force)` | Force-stage bypassing `.gitignore` |
| `ISD Git: Unstage` | Unstage selected file(s) |
| `ISD Git: Stage Selected Lines` | Stage only highlighted lines |
| `ISD Git: File Log` | Browse commit history |
| `ISD Git: Commit -m` | Commit with a typed message |

---

## Project structure

```
isd-simple-git/
├── extension.js       # All extension logic
├── package.json       # Manifest: commands, menus, metadata
├── .vscodeignore      # Files excluded from the VSIX package
└── README.md
```

---

## License

MIT
