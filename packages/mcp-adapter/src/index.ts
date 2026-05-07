#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Forwarder } from "./forward";

const port = Number(process.env.PITSTOP_PORT ?? 7773);
const baseUrl = `http://localhost:${port}`;
// Claude Code exposes the session id as CLAUDE_CODE_SESSION_ID (verified
// empirically; see https://github.com/anthropics/claude-code/issues/25642 —
// not officially documented as a stable API). The CLAUDE_SESSION_ID fallback
// keeps any one-off CLAUDE_SESSION_ID= env overrides working. Without this
// id, the daemon's claude-resume poke can't wake the agent (it throws
// "claude-resume requires clientSessionId") and every poke path silently
// fails — which is exactly how this bug went unnoticed until v0.3.42.
const clientSessionId = process.env.CLAUDE_CODE_SESSION_ID ?? process.env.CLAUDE_SESSION_ID;
// Adapter version, sent on every RPC call as `x-pitstop-adapter-version`.
// The daemon compares it to its own version and emits a stale-adapter
// SSE event to the project lobby on mismatch — the drawer renders a banner
// telling the user to restart Claude Code so the new dist is loaded.
// Bumped by scripts/release.ts alongside the other version literals.
const ADAPTER_VERSION = "0.3.50";
const fwd = new Forwarder({ baseUrl, clientSessionId, adapterVersion: ADAPTER_VERSION });

const ITEM_SCHEMA = {
  type: "object",
  required: ["title", "body"],
  description: "A review item. The reviewer reads it on the surface. Bias toward empty fields over filler.",
  properties: {
    id: {
      type: "string",
      description:
        "Optional stable id (e.g. '01'). Daemon assigns one if omitted. Use stable ids when you'll later call set_current_item.",
    },
    title: {
      type: "string",
      description: 'Short headline. ~6 words. Example: "Wizard split into section components".',
    },
    body: {
      type: "string",
      description:
        'WHY this changed. 1–3 sentences. Markdown supported. Don\'t recap the diff. If you exercised something concrete the reviewer would otherwise repeat (mobile, error path, edge case), close with one sentence: "Already tested: <thing>." Skip when obvious.',
    },
    lookFor: {
      type: "array",
      items: { type: "string" },
      description:
        'Up to 3 bullets — visual/UX behaviour the diff doesn\'t show. Empty unless non-obvious. Each bullet names ONE thing the reviewer can verify in <3 seconds. Good: "focus ring lands on the first input on modal mount". Bad: "spacing looks fine" — delete it.',
    },
    concerns: {
      type: "array",
      items: { type: "string" },
      description:
        'Up to 3 bullets — real open trade-offs you\'re uncertain about. Empty unless genuinely uncertain. Good: "module-scoped ref to avoid flicker; could be ref-in-component + accept brief flicker". Bad: "could be refactored further" — delete it.',
    },
    question: {
      type: "string",
      description:
        'The single decision the reviewer is being asked. One sentence, ends with "?". Example: "Does the per-step component cut feel right, or would you rather a single wizard file with computed sections?".',
    },
    attachments: { type: "array" },
  },
};

const AUTHORING_HINT = `
ITEM AUTHORING:

COVERAGE — split items by *testable unit surface*: ONE screen, modal, or wizard step the user can land on and form a single review judgment about. If forming a judgment requires the user to navigate elsewhere, split. If multiple sub-changes share one surface and one judgment, keep them together. Five items each pointing at one screen beat one item that covers seven; one item per pixel is too many.

PER ITEM:
- title: short headline (~6 words).
- body: WHY this changed (1–3 sentences). Optionally close with "Already tested: <thing>." when you ran something the reviewer would otherwise repeat.
- lookFor: up to 3 bullets. Empty unless non-obvious.
- concerns: up to 3 bullets. Empty unless genuinely uncertain.
- question: the single decision being asked.

SPECIFICITY TEST: each bullet names ONE thing verifiable in <3 seconds. If it starts with "Looks good" / "Could be improved" / "Tested it" — delete it.`.trim();

/** One-liner appended to every active-session tool description. The "use
 *  ask_user, not AskUserQuestion" rule was previously buried only in
 *  start_review's prose, which the agent reads once at session creation
 *  and forgets hours later. Repeating it on every tool the agent reaches
 *  for during a session puts the steering wherever the agent's eye lands. */
