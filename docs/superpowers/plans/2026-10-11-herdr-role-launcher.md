# Herdr Role Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command starts claude, codex, or agy with a role template (prompt, tools, skills, hooks, model tier), choosing the platform from remaining quota and an alternation ledger.

**Architecture:** Pure ESM modules under `.agents/lib/` (quota, routing, ledger, args) with no dependencies. `.agents/bin/agent.mjs` wires them: it reads role files, picks a route, renders per-role prompt and settings into `.agents/state/`, then either runs the CLI in the current pane or calls `herdr agent start` for another pane. Claude isolation uses native flags and native permission rules, not custom hooks.

**Tech Stack:** Node 22 ESM, `node:test`, POSIX sh. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-11-herdr-role-launcher-design.md`

## Global Constraints

- No commits, pushes, or dependency installs. `AGENTS.md` requires explicit user approval; every task ends at "tests pass", not at a commit.
- Do not modify or delete `.pi/`.
- Platforms and alternation order: `codex`, `claude`, `agy`.
- Tiers: `small`, `standard`, `large`. Models: large = `claude-opus-5-5` / `gpt-6-astra` / `gemini-3.1-pro-high`; standard = `claude-sonnet-5-5` / `gpt-5.6-sol` / `gemini-3.8-flash-high`; small = `claude-haiku-5-5` / `gpt-5.6-luna` / `gemini-3.8-flash-low`.
- Quota snapshot older than 10 minutes, malformed, or dated in the future is unknown. Unknown never blocks a platform.
- Tight threshold: remaining ≤ 15 %.
- No API calls and no credential-file reads for quota.
- No automatic tier downgrade. A manually chosen platform that is blocked is an error.
- Run all tests with: `node --test .agents/tests/*.test.mjs`

## Review Focus

1. A crashed launch leaves `state/turn.lock`: the next launch must fail within the wait limit with a message that names the lock path. Test in Task 3.
2. A corrupt or half-written `quota-<platform>.json`: routing must treat it as unknown, not crash. Test in Task 1.
3. The newest codex rollout file has a truncated first tail line or no `rate_limits`: result is unknown, not an exception. Test in Task 1.
4. Every platform exhausted: the error must name each platform, and the ledger must not advance. Tests in Tasks 2 and 3.
5. Unknown role, unknown platform, or a stray argument: exit code 1 with usage text, nothing launched. Test in Task 6.

## File Structure

| File | Responsibility |
| --- | --- |
| `.agents/lib/quota.mjs` | Parse `rate_limits`, validate snapshots, read all three platforms, write snapshots |
| `.agents/lib/routing.mjs` | Pure platform and model choice |
| `.agents/lib/ledger.mjs` | Locked read/advance of the alternation turn |
| `.agents/lib/args.mjs` | Role × platform → native CLI args |
| `.agents/bin/agent.mjs` | Entry point: parse args, route, render, launch, `status` |
| `.agents/bin/quota-statusline.mjs` | Statusline command that also writes a quota snapshot |
| `.agents/bin/validate` | `test` / `lint` / `typecheck` only |
| `.agents/roles/<role>/{prompt.md,role.json,claude.json}` | Role definitions |
| `.agents/shared/internal-style.md` | Output contract appended to every prompt |
| `.agents/tests/*.test.mjs` | Unit tests |
| `.agents/README.md` | Usage and limits |

---

### Task 1: Quota snapshots

**Files:**
- Create: `.agents/lib/quota.mjs`
- Test: `.agents/tests/quota.test.mjs`

**Interfaces:**
- Produces:
  - `MAX_AGE_MS: number` (600000)
  - `fromRateLimits(rateLimits: object, observedAt: number) → Snapshot | undefined`
  - `normalize(snapshot: any, now: number) → Snapshot | undefined`
  - `remaining(snapshot: Snapshot | undefined) → number | undefined`
  - `readCodex(sessionsDir: string) → Promise<Snapshot | undefined>`
  - `readQuota(stateDir: string, opts?: { now?: number, codexSessions?: string }) → Promise<{ codex, claude, agy }>` (each `Snapshot | undefined`)
  - `writeSnapshot(stateDir: string, platform: string, snapshot: object) → Promise<void>`
  - `Snapshot = { observedAt: number (ms), windows: [{ name: string, usedPercent: number, resetsAt?: number (ms) }] }`

- [ ] **Step 1: Write the failing test**

```js
// .agents/tests/quota.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fromRateLimits, normalize, remaining, readCodex, readQuota, writeSnapshot, MAX_AGE_MS } from '../lib/quota.mjs';

const NOW = 1_791_000_000_000;

test('fromRateLimits parses codex and claude shapes', () => {
  const codex = fromRateLimits({ limit_id: 'codex', primary: { used_percent: 22, window_minutes: 10080, resets_at: 1792297578 },
    secondary: null, credits: { has_credits: false }, plan_type: 'prolite' }, NOW);
  assert.deepEqual(codex, { observedAt: NOW, windows: [{ name: 'primary', usedPercent: 22, resetsAt: 1792297578000 }] });
  const claude = fromRateLimits({ five_hour: { used_percentage: 40 }, seven_day: { remaining_percentage: 10 } }, NOW);
  assert.deepEqual(claude.windows, [{ name: 'five_hour', usedPercent: 40 }, { name: 'seven_day', usedPercent: 90 }]);
  assert.equal(remaining(claude), 10);
});

test('fromRateLimits rejects input without a usable window', () => {
  assert.equal(fromRateLimits(undefined, NOW), undefined);
  assert.equal(fromRateLimits({ plan_type: 'x', primary: { used_percent: 140 } }, NOW), undefined);
});

test('normalize treats stale, future, and malformed snapshots as unknown', () => {
  const windows = [{ name: 'w', usedPercent: 5 }];
  assert.ok(normalize({ observedAt: NOW - 1000, windows }, NOW));
  assert.equal(normalize({ observedAt: NOW - MAX_AGE_MS - 1, windows }, NOW), undefined);
  assert.equal(normalize({ observedAt: NOW + 1, windows }, NOW), undefined);
  assert.equal(normalize({ observedAt: NOW, windows: [] }, NOW), undefined);
  assert.equal(normalize({ observedAt: NOW, windows: [{ usedPercent: 'x' }] }, NOW), undefined);
  assert.equal(remaining(undefined), undefined);
});

test('readCodex takes the last rate_limits of the newest rollout file', async () => {
  const sessions = await mkdtemp(join(tmpdir(), 'codex-'));
  const day = join(sessions, '2026', '10', '11');
  await mkdir(day, { recursive: true });
  const line = used => JSON.stringify({ type: 'event_msg', payload: { rate_limits: { primary: { used_percent: used, resets_at: 1792297578 } } } });
  await writeFile(join(day, 'old.jsonl'), `${line(90)}\n`);
  await utimes(join(day, 'old.jsonl'), 1000, 1000);
  await writeFile(join(day, 'new.jsonl'), `{"truncated\n${line(10)}\n${line(30)}\n{"type":"other"}\n`);
  const snapshot = await readCodex(sessions);
  assert.equal(snapshot.windows[0].usedPercent, 30);
});

test('readCodex returns undefined when nothing is readable', async () => {
  const sessions = await mkdtemp(join(tmpdir(), 'codex-'));
  assert.equal(await readCodex(sessions), undefined);
  assert.equal(await readCodex(join(sessions, 'missing')), undefined);
  const day = join(sessions, '2026', '10', '11');
  await mkdir(day, { recursive: true });
  await writeFile(join(day, 'a.jsonl'), '{"type":"other"}\n{"broken "rate_limits"\n');
  assert.equal(await readCodex(sessions), undefined);
});

test('readQuota tolerates corrupt snapshot files', async () => {
  const state = await mkdtemp(join(tmpdir(), 'state-'));
  const empty = await mkdtemp(join(tmpdir(), 'codex-'));
  await writeSnapshot(state, 'claude', { observedAt: NOW - 5, windows: [{ name: 'five_hour', usedPercent: 60 }] });
  await writeFile(join(state, 'quota-agy.json'), '{"observedAt": 17');
  const quota = await readQuota(state, { now: NOW, codexSessions: empty });
  assert.equal(remaining(quota.claude), 40);
  assert.equal(quota.agy, undefined);
  assert.equal(quota.codex, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .agents/tests/quota.test.mjs`
Expected: FAIL with `Cannot find module '.../.agents/lib/quota.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// .agents/lib/quota.mjs
import { readdir, readFile, stat, writeFile, rename, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const MAX_AGE_MS = 600000;
const pct = n => Number.isFinite(n) && n >= 0 && n <= 100;
// Epoch seconds, epoch milliseconds, or an ISO string.
const ms = t => typeof t === 'string' ? Date.parse(t) : Number.isFinite(t) ? (t < 1e12 ? t * 1000 : t) : undefined;

/** Accept any object whose values are windows carrying a percentage. Field names differ per CLI. */
export function fromRateLimits(rateLimits, observedAt) {
  if (!rateLimits || typeof rateLimits !== 'object') return undefined;
  const windows = [];
  for (const [name, w] of Object.entries(rateLimits)) {
    if (!w || typeof w !== 'object') continue;
    const usedPercent = w.used_percentage ?? w.used_percent ?? (pct(w.remaining_percentage) ? 100 - w.remaining_percentage : undefined);
    if (!pct(usedPercent)) continue;
    const resetsAt = ms(w.resets_at);
    windows.push({ name, usedPercent, ...(Number.isFinite(resetsAt) ? { resetsAt } : {}) });
  }
  return windows.length ? { observedAt, windows } : undefined;
}

