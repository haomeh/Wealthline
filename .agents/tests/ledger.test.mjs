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
