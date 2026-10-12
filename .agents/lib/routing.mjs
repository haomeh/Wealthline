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