export function normalize(snapshot, now) {
  if (!snapshot || !Number.isFinite(snapshot.observedAt) || snapshot.observedAt > now || now - snapshot.observedAt > MAX_AGE_MS) return undefined;
  if (!Array.isArray(snapshot.windows) || !snapshot.windows.length || !snapshot.windows.every(w => w && pct(w.usedPercent))) return undefined;
  return snapshot;
}

export const remaining = snapshot => snapshot ? Math.min(...snapshot.windows.map(w => 100 - w.usedPercent)) : undefined;

function findRateLimits(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.rate_limits && typeof value.rate_limits === 'object') return value.rate_limits;
  for (const child of Object.values(value)) { const found = findRateLimits(child); if (found) return found; }
  return undefined;
}
async function tail(path, bytes = 512 * 1024) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally { await handle.close(); }
}
const lastDir = async dir => (await readdir(dir)).filter(name => /^\d+$/.test(name)).sort().at(-1);

/** Codex writes rate_limits into session rollout files; the file mtime is the observation time. */
export async function readCodex(sessions) {
  try {
    // ponytail: newest YYYY/MM/DD only; a session that crosses midnight is seen as unknown until a new one starts.
    let dir = sessions;
    for (let depth = 0; depth < 3; depth++) { const name = await lastDir(dir); if (!name) return undefined; dir = join(dir, name); }
    const files = await Promise.all((await readdir(dir)).filter(name => name.endsWith('.jsonl'))
      .map(async name => ({ path: join(dir, name), mtime: (await stat(join(dir, name))).mtimeMs })));
    for (const file of files.sort((a, b) => b.mtime - a.mtime)) {
      const lines = (await tail(file.path)).split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"rate_limits"')) continue;
        try { const snapshot = fromRateLimits(findRateLimits(JSON.parse(lines[i])), file.mtime); if (snapshot) return snapshot; }
        catch { /* truncated or foreign line */ }
      }
    }
  } catch { /* unreadable sessions directory means unknown quota */ }
  return undefined;
}

export async function readQuota(stateDir, { now = Date.now(), codexSessions = join(homedir(), '.codex', 'sessions') } = {}) {
  const file = async platform => {
    try { return JSON.parse(await readFile(join(stateDir, `quota-${platform}.json`), 'utf8')); } catch { return undefined; }
  };
  return { codex: normalize(await readCodex(codexSessions), now), claude: normalize(await file('claude'), now), agy: normalize(await file('agy'), now) };
}

