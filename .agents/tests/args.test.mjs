// .agents/tests/args.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildArgs, renderSettings, codexPlugins, pluginDirs } from '../lib/args.mjs';
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
    assert.equal(d.claudePlugins.length > 0, writer, role);
    assert.equal('enabledPlugins' in s, false, role);
    assert.equal(d.claudeTools.includes('Bash'), ['implementer', 'tester'].includes(role), role);
  }
  const tester = settings('tester').permissions;
  assert.equal(tester.defaultMode, 'dontAsk');
  assert.ok(tester.allow.includes('Bash(.agents/bin/validate:*)'));
  const implementer = settings('implementer');
  assert.ok(implementer.permissions.deny.includes('Bash(git push:*)'));
  // The RTK hook rewrites `git push` to `rtk git push` before permission matching.
  assert.ok(implementer.permissions.deny.includes('Bash(rtk git push:*)'));
  // Read() rules do not cover shell subprocesses; read-only commands run even in dontAsk mode.
  for (const role of ['implementer', 'tester']) assert.ok(settings(role).permissions.deny.includes('Bash(*.env*)'), role);
  assert.ok(implementer.permissions.deny.includes('Edit(./.agents/**)'));
  assert.match(JSON.stringify(implementer.hooks.PreToolUse), /rtk hook claude/);
});

test('buildArgs maps a role to native flags for each platform', () => {
  assert.deepEqual(buildArgs({ platform: 'claude', def: def('reviewer'), ...common }),
    ['--setting-sources', 'project', '--settings', '/s.json', '--strict-mcp-config',
      '--append-system-prompt-file', '/p.md', '--tools', 'Read,Grep,Glob', '--model', 'm']);
  assert.deepEqual(buildArgs({ platform: 'claude', def: def('reviewer'), ...common, claudePluginDirs: ['/a', '/b'] }).slice(7, 11),
    ['--plugin-dir', '/a', '--plugin-dir', '/b']);
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

test('pluginDirs resolves install paths and rejects a missing plugin', () => {
  const installed = JSON.stringify({ plugins: { 'a@m': [{ installPath: '/cache/a/1' }], 'b@m': [] } });
  assert.deepEqual(pluginDirs(installed, ['a@m']), ['/cache/a/1']);
  assert.deepEqual(pluginDirs(installed, []), []);
  assert.throws(() => pluginDirs(installed, ['b@m']), /Claude plugin not installed: b@m/);
  assert.throws(() => pluginDirs(installed, ['c@m']), /Claude plugin not installed: c@m/);
});
