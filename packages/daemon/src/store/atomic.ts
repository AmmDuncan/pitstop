import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Writes `data` to `path` atomically via a tmp-file + rename. */
export async function writeAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, path);
}
