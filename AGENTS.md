# Wealthline agent policy

Apply this policy only to this repository.

## Output and context

- Internal Agent instructions and handoffs use concise technical English inspired by ASD-STE100. This is not a claim of full standard compliance.
- Direct reports to the user use Traditional Chinese: 結果、變更、驗證、風險／下一步. Omit empty sections. Keep identifiers, paths, and necessary diagnostics unchanged.
- Managed Agents use internal English for owner handoffs. The Lead reports to the user in Traditional Chinese.
- Read only relevant files. Do not preload all docs, skills, or source files. Give Agents a short goal, scope, relevant paths, and acceptance criteria instead of the whole conversation.
- Use one Agent for a scoped task. Add independent QA/review when risk warrants it. Do not start every role for every task.

## Model routing

- New project sessions and configured Agent launches use `wealthline/auto`: conservative task tiers and alternating OpenAI/Claude dispatches. Existing saved sessions and explicit CLI model choices are not overridden.
- Use `[task:new]` for a distinct task and `[task:continue]` for a continuing task when needed. Do not create extra tasks to game platform alternation.
- Keep continuation/retry on the current physical model. No classifier calls or automatic tier escalation on failures. Live quota is currently unknown, not inferred from Codex credentials.
- Sol and Luna requests set `service_tier: fast`. This can increase consumption; it does not lower thinking. Server acceptance has not been verified.
- The user controls `/wealthline-route platform` and `/wealthline-route size`. Preserve manual choices. Do not claim equal token usage from alternating task counts.

## Work and verification

- DEV: `implementer`; QA: `tester`; independent review: `reviewer`; product decisions: `pm`; code mapping: `scout`.
- Prefer `wealthline_validate` for test/lint/typecheck. Do not bypass its three-failure stop through bash. Report actual outcomes and checks not run.
- Do not access secrets or modify `.git`/agent policy. Do not commit, push, install dependencies, deploy, or change services without explicit user approval.
- DEV shell and trusted project scripts are not sandboxed. Do not claim complete isolation or full end-to-end coverage.
