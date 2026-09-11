# CC Hub 用量工具

用于 [Claude Code Hub](https://github.com/ding113/claude-code-hub) 的用量采集和 Markdown 报告工具。

- 上游项目：[ding113/claude-code-hub](https://github.com/ding113/claude-code-hub)
- 项目主页：[cch-plus.com](https://cch-plus.com)
- 本工具：登录 CC Hub、保存原始快照、生成用量报告

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- 一个可用于网页登录的 CC Hub 用户 API Key
- 能访问你部署的 CC Hub 服务

不需要安装第三方依赖。

### 1. 配置登录信息

在项目根目录执行：

```bash
cp cc-hub-usage.conf.example cc-hub-usage.conf
chmod 600 cc-hub-usage.conf
```

编辑 `cc-hub-usage.conf`：

```ini
CCH_URL="https://你的-cc-hub-地址"
CCH_API_KEY="你的网页登录 API Key"
```

### 2. 采集和查看报告

```bash
# 采集今天的数据
node bin/cc-hub.js collect

# 采集日期范围，并立即生成报告
node bin/cc-hub.js run 2026-08-01 2026-08-23

# 从最新完整快照生成报告，不会访问 CC Hub
node bin/cc-hub.js report
```

日期格式为 `YYYY-MM-DD`；省略日期时使用 Asia/Shanghai 时区的今天。

报告默认保存为快照目录中的 `cc-hub-report.md`。

## 命令速查

| 命令 | 用途 |
| --- | --- |
| `collect` | 采集今天的数据 |
| `collect START END` | 采集指定日期范围 |
| `run START END` | 采集数据并生成报告 |
| `report` | 使用最新完整快照生成报告 |
| `report DIRECTORY` | 使用指定快照生成报告 |
| `--help` | 查看完整帮助 |

常用选项：

| 选项 | 用途 |
| --- | --- |
| `--config FILE` | 指定配置文件；默认是 `cc-hub-usage.conf` |
| `-o DIR`、`--output-dir DIR` | 指定快照目录；对 `report` 来说指定报告目录 |
| `--max-logs N` | 报告展示的最新调用记录数，默认 `30` |

例如：

```bash
# 使用其他配置文件
node bin/cc-hub.js collect --config ./config/production.conf

# 将报告单独保存到 reports/
node bin/cc-hub.js report --output-dir ./reports --max-logs 100
```

## 输出内容

默认快照目录位于项目根目录：

```text
output/cc-hub-raw-时间戳-唯一标识/
```

其中包含：

| 文件 | 内容 |
| --- | --- |
| `login.json` | 登录响应和账户信息 |
| `quota.json` | 配额信息 |
| `today.json` | 今日用量和模型分布 |
| `stats-summary.json` | 日期范围汇总 |
| `usage-logs.json` | 调用明细 |
| `cc-hub-report.md` | Markdown 报告 |

采集失败的目录会保留 `.incomplete` 标记，不会被 `report` 自动选中。

### 自定义快照目录

在配置文件中设置：

```ini
CCH_RAW_OUTPUT_DIR="./output/cc-hub-raw-custom"
```

路径相对于配置文件所在目录。设置后，`collect`/`run` 会写入该目录，不带目录参数的 `report` 也会优先从该目录读取。命令行的 `--output-dir` 可以临时覆盖配置。

## 安全与排错

- 不要提交真实的 `cc-hub-usage.conf` 或 API Key。
- 配置文件权限应为 `600`，快照目录应为 `700`，JSON 和报告文件应为 `600`。
- `CCH_URL` 应填写你实际部署的 CC Hub 服务地址，不是 GitHub 仓库地址。
- 出现 HTTP 401 时，确认 `CCH_API_KEY` 是可用于网页登录的用户 API Key，而不是过期的会话值。
- 如果找不到快照，先执行 `collect`，或直接运行 `report /path/to/snapshot`。

## 开发

运行测试：

```bash
npm test
```

仓库已配置 GitHub Actions，会在每次 push 和 Pull Request 时使用 Node.js 20 自动运行 `npm test`。

## 实现概览

工具先通过 `/api/auth/login` 将 API Key 换成仅保存在内存中的 `auth-token` Cookie，再请求配额、今日用量、日期汇总和调用日志。GET 请求支持临时错误重试，调用日志支持分页。

采集结果以原子方式写入快照目录，并用 `.incomplete` 标记保护未完成数据；报告生成阶段只读取现有快照，不会重新请求 API。

主要模块：

- `src/cc-hub-client.js`：登录、认证请求、重试和分页
- `src/collector.js`：日期校验和快照采集
- `src/report.js`：生成 Markdown 报告
- `src/config.js`：配置解析和校验
- `src/cli.js`：命令行参数和流程编排
