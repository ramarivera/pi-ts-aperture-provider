# `@ramarivera/pi-ts-aperture-provider`

Reusable aperture-provider logic extracted from a Pi extension so different users can share the same codebase while keeping instance-specific details in config.

## What lives here

- OpenAI-compatible `/models` gateway fetching
- models.dev catalog indexing and metadata enrichment
- provider-metadata-driven API resolution for Pi-style provider registrations
- Config-driven overrides for provider aliases and individual models

## What does not live here

- Hardcoded Aperture base URLs
- Hardcoded provider names
- Canonical Pi extension wiring inside `~/.pi/...`

## Quick start

```bash
corepack yarn install
corepack yarn test
corepack yarn build
```

Copy [`aperture-provider.config.example.json`](/Users/ramarivera/dev/pi-ts-aperture-provider/aperture-provider.config.example.json) to your own config file and adjust:

- `providerName`
- `baseUrl`
- `apiKey`
- `modelsDev.providerAliases`
- `resolution.apiRules`
- `modelOverrides`

For Aperture, `baseUrl` should be the primary gateway root the extension uses everywhere, either via the fully qualified tailnet hostname or the MagicDNS name your setup exposes. In your current setup that means `https://aperture-ai.xalda-procyon.ts.net/v1`, and the models fetch resolves from that via `modelsPath`.

This runtime no longer guesses capabilities from model IDs. It reads:

- API type from Aperture provider metadata such as `/v1/messages`, `/v1/responses`, or `/v1/chat/completions`
- pricing from the Aperture `/models` payload when present
- reasoning, modalities, and token limits from models.dev or explicit `modelOverrides`

If models.dev does not know a model and you do not provide an override, registration fails with a concrete missing-field error instead of inventing values.

## Core usage

```ts
import {
  createApertureProviderRuntime,
  loadApertureProviderConfig,
} from "@ramarivera/pi-ts-aperture-provider";

const config = await loadApertureProviderConfig(new URL("./aperture-provider.config.json", import.meta.url));
const runtime = createApertureProviderRuntime(config);

await runtime.sync({
  registerProvider(name, registration) {
    console.log(name, registration.models.length);
  },
});
```

## Pi integration sketch

The repo intentionally keeps the core Pi-agnostic. A thin local Pi extension can wrap it later:

```ts
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  createApertureProviderRuntime,
  loadApertureProviderConfig,
} from "@ramarivera/pi-ts-aperture-provider";

const configPromise = loadApertureProviderConfig(new URL("./aperture-provider.config.json", import.meta.url));

export default function (pi: ExtensionAPI) {
  void configPromise.then((config) => {
    const runtime = createApertureProviderRuntime(config);
    return runtime.sync({
      registerProvider(name, registration) {
        pi.registerProvider(name, registration as never);
      },
    } as never);
  }).catch(() => {});
}
```

## Repository layout

- [`src/config.ts`](/Users/ramarivera/dev/pi-ts-aperture-provider/src/config.ts)
- [`src/models-dev.ts`](/Users/ramarivera/dev/pi-ts-aperture-provider/src/models-dev.ts)
- [`src/provider.ts`](/Users/ramarivera/dev/pi-ts-aperture-provider/src/provider.ts)
- [`test/provider.test.ts`](/Users/ramarivera/dev/pi-ts-aperture-provider/test/provider.test.ts)

## Publishing

The package is configured to publish to the npm registry as `@ramarivera/pi-ts-aperture-provider`.

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

`package.json` already sets:

- `name: "@ramarivera/pi-ts-aperture-provider"`
- `publishConfig.registry: "https://registry.npmjs.org/"`
- `publishConfig.access: "public"`
