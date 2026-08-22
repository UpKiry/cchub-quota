import assert from "node:assert/strict";
import test from "node:test";

import { buildReport, formatMoney } from "../src/report.js";

function fixture() {
  return {
    "login.json": { loginType: "readonly_user", user: { name: "A|B", role: "user" } },
    "quota.json": {
      userProviderGroup: "gpt",
      keyIsEnabled: true,
      keyCurrent5hUsd: 0.1,
      keyLimit5hUsd: null,
    },
    "today.json": {
      calls: 2,
      costUsd: 0.3,
      inputTokens: 1_200,
      outputTokens: 20,
      currencyCode: "CNY",
      modelBreakdown: [
        { model: "cheap", calls: 1, costUsd: 0.01, inputTokens: 100, outputTokens: 10 },
        { model: "costly", calls: 1, costUsd: 0.29, inputTokens: 1_100, outputTokens: 10 },
      ],
    },
    "stats-summary.json": { totalRequests: 2, totalCost: 0.3, currencyCode: "CNY" },
    "usage-logs.json": {
      items: [
        { createdAt: "2026-08-22T16:30:00.123Z", model: "costly", endpoint: "/v1/responses", statusCode: 201, cost: 0.29, duration: 1_250 },
        { createdAt: "2026-08-22T16:29:00.000Z", model: "cheap", endpoint: "/v1/responses", statusCode: 500, cost: 0.01, duration: 12 },
      ],
      pageInfo: { hasMore: false },
    },
  };
}

test("report sorts numeric costs, converts timestamps and escapes Markdown", () => {
  const report = buildReport(fixture(), "/tmp/raw", {
    maxLogs: 1,
    now: new Date("2026-08-22T16:40:00.000Z"),
  });

  assert.match(report, /\| 用户名 \| A\\\|B \|/);
  assert.ok(report.indexOf("costly") < report.indexOf("cheap"));
  assert.match(report, /2026-08-23 00:30:00\.123/);
  assert.match(report, /> 异常记录：1 条。/);
  assert.match(report, /共 2 条，报告展示最新 1 条/);
});

test("money distinguishes unlimited from missing and removes meaningless zero padding", () => {
  assert.equal(formatMoney(null, "CNY"), "无限制");
  assert.equal(formatMoney(undefined, "CNY"), "-");
  assert.equal(formatMoney(0.1, "CNY"), "0.1 CNY");
});
