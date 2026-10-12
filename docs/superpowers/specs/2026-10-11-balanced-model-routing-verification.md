# 雙平台路由與 Fast 驗證紀錄

## 已配置

- `.pi/extensions/wealthline-router/index.ts`：Pi 原生 `registerVirtualModel`、`before_provider_request` Fast hook、人工 `/wealthline-route` 命令。
- `routing.mjs`：保守分級、封閉模型對、可用 chat candidates、sticky continuation/retry/direct、人工覆寫、可靠 hint 的純選擇邏輯。
- `ledger.mjs`：同一 checkout 多 session/process 的原子交替次序；只保存下一平台，不保存 prompt、token 或憑證。
- `.pi/settings.json`：新 session 預設 wealthline/auto，保留本機模型 whitelist 並加入 virtual model。
- 普通角色與 managed-lead：指定 wealthline/auto，顯式載入 guard + router。沒有在不支援 model 的 runtime Lead/Manager/Chief profiles 中設定模型。
- Sol、Luna：按使用者新增要求設定 service_tier=fast；不降低 thinking，不修改 Astra/Claude。

## 實際驗證

執行 `node --test .pi/tests/*.test.mjs`：26 tests passed，0 failed。

涵蓋：風險分級、模糊任務 standard、chat/classifier 同名排除、同級缺省備援、不自動降級、未知/過期/錯誤 hint 忽略、工具輪與 retry sticky、簡短確認、新任務標記、分支覆寫恢復、取消/損壞/鎖競爭/symlink、六個獨立 Node process 的交替分配、角色 YAML/loader、原有安全與驗證工具。

Installed Pi loader 成功註冊 virtual model。使用 isolated fake credentials/provider endpoints，經 Pi 的 `ModelRuntime.resolveModel` 驗證 virtual selection 實際解析為 physical catalog model；不發送 stream/model 請求。Fast hook 測試確認兩個模型設定 fast、原 payload 不被就地修改，Astra/Claude/其他 provider 不變。

專案固定 runner：
- npm test：314 tests passed，0 failed。
- npm run lint：exit 0。
- 本機 tsc -b：exit 0。
- git diff --check：通過。

所有 tests 使用假憑證與臨時 ledger；未讀出真實 token，未刷新登入、安裝依賴或提交 Git。

## 未驗證與限制

- 沒有發送真實 OpenAI/Claude 請求，無法聲稱當前雲端模型、OAuth 或 Fast tier 已通過端到端驗證。
- 本機 SDK 接受 service_tier=fast；adapter 對這兩個 ID 的 fast 使用 2 倍價格估算。這不是實際訂閱扣額或遠端接受的證據。
- runtime 即時 quota 仍為 unknown；純 hints 邏輯不是已接通的 quota hook。沒有把 Codex credentials 推論成 generic OpenAI 的同一額度池。
- 交替的是派送次數，不是 token/額度各半；不同 worktree 各自有 ledger，跨任務 provider 切換可能損失 cache。
- 沒有新的語意分類模型；關鍵字規則可誤判，人工 size 覆寫須慎用。
- 沒有實際啟動 Herdsman 子代理，effective roster/子代理生成/真实请求需在受管理環境 smoke test。普通 Pi 本身可用 virtual model。
- 未具備獨立 subagent review 工具；已自行檢查鎖競爭、分支恢復、憑證/紀錄邊界與 Fast scope。

## 使用

新 project session 使用 wealthline/auto；保存 session 或 CLI 指定模型不被強制覆蓋。重新載入專案擴充後，可用 `/wealthline-route on` 選用；`/wealthline-route status` 查看政策。詳見 `.pi/README.md`。
