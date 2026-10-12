# Wealthline Pi 配置驗證紀錄

## 已落地

- 專案 `.pi/agents/`：implementer/reviewer/scout/generalist/researcher overlays，以及 tester/pm standalone definitions。
- 所有已配置的普通子代理明確列入 guard extension；QA/PM 使用封閉普通工具白名單。
- 專案 guard、固定驗證工具與人工 reset command。
- 根 AGENTS.md 與共用風格文件：內部 concise technical English（ASD-STE100-inspired，非完整合規），使用者匯報繁體中文。
- 有界摘要、最多 1 MiB 日誌、單項三次失敗停止、序列化與取消/timeout。
- 不修改全域設定、auth、產品程式，不安裝套件，不提交或部署。

## 實際檢查

- `node --test .pi/tests/*.test.mjs`：政策、命令、artifact symlink、預檢掃描、失敗預算、Pi loader 與角色 YAML/載入檢查。
- 固定 runner 執行 `npm test`：314 tests passed，0 failed。
- 固定 runner 執行 `npm run lint`：exit 0。
- 固定 runner 執行本機 `tsc -b`：exit 0。
- Pi 原生 extension loader 成功載入相對 guard 路徑並註冊 tool/events/commands；攔截測試不讀真實 .env.local 內容。
- 缺少獨立子代理工具，沒有獨立 code review。自行審查發現 artifact symlink 必須在 mkdir 子目錄前檢查父目錄；新增 RED regression test 後修正，並重新執行全部政策測試。

## 未驗證／未啟用部分

- 未實際啟動 QA/DEV/PM 子代理；不能宣稱真實委派上下文、有效工具集與角色 roster 已完成 end-to-end 驗證。
- Herdsman 安裝版本在 unmanaged Pi 中不啟用角色委派；當前檢查環境 HERDR_ENV 未設定。guard 與驗證工具可獨立載入，角色委派需要 Herdsman 的受管理執行環境。
- 靜態 YAML 檢查使用 Pi 的 parser，不是 Herdsman effective definition discovery。可信任專案中 `/agents definitions` 仍需人工檢查，尤其是全域同名 overlay precedence。
- 沒有執行完整 Vite build、瀏覽器測試、真實用量 A/B 測量或完整 ASD-STE100 合規驗證。

## 安全與用量邊界

DEV bash、未知工具、擴充與測試腳本不是沙箱；不能把普通檔案 guard 當作惡意程式隔離。三次失敗 budget 是每個 session/per-check，不跨代理或重啟持久化。精簡交接是角色指令，不是 token 硬預算。被保護根目錄的直接 scan 被拒絕，請使用明確檔案或 src/tests/server/worker 等安全子目錄。詳細使用與移除方式見 `.pi/README.md`。
