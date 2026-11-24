import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export {
  DEFAULT_CAS_BASE_URL,
  DEFAULT_CAS_INDEX_URL,
  computeSha256,
  detectHostTarget,
  fetchCasIndex,
  hydrateShard,
  hydrateSkiaShards,
  resolveShard,
  resolveSkiaPlan,
} from './hydrate.mts';

export type {
  CasEntry,
  CasIndex,
  HydratedShardResult,
  ResolvedShard,
  ShardStatus,
  SkiaCasPlan,
  SkiaTarget,
} from './hydrate.mts';

export {
  renderSkiaFrameToAnsiHalfBlocks,
  renderSkiaFrameToKittyProtocol,
  type SkiaRgbaFrame,
} from './kitty-ascii-sink.mts';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export const SKIA_CAS_GN_PATH = join(MODULE_DIR, '..', 'config', 'skia-cas.gn');

export async function loadSkiaGnArgs(
  gnPath: string = SKIA_CAS_GN_PATH,
): Promise<Record<string, string | boolean>> {
  const raw = await readFile(gnPath, 'utf8');
  const args: Record<string, string | boolean> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    if (rawValue === 'true') {
      args[key] = true;
    } else if (rawValue === 'false') {
      args[key] = false;
    } else {
      args[key] = rawValue.replace(/^"(.*)"$/, '$1');
    }
  }
  return args;
}
