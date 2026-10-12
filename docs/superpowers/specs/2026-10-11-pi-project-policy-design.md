# Wealthline 專案代理與驗證政策設計

狀態：使用者已核准並要求執行；配置已落地，獨立檢查與啟用限制見 `2026-10-11-pi-policy-verification.md`。角色真實委派尚未驗證。

## 目標與範圍

只在 Wealthline 配置角色、敏感路徑保護、受限驗證工具與精簡交接；不修改全域 Pi 設定或產品程式。降低不必要的上下文與重複驗證，不以犧牲正確性換取較短輸出。

不自動 commit、push、部署或安裝依賴。不加入任意 token 硬上限、歷史刪除、模型路由、付費摘要呼叫或完整 OS 沙箱。

## 已核實的環境

- 專案：`haomeh/wealthline` repo 根目錄。
- 未發現既有專案 `.pi/` 或全域角色 overlays。
- Herdsman precedence 為 bundled < trusted project < global；未受信任專案不載入專案定義。
- 內建 implementer/reviewer/scout/generalist 通常停用一般 extension discovery 和 skills，故 guard 必須顯式列入子代理的 extensions。
- `npm test` 有 pretest：`scripts/prepare-ocr.mjs` 從本機已安裝依賴複製 OCR 資產到 `public/ocr/`，不是完全唯讀操作。
- 測試採 Node test runner；lint 使用 oxlint；build 使用 TypeScript、Vite 及 prerender。
- 當前對話沒有 Herdsman `list_agents` 或委派工具，不能聲稱已 runtime 驗證有效角色。

## 架構與檔案邊界

- `.pi/agents/implementer.md`：內建 DEV 的部分 overlay。
- `.pi/agents/reviewer.md`：內建唯讀 reviewer 的部分 overlay。
- `.pi/agents/scout.md`：確保 reconnaissance 子代理也載入 guard。
- `.pi/agents/generalist.md`、`.pi/agents/researcher.md`：補齊內建普通代理的 guard 與風格 overlays，避免間接委派漏掉保護。
- `AGENTS.md`、`.pi/prompts/internal-style.md`：精簡共通指令；內部英文、對使用者繁體中文。
- `.pi/agents/tester.md`：新 QA leaf；read/ls/find/grep 與專用驗證工具，無任意 shell、edit/write 或再委派。
- `.pi/agents/pm.md`：新產品 PM leaf；只讀查檔，不執行開發命令或再委派。
- `.pi/extensions/wealthline-policy/index.ts`：Pi adapter、tool_call 攔截與專用驗證工具註冊。
- `.pi/extensions/wealthline-policy/policy.mjs`：可用 Node 測試的路徑與重試純邏輯。
- `.pi/extensions/wealthline-policy/validation.mjs`：固定命令映射、子程序與有界日誌。
- `.pi/README.md`：角色選擇、啟用、邊界、驗證與移除說明。
- `.pi/tests/`：隔離政策測試，不修改現有產品測試設定。
- `.pi/artifacts/`：忽略版本控制的驗證日誌。

主 session 透過 trusted project extension discovery 載入 guard。子代理以顯式 extension 路徑載入；Herdsman 不會把 extensions 字串解析成相對 definition 路徑，因此必須驗證相對 cwd 的載入行為，或採經驗證的專案啟動方式。不得在未驗證載入方式時宣告保護已生效。

## 角色與 context

DEV 保留 read/bash/edit/write，另允許專用驗證工具；仍可依內建策略委派 scout。QA 不提供任意 shell；reviewer 與 scout 保持唯讀；PM 不提供修改或驗證能力。原生 skills discovery 維持關閉，不把主 session 的所有 skills 傳入子代理。

共同交接格式：目標、範圍/非目標、相關檔案、驗收條件、驗證結果、風險/待決策事項。角色指令使用短版 append，保留內建指令。不複製整段主對話或將所有文件預先嵌入 system prompt。文件按需讀取；PM 關注產品條件，DEV 關注實作，QA 關注實際重現與測試證據，reviewer 獨立核對。

依任務風險選角色，沒有每次強制四角色工作流。不頻繁切換工具集或重寫 system prompt，避免 cache 失效。第一版只提供可觀測、可比較的節流策略，不保證 token 消耗必然下降。

## Guard 與安全邊界

