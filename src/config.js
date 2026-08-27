import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "./errors.js";

const SUPPORTED_KEYS = new Set(["CCH_URL", "CCH_API_KEY", "CCH_RAW_OUTPUT_DIR"]);

function parseQuotedValue(source, quote, lineNumber) {
  let result = "";
  let escaped = false;
  let index = 1;

  for (; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      if (quote === '"' && (character === '"' || character === "\\")) {
        result += character;
      } else {
        result += `\\${character}`;
      }
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === quote) {
      const remainder = source.slice(index + 1).trim();
      if (remainder && !remainder.startsWith("#")) {
        throw new AppError(`配置文件第 ${lineNumber} 行的引号后存在无法识别的内容。`, { exitCode: 2 });
      }
      return result;
    }
    result += character;
  }

  throw new AppError(`配置文件第 ${lineNumber} 行缺少结束引号。`, { exitCode: 2 });
}

function parseValue(source, lineNumber) {
  const value = source.trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    return parseQuotedValue(value, value[0], lineNumber);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function parseConfig(text) {
  const config = {};
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (const [index, originalLine] of lines.entries()) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      throw new AppError(`配置文件第 ${index + 1} 行格式无效。`, { exitCode: 2 });
    }
    const [, key, rawValue] = match;
    if (SUPPORTED_KEYS.has(key)) {
      config[key] = parseValue(rawValue, index + 1);
    }
  }
  return config;
}

function normalizeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new AppError("配置项 CCH_URL 不是有效 URL。", { exitCode: 2, cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("配置项 CCH_URL 只支持 http 或 https。", { exitCode: 2 });
  }
  return url.toString().replace(/\/$/, "");
}

export async function loadConfig(configFile) {
  let text;
  let stat;
  try {
    [text, stat] = await Promise.all([fs.readFile(configFile, "utf8"), fs.stat(configFile)]);
  } catch (error) {
    throw new AppError(`无法读取配置文件：${configFile}`, { exitCode: 2, cause: error });
  }

  const parsed = parseConfig(text);
  if (!parsed.CCH_URL || !parsed.CCH_API_KEY) {
    throw new AppError("配置文件必须设置 CCH_URL 和 CCH_API_KEY。", { exitCode: 2 });
  }

  const warnings = [];
  if ((stat.mode & 0o077) !== 0) {
    warnings.push(`配置文件权限过宽，建议执行：chmod 600 ${configFile}`);
  }

  return {
    baseUrl: normalizeUrl(parsed.CCH_URL),
    apiKey: parsed.CCH_API_KEY,
    outputDir: parsed.CCH_RAW_OUTPUT_DIR
      ? path.resolve(path.dirname(configFile), parsed.CCH_RAW_OUTPUT_DIR)
      : undefined,
    warnings,
  };
}

export async function loadConfiguredOutputDir(configFile, { optional = false } = {}) {
  let text;
  try {
    text = await fs.readFile(configFile, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") {
      return undefined;
    }
    throw new AppError(`无法读取配置文件：${configFile}`, { exitCode: 2, cause: error });
  }

  const parsed = parseConfig(text);
  return parsed.CCH_RAW_OUTPUT_DIR
    ? path.resolve(path.dirname(configFile), parsed.CCH_RAW_OUTPUT_DIR)
    : undefined;
}
