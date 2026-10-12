// .agents/lib/args.mjs
// Codex and agy have no flag that appends a prompt file, so they get a one-line pointer to it.
const pointer = promptFile => `Read ${promptFile} first and follow it as your role for this session.`;

export function buildArgs({ platform, def, model, settingsFile, promptFile, disabledCodexPlugins = [], claudePluginDirs = [] }) {
  if (platform === 'claude') return ['--setting-sources', 'project', '--settings', settingsFile, '--strict-mcp-config',
    '--append-system-prompt-file', promptFile, ...claudePluginDirs.flatMap(dir => ['--plugin-dir', dir]),
    // --tools is variadic: keep another flag after it so it cannot swallow a later positional.
    '--tools', def.claudeTools.join(','), '--model', model];
  if (platform === 'codex') return ['-m', model, '-s', def.codexSandbox, '-c', `developer_instructions=${pointer(promptFile)}`,
    ...disabledCodexPlugins.flatMap(name => ['-c', `plugins.${name}.enabled=false`])];
  if (platform === 'agy') return ['--model', model, ...(def.agyMode ? ['--mode', def.agyMode] : []), ...(def.agySandbox ? ['--sandbox'] : []),
    '--prompt-interactive', `${pointer(promptFile)} Reply READY when done.`];
  throw new Error(`Unknown platform: ${platform}`);
}

export const renderSettings = (template, root) => template.replaceAll('${ROOT}', root);
export const codexPlugins = configToml => [...configToml.matchAll(/^\[plugins\."([^"]+)"\]/gm)].map(match => match[1]);

/** With user settings excluded, enabledPlugins does not load user-scope plugins; --plugin-dir does. */
export function pluginDirs(installedJson, names) {
  const plugins = JSON.parse(installedJson).plugins ?? {};
  return names.map(name => plugins[name]?.[0]?.installPath ?? (() => { throw new Error(`Claude plugin not installed: ${name}`); })());
}
