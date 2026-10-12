# Balanced Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. No subagent tools are available; self-review and runtime limits must be reported.

**Goal:** Route Wealthline tasks between local OpenAI and Claude chat models with conservative tiers and sticky follow-ups.

**Architecture:** Native virtual model adapter over tested pure selection rules and a project-local atomic turn ledger. No classifier calls or credential manipulation. Quota interface accepts only adapter-verified hints; runtime currently reports unknown.

**Tech Stack:** Pi ExtensionAPI, Node built-ins, Markdown agent overlays and project JSON settings.

---

## Task 1: Rules and atomic alternation

Files: `.pi/extensions/wealthline-router/routing.mjs`, `ledger.mjs`, `.pi/tests/routing.test.mjs`.

- [ ] Write tests first for small/standard/large, risk precedence, newest user text, brief continuing replies, verified quota hints, closed candidate models, sticky retry/direct, unknown provider errors.
- [ ] Run `node --test .pi/tests/routing.test.mjs`, verify RED.
- [ ] Implement pure tier/provider choice. Select only chat models from getAvailable; no arbitrary endpoint/model from user text.
- [ ] Test temporary project ledger with parallel reservations, abort, malformed state, symlink rejection, lock contention and no prompt/token persistence; implement after RED.

## Task 2: Pi adapter

Files: `.pi/extensions/wealthline-router/index.ts`, `.pi/tests/router-extension.test.mjs`.

- [ ] Installed Pi loader test: virtual registration, route with fake registry, sticky follow-ups, durable override restore, command validation and manual on.
- [ ] Verify RED then implement native registerVirtualModel plus `/wealthline-route`.
- [ ] Persist only metadata/manual configuration using branch custom entries. Never log raw messages or credentials.
- [ ] Restore overrides on session_start; do not force saved sessions or CLI selection to virtual model.

## Task 3: Project configuration

Files: `.pi/settings.json`, `.pi/agents/*.md`, `AGENTS.md`, `.pi/README.md`, existing definition tests.

- [ ] Add project defaults and enabledModels based on actual local whitelist plus virtual model; no global edits.
- [ ] Existing normal roles explicitly load router and pin wealthline/auto. Add minimal managed-lead model/extensions overlay, preserving coordination-only tool policy.
- [ ] Extend existing YAML/loader tests for guard + router, without weakening closed QA/PM policies.
- [ ] Document alternation vs token balance, no live quota adapter, runtime/Herdsman requirements, explicit new/continue markers and manual overrides.

## Task 4: Verify

- [ ] Run `node --test .pi/tests/*.test.mjs`.
- [ ] Inspect Pi registration and native virtual dispatch resolution with fake provider auth; do not issue model requests.
- [ ] Run fixed Wealthline test/lint/typecheck runner and git diff checks.
- [ ] Update design/verification notes with actual evidence and outstanding physical-provider/child-runtime checks. No automatic commits.

## Execution results

- [x] Task 1: pure routing and atomic ledger implemented. Separate-process alternation tested.
- [x] Task 2: native virtual hook, commands and branch restore implemented; fake-auth native ModelRuntime dispatch resolved successfully without network.
- [x] Task 3: project default/model scope and all child extension lists configured. Guard tool boundaries retained.
- [x] Task 4: 26 policy/router tests and 314 product tests passed; lint/typecheck/diff checks passed. Independent subagent review unavailable.
- [x] User addition: Sol/Luna Fast payload hook implemented and tested, leaving other models unchanged.
- [ ] Real provider/Fast request and Herdsman child runtime smoke tests. No requests made to consume subscriptions.
- [ ] Live account-verified quota adapter. Runtime quota remains explicitly unknown.

Evidence: `../specs/2026-10-11-balanced-model-routing-verification.md`. Original task checkboxes describe the planned procedure; this summary records execution.

User approved the two-provider design. Execute inline in the requested checkout so project config is available there. Scope addition: durable ledger is needed because per-session counters would start every new child on OpenAI; without coordination the stated distribution would not work across agents. Quota live integration is unavailable and must remain visibly unknown rather than fabricated.
