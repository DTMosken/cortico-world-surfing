<!-- Owner: package.json, tsconfig.json, vitest.config.ts, .github/workflows/ci.yml, .github/workflows/release.yml -->

# 贡献指南

本仓库维护 Cortico 的 World 扩展，提供公开网页阅读、B站视频搜索与字幕读取，以及扫码登录控制台。使用方法见 [README](README.md)，社区交流遵循 [行为准则](CODE_OF_CONDUCT.md)。

## Issue

提交前搜索已有 Issue。一个 Issue 描述一个问题或一项需求，使用缺陷报告或功能请求表单。

缺陷报告需要版本、实际行为、预期行为和复现步骤。日志、配置和截图只保留复现必需的信息，移除 Cookie、登录凭据、私人对话和个人标识。

功能请求说明使用场景、预期行为和已有办法的不足。涉及 Core 或其他扩展时，说明与本 World 的关系，并在对应仓库讨论其负责的改动。

## 开发环境

CI 使用 Node.js 24，开发时建议使用相同版本。pnpm 版本由 `package.json` 的 `packageManager` 指定。

测试和类型检查使用开发依赖中的 Cortico。扩展契约检查与发布审计使用相邻的 Cortico 源码，其提交取自 `.github/workflows/release.yml` 的 `CORTICO_REF`。

以下 PowerShell 命令在同一父目录检出两个仓库，并安装各自的锁定依赖：

```powershell
git clone https://github.com/Pal-AI-Lab/Cortico.git Cortico
git clone https://github.com/DTMosken/cortico-world-surfing.git cortico-world-surfing
Set-Location cortico-world-surfing
$corticoRef = (Select-String -Path .github/workflows/release.yml -Pattern '^  CORTICO_REF: ([a-f0-9]{40})\s*$').Matches.Groups[1].Value
git -C ../Cortico checkout $corticoRef
corepack pnpm --dir ../Cortico install --frozen-lockfile
corepack pnpm install --frozen-lockfile
corepack pnpm install:browser
```

Linux 上还需安装 Chromium 的系统依赖，可将最后一条命令替换为 `corepack pnpm exec playwright install --with-deps chromium`。其他系统按相同的目录关系与 `CORTICO_REF` 检出 Cortico。

## 修改与验证

网页、平台请求、登录凭据和阅读缓存由本 World 管理。配置项在配置组中声明，由控制台按 schema 渲染；World 不写入 Memory，也不绑定 Persona 的工具。

变更行为时补充能复现问题或验证契约的测试。测试通过模拟传输或本机测试服务器覆盖请求、取消与浏览器行为，不访问真实平台，也不启动真实 bot。

在扩展目录执行：

```powershell
corepack pnpm test
corepack pnpm run typecheck
git diff --check
```

`pnpm test` 构建网页解析 Worker 与控制台，再运行完整测试；`pnpm run typecheck` 包含控制台源码。在隔离的检出目录构建，避免覆盖运行中的 bot 正在使用的资源。

扩展契约检查从相邻的 Cortico 目录执行：

```powershell
corepack pnpm --dir ../Cortico check:extension ../cortico-world-surfing
```

CI 的 `Validate` 还执行发布文件审计和打包内容检查，完整步骤见 [ci.yml](.github/workflows/ci.yml)。

## Pull Request

从最新 `main` 创建分支，一个 PR 处理一个主题。说明变更解决的问题、可见行为、验证结果，以及兼容性或迁移要求；文档和示例与行为一同更新。

提交信息使用 Conventional Commits，例如 `fix(surfing): 修正字幕续读` 或 `docs: 添加贡献规范`。类型和作用域使用小写英文，完整主题不超过 72 个字符。

通过 PR 合入 `main`，提交前运行上述测试和类型检查；合并条件以 GitHub 当前保护规则为准。使用 AI 辅助时，提交者仍需核对行为和验证结果。

## 版本与发布

版本更新和 npm 发布由维护者通过 Release 工作流操作。普通代码 PR 无需修改版本号。流程见 [发布说明](.github/release.md)；提交代码或合并 PR 不会自动发布 npm 包。