export async function writeSnapshot(stateDir, platform, snapshot) {
  await mkdir(stateDir, { recursive: true });
  const temp = join(stateDir, `quota-${platform}.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(temp, join(stateDir, `quota-${platform}.json`));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .agents/tests/quota.test.mjs`
Expected: 6 pass, 0 fail

---

### Task 2: Routing

**Files:**
- Create: `.agents/lib/routing.mjs`
- Test: `.agents/tests/routing.test.mjs`

**Interfaces:**
- Consumes: nothing imported; `quota` values are snapshots already normalized by `quota.mjs`.
- Produces:
  - `PLATFORMS: readonly ['codex','claude','agy']`, `TIERS: readonly ['small','standard','large']`, `MODELS[tier][platform]: string`
  - `chooseRoute({ role, tier, platform?, quota?, next?, implementerPlatforms?, now? }) → { platform, model, tier, reason, consumeTurn: boolean, nextPlatform }`; throws `Error` when no platform is eligible.

- [ ] **Step 1: Write the failing test**

```js
// .agents/tests/routing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRoute, MODELS } from '../lib/routing.mjs';

const NOW = 1_791_000_000_000;
const snap = (usedPercent, resetsAt) => ({ observedAt: NOW, windows: [{ name: 'w', usedPercent, ...(resetsAt ? { resetsAt } : {}) }] });
const route = options => chooseRoute({ role: 'scout', tier: 'small', now: NOW, ...options });

test('alternates from the ledger position and reports the next turn', () => {
  assert.deepEqual([route({}).platform, route({ next: 'claude' }).platform, route({ next: 'agy' }).platform], ['codex', 'claude', 'agy']);
  const result = route({ next: 'agy' });
  assert.equal(result.nextPlatform, 'codex');
  assert.equal(result.consumeTurn, true);
  assert.equal(result.model, MODELS.small.agy);
});

test('excludes an exhausted platform until its reset time', () => {
  assert.equal(route({ quota: { codex: snap(100, NOW + 1000) } }).platform, 'claude');
  assert.equal(route({ quota: { codex: snap(100) } }).platform, 'claude');
  assert.equal(route({ quota: { codex: snap(100, NOW - 1000) } }).platform, 'codex');
});

test('demotes a tight platform; unknown quota is not tight', () => {
  assert.equal(route({ quota: { codex: snap(85) } }).platform, 'claude');
  assert.equal(route({ quota: { codex: snap(84) } }).platform, 'codex');
  assert.equal(route({ quota: { codex: snap(90), claude: snap(95), agy: snap(99) } }).platform, 'codex');
});

test('reviewer avoids the implementer platform; other roles do not', () => {
  assert.equal(route({ role: 'reviewer', tier: 'large', implementerPlatforms: ['codex'] }).platform, 'claude');
  assert.equal(route({ role: 'tester', tier: 'standard', implementerPlatforms: ['codex'] }).platform, 'codex');
  assert.equal(route({ role: 'reviewer', tier: 'large', implementerPlatforms: ['codex', 'claude', 'agy'] }).platform, 'codex');
});

test('manual platform does not consume a turn and is never swapped', () => {
  const result = route({ platform: 'agy', quota: { agy: snap(95) } });
  assert.equal(result.platform, 'agy');
  assert.equal(result.consumeTurn, false);
  assert.throws(() => route({ platform: 'agy', quota: { agy: snap(100) } }), /agy quota exhausted/);
});

test('fails with every platform named when all are exhausted', () => {
  const quota = { codex: snap(100), claude: snap(100), agy: snap(100) };
  assert.throws(() => route({ quota }), /codex quota exhausted; claude quota exhausted; agy quota exhausted/);
});

test('rejects unknown tier and platform', () => {
  assert.throws(() => route({ tier: 'huge' }), /Unknown tier/);
  assert.throws(() => route({ platform: 'pi' }), /Unknown platform/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .agents/tests/routing.test.mjs`
Expected: FAIL with `Cannot find module '.../.agents/lib/routing.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// .agents/lib/routing.mjs
export const PLATFORMS = Object.freeze(['codex', 'claude', 'agy']);
export const TIERS = Object.freeze(['small', 'standard', 'large']);
export const MODELS = Object.freeze({
  small: Object.freeze({ codex: 'gpt-5.6-luna', claude: 'claude-haiku-5-5', agy: 'gemini-3.8-flash-low' }),
  standard: Object.freeze({ codex: 'gpt-5.6-sol', claude: 'claude-sonnet-5-5', agy: 'gemini-3.8-flash-high' }),
  large: Object.freeze({ codex: 'gpt-6-astra', claude: 'claude-opus-5-5', agy: 'gemini-3.1-pro-high' }),
});
export const TIGHT_PERCENT = 15;

/** Pure: no I/O. `quota` holds normalized snapshots; a missing entry means unknown. */
export function chooseRoute({ role, tier, platform, quota = {}, next = PLATFORMS[0], implementerPlatforms = [], now = Date.now() }) {
  if (!TIERS.includes(tier)) throw new Error(`Unknown tier: ${tier}`);
  if (platform !== undefined && !PLATFORMS.includes(platform)) throw new Error(`Unknown platform: ${platform}`);
  const start = Math.max(0, PLATFORMS.indexOf(next));
  const order = platform ? [platform] : PLATFORMS.map((_, i) => PLATFORMS[(start + i) % PLATFORMS.length]);
  // A window whose reset time has passed no longer counts; a missing reset time still counts.
  const live = p => quota[p]?.windows.filter(w => !(w.resetsAt <= now)) ?? [];
  const blocked = p => live(p).some(w => w.usedPercent >= 100);
  const tight = p => live(p).some(w => 100 - w.usedPercent <= TIGHT_PERCENT);
  const conflict = p => role === 'reviewer' && implementerPlatforms.includes(p);
  const eligible = order.filter(p => !blocked(p));
  if (!eligible.length) throw new Error(`No eligible platform: ${order.map(p => `${p} quota exhausted`).join('; ')}. No automatic tier or platform change.`);
  const selected = eligible.find(p => !tight(p) && !conflict(p)) ?? eligible[0];
  const skipped = order.slice(0, order.indexOf(selected))
    .map(p => `skipped ${p}: ${blocked(p) ? 'quota exhausted' : tight(p) ? 'quota tight' : 'implementer platform'}`);
  return { platform: selected, model: MODELS[tier][selected], tier, consumeTurn: !platform,
    reason: [platform ? 'manual platform' : 'alternation', ...skipped].join('; '),
    nextPlatform: PLATFORMS[(PLATFORMS.indexOf(selected) + 1) % PLATFORMS.length] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .agents/tests/routing.test.mjs`
Expected: 7 pass, 0 fail

---

### Task 3: Alternation ledger

**Files:**
- Create: `.agents/lib/ledger.mjs`
- Test: `.agents/tests/ledger.test.mjs`

**Interfaces:**
- Consumes: `PLATFORMS` from `routing.mjs`.
- Produces:
  - `readNext(stateDir: string) → Promise<string>`; `'codex'` when `turn.json` is absent; throws on a corrupt file.
  - `withTurn(stateDir, select: (next: string) => result, opts?: { waitMs?: number }) → Promise<result>`; writes `{ version: 1, next: result.nextPlatform }` only when `result.consumeTurn` is true.

- [ ] **Step 1: Write the failing test**

```js
// .agents/tests/ledger.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNext, withTurn } from '../lib/ledger.mjs';
import { chooseRoute } from '../lib/routing.mjs';

const state = () => mkdtemp(join(tmpdir(), 'ledger-'));
const select = next => chooseRoute({ role: 'scout', tier: 'small', next });

test('concurrent launches each get a distinct turn', async () => {
  const dir = await state();
  const results = await Promise.all(Array.from({ length: 6 }, () => withTurn(dir, select)));
  const count = platform => results.filter(result => result.platform === platform).length;
  assert.deepEqual([count('codex'), count('claude'), count('agy')], [2, 2, 2]);
  assert.equal(await readNext(dir), 'codex');
  assert.deepEqual((await readdir(dir)).sort(), ['turn.json']);
});

test('a manual choice or a failed selection does not advance the turn', async () => {
  const dir = await state();
  await withTurn(dir, next => chooseRoute({ role: 'scout', tier: 'small', platform: 'agy', next }));
  assert.equal(await readNext(dir), 'codex');
  await assert.rejects(withTurn(dir, () => { throw new Error('No eligible platform'); }), /No eligible platform/);
  assert.equal(await readNext(dir), 'codex');
  assert.deepEqual(await readdir(dir), []);
});

test('a stale lock fails within the wait limit and names the path', async () => {
  const dir = await state();
  await mkdir(join(dir, 'turn.lock'));
  await assert.rejects(withTurn(dir, select, { waitMs: 60 }), /turn\.lock/);
});

test('a corrupt ledger is an explicit error', async () => {
  const dir = await state();
  await writeFile(join(dir, 'turn.json'), '{"version":1,"next":"pi"}');
  await assert.rejects(readNext(dir), /Invalid routing ledger/);
  await assert.rejects(withTurn(dir, select), /Invalid routing ledger/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .agents/tests/ledger.test.mjs`
Expected: FAIL with `Cannot find module '.../.agents/lib/ledger.mjs'`

- [ ] **Step 3: Write the implementation**

```js
// .agents/lib/ledger.mjs
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PLATFORMS } from './routing.mjs';

export async function readNext(dir) {
  const path = join(dir, 'turn.json');
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return PLATFORMS[0]; throw error; }
  let value;
  try { value = JSON.parse(text); } catch { /* reported below */ }
  if (value?.version !== 1 || !PLATFORMS.includes(value.next)) throw new Error(`Invalid routing ledger: ${path}. Inspect or remove it manually.`);
  return value.next;
}

/** Atomic across processes in this checkout. Stores only the next platform. */
export async function withTurn(dir, select, { waitMs = 5000 } = {}) {
  await mkdir(dir, { recursive: true });
  const lock = join(dir, 'turn.lock');
  const deadline = Date.now() + waitMs;
  while (true) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Routing lock busy or stale: ${lock}. Stop other launches, then remove it manually.`);
      await delay(20);
    }
  }
  try {
    const result = await select(await readNext(dir));
    if (result.consumeTurn) {
      const temp = join(dir, `turn.${process.pid}.tmp`);
      await writeFile(temp, JSON.stringify({ version: 1, next: result.nextPlatform }), { mode: 0o600 });
      await rename(temp, join(dir, 'turn.json'));
    }
    return result;
  } finally { await rm(lock, { recursive: true, force: true }); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .agents/tests/ledger.test.mjs`
Expected: 4 pass, 0 fail

---

### Task 4: Validation command

**Files:**
- Create: `.agents/bin/validate` (mode 0755)
- Test: `.agents/tests/validate.test.mjs`

**Interfaces:**
- Produces: `.agents/bin/validate <test|lint|typecheck>`; exit 2 on any other argument list; otherwise the exit code of the check. Log written to `.agents/state/logs/`, newest 5 kept.

- [ ] **Step 1: Write the failing test**

```js
// .agents/tests/validate.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const validate = fileURLToPath(new URL('../bin/validate', import.meta.url));
const run = (...args) => spawnSync(validate, args, { encoding: 'utf8' });

test('validate rejects anything but one known check', () => {
  for (const args of [[], ['build'], ['test', '--watch'], ['lint; rm -rf x']]) {
    const result = run(...args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.match(result.stderr, /usage: validate test\|lint\|typecheck/);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .agents/tests/validate.test.mjs`
Expected: FAIL, `result.status` is `null` (ENOENT)

- [ ] **Step 3: Write the implementation**

```sh
#!/bin/sh
# Approved project checks only. Runs trusted project scripts; this is not a sandbox.
set -eu
usage() { echo "usage: validate test|lint|typecheck" >&2; exit 2; }
[ $# -eq 1 ] || usage
check=$1
case "$check" in
  test) set -- npm test ;;
  lint) set -- npm run lint ;;
  typecheck) set -- node node_modules/typescript/bin/tsc -b ;;
  *) usage ;;
esac
cd "$(dirname "$0")/../.."
logs=.agents/state/logs
mkdir -p "$logs"
log="$logs/$check-$(date +%Y%m%d-%H%M%S).log"
code=0
"$@" >"$log" 2>&1 || code=$?
tail -c 6000 "$log"
echo "Check: $check  Exit code: $code  Log: $log"
ls -t "$logs"/*.log | tail -n +6 | xargs rm -f
exit "$code"
```

Then: `chmod +x .agents/bin/validate`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .agents/tests/validate.test.mjs`
Expected: 1 pass, 0 fail

- [ ] **Step 5: Run one real check**

Run: `.agents/bin/validate lint`
Expected: lint output tail, a line `Check: lint  Exit code: 0  Log: .agents/state/logs/lint-….log`

---

### Task 5: Role definitions and native args

**Files:**
- Create: `.agents/lib/args.mjs`
- Create: `.agents/shared/internal-style.md`
- Create: `.agents/roles/{implementer,tester,reviewer,pm,scout}/{prompt.md,role.json,claude.json}`
- Test: `.agents/tests/args.test.mjs`

**Interfaces:**
- Produces:
  - `buildArgs({ platform, def, model, settingsFile, promptFile, disabledCodexPlugins? }) → string[]`
  - `renderSettings(template: string, root: string) → string` (replaces every `${ROOT}`)
  - `codexPlugins(configToml: string) → string[]`
  - `role.json` shape: `{ tier, claudeTools: string[], codexSandbox: 'read-only'|'workspace-write', codexPlugins: string[], agyMode: 'plan'|null, agySandbox: boolean }`

- [ ] **Step 1: Write the failing test**

```js
// .agents/tests/args.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildArgs, renderSettings, codexPlugins } from '../lib/args.mjs';
import { TIERS } from '../lib/routing.mjs';

const agents = fileURLToPath(new URL('..', import.meta.url));
const ROLES = ['implementer', 'tester', 'reviewer', 'pm', 'scout'];
const read = (role, file) => readFileSync(join(agents, 'roles', role, file), 'utf8');
const def = role => JSON.parse(read(role, 'role.json'));
const settings = role => JSON.parse(renderSettings(read(role, 'claude.json'), '/repo'));
const common = { model: 'm', settingsFile: '/s.json', promptFile: '/p.md' };

test('every role has a valid definition, prompt, and settings', () => {
  for (const role of ROLES) {
    const d = def(role);
    assert.ok(TIERS.includes(d.tier), role);
    assert.ok(['read-only', 'workspace-write'].includes(d.codexSandbox), role);
    assert.ok(Array.isArray(d.codexPlugins) && Array.isArray(d.claudeTools), role);
    assert.ok(read(role, 'prompt.md').trim().length > 80, role);
    const s = settings(role);
    assert.match(JSON.stringify(s.hooks.SessionStart), /herdr-agent-state\.sh/, role);
    assert.equal(s.statusLine.command, 'node "/repo/.agents/bin/quota-statusline.mjs" claude', role);
    for (const rule of ['Read(./.env)', 'Read(./.env.*)', 'Read(./.git/**)']) assert.ok(s.permissions.deny.includes(rule), `${role} ${rule}`);
    assert.doesNotMatch(read(role, 'claude.json'), /\/Users\//, role);
  }
  assert.match(readFileSync(join(agents, 'shared', 'internal-style.md'), 'utf8'), /Traditional Chinese/);
});

test('only the implementer can modify files or load plugins', () => {
  for (const role of ROLES) {
    const d = def(role), s = settings(role), writer = role === 'implementer';
    assert.equal(d.claudeTools.includes('Edit') || d.claudeTools.includes('Write'), writer, role);
    assert.equal(d.codexSandbox, writer ? 'workspace-write' : 'read-only', role);
    assert.equal(d.agyMode, writer ? null : 'plan', role);
    assert.equal(Object.keys(s.enabledPlugins).length > 0, writer, role);
    assert.equal(d.claudeTools.includes('Bash'), ['implementer', 'tester'].includes(role), role);
  }
  const tester = settings('tester').permissions;
  assert.equal(tester.defaultMode, 'dontAsk');
  assert.ok(tester.allow.includes('Bash(.agents/bin/validate:*)'));
  const implementer = settings('implementer');
  assert.ok(implementer.permissions.deny.includes('Bash(git push:*)'));
  assert.ok(implementer.permissions.deny.includes('Edit(./.agents/**)'));
  assert.match(JSON.stringify(implementer.hooks.PreToolUse), /rtk hook claude/);
});

test('buildArgs maps a role to native flags for each platform', () => {
  assert.deepEqual(buildArgs({ platform: 'claude', def: def('reviewer'), ...common }),
    ['--setting-sources', 'project', '--settings', '/s.json', '--strict-mcp-config',
      '--append-system-prompt-file', '/p.md', '--tools', 'Read,Grep,Glob', '--model', 'm']);
  assert.deepEqual(buildArgs({ platform: 'codex', def: def('reviewer'), ...common, disabledCodexPlugins: ['a@b'] }),
    ['-m', 'm', '-s', 'read-only', '-c', 'developer_instructions=Read /p.md first and follow it as your role for this session.',
      '-c', 'plugins.a@b.enabled=false']);
  assert.deepEqual(buildArgs({ platform: 'agy', def: def('reviewer'), ...common }),
    ['--model', 'm', '--mode', 'plan', '--sandbox', '--prompt-interactive',
      'Read /p.md first and follow it as your role for this session. Reply READY when done.']);
  assert.deepEqual(buildArgs({ platform: 'agy', def: def('implementer'), ...common }).slice(0, 3), ['--model', 'm', '--prompt-interactive']);
  assert.throws(() => buildArgs({ platform: 'pi', def: def('scout'), ...common }), /Unknown platform/);
});

test('codexPlugins lists plugin tables from config.toml', () => {
  assert.deepEqual(codexPlugins('model = "x"\n[plugins."a@b"]\nenabled = true\n[projects."/p"]\n[plugins."c@d"]\n'), ['a@b', 'c@d']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .agents/tests/args.test.mjs`
Expected: FAIL with `Cannot find module '.../.agents/lib/args.mjs'`

- [ ] **Step 3: Write `args.mjs`**

```js
// .agents/lib/args.mjs
// Codex and agy have no flag that appends a prompt file, so they get a one-line pointer to it.
const pointer = promptFile => `Read ${promptFile} first and follow it as your role for this session.`;

export function buildArgs({ platform, def, model, settingsFile, promptFile, disabledCodexPlugins = [] }) {
  if (platform === 'claude') return ['--setting-sources', 'project', '--settings', settingsFile, '--strict-mcp-config',
    '--append-system-prompt-file', promptFile, '--tools', def.claudeTools.join(','), '--model', model];
  if (platform === 'codex') return ['-m', model, '-s', def.codexSandbox, '-c', `developer_instructions=${pointer(promptFile)}`,
    ...disabledCodexPlugins.flatMap(name => ['-c', `plugins.${name}.enabled=false`])];
  if (platform === 'agy') return ['--model', model, ...(def.agyMode ? ['--mode', def.agyMode] : []), ...(def.agySandbox ? ['--sandbox'] : []),
    '--prompt-interactive', `${pointer(promptFile)} Reply READY when done.`];
  throw new Error(`Unknown platform: ${platform}`);
}

export const renderSettings = (template, root) => template.replaceAll('${ROOT}', root);
export const codexPlugins = configToml => [...configToml.matchAll(/^\[plugins\."([^"]+)"\]/gm)].map(match => match[1]);
```

- [ ] **Step 4: Write `shared/internal-style.md`**

```markdown
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
```

- [ ] **Step 5: Write the five `prompt.md` files**

`.agents/roles/implementer/prompt.md`:
```markdown
You are the Wealthline implementer. Implement only the approved behavior. Preserve financial precision, persistence compatibility, local processing, and sensitive-data safety. Read the relevant tests before editing. Verify with `.agents/bin/validate`. Keep shell work scoped to the task; your shell is not sandboxed.
```

`.agents/roles/tester/prompt.md`:
```markdown
You are the Wealthline QA agent. Verify acceptance criteria using independent evidence. Inspect the change and the affected tests. Check normal, error, empty-data, boundary, permission, and persistence cases. Do not modify source code or weaken acceptance criteria.

Run `.agents/bin/validate test`, `lint`, or `typecheck`; no other shell command is available to you. `test` prepares local OCR assets and `typecheck` writes build info. Stop when dependencies are missing; do not install them. Do not claim browser or end-to-end coverage from Node tests alone.

For each defect, report severity, file or flow, reproduction steps, expected result, actual result, and evidence. State untested areas.
```

`.agents/roles/reviewer/prompt.md`:
```markdown
You are the Wealthline reviewer. Review independently. Check acceptance criteria, financial calculations, persistence changes, privacy, error paths, and regression evidence. You cannot edit files or execute tests; state that limit and request QA evidence when needed. Do not accept an implementer's success claim without evidence.
```

`.agents/roles/pm/prompt.md`:
```markdown
You are the Wealthline product PM. Define the user problem, expected value, scope, non-goals, priority, dependencies, and measurable acceptance criteria. Identify unresolved product decisions and ask the owner instead of inventing them.

Assess acceptance from implementer, QA, and review evidence. Track failed or missing checks, known defects, release risks, and rollback needs. A summary is not proof. Do not edit files, execute commands, or deploy. Technical implementation decisions belong to the implementer.
```

`.agents/roles/scout/prompt.md`:
```markdown
You are the Wealthline scout. Locate code; do not change it. Start from explicit project paths and prefer scoped `src`, `tests`, `server`, or `worker` directories over root-wide scans. Return only the relevant paths, the flow between them, constraints, and evidence with line ranges.
```

- [ ] **Step 6: Write the five `role.json` files**

`implementer`:
```json
{ "tier": "large", "claudeTools": ["Read", "Edit", "Write", "Bash", "Grep", "Glob"], "codexSandbox": "workspace-write",
  "codexPlugins": ["superpowers@claude-plugins-official", "ponytail@ponytail"], "agyMode": null, "agySandbox": false }
```
`tester`:
```json
{ "tier": "standard", "claudeTools": ["Read", "Grep", "Glob", "Bash"], "codexSandbox": "read-only", "codexPlugins": [], "agyMode": "plan", "agySandbox": true }
```
`reviewer`:
```json
{ "tier": "large", "claudeTools": ["Read", "Grep", "Glob"], "codexSandbox": "read-only", "codexPlugins": [], "agyMode": "plan", "agySandbox": true }
```
`pm`:
```json
{ "tier": "standard", "claudeTools": ["Read", "Grep", "Glob"], "codexSandbox": "read-only", "codexPlugins": [], "agyMode": "plan", "agySandbox": true }
```
`scout`:
```json
{ "tier": "small", "claudeTools": ["Read", "Grep", "Glob"], "codexSandbox": "read-only", "codexPlugins": [], "agyMode": "plan", "agySandbox": true }
```

- [ ] **Step 7: Write the five `claude.json` templates**

`reviewer`, `pm`, `scout` (identical content, one file each so a role can diverge later):
```json
{
  "permissions": { "deny": ["Read(./.env)", "Read(./.env.*)", "Read(./.git/**)"] },
  "hooks": {
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash \"$HOME/.claude/hooks/herdr-agent-state.sh\" session", "timeout": 10 }] }]
  },
  "statusLine": { "type": "command", "command": "node \"${ROOT}/.agents/bin/quota-statusline.mjs\" claude" },
  "enabledPlugins": {}
}
```

`tester`:
```json
{
  "permissions": {
    "defaultMode": "dontAsk",
    "allow": ["Read", "Grep", "Glob", "Bash(.agents/bin/validate:*)"],
    "deny": ["Read(./.env)", "Read(./.env.*)", "Read(./.git/**)"]
  },
  "hooks": {
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash \"$HOME/.claude/hooks/herdr-agent-state.sh\" session", "timeout": 10 }] }]
  },
  "statusLine": { "type": "command", "command": "node \"${ROOT}/.agents/bin/quota-statusline.mjs\" claude" },
  "enabledPlugins": {}
}
```

`implementer`:
```json
{
  "permissions": { "deny": ["Read(./.env)", "Read(./.env.*)", "Read(./.git/**)", "Edit(./.agents/**)", "Bash(git push:*)"] },
  "hooks": {
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "bash \"$HOME/.claude/hooks/herdr-agent-state.sh\" session", "timeout": 10 }] }],
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "rtk hook claude" }] }]
  },
  "statusLine": { "type": "command", "command": "node \"${ROOT}/.agents/bin/quota-statusline.mjs\" claude" },
  "enabledPlugins": { "superpowers@claude-plugins-official": true, "ponytail@ponytail": true }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test .agents/tests/args.test.mjs`
Expected: 4 pass, 0 fail

---

### Task 6: Entry point, statusline, docs

**Files:**
- Create: `.agents/bin/agent.mjs` (mode 0755), `.agents/bin/quota-statusline.mjs` (mode 0755), `.agents/README.md`
- Modify: `.gitignore` (append `.agents/state/`)
- Modify: `AGENTS.md` (replace pi-specific sections; needs the user's go-ahead because it is agent policy)
- Test: `.agents/tests/agent.test.mjs`

**Interfaces:**
- Consumes: everything produced by Tasks 1, 2, 3, 5.
- Produces:
  - `agent.mjs <role> [codex|claude|agy] [--pane ID] [--tier T] [--dry-run]` and `agent.mjs status`
  - Env `WEALTHLINE_AGENT_STATE` overrides the state directory (tests only).
  - `--dry-run` prints one JSON object `{ name, platform, model, tier, reason, args }` and writes nothing.
  - `quota-statusline.mjs <claude|agy>` reads statusline JSON on stdin, writes `quota-<platform>.json`, prints one line. With `WEALTHLINE_STATUSLINE_DEBUG=1` it also writes the raw input to `quota-<platform>-raw.json`.

- [ ] **Step 1: Write the failing test**

```js
// .agents/tests/agent.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = name => fileURLToPath(new URL(`../bin/${name}`, import.meta.url));
const run = (script, args, state, input) => spawnSync(process.execPath, [bin(script), ...args],
  { encoding: 'utf8', input, env: { ...process.env, WEALTHLINE_AGENT_STATE: state, HERDR_ENV: '' } });
const state = () => mkdtempSync(join(tmpdir(), 'agent-'));

test('dry run prints the route and native args without touching state', () => {
  const dir = state();
  const result = run('agent.mjs', ['reviewer', 'claude', '--dry-run'], dir);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.name, 'reviewer-claude');
  assert.equal(plan.model, 'claude-opus-5-5');
  assert.deepEqual(plan.args.slice(-4), ['--tools', 'Read,Grep,Glob', '--model', 'claude-opus-5-5']);
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(JSON.parse(run('agent.mjs', ['scout', 'agy', '--tier', 'large', '--dry-run'], dir).stdout).model, 'gemini-3.1-pro-high');
});

test('bad input exits 1 and launches nothing', () => {
  const dir = state();
  for (const args of [[], ['wizard', '--dry-run'], ['scout', 'pi', '--dry-run'], ['scout', 'claude', 'extra', '--dry-run'],
    ['scout', '--tier', 'huge', '--dry-run'], ['scout', '--bogus']]) {
    const result = run('agent.mjs', args, dir);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.ok(result.stderr.length > 0, JSON.stringify(args));
  }
  assert.deepEqual(readdirSync(dir), []);
});

test('statusline writes a snapshot that status then reports', () => {
  const dir = state();
  const input = JSON.stringify({ model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 25 } } });
  const line = run('quota-statusline.mjs', ['claude'], dir, input);
  assert.equal(line.status, 0);
  assert.match(line.stdout, /Opus · five_hour 75%/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'quota-claude.json'), 'utf8')).windows[0].usedPercent, 25);
  const status = run('agent.mjs', ['status'], dir);
  assert.match(status.stdout, /claude: 75% left/);
  assert.match(status.stdout, /agy: unknown/);
  assert.match(status.stdout, /next: codex/);
});

test('statusline never fails on bad input', () => {
  const dir = state();
  for (const [args, input] of [[['claude'], 'not json'], [['claude'], '{}'], [['pi'], '{}']]) {
    assert.equal(run('quota-statusline.mjs', args, dir, input).status, 0);
  }
  assert.deepEqual(readdirSync(dir), []);
});

test('an exhausted manual platform is an error', () => {
  const dir = state();
  writeFileSync(join(dir, 'quota-claude.json'), JSON.stringify({ observedAt: Date.now(), windows: [{ name: 'five_hour', usedPercent: 100 }] }));
  const result = run('agent.mjs', ['scout', 'claude', '--dry-run'], dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /claude quota exhausted/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .agents/tests/agent.test.mjs`
Expected: FAIL, exit status 1 with `Cannot find module` for every case that expects 0

- [ ] **Step 3: Write `quota-statusline.mjs`**

```js
#!/usr/bin/env node
// Statusline command for role sessions. Side effect: records the quota the CLI reports.
import { fileURLToPath } from 'node:url';
import { fromRateLimits, writeSnapshot } from '../lib/quota.mjs';

const STATE = process.env.WEALTHLINE_AGENT_STATE ?? fileURLToPath(new URL('../state', import.meta.url));
const platform = process.argv[2];
try {
  if (!['claude', 'agy'].includes(platform)) throw new Error('unknown platform');
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const input = JSON.parse(text);
  if (process.env.WEALTHLINE_STATUSLINE_DEBUG) await writeSnapshot(STATE, `${platform}-raw`, input);
  const snapshot = fromRateLimits(input.rate_limits, Date.now());
  if (snapshot) await writeSnapshot(STATE, platform, snapshot);
  const windows = snapshot?.windows.map(w => `${w.name} ${Math.round(100 - w.usedPercent)}%`) ?? ['quota unknown'];
  console.log([input.model?.display_name, ...windows].filter(Boolean).join(' · '));
} catch { console.log(''); }
```

- [ ] **Step 4: Write `agent.mjs`**

```js
#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { chooseRoute, PLATFORMS, TIERS } from '../lib/routing.mjs';
import { readQuota, remaining } from '../lib/quota.mjs';
import { readNext, withTurn } from '../lib/ledger.mjs';
import { buildArgs, renderSettings, codexPlugins } from '../lib/args.mjs';

const AGENTS = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(AGENTS);
const STATE = process.env.WEALTHLINE_AGENT_STATE ?? join(AGENTS, 'state');
const USAGE = `usage: agent.mjs <role> [${PLATFORMS.join('|')}] [--pane ID] [--tier ${TIERS.join('|')}] [--dry-run]\n       agent.mjs status`;
const fail = message => { console.error(message); process.exit(1); };
const herdr = args => {
  try { return execFileSync('herdr', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
};

const argv = process.argv.slice(2);
const take = name => {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const [, value] = argv.splice(index, 2);
  return value ?? fail(USAGE);
};
const dryRun = argv.includes('--dry-run');
if (dryRun) argv.splice(argv.indexOf('--dry-run'), 1);
const tierFlag = take('--tier');
const pane = take('--pane');
const [role, platform, extra] = argv;
if (!role || extra || argv.some(arg => arg.startsWith('-'))) fail(USAGE);

const quota = await readQuota(STATE);

if (role === 'status') {
  if (platform) fail(USAGE);
  for (const p of PLATFORMS) {
    const q = quota[p];
    console.log(q ? `${p}: ${Math.round(remaining(q))}% left (${q.windows.map(w => `${w.name} ${Math.round(w.usedPercent)}% used`).join(', ')}; ${Math.round((Date.now() - q.observedAt) / 1000)}s ago)` : `${p}: unknown`);
  }
  try { console.log(`next: ${await readNext(STATE)}`); } catch (error) { fail(error.message); }
  process.exit(0);
}

let def, prompt, template, style;
try {
  const dir = join(AGENTS, 'roles', role);
  def = JSON.parse(await readFile(join(dir, 'role.json'), 'utf8'));
  prompt = await readFile(join(dir, 'prompt.md'), 'utf8');
  template = await readFile(join(dir, 'claude.json'), 'utf8');
  style = await readFile(join(AGENTS, 'shared', 'internal-style.md'), 'utf8');
} catch { fail(`Unknown or incomplete role: ${role}\n${USAGE}`); }
if (platform && !PLATFORMS.includes(platform)) fail(`Unknown platform: ${platform}\n${USAGE}`);
if (tierFlag && !TIERS.includes(tierFlag)) fail(`Unknown tier: ${tierFlag}\n${USAGE}`);

const live = herdr(['agent', 'list']);
const implementerPlatforms = PLATFORMS.filter(p => new RegExp(`\\bimplementer-${p}\\b`).test(live));
const decide = next => chooseRoute({ role, tier: tierFlag ?? def.tier, platform, quota, next, implementerPlatforms });
let route;
// Only a real automatic launch takes the lock and advances the turn.
try { route = platform || dryRun ? decide(await readNext(STATE)) : await withTurn(STATE, decide); }
catch (error) { fail(error.message); }

const promptFile = join(STATE, 'prompts', `${role}.md`);
const settingsFile = join(STATE, 'settings', `${role}.json`);
let disabledCodexPlugins = [];
if (route.platform === 'codex') {
  try { disabledCodexPlugins = codexPlugins(await readFile(join(homedir(), '.codex', 'config.toml'), 'utf8')).filter(name => !def.codexPlugins.includes(name)); }
  catch { /* no codex config: nothing to disable */ }
}
const args = buildArgs({ platform: route.platform, def, model: route.model, settingsFile, promptFile, disabledCodexPlugins });
let name = `${role}-${route.platform}`;
for (let n = 2; live.includes(`"${name}"`); n++) name = `${role}-${route.platform}-${n}`;

