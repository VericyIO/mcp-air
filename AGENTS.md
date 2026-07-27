# AGENTS.md

## Git identity

All commits on this repository must use the **raul-thalus** GitHub identity:

```bash
git config user.name "raul-thalus"
git config user.email "rahul@thalus.ai"
```

Run those in this repo root (they are repo-local, not global). Do not commit with personal GitHub emails — GitHub attributes those to the wrong account on the Contributors list.

## Verification Commands

- `pnpm typecheck` — TypeScript check
- `pnpm test` — Vitest unit and protocol tests
- `pnpm build` — Bundle to `dist/build/index.mjs`
- `pnpm verify:bundle` — Ensure published bundle has no workspace imports
- `pnpm prepublishOnly` — Build + bundle verify (runs before npm publish)

## Node Version

Node.js 20+ required. CI uses Node 24.

## Publishing

Tag push triggers `.github/workflows/publish.yml`:

```bash
git tag mcp-air-v1.0.1
git push origin mcp-air-v1.0.1
```

Requires `NPM_TOKEN` GitHub secret with publish access to `@thalus-ai/mcp-air`.

## Constants sync

Integrator scope strings in `src/constants.ts` must stay aligned with AIR API definitions in the private [thalus-apps](https://github.com/VericyIO/thalus-apps) repo (`packages/domain/src/air/config/api-key-scopes.ts`, `public-docs.ts`). Drift is checked from thalus-apps CI.

## Local API override (contributors only)

Optional env var `AIR_API_URL` overrides the default production API origin. Use only when developing against a non-production AIR API stack. End users should not set this.
