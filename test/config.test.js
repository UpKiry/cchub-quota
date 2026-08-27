import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfiguredOutputDir, parseConfig } from "../src/config.js";

test("parseConfig supports the existing assignment format without shell expansion", () => {
  const config = parseConfig(`
    # comment
    CCH_URL="https://hub.example.test/"
    export CCH_API_KEY='key-$HOME-"quoted"'
    CCH_RAW_OUTPUT_DIR=./snapshots # optional
    IGNORED_VALUE=$(touch /tmp/should-never-run)
  `);

  assert.deepEqual(config, {
    CCH_URL: "https://hub.example.test/",
    CCH_API_KEY: 'key-$HOME-"quoted"',
    CCH_RAW_OUTPUT_DIR: "./snapshots",
  });
});

test("parseConfig rejects malformed active lines", () => {
  assert.throws(
    () => parseConfig("CCH_URL https://example.test"),
    /第 1 行格式无效/,
  );
});

test("loadConfiguredOutputDir resolves a path without requiring credentials", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-hub-config-"));
  const configFile = path.join(rootDir, "cc-hub-usage.conf");
  try {
    await fs.writeFile(configFile, "CCH_RAW_OUTPUT_DIR=./snapshots\n");
    assert.equal(await loadConfiguredOutputDir(configFile), path.join(rootDir, "snapshots"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