if (dryRun) {
  console.log(JSON.stringify({ name, platform: route.platform, model: route.model, tier: route.tier, reason: route.reason, args }, null, 2));
  process.exit(0);
}

await mkdir(dirname(promptFile), { recursive: true });
await mkdir(dirname(settingsFile), { recursive: true });
await writeFile(promptFile, `${prompt.trim()}\n\n${style}`);
await writeFile(settingsFile, renderSettings(template, ROOT));
console.error(`[agent] ${name} → ${route.model} (${route.tier}; ${route.reason})`);

if (pane) {
  // Another pane: Herdr starts and names the agent. The pane must be an idle shell.
  try { execFileSync('herdr', ['agent', 'start', name, '--kind', route.platform, '--pane', pane, '--', ...args], { stdio: 'inherit' }); }
  catch { fail(`herdr agent start failed for pane ${pane}`); }
} else {
  // This pane: run the CLI in the foreground. Herdr detects it; naming is best effort.
  const child = spawn(route.platform, args, { stdio: 'inherit', cwd: ROOT });
  child.on('error', () => fail(`${route.platform} CLI not found in PATH`));
  child.on('exit', code => process.exit(code ?? 1));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {});
  if (process.env.HERDR_ENV === '1' && process.env.HERDR_PANE_ID) {
    setTimeout(() => herdr(['agent', 'rename', process.env.HERDR_PANE_ID, name]), 5000).unref();
  }
}
```

Then: `chmod +x .agents/bin/agent.mjs .agents/bin/quota-statusline.mjs`

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test .agents/tests/agent.test.mjs`
Expected: 5 pass, 0 fail

