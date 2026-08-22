#!/usr/bin/env python3
"""Render CC Hub raw JSON files into a readable Markdown report."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent.parent


def load_json(directory: Path, name: str) -> dict[str, Any]:
    path = directory / name
    if not path.is_file():
        raise RuntimeError(f"缺少文件：{path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"无法读取 JSON：{path}: {error}") from error
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON 顶层必须是对象：{path}")
    return value


def latest_raw_dir() -> Path:
    candidates = [path for path in SCRIPT_DIR.glob("cc-hub-raw-*") if path.is_dir()]
    if not candidates:
        raise RuntimeError(f"找不到 cc-hub-raw-* 目录：{SCRIPT_DIR}")
    return max(candidates, key=lambda path: path.stat().st_mtime)


def number(value: Any, digits: int = 0) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        return f"{value:,.{digits}f}"
    return str(value)


def money(value: Any, currency: str) -> str:
    if value is None:
        return "无限制"
    return f"{number(value, 6)} {currency}".rstrip("0").rstrip(".")


def duration(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return "-"
    if value < 1000:
        return f"{value:.0f} ms"
    return f"{value / 1000:.1f} s"


def md_cell(value: Any) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def table_md(headers: list[str], rows: list[list[Any]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines.extend("| " + " | ".join(md_cell(cell) for cell in row) + " |" for row in rows)
    return "\n".join(lines)


def build_report(data: dict[str, dict[str, Any]], raw_dir: Path, max_logs: int) -> str:
    login = data["login.json"]
    quota = data["quota.json"]
    today = data["today.json"]
    summary = data["stats-summary.json"]
    logs = data["usage-logs.json"].get("items", [])
    if not isinstance(logs, list):
        logs = []
    user = login.get("user", {})
    if not isinstance(user, dict):
        user = {}
    currency = str(today.get("currencyCode") or summary.get("currencyCode") or "USD")
    generated_at = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")

    account_rows = [
        ["用户名", user.get("name", "-")],
        ["角色", user.get("role", "-")],
        ["登录类型", login.get("loginType", "-")],
        ["Provider 组", quota.get("userProviderGroup", "-")],
        ["Key 状态", "已启用" if quota.get("keyIsEnabled") else "未启用"],
    ]
    metrics = [
        ("今日调用", number(today.get("calls"))),
        ("今日成本", money(today.get("costUsd"), currency)),
        ("输入 Token", number(today.get("inputTokens"))),
        ("输出 Token", number(today.get("outputTokens"))),
        ("日期总调用", number(summary.get("totalRequests"))),
        ("日期总成本", money(summary.get("totalCost"), currency)),
    ]
    quota_rows = [
        ["5 小时", money(quota.get("keyCurrent5hUsd"), currency), money(quota.get("keyLimit5hUsd"), currency)],
        ["今日", money(quota.get("keyCurrentDailyUsd"), currency), money(quota.get("keyLimitDailyUsd"), currency)],
        ["本周", money(quota.get("keyCurrentWeeklyUsd"), currency), money(quota.get("keyLimitWeeklyUsd"), currency)],
        ["本月", money(quota.get("keyCurrentMonthlyUsd"), currency), money(quota.get("keyLimitMonthlyUsd"), currency)],
        ["累计", money(quota.get("keyCurrentTotalUsd"), currency), money(quota.get("keyLimitTotalUsd"), currency)],
    ]
    model_rows = []
    for item in today.get("modelBreakdown", []):
        if isinstance(item, dict):
            model_rows.append([
                item.get("model", "-"),
                number(item.get("calls")),
                money(item.get("costUsd"), currency),
                number(item.get("inputTokens")),
                number(item.get("outputTokens")),
            ])
    model_rows.sort(key=lambda row: float(str(row[2]).split()[0].replace(",", "")) if row[2] != "-" else 0, reverse=True)

    visible_logs = [item for item in logs[:max_logs] if isinstance(item, dict)]
    log_rows = []
    for item in visible_logs:
        log_rows.append([
            item.get("createdAt", "-").replace("T", " ").replace("Z", "") if isinstance(item.get("createdAt"), str) else "-",
            item.get("model", "-"),
            item.get("endpoint", "-"),
            item.get("statusCode", "-"),
            money(item.get("cost"), currency),
            duration(item.get("duration")),
        ])
    error_count = sum(1 for item in logs if isinstance(item, dict) and item.get("statusCode") != 200)
    markdown_parts = [
        "# CC Hub 用量报告",
        "",
        f"> 生成时间：{generated_at}",
        f"> 原始数据：`{raw_dir}`",
        "",
        "## 账户",
        "",
        table_md(["字段", "值"], account_rows),
        "",
        "## 总览",
        "",
        table_md(["指标", "数值"], [[label, value] for label, value in metrics]),
        "",
        "## 配额",
        "",
        table_md(["周期", "当前用量", "限制"], quota_rows),
        "",
        "## 今日模型分布",
        "",
        table_md(["模型", "调用次数", "成本", "输入 Token", "输出 Token"], model_rows or [["暂无数据", "-", "-", "-", "-"]]),
        "",
        "## 调用明细（最新记录）",
        "",
        f"共 {number(len(logs))} 条，报告展示最新 {number(len(visible_logs))} 条；完整记录见 `usage-logs.json`。",
        "",
        table_md(["时间", "模型", "端点", "状态", "成本", "耗时"], log_rows or [["暂无数据", "-", "-", "-", "-", "-"]]),
        "",
        f"> 异常记录：{number(error_count)} 条。",
        "",
    ]
    return "\n".join(markdown_parts)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="将 CC Hub 原始 JSON 生成为 Markdown 报告")
    parser.add_argument("raw_dir", nargs="?", type=Path, help="cc-hub-raw-* 目录，省略时自动选择最新目录")
    parser.add_argument("-o", "--output-dir", type=Path, help="输出目录，默认写入 raw_dir")
    parser.add_argument("--max-logs", type=int, default=30, help="Markdown 展示的最新调用数，默认 30")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.max_logs < 1:
        print("错误：--max-logs 必须大于 0。", file=sys.stderr)
        return 2
    try:
        raw_dir = (args.raw_dir or latest_raw_dir()).expanduser().resolve()
        output_dir = (args.output_dir or raw_dir).expanduser().resolve()
        output_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        data = {name: load_json(raw_dir, name) for name in ("login.json", "quota.json", "today.json", "stats-summary.json", "usage-logs.json")}
        markdown = build_report(data, raw_dir, args.max_logs)
        md_path = output_dir / "cc-hub-report.md"
        md_path.write_text(markdown, encoding="utf-8")
        os.chmod(md_path, 0o600)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"错误：{error}", file=sys.stderr)
        return 1
    print(f"Markdown：{md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
