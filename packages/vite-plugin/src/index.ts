import type { Plugin } from 'vite';

export type PitstopPluginOpts = {
  /** Daemon port. Defaults to 7773. */
  port?: number;
  /** Project root override. Defaults to the Vite config's root. */
  projectRoot?: string;
  /** When true, also inject in production builds. Defaults to false (dev-only). */
  alsoInProduction?: boolean;
};

/**
 * Vite/Nuxt plugin that injects the pitstop drawer's inject.js into the dev app.
 * Production builds drop the script unless `alsoInProduction: true`.
 */
export default function pitstop(opts: PitstopPluginOpts = {}): Plugin {
  const port = opts.port ?? 7773;
  return {
    name: '@pitstop/vite-plugin',
    apply: opts.alsoInProduction ? undefined : 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        // Skip during production builds unless explicitly opted in
        if (!opts.alsoInProduction && ctx.bundle) return;
        const projectRoot = opts.projectRoot ?? (ctx.server?.config.root ?? '');
        const params = projectRoot ? `?pitstop-project=${encodeURIComponent(projectRoot)}` : '';
        return [
          {
            tag: 'script',
            attrs: {
              src: `http://localhost:${port}/inject.js${params}`,
              defer: true,
            },
            injectTo: 'body',
          },
          {
            tag: 'script',
            children: `window.__PITSTOP_PROJECT__ = ${JSON.stringify(projectRoot)};`,
            injectTo: 'body-prepend',
          },
        ];
      },
    },
  };
}