- [ ] **Step 6: Append to `.gitignore`**

```gitignore

# Role launcher state: quota snapshots, rendered prompts/settings, validation logs
.agents/state/
```

- [ ] **Step 7: Write `.agents/README.md`**

```markdown
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
| tester | standard | 否 | 只有 `.agents/bin/validate` |
| reviewer | large | 否 | 否 |
| pm | standard | 否 | 否 |
| scout | small | 否 | 否 |

每個角色一個目錄：`prompt.md`（角色內文）、`role.json`（層級、工具、sandbox）、`claude.json`（該角色的 Claude hooks、權限、plugin、statusline）。改角色就改這三個檔。

## 路由

不指定平台時：排除額度用完的平台，把剩餘 15% 以下的排到最後，其餘按 codex → claude → agy 交替。reviewer 會避開正在跑 implementer 的平台。指定平台時不輪替，被額度擋下就報錯。路由只在啟動時決定一次。

額度來源：codex 讀 `~/.codex/sessions` 的 rollout 檔；claude 與 agy 由角色 session 的 statusline 寫入 `.agents/state/`。超過 10 分鐘的快照視為未知，未知的平台照常參與。

## 各平台的隔離程度

- claude：不載入全域設定、plugin、hook、MCP；工具白名單與權限規則由 CLI 強制。
- codex：sandbox 由 CLI 強制；全域 plugin 逐一關閉；角色內文以一行指示要求先讀 prompt 檔。hook 仍是全域的。
- agy：唯讀角色用 plan mode 加 sandbox；角色內文同樣以首則訊息指向 prompt 檔。沒有設定層的隔離。

這不是安全沙箱。implementer 的 shell 與專案腳本不受限制。

## 測試

    node --test .agents/tests/*.test.mjs

## 狀態檔

`.agents/state/` 不進版控。`turn.lock` 若因當機殘留，確認沒有其他啟動在進行後手動刪除。
```

