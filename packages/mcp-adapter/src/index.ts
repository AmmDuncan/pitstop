#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Forwarder } from './forward';

const port = Number(process.env.PITSTOP_PORT ?? 7773);
const baseUrl = `http://localhost:${port}`;
const clientSessionId = process.env.CLAUDE_SESSION_ID;
const fwd = new Forwarder({ baseUrl, clientSessionId });

const tools = [
  {
    name: 'start_review',
    description: 'Start a pitstop review session with N items. Returns { sessionId, url }.',
    inputSchema: {
      type: 'object',
      required: ['projectRoot', 'items'],
      properties: {
        projectRoot: { type: 'string' },
        branch: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'body'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              body: { type: 'string' },
              question: { type: 'string' },
              attachments: { type: 'array' },
            },
          },
        },
      },
    },
  },
  { name: 'add_items', description: 'Append items to an existing session.', inputSchema: { type: 'object', required: ['sessionId', 'items'], properties: { sessionId: { type: 'string' }, items: { type: 'array' } } } },
  { name: 'get_state', description: 'Read the full session state.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } } },
  { name: 'get_unread_responses', description: 'Get all unread responses; marks them addressed atomically.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } } },
  { name: 'mark_addressing', description: 'Update the status pill so the user sees what the agent is doing.', inputSchema: { type: 'object', required: ['sessionId', 'narration'], properties: { sessionId: { type: 'string' }, itemId: { type: 'string' }, narration: { type: 'string' } } } },
  {
    name: 'set_current_item',
    description: "Move the drawer's focused item to the given itemId. Call this after navigating the user's tab to a new item's surface so the drawer cursor matches the agent's chosen view.",
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'itemId'],
      properties: {
        sessionId: { type: 'string' },
        itemId: { type: 'string' },
      },
    },
  },
  { name: 'complete_review', description: 'End the review session.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } } },
];

const server = new Server({ name: 'pitstop', version: '0.0.1' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await fwd.call(req.params.name, req.params.arguments ?? {});
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
