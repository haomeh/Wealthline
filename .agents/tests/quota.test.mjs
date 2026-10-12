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

test('an exhausted snapshot stays known until its reset time, however old', () => {
  const old = NOW - MAX_AGE_MS * 20;
  const exhausted = resetsAt => ({ observedAt: old, windows: [{ name: 'w', usedPercent: 100, ...(resetsAt ? { resetsAt } : {}) }] });
  assert.ok(normalize(exhausted(NOW + 1000), NOW));
  assert.equal(normalize(exhausted(NOW - 1000), NOW), undefined);
  assert.equal(normalize(exhausted(), NOW), undefined);
  assert.equal(normalize({ observedAt: old, windows: [{ name: 'w', usedPercent: 99, resetsAt: NOW + 1000 }] }, NOW), undefined);
});
