# Herdr 角色啟動器設計

日期：2026-10-11　狀態：已核准；實作計畫見 `docs/superpowers/plans/2026-10-11-herdr-role-launcher.md`

## 目的

在 herdr 裡啟動 claude、codex、agy 時，每個 agent 都套用一個角色模板。角色決定它的 prompt、可用工具、skill、hook 與模型層級。不指定平台時，啟動器依剩餘額度與交替次序選平台。

取代 `.pi/` 那套配置。`.pi/` 本身不刪，由使用者另行決定。

## 成功條件

1. `bin/agent <role>` 一行指令就能在 herdr pane 啟動套好角色的 agent。
2. 角色 session 不載入使用者全域的 plugin、hook、MCP；只有角色明列的才存在。
3. 唯讀角色（tester、reviewer、pm、scout）無法改檔。claude 由工具白名單強制，codex 由 sandbox 強制。
4. 額度為 0 或冷卻中的平台不會被自動選中。
5. `bin/agent status` 顯示三家額度、快照時間、下一個輪到的平台。

## 不做

- session 中途換平台或換模型。路由只在啟動時決定一次。
- 依任務文字猜層級。層級由角色決定。
- token 用量帳本、跨 session 的失敗重試計數。
- 抵抗惡意程式的沙箱。implementer 的 shell 不受隔離。

## 目錄

```
.agents/
  roles/<role>/prompt.md       角色內文
  roles/<role>/claude.json     Claude settings：hooks、permissions、enabledPlugins、statusLine
  roles/<role>/role.json       tier、claude 工具白名單、codex sandbox、agy mode
  shared/internal-style.md     輸出契約，啟動時串接到 prompt 後面
  lib/routing.mjs              純函式：選平台與模型
  lib/ledger.mjs               交替次序的原子鎖
  lib/quota.mjs                讀三家額度快照
  lib/args.mjs                 純函式：角色 × 平台 → 原生參數
  bin/agent                    進入點
  bin/validate                 只接受 test | lint | typecheck
  bin/quota-statusline         statusline 指令，順手寫額度快照
  hooks/guard-paths            PreToolUse：擋 .env*、.git、.agents 寫入
  state/                       額度快照、turn.json、validate log（不進版控）
  tests/*.test.mjs
```

五個角色：`implementer`、`tester`、`reviewer`、`pm`、`scout`。

## 指令介面

```
bin/agent <role> [claude|codex|agy] [--pane ID] [--tier small|standard|large] [--dry-run]
bin/agent status
```

- 省略平台：自動路由。
- 省略 `--pane`：使用 `$HERDR_PANE_ID`。不在 herdr 內（`HERDR_ENV` 不為 1）時報錯結束，`--dry-run` 與 `status` 例外。
- agent 名稱為 `<role>-<platform>`；已存在同名 agent 時加序號。
- 實際啟動：`herdr agent start <name> --kind <platform> --pane <id> -- <原生參數>`。
- `--dry-run` 印出路由決定與完整參數，不啟動、不消耗交替次序。

## 各平台的原生參數

### claude

```
--setting-sources project
--settings .agents/roles/<role>/claude.json
--strict-mcp-config
--append-system-prompt-file <state 內串接好的 prompt>
--tools <role.json 的白名單>
--model <層級對應模型>
```

`claude.json` 每個角色都必須帶 herdr 狀態 hook（`bash ~/.claude/hooks/herdr-agent-state.sh session`），否則 herdr 看不到 idle／working。statusLine 指向 `bin/quota-statusline claude`。

### codex

```
-m <模型>
-s read-only | workspace-write
-c model_instructions_file=<串接好的 prompt>
-c plugins."<name>".enabled=false   （角色未列的全域 plugin 逐一關閉）
```

codex 的 hook 在全域 `~/.codex/hooks.json`，無法逐角色區分；這裡只留 herdr 狀態 hook，本來就該共用。

### agy

```
--model <模型>
--mode plan            （唯讀角色）
--sandbox
--prompt-interactive <串接好的 prompt>
```

agy 沒有逐 session 的設定來源旗標，隔離只到 prompt 與 mode 這一層。

## 角色定義

| 角色 | tier | claude 工具 | claude skill | codex sandbox | agy mode |
| --- | --- | --- | --- | --- | --- |
| implementer | large | Read Edit Write Bash Grep Glob | superpowers、ponytail | workspace-write | 預設 |
| tester | standard | Read Grep Glob Bash | 無 | read-only | plan |
| reviewer | large | Read Grep Glob | 無 | read-only | plan |
| pm | standard | Read Grep Glob | 無 | read-only | plan |
| scout | small | Read Grep Glob | 無 | read-only | plan |

- tester 的 Bash 以 `permissions.allow` 限定為 `Bash(.agents/bin/validate:*)`，其餘 deny。
- implementer 另帶 RTK hook 與 `guard-paths`，並 deny `Bash(git push:*)`。
- 除 pm 外都帶 `guard-paths`。
- prompt 內文取自 `.pi/agents/<role>.md`，移除 pi／Herdsman 專用字句。

## 模型層級

| tier | claude | codex | agy |
| --- | --- | --- | --- |
| large | claude-opus-5-5 | gpt-6-astra | gemini-3.1-pro-high |
| standard | claude-sonnet-5-5 | gpt-5.6-sol | gemini-3.8-flash-high |
| small | claude-haiku-5-5 | gpt-5.6-luna | gemini-3.8-flash-low |

## 額度

快照格式（`state/quota-<platform>.json`）：

