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
