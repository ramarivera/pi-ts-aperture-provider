# Repository Notes

This repository publishes the shared Aperture provider runtime as the scoped npm package `@ramarivera/pi-ts-aperture-provider`.

## Release Flow

- Package manager: `yarn`
- Build command: `corepack yarn build`
- Verification commands:
  - `corepack yarn run check`
  - `corepack yarn test`
  - `corepack yarn typecheck`
  - `corepack yarn build`
- Trusted publishing workflow: `.github/workflows/publish.yml`
- Publishing rule: pushes to `main` or `master` only publish when `package.json` contains a version not already on npm

## Runtime Sources Of Truth

- `/aperture/config` is preferred for provider API routing when available
- `/v1/models` is used for visible model inventory and pricing
- `models.dev` is used for capabilities like reasoning, modalities, and limits
- `modelOverrides` are the final explicit override layer

## Guardrails

- Keep provider-specific routing knowledge config-driven whenever possible
- Do not reintroduce heuristic capability inference from model IDs
- Preserve extensionless source imports for the bundler-style build
