# CC Hub 用量工具

一个不依赖第三方包的 Node.js 命令行工具：登录 CC Hub，保存用量快照，并生成 Markdown 报告。

如果你只想马上使用，请从[快速开始](#快速开始)开始；实现原理和代码结构放在文档末尾。

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- 一个可用于网页登录的 CC Hub 用户 API Key
- 能访问 CC Hub 服务地址

本工具不需要执行 `npm install`。

### 1. 创建配置文件

在项目根目录执行：

```bash
cp cc-hub-usage.conf.example cc-hub-usage.conf
chmod 600 cc-hub-usage.conf
```

编辑 `cc-hub-usage.conf`，填入服务地址和登录 Key：

```ini
CCH_URL="https://cc-hub.example.com"
CCH_API_KEY="your-login-key"
```

不要把真实配置文件或 API Key 提交到 Git。配置文件应保持为 `600` 权限。

### 2. 采集数据

```bash
# 采集今天的数据
node bin/cc-hub.js collect

# 采集指定日期范围
node bin/cc-hub.js collect 2026-08-01 2026-08-23
```

日期格式必须是 `YYYY-MM-DD`，省略日期时使用 Asia/Shanghai 时区的今天。

### 3. 生成报告

```bash
# 从最新的完整快照生成报告
node bin/cc-hub.js report

# 采集完成后立即生成报告
node bin/cc-hub.js run 2026-08-01 2026-08-23

# 从指定快照生成报告
node bin/cc-hub.js report ./output/cc-hub-raw-20260823-120000-<uuid>
```

报告默认写入原始快照目录中的 `cc-hub-report.md`。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `collect` | 登录并保存原始用量快照 |
| `collect START END` | 采集指定日期范围 |
| `run START END` | 采集数据并立即生成报告 |
| `report` | 从最新完整快照生成报告，不访问 CC Hub |
| `report DIRECTORY` | 从指定快照目录生成报告 |
| `--help` | 查看命令帮助 |

选项可以放在命令后任意位置：

| 选项 | 说明 |
| --- | --- |
| `--config FILE` | 使用指定配置文件；默认是项目根目录的 `cc-hub-usage.conf` |
| `-o DIR`、`--output-dir DIR` | `collect`/`run` 的快照输出目录；`report` 的报告输出目录 |
| `--max-logs N` | 报告展示的最新调用记录数，默认 `30`，必须大于 `0` |
| `-h`、`--help` | 显示帮助 |

示例：

```bash
# 使用其他配置文件采集
node bin/cc-hub.js collect --config ./config/production.conf

# 把报告单独写到 reports/ 目录
node bin/cc-hub.js report --output-dir ./reports --max-logs 100
```

## 输出文件

执行 `collect` 或 `run` 时，如果没有指定 `CCH_RAW_OUTPUT_DIR` 或 `--output-dir`，默认输出到项目根目录的：

```text
output/cc-hub-raw-时间戳-唯一标识/
```

一次采集会产生以下原始数据文件；执行 `report` 或 `run` 后还会生成报告：

| 文件 | 内容 |
| --- | --- |
| `login.json` | 登录响应和账户信息 |
| `quota.json` | 配额信息 |
| `today.json` | 今日用量和模型分布 |
| `stats-summary.json` | 指定日期范围的汇总 |
| `usage-logs.json` | 指定日期范围的调用明细 |
| `cc-hub-report.md` | Markdown 报告；执行 `report` 或 `run` 后生成 |

采集失败时，目录会保留 `.incomplete` 标记，因此 `report` 不会误读未完成快照。接口返回的错误响应可能会另存为对应的 `*.error.json` 文件。

## 自定义快照目录

在配置文件中设置 `CCH_RAW_OUTPUT_DIR`，即可固定快照目录：

```ini
CCH_RAW_OUTPUT_DIR="./output/cc-hub-raw-custom"
```

该路径相对于配置文件所在目录解析。设置后：

- `collect` 和 `run` 会把快照写入这个目录；
- 不带目录参数的 `report` 会优先从这个目录读取快照；
- 如果目录下有多个 `cc-hub-raw-*` 子目录，`report` 会选择最新的完整快照；
- 如果该目录本身就是一个完整快照目录，`report` 会直接使用它。

也可以用 `--output-dir` 临时覆盖配置，不会修改配置文件。

## 安全与故障排查

### 权限警告

配置文件、原始快照和报告都可能包含账户用量信息。建议执行：

```bash
chmod 600 cc-hub-usage.conf
chmod 700 output
```

工具会将原始 JSON 和报告文件设为 `600`，将快照目录设为 `700`。

### 找不到完整快照

先执行一次采集，或者直接指定已有快照目录：

```bash
node bin/cc-hub.js collect
node bin/cc-hub.js report /path/to/snapshot
```

带有 `.incomplete` 标记，或缺少任一必需 JSON 文件的目录，不会被自动选中。

### 登录失败或 HTTP 401

确认以下内容：

- `CCH_URL` 是正确的 CC Hub 地址；
- `CCH_API_KEY` 是可用于网页登录的用户 API Key，而不是已经过期的会话值；
- 配置文件中没有多余的引号或不可见字符。

### 查看完整帮助

```bash
node bin/cc-hub.js --help
```

## 开发与验证

运行全部测试：

```bash
npm test
```

检查单个模块语法：

```bash
node --check src/cc-hub-client.js
```

## 实现说明

### 工作流程

1. 读取并校验本地配置文件。
2. 使用 API Key 请求 `/api/auth/login`，在内存中保存返回的 `auth-token` Cookie。
3. 使用 Cookie 请求配额、今日用量、日期汇总和调用日志接口。
4. 对可安全重试的 GET 请求处理网络错误和部分临时 HTTP 错误，并跟随调用日志分页游标。
5. 将每个接口的原始 JSON 以原子方式写入快照目录。
6. 所有必需数据写入成功后移除 `.incomplete` 标记，再生成 Markdown 报告。

Cookie 只存在于进程内存中，不会写入磁盘。

### 代码结构

| 文件 | 职责 |
| --- | --- |
| `bin/cc-hub.js` | CLI 入口 |
| `src/cli.js` | 参数解析和命令编排 |
| `src/config.js` | 配置解析、校验和路径解析 |
| `src/cc-hub-client.js` | 登录、认证请求、重试和分页 |
| `src/collector.js` | 日期校验和快照采集 |
| `src/report.js` | 从快照生成 Markdown |
| `src/fs-utils.js` | 安全的原子文件写入 |
| `src/paths.js`、`src/errors.js` | 路径和错误处理工具 |

项目使用 Node.js 内置 API 和 `node:test`，没有运行时第三方依赖。
