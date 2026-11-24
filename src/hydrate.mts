import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEFAULT_CAS_INDEX_URL =
  'https://raw.githubusercontent.com/awesome-os/b8g-ghost/main/manifests/index.json';
export const DEFAULT_CAS_BASE_URL =
  'https://github.com/awesome-os/b8g-ghost/releases/download/cas-v1';

export type SkiaTarget =
  | 'linux-x64'
  | 'linux-arm64'
  | 'macos-arm64'
  | 'win64'
  | 'wasm32-wasi';

export interface CasEntry {
  filename: string;
  sha256: string;
  bytes: number;
  category: string;
  download_url: string;
}

export interface CasIndex {
  schema: string;
  cas_base_url: string;
  baseline_tag?: string;
  updated_at?: string;
  total_entries?: number;
  entries: Record<string, CasEntry>;
}

export type ShardStatus = 'resolved' | 'pending';

export interface ResolvedShard {
  name: 'libwebp' | 'libexpat' | 'ghost-llvm' | 'libskia';
  target: SkiaTarget;
  status: ShardStatus;
  expectedFilename: string;
  entry: CasEntry | null;
  headersEntry: CasEntry | null;
  reason?: string;
}

export interface SkiaCasPlan {
  schema: string;
  casBaseUrl: string;
  target: SkiaTarget;
  prerequisitesReady: boolean;
  skiaReady: boolean;
  shards: {
    libwebp: ResolvedShard;
    libexpat: ResolvedShard;
    libskia: ResolvedShard;
    ghostLlvm: ResolvedShard;
  };
}

export interface HydratedShardResult {
  name: ResolvedShard['name'];
  status: ShardStatus;
  localPath: string | null;
  sha256: string | null;
  bytes: number;
  cached: boolean;
}

const TARGET_EXTENSIONS: Record<SkiaTarget, string> = {
  'linux-x64': '.so',
  'linux-arm64': '.so',
  'macos-arm64': '.dylib',
  win64: '.dll',
  'wasm32-wasi': '.wasm',
};

export function detectHostTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): SkiaTarget {
  if (platform === 'win32') return 'win64';
  if (platform === 'darwin') return 'macos-arm64';
  if (arch === 'arm64') return 'linux-arm64';
  return 'linux-x64';
}

