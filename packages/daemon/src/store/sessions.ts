import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { type Session, SessionZ, type Item } from '@pitstop/shared';
import { writeAtomic } from './atomic';

type CreateInput = {
  projectRoot: string;
  branch?: string;
  items: Array<Omit<Item, 'index'> & { index?: number }>;
  clientSessionId?: string;
};

/** CRUD store for sessions, persisted as JSON files under `dataDir/sessions/`. */
export class Store {
  private sessionsDir: string;

  constructor(dataDir: string) {
    this.sessionsDir = join(dataDir, 'sessions');
  }

  private path(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }

  async create(input: CreateInput): Promise<Session> {
    const now = Date.now();
    const session: Session = {
      id: nanoid(8),
      projectRoot: input.projectRoot,
      branch: input.branch,
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      items: input.items.map((it, i) => ({
        id: it.id ?? String(i + 1).padStart(2, '0'),
        index: it.index ?? i + 1,
        title: it.title,
        body: it.body,
        question: it.question,
        attachments: it.attachments ?? [],
      })),
      responses: [],
      agentActivity: [],
      clientSessionId: input.clientSessionId,
    };
    SessionZ.parse(session);
    await writeAtomic(this.path(session.id), JSON.stringify(session, null, 2));
    return session;
  }

  async get(id: string): Promise<Session | null> {
    const p = this.path(id);
    if (!existsSync(p)) return null;
    return SessionZ.parse(JSON.parse(await readFile(p, 'utf8')));
  }

  async list(): Promise<Session[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const files = await readdir(this.sessionsDir);
    const sessions: Session[] = [];
    for (const f of files) {
      if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
      const s = await this.get(f.replace(/\.json$/, ''));
      if (s) sessions.push(s);
    }
    return sessions;
  }

  /** Returns the first non-complete session for the given `projectRoot`, or null. */
  async getActive(projectRoot: string): Promise<Session | null> {
    const all = await this.list();
    return all.find((s) => s.projectRoot === projectRoot && s.status !== 'complete') ?? null;
  }

  async update(id: string, updater: (s: Session) => Session): Promise<Session> {
    const cur = await this.get(id);
    if (!cur) throw new Error(`session ${id} not found`);
    const next = { ...updater(cur), updatedAt: Date.now() };
    SessionZ.parse(next);
    await writeAtomic(this.path(id), JSON.stringify(next, null, 2));
    return next;
  }
}
