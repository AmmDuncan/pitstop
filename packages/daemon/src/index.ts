import { homedir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./http/server";
import { IdleTracker } from "./lifecycle/idle";

const port = Number(process.env.PITSTOP_PORT ?? 7773);
const dataDir = join(homedir(), ".claude", "pitstop");
const idleMs = Number(process.env.PITSTOP_IDLE_MS ?? 30 * 60 * 1000);

const app = buildApp({ port, dataDir });
const bus = (app as any)._bus as { subscriberCount(): number };

const idle = new IdleTracker({
  idleMs,
  hasClients: () => bus.subscriberCount() > 0,
  onShutdown: () => {
    console.log("pitstop-daemon idle, shutting down");
    server.stop();
    process.exit(0);
  },
});
idle.start();

const wrappedFetch = (req: Request) => {
  idle.touch();
  return app.fetch(req);
};

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({ port, fetch: wrappedFetch });
} catch (err) {
  console.error(`port ${port} unavailable; another pitstop-daemon is likely running. exiting.`);
  process.exit(0);
}

console.log(`pitstop-daemon listening on http://localhost:${server.port}`);
