import { rename, writeFile } from "node:fs/promises";

/** Writes `data` to `path` atomically via a tmp-file + rename. Caller must
 *  ensure `dirname(path)` exists; this avoids a redundant mkdir syscall on
 *  every write (Store creates its sessionsDir lazily on first write). */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, path);
}
