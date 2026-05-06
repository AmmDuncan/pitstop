import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Frameworks the wire_drawer tool knows how to suggest snippets for.
 *  `unknown` falls back to a generic head-tag suggestion. */
export type Framework = "nuxt" | "next" | "vite" | "sveltekit" | "astro" | "remix" | "plain-html" | "unknown";

export type WireOption = {
  /** Stable identifier the agent can pass back when actually performing the edit. */
  id: "committed" | "local-only";
  /** Short user-facing label (used as an option in AskUserQuestion). */
  label: string;
  /** One-line description of what this option does and when to pick it. */
  description: string;
  /** Path (relative to projectRoot) of the file the agent should edit/create. */
  file: string;
  /** The exact text snippet to add. May span multiple lines. */
  snippet: string;
  /** When set, the agent should also append this line to `.gitignore`
   *  (only the first time — `notes` will mention it if it's not present). */
  gitignoreLine?: string;
};

export type WireResult = {
  framework: Framework;
  projectRoot: string;
  options: WireOption[];
  /** The id of the option to default to when presenting choices to the user. */
  recommended: "committed" | "local-only";
  /** Free-form notes the agent should surface alongside the options
   *  (e.g. ".gitignore needs an extra line"). */
  notes: string[];
};

const fileExists = (root: string, ...names: string[]): boolean =>
  names.some((n) => existsSync(join(root, n)));

const hasPkgDep = (root: string, name: string): boolean => {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
  } catch {
    return false;
  }
};

function detectFramework(root: string): Framework {
  if (fileExists(root, "nuxt.config.ts", "nuxt.config.js") || hasPkgDep(root, "nuxt")) return "nuxt";
  if (fileExists(root, "next.config.js", "next.config.mjs", "next.config.ts") || hasPkgDep(root, "next"))
    return "next";
  if (fileExists(root, "astro.config.mjs", "astro.config.ts") || hasPkgDep(root, "astro")) return "astro";
  if (fileExists(root, "svelte.config.js", "svelte.config.ts") || hasPkgDep(root, "@sveltejs/kit"))
    return "sveltekit";
  if (fileExists(root, "remix.config.js", "remix.config.ts") || hasPkgDep(root, "@remix-run/react"))
    return "remix";
  if (fileExists(root, "vite.config.ts", "vite.config.js") || hasPkgDep(root, "vite")) return "vite";
  if (fileExists(root, "index.html")) return "plain-html";
  return "unknown";
}

const tag = (projectRoot: string): string =>
  `<script src="http://localhost:7773/inject.js?pitstop-project=${encodeURIComponent(projectRoot)}" defer></script>`;

