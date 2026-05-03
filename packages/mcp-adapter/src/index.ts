#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Forwarder } from './forward';

const port = Number(process.env.WALKTHROUGH_PORT ?? 7773);
const baseUrl = `http://localhost:${port}`;
const clientSessionId = process.env.CLAUDE_SESSION_ID;
const fwd = new Forwarder({ baseUrl, clientSessionId });

const tools = [
  {
    name: 'start_review',
    description: 'Start a walkthrough review session with N items. Returns { sessionId, url }.',
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
  { name: 'complete_review', description: 'End the review session.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } } },
];

const server = new Server({ name: 'walkthrough', version: '0.0.1' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await fwd.call(req.params.name, req.params.arguments ?? {});
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

await server.connect(new StdioServerTransport());
