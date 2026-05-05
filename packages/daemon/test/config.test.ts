import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "../src/config";

test("loadConfig returns defaults when file does not exist", async () => {
  const cfg = await loadConfig("/tmp/nonexistent-pitstop-config.json");
  expect(cfg).toEqual(DEFAULT_CONFIG);
});

test("loadConfig merges user values over defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-cfg-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({ port: 9999, editor: "vscode", drawer: { position: "left" } }));
  const cfg = await loadConfig(path);
  expect(cfg.port).toBe(9999);
  expect(cfg.editor).toBe("vscode");
  expect(cfg.drawer.position).toBe("left");
  // Unspecified drawer fields fall back to defaults
  expect(cfg.drawer.size).toBe("standard");
  expect(cfg.drawer.width).toBe(504);
});

test("loadConfig falls back to defaults on invalid JSON", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-cfg-"));
  const path = join(dir, "config.json");
  writeFileSync(path, "{not json");
  const cfg = await loadConfig(path);
  expect(cfg).toEqual(DEFAULT_CONFIG);
});
