# pitstop — instructions for AI sessions

Read this first when opening a session in this repo.

## Releases

**Always use the release script. Never bump package.json versions or tag manually.**

```bash
bun run release 0.1.1
```

The script handles: dirty-tree check, tag-already-exists check, tests, bumping all 5 package.json files, rebuilding `packages/inject/dist/inject.js`, committing (`chore: release X.Y.Z`), tagging `vX.Y.Z`, pushing main + tags. Source: `scripts/release.ts`.

If the script fails partway, fix the cause — don't continue manually. The script is the contract.

## After editing inject source

`packages/inject/dist/inject.js` is committed and served by the daemon at `/inject.js`. After changing anything in `packages/inject/src/`, rebuild:

```bash
bun --cwd packages/inject run build
```

Stage the new `dist/inject.js` with the source change in the same commit. If you skip this, the daemon will keep serving the stale bundle and friends won't see your fix until they rebuild themselves.

## Branch policy

Never commit directly to `main`. Feature branches: `feat/...`, `fix/...`, `chore/...`. Open a PR, merge, then optionally release.

## Tests

```bash
bun test
```

30 tests across 15 files. The `SyntaxError: JSON Parse error` line in test output is **expected** — it's from the `loadConfig falls back to defaults on invalid JSON` test deliberately feeding bad JSON. Don't "fix" it.

## Stack and conventions

- **Bun** for runtime, package management, HTTP server (`Bun.serve` under Hono), and tests. Don't introduce npm/yarn/pnpm.
- **Hono** for HTTP routes (`packages/daemon/src/http/`). Web-standards `Request`/`Response`. Don't add Express.
- **Solid.js + Shadow DOM** for the drawer (`packages/inject/`). Avoid leaking styles into the host page — everything stays inside the shadow root.
- **TypeScript everywhere.** No JS files. Keep types in `packages/shared/src/types.ts` when shared across packages.
- **Biome** for lint/format. Run `bun run lint` before committing.

## Package layout

```
packages/
  daemon/        HTTP server, session store, /inject.js, claude-resume spawner
  mcp-adapter/   stdio↔HTTP bridge that Claude Code spawns per session
  inject/        Solid.js drawer (Shadow DOM); pre-built into dist/
  vite-plugin/   Vite/Nuxt plugin that injects the <script> tag
  shared/        types and zod schemas
```

## What pitstop does (one-paragraph context)

A developer's AI agent finishes a chunk of work, calls the `start_review` MCP tool, and a drawer mounts in the developer's dev app browser with the items to review. The developer walks through with `j/k`, hits `⏎` for "looks good," or types a comment that re-engages the agent via `claude --resume`. Pause/resume is first-class. See `README.md` for the user-facing setup.

## Things to avoid

- Don't manually edit `package.json` versions — the release script owns them.
- Don't commit without running `bun test` first if you've touched daemon/inject/shared code.
- Don't introduce a new HTTP framework, package manager, or UI framework. The choices in this repo (Bun, Hono, Solid) are deliberate; see commit history for context.
- Don't rename the `__PITSTOP_PROJECT__` window var, the `?pitstop-project=` query param, the daemon port (`7773`), or the MCP tool names without coordinating across `packages/inject/`, `packages/vite-plugin/`, `packages/daemon/`, and `packages/mcp-adapter/` in the same commit. They're a coordinated contract.
- Don't add a top-level `version` field to the root `package.json` — it's the workspace root, not a publishable package.
