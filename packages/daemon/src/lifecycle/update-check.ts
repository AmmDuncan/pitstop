import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Result of a single GitHub Releases lookup. Cached for the daemon's lifetime. */
export type UpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  installPath: string;
  /** When the latest-version lookup last ran. null if it never has. */
  checkedAt: number | null;
  /** True when the user has set PITSTOP_DISABLE_UPDATE_CHECK=1. */
  disabled: boolean;
};

const RELEASES_URL = "https://api.github.com/repos/AmmDuncan/pitstop/releases/latest";
const FETCH_TIMEOUT_MS = 5_000;

/** Walk up from the given directory looking for the monorepo root
 *  (the directory that contains the workspace package.json with name
 *  "pitstop-monorepo"). Falls back to the daemon's parent dir if nothing
 *  matches — better to give a usable best-guess path than to bail. */
async function findInstallRoot(startDir: string): Promise<string> {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf8"));
      if (pkg.name === "pitstop-monorepo") return dir;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

/** Read the daemon's own package.json to get the running version. */
async function readDaemonVersion(daemonDir: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(resolve(daemonDir, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** Fetch the latest published GitHub release tag. Returns null on any failure
 *  (offline, rate-limited, schema change). The caller decides whether to
 *  surface "no info" as no chip or as a soft warning. */
async function fetchLatestTag(): Promise<{ tag: string; url: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(RELEASES_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!body.tag_name) return null;
    return { tag: body.tag_name.replace(/^v/, ""), url: body.html_url ?? "" };
  } catch {
    return null;
  }
}

let cache: UpdateStatus | null = null;

/** Resolve the daemon's install path (parent of packages/daemon) and current
 *  running version, then kick off a single GitHub Releases lookup. The
 *  promise resolves once the lookup completes or fails — the cache is
 *  populated with whatever we know. Subsequent calls return the cached
 *  result and never re-fetch (re-running the daemon is the canonical refresh). */
export async function initUpdateCheck(): Promise<UpdateStatus> {
  if (cache) return cache;

  const daemonSrcDir = dirname(fileURLToPath(import.meta.url));
  // daemonSrcDir is .../packages/daemon/src/lifecycle. Walk up to packages/daemon.
  const daemonDir = resolve(daemonSrcDir, "..", "..");
  const installPath = await findInstallRoot(daemonDir);
  const current = await readDaemonVersion(daemonDir);
  const disabled = process.env.PITSTOP_DISABLE_UPDATE_CHECK === "1";

  if (disabled) {
    cache = {
      current,
      latest: null,
      updateAvailable: false,
      releaseUrl: null,
      installPath,
      checkedAt: null,
      disabled: true,
    };
    return cache;
  }

  const latestInfo = await fetchLatestTag();
  cache = {
    current,
    latest: latestInfo?.tag ?? null,
    updateAvailable: latestInfo !== null && latestInfo.tag !== current,
    releaseUrl: latestInfo?.url ?? null,
    installPath,
    checkedAt: Date.now(),
    disabled: false,
  };
  return cache;
}

/** Synchronous read of the cache — returns null if init hasn't been called
 *  or hasn't completed. Routes use this so request handling never blocks
 *  on the network call. */
export function getUpdateStatus(): UpdateStatus | null {
  return cache;
}
