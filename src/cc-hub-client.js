import { AppError, asErrorMessage } from "./errors.js";

function ensureObject(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(`${context} 返回的 JSON 顶层不是对象。`);
  }
  return value;
}

function extractAuthCookie(headers) {
  const setCookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  for (const setCookie of setCookies) {
    const match = /(?:^|[,;]\s*)auth-token=([^;,\s]+)/.exec(setCookie);
    if (match) {
      return `auth-token=${match[1]}`;
    }
  }
  return undefined;
}

function decodeCursor(token) {
  try {
    const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (
      value
      && typeof value === "object"
      && typeof value.createdAt === "string"
      && Number.isSafeInteger(Number(value.id))
      && Number(value.id) > 0
    ) {
      return { createdAt: value.createdAt, id: String(value.id) };
    }
  } catch {
    // The server must return a valid opaque cursor token when hasMore is true.
  }
  throw new AppError("调用日志返回了无法解析的分页游标。");
}

export class CCHubClient {
  constructor({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 60_000 }) {
    if (typeof fetchImpl !== "function") {
      throw new AppError("当前 Node.js 环境不支持 fetch。", { exitCode: 2 });
    }
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cookie = undefined;
  }

  async request(pathname, options = {}) {
    const url = new URL(pathname, `${this.baseUrl}/`);
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (this.cookie) {
      headers.set("Cookie", this.cookie);
    }

    let response;
    try {
      response = await this.fetchImpl(url, {
        ...options,
        headers,
        signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AppError(`无法连接 ${url.origin}${url.pathname}：${asErrorMessage(error)}`, { cause: error });
    }

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new AppError(`${url.pathname} 返回了无效 JSON（HTTP ${response.status}）。`, {
        cause: error,
        status: response.status,
        responseBody: text,
      });
    }

    if (!response.ok) {
      const detail = body?.detail || body?.message || body?.error || "请求失败";
      throw new AppError(`${url.pathname} 返回 HTTP ${response.status}：${detail}`, {
        status: response.status,
        responseBody: body,
      });
    }
    return { body: ensureObject(body, url.pathname), headers: response.headers };
  }

  async login() {
    const { body, headers } = await this.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: this.apiKey }),
    });
    const cookie = extractAuthCookie(headers);
    if (!cookie) {
      throw new AppError("登录成功，但响应中没有 auth-token Cookie。", { responseBody: body });
    }
    this.cookie = cookie;
    return body;
  }

  async getJson(pathname, searchParams) {
    const url = new URL(pathname, `${this.baseUrl}/`);
    if (searchParams) {
      url.search = new URLSearchParams(searchParams).toString();
    }
    return (await this.request(url.toString())).body;
  }

  getQuota() {
    return this.getJson("/api/v1/me/quota");
  }

  getToday() {
    return this.getJson("/api/v1/me/today");
  }

  getStatsSummary(startDate, endDate) {
    return this.getJson("/api/v1/me/usage-logs/stats-summary", { startDate, endDate });
  }

  async getAllUsageLogs(startDate, endDate, { pageSize = 100, maxPages = 1_000 } = {}) {
    const items = [];
    const seenCursors = new Set();
    let cursor;
    let pageInfo = {};
    let pageCount = 0;

    do {
      const params = { startDate, endDate, limit: String(pageSize) };
      if (cursor) {
        const decodedCursor = decodeCursor(cursor);
        params.cursorCreatedAt = decodedCursor.createdAt;
        params.cursorId = decodedCursor.id;
      }
      const page = await this.getJson("/api/v1/me/usage-logs", params);
      if (!Array.isArray(page.items)) {
        throw new AppError("/api/v1/me/usage-logs 响应缺少 items 数组。");
      }
      items.push(...page.items);
      pageInfo = page.pageInfo && typeof page.pageInfo === "object" ? page.pageInfo : {};
      pageCount += 1;

      if (!pageInfo.hasMore) {
        break;
      }
      cursor = pageInfo.nextCursor;
      if (!cursor || seenCursors.has(cursor)) {
        throw new AppError("调用日志分页游标缺失或重复，已停止抓取以避免死循环。");
      }
      seenCursors.add(cursor);
      if (pageCount >= maxPages) {
        throw new AppError(`调用日志超过 ${maxPages} 页，已停止抓取。`);
      }
    } while (true);

    return {
      items,
      pageInfo: {
        ...pageInfo,
        hasMore: false,
        nextCursor: null,
        fetchedItems: items.length,
        fetchedPages: pageCount,
      },
    };
  }
}
