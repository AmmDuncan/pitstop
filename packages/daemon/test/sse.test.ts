import { expect, test } from "bun:test";
import type { SseEvent } from "@pitstop/shared";
import { Bus } from "../src/http/sse";

test("Bus delivers events to subscribers, drops them on unsubscribe", () => {
  const bus = new Bus();
  const received: SseEvent[] = [];
  const unsub = bus.subscribe("s1", (e) => received.push(e));
  bus.publish("s1", { type: "complete", sessionId: "s1" });
  bus.publish("s2", { type: "complete", sessionId: "s2" }); // different session, ignored
  unsub();
  bus.publish("s1", { type: "complete", sessionId: "s1" });
  expect(received).toHaveLength(1);
});

test("Bus tracks subscriber count", () => {
  const bus = new Bus();
  const u1 = bus.subscribe("s1", () => {});
  const u2 = bus.subscribe("s1", () => {});
  expect(bus.subscriberCount("s1")).toBe(2);
  u1();
  expect(bus.subscriberCount("s1")).toBe(1);
  u2();
  expect(bus.subscriberCount("s1")).toBe(0);
});
