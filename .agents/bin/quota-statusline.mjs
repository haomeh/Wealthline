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
