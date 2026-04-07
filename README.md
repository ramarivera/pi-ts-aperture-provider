# `pi-ts-aperture-provider`

Reusable aperture-provider logic extracted from a Pi extension so different users can share the same codebase while keeping instance-specific details in config.

## What lives here

- OpenAI-compatible `/models` gateway fetching
- models.dev catalog indexing and metadata enrichment
- API/model heuristics for Pi-style provider registrations
- Config-driven overrides for provider aliases and individual models

## What does not live here

- Hardcoded Aperture base URLs
- Hardcoded provider names
- Canonical Pi extension wiring inside `~/.pi/...`

## Quick start

```bash
npm install
npm run test
npm run build
```

Copy [`aperture-provider.config.example.json`](/Users/ramarivera/dev/pi-ts-aperture-provider/aperture-provider.config.example.json) to your own config file and adjust:

- `providerName`
- `baseUrl`
- `apiKey`
- `modelsDev.providerAliases`
- `modelOverrides`

## Core usage

```ts
import { createApertureProviderRuntime, loadApertureProviderConfig } from "pi-ts-aperture-provider";

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
import { createApertureProviderRuntime, loadApertureProviderConfig } from "pi-ts-aperture-provider";

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
- [`src/heuristics.ts`](/Users/ramarivera/dev/pi-ts-aperture-provider/src/heuristics.ts)
- [`src/provider.ts`](/Users/ramarivera/dev/pi-ts-aperture-provider/src/provider.ts)
- [`test/provider.test.ts`](/Users/ramarivera/dev/pi-ts-aperture-provider/test/provider.test.ts)