export async function fetchCasIndex(
  indexUrl: string = DEFAULT_CAS_INDEX_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<CasIndex> {
  const response = await fetchImpl(indexUrl, {
    headers: { 'User-Agent': '@awesome-os/skia' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch cas-v1 index (${response.status}): ${indexUrl}`);
  }
  const data = (await response.json()) as CasIndex;
  if (!data || typeof data !== 'object' || !data.entries || typeof data.entries !== 'object') {
    throw new Error(`Invalid cas-v1 index payload from ${indexUrl}`);
  }
  return data;
}

function findHeaderBundle(index: CasIndex, prefix: string): CasEntry | null {
  for (const [key, entry] of Object.entries(index.entries)) {
    if (key.startsWith(prefix) && key.endsWith('.tar.gz')) {
      return entry;
    }
  }
  return null;
}

function findGhostLlvmEntry(index: CasIndex, target: SkiaTarget): CasEntry | null {
  const suffix = target === 'win64' ? 'win64.tar.zst' : 'linux-x64.tar.zst';
  for (const [key, entry] of Object.entries(index.entries)) {
    if (key.startsWith('ghost-llvm-') && key.endsWith(suffix)) {
      return entry;
    }
  }
  return null;
}

export function resolveShard(
  index: CasIndex,
  name: ResolvedShard['name'],
  target: SkiaTarget = 'linux-x64',
): ResolvedShard {
  if (name === 'ghost-llvm') {
    const entry = findGhostLlvmEntry(index, target);
    const expectedFilename =
      target === 'win64' ? 'ghost-llvm-*-win64.tar.zst' : 'ghost-llvm-*-linux-x64.tar.zst';
    if (entry) {
      return {
        name,
        target,
        status: 'resolved',
        expectedFilename: entry.filename,
        entry,
        headersEntry: null,
      };
    }
    return {
      name,
      target,
      status: 'pending',
      expectedFilename,
      entry: null,
      headersEntry: null,
      reason: `Toolchain shard ${expectedFilename} not yet published in cas-v1`,
    };
  }

  const ext = TARGET_EXTENSIONS[target];
  const expectedFilename = `${name}-${target}${ext}`;
  const entry = index.entries[expectedFilename] ?? null;

  const headersPrefix =
    name === 'libwebp'
      ? 'libwebp-include-'
      : name === 'libexpat'
        ? 'expat-include-'
        : 'skia-include-';
  const headersEntry = findHeaderBundle(index, headersPrefix);

  if (entry) {
    return {
      name,
      target,
      status: 'resolved',
      expectedFilename,
      entry,
      headersEntry,
    };
  }

  return {
    name,
    target,
    status: 'pending',
    expectedFilename,
    entry: null,
    headersEntry,
    reason: `Shard ${expectedFilename} not yet published in awesome-os/b8g-ghost@cas-v1`,
  };
}

export function resolveSkiaPlan(
  index: CasIndex,
  target: SkiaTarget = 'linux-x64',
): SkiaCasPlan {
  const libwebp = resolveShard(index, 'libwebp', target);
  const libexpat = resolveShard(index, 'libexpat', target);
  const libskia = resolveShard(index, 'libskia', target);
  const ghostLlvm = resolveShard(index, 'ghost-llvm', target);

  return {
    schema: index.schema,
    casBaseUrl: index.cas_base_url || DEFAULT_CAS_BASE_URL,
    target,
    prerequisitesReady: libwebp.status === 'resolved' && libexpat.status === 'resolved',
    skiaReady: libskia.status === 'resolved',
    shards: {
      libwebp,
      libexpat,
      libskia,
      ghostLlvm,
    },
  };
}

export function computeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function hydrateShard(
  shard: ResolvedShard,
  cacheDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HydratedShardResult> {
  if (shard.status !== 'resolved' || !shard.entry) {
    return {
      name: shard.name,
      status: 'pending',
      localPath: null,
      sha256: null,
      bytes: 0,
      cached: false,
    };
  }

  const destPath = join(cacheDir, shard.entry.filename);
  await mkdir(dirname(destPath), { recursive: true });

  try {
    const existing = await readFile(destPath);
    if (computeSha256(existing) === shard.entry.sha256) {
      return {
        name: shard.name,
        status: 'resolved',
        localPath: destPath,
        sha256: shard.entry.sha256,
        bytes: existing.byteLength,
        cached: true,
      };
    }
  } catch {
    // Cache miss; proceed with download.
  }

  const response = await fetchImpl(shard.entry.download_url, {
    headers: { 'User-Agent': '@awesome-os/skia' },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download ${shard.entry.filename} (${response.status}): ${shard.entry.download_url}`,
    );
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  const actualSha = computeSha256(buffer);
  if (actualSha !== shard.entry.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${shard.entry.filename}: expected ${shard.entry.sha256}, got ${actualSha}`,
    );
  }

  const tmpPath = `${destPath}.${process.pid}.tmp`;
  await writeFile(tmpPath, buffer);
  await rename(tmpPath, destPath);

  return {
    name: shard.name,
    status: 'resolved',
    localPath: destPath,
    sha256: actualSha,
    bytes: buffer.byteLength,
    cached: false,
  };
}

export async function hydrateSkiaShards(options?: {
  target?: SkiaTarget;
  cacheDir?: string;
  indexUrl?: string;
  includeToolchain?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ plan: SkiaCasPlan; results: HydratedShardResult[] }> {
  const target = options?.target ?? detectHostTarget();
  const cacheDir = options?.cacheDir ?? join(process.cwd(), '.b8g', 'skia-cas', target);
  const fetchImpl = options?.fetchImpl ?? fetch;
  const index = await fetchCasIndex(options?.indexUrl ?? DEFAULT_CAS_INDEX_URL, fetchImpl);
  const plan = resolveSkiaPlan(index, target);

  const selected: ResolvedShard[] = [
    plan.shards.libwebp,
    plan.shards.libexpat,
    plan.shards.libskia,
  ];
  if (options?.includeToolchain) {
    selected.push(plan.shards.ghostLlvm);
  }

  const results = await Promise.all(
    selected.map((shard) => hydrateShard(shard, cacheDir, fetchImpl)),
  );
  return { plan, results };
}
