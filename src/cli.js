import fs from "node:fs/promises";
import path from "node:path";

import { CCHubClient } from "./cc-hub-client.js";
import { collectData, localDate, timestamp } from "./collector.js";
import { loadConfig } from "./config.js";
import { AppError, asErrorMessage } from "./errors.js";
import { DEFAULT_CONFIG_FILE, PROJECT_DIR } from "./paths.js";
import { renderReport } from "./report.js";

const HELP = `CC Hub 用量采集与报告工具

用法:
  node bin/cc-hub.js collect [开始日期] [结束日期] [选项]
  node bin/cc-hub.js report [原始数据目录] [选项]
  node bin/cc-hub.js run [开始日期] [结束日期] [选项]

命令:
  collect  登录 CC Hub 并保存原始 JSON
  report   从已有 cc-hub-raw-* 目录生成 Markdown
  run      采集数据后立即生成 Markdown

选项:
  --config <文件>       配置文件，默认同目录 cc-hub-usage.conf
  -o, --output-dir <目录>  输出目录
  --max-logs <数量>     报告展示的最新调用数，默认 30
  -h, --help            显示帮助

日期省略时使用 Asia/Shanghai 的今天。`;

const RAW_SNAPSHOT_FILES = [
  "login.json",
  "quota.json",
  "today.json",
  "stats-summary.json",
  "usage-logs.json",
];

function parseArguments(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-h" || argument === "--help") {
      options.help = true;
      continue;
    }
    const optionNames = new Map([
      ["--config", "config"],
      ["-o", "outputDir"],
      ["--output-dir", "outputDir"],
      ["--max-logs", "maxLogs"],
    ]);
    if (optionNames.has(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new AppError(`选项 ${argument} 缺少值。`, { exitCode: 2 });
      }
      options[optionNames.get(argument)] = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new AppError(`未知选项：${argument}`, { exitCode: 2 });
    }
    positional.push(argument);
  }
  return { positional, options };
}

async function latestRawDir() {
  const entries = await fs.readdir(PROJECT_DIR, { withFileTypes: true });
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("cc-hub-raw-"))
    .map(async (entry) => {
      const directory = path.join(PROJECT_DIR, entry.name);
      const complete = await Promise.all(RAW_SNAPSHOT_FILES.map(async (name) => {
        try {
          await fs.access(path.join(directory, name));
          return true;
        } catch {
          return false;
        }
      }));
      return complete.every(Boolean)
        ? { directory, mtimeMs: (await fs.stat(directory)).mtimeMs }
        : undefined;
    }));
  const completeCandidates = candidates.filter(Boolean);
  if (!completeCandidates.length) {
    throw new AppError(`找不到完整的 cc-hub-raw-* 数据目录：${PROJECT_DIR}`);
  }
  return completeCandidates.toSorted((left, right) => right.mtimeMs - left.mtimeMs)[0].directory;
}

function parseMaxLogs(value) {
  if (value === undefined) {
    return 30;
  }
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new AppError("--max-logs 必须是大于 0 的整数。", { exitCode: 2 });
  }
  return Number(value);
}

async function createCollector(options, positional) {
  if (positional.length > 2) {
    throw new AppError("collect/run 最多接受开始日期和结束日期两个位置参数。", { exitCode: 2 });
  }
  const configFile = path.resolve(options.config || DEFAULT_CONFIG_FILE);
  const config = await loadConfig(configFile);
  for (const warning of config.warnings) {
    console.warn(`警告：${warning}`);
  }
  const today = localDate();
  const startDate = positional[0] || today;
  const endDate = positional[1] || startDate;
  const outputDir = path.resolve(options.outputDir || config.outputDir || path.join(PROJECT_DIR, `cc-hub-raw-${timestamp()}`));
  const client = new CCHubClient(config);
  return { client, startDate, endDate, outputDir };
}

async function execute(args) {
  if (!args.length || args[0] === "-h" || args[0] === "--help") {
    console.log(HELP);
    return 0;
  }
  const command = args[0];
  const { positional, options } = parseArguments(args.slice(1));
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  if (command === "collect" || command === "run") {
    const collection = await createCollector(options, positional);
    const rawDir = await collectData({ ...collection, onProgress: console.log });
    console.log(`原始数据目录：${rawDir}`);
    if (command === "run") {
      const reportFile = await renderReport(rawDir, { maxLogs: parseMaxLogs(options.maxLogs) });
      console.log(`Markdown：${reportFile}`);
    }
    return 0;
  }

  if (command === "report") {
    if (positional.length > 1) {
      throw new AppError("report 最多接受一个原始数据目录。", { exitCode: 2 });
    }
    const rawDir = positional[0] ? path.resolve(positional[0]) : await latestRawDir();
    const outputDir = options.outputDir ? path.resolve(options.outputDir) : rawDir;
    const reportFile = await renderReport(rawDir, { outputDir, maxLogs: parseMaxLogs(options.maxLogs) });
    console.log(`Markdown：${reportFile}`);
    return 0;
  }

  throw new AppError(`未知命令：${command}\n\n${HELP}`, { exitCode: 2 });
}

export async function runCli(args) {
  try {
    return await execute(args);
  } catch (error) {
    console.error(`错误：${asErrorMessage(error)}`);
    return error instanceof AppError ? error.exitCode : 1;
  }
}
