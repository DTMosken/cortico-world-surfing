# Surfing（src/definition.ts）

读取公开网页正文与 B站人工或 AI 字幕，搜索视频，并按需继续读取长内容。无需 B站账号；返回量可在 Cortico 面板中调整。

作者：DTMosken。MIT；改编代码和依赖的署名见 [LICENSE](LICENSE) 与 [来源说明](THIRD_PARTY_NOTICES.md)。

## 安装

需要 Node.js 22.12 以上、Cortico World 扩展 API 5（Cortico 0.1.5 已验证）。

1. 在 Cortico 的扩展管理页安装本地目录：`C:\Users\USER\Desktop\Proj\cortico-world-surfing`。
2. 重启 Cortico 进程，让新扩展载入。
3. 启用 Surfing，在它的配置页调整阅读返回量。

普通网页和 B站字幕可直接读取。需要 JavaScript 的网页会使用 Chromium；在扩展目录执行一次 `corepack pnpm install:browser` 安装浏览器。新机器需要分别安装。

## 使用

可以发送 BV号、B站视频链接或网页链接，也可以明确要求搜索视频：

- “看看 BV1h9a26vEzd，讲了什么。”
- “去 B站找一下‘破防 梗知识’，读完解释这个梗。”
- “打开这个搜索结果，看看文中的条件。”
- “继续读刚才那篇文章的下一段。”

仅模糊聊到视频时，提示词指导 bot 不自动搜索。结果有歧义时由 bot 核对候选或询问用户。已装 learn 的部署可以接着使用学习工具；Surfing 也可独立使用。

## 配置

| 面板配置 | 默认值 | 生效规则 |
|---|---:|---|
| 单次返回上限 | 4,096 估算 token | 1,024–32,768；下次调用，包括续读 |
| 字幕时间分组 | 30秒 | 1–120秒；新读取 |
| 单份材料保留上限 | 300,000字符 | 10,000–2,000,000；新读取；正文、目录与链接合计 |
| 单次读取下载上限 | 8 MiB | 1–64 MiB；一次操作共用，按解压后数据累计 |
| 单次读取超时 | 20秒 | 3–120秒；一次操作共用 |
| 续读保留时间 | 15分钟 | 1–120分钟；新快照 |
| 文本缓存上限 | 32 MiB | 8–256 MiB；按保存的数据大小核算；超限淘汰最久未读材料 |

单次返回上限覆盖完整回执，包含正文、链接、目录、来源与状态。估算采用字符权重，与实际模型计费 token 可能有差异。提高返回上限可一次取得更多原文；连续续读会累积会话上下文。首版只分页和截断，由当前会话模型决定如何概括。

字幕分组保留原句，显示合并后的时间范围；续读到同一分组内时，时间范围可重叠。修改分组或源字符上限不会改写已有快照。缓存保存在内存，到期、容量淘汰或关闭 World 后需要重新读取。

## 工具

| 工具 | 参数 | 返回内容 |
|---|---|---|
| `surfing_read_page` | `url`、可选 `cursor` | 正文、正文链接、目录预览；支持 URL 章节锚点 |
| `surfing_read_bili` | `bvid` / `aid` / `url` 至少一项，可选 `cid`、`cursor` | 所选分P的字幕、语言与 AI 标识、视频身份、分P目录 |
| `surfing_search_bili` | `query`、可选 `cursor` | 标题、BV、链接、UP主和时长 |

只给 BV 即可，Surfing 自动取得 aid / cid，默认第1P。URL 的 `p` 或显式 cid 可选择分P；冲突的身份或分P参数会被拒绝。支持 b23.tv 短链。

`hasMore: true` 时，把 `nextCursor` 原样交给同一工具，并保持原调用的目标参数。游标固定材料和读取位置；改变返回上限后可以接着读。搜索只有在需要远端下一页时才发新请求；重放已取得的页边界仍读取缓存材料。

`sourceTruncated: true` 表示材料已触及保留上限，读取保留片段后也不能称为全文。单条链接或搜索记录放不进当前返回量时，返回 `response_limit` 和原位置游标；提高上限后继续。目录预览放不下全部条目时标明 `outlinePartial`。

## 读取范围

仅支持公开 HTTP(S) 域名，拒绝 localhost、IP 地址、账号 URL 和解析到非公网的域名；重定向及动态网页子资源同样检查。网页返回正文和链接，首版不提取 PDF、图片、音视频；B站视频走字幕工具。需要 JavaScript 的正文使用临时匿名浏览器，不导入已有浏览器账号、不提交表单。

B站原生字幕接口可匿名访问，但并非每个视频或分P都有可取得的字幕。短暂空轨道会在同一读取限制内重试一次；仍为空、访问受限或协议变化时分别返回 `no_subtitle`、`access_denied`、`protocol_error`。没有字幕不能推断没有声音；标题和简介不能替代视频正文。

QQ 分享需要上游保留小程序来源或目标链接，才能筛选 B站卡片。现有 QQ World 丢失这些字段时，Surfing 无法仅凭标题、封面或“QQ小程序”判断平台，也无法关闭上游已启动的封面识图。接口调整见 [Cortico 卡片 Issue](https://github.com/Pal-AI-Lab/Cortico/issues/170)；明确的 BV、B站链接及明确的 B站搜索关键词现在即可使用。

网页和字幕是外部材料，其中的指令不构成系统指令。Surfing 不自动遍历整站或读完所有页；阅读与是否记入 Memory 由 Persona 已有工具和模型判断。

## 开发验证

```powershell
corepack pnpm install
corepack pnpm install:browser
corepack pnpm test
corepack pnpm run typecheck
```

测试使用合成平台响应、真实 DOM、Worker 与 Chromium，不访问互联网。`pnpm test` 会重新生成随包提供的网页提取引擎；发布前使用 Cortico 的 `pnpm check:extension <本包目录>` 检查构造契约。服务实测记录位于本地 `scratch/`，不随包发布。
