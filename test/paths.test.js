import assert from "node:assert/strict";
import test from "node:test";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { latestRawDir } from "../src/cli.js";
import { DEFAULT_OUTPUT_DIR, PROJECT_DIR } from "../src/paths.js";

const SNAPSHOT_FILES = [
  "login.json",
  "quota.json",
  "today.json",
  "stats-summary.json",
  "usage-logs.json",
];

async function createSnapshot(rootDir, name, complete) {
  const directory = path.join(rootDir, name);
  await fs.mkdir(directory, { recursive: true });
  for (const file of complete ? SNAPSHOT_FILES : SNAPSHOT_FILES.slice(0, -1)) {
    await fs.writeFile(path.join(directory, file), "{}\n");
  }
  return directory;
}

test("default output is isolated under output/", () => {
  assert.equal(DEFAULT_OUTPUT_DIR, path.join(PROJECT_DIR, "output"));
});

test("latestRawDir searches only complete snapshots under its output root", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-hub-paths-"));
  try {
    const completeDir = await createSnapshot(rootDir, "cc-hub-raw-complete", true);
    await createSnapshot(rootDir, "cc-hub-raw-incomplete", false);
    assert.equal(await latestRawDir(rootDir), completeDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
