#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { chooseRoute, PLATFORMS, TIERS } from '../lib/routing.mjs';
import { readQuota, remaining } from '../lib/quota.mjs';
import { readNext, withTurn } from '../lib/ledger.mjs';
import { buildArgs, renderSettings, codexPlugins, pluginDirs } from '../lib/args.mjs';

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
let claudePluginDirs = [];
if (route.platform === 'claude' && def.claudePlugins.length) {
  try { claudePluginDirs = pluginDirs(await readFile(join(homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8'), def.claudePlugins); }
  catch (error) { fail(error.message); }
}
const args = buildArgs({ platform: route.platform, def, model: route.model, settingsFile, promptFile, disabledCodexPlugins, claudePluginDirs });
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
  // Settings, deny rules, and the validate allow rule all resolve against the repo root.
  try { execFileSync('herdr', ['pane', 'run', pane, `cd '${ROOT}'`], { stdio: 'ignore' }); }
  catch { fail(`herdr pane run failed for pane ${pane}`); }
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
