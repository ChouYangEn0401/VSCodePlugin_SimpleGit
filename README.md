# isd-simple-git

Lightweight VS Code helper that adds a single **ISD: Git Tool** entry to the Explorer and Editor right-click menus. Quick access to: stage, force-stage, unstage, stage selected lines, view file log, stash file, and commit.

## Quick features
| Action | Description |
|---|---|
| **Stage** | `git add <files>` — stage one or many files |
| **Stage (Force)** | `git add -f <files>` — bypass `.gitignore` |
| **Unstage** | `git restore --staged <files>` |
| **Stage Selected Lines** | Stage only the lines you highlighted (patch-based, no third-party deps) |
| **File Log** | Browse commit history for a file; click a commit to view a syntax-highlighted diff popup |
| **Commit -m** | Type a commit message and commit in one step |

All actions are grouped behind a single right-click entry **ISD: Git Tool** to keep the menu clean.

## Requirements
- VS Code 1.60+
- `git` on PATH

## Install (for sharing)
1) Package to VSIX (local share):

```bash
npx @vscode/vsce package
# produces isd-simple-git-0.1.0.vsix
```

2) Install the VSIX locally or send the file to others:

```bash
# install locally
code --install-extension isd-simple-git-0.1.0.vsix
```

3) (Optional) Publish to Marketplace: set a valid `publisher` in `package.json`, create a Publisher on the VS Code Marketplace, then run:

```bash
npm install -g @vscode/vsce
vsce login <publisher>
vsce publish
# or: npx @vscode/vsce publish
```

Note: publishing requires a registered publisher and Personal Access Token.

## Developer / Test
1. Open the folder in VS Code.
2. Press F5 (Run Extension) to open an Extension Development Host window.
3. Right-click a file in Explorer or editor → **ISD: Git Tool** and try commands.

## Files
- `package.json` — extension manifest (commands, menus)
- `extension.js` — implementation
- `README.md` — this file

## License
MIT