攔截已知普通檔案工具 read/write/edit/ls/find/grep 的路徑。任意深度的 `.env` 與 `.env.*` 阻擋，但 `.env.example` 允許；`.git` 與 `.pi` 政策檔禁止修改，允許必要的非敏感政策查閱與驗證日誌讀取。預設不允許普通檔案工具離開專案 root；相對路徑、absolute path、`..` 與 symlink 必須一致處理。不存在的寫入目標以最近存在父目錄的 canonical path 判定。

grep/find/ls 可能從允許目錄掃到禁止項目，不能只檢查輸入根目錄：需要安全排除或拒絕不受控遞迴；同時測試檔名搜尋與內容搜尋不能洩漏秘密。未知自訂工具不能被當成已保護工具。

DEV 的 bash 是一般執行能力，無法靠命令黑名單確保敏感路徑保護、禁止部署或禁止安裝。第一版這些 DEV 行為是指令限制，README 必須明示；如需硬限制，改用無 shell 工具集或隔離執行環境，不宣稱目前已有沙箱。

QA 專用驗證工具可啟動專案腳本；專案腳本與依賴本身是受信任的可執行程式，不是沙箱。loaded extensions 具有 Pi 進程的 OS 權限。非互動模式不可因缺少 UI 而自動允許被拒絕的操作。

## 專用驗證工具

名稱 `wealthline_validate`，輸入只有封閉 enum（test/lint/typecheck）；不接受任意命令、shell 字串、環境變數、工作目錄或可注入參數。

- test：固定執行 npm test，包含已知 OCR preparation；允許寫入 public/ocr。
- lint：固定執行 npm run lint，無 auto-fix。
- typecheck：固定呼叫本機 TypeScript tsc -b，允許生成 tsbuildinfo；確切輸出位置需實作前核對 tsconfig。

所有命令固定 cwd 為專案 root，使用 spawn argv 而非 shell，先確認依賴存在，不自動安裝或使用可能下載套件的 npx。固定 timeout；取消/逾時時終止子程序並清理資源。並行驗證序列化，避免共享輸出/計數競態。

完整 stdout/stderr 以有限大小寫入 ignored artifacts，超過上限時明示截斷。模型結果保留 exit status、取消/逾時狀態、重要失敗片段及日誌位置，摘要也有大小上限。日誌不是保證無敏感內容；專案秘密不得進入測試輸出，adapter 不記錄凭證或完整上下文。

每項驗證獨立計算連續失敗；成功歸零，取消不算成功或測試失敗；失敗三次後同項停止自動重跑，必須人工 reset。reset 只提供使用者命令，不提供模型 callable tool。第一版計數限當前 session，不聲稱跨重啟持久限制。

## 測試與驗收

先寫失敗測試再實作。政策測試使用臨時目錄與假的秘密，不讀真實 `.env.local`。

1. 所有角色定義能由已安裝 Herdsman 引擎解析；QA/PM 無 bash/edit/write，reviewer 保持唯讀。
2. guard 在主 session 與實際 QA/DEV 子代理載入，registered tools 與 effective allowlist 正確；若無 runtime 工具，報告未驗證部分並提供人工 smoke steps。
3. `.env.local`、巢狀秘密、`..`、symlink、搜尋掃描都不能透過已保護的普通檔案工具洩漏；example 可讀。
4. `.git` 与政策修改被阻擋，正常程式修改允許。
5. 專用驗證不能注入命令，cwd 固定，不下載依賴；並行、取消、timeout、輸出上限、三次失敗、成功 reset 均測試。
6. 不修改全域設定、auth 或產品程式；git diff 可清楚確認新增配置與 docs。
7. 以實際 test/lint/typecheck 驗證工具的固定命令，產品既有失敗如實回報，不順手修復。

## 啟用與回滾

建立配置不代表正在執行的代理熱更新。可信任專案內重新啟動/reload Pi，使用 `/agents definitions` 查看來源與角色；新配置對後續代理 assignment 生效。既有全域同名 overlay 可覆蓋專案政策，需在 effective definition 檢查。

回滾為移除本次新增 `.pi/` 配置與日誌 ignore，重啟 Pi；不動全域角色或任何登入資料。

## 審查記錄

已自行核對安裝版本的 Herdsman schema、角色內建配置、Pi extension contracts 與 OCR preparation。未做獨立子代理審查；目前工具不具備委派能力。主要實作風險是搜尋間接讀取、symlink/new-path canonicalization、子代理 extension 路徑及測試子程序取消；必須以測試與 runtime smoke evidence 驗證，不能只依 prompt 保證。
