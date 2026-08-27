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

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function validateOptionalFields(value, pathname, schema) {
  const validators = {
    array: Array.isArray,
    boolean: (item) => typeof item === "boolean",
    number: (item) => typeof item === "number" && Number.isFinite(item),
    numberOrNull: (item) => item === null || (typeof item === "number" && Number.isFinite(item)),
    stringOrNull: (item) => item === null || typeof item === "string",
  };

  for (const [field, type] of Object.entries(schema)) {
    if (value[field] !== undefined && !validators[type](value[field])) {
      throw new AppError(`${pathname} 字段 ${field} 的类型无效，应为 ${type}。`);
    }
  }
}

function retryDelay(headers, attempt, baseDelay, maxDelay) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.min(maxDelay, Math.max(0, seconds * 1_000));
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.min(maxDelay, Math.max(0, date - Date.now()));
    }
  }
  return Math.min(maxDelay, baseDelay * (2 ** attempt));
}

export class CCHubClient {
  constructor({
    baseUrl,
    apiKey,
    fetchImpl = globalThis.fetch,
    timeoutMs = 60_000,
    maxRetries = 2,
    retryDelayMs = 250,
    maxRetryDelayMs = 5_000,
    sleepImpl = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  }) {
    if (typeof fetchImpl !== "function") {
      throw new AppError("当前 Node.js 环境不支持 fetch。", { exitCode: 2 });
    }
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 0;
    this.retryDelayMs = Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? retryDelayMs : 250;
    this.maxRetryDelayMs = Number.isFinite(maxRetryDelayMs) && maxRetryDelayMs >= 0 ? maxRetryDelayMs : 5_000;
    this.sleepImpl = sleepImpl;
    this.cookie = undefined;
  }

  async request(pathname, options = {}) {
    const url = new URL(pathname, `${this.baseUrl}/`);
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (this.cookie) {
      headers.set("Cookie", this.cookie);
    }

    const method = (options.method || "GET").toUpperCase();
    const canRetry = RETRYABLE_METHODS.has(method);
    let response;
    let text;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await this.fetchImpl(url, {
          ...options,
          headers,
          signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
        });
        text = await response.text();
      } catch (error) {
        if (!canRetry || attempt >= this.maxRetries || options.signal?.aborted) {
          throw new AppError(`无法连接 ${url.origin}${url.pathname}：${asErrorMessage(error)}`, { cause: error });
        }
        await this.sleepImpl(Math.min(this.maxRetryDelayMs, this.retryDelayMs * (2 ** attempt)));
        continue;
      }

      if (canRetry && RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
        await this.sleepImpl(retryDelay(response.headers, attempt, this.retryDelayMs, this.maxRetryDelayMs));
        continue;
      }
      break;
    }

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

  async getQuota() {
    const body = await this.getJson("/api/v1/me/quota");
    validateOptionalFields(body, "/api/v1/me/quota", {
      keyIsEnabled: "boolean",
      keyCurrent5hUsd: "numberOrNull",
      keyLimit5hUsd: "numberOrNull",
      keyCurrentDailyUsd: "numberOrNull",
      keyLimitDailyUsd: "numberOrNull",
      keyCurrentWeeklyUsd: "numberOrNull",
      keyLimitWeeklyUsd: "numberOrNull",
      keyCurrentMonthlyUsd: "numberOrNull",
      keyLimitMonthlyUsd: "numberOrNull",
      keyCurrentTotalUsd: "numberOrNull",
      keyLimitTotalUsd: "numberOrNull",
    });
    return body;
  }

  async getToday() {
    const body = await this.getJson("/api/v1/me/today");
    validateOptionalFields(body, "/api/v1/me/today", {
      calls: "number",
      costUsd: "numberOrNull",
      inputTokens: "number",
      outputTokens: "number",
      modelBreakdown: "array",
    });
    return body;
  }

  async getStatsSummary(startDate, endDate) {
    const body = await this.getJson("/api/v1/me/usage-logs/stats-summary", { startDate, endDate });
    validateOptionalFields(body, "/api/v1/me/usage-logs/stats-summary", {
      totalRequests: "number",
      totalCost: "numberOrNull",
    });
    return body;
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
      if (page.pageInfo !== undefined && (!page.pageInfo || typeof page.pageInfo !== "object" || Array.isArray(page.pageInfo))) {
        throw new AppError("/api/v1/me/usage-logs 响应的 pageInfo 不是对象。");
      }
      pageInfo = page.pageInfo || {};
      validateOptionalFields(pageInfo, "/api/v1/me/usage-logs", {
        hasMore: "boolean",
        nextCursor: "stringOrNull",
        limit: "number",
      });
      if (typeof pageInfo.hasMore !== "boolean") {
        throw new AppError("/api/v1/me/usage-logs 响应缺少 pageInfo.hasMore 布尔值。");
      }
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
