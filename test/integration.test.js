import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CCHubClient } from "../src/cc-hub-client.js";
import { collectData } from "../src/collector.js";
import { renderReport } from "../src/report.js";

const CURSOR = Buffer.from(JSON.stringify({
  createdAt: "2026-08-23T00:00:00.000Z",
  id: 101,
})).toString("base64url");

function responseJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function permission(pathname) {
  return (await fs.stat(pathname)).mode & 0o777;
}

test("collectData and renderReport complete a local HTTP-to-files workflow", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      const body = request.method === "POST" ? await requestBody(request) : "";
      requests.push({
        method: request.method,
        pathname: requestUrl.pathname,
        search: requestUrl.searchParams,
        body,
        cookie: request.headers.cookie,
      });

      if (requestUrl.pathname === "/api/auth/login") {
        assert.equal(request.method, "POST");
        assert.deepEqual(JSON.parse(body), { key: 'integration-"key"' });
        responseJson(response, 200, {
          ok: true,
          loginType: "readonly_user",
          user: { name: "integration", role: "user" },
        }, {
          "set-cookie": "auth-token=integration-session; Path=/; HttpOnly; SameSite=Lax",
        });
        return;
      }

      assert.equal(request.headers.cookie, "auth-token=integration-session");
      if (requestUrl.pathname === "/api/v1/me/quota") {
        responseJson(response, 200, {
          userProviderGroup: "gpt",
          keyIsEnabled: true,
          keyCurrent5hUsd: 0.25,
          keyLimit5hUsd: null,
          keyCurrentDailyUsd: 0.25,
          keyLimitDailyUsd: null,
          keyCurrentWeeklyUsd: 0.25,
          keyLimitWeeklyUsd: null,
          keyCurrentMonthlyUsd: 0.25,
          keyLimitMonthlyUsd: null,
          keyCurrentTotalUsd: 0.25,
          keyLimitTotalUsd: null,
        });
        return;
      }
      if (requestUrl.pathname === "/api/v1/me/today") {
        responseJson(response, 200, {
          calls: 2,
          costUsd: 0.25,
          inputTokens: 1_000,
          outputTokens: 200,
          currencyCode: "CNY",
          modelBreakdown: [
            { model: "integration-model", calls: 2, costUsd: 0.25, inputTokens: 1_000, outputTokens: 200 },
          ],
        });
        return;
      }
      if (requestUrl.pathname === "/api/v1/me/usage-logs/stats-summary") {
        assert.equal(requestUrl.searchParams.get("startDate"), "2026-08-22");
        assert.equal(requestUrl.searchParams.get("endDate"), "2026-08-23");
        responseJson(response, 200, { totalRequests: 2, totalCost: 0.25, currencyCode: "CNY" });
        return;
      }
      if (requestUrl.pathname === "/api/v1/me/usage-logs") {
        assert.equal(requestUrl.searchParams.get("startDate"), "2026-08-22");
        assert.equal(requestUrl.searchParams.get("endDate"), "2026-08-23");
        assert.equal(requestUrl.searchParams.get("limit"), "100");
        if (!requestUrl.searchParams.has("cursorCreatedAt")) {
          responseJson(response, 200, {
            items: [{
              id: 102,
              createdAt: "2026-08-23T00:01:00.000Z",
              model: "integration-model",
              endpoint: "/v1/responses",
              statusCode: 200,
              cost: 0.15,
              duration: 500,
            }],
            pageInfo: { hasMore: true, nextCursor: CURSOR, limit: 100 },
          });
        } else {
          assert.equal(requestUrl.searchParams.get("cursorCreatedAt"), "2026-08-23T00:00:00.000Z");
          assert.equal(requestUrl.searchParams.get("cursorId"), "101");
          responseJson(response, 200, {
            items: [{
              id: 101,
              createdAt: "2026-08-23T00:00:00.000Z",
              model: "integration-model",
              endpoint: "/v1/responses",
              statusCode: 500,
              cost: 0.1,
              duration: 1_500,
            }],
            pageInfo: { hasMore: false, nextCursor: null, limit: 100 },
          });
        }
        return;
      }
      responseJson(response, 404, { detail: "not found" });
    } catch (error) {
      responseJson(response, 500, { detail: error instanceof Error ? error.message : String(error) });
    }
  });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-hub-integration-"));
  const rawDir = path.join(workDir, "raw");
  const reportDir = path.join(workDir, "report");
  const port = await listen(server);

  try {
    const client = new CCHubClient({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'integration-"key"',
    });
    await collectData({
      client,
      startDate: "2026-08-22",
      endDate: "2026-08-23",
      outputDir: rawDir,
    });
    const reportFile = await renderReport(rawDir, {
      outputDir: reportDir,
      maxLogs: 2,
      now: new Date("2026-08-23T01:00:00.000Z"),
    });

    assert.deepEqual(requests.map(({ method, pathname }) => `${method} ${pathname}`), [
      "POST /api/auth/login",
      "GET /api/v1/me/quota",
      "GET /api/v1/me/today",
      "GET /api/v1/me/usage-logs/stats-summary",
      "GET /api/v1/me/usage-logs",
      "GET /api/v1/me/usage-logs",
    ]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(rawDir, "usage-logs.json"))).items.map((item) => item.id), [102, 101]);
    assert.equal(await permission(rawDir), 0o700);
    for (const name of ["login", "quota", "today", "stats-summary", "usage-logs"]) {
      assert.equal(await permission(path.join(rawDir, `${name}.json`)), 0o600);
    }
    const report = await fs.readFile(reportFile, "utf8");
    assert.match(report, /今日调用 \| 2/);
    assert.match(report, /共 2 条，报告展示最新 2 条/);
    assert.match(report, /异常记录：1 条/);
    assert.equal(await permission(reportDir), 0o700);
    assert.equal(await permission(reportFile), 0o600);
  } finally {
    await close(server);
    await fs.rm(workDir, { recursive: true, force: true });
  }
});
