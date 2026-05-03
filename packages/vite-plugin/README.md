# @pitstop/vite-plugin

Auto-injects the pitstop review drawer's `inject.js` into Vite/Nuxt dev pages. Drops it in production.

## Install

```bash
bun add -d @pitstop/vite-plugin
```

## Usage

### Vite (`vite.config.ts`)

```ts
import { defineConfig } from 'vite';
import pitstop from '@pitstop/vite-plugin';

export default defineConfig({
  plugins: [pitstop()],
});
```

### Nuxt (`nuxt.config.ts`)

```ts
import pitstop from '@pitstop/vite-plugin';

export default defineNuxtConfig({
  vite: {
    plugins: [pitstop()],
  },
});
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `7773` | Daemon port |
| `projectRoot` | `string` | Vite config root | Override the project root passed to the daemon |
| `alsoInProduction` | `boolean` | `false` | Inject in production builds too |

The plugin is dev-only by default. Production builds drop the inject script automatically.
