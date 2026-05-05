import { expect, test } from "bun:test";
import { IdleTracker } from "../src/lifecycle/idle";

test("IdleTracker fires shutdown after the configured ms with no activity", async () => {
  let fired = false;
  const tracker = new IdleTracker({
    idleMs: 50,
    hasClients: () => false,
    onShutdown: () => {
      fired = true;
    },
  });
  tracker.start();
  tracker.touch();
  await new Promise((r) => setTimeout(r, 75));
  expect(fired).toBe(true);
  tracker.stop();
});

test("IdleTracker resets on touch", async () => {
  let fired = false;
  const tracker = new IdleTracker({
    idleMs: 80,
    hasClients: () => false,
    onShutdown: () => {
      fired = true;
    },
  });
  tracker.start();
  tracker.touch();
  await new Promise((r) => setTimeout(r, 50));
  tracker.touch();
  await new Promise((r) => setTimeout(r, 50));
  expect(fired).toBe(false);
  tracker.stop();
});

test("IdleTracker holds off shutdown while clients connected", async () => {
  let fired = false;
  let connected = true;
  const tracker = new IdleTracker({
    idleMs: 30,
    hasClients: () => connected,
    onShutdown: () => {
      fired = true;
    },
  });
  tracker.start();
  tracker.touch();
  await new Promise((r) => setTimeout(r, 60));
  expect(fired).toBe(false);
  connected = false;
  tracker.touch();
  await new Promise((r) => setTimeout(r, 60));
  expect(fired).toBe(true);
  tracker.stop();
});
