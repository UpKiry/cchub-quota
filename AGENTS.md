# Repository Guidelines

## Project Structure & Module Organization

This repository is a Node.js 20+ ESM command-line tool for collecting CC Hub usage data and generating Markdown reports. The executable entry point is `bin/cc-hub.js`. Application modules live in `src/`:

- `cli.js` parses commands and coordinates collection/report workflows.
- `config.js` parses and validates the local configuration file.
- `cc-hub-client.js` handles login, authenticated API requests, retries, and pagination.
- `collector.js` validates dates and writes protected raw JSON snapshots.
- `report.js` renders Markdown from an existing snapshot.
- `fs-utils.js`, `paths.js`, and `errors.js` provide shared utilities.

Tests are in `test/`, using Node’s built-in test runner. Generated snapshots and reports belong under `output/` and should not be committed.

## Build, Test, and Development Commands

There is no separate build step or dependency installation requirement.

```bash
npm test                         # Run all unit and integration tests
node bin/cc-hub.js --help        # Show CLI usage
node bin/cc-hub.js collect       # Collect today’s data
node bin/cc-hub.js run START END # Collect a date range and render a report
node bin/cc-hub.js report        # Render from the latest complete snapshot
```

Use Node.js 20 or newer. Run `node --check src/<file>.js` for a focused syntax check.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, and double-quoted strings. Keep modules focused and prefer named exports. Use `camelCase` for functions and variables, `PascalCase` for classes, and uppercase names for constants. Preserve the existing Chinese user-facing CLI messages. Use native Node APIs rather than adding dependencies without a clear need.

## Testing Guidelines

Add tests with `node:test` and `node:assert/strict`. Name tests by observable behavior, such as `client retries transient GET failures`. Cover both successful and malformed/error responses, filesystem permissions, pagination, and report formatting. Run `npm test` before submitting changes.

## Security & Configuration

Copy `cc-hub-usage.conf.example` to `cc-hub-usage.conf`; never commit the real file or API key. Keep the config at mode `600`. The login key is exchanged for an in-memory `auth-token` cookie. Raw JSON directories should remain mode `700`, with files at mode `600`.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects consistent with the existing history, for example `Organize generated output and remove legacy`. Pull requests should explain the behavior change, list tests run, and call out configuration or security implications. Include sample CLI output when changing user-facing reporting or command behavior.
