#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Forwarder } from './forward';

const port = Number(process.env.PITSTOP_PORT ?? 7773);
const baseUrl = `http://localhost:${port}`;
const clientSessionId = process.env.CLAUDE_SESSION_ID;
const fwd = new Forwarder({ baseUrl, clientSessionId });

const ITEM_SCHEMA = {
  type: 'object',
  required: ['title', 'body'],
  description:
    'A single review item. Aim for *useful* — not minimal. Each item is a small handoff document the human reviewer reads on the surface where the change lives. Fill every applicable field; lists with one bullet each are far more useful than a single paragraph cramming everything together.',
  properties: {
    id: {
      type: 'string',
      description:
        "Optional stable identifier (e.g. '01'). If omitted the daemon assigns a zero-padded index. Use stable ids when you'll later call set_current_item.",
    },
    title: {
      type: 'string',
      description:
        'Short, scannable headline of what this item is about. Imperative or noun phrase, ~6 words. Example: "Wizard split into section components".',
    },
    body: {
      type: 'string',
      description:
        'WHY this changed, in 1–3 sentences. Markdown is rendered. This is the prose lede, not a recap of the diff. The reviewer will already see the surface — they want motivation: what problem was being solved, what trade-off was taken. Save lists for the lookFor/tested/concerns arrays.',
    },
    lookFor: {
      type: 'array',
      items: { type: 'string' },
      description:
        "Bulleted things the reviewer should specifically watch for on the surface. UX, visual, edge-case behaviour — anything that wouldn't show up in unit tests or a code diff. Example entries: 'spacing between the two new sub-sections feels even', 'focus ring lands on the first input when modal opens', 'on mobile the chip wraps gracefully'. Empty array is fine when there's nothing visual.",
    },
    tested: {
      type: 'array',
      items: { type: 'string' },
      description:
        "Bulleted things the agent already exercised before pinging the reviewer, so they don't repeat work. Be specific. Examples: 'Happy path: filled form, hit Submit, saw success toast', 'Refreshed page mid-wizard — state restored from query params', 'Tabbed through with keyboard only — no traps'. Empty array when nothing was tested (uncommon — name what you actually did).",
    },
    concerns: {
      type: 'array',
      items: { type: 'string' },
      description:
        "Bulleted open trade-offs you're unsure about — flag them so the reviewer can weigh in. Examples: 'Used a module-scoped ref to avoid flicker; not sure if that's overkill vs. accepting brief flicker', 'Picked react-spring over framer-motion mostly out of bundle size; happy to swap'. Use this instead of burying ambiguity in the body.",
    },
    question: {
      type: 'string',
      description:
        'The single decision the reviewer is being asked to make. One sentence, ends in a question mark. Example: "Does the per-step component cut feel right, or would you rather a single wizard file with computed sections?". Pair with concerns: concerns lists the trade-offs, question crystallises the call.',
    },
    attachments: { type: 'array' },
  },
};

const AUTHORING_HINT = `
ITEM AUTHORING (READ THIS BEFORE CALLING):
Pitstop is a handoff tool — each item is a tiny document the reviewer reads ON the surface where the change lives. Thin items waste the round-trip; rich items pay back tenfold.
For every item, fill what applies:
- title: short scannable headline.
- body: WHY this changed, 1–3 sentences. Markdown allowed.
- lookFor: bulleted UX/visual things to watch for. (string[])
- tested: bulleted things you already exercised. (string[])
- concerns: bulleted open trade-offs you're unsure about. (string[])
- question: the single decision the reviewer is being asked.
Lists beat prose. One-bullet-per-thing beats a paragraph. Don't pad — but don't strip either; aim for *useful*.`.trim();

