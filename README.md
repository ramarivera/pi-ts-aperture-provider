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
- heuristic capability inference from model IDs

## Quick start

```bash
corepack yarn install
corepack yarn test
corepack yarn build
```

## Install as a Pi package

This package is now Pi-installable.

```bash
pi install npm:@ramarivera/pi-ts-aperture-provider@0.2.0
```

Pi discovers the packaged extension from `package.json -> pi.extensions` and loads `extensions/index.ts` automatically.

## Configuration

Copy [`aperture-provider.config.example.json`](./aperture-provider.config.example.json) to one of these locations:

1. `PI_APERTURE_PROVIDER_CONFIG=/absolute/path/to/file.json`
2. `<project>/.pi/aperture-provider.config.json`
3. `~/.pi/agent/aperture-provider.config.json`
4. package-local `aperture-provider.config.json` next to the installed package (mainly useful for local development)

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
- `modelOverrides`

For Aperture, `baseUrl` should be the primary gateway root the extension uses everywhere. In Ramiro's current setup that is:

```json
{
  "baseUrl": "https://aperture-ai.xalda-procyon.ts.net/v1"
}
```

## Runtime behavior

This runtime does not guess capabilities from model IDs. It reads:

- API type from Aperture provider metadata such as `/v1/messages`, `/v1/responses`, or `/v1/chat/completions`
- provider compatibility from `/aperture/config` when available
- pricing from the Aperture `/models` payload when present
- reasoning, modalities, and token limits from models.dev or explicit `modelOverrides`

If models.dev does not know a model and you do not provide an override, registration fails with a concrete missing-field error instead of inventing values.

## Using the library directly

If you want your own custom Pi extension or another integration layer, use the runtime exports directly:

```ts
import {
  createApertureProviderRuntime,
  loadResolvedApertureProviderConfig,
} from "@ramarivera/pi-ts-aperture-provider";

const { config } = await loadResolvedApertureProviderConfig();
const runtime = createApertureProviderRuntime(config);
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
