import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function writeAtomicFile(outputFile, content) {
  const temporaryFile = `${outputFile}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryFile, content, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(temporaryFile, 0o600);
    await fs.rename(temporaryFile, outputFile);
  } catch (error) {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
    throw error;
  }
}
