# `.github/workflows/ci.yml`, `.github/workflows/release.yml`

## CI

推送分支、向 `main` 提交 PR 或手动运行 CI 时，`Validate` 执行测试、类型检查、扩展检查、发布文件审计和打包内容检查。`pnpm test` 会构建网页解析 Worker 与控制台，再运行完整测试；`pnpm run typecheck` 包含控制台源码。测试浏览器使用 Playwright 对应的 Chromium。

CI 只有仓库读取权限。推送代码或合并 PR 不触发 npm 发布。

## 检查环境

工作流使用 GitHub 托管的 Ubuntu runner、Node.js 24 和 `package.json` 声明的 pnpm 版本。CI 从 `release.yml` 读取 `CORTICO_REF`，两者使用同一个 Cortico 固定提交执行扩展检查与发布审计。

两个仓库按以下目录关系检出，并分别安装锁定依赖：

```text
<父目录>/
  Cortico/
  extension/
```

## 准备版本

在 GitHub Actions 页面运行 Release，选择 `main`，将 `release_type` 设为 `patch`、`minor` 或 `major`。工作流更新 `package.json` 的版本与源码地址，完成验证与打包，将版本提交到 `release/v<版本>` 分支并创建 PR，再手动触发该分支的 CI。

仓库需要允许 Actions 创建 PR。Release job 申请写入版本分支、创建 PR、触发 CI、创建标签及取得 npm 发布身份所需的权限。

准备版本不创建标签或发布 npm 包。版本 PR 合并后，再选择 `publish`。

## 发布

`publish` 验证 `main` 上已提交的版本，生成 tarball，创建并推送 `v<版本>` 标签，发布 npm 包，核对指定版本与 `latest`，最后创建 GitHub Release 并附上 tarball。

已有标签必须指向当前提交。npm 已有指定版本时跳过再次发布，仍核对该版本与 `latest`；已有 GitHub Release 时保留其内容。发布失败后可在同一提交重试，不移动或删除已有版本标签。

## npm 身份

自动发布使用 npm Trusted Publishing。包的 Trusted Publisher 设置填写 `DTMosken`、`cortico-world-surfing` 和文件名 `release.yml`，允许 `npm publish`，Environment 留空。

首次发布前，需要建立 npm 包并配置其 Trusted Publisher。维护者使用已验证的 tarball 完成首次 npm 发布，再配置该包的自动发布身份；自动工作流核对已有版本并创建 GitHub Release。

参考：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)、[GitHub 手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。