const ASK_USER_CROSSREF =
  "FOR QUESTIONS during this session: use `ask_user` (NOT Claude Code's `AskUserQuestion`). The user is parked in the drawer, not the chat — `AskUserQuestion` would hijack the chat with a modal and pull them out of flow.";

const tools = [
  {
    name: "start_review",
    description: `Start a pitstop review session. Returns { sessionId, url, drawerStatus, watcher, toolsToPreload, update? }.

AFTER CALLING, in order:
0. If drawerStatus.connected === false: STOP. Call wire_drawer({ projectRoot }) (same projectRoot), surface its options via AskUserQuestion, perform the file edit yourself, ask user to reload, retry start_review.
1. PRELOAD: If \`toolsToPreload\` is set, immediately call ToolSearch with \`select:<comma-separated names>\` so every pitstop tool is available without per-call ToolSearch latency mid-review. The list is small (~10 tools); load them all up front. ask_user is in the list specifically so you don't reach for AskUserQuestion later out of habit.
2. If \`update\` is set in the response: ONCE, before driving anything, ask the user: "Pitstop has v\${update.latest} out (you're on v\${update.current}). Want me to run \`cd \${update.installPath} && git pull && bun run setup\` and restart the daemon?" If they say yes, run via Bash (Claude Code's permission gate handles consent). If they say no or ignore the prompt, carry on normally — the offer is one-shot, never re-ask mid-review.
3. Invoke Monitor with watcher.command / watcher.description / watcher.persistent verbatim.
4. Drive the user's tab to item 1's surface (Claude in Chrome or agent-browser).
5. Call set_current_item + mark_addressing for that item.
6. Wait. On every Monitor notification: get_unread_responses → decide → drive next surface → repeat.

WHILE THIS SESSION IS ACTIVE: prefer pitstop's ask_user tool over AskUserQuestion for any review-related question. The user is already looking at the drawer; AskUserQuestion would hijack the chat with a modal and pull them out. The ONLY exception is wiring/setup questions in step 0 above (because the drawer isn't connected yet).

${AUTHORING_HINT}`,
    inputSchema: {
      type: "object",
      required: ["projectRoot", "items"],
      properties: {
        projectRoot: {
          type: "string",
          description:
            "Absolute path to the project the review is for (e.g. '/Users/foo/work/dvla-idtms-frontend'). This is the BINDING KEY between the session and the drawer — wire_drawer MUST be called with the EXACT same projectRoot string for the drawer to render this session. Different paths (e.g. '/repo' vs '/repo/apps/shop') do NOT match: the session will be created but the drawer will sit on the empty start screen.",
        },
        branch: {
          type: "string",
          description:
            "Optional git branch label shown in the drawer header. Pass the current feature branch name.",
        },
        devUrls: {
          type: "array",
          items: { type: "string" },
          description:
            "Origins (e.g. ['http://localhost:3000']) where this review's surfaces live. PASS THIS WHEN THE DEV URL IS KNOWN — without it, the pitstop browser extension can't tell which localhost tab to show the drawer on, and may surface this review on unrelated localhost pages. You usually know the dev URL because you just drove the user there. Pass an array even for a single origin.",
        },
        items: {
          type: "array",
          description:
            "The review items to put in front of the reviewer. See ITEM AUTHORING above. Order matters — item 0 is shown first.",
          items: ITEM_SCHEMA,
        },
      },
    },
  },
  {
    name: "add_items",
    description: `Append items to an existing session, mid-review. Same authoring rules as start_review.

${AUTHORING_HINT}`,
    inputSchema: {
      type: "object",
      required: ["sessionId", "items"],
      properties: {
        sessionId: { type: "string", description: "The session id returned by start_review." },
        items: {
          type: "array",
          description: "New items to append. Same shape as start_review items.",
          items: ITEM_SCHEMA,
        },
      },
    },
  },
  {
    name: "get_state",
    description: `Read the full session state, including items, responses, currentItemId, and recent agent activity. Useful when reconnecting mid-review or after a long pause to confirm where things stand.

Returns the full Session shape PLUS:
- \`watcher\`: { command, description, persistent } — invoke this via Monitor verbatim to get one stdout line per new unaddressed response. Same shape start_review returns. RESUMING AGENTS: use this watcher; do NOT roll your own SSE poller — \`awk\` is not line-buffered by default and user clicks will silently buffer. The shipped pitstop-watch.sh handles line buffering correctly.
- \`lastResponseAt\`: epoch ms of the most recent response in the snapshot, or undefined if no responses yet. THE FRESHNESS SIGNAL — \`get_state\` is a point-in-time snapshot, not a live stream. If \`lastResponseAt\` is older than what you'd expect, run the watcher and wait for it to fire instead of polling get_state in a tight loop.

THE RESUME RECIPE: get_state(sessionId) → invoke watcher.command via Monitor → drive from there. The cross-session rebind (v0.3.49) auto-attaches your CC session id to the pitstop on this very call, so subsequent pokes wake you, not the prior dead session.`,
    inputSchema: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } } },
  },
  {
    name: "get_unread_responses",
    description: `Drain all unread reviewer responses; marks them addressed atomically. Call this every time your Monitor watcher fires a stdout-line notification — that line means the reviewer pressed approve or sent a comment, and you need to read what they said before deciding what to do next. Returns an array; for each entry decide: navigate to the next item's surface (call set_current_item + mark_addressing), or, if it's a comment that requires action, fix the issue and add a follow-up item or carry on to the next.

POSITIVE OBLIGATION on receiving a comment: your FIRST move is a narrate() acknowledgement beat ("Got it, looking now" / "Good catch — checking the spacing rule") sent within one tool call. THEN investigate. Silence after a comment reads as ignoring it; the reviewer is parked in the drawer and only sees the CLAUDE feed.

${ASK_USER_CROSSREF}`,
    inputSchema: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } } },
  },
  {
    name: "mark_addressing",
    description: `Push an ARRIVAL narration to the CLAUDE feed for a specific item, paired with set_current_item. The reviewer sees the last ~5 lines, newest highlighted. Keep narrations one short sentence in plain language ("Driving you to /rides", "Showing the validation banner"). NOT a tool-call log.

THIS TOOL IS FOR ARRIVALS, NOT CONVERSATION.
- For acknowledgements, reasoning beats, or status chatter ("Got it — looking now", "Two ways to fix this; going with grid-rows", "HMR'ing, give it a sec"), use narrate() instead. mark_addressing carries arrival semantics (button visibility via 'arrived' flag, item association); narrate is just a feed line with no state effects.
- Use mark_addressing only when you've navigated the user to a specific surface and want to tell them what you're showing.

ARRIVED FLAG (controls when the action buttons unlock for the user):
- arrived: false → mid-drive narration. Buttons stay hidden, AWAITING CLAUDE strip persists. Use this for every narration WHILE you're still navigating to / loading / setting up the surface.
- arrived: true (default) → user can act on this item now. Buttons appear. Use this for the FINAL narration before you wait for the user's review (e.g. "Showing you the per-step wizard split — review now").

If you only narrate once per item (arrive immediately), omit the flag — the default is true. If you narrate multiple times during driving, pass arrived: false on all but the last.

${ASK_USER_CROSSREF}`,
    inputSchema: {
      type: "object",
      required: ["sessionId", "narration"],
      properties: {
        sessionId: { type: "string" },
        itemId: {
          type: "string",
          description:
            "Optional. Item the narration is about; usually the same id you just passed to set_current_item.",
        },
        narration: {
          type: "string",
          description:
            "One sentence in plain language. What the user would say if they were narrating their own screen. NOT a tool-call log line.",
        },
        arrived: {
          type: "boolean",
          description:
            'Default true. Pass false on mid-drive narrations to keep the action buttons hidden until the final "user can act now" narration.',
        },
      },
    },
  },
  {
    name: "narrate",
    description: `Push a CONVERSATIONAL beat to the CLAUDE feed at the bottom of the drawer. NO state changes — no pip flips, no button toggles, no arrival semantics. The line just lands in the feed and flashes briefly so the reviewer sees you're with them. Cheap to call; meant to be used freely between other tool calls.

THE BEATS THAT BELONG HERE:
- ACKNOWLEDGEMENT: "Good catch — that's a real issue."
- REASONING ALOUD: "Two ways: reserve space or animate height. Going with grid-rows."
- STATUS: "HMR'ing now, give it a sec." / "Running the test suite."
- BACKCHANNEL: "I see what you mean about the jank."
- THINKING ALOUD: "Hmm, that gap might be coming from the parent flex."

THE RULE:
The reviewer is parked in the drawer; they shouldn't have to look at the chat. The CLAUDE feed is the only channel they're watching. After ANY user comment, send an acknowledgement beat within one tool call BEFORE you investigate or fix — silence on a comment reads as ignoring it. While working a fix, send reasoning beats so they follow your thinking. Status beats before known short pauses ("HMR'ing", "running tests", "reading the file").

Heuristic: if you'd say it out loud watching over the reviewer's shoulder, send it to the feed.

WHEN TO USE narrate vs mark_addressing vs agent_address_comment vs ask_user:
- narrate(): conversational beats. No pip change, no button toggle. Fire freely between calls.
- mark_addressing(itemId): "I'm at this surface." Paired with set_current_item; toggles button visibility via the 'arrived' flag.
- agent_address_comment(itemId): "I think I've handled your comment." Flips the pip to cyan ↻; called after fixing or acknowledging a comment, before set_current_item.
- ask_user(question, options): "I need an answer to continue." Renders as a banner in the drawer with option buttons. Use whenever you'd otherwise reach for AskUserQuestion — narrate is for ambient reasoning, ask_user is for blocking questions.

Keep narrations one short sentence in plain conversational language.

${ASK_USER_CROSSREF}`,
    inputSchema: {
      type: "object",
      required: ["sessionId", "narration"],
      properties: {
        sessionId: { type: "string" },
        narration: {
          type: "string",
          description:
            "One short conversational sentence — what you'd say out loud watching over the reviewer's shoulder. Plain prose, not tool-call jargon.",
        },
        itemId: {
          type: "string",
          description:
            "Optional. Item the beat is about; lets the feed colocate it with related arrival narrations.",
        },
      },
    },
  },
  {
    name: "set_current_item",
    description:
      "Move the drawer's focused item to the given itemId. Call this immediately after you've navigated the user's tab to that item's surface, so the drawer cursor matches what they're looking at. Pair with mark_addressing — the drawer pill plus the agent feed are the user's only signal that the agent is working.",
    inputSchema: {
      type: "object",
      required: ["sessionId", "itemId"],
      properties: {
        sessionId: { type: "string" },
        itemId: {
          type: "string",
          description:
            "The id of the item the drawer should focus on. Must match an item from start_review/add_items.",
        },
      },
    },
  },
  {
    name: "ask_user",
    description: `Ask the human reviewer a question that needs an answer before you can continue. Renders as a banner in the drawer (replaces the action area) — the user picks an option button or types a free-form answer; the response arrives via the Monitor → get_unread_responses loop with kind: 'answer'.

WHEN TO USE THIS INSTEAD OF AskUserQuestion:
While ANY pitstop session is active, prefer ask_user over AskUserQuestion for questions related to the work in progress. AskUserQuestion hijacks the chat with a modal and pulls the user out of the flow they're already in (the drawer). ask_user surfaces the question where the user's eye already is.

DUAL-SURFACE RULE (required): whenever you call ask_user, ALSO render the FULL question + EVERY option (label + description, if any) as readable text in your chat reply. The chat is canonical history; the drawer is one UI surface, not the only one. The user might be looking at the terminal, not the drawer, and shouldn't have to scroll the drawer to re-read what they're answering. A one-line "I'm asking via the drawer" teaser is NOT enough — both surfaces should carry the same content so the user can answer from either. Don't use AskUserQuestion for the same question, that would double-prompt and hijack the modal anyway.

If you're certain there's no active pitstop session for this projectRoot, fall back to AskUserQuestion as normal.

Returns: { ok: true }. The answer comes back asynchronously through the responses queue. Drain via get_unread_responses; the answer entry will have kind: 'answer', body: <user's answer>, questionText: <the question you asked>.`,
    inputSchema: {
      type: "object",
      required: ["sessionId", "question"],
      properties: {
        sessionId: { type: "string" },
        question: {
          type: "string",
          description:
            'The question to put in front of the user. One sentence. End with "?". Plain text, no markdown.',
        },
        options: {
          type: "array",
          description:
            "Optional preset answers, rendered as full-width clickable cards (the list is scrollable when long). Each option has a `label` (short, ALL CAPS in the UI) and an optional `description` (longer explanation rendered under the label). Use description for choices that need context. Example: [{label:'Create one', description:'Spin up a fresh test order with default totals'}, {label:'Use existing', description:'Find one in /tmp/orders.json'}]. The user can also click 'Type a different answer' to fall through to free-form.",
          items: {
            type: "object",
            required: ["label"],
            properties: {
              label: {
                type: "string",
                description:
                  "Short tag for the choice. Becomes the answer body when the user clicks. Keep under ~30 chars.",
              },
              description: {
                type: "string",
                description:
                  "Optional sentence under the label that explains the choice. Use when the label alone is ambiguous.",
              },
            },
          },
        },
        itemId: {
          type: "string",
          description:
            "Optional review item this question is about. Persisted on the response so you can correlate.",
        },
      },
    },
  },
  {
    name: "wire_drawer",
    description: `Inspect a known project path, detect its framework, and return the two wiring options (committed vs local-only) for getting the pitstop drawer into the dev pages. The daemon is deliberately dumb: pass it a precise project root, get back snippets. Resolving WHICH path is the project is YOUR job — you have pwd, ls, and the user.

When to call (the user should not need to spell this out):
- start_review returned drawerStatus.connected === false. Use the SAME projectRoot you just used for start_review.
- The user asks any variant of "wire pitstop", "set up the drawer", "install the drawer".

Resolving projectRoot when the user didn't give you one:
1. Start at Bash pwd. Look at it: does it have package.json / nuxt.config.* / vite.config.* / index.html etc.? If yes, that's the projectRoot.
2. If not, it's probably a workspace wrapper. ls one level down: each subdirectory that has a recognisable framework config is a candidate.
   - Exactly one candidate → use it. Tell the user which path you picked, in case you guessed wrong.
   - Multiple candidates → ask the user via AskUserQuestion which one. Don't guess.
   - Zero candidates → ask the user where the project actually lives.
3. Once you have the path, call wire_drawer({ projectRoot }).

What to do with the result:
1. Surface the two options via AskUserQuestion. Use option.label as the AskUserQuestion option label, option.description as its description. Mark the option matching result.recommended with "(Recommended)". Surface result.notes (e.g. missing .gitignore line) as context.
2. After the user picks, YOU perform the file edit: paste option.snippet into option.file (creating the file if it doesn't exist; merging cleanly if it does — read the file first, find the right insertion point). If option.gitignoreLine is set and not already in .gitignore, append it.
3. Tell the user to reload their dev page, then re-run start_review.

Returns: { framework, projectRoot, options: [{id, label, description, file, snippet, gitignoreLine?}, ...], recommended: 'committed'|'local-only', notes: string[] }.

wire_drawer NEVER writes files — that's you, so the user can review your edit.`,
    inputSchema: {
      type: "object",
      required: ["projectRoot"],
      properties: {
        projectRoot: {
          type: "string",
          description:
            "Absolute path to the project. You're responsible for resolving this — see the tool description's 'Resolving projectRoot' section. Same shape as start_review.projectRoot.",
        },
      },
    },
  },
  {
    name: "complete_review",
    description:
      "End the review session. Flips the drawer status pill to REVIEW_COMPLETE. Call this only after every item has at least one response (approve or comment).",
    inputSchema: { type: "object", required: ["sessionId"], properties: { sessionId: { type: "string" } } },
  },
  {
    name: "agent_address_comment",
    description: `Mark that you've HANDLED a user comment on an item — fix shipped, decided-not-to-act with reason given, or otherwise consciously closed the loop. Pushes a response of kind "agent-addressed" onto the item, which flips the amber pip to a third color (cyan ↻ — distinct from amber/commented and from green/approved) and lands a narration in the CLAUDE feed.

THIS IS THE "I'M DONE WITH IT" SIGNAL — NOT THE EARLY-ACK SIGNAL.
- For early acknowledgement BEFORE you investigate ("Got it, looking now" / "Good catch — checking"), use narrate() instead. narrate doesn't flip the pip, so the user's amber comment stays amber until you've actually addressed it.
- For mid-fix progress beats ("Two ways to fix this; going with grid-rows", "HMR'ing"), use narrate() — same reason.
- Use agent_address_comment ONLY when there's nothing more for the agent to do on the comment. The pip color carries the "considered" semantics; flipping it pre-fix is dishonest.

WHEN TO CALL — after EVERY user comment, AFTER you've actually handled it:
- Fix-required + you've shipped the fix → call this with the fix description.
- Approval-by-comment ("yes unchanged", "looks good") → call this with "Noted — confirmed correct."
- Disagreement-but-deferring → call this with the reason ("Hearing you — keeping pattern; flagged for separate review.").
- Concern parked for later → call this with the parking note ("Captured — addressing after this round.").

WHEN NOT TO CALL:
- For early acknowledgement before investigation. → narrate()
- For mid-fix progress beats. → narrate()
- After a LOOKS_GOOD click (response kind: "approve"): pip is already green; this would override their approval. Skip.
- When the user hasn't responded yet: stay on item X, wait for the next Monitor notification. NO scenario where set_current_item with an unaddressed amber pip is correct.

PAIRING WITH mark_addressing:
After agent_address_comment closes the comment, if you've shipped a fix the user should re-check, call mark_addressing(itemId, arrived: true, "Refresh to confirm") — that's what unlocks the action buttons again. agent_address_comment alone doesn't unlock buttons (intentional — pip flip is the agent's signal; user still needs to click LOOKS_GOOD to finalize).

NOT a substitute for user approval — they retain final say (clicking LOOKS_GOOD on the cyan ↻ flips it to green).

${ASK_USER_CROSSREF}`,
    inputSchema: {
      type: "object",
      required: ["sessionId", "itemId", "narration"],
      properties: {
        sessionId: { type: "string" },
        itemId: {
          type: "string",
          description: "The item whose user comment you've addressed.",
        },
        narration: {
          type: "string",
          description:
            "One sentence explaining what you fixed. Lands in the AgentFeed. E.g. 'Switched the date format to YYYY-MM-DD per your comment.'",
        },
      },
    },
  },
  {
    name: "set_drawer",
    description: `Reposition or resize the pitstop drawer. Use this when the drawer is covering UI you need to interact with — most commonly when an automated click fails because <pitstop-drawer> is the obscuring element. The drawer host carries data-pitstop="drawer" so blocking-element checks can identify it specifically.

WHEN TO USE:
- Your click was blocked and the obscuring element is or contains <pitstop-drawer>. Switch sides (right ↔ left), or collapse to strip, then retry the click.
- The user is interacting with a region of their app that the drawer is permanently in the way of (e.g. a right-side cart on a host app while drawer is also pinned right).
- BEFORE force-clicking via JS. Force-clicks skip the genuine UI interactions the user wants to verify; moving the drawer first preserves the real flow.

The narration is REQUIRED — it's appended to the agent feed at the bottom of the drawer so the user knows why the chrome just shifted. Plain language, one short sentence ("Drawer covered the Place Order button — switching to left."). Without it, the move looks like a glitch.

Persists to the same localStorage the drawer's chrome buttons write to, so the change survives reload. Pass at least one of position/size; both is fine.

${ASK_USER_CROSSREF}`,
    inputSchema: {
      type: "object",
      required: ["sessionId", "narration"],
      properties: {
        sessionId: { type: "string" },
        position: {
          type: "string",
          enum: ["right", "left", "floating"],
          description: "Where to dock the drawer. Omit to leave position unchanged.",
        },
        size: {
          type: "string",
          enum: ["standard", "compact", "strip"],
          description: "Drawer size. 'strip' minimizes to a 32px rail. Omit to leave size unchanged.",
        },
        narration: {
          type: "string",
          description:
            "REQUIRED. One-sentence reason for the move. Lands in the AgentFeed so the user isn't surprised. E.g. 'Cart button is under the drawer — moving to left.'",
        },
      },
    },
  },
];

const server = new Server({ name: "pitstop", version: "0.3.50" }, { capabilities: { tools: {} } });

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
