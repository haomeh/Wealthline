# Wealthline 雙平台模型路由

使用者已核准：新任務交替分配 OpenAI/Claude，按任務層級選模型；可靠額度作輔助，不把 Codex 額度當成 generic OpenAI 額度。只改本專案，不修改全域登入與設定。

## 模型與分類

Pi native virtual model `wealthline/auto`。

- small: openai/gpt-6-luna 或 anthropic/claude-haiku-5-5；low thinking。
- standard: openai/gpt-6.1-sol 或 anthropic/claude-sonnet-5-5；medium thinking。
- large: openai/gpt-6-astra 或 anthropic/claude-opus-5-5；high thinking。

所有候選來自目前本機 enabledModels/catalog。選用 Pi chat model lookup 與 getAvailable，排除同名 classifier。無可用憑證/候選時不得假裝可用。不宣稱本機價目表是訂閱實際計費。

規則分類不呼叫額外模型：高風險領域（財務計算、加密、資料遷移、跨模組等）優先；明確簡單且無風險的任務才 small；不確定預設 standard。短句並非自動 small。人工 size 覆寫可用，但高風險警告保留。模型實際 thinking 由 Pi clamp。

## 任務與快取

初始與明確新任務在兩平台交替，project-local ledger 以原子鎖避免多 session/子代理都選同一平台。不能將任務數交替說成 token/額度各半。

continuation/retry 優先保持 previous/failed physical model；direct 請求不消耗交替次數。简短确认/继续且已有前一個模型時維持原 route；`[task:new]` 明確要求新任務，`[task:continue]` 要求續接。高風險的新要求不能因簡短而自動降級。跨任務切換仍可能損失 prompt cache。

路由 state 在 Pi branch 保存，覆寫命令設定以非 context custom entry 保存。不儲存任務全文、憑證、回應內容。顯示實際模型、tier、選擇理由與額度資料狀態。

## 額度

目前沒有已確認帳號對應的 OpenAI 額度介面，Claude 面板的 snapshot 也沒有可供 project router 訂閱的公共事件。因此本次 live quota 預設 unknown；不新增網路額度 polling、不刷新憑證、不從 Codex 來源推測 OpenAI 帳號。

純選擇邏輯可接受經信任 adapter 驗證的近期 provider hints，只有 mappingVerified/observedAt/remainingPercent/cooldown 均有效時才避開緊張平台；runtime 不接受一般 user prompt 的額度宣稱。沒有 adapter 時 unknown 與交替策略繼續運作。這個介面是未來整合點，不宣稱目前已接通額度。

若平台缺少可用登入或相應模型，auto 可選另一個平台的同級模型並顯示理由。人工指定平台失敗時明確報錯，不偷偷跨平台。不因請求失敗在同一任務中自動無限升級或切換。

## 啟用

新增 `.pi/settings.json` project defaultProvider/defaultModel；保留目前本機 enabledModels，加入 wealthline/auto，以免全域 model scope 排除 virtual model。CLI 明確模型與保存的 session selection 保持優先，不在 session_start 强行覆蓋。

普通代理定義增加 model wealthline/auto 與顯式 router extension。新增 managed-lead 的最小 launch overlay；不向 runtime Lead/Manager/Chief profiles 寫入不支持的 model 欄位。受管理代理仍需 Herdsman 實際運行，普通 Pi 可使用虛擬模型。

人工命令 `/wealthline-route`：status、on、platform auto|openai|claude、size auto|small|standard|large。`on` 選擇 virtual model；改覆寫只影響之後的新任務，不中途改正在執行的工具 round。

## 使用者追加：Sol / Luna Fast

使用者要求 Sol/Luna 啟用 Fast。本機 Responses SDK 與 adapter 支援 `service_tier: fast`，使用 `before_provider_request` 只覆寫這兩個模型的 payload；其他模型不變，不降低 thinking。遠端接受/速度未實測，可能增加消耗；本機 adapter 使用 2 倍價格估算，但不能當成訂閱扣額保證。

## 實作狀態

配置與本機測試已落地；26 項政策/路由測試與 314 項產品測試通過，lint/typecheck 通過。證據、即時額度未接通與 provider/child runtime 限制見 `2026-10-11-balanced-model-routing-verification.md`。

## 驗證與回滾

Node tests：risk/default classification、同名 classifier 排除、交替跨 instance 與並行鎖、可靠/過期/未知 hints、缺少登入、人工覆寫、continuation/retry/direct stickiness、short follow-up 與 forced new tasks。

Installed Pi loader：註冊虛擬模型、命令與 adapter route；fake registry/temporary ledger 無網路派送。不宣稱這等同 provider 真實成功生成或已達用量平衡。

保留既有 guard/validation tests。檢查 project settings/role YAML/路徑。記錄所有限制與手動 activation smoke steps。移除 routing 檔案、model/extensions overlays、project default settings 即可回滾；不影響全域登入。
