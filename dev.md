# Developer notes — Packaging & Publishing

將打包與發佈（Marketplace、VSIX）相關的步驟與敏感資訊從 `README.md` 移到本檔 `dev.md`，以避免在公開的專案首頁顯示可被濫用的發佈指令或個人憑證流程。

以下說明為發佈到 VS Code Marketplace（或產生 VSIX）的一般流程。請在發佈前確認 **你有權限** 並且已設定好 Marketplace publisher 與 Personal Access Token (PAT)。

## 1) 產生 VSIX（封裝）

本機打包（將產出 .vsix）：

```bash
npx @vscode/vsce package
# 產出檔案範例: isd-simple-git-0.1.0.vsix
```

安裝本機 VSIX（測試或分享檔案給他人）：

```bash
code --install-extension ./isd-simple-git-0.1.0.vsix
```

## 2) 發佈到 Marketplace（選用）

前置：建立一個 Marketplace publisher，並產生一組 Personal Access Token（PAT）。不要在公開檔案中放置 PAT。

發佈步驟（簡要）：

```bash
npm install -g @vscode/vsce
vsce login <publisher-name>
vsce publish
# 如果要發佈特定版本或命令參數，可參考 vsce 文件
```

注意事項：
- `vsce login` 會要求你輸入 PAT。
- 確認 `package.json` 中的 `publisher` 欄位為你的 publisher 名稱。
- Requires a registered publisher and a Personal Access Token on the VS Code Marketplace.

## 3) 權限與責任

- 如果你不想讓任何人能替此專案上架或管理 Marketplace，請勿公開 PAT，也不要在 `README.md` 顯示發佈步驟。
- 建議將發佈所需的機密（PAT）儲存在安全的密鑰管理系統，如 GitHub Secrets、Azure Key Vault，或本人的密碼管理器中。

## 4) 變更紀錄與版本管理

- 在發佈前、請更新 `package.json` 的 `version` 與 `changelog`（若有）。
- 測試：使用 `F5` 在 Extension Development Host 測試主要功能。

---

若你要我把 `publisher` 或 `package.json` 的 `version` 也一併檢查或更新，我可以幫你檢查目前的 `package.json` 並提出建議。
