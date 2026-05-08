import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";

/** Writes `data` to `path` atomically via a tmp-file + rename. Caller must
 *  ensure `dirname(path)` exists; this avoids a redundant mkdir syscall on
 *  every write (Store creates its sessionsDir lazily on first write).
 *
 *  Temp name uses crypto.randomUUID() rather than Date.now() — two writes
 *  from the same process within a millisecond would otherwise share the
 *  same tmp path, and the second's tmp gets overwritten before its
 *  rename, surfacing as ENOENT. */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp.${randomUUID()}`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, path);
}
