// .agents/tests/agent.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

test('a --pane launch moves the pane to the repo root before herdr starts the agent', () => {
  const dir = state();
  const stub = mkdtempSync(join(tmpdir(), 'herdr-'));
  const log = join(stub, 'calls.log');
  writeFileSync(join(stub, 'herdr'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`);
  chmodSync(join(stub, 'herdr'), 0o755);
  const result = spawnSync(process.execPath, [bin('agent.mjs'), 'scout', 'claude', '--pane', 'w1:p9'],
    { encoding: 'utf8', env: { ...process.env, WEALTHLINE_AGENT_STATE: dir, PATH: `${stub}:${process.env.PATH}` } });
  assert.equal(result.status, 0, result.stderr);
  const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(calls[0], 'agent list');
  assert.equal(calls[1], `pane run w1:p9 cd '${root}'`);
  assert.match(calls[2], /^agent start scout-claude --kind claude --pane w1:p9 -- --setting-sources project /);
  assert.equal(calls.length, 3);
});
