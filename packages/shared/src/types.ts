import { z } from 'zod';

export const AttachmentZ = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file-ref'),
    path: z.string(),
    line: z.number().int().positive().optional(),
    diffStats: z.object({ add: z.number(), rem: z.number(), hunks: z.number() }).optional(),
  }),
  z.object({ kind: z.literal('image'), src: z.string(), caption: z.string().optional() }),
  z.object({ kind: z.literal('link'), href: z.string().url(), label: z.string() }),
]);

export const ItemZ = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string(),
  question: z.string().optional(),
  attachments: z.array(AttachmentZ).default([]),
});

export const ResponseZ = z.object({
  itemId: z.string(),
  kind: z.enum(['approve', 'comment']),
  body: z.string().optional(),
  at: z.number(),
  addressed: z.boolean(),
});

export const ActivityEntryZ = z.object({
  at: z.number(),
  tool: z.string(),
  narration: z.string().optional(),
});

export const SessionStatusZ = z.enum(['idle', 'active', 'paused', 'complete']);

export const SessionZ = z.object({
  id: z.string(),
  projectRoot: z.string(),
  branch: z.string().optional(),
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
});

export type Attachment = z.infer<typeof AttachmentZ>;
export type Item = z.infer<typeof ItemZ>;
export type Response = z.infer<typeof ResponseZ>;
export type ActivityEntry = z.infer<typeof ActivityEntryZ>;
export type SessionStatus = z.infer<typeof SessionStatusZ>;
export type Session = z.infer<typeof SessionZ>;

/** SSE event payloads pushed from daemon → browser. */
export type SseEvent =
  | { type: 'state-snapshot'; session: Session }
  | { type: 'state-changed'; session: Session }
  | { type: 'item-added'; sessionId: string; items: Item[] }
  | { type: 'agent-activity'; sessionId: string; entry: ActivityEntry }
  | { type: 'complete'; sessionId: string };

export type PokeKind =
  | { kind: 'claude-resume' }
  | { kind: 'webhook'; url: string }
  | { kind: 'script'; command: string; args?: string[] };

export type PitstopConfig = {
  port: number;
  poke: PokeKind;
  editor: 'cursor' | 'vscode' | 'jetbrains' | 'none';
  drawer: { position: 'right' | 'left' | 'floating'; size: 'standard' | 'compact' | 'strip'; width: number };
  theme: 'auto' | 'dark' | 'light';
  session: { retentionDays: number };
};
