import { z } from "zod";

export const AttachmentZ = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file-ref"),
    path: z.string(),
    line: z.number().int().positive().optional(),
    diffStats: z.object({ add: z.number(), rem: z.number(), hunks: z.number() }).optional(),
  }),
  z.object({ kind: z.literal("image"), src: z.string(), caption: z.string().optional() }),
  z.object({ kind: z.literal("link"), href: z.string().url(), label: z.string() }),
]);

export const ItemZ = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  title: z.string().min(1),
  /** Markdown-rendered prose body. Lead with WHY this changed, in 1–3 sentences. */
  body: z.string(),
  /** UX/visual things the reviewer should specifically watch for on this surface. */
  lookFor: z.array(z.string()).default([]),
  /** @deprecated Removed in v0.3.5 — agents now mention test info inline in
   *  `body` ("Already tested: <thing>.") when non-obvious. Retained in the
   *  schema for backwards compat with v0.2/v0.3 sessions on disk; the drawer
   *  no longer renders it. */
  tested: z.array(z.string()).default([]),
  /** Open trade-offs or things the agent is unsure about — flag for the reviewer. */
  concerns: z.array(z.string()).default([]),
  question: z.string().optional(),
  attachments: z.array(AttachmentZ).default([]),
});

export const ResponseZ = z.object({
  itemId: z.string(),
  kind: z.enum(["approve", "comment", "answer"]),
  body: z.string().optional(),
  /** Set when kind === 'answer' — the question text the user was responding
   *  to. Helps the agent correlate without relying on session-state ordering. */
  questionText: z.string().optional(),
  at: z.number(),
  addressed: z.boolean(),
});

/** A single preset answer for a pending question. The user clicks the card
 *  to submit `label` as their answer. `description` is optional secondary
 *  text below the label, useful when the choice needs more context than
 *  fits in a button label. */
export const PendingQuestionOptionZ = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
});

/** A question the agent has posed to the user via `ask_user`. The drawer
 *  surfaces this as a banner replacing the action area. Cleared when the
 *  user submits an answer. */
export const PendingQuestionZ = z.object({
  question: z.string().min(1),
  options: z.array(PendingQuestionOptionZ).default([]),
  itemId: z.string().optional(),
  askedAt: z.number(),
});

export const ActivityEntryZ = z.object({
  at: z.number(),
  tool: z.string(),
  narration: z.string().optional(),
  /** Item the activity is about. mark_addressing's `itemId` param persists
   *  here so the drawer can tell whether the *current* item has been
   *  addressed yet (ergo buttons can show), vs the agent still driving. */
  itemId: z.string().optional(),
  /** Set on mark_addressing entries. `false` = mid-drive narration, drawer
   *  keeps buttons hidden (AWAITING CLAUDE strip stays). Missing or `true`
   *  = the user can now act on this item; buttons appear. Default true for
   *  backwards compat with v0.3.13–v0.3.20 callers. */
  arrived: z.boolean().optional(),
});

export const SessionStatusZ = z.enum(["idle", "active", "paused", "complete"]);

export const SessionZ = z.object({
  id: z.string(),
  projectRoot: z.string(),
  branch: z.string().optional(),
  /** Origins (e.g. `http://localhost:3000`) where this review's surfaces live.
   *  When set, the drawer (loaded via extension on any localhost tab) only
   *  shows on tabs whose `location.origin` is in this list. Empty = loose
   *  mode: the drawer matches any localhost tab. */
  devUrls: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
  status: SessionStatusZ,
  items: z.array(ItemZ),
  responses: z.array(ResponseZ),
  agentActivity: z.array(ActivityEntryZ),
  /** Most-recent Claude Code session id seen on an MCP forward, used as `claude --resume` target. */
  clientSessionId: z.string().optional(),
  /** PID of the in-flight poke subprocess, if any. */
  pokePid: z.number().optional(),
  /** Timestamp when the in-flight poke was spawned (for POKE_FAILED detection). */
  pokeSpawnedAt: z.number().optional(),
  /** True when a spawned poke didn't elicit any agent activity within the watch window. */
  pokeFailed: z.boolean().default(false).optional(),
  /** Timestamp of the most recent MCP/RPC tool call landing for this session. */
  lastAgentActivityAt: z.number().optional(),
  /** The agent's authoritative cursor — which item should the drawer focus.
   *  When unset (legacy sessions), the drawer falls back to its local cursor.
   *  Updated by the agent via the (Phase B) `set_current_item` MCP tool. */
  currentItemId: z.string().optional(),
  /** Set by `ask_user`; cleared when an `answer` response is received. The
   *  drawer renders this as a prominent banner replacing the action area. */
  pendingQuestion: PendingQuestionZ.optional(),
});

export type Attachment = z.infer<typeof AttachmentZ>;
export type Item = z.infer<typeof ItemZ>;
export type Response = z.infer<typeof ResponseZ>;
export type ActivityEntry = z.infer<typeof ActivityEntryZ>;
export type SessionStatus = z.infer<typeof SessionStatusZ>;
export type Session = z.infer<typeof SessionZ>;
export type PendingQuestion = z.infer<typeof PendingQuestionZ>;
export type PendingQuestionOption = z.infer<typeof PendingQuestionOptionZ>;

/** SSE event payloads pushed from daemon → browser. */
export type SseEvent =
  | { type: "state-snapshot"; session: Session }
  | { type: "state-changed"; session: Session }
  | { type: "item-added"; sessionId: string; items: Item[] }
  | { type: "agent-activity"; sessionId: string; entry: ActivityEntry }
  | { type: "complete"; sessionId: string }
  /**
   * Published on the project-scoped lobby channel when a new session is
   * created for a projectRoot. Lets a drawer that was mounted before the
   * session existed react instantly instead of waiting for a manual reload.
   */
  | { type: "session-hello"; session: Session };

export type PokeKind =
  | { kind: "claude-resume" }
  | { kind: "webhook"; url: string }
  | { kind: "script"; command: string; args?: string[] };

export type PitstopConfig = {
  port: number;
  poke: PokeKind;
  editor: "cursor" | "vscode" | "jetbrains" | "none";
  drawer: { position: "right" | "left" | "floating"; size: "standard" | "compact" | "strip"; width: number };
  theme: "auto" | "dark" | "light";
};
