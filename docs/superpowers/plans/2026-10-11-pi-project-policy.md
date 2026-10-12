# Wealthline Pi Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Configure project-only DEV, QA, PM and review roles with guarded filesystem tools and bounded fixed-command validation.

**Architecture:** Thin Pi TypeScript adapter over independently tested Node policy and validation modules. Trusted project discovery loads the adapter; child definitions explicitly load it. No global changes, product changes, dependencies or Git commits.

**Tech Stack:** Node built-ins, Pi ExtensionAPI/TypeBox, installed Herdsman Markdown definition engine.

---

## Task 1: Path policy and failure budget

Files: `.pi/tests/policy.test.mjs`, `.pi/extensions/wealthline-policy/policy.mjs`.

- [ ] Write Node tests using temporary roots and fake secrets: env/example, traversal, symlink aliases, missing write paths, protected git/policy files, unsafe recursive search, three failures/success/reset.
- [ ] Run `node --test .pi/tests/policy.test.mjs`; verify missing implementation fails.
- [ ] Implement canonical path validation and explicit tool operation classification. Reject uncontrolled recursive find/grep rather than silently leaking protected paths. Permit scoped safe source searches; document limitations.
- [ ] Re-run tests and inspect failures before moving on.

## Task 2: Fixed validation runner

Files: `.pi/tests/validation.test.mjs`, `.pi/extensions/wealthline-policy/validation.mjs`.

- [ ] Test fixed enum commands/no shell, bounded head+tail logs and summaries, cancellation/timeout, serialization, three failures and manual reset, missing dependencies.
- [ ] Verify RED with `node --test .pi/tests/validation.test.mjs`.
- [ ] Implement runner using spawn with fixed argv/root, process-group cancellation on POSIX, finite timeout, ignored capped logs, in-memory per-check failure counts. Use injected command map only in tests; production enum maps are closed.
- [ ] Verify GREEN. Inspect TypeScript configs to identify typecheck artifacts.

## Task 3: Pi adapter and roles

Files: `.pi/extensions/wealthline-policy/index.ts`, `.pi/agents/{implementer,reviewer,scout,tester,pm}.md`, `.pi/tests/extension.test.mjs`.

- [ ] Test adapter registration, tool_call blocking, fixed custom tool arguments, session shutdown cleanup and reset command with a fake Pi API; load through installed Pi loader.
- [ ] Verify missing adapter RED, then implement.
- [ ] Register `wealthline_validate` with TypeBox enum, model result bounded summary, private details without secrets. Treat failures as `isError: true`.
- [ ] Register `/wealthline-validation-reset` for human reset, not as a model tool.
- [ ] Create minimal append overlays; closed QA/PM tool lists; disable skills; no QA/PM delegation; explicitly load project guard in all children.
- [ ] Resolve extension resource relative cwd using installed Pi resolver. Validate definitions using installed Herdsman engine if accessible; otherwise state manual roster verification requirement.

## Task 4: Documentation and verification

Files: `.pi/README.md`, `.gitignore`, design doc status.

- [ ] Document startup/trust/role selection, known DEV shell escape boundary, local script trust, context strategy, three-failure reset and rollback.
- [ ] Ignore `.pi/artifacts/` without changing existing ignore rules.
- [ ] Run `node --test .pi/tests/*.test.mjs`.
- [ ] Run fixed test/lint/typecheck through runner; report preexisting failures without unrelated fixes.
- [ ] Check actual Pi extension load and effective definitions without model requests or real secrets.
- [ ] Inspect `git diff --check`, status and global settings invariance. Do not claim child runtime activation without actual runtime evidence.

## Execution results

- [x] Task 1 implemented and tested with temporary fake-secret fixtures.
- [x] Task 2 implemented; fixed command runner, bounded logs, serialization, retry budget, cancellation and artifact symlink regression tested.
- [x] Task 3 implemented; installed Pi loader validates adapter and relative child extension paths; role YAML and closed QA/PM tools checked. Added generalist/researcher overlays and the approved internal-English/user-Chinese style.
- [x] Task 4 documentation, ignore rules and verification completed. Final policy tests: 12 passed. Product tests: 314 passed. Lint/typecheck: exit 0.
- [ ] Manual effective roster and actual child assignment smoke test in an active trusted Herdsman runtime. Current shell is unmanaged; no delegation tools are available. Static Pi parser checks are not Herdsman effective roster validation.

Detailed evidence and limits: `../specs/2026-10-11-pi-policy-verification.md`.

The task-level checkboxes above describe the original procedure; this section records actual execution and the remaining runtime check. No Git commits or global edits were made.

## Review and execution

User approved the spec and requested execution in this session. No delegation tools are available, so independent subagent review is unavailable; perform explicit self-review of safety boundaries and report this limitation. Keep changes in the requested checkout so project-local policy is available there. No automatic commits. Tasks execute sequentially with checkpoints in commentary.
