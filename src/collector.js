import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "./errors.js";

export function localDate(date = new Date(), timeZone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function validateDate(value, label = "日期") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new AppError(`${label}必须使用 YYYY-MM-DD 格式。`, { exitCode: 2 });
  }
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new AppError(`${label}不是有效日期：${value}`, { exitCode: 2 });
  }
  return value;
}

export function validateDateRange(startDate, endDate) {
  validateDate(startDate, "开始日期");
  validateDate(endDate, "结束日期");
  if (startDate > endDate) {
    throw new AppError("开始日期不能晚于结束日期。", { exitCode: 2 });
  }
}

export function timestamp(date = new Date(), timeZone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}-${values.hour}${values.minute}${values.second}`;
}

async function writeJson(directory, name, value) {
  const outputFile = path.join(directory, `${name}.json`);
  await fs.writeFile(outputFile, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(outputFile, 0o600);
  return outputFile;
}

export async function collectData({ client, startDate, endDate, outputDir, onProgress = () => {} }) {
  validateDateRange(startDate, endDate);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  await fs.chmod(outputDir, 0o700);

  const steps = [
    ["login", () => client.login()],
    ["quota", () => client.getQuota()],
    ["today", () => client.getToday()],
    ["stats-summary", () => client.getStatsSummary(startDate, endDate)],
    ["usage-logs", () => client.getAllUsageLogs(startDate, endDate)],
  ];

  for (const [name, load] of steps) {
    try {
      const value = await load();
      const outputFile = await writeJson(outputDir, name, value);
      onProgress(`已保存：${outputFile}`);
    } catch (error) {
      if (error instanceof AppError && error.responseBody !== undefined) {
        const outputFile = path.join(outputDir, `${name}.error.json`);
        const content = typeof error.responseBody === "string"
          ? error.responseBody
          : `${JSON.stringify(error.responseBody, null, 2)}\n`;
        await fs.writeFile(outputFile, content, { encoding: "utf8", mode: 0o600 });
        await fs.chmod(outputFile, 0o600);
      }
      throw error;
    }
  }

  return outputDir;
}
