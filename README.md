# `@awesome-os/skia`

Standalone **Skia 2D/GPU graphics shard** (BSD-3-Clause) wired to the Awesome-OS [`b8g-ghost` `cas-v1`](https://github.com/awesome-os/b8g-ghost/releases/tag/cas-v1) content-addressed artifact store for **Sectium Display**, **Blink**, and **libelectron**.

## Quick Install & Usage

### Install via `pnpm` (or release tarball)

```powershell
pnpm add github:awesome-os/skia
```

Or download the latest SHA-256 verified archive from [`Releases`](https://github.com/awesome-os/skia/releases/latest).

### Usage & Verification

```ts
import { fetchCasIndex, resolveSkiaPlan, hydrateSkiaShards } from '@awesome-os/skia';

const plan = resolveSkiaPlan(await fetchCasIndex(), 'linux-x64');
console.log(plan.prerequisitesReady, plan.shards.libskia.status);
```

```powershell
# Verify locally (Node.js 22+)
node --test
```

## Architecture

Instead of bundling or recompiling vendored C/C++ third-party dependencies inside every Chromium/Electron/Sectium build, `@awesome-os/skia` splits Skia into a standalone shared component (`libskia`) backed by immutable SHA-256 shards in `awesome-os/b8g-ghost@cas-v1`:

| Shard | Source in `cas-v1` | Role |
| :--- | :--- | :--- |
| `libwebp` | `libwebp-<target>.{so,dll,dylib,wasm}` + `libwebp-include-*.tar.gz` | WebP image codec (`skia_use_system_libwebp = true`) |
| `libexpat` | `libexpat-<target>.{so,dll,dylib,wasm}` + `expat-include-*.tar.gz` | XML / SVG parser (`skia_use_system_expat = true`) |
| `ghost-llvm` | `ghost-llvm-*-{linux-x64,win64}.tar.zst` | Hermetic LLVM/Clang toolchain |
| `libskia` | `libskia-<target>.{so,dll,dylib,wasm}` | Standalone Skia 2D + Dawn GPU component (`status: 'pending'` until published) |

## GN Configuration

Standalone component build flags live in [`config/skia-cas.gn`](config/skia-cas.gn):

- `is_component_build = true`
- `is_official_build = true`
- `skia_enable_tools = false`
- `skia_use_system_expat = true`
- `skia_use_system_libwebp = true`
- `skia_enable_gpu = true`
- `skia_use_dawn = true`

## Usage

Runs directly on Node.js 22.18+ / 24+ with erasable TypeScript (zero build step):

```ts
import { fetchCasIndex, resolveSkiaPlan, hydrateSkiaShards } from '@awesome-os/skia';

const index = await fetchCasIndex();
const plan = resolveSkiaPlan(index, 'linux-x64');
console.log(plan.prerequisitesReady, plan.shards.libskia.status);

// Download & SHA-256 verify resolved shards into .b8g/skia-cas/<target>
const { results } = await hydrateSkiaShards({ target: 'linux-x64' });
console.log(results);
```

## Verification

```bash
node --test test/skia-cas.test.mts
```

## Workflows

- **`.github/workflows/ci.yml`** — Runs `node --test test/skia-cas.test.mts` on `ubuntu-latest` (Node 24) on every push and PR.
- **`.github/workflows/build-skia-cas.yml`** — Manual (`workflow_dispatch`) and weekly cron build that shallow-clones `google/skia`, builds `libskia.so` standalone via `gn` + `ninja` using `config/skia-cas.gn`, and uploads the SHA-256-verified artifact as a GitHub Release asset.

## Quick Install & Run (Windows / Linux / macOS)

```sh
# Install / hydrate from v11 CAS via holo-pm
holo-pm install repository://github.com/awesome-os/skia@main

# Or project & run directly via holo-project (0-byte hardlink)
holo-project "project://node/skia?from=repository://github.com/awesome-os/skia@main"
```
