import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "./errors.js";
import { writeAtomicFile } from "./fs-utils.js";

const REQUIRED_FILES = [
  "login.json",
  "quota.json",
  "today.json",
  "stats-summary.json",
  "usage-logs.json",
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function loadJson(directory, name) {
  const file = path.join(directory, name);
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    throw new AppError(`缺少或无法读取文件：${file}`, { cause: error });
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new AppError(`无法解析 JSON：${file}`, { cause: error });
  }
  if (!isObject(value)) {
    throw new AppError(`JSON 顶层必须是对象：${file}`);
  }
  return value;
}

export function formatNumber(value, maximumFractionDigits = 0) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return String(value);
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatMoney(value, currency) {
  if (value === null) {
    return "无限制";
  }
  if (value === undefined || typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${formatNumber(value, 6)} ${currency}`;
}

export function formatDuration(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return value < 1_000 ? `${Math.round(value)} ms` : `${formatNumber(value / 1_000, 1)} s`;
}

function formatDateTime(value, timeZone, includeZone = false) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: includeZone ? undefined : 3,
    timeZoneName: includeZone ? "short" : undefined,
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  const base = `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  if (includeZone) {
    return `${base} ${values.timeZoneName}`;
  }
  return values.fractionalSecond ? `${base}.${values.fractionalSecond}` : base;
}

function markdownCell(value) {
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function table(headers, rows) {
  return [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
}

export function buildReport(data, rawDir, { maxLogs = 30, timeZone = "Asia/Shanghai", now = new Date() } = {}) {
  if (!Number.isInteger(maxLogs) || maxLogs < 1) {
    throw new AppError("--max-logs 必须是大于 0 的整数。", { exitCode: 2 });
  }

  const login = isObject(data["login.json"]) ? data["login.json"] : {};
  const quota = isObject(data["quota.json"]) ? data["quota.json"] : {};
  const today = isObject(data["today.json"]) ? data["today.json"] : {};
  const summary = isObject(data["stats-summary.json"]) ? data["stats-summary.json"] : {};
  const usageLogs = isObject(data["usage-logs.json"]) ? data["usage-logs.json"] : {};
  const logs = Array.isArray(usageLogs.items) ? usageLogs.items.filter(isObject) : [];
  const pageInfo = isObject(usageLogs.pageInfo) ? usageLogs.pageInfo : {};
  const user = isObject(login.user) ? login.user : {};
  const currency = String(today.currencyCode || summary.currencyCode || "USD");

  const accountRows = [
    ["用户名", user.name ?? "-"],
    ["角色", user.role ?? "-"],
    ["登录类型", login.loginType ?? "-"],
    ["Provider 组", quota.userProviderGroup ?? "-"],
    ["Key 状态", quota.keyIsEnabled === true ? "已启用" : quota.keyIsEnabled === false ? "未启用" : "-"],
  ];
  const metrics = [
    ["今日调用", formatNumber(today.calls)],
    ["今日成本", formatMoney(today.costUsd, currency)],
    ["输入 Token", formatNumber(today.inputTokens)],
    ["输出 Token", formatNumber(today.outputTokens)],
    ["日期总调用", formatNumber(summary.totalRequests)],
    ["日期总成本", formatMoney(summary.totalCost, currency)],
  ];
  const quotaRows = [
    ["5 小时", quota.keyCurrent5hUsd, quota.keyLimit5hUsd],
    ["今日", quota.keyCurrentDailyUsd, quota.keyLimitDailyUsd],
    ["本周", quota.keyCurrentWeeklyUsd, quota.keyLimitWeeklyUsd],
    ["本月", quota.keyCurrentMonthlyUsd, quota.keyLimitMonthlyUsd],
    ["累计", quota.keyCurrentTotalUsd, quota.keyLimitTotalUsd],
  ].map(([label, current, limit]) => [label, formatMoney(current, currency), formatMoney(limit, currency)]);

  const modelRows = (Array.isArray(today.modelBreakdown) ? today.modelBreakdown : [])
    .filter(isObject)
    .toSorted((left, right) => (Number(right.costUsd) || 0) - (Number(left.costUsd) || 0))
    .map((item) => [
      item.model ?? "-",
      formatNumber(item.calls),
      formatMoney(item.costUsd, currency),
      formatNumber(item.inputTokens),
      formatNumber(item.outputTokens),
    ]);

  const sortedLogs = logs.toSorted((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isNaN(leftTime)) {
      return Number.isNaN(rightTime) ? 0 : 1;
    }
    if (Number.isNaN(rightTime)) {
      return -1;
    }
    return rightTime - leftTime;
  });
  const visibleLogs = sortedLogs.slice(0, maxLogs);
  const logRows = visibleLogs.map((item) => [
    formatDateTime(item.createdAt, timeZone),
    item.model ?? "-",
    item.endpoint ?? "-",
    item.statusCode ?? "-",
    formatMoney(item.cost, currency),
    formatDuration(item.duration),
  ]);
  const errorCount = logs.filter((item) => {
    const status = Number(item.statusCode);
    return !Number.isFinite(status) || status < 200 || status >= 300;
  }).length;
  const completeness = pageInfo.hasMore
    ? `当前快照包含 ${formatNumber(logs.length)} 条，服务端仍有下一页`
    : `共 ${formatNumber(logs.length)} 条`;

  return [
    "# CC Hub 用量报告",
    "",
    `> 生成时间：${formatDateTime(now, timeZone, true)}`,
    `> 原始数据：\`${rawDir}\``,
    "",
    "## 账户",
    "",
    table(["字段", "值"], accountRows),
    "",
    "## 总览",
    "",
    table(["指标", "数值"], metrics),
    "",
    "## 配额",
    "",
    table(["周期", "当前用量", "限制"], quotaRows),
    "",
    "## 今日模型分布",
    "",
    table(["模型", "调用次数", "成本", "输入 Token", "输出 Token"], modelRows.length ? modelRows : [["暂无数据", "-", "-", "-", "-"]]),
    "",
    "## 调用明细（最新记录）",
    "",
    `${completeness}，报告展示最新 ${formatNumber(visibleLogs.length)} 条；原始记录见 \`usage-logs.json\`。`,
    "",
    table([`时间（${timeZone}）`, "模型", "端点", "状态", "成本", "耗时"], logRows.length ? logRows : [["暂无数据", "-", "-", "-", "-", "-"]]),
    "",
    `> 异常记录：${formatNumber(errorCount)} 条。`,
    "",
  ].join("\n");
}

export async function renderReport(rawDir, { outputDir = rawDir, maxLogs = 30, timeZone = "Asia/Shanghai", now } = {}) {
  const resolvedRawDir = path.resolve(rawDir);
  const resolvedOutputDir = path.resolve(outputDir);
  const values = await Promise.all(REQUIRED_FILES.map((name) => loadJson(resolvedRawDir, name)));
  const data = Object.fromEntries(REQUIRED_FILES.map((name, index) => [name, values[index]]));
  const markdown = buildReport(data, resolvedRawDir, { maxLogs, timeZone, now });

  await fs.mkdir(resolvedOutputDir, { recursive: true, mode: 0o700 });
  await fs.chmod(resolvedOutputDir, 0o700);
  const outputFile = path.join(resolvedOutputDir, "cc-hub-report.md");
  await writeAtomicFile(outputFile, markdown);
  return outputFile;
}
