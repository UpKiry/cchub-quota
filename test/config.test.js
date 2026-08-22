import assert from "node:assert/strict";
import test from "node:test";

import { parseConfig } from "../src/config.js";

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
