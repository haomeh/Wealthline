// .agents/lib/ledger.mjs
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PLATFORMS } from './routing.mjs';

export async function readNext(dir) {
  const path = join(dir, 'turn.json');
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return PLATFORMS[0]; throw error; }
  let value;
  try { value = JSON.parse(text); } catch { /* reported below */ }
  if (value?.version !== 1 || !PLATFORMS.includes(value.next)) throw new Error(`Invalid routing ledger: ${path}. Inspect or remove it manually.`);
  return value.next;
}

/** Atomic across processes in this checkout. Stores only the next platform. */
export async function withTurn(dir, select, { waitMs = 5000 } = {}) {
  await mkdir(dir, { recursive: true });
  const lock = join(dir, 'turn.lock');
  const deadline = Date.now() + waitMs;
  while (true) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Routing lock busy or stale: ${lock}. Stop other launches, then remove it manually.`);
      await delay(20);
    }
  }
  try {
    const result = await select(await readNext(dir));
    if (result.consumeTurn) {
      const temp = join(dir, `turn.${process.pid}.tmp`);
      await writeFile(temp, JSON.stringify({ version: 1, next: result.nextPlatform }), { mode: 0o600 });
      await rename(temp, join(dir, 'turn.json'));
    }
    return result;
  } finally { await rm(lock, { recursive: true, force: true }); }
}