- [ ] **Step 8: Update `AGENTS.md`** (confirm with the user first; it is agent policy)

Replace the `## Model routing` section and the three pi-specific bullets (`See .pi/README.md`, `Prefer wealthline_validate`, the `DEV: implementer; …` line) with:

```markdown
## Roles and routing

- Start agents with `.agents/bin/agent.mjs <role>`; see `.agents/README.md`. Roles: `implementer`, `tester`, `reviewer`, `pm`, `scout`.
- The launcher picks the platform from remaining quota and alternation. Do not start extra agents to steer the alternation.

## Work and verification

- Run checks only through `.agents/bin/validate test|lint|typecheck`. Stop after three consecutive failures of one check. Report actual outcomes and checks not run.
- Do not access secrets or modify `.git` or `.agents`. Do not commit, push, install dependencies, deploy, or change services without explicit user approval.
- The implementer shell and trusted project scripts are not sandboxed. Do not claim complete isolation or full end-to-end coverage.
```

- [ ] **Step 9: Run the whole suite**

Run: `node --test .agents/tests/*.test.mjs`
Expected: 27 pass, 0 fail

---

### Task 7: Verify the four open assumptions against the real CLIs

No new files unless an assumption fails. Record each outcome in `.agents/README.md` under a `## 已驗證` heading.