function buildOptions(framework: Framework, projectRoot: string): WireOption[] {
  switch (framework) {
    case "nuxt":
      return [
        {
          id: "committed",
          label: "Wire it into nuxt.config.ts (visible to teammates)",
          description:
            "Adds a dev-only script tag in nuxt.config.ts head.script. Conditional on NODE_ENV === 'development' so prod builds drop it. Pick this if your team uses pitstop too.",
          file: "nuxt.config.ts",
          snippet: `// Inside defineNuxtConfig, under app.head:
script: process.env.NODE_ENV === 'development'
  ? [{
      src: 'http://localhost:7773/inject.js?pitstop-project=${encodeURIComponent(projectRoot)}',
      defer: true,
      tagPosition: 'bodyClose',
    }]
  : [],`,
        },
        {
          id: "local-only",
          label: "Local plugin file (gitignored, only on this laptop)",
          description:
            "Creates a Nuxt client-only plugin that injects the script tag in dev. The team's .gitignore needs to ignore the *.client.local.ts pattern. Pick this if you don't want pitstop wiring in the team repo.",
          file: "app/plugins/pitstop.client.local.ts",
          snippet: `export default defineNuxtPlugin(() => {
  if (process.dev && typeof window !== 'undefined') {
    const s = document.createElement('script')
    s.src = 'http://localhost:7773/inject.js?pitstop-project=${encodeURIComponent(projectRoot)}'
    s.defer = true
    document.head.appendChild(s)
  }
})`,
          gitignoreLine: "*.client.local.ts",
        },
      ];

    case "vite":
      return [
        {
          id: "committed",
          label: "Add the script tag to index.html",
          description:
            "Drops a dev-only script tag into index.html. Vite ignores it in production builds because the daemon is on localhost only.",
          file: "index.html",
          snippet: tag(projectRoot),
        },
        {
          id: "local-only",
          label: "Local Vite config override (gitignored)",
          description:
            "Run dev with `vite --config vite.config.local.ts` so the override stays on this laptop only.",
          file: "vite.config.local.ts",
          snippet: `// Run with: vite --config vite.config.local.ts
import baseConfig from './vite.config'
import { defineConfig, mergeConfig } from 'vite'

export default mergeConfig(baseConfig, defineConfig({
  plugins: [{
    name: 'pitstop-inject',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        '${tag(projectRoot)}</head>',
      )
    },
  }],
}))`,
          gitignoreLine: "vite.config.local.ts",
        },
      ];

    case "next":
      return [
        {
          id: "committed",
          label: "Add to your root layout",
          description:
            "App Router → app/layout.tsx; Pages Router → pages/_document.tsx. Gated by NODE_ENV so prod drops it. REQUIRED if any part of the review is agent-driven (agent-browser, Claude in Chrome via Playwright, CI) — the Chrome extension fallback below does NOT load in Playwright-driven Chromium.",
          file: "app/layout.tsx (App Router) or pages/_document.tsx (Pages Router)",
          snippet: `{process.env.NODE_ENV === 'development' && (
  <script src="http://localhost:7773/inject.js?pitstop-project=${encodeURIComponent(projectRoot)}" defer />
)}`,
        },
        {
          id: "local-only",
          label: "Skip — Next.js has no clean local-only point",
          description:
            "Next.js doesn't expose a hook for local-only HTML injection. Two paths: (a) commit the conditional snippet from Option A — works in any browser context including agent-browser / Playwright; or (b) install the Chrome extension at packages/extension — no repo edits, but ONLY works in your real Chrome / Edge. The extension does NOT load in Playwright-driven Chromium, so it's unsuitable for agent-driven reviews via agent-browser. Pick (a) when the agent will drive the browser; pick (b) only for human-driven free-form review.",
          file: "app/layout.tsx",
          snippet: `{process.env.NODE_ENV === 'development' && (
  <script src="http://localhost:7773/inject.js?pitstop-project=${encodeURIComponent(projectRoot)}" defer />
)}`,
        },
      ];

    case "sveltekit":
      return [
        {
          id: "committed",
          label: "Add to src/app.html",
          description:
            "Drops the script tag into SvelteKit's root HTML template. Vite’s tree-shaking won't remove it, so keep it %sveltekit.head%-local for cleanliness.",
          file: "src/app.html",
          snippet: `<!-- next to %sveltekit.head% -->
${tag(projectRoot)}`,
        },
        {
          id: "local-only",
          label: "Skip — easier to commit conditionally",
          description: "SvelteKit's app.html is single-source. Recommend Option A.",
          file: "src/app.html",
          snippet: tag(projectRoot),
        },
      ];

    case "astro":
      return [
        {
          id: "committed",
          label: "Add to your root layout (.astro)",
          description: "Gated by import.meta.env.DEV so prod builds drop it.",
          file: "src/layouts/Layout.astro",
          snippet: `{import.meta.env.DEV && (
  <script src="http://localhost:7773/inject.js?pitstop-project=${encodeURIComponent(projectRoot)}" defer />
)}`,
        },
        {
          id: "local-only",
          label: "Skip — easier to commit conditionally",
          description: "Astro layout files are single-source; pick Option A.",
          file: "src/layouts/Layout.astro",
          snippet: tag(projectRoot),
        },
      ];

    case "remix":
      return [
        {
          id: "committed",
          label: "Add to app/root.tsx",
          description: "Drops the snippet inside <head>, gated by NODE_ENV.",
          file: "app/root.tsx",
          snippet: `{process.env.NODE_ENV === 'development' && (
  <script src="http://localhost:7773/inject.js?pitstop-project=${encodeURIComponent(projectRoot)}" defer />
)}`,
        },
        {
          id: "local-only",
          label: "Skip — easier to commit conditionally",
          description: "Remix's root.tsx is single-source. Recommend Option A.",
          file: "app/root.tsx",
          snippet: tag(projectRoot),
        },
      ];

    case "plain-html":
      return [
        {
          id: "committed",
          label: "Add the script tag to index.html",
          description: "Just drops the tag in <head>.",
          file: "index.html",
          snippet: tag(projectRoot),
        },
        {
          id: "local-only",
          label: "Use a gitignored index.local.html and serve that during dev",
          description:
            "Copy index.html to index.local.html, add the tag there, gitignore the local file, and point your dev server at it.",
          file: "index.local.html",
          snippet: tag(projectRoot),
          gitignoreLine: "index.local.html",
        },
      ];

    default:
      return [
        {
          id: "committed",
          label: "Add the script tag wherever your dev HTML <head> lives",
          description: "Framework not detected. Drop this snippet anywhere in <head> during dev.",
          file: "<wherever your dev HTML lives>",
          snippet: tag(projectRoot),
        },
        {
          id: "local-only",
          label: "Use whatever local-override mechanism your framework supports",
          description: "We couldn't detect a framework, so the local-only path is up to you.",
          file: "<framework-specific>",
          snippet: tag(projectRoot),
        },
      ];
  }
}

