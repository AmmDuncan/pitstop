import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { type Item, type Session, SessionZ } from "@pitstop/shared";
import { nanoid } from "nanoid";
import { writeAtomic } from "./atomic";

type CreateInput = {
  projectRoot: string;
  branch?: string;
  devUrls?: string[];
  items: Array<Omit<Item, "index"> & { index?: number }>;
  clientSessionId?: string;
};

/** CRUD store for sessions, persisted as JSON files under `dataDir/sessions/`. */
export class Store {
  private sessionsDir: string;
  /** Lazy mkdir guard — first write triggers directory creation, subsequent
   *  writes skip the syscall. Cheaper than `mkdir({ recursive: true })` on
   *  every writeAtomic call (which used to fire 5–10 times per MCP tool). */
  private dirReady = false;

  constructor(dataDir: string) {
    this.sessionsDir = join(dataDir, "sessions");
  }

  private path(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(this.sessionsDir, { recursive: true });
    this.dirReady = true;
  }

  async create(input: CreateInput): Promise<Session> {
    const now = Date.now();
    const session: Session = {
      id: nanoid(8),
      projectRoot: input.projectRoot,
      branch: input.branch,
      devUrls: input.devUrls ?? [],
      createdAt: now,
      updatedAt: now,
      status: "idle",
      items: input.items.map((it, i) => ({
        id: it.id ?? String(i + 1).padStart(2, "0"),
        index: it.index ?? i + 1,
        title: it.title,
        body: it.body,
        lookFor: it.lookFor ?? [],
        tested: it.tested ?? [],
        concerns: it.concerns ?? [],
        question: it.question,
        attachments: it.attachments ?? [],
      })),
      responses: [],
      agentActivity: [],
      clientSessionId: input.clientSessionId,
    };
    SessionZ.parse(session);
    await this.ensureDir();
    await writeAtomic(this.path(session.id), JSON.stringify(session, null, 2));
    return session;
  }

  async get(id: string): Promise<Session | null> {
    const p = this.path(id);
    if (!existsSync(p)) return null;
    return SessionZ.parse(JSON.parse(await readFile(p, "utf8")));
  }

  async list(): Promise<Session[]> {
    if (!existsSync(this.sessionsDir)) return [];
    const files = (await readdir(this.sessionsDir)).filter(
      (f) => f.endsWith(".json") && !f.endsWith(".tmp"),
    );
    // Parallel reads — readdir just enumerated these files so the inner
    // existsSync that `get()` does is redundant. readFile directly and let
    // a missing file (race with delete) collapse to null via the catch.
    const reads = files.map(async (f): Promise<Session | null> => {
      try {
        return SessionZ.parse(JSON.parse(await readFile(join(this.sessionsDir, f), "utf8")));
      } catch {
        return null;
      }
    });
    return (await Promise.all(reads)).filter((s): s is Session => s !== null);
  }

  /** Returns the first non-complete session for the given `projectRoot`, or null. */
  async getActive(projectRoot: string): Promise<Session | null> {
    const all = await this.list();
    return all.find((s) => s.projectRoot === projectRoot && s.status !== "complete") ?? null;
  }

  async update(id: string, updater: (s: Session) => Session): Promise<Session> {
    const cur = await this.get(id);
    // Throw "NOT_FOUND" specifically — the /api/rpc handler maps this string
    // to HTTP 404. Anything else falls through to 500. Callers can drop their
    // own pre-flight `if (!session) throw` and rely on this throw instead.
    if (!cur) throw new Error("NOT_FOUND");
    const next = { ...updater(cur), updatedAt: Date.now() };
    SessionZ.parse(next);
    await this.ensureDir();
    await writeAtomic(this.path(id), JSON.stringify(next, null, 2));
    return next;
  }

  /** Remove a session's JSON file from disk. No-op if the file isn't there. */
  async delete(id: string): Promise<void> {
    const p = this.path(id);
    if (!existsSync(p)) return;
    await unlink(p);
  }
}