- [ ] **Step 1: Claude isolation and plugin loading** (spec assumption 1)

Run both from the repo root after one real launch has rendered the settings (or render by hand with `--dry-run` paths):
```sh
claude -p --setting-sources project --strict-mcp-config --settings .agents/state/settings/reviewer.json --tools Read,Grep,Glob "List every skill name and every tool name you have. Output names only."
claude -p --setting-sources project --strict-mcp-config --settings .agents/state/settings/implementer.json "List every skill name you have. Output names only."
```
Expected: the reviewer output has no `superpowers:` or `claude-mem:` skill and no `Edit`/`Write`/`Bash` tool; the implementer output includes `superpowers:` and `ponytail:` skills.
If the implementer has no plugin skills: add `--plugin-dir` entries for the two plugins' cache directories to the claude branch of `buildArgs`, driven by a new `claudePluginDirs` array in `role.json`, and update the args test.

- [ ] **Step 2: Codex plugin override syntax** (spec assumption 4)

```sh
codex exec -s read-only -c 'plugins.superpowers@claude-plugins-official.enabled=false' -c 'developer_instructions=Read .agents/roles/scout/prompt.md first and follow it as your role for this session.' "State your role in one line, then list your available skill names."
```
Expected: a scout role line and no `superpowers` skills.
If the override is rejected or ignored: try the quoted key form `plugins."superpowers@claude-plugins-official".enabled=false`; use whichever works in `buildArgs`. If neither works, drop plugin disabling for codex and say so in the README.

