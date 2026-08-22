# CC Hub 用量工具（Node.js）

使用同目录 `cc-hub-usage.conf` 登录 CC Hub，保存原始用量 JSON，并生成 Markdown 报告。默认输出集中在 `output/cc-hub-raw-时间戳/`，要求 Node.js 20 或更高版本，不需要安装第三方依赖。

```bash
# 抓取今天的数据
node bin/cc-hub.js collect

# 抓取日期范围并立即生成报告
node bin/cc-hub.js run 2026-08-01 2026-08-23

# 使用最新快照生成报告
node bin/cc-hub.js report

# 查看完整参数
node bin/cc-hub.js --help
```

配置文件格式保持不变：

```ini
CCH_URL="https://example.com"
CCH_API_KEY="your-login-key"
```

首次使用可以复制脱敏模板：

```bash
cp cc-hub-usage.conf.example cc-hub-usage.conf
```

请将配置文件权限设为仅当前用户可读写：

```bash
chmod 600 cc-hub-usage.conf
```

工具通过 `/api/auth/login` 换取临时 `auth-token` Cookie。Cookie 只保存在进程内存中，不写入磁盘。原始数据目录权限设为 `700`，JSON 和报告文件权限设为 `600`。
