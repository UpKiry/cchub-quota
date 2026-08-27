import assert from "node:assert/strict";
import test from "node:test";

import { CCHubClient } from "../src/cc-hub-client.js";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("client exchanges the login key for an auth cookie and never sends the raw key on GET", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.toString(), options });
    if (url.pathname === "/api/auth/login") {
      return jsonResponse({ ok: true }, {
        headers: { "set-cookie": "auth-token=session-123; Path=/; HttpOnly; SameSite=Lax" },
      });
    }
    return jsonResponse({ keyIsEnabled: true });
  };
  const client = new CCHubClient({
    baseUrl: "https://hub.example.test",
    apiKey: 'raw-"key"',
    fetchImpl,
  });

  await client.login();
  await client.getQuota();

  assert.equal(JSON.parse(calls[0].options.body).key, 'raw-"key"');
  assert.equal(calls[1].options.headers.get("cookie"), "auth-token=session-123");
  assert.equal(calls[1].options.headers.get("x-api-key"), null);
  assert.equal(calls[1].url, "https://hub.example.test/api/v1/me/quota");
});

test("client follows usage-log cursors and merges all pages", async () => {
  const requestedCursors = [];
  const nextCursor = Buffer.from(JSON.stringify({
    createdAt: "2026-08-22T22:17:02.669566Z",
    id: 33826,
  })).toString("base64url");
  const fetchImpl = async (url) => {
    requestedCursors.push({
      createdAt: url.searchParams.get("cursorCreatedAt"),
      id: url.searchParams.get("cursorId"),
    });
    if (!url.searchParams.has("cursorCreatedAt")) {
      return jsonResponse({ items: [{ id: 1 }], pageInfo: { hasMore: true, nextCursor, limit: 100 } });
    }
    return jsonResponse({ items: [{ id: 2 }], pageInfo: { hasMore: false, nextCursor: null, limit: 100 } });
  };
  const client = new CCHubClient({
    baseUrl: "https://hub.example.test",
    apiKey: "unused",
    fetchImpl,
  });
  client.cookie = "auth-token=session-123";

  const result = await client.getAllUsageLogs("2026-08-01", "2026-08-23");

  assert.deepEqual(requestedCursors, [
    { createdAt: null, id: null },
    { createdAt: "2026-08-22T22:17:02.669566Z", id: "33826" },
  ]);
  assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }]);
  assert.equal(result.pageInfo.fetchedItems, 2);
  assert.equal(result.pageInfo.fetchedPages, 2);
});

test("client rejects a successful login without auth-token", async () => {
  const client = new CCHubClient({
    baseUrl: "https://hub.example.test",
    apiKey: "key",
    fetchImpl: async () => jsonResponse({ ok: true }),
  });
  await assert.rejects(() => client.login(), /没有 auth-token Cookie/);
});

test("client retries transient GET failures with an injected delay", async () => {
  let attempts = 0;
  const client = new CCHubClient({
    baseUrl: "https://hub.example.test",
    apiKey: "unused",
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? jsonResponse({ detail: "temporary" }, { status: 503, headers: { "retry-after": "0" } })
        : jsonResponse({ calls: 3 });
    },
    sleepImpl: async () => {},
  });

  assert.deepEqual(await client.getToday(), { calls: 3 });
  assert.equal(attempts, 2);
});

test("client retries transient response-body failures for GET requests", async () => {
  let attempts = 0;
  const client = new CCHubClient({
    baseUrl: "https://hub.example.test",
    apiKey: "unused",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return {
          status: 200,
          ok: true,
          headers: new Headers(),
          text: async () => {
            throw new TypeError("body reset");
          },
        };
      }
      return jsonResponse({ calls: 3 });
    },
    sleepImpl: async () => {},
  });

  assert.deepEqual(await client.getToday(), { calls: 3 });
  assert.equal(attempts, 2);
});

test("client does not retry login POST failures", async () => {
  let attempts = 0;
  const client = new CCHubClient({
    baseUrl: "https://hub.example.test",
    apiKey: "key",
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse({ detail: "temporary" }, { status: 503 });
    },
    sleepImpl: async () => {},
  });

  await assert.rejects(() => client.login(), /HTTP 503/);
  assert.equal(attempts, 1);
});

test("client rejects malformed known response fields", async () => {
  const client = new CCHubClient({
    baseUrl: "https://hub.example.test",
    apiKey: "unused",
    fetchImpl: async () => jsonResponse({ calls: "three" }),
  });

  await assert.rejects(() => client.getToday(), /字段 calls 的类型无效/);
});