function gitignoreLineMissing(root: string, line: string): boolean {
  const giPath = join(root, ".gitignore");
  if (!existsSync(giPath)) return true;
  try {
    const text = readFileSync(giPath, "utf8");
    return !text.split("\n").some((l) => l.trim() === line);
  } catch {
    return true;
  }
}

const WireDrawerZ = z.object({ projectRoot: z.string() });

/** Inspect a project, detect its framework, and return the two main wiring
 *  options (committed vs local-only) plus the snippets the agent should paste
 *  in. Does not write any files — the agent owns that, after asking the user
 *  via AskUserQuestion. */
export async function wire_drawer(params: unknown): Promise<WireResult> {
  const { projectRoot } = WireDrawerZ.parse(params);
  if (!existsSync(projectRoot)) {
    throw new Error(`PROJECT_ROOT_MISSING:${projectRoot}`);
  }
  const framework = detectFramework(projectRoot);
  const options = buildOptions(framework, projectRoot);

  // Heuristic for the default recommendation: if the project looks like a
  // multi-person repo (CODEOWNERS / CONTRIBUTING.md / a populated AUTHORS file)
  // lean committed so teammates benefit. For solo / fresh projects, default
  // to local-only so we don't slip wiring into a repo the user might not own.
  const looksLikeTeamRepo = fileExists(
    projectRoot,
    "CONTRIBUTING.md",
    ".github/CODEOWNERS",
    "CODEOWNERS",
    ".github/PULL_REQUEST_TEMPLATE.md",
  );
  const recommended: "committed" | "local-only" = looksLikeTeamRepo ? "committed" : "local-only";

  const notes: string[] = [];
  if (framework === "unknown") {
    notes.push(
      "Framework not detected — using a generic <head> snippet. Adjust the file path to wherever your dev HTML's head lives.",
    );
  }
  for (const opt of options) {
    if (opt.gitignoreLine && gitignoreLineMissing(projectRoot, opt.gitignoreLine)) {
      notes.push(
        `If the user picks "${opt.id}", also append \`${opt.gitignoreLine}\` to ${projectRoot}/.gitignore.`,
      );
    }
  }

  // CSP is a common gotcha — drawer never appears, browser console shows a
  // CSP error, user has no obvious cause. Surface it preemptively with a
  // concrete copy-pastable snippet.
  notes.push(
    "If the user's dev app sets a Content Security Policy (nuxt-security, Next.js headers, helmet middleware, or a <meta http-equiv=\"Content-Security-Policy\"> tag), allowlist `http://localhost:7773` in BOTH `script-src` AND `connect-src`. Dev-only — production CSPs stay strict. Concrete pattern (spread into each list):\n\n  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:7773'] : []),\n\nMention this preemptively when the user is using nuxt-security / helmet / strict CSP, OR if they report 'drawer doesn't appear' after wiring.",
  );

  // Wiring is one-time setup, NOT the end of the review flow. Agents that
  // call wire_drawer often stop after the snippet is added and tell the
  // user "all set" — but the drawer is still empty until start_review is
  // called with actual items. Make the next step explicit in tool output
  // so the agent doesn't think it's done.
  notes.push(
    "Wiring the drawer is SETUP, not the review itself. After the user confirms the drawer renders in their browser at the host page, the next step is `start_review` with the actual items the user should look at — title, body (markdown), lookFor, concerns, question on each item. Don't tell the user 'all set' or 'done' after just wiring; the drawer will sit empty until items arrive. If you have nothing concrete to review yet, ask the user what they want pitstopped before calling start_review.",
  );

  // Chrome extension as a Next.js fallback (only path where extension is
  // surfaced in this tool's output). The README has the full caveat but
  // agents reading wire_drawer's response don't necessarily read the README.
  if (framework === "next") {
    notes.push(
      "If the user picks the Chrome extension fallback for Next.js: the extension matches `http://localhost/*` only and does NOT load in Playwright-driven Chromium. Any review driven via agent-browser, Claude in Chrome (Playwright variants), or CI will see a tab with no drawer. For agent-driven flows the committed snippet (Option A) is the only path that works.",
    );
  }

  return { framework, projectRoot, options, recommended, notes };
}
