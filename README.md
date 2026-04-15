# `@ramarivera/pi-ts-aperture-provider`

Shared Aperture provider runtime for Pi, published as both:

- a reusable TypeScript runtime library
- a Pi package with a bundled extension entrypoint in `extensions/index.ts`

## What lives here

- OpenAI-compatible `/models` gateway fetching
- models.dev catalog indexing and metadata enrichment
- provider-metadata-driven API resolution for Pi-style provider registrations
- config-driven overrides for provider aliases and individual models
- a packaged Pi extension that registers the provider directly inside Pi

## What does not live here

- hardcoded Aperture base URLs
- hardcoded provider names
- freeform heuristic capability inference from arbitrary model IDs

## Quick start

```bash
corepack yarn install
corepack yarn test
corepack yarn build
```

## Install as a Pi package

This package is now Pi-installable.

### Super simple setup

```bash
pi install npm:@ramarivera/pi-ts-aperture-provider@0.2.10
```

That is enough for Pi to load the extension. Pi discovers the packaged extension from `package.json -> pi.extensions` and loads `extensions/index.ts` automatically. If you do not provide your own config yet, the extension falls back to the bundled [`aperture-provider.config.example.json`](./aperture-provider.config.example.json) as a bootstrap default; most installs should still copy and customize that file.

If you prefer to do it manually instead of `pi install`, add this to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "npm:@ramarivera/pi-ts-aperture-provider@0.2.10"
  ]
}
```

## Configuration

Copy [`aperture-provider.config.example.json`](./aperture-provider.config.example.json) to one of these locations:

1. `PI_APERTURE_PROVIDER_CONFIG=/absolute/path/to/file.json`
2. `<project>/.pi/aperture-provider.config.json`
3. `~/.pi/agent/aperture-provider.config.json`
4. package-local `aperture-provider.config.json` next to the installed package (mainly useful for local development)
5. bundled package fallback `aperture-provider.config.example.json` next to the installed package (used automatically when no higher-priority config exists)

Example:

```bash
mkdir -p ~/.pi/agent
cp aperture-provider.config.example.json ~/.pi/agent/aperture-provider.config.json
```

Adjust at least:

- `providerName`
- `baseUrl`
- `apiKey`
- `modelsDev.providerAliases`
- `resolution.apiRules`
- `fallbackMetadata`
- `modelOverrides`

For Aperture, `baseUrl` should be the primary gateway root the extension uses everywhere. In Ramiro's current setup that is:

```json
{
  "baseUrl": "https://aperture-ai.xalda-procyon.ts.net/v1"
}
```

## Runtime behavior

This runtime resolves capabilities from multiple layers, in order:

- API type from Aperture provider metadata such as `/v1/messages`, `/v1/responses`, or `/v1/chat/completions`
- provider compatibility from `/aperture/config` when available
- pricing from the Aperture `/models` payload when present
- explicit `modelOverrides`
- reasoning, modalities, and token limits from models.dev
- `fallbackMetadata` from your JSON config
- bundled conservative fallback metadata for a small set of well-known model families when upstream metadata is missing

The fallback layer is intentionally conservative. It is not freeform model-name guessing. You can edit `fallbackMetadata` in your `aperture-provider.config.json` without republishing the library, and those entries override the bundled defaults.

If a model still lacks required capability metadata after those layers, the runtime warns and skips that model by default instead of crashing the entire sync. If you want strict behavior, set `resolution.skipModelsMissingCapabilities` to `false`.

Provider sync now uses a persisted registration cache. On startup it reads the cached provider registration first, returns quickly, and refreshes in the background when a cache entry exists. The default cache path is:

```text
~/.pi/agent/cache/aperture-provider/<provider-name>.json
```

If you want warning output while debugging cache refreshes or missing metadata, set `PI_APERTURE_DEBUG=1`. In normal mode those warnings are returned in runtime state but not dumped to the console.

Example config override:

```json
{
  "fallbackMetadata": {
    "k2.5": {
      "reasoning": true,
      "input": ["text"],
      "contextWindow": 262144,
      "maxTokens": 16384
    }
  }
}
```

## Using the library directly

If you want your own custom Pi extension or another integration layer, use the runtime exports directly:

```ts
import {
  createApertureProviderRuntime,
  loadResolvedApertureProviderConfig,
} from "@ramarivera/pi-ts-aperture-provider";

const { config } = await loadResolvedApertureProviderConfig();
const runtime = createApertureProviderRuntime(config, {
  cachePath: "/tmp/aperture-provider-cache.json", // optional
  debug: process.env.PI_APERTURE_DEBUG === "1", // optional
});
```

## Repository layout

- [`src/config.ts`](./src/config.ts)
- [`src/models-dev.ts`](./src/models-dev.ts)
- [`src/provider.ts`](./src/provider.ts)
- [`extensions/index.ts`](./extensions/index.ts)
- [`test/provider.test.ts`](./test/provider.test.ts)

## Publishing

The package is configured to publish to npm as `@ramarivera/pi-ts-aperture-provider`.

Before publishing:

```bash
corepack yarn install
corepack yarn run check
corepack yarn test
corepack yarn typecheck
corepack yarn build
npm whoami
```

Publish with:

```bash
npm publish
```

For prereleases (for example `0.2.5-beta.0`), publish with:

```bash
npm publish --tag beta
```
