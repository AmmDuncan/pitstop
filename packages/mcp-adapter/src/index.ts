#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Forwarder } from "./forward";
import { resolveClientSessionId } from "./session-id";
import { tools } from "./tool-definitions";

const port = Number(process.env.PITSTOP_PORT ?? 7773);
const baseUrl = `http://localhost:${port}`;
// Adapter version, sent on every RPC call as `x-pitstop-adapter-version`.
// Daemon emits a stale-adapter SSE event on mismatch so the drawer can prompt
// the user to restart CC. Bumped by scripts/release.ts alongside the others.
const ADAPTER_VERSION = "0.3.55";
const ADAPTER_PID = String(process.pid);
const fwd = new Forwarder({
  baseUrl,
  resolveClientSessionId,
  adapterVersion: ADAPTER_VERSION,
  adapterPid: ADAPTER_PID,
});

const server = new Server({ name: "pitstop", version: "0.3.55" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await fwd.call(req.params.name, req.params.arguments ?? {});
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

await server.connect(new StdioServerTransport());

// Keep the event loop alive for the lifetime of the process.
// Listening for stdin 'end'/'close' fires prematurely under Claude Code's stdio
// plumbing (CC closes the inbound pipe after the initialize handshake but
// before tools/list, and we'd exit before answering), and bun-run otherwise
// exits immediately after server.connect() resolves. A never-firing timer is
// the only mechanism that holds the process open without depending on any
// external signal — process death is via SIGTERM/SIGINT from the parent.
setInterval(() => {}, 0x7fffffff);
