# Wealthline 角色啟動器

在 herdr（或任何終端）裡，用角色模板啟動 claude、codex、agy。

    .agents/bin/agent.mjs reviewer            # 自動選平台，在目前 pane 啟動
    .agents/bin/agent.mjs implementer claude  # 指定平台
    .agents/bin/agent.mjs scout --pane w1:p3  # 在另一個閒置的 herdr pane 啟動
    .agents/bin/agent.mjs tester --dry-run    # 只印出路由與參數
    .agents/bin/agent.mjs status              # 三家額度與下一個輪到的平台

## 角色

| 角色 | 層級 | 能改檔 | 能跑指令 |
| --- | --- | --- | --- |
| implementer | large | 是 | 是 |
| tester | standard | 否 | `.agents/bin/validate` 與唯讀指令 |
| reviewer | large | 否 | 否 |
| pm | standard | 否 | 否 |
| scout | small | 否 | 否 |

每個角色一個目錄：`prompt.md`（角色內文）、`role.json`（層級、工具、sandbox、plugin）、`claude.json`（該角色的 Claude hooks、權限、statusline）。改角色就改這三個檔。

## 路由

不指定平台時：排除額度用完的平台，把剩餘 15% 以下的排到最後，其餘按 codex → claude → agy 交替。reviewer 會避開正在跑 implementer 的平台。指定平台時不輪替，被額度擋下就報錯。路由只在啟動時決定一次。

額度來源：codex 讀 `~/.codex/sessions` 的 rollout 檔；claude 與 agy 由角色 session 的 statusline 寫入 `.agents/state/`。超過 10 分鐘的快照視為未知，未知的平台照常參與；但已用完的快照會保留到重置時間為止。

## 各平台的隔離程度

- claude：不載入全域設定、plugin、hook、MCP；工具白名單與權限規則由 CLI 強制。
- codex：sandbox 由 CLI 強制；全域 plugin 逐一關閉；角色內文以一行指示要求先讀 prompt 檔。hook 仍是全域的。
- agy：唯讀角色用 plan mode 加 sandbox；角色內文同樣以首則訊息指向 prompt 檔。沒有設定層的隔離。

這不是安全沙箱。implementer 的 shell 與專案腳本不受限制。

## 測試

    node --test .agents/tests/*.test.mjs

## 狀態檔

`.agents/state/` 不進版控。`turn.lock` 若因當機殘留，確認沒有其他啟動在進行後手動刪除。

## 已驗證（2026-10-11，真實 CLI）

- claude 唯讀角色：`claude -p` 搭配 reviewer 設定，回報工具只有 Glob、Grep、Read，skill 為 NONE。
- claude implementer：隔離下 `enabledPlugins` 不會載入使用者層級的 plugin，所以改用 `--plugin-dir`；plugin 清單在 `role.json` 的 `claudePlugins`，路徑取自 `~/.claude/plugins/installed_plugins.json`。
- codex 角色指示：`developer_instructions` 的一行指示有效，模型回報自己是 scout。
- codex plugin 關閉：`-c plugins.<name>.enabled=false`（key 不加引號）有效；加引號的寫法無效。
- codex 模型：ChatGPT 帳號下可用的是 `gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-luna`。

## 尚未驗證（需要在 herdr pane 內互動執行）

- claude 與 agy 的 statusline 是否提供 `rate_limits`。啟動時加 `WEALTHLINE_STATUSLINE_DEBUG=1`，原始輸入會寫到 `.agents/state/quota-<平台>-raw.json`。
- agy 的 statusline 目前沒有接到 `quota-statusline.mjs`，所以 agy 額度一律是未知，只參與交替。
- `--pane` 啟動與 herdr 內的自動改名。

## 已知限制

- claude 的唯讀 shell 指令（`head`、`git log` 等）在任何權限模式下都能執行，所以 tester 不只能跑 validate。`.env*` 另以 `Bash(*.env*)` 規則擋下。這是減速帶，不是沙箱。
- `git push` 的 deny 同時涵蓋 RTK 改寫後的 `rtk git push`，但 `git -C . push` 這類寫法仍繞得過。

- codex 的全域 skill 目錄 `~/.agents/skills/`（superpowers、herdr、find-skills、frontend-design）不是 plugin，無法逐次關閉；唯讀角色仍看得到這些 skill，只是 sandbox 讓它們改不了檔。
- codex 額度只看最新一天的 session 檔，且超過 10 分鐘就算未知；久未使用 codex 時會顯示 unknown。
