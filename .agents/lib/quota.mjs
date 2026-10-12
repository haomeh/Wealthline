// .agents/lib/quota.mjs
import { readdir, readFile, stat, writeFile, rename, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const MAX_AGE_MS = 600000;
const pct = n => Number.isFinite(n) && n >= 0 && n <= 100;
// Epoch seconds, epoch milliseconds, or an ISO string.
const ms = t => typeof t === 'string' ? Date.parse(t) : Number.isFinite(t) ? (t < 1e12 ? t * 1000 : t) : undefined;

/** Accept any object whose values are windows carrying a percentage. Field names differ per CLI. */
export function fromRateLimits(rateLimits, observedAt) {
  if (!rateLimits || typeof rateLimits !== 'object') return undefined;
  const windows = [];
  for (const [name, w] of Object.entries(rateLimits)) {
    if (!w || typeof w !== 'object') continue;
    const usedPercent = w.used_percentage ?? w.used_percent ?? (pct(w.remaining_percentage) ? 100 - w.remaining_percentage : undefined);
    if (!pct(usedPercent)) continue;
    const resetsAt = ms(w.resets_at);
    windows.push({ name, usedPercent, ...(Number.isFinite(resetsAt) ? { resetsAt } : {}) });
  }
  return windows.length ? { observedAt, windows } : undefined;
}

export function normalize(snapshot, now) {
  if (!snapshot || !Number.isFinite(snapshot.observedAt) || snapshot.observedAt > now) return undefined;
  if (!Array.isArray(snapshot.windows) || !snapshot.windows.length || !snapshot.windows.every(w => w && pct(w.usedPercent))) return undefined;
  // An exhausted platform stops producing snapshots; keep the last one until its reset time.
  const exhausted = snapshot.windows.some(w => w.usedPercent >= 100 && w.resetsAt > now);
  return exhausted || now - snapshot.observedAt <= MAX_AGE_MS ? snapshot : undefined;
}

export const remaining = snapshot => snapshot ? Math.min(...snapshot.windows.map(w => 100 - w.usedPercent)) : undefined;

function findRateLimits(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.rate_limits && typeof value.rate_limits === 'object') return value.rate_limits;
  for (const child of Object.values(value)) { const found = findRateLimits(child); if (found) return found; }
  return undefined;
}
async function tail(path, bytes = 512 * 1024) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally { await handle.close(); }
}
const lastDir = async dir => (await readdir(dir)).filter(name => /^\d+$/.test(name)).sort().at(-1);

/** Codex writes rate_limits into session rollout files; the file mtime is the observation time. */
export async function readCodex(sessions) {
  try {
    // ponytail: newest YYYY/MM/DD only; a session that crosses midnight is seen as unknown until a new one starts.
    let dir = sessions;
    for (let depth = 0; depth < 3; depth++) { const name = await lastDir(dir); if (!name) return undefined; dir = join(dir, name); }
    const files = await Promise.all((await readdir(dir)).filter(name => name.endsWith('.jsonl'))
      .map(async name => ({ path: join(dir, name), mtime: (await stat(join(dir, name))).mtimeMs })));
    for (const file of files.sort((a, b) => b.mtime - a.mtime)) {
      const lines = (await tail(file.path)).split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"rate_limits"')) continue;
        try { const snapshot = fromRateLimits(findRateLimits(JSON.parse(lines[i])), file.mtime); if (snapshot) return snapshot; }
        catch { /* truncated or foreign line */ }
      }
    }
  } catch { /* unreadable sessions directory means unknown quota */ }
  return undefined;
}

export async function readQuota(stateDir, { now = Date.now(), codexSessions = join(homedir(), '.codex', 'sessions') } = {}) {
  const file = async platform => {
    try { return JSON.parse(await readFile(join(stateDir, `quota-${platform}.json`), 'utf8')); } catch { return undefined; }
  };
  return { codex: normalize(await readCodex(codexSessions), now), claude: normalize(await file('claude'), now), agy: normalize(await file('agy'), now) };
}

export async function writeSnapshot(stateDir, platform, snapshot) {
  await mkdir(stateDir, { recursive: true });
  const temp = join(stateDir, `quota-${platform}.${process.pid}.tmp`);
  await writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 });
  await rename(temp, join(stateDir, `quota-${platform}.json`));
}