const tools = [
  {
    name: 'start_review',
    description: `Start a pitstop review session with N items. Returns { sessionId, url, drawerStatus, watcher }.

After calling this you MUST:
(0) Inspect 'drawerStatus'. If 'connected' is false, STOP — the drawer is not wired into the dev app yet, so the user can't see anything you do. Surface drawerStatus.hint to them (it includes a copy-paste script-tag snippet). Wait until the user confirms they've added it and reloaded their dev page; the next start_review call will report connected=true.
(1) Read the returned 'watcher' block and immediately invoke the Monitor tool with its command/description/persistent fields verbatim — that's the live channel the user's drawer responses arrive on.
(2) Use a browser-driving toolbelt (Claude in Chrome or agent-browser) to drive the user's tab to the first item's surface.
(3) Call set_current_item + mark_addressing so the drawer cursor matches what the user is looking at.
(4) Wait. On every Monitor notification, call get_unread_responses, decide what's next, drive the tab there, repeat.

${AUTHORING_HINT}`,
    inputSchema: {
      type: 'object',
      required: ['projectRoot', 'items'],
      properties: {
        projectRoot: {
          type: 'string',
          description: "Absolute path to the project the review is for (e.g. '/Users/foo/work/dvla-idtms-frontend'). Used to bind the session to a specific dev app.",
        },
        branch: {
          type: 'string',
          description: 'Optional git branch label shown in the drawer header. Pass the current feature branch name.',
        },
        devUrls: {
          type: 'array',
          items: { type: 'string' },
          description: "Origins (e.g. ['http://localhost:3000']) where this review's surfaces live. PASS THIS WHEN THE DEV URL IS KNOWN — without it, the pitstop browser extension can't tell which localhost tab to show the drawer on, and may surface this review on unrelated localhost pages. You usually know the dev URL because you just drove the user there. Pass an array even for a single origin.",
        },
        items: {
          type: 'array',
          description: 'The review items to put in front of the reviewer. See ITEM AUTHORING above. Order matters — item 0 is shown first.',
          items: ITEM_SCHEMA,
        },
      },
    },
  },
  {
    name: 'add_items',
    description: `Append items to an existing session, mid-review. Same authoring rules as start_review.

${AUTHORING_HINT}`,
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'items'],
      properties: {
        sessionId: { type: 'string', description: 'The session id returned by start_review.' },
        items: { type: 'array', description: 'New items to append. Same shape as start_review items.', items: ITEM_SCHEMA },
      },
    },
  },
  {
    name: 'get_state',
    description: 'Read the full session state, including items, responses, currentItemId, and recent agent activity. Useful when reconnecting mid-review or after a long pause to confirm where things stand.',
    inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } },
  },
  {
    name: 'get_unread_responses',
    description: "Drain all unread reviewer responses; marks them addressed atomically. Call this every time your Monitor watcher fires a stdout-line notification — that line means the reviewer pressed approve or sent a comment, and you need to read what they said before deciding what to do next. Returns an array; for each entry decide: navigate to the next item's surface (call set_current_item + mark_addressing), or, if it's a comment that requires action, fix the issue and add a follow-up item or carry on to the next.",
    inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } },
  },
  {
    name: 'mark_addressing',
    description: "Append a single human-readable narration line to the agent feed at the bottom of the drawer. The reviewer sees the last ~5 lines, newest first, oldest fades. This is the agent's voice in the UI — keep narrations high-level (one sentence, what you're about to do or just did from the user's perspective). Good: 'Driving you to the rides page so you can see the banner placement.' Bad: 'Calling agent-browser open http://localhost:3000/rides'. Call this AFTER set_current_item when moving to a new item, or anytime you want to update the user on what's happening (e.g. 'Drained your comment, fixing the duplicate heading before moving on').",
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'narration'],
      properties: {
        sessionId: { type: 'string' },
        itemId: { type: 'string', description: 'Optional. Item the narration is about; usually the same id you just passed to set_current_item.' },
        narration: { type: 'string', description: 'One sentence in plain language. What the user would say if they were narrating their own screen. NOT a tool-call log line.' },
      },
    },
  },
  {
    name: 'set_current_item',
    description: "Move the drawer's focused item to the given itemId. Call this immediately after you've navigated the user's tab to that item's surface, so the drawer cursor matches what they're looking at. Pair with mark_addressing — the drawer pill plus the agent feed are the user's only signal that the agent is working.",
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'itemId'],
      properties: {
        sessionId: { type: 'string' },
        itemId: { type: 'string', description: "The id of the item the drawer should focus on. Must match an item from start_review/add_items." },
      },
    },
  },
  {
    name: 'complete_review',
    description: 'End the review session. Flips the drawer status pill to REVIEW_COMPLETE. Call this only after every item has at least one response (approve or comment).',
    inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } },
  },
];

const server = new Server({ name: 'pitstop', version: '0.3.0' }, { capabilities: { tools: {} } });

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
