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
