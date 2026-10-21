# Luau 工作室（網頁版 Roblox 風格編輯器）

在瀏覽器裡寫 Roblox 的 Luau 程式 → 按 **F5 執行** → 右邊 3D 畫面立刻看到結果；可以設**中斷點、單步執行、看變數**。
純前端、免安裝、離線可用（Three.js 已放在 `vendor/`），也可以直接放上 GitHub Pages。

## 開啟
- Windows：雙擊 `開啟 Luau工作室.bat`（Chrome app 視窗）
- macOS：雙擊 `開啟Luau工作室.command`
- 或直接用瀏覽器打開 `index.html`；放上 GitHub Pages 就是線上版

## 功能
- **編輯器**：Luau 語法上色、自動縮排、打 `then`/`do`/`function()` 按 Enter 自動補 `end`、括號自動配對、`Ctrl+/` 註解、自動完成（會從程式推測物件類別，例如 `Players.` 列出 Players 服務的成員）、即時語法檢查
- **執行**：Script / LocalScript / ModuleScript，3D 畫面＋可操作的角色（WASD、空白鍵跳、右鍵轉視角，手機有虛擬搖桿）
- **除錯**：中斷點、F10 下一行 / F11 進入 / Shift+F11 跳出、變數面板（表格和 Instance 可展開）、監看運算式、滑鼠移到變數上看值、呼叫堆疊、「出錯時暫停」、暫停時用指令列改變數
- **輸出**：Roblox 格式的錯誤＋堆疊（可點擊跳行）、**中文錯誤提示**、重複訊息合併
- **檔案總管 / 屬性**：即時的 Instance 樹，執行中可直接改屬性
- **9 個範例**：Hello、彩虹階梯、熔岩金幣排行榜、Tween 移動平台、ClickDetector+GUI、除錯練習、OOP 模組、鍵盤控制+爆炸、跑酷計時

## 架構
| 檔案 | 內容 |
|---|---|
| `luau.js` | 自寫 Luau 直譯器：詞法 → 語法樹 → generator 走訪。每個敘述可暫停(除錯)、`task.wait`/coroutine 也是 yield；分段堆疊讓遞迴可到 8000 層 |
| `roblox.js` | Roblox 執行環境：資料型別、Instance 樹、服務、排程器、簡易物理、角色、Tween、GUI 資料模型（不碰 DOM，Node 可直接測） |
| `app.js` | 介面：編輯器、檔案總管、除錯面板、Three.js 畫面、GUI 疊圖 |
| `examples.js` | 內建範例 |

## 驗證
```
node test/run-tests.js       # 196 項：直譯器語意 + 語法錯誤 + Roblox API + 除錯器
node test/run-examples.js    # 每個範例無畫面跑 6 秒
node test/browser-check.js   # 59 項：無頭 Chrome 真的開頁面跑範例、中斷點、單步、角色走路、手機尺寸
```

## 跟真的 Roblox 不一樣的地方
物理是簡化版（方塊碰撞、不會翻滾）、只有一個玩家、伺服器和用戶端在同一個地方跑、沒有素材庫/模型匯入/音效。程式可用「檔案 → 下載 .lua」貼回 Roblox Studio。