```json
{ "observedAt": 1791000000000, "windows": [{ "name": "7d", "usedPercent": 22, "resetsAt": 1792297578000 }] }
```

- claude、agy：`bin/quota-statusline <platform>` 從 statusline 輸入 JSON 取 `rate_limits`，寫快照，再輸出一行狀態文字。
- codex：`quota.mjs` 直接讀 `~/.codex/sessions` 下最新 rollout 檔的最後一筆 `rate_limits`，以該檔 mtime 當 `observedAt`。
- 平台剩餘額度取各窗口中最小的剩餘百分比。
- 快照超過 10 分鐘、格式不符、`observedAt` 在未來：一律視為未知。
- 不呼叫 API、不讀憑證檔。

agy 的 `rate_limits` 欄位名尚未實測。實作時跑一次確認；取不到時 agy 永遠是未知，只參與交替。

## 路由

輸入：角色、模式（平台與 tier 的手動覆寫）、三家額度、ledger 的下一順位、目前 live agent 清單。

1. tier = `--tier` 或角色的 tier。
2. 候選 = 手動指定的平台，否則三家。
3. 排除剩餘 0% 且 `resetsAt` 尚未到的平台。
4. 若角色是 reviewer 且 `herdr agent list` 有 implementer，將 implementer 所在平台移到候選末位。
5. 剩餘 ≤ 15% 的平台移到末位。未知額度不算緊張。
6. 從 ledger 的下一順位開始，取候選中第一個未被移到末位的平台；全都在末位時取第一個。
7. 自動路由時把 ledger 的 `next` 設為被選中平台的下一家；手動指定平台不推進。

候選為空時報錯並列出各平台被排除的原因，不自動降 tier。手動指定的平台被額度擋下時同樣報錯，不偷換平台。

ledger：`state/turn.json` 存 `{ "version": 1, "next": "<platform>" }`，以 `mkdir` 鎖保護，等待上限 5 秒。交替順序固定為 codex → claude → agy。

## 驗證工具

`bin/validate <test|lint|typecheck>` 對應 `npm test`、`npm run lint`、`node node_modules/typescript/bin/tsc -b`。不接受其他參數。輸出寫到 `state/`，只保留最近 5 份。

## 錯誤處理

- 不在 herdr 內、pane 不是可用的 shell、角色不存在、平台 CLI 未安裝：明確報錯，退出碼非 0。
- 額度檔損壞：視為未知，不擋路由。
- ledger 損壞或鎖逾時：報錯並指出檔案路徑，不自動刪除。

## 測試

`node --test .agents/tests/*.test.mjs`，全部不需要 herdr 或真實 CLI：

- `routing`：額度排除、緊張排後、未知照常、交替次序、reviewer 避開 implementer、手動覆寫、候選為空報錯。
- `quota`：三種來源的解析、過期、未來時間、損壞檔。
- `ledger`：並行取號不重複、損壞報錯。
- `args`：五個角色 × 三個平台的參數快照；唯讀角色不含 Edit／Write，codex 為 read-only。
- `definitions`：每個 `claude.json` 都含 herdr 狀態 hook；每個角色的 prompt 與 `role.json` 存在。

人工驗證（需在 herdr 內）：啟動 `reviewer` 的 claude session，確認 `/skills` 沒有 superpowers、Edit 不可用、herdr 側欄有狀態；啟動後 `bin/agent status` 出現 claude 額度。

## 尚待實測的假設

1. `--setting-sources project` 加 `--settings` 的 `enabledPlugins` 能啟用使用者層級已安裝的 plugin。不行的話 implementer 改用 `--plugin-dir`。
2. Claude statusline 輸入 JSON 在本機帳號下確實帶 `rate_limits`。
3. agy statusline 輸入的額度欄位名，以及 agy 是否讀專案層的 statusline 設定。
4. `-c plugins."x".enabled=false` 能在 codex 逐次關閉 plugin。

任何一項不成立，對應功能降級並在 `status` 與 README 明示，不以其他方式偽裝。

## 版控

`.gitignore` 加 `.agents/state/`。其餘 `.agents/` 檔案應進版控，否則 herdr worktree 內沒有角色定義。commit 由使用者決定。

## 計畫階段的修正

寫實作計畫時改掉的幾點，以本節為準：

- **不寫 `hooks/guard-paths`。** 改用 Claude 原生的 `permissions.deny` 規則擋 `.env*`、`.git`、`.agents` 寫入，少一支自訂 hook。五個角色都帶，包含 pm。
- **進入點檔名是 `bin/agent.mjs` 與 `bin/quota-statusline.mjs`**，避免無副檔名 ESM 的相容問題。
- **不指定 `--pane` 時直接在目前 pane 前景執行 CLI**，herdr 自動偵測後再盡力改名；不在 herdr 內也能用。指定 `--pane` 才走 `herdr agent start`。原因：執行啟動器的 pane 當下不是閒置 shell，`agent start` 會拒絕它。
- **codex 與 agy 的角色內文改為一行指示，要求先讀 prompt 檔**，不把整份 prompt 塞進命令列。codex 用 `-c developer_instructions=…`，不用 `model_instructions_file`（後者會取代 codex 內建指令）。
- **`claude.json` 是模板**，`${ROOT}` 在啟動時換成專案絕對路徑後寫到 `state/settings/`。
- **agy 的 `--sandbox` 只給唯讀角色**，implementer 不帶，因為尚未確認它會不會擋住測試指令。
- **已過重置時間的額度窗口不計入**，避免舊快照把已恢復的平台判成緊張。
- **`AGENTS.md` 需要改寫** pi 專用段落，屬於 agent policy，實作時另行徵求同意。