- [ ] **Step 3: Claude quota field** (spec assumption 2; needs an interactive session)

In a herdr pane: `WEALTHLINE_STATUSLINE_DEBUG=1 .agents/bin/agent.mjs scout claude`, send one prompt, then in another pane run `.agents/bin/agent.mjs status`.
Expected: `claude: N% left (…)`. If it stays `unknown`, inspect `.agents/state/quota-claude-raw.json` for the real field name and extend `fromRateLimits` with a test for that shape.

- [ ] **Step 4: Agy statusline** (spec assumption 3; needs an interactive session)

Find how agy is told to run `~/.antigravity/statusline.sh` (search `~/.gemini` and `~/.antigravity` for `statusline`). If agy supports a project-level statusline setting, point it at `node <root>/.agents/bin/quota-statusline.mjs agy` and repeat Step 3 for agy. If the setting is global only, do not edit it: leave agy quota as unknown and record that in the README.

- [ ] **Step 5: Herdr launch** (needs to run inside herdr)

```sh
.agents/bin/agent.mjs reviewer claude          # in a herdr pane
herdr agent list                               # from another pane, after ~6 s
```
Expected: an agent named `reviewer-claude` with a lifecycle state. Then split a pane and run `.agents/bin/agent.mjs scout --pane <new-pane-id>`; expected: `scout-<platform>` appears and `status` shows `next` advanced by one.
