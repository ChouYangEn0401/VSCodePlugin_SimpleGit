# Git Add — VS Code Extension

在 VS Code 右鍵選單直接執行 `git add`，支援多選檔案與 force add（繞過 `.gitignore`）。

---

## 安裝方式

### 方法一：複製資料夾（免打包，最快）

把整個專案資料夾複製到 VS Code extensions 目錄，**資料夾名稱必須含版本號**：

```
C:\Users\{你的使用者名稱}\.vscode\extensions\isd-git-add-0.0.1
```

重啟 VS Code，即可生效。

### 方法二：F5 開發模式測試

1. 用 VS Code 開啟本專案資料夾
2. 按 `F5`（或選單 Run → Start Debugging）
3. 會跳出一個新的 **Extension Development Host** 視窗
4. 在那個視窗裡測試功能，不需要任何安裝

> 需要先安裝 Node.js，但**不需要** `npm install`，因為本擴充套件不依賴任何第三方套件。

---

## 使用方式

### 在左側 Explorer 右鍵

1. 在左側檔案樹中，**單選或多選**（`Ctrl+Click` / `Shift+Click`）一個或多個檔案
2. 右鍵 → 選 **Git Add**
3. 跳出選單，選擇要執行的動作：

| 選項 | 執行的指令 | 說明 |
|------|-----------|------|
| `Git Add` | `git add <files>` | 一般 stage |
| `Git Add -f (Force)` | `git add -f <files>` | 強制 stage，可以將 `.gitignore` 內的檔案也加進去 |

4. 執行完成後右下角會出現通知訊息。

### 在編輯器內右鍵

在目前開啟的檔案內容區右鍵，同樣可以看到 **Git Add**，對當前檔案執行。

---

## 多選檔案

在左側 Explorer：

- `Ctrl + Click`：逐一加選
- `Shift + Click`：範圍選取

選好後右鍵 → **Git Add**，所有選取的檔案會一次傳入同一個 `git add` 指令。

---

## 關於 `git add -f`

如果你的專案有 `.gitignore`，某些檔案（例如 `.env`、build 輸出等）會被忽略，直接 `git add` 會報錯：

```
The following paths are ignored by one of your .gitignore files
```

這時選 **Git Add -f (Force)** 即可強制 stage。

> ⚠️ 請謹慎使用 force add，避免不小心 commit 敏感資料（如密碼、金鑰）。

---

## 專案結構

```
Git Add/
├── extension.js   # 擴充套件主程式
├── package.json   # 擴充套件設定、選單宣告
└── README.md      # 本說明文件

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

如果你要我把 README 再簡化成一頁快速指令卡（只保留三行指令），我可以立刻產出。 
```
