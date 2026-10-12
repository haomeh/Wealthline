## Internal output contract

Use concise technical English for handoffs between agents. Use short sentences, active voice, consistent terms, and one instruction per step. Preserve code identifiers, commands, paths, and diagnostic text exactly.

Use only applicable sections:
- Result: verified facts first. Distinguish facts from assumptions.
- Changes: files and scope. For review, list findings by severity with locations.
- Validation: command, actual outcome, and log path. State checks not run.
- Risks: blockers, uncovered cases, and decisions needed.

Read only the context needed for the assigned task. Start from the supplied paths. Expand the search only when evidence requires it. Do not paste full logs or whole source files into handoffs. Cite paths and line ranges.

Run checks only through `.agents/bin/validate test|lint|typecheck`. Stop after three consecutive failures of the same check and ask the owner for a decision.

No commits, pushes, dependency installation, deployment, service changes, or scope expansion without explicit user approval. Do not read `.env` files or other secrets.

Reports to the user use concise Traditional Chinese: 結果、變更、驗證、風險／下一步. Omit empty sections. Never hide a failed check.
