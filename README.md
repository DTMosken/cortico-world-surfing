<!-- Owner: package.json, src/definition.ts, src/world.ts, src/ENV_PROMPT.md, src/network.ts, src/bili.ts, src/sites.ts, src/microlink.ts, src/webui/client.ts -->
# 网上冲浪

让 Cortico 阅读公开网页、B站视频简介、字幕和评论，在 B站、贴吧和百科中查找材料，并根据读到的内容回答问题。发送链接或BV号即可使用，B站读取均使用匿名请求。

## 能做什么

- **阅读网页**：打开你发来的链接、分享卡片链接或网页搜索结果，提取正文；可沿正文中的编号链接打开相关页面，长文章可以继续读。
- **阅读B站视频**：读取人工或AI字幕，保留时间范围，支持视频分P和 b23.tv 短链。
- **阅读简介和评论**：读取视频简介、分P目录、热门或最新评论，以及指定评论的楼中楼回复。
- **搜索视频**：按关键词查找视频，也可以搜索“关键词 梗知识”来了解梗或概念。
- **站点搜索**：同时查 B站、贴吧、萌娘百科和百度百科，返回短材料和可继续打开的编号。通用网页搜索不在此范围，由模型已有的网页搜索工具处理。

可与 learn 学习扩展配合，将读到的梗或概念交给学习工具记录。

## 安装与配置

需要 Cortico 0.2.1 或更新版本（World 扩展 API 6），以及 Node.js 22.12 以上的22系列或24以上版本。

1. 在 Cortico 扩展管理页输入 `cortico-world-surfing` 安装 npm 包；使用本地源码时选择本项目目录。
2. 重启 Cortico 进程，启用“网上冲浪”。
3. 读取依赖脚本加载正文的网页时，优先使用本机 Chromium。可在扩展目录安装：

   ```powershell
   corepack pnpm install:browser
   ```

本机 Chromium 不可用时，扩展将目标网页 URL 发送给 Microlink，由其渲染后返回 HTML；正文、编号链接和章节锚点仍由本扩展提取。静态读取、Chromium 和 Microlink 共用单次读取超时及下载上限。Chromium 已启动后的网页错误、超时或取消不触发 Microlink。

## Microlink（可选）

无需 API Key 即可使用 Microlink 后备。配置 Key 后使用认证接口及该 Key 的额度；Key 仅发送给 Microlink，不进入模型回执。

在网上冲浪的「配置」页找到「Microlink 远程渲染」，点击「打开密钥文件」，编辑部署目录的 `.env`：

```dotenv
CORTICO_SURFING_MICROLINK_API_KEY=
```

取得免费 Key 的步骤：

1. 打开 [Microlink 注册页](https://dashboard.microlink.io/signup)，注册账号并登录，无需购买付费套餐。
2. 在控制台左侧选择「Overview」，点击「Usage」标签。
3. 点击「Development」标签右上角的「…」，复制 API Key。
4. 将 Key 填在上面的等号后，不加引号，保存文件。
5. 点击「刷新密钥状态」，状态变为「API Key 已配置」。下次远程读取使用新 Key；清空值并保存可恢复免 Key 调用。

免 Key 和免费 Key 的额度不同，当前限制见 [Microlink 额度说明](https://microlink.io/docs/api/basics/rate-limit)。额度耗尽或访问失败时，回执说明原因；已有短静态正文仍返回，并标明未取得完整渲染内容。

## World 兼容性

按 [Cortico World 兼容等级](https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/world-compatibility.md)，本 World 的最低等级为 **L1**，完整等级为 **L3**。

L1 宿主可调用全部阅读工具；读取受单次超时与 `stop()` 取消控制。L2 宿主还通过 `ToolCallContext.signal` 取消单次调用。全部工具均声明 `interruptible`，L3 宿主收到 `interrupt` 事件时会取消正在执行的读取；工具返回回执后继续处理新事件。本 World 不主动投递事件，不使用实时输出。

挂载时须提供 `WorldContext` 的配置和部署路径，用 `envPromptVars()` 填充 `ENV_PROMPT.md` 并将环境描述加入 system 前缀。控制台不计入等级；没有控制台时由宿主提供配置。

## 使用示例

- “看看BV12345abc，讲了什么。”
- “去B站搜一下‘破防’，读完解释这个梗。”
- “打开这个网页链接，看看文中的条件。”
- “继续读刚才那篇文章。”
- “打开文章里的安装指南，看看配置要求。”

QQ 分享卡片中的来源、标题和链接会进入消息正文。需要阅读时可直接使用卡片链接：B站视频支持 b23.tv 短链，无需另补 BV号；其他公开网页链接按网页阅读。

明确要求查找视频并提供关键词时，会搜索候选；仅模糊提到某个视频时不会自动搜索。

## 简介与评论

`surfing_read_bili` 用 `mode` 选择材料，每次读取一种。目标均可为 `bvid`、`aid` 或视频 `url`，支持 b23.tv 短链。

默认 `mode: "subtitles"` 读字幕，`cid` 选择分P：

```js
surfing_read_bili({ bvid: "BVxxxxxxxxxx" })
```

```text
视频：“破防”是什么意思？
P1：正片；UP主：示例UP主；人工字幕（中文）

[00:00–00:30] 今天我们聊聊“破防”这个词……
```

`mode: "info"` 读简介、标题、UP主和分P目录，不请求字幕：

```js
surfing_read_bili({ bvid: "BVxxxxxxxxxx", mode: "info" })
```

```text
视频简介：“破防”是什么意思？
BV: BVxxxxxxxxxx；UP主：示例UP主

从游戏语境到日常表达，聊聊“破防”的几种用法。
P1：正片（cid: 10001）
```

`mode: "comments"` 读评论原文、作者、发布时间、点赞数与评论 ID（`rpid`）：

```js
surfing_read_bili({ bvid: "BVxxxxxxxxxx", mode: "comments", sort: "hot" })
```

```text
视频评论：“破防”是什么意思？
BV: BVxxxxxxxxxx；热门评论；含楼中楼预览

评论 rpid: 20001；作者：示例评论者；赞：12；楼中楼：1；2026-11-05T00:00:00.000Z
我现在说破防，更多是在自嘲。

续读 cursor: comments_demo_cursor
```

- 评论默认按热门排序，`sort: "time"` 改为最新排序。
- 主评论中包含平台返回的楼中楼预览；`surfing_read_bili({ bvid, mode: "comments", root: "20001" })` 继续读取该评论下的回复，此时不传 `sort`。
- 返回 `cursor` 时，沿用原目标、`mode`、排序和 `root` 续读。先读完当前缓存内容，再按需请求平台后续批次；重放同一游标返回同一份已缓存材料。
- `cid` 只用于字幕，`sort` 和 `root` 只用于评论。

原 `surfing_read_bili_info`、`surfing_read_bili_comments` 已并入本工具，分别改传 `mode: "info"`、`mode: "comments"`。

每批评论在调用时取得，平台排序与可见范围可能变化。回执中的楼中楼预览只覆盖平台返回的片段；评论区关闭、评论删除或平台拒绝匿名访问时返回具体原因。

## 站点搜索

`surfing_search_all` 只接受 `query` 和可选的 `sources`，来源为 `bili`、`tieba`、`moegirl`、`baike`。各来源并行查询一次，全部免费、免 API Key、无需登录。以下示例中的标题、BV号和引用均为示意。

```js
surfing_search_all({ query: "破防" })
```

```text
「破防」
pageRef: search_demo_1

【B站】
· “破防”是什么意思？｜示例UP主｜02:35｜BVxxxxxxxxxx

【贴吧】
· （示例游戏吧）这关把我打破防了 [L1]
  试了好多次，终于过了。
更多贴吧结果 [L2]

【萌娘百科】
破防：破防是个游戏术语，也是网络用语。 [L3]

【百度百科】
破防：网络流行语，是破除防御的简称。 [L4]
```

B站候选把 BV号交给 `surfing_read_bili`，不返回搜索游标。想继续搜 B站时，先调用 `surfing_search_bili({ query })`，再用它自己回执中的 `cursor` 续搜，`surfing_search_all` 不提供这个 `cursor`。其余结果的编号只在所属 `pageRef` 内有效，新回执不改变旧回执中编号的含义。

**只查部分来源**

```js
surfing_search_all({ query: "破防", sources: ["tieba"] })
```

```text
「破防」
pageRef: tieba_demo_1

【贴吧】
· （示例游戏吧）这关把我打破防了 [L1]
  试了好多次，终于过了。
更多贴吧结果 [L2]
```

**打开帖子或词条原文**

```js
surfing_read_page({ pageRef: "search_demo_1", linkId: "L1" })
```

```text
网页：这关把我打破防了
pageRef: article_demo_1

试了好多次，终于过了。这次换了打法……

续读 cursor: article_demo_cursor
```

这是普通网页回执，后续用 `surfing_read_page({ pageRef: "article_demo_1", cursor: "article_demo_cursor" })` 续读。贴吧编号打开公开的移动版帖子页 `tieba.baidu.com/mo/m?kz=<帖子ID>`，百度百科编号打开接口返回的移动版词条页。

**继续贴吧结果**

```js
surfing_read_page({ pageRef: "search_demo_1", linkId: "L2" })
```

```text
「破防」· 贴吧
pageRef: tieba_demo_2

· （示例游戏吧）终于通关了，昨天差点破防 [L1]
  最后一次尝试成功了。
更多贴吧结果 [L2]
```

只推进贴吧，先显示已取得但未展示的帖子，用完后才请求贴吧下一页。这批的编号改用新的 `pageRef`。重放同一编号返回同一批结果。没有后续时不再列出“更多贴吧结果”。

**其他回执**

| 情况 | 回执 |
| --- | --- |
| 单个来源失败，其他来源照常返回 | `【萌娘百科】访问受限。` |
| 该来源没有匹配 | `【贴吧】未找到匹配结果。` |
| 贴吧上游下一页为空 | `【贴吧】没有更多结果。` |
| 指定了配置中关闭的来源 | `【萌娘百科】已在配置中关闭。` |
| 引用过期或服务重启 | `[tool failed] 引用已到期或被释放，请重新读取或搜索。` |

只有 B站候选或没有可打开的条目时，回执不带 `pageRef`。

**配置**

在配置页的「站点搜索」调整，下次调用生效。

- **来源开关**：点击“萌娘百科”取消选中后，`surfing_search_all({ query: "破防" })` 的回执没有【萌娘百科】分组，也不向该站发送请求，后续编号顺延。指定 `sources: ["moegirl"]` 时回执为 `【萌娘百科】已在配置中关闭。`。再次点击后恢复。`surfing_search_bili` 不受 B站开关影响。
- **每源显示条数**：默认5条，范围1到10条，作用于 B站和贴吧。改为2后，贴吧回执只列两条帖子，“更多贴吧结果”从第3条继续，不跳到上游下一页：

  ```text
  【贴吧】
  · （示例游戏吧）这关把我打破防了 [L1]
  · （示例游戏吧）终于通关了，昨天差点破防 [L2]
  更多贴吧结果 [L3]
  ```

百科只给词条摘要和原文编号，不做远端分页。

**回执超出单次返回上限**

返回上限较小而材料较长时，回执末尾带续读 `cursor`：

```text
「破防」
pageRef: search_demo_1

【B站】
· “破防”是什么意思？｜示例UP主｜02:35｜BVxxxxxxxxxx

【贴吧】
· （示例游戏吧）这关把我打破防了 [L1]

续读 cursor: search_demo_cursor
```

```js
surfing_read_page({ pageRef: "search_demo_1", cursor: "search_demo_cursor" })
```

```text
「破防」
pageRef: search_demo_1

· （示例游戏吧）终于通关了，昨天差点破防 [L2]
更多贴吧结果 [L3]

【百度百科】
破防：网络流行语，是破除防御的简称。 [L4]
```

`cursor` 只续读这份已取得的回执，不发起新的搜索。编号不变，要推进贴吧搜索时打开“更多贴吧结果”的 `[L#]`。

## 字幕重试

本次未取得字幕时，默认额外重试2次，分别等待1秒、2秒。在配置页可调整重试次数和首次等待时间，后续等待时间逐次翻倍；次数设为0关闭重试。所有尝试共用单次读取超时。

## 调整阅读量

在“网上冲浪”的配置页调整每次返回量、字幕分组，以及读取和缓存限制。

默认每次返回最多 **3,000 估算 token**，长网页、简介、字幕和评论按需分段续读。这个数值控制返回量，与模型的实际计费 token 可能不同；连续续读仍会累积会话上下文。

每份材料默认保留最多 **300,000字符**，包含正文和缓存的链接地址。达到保留上限时，结果会标明内容不完整。续读内容和编号链接保存在内存，默认最多保留15分钟；失效或重启后需要重新读取。

正文链接显示文字与编号，例如 `安装指南 [L1]`，不列网址。`surfing_read_page` 支持三种调用方式：

- 初读：`{url: "https://example.org/article"}`。
- 打开编号链接：`{pageRef: "原页引用", linkId: "L1"}`。
- 续读：`{pageRef: "目标页引用", cursor: "回执中的游标"}`，不带 `linkId`。

原有 `{url, cursor}` 续读方式仍可使用。

## 适用范围

- 网页需通过公开域名访问；不支持账号登录、本机地址或IP地址。正文需要登录或验证码时，可能只能取得页面提示。
- 视频内容来自可访问的字幕。重试后仍未取得字幕时会说明本次读取失败，无法据此判断视频没有字幕或声音。
- 网页阅读返回正文，暂不提取PDF、图片、音频或视频画面。
- 萌娘百科条目页目前对本扩展的阅读器返回 Cloudflare 验证页，编号打开时回执为“网页未允许本次公开读取。”。`surfing_search_all` 中的摘要来自官方接口，不受影响。
- 萌娘百科和百度百科按词条名精确查询，不是全文搜索。贴吧跨页可能出现上游重复帖子。
- QQ 分享卡片缺少链接时，来源为 B站或哔哩哔哩且有标题，可按标题搜索并核对候选；来源无法确定时，需提供 BV号或视频链接，或明确要求按标题在 B站搜索。

## 使用 Clash 等代理时

开着 Clash、mihomo 这类代理后，如果网页和 B站都读不了，回执通常是：

```text
[tool failed] 这个网址解析到了代理常用的虚拟地址，所以没有读取。如果正在使用 Clash 等代理，可以在网上冲浪设置中开启代理兼容模式后重试。
```

代理的 fake-ip 模式会让域名先解析到一个虚拟地址，再由代理连接真实网站。Surfing 默认只读取解析到公网地址的网址，所以在连接前就停下了，网站本身可能是正常的。下面的示例均为示意。

**开启代理兼容模式**

在网上冲浪的配置面板找到“代理”，点击“代理兼容模式”下的“开启”。按钮高亮并显示“已保存：代理兼容模式”就完成了，无需重启，下次读取生效。

开启后，实际访问哪里由代理决定，可能包括本机或内网服务。请只在信任当前代理时开启。

然后重新读取。回执和平时一样，不会多出代理信息：

```js
surfing_read_page({ url: "https://example.org/article" })
```

```text
网页：示例文章
pageRef: article_demo_1

这是文章正文……
```

需要脚本加载的网页同样可读，本机 Chromium 和 Microlink 都使用这个设置。

**搜索后打开原文**

所有读取工具共用这个开关，调用时不需要额外参数。站点搜索和编号原文的用法不变：

```js
surfing_search_all({ query: "破防", sources: ["tieba"] })
```

```text
「破防」
pageRef: tieba_demo_1

【贴吧】
· （示例游戏吧）这关把我打破防了 [L1]
  试了好多次，终于过了。
更多贴吧结果 [L2]
```

```js
surfing_read_page({ pageRef: "tieba_demo_1", linkId: "L1" })
```

```text
网页：这关把我打破防了
pageRef: article_demo_2

试了好多次，终于过了。这次换了打法……
```

**B站字幕和短链**

BV号、长链和 b23.tv 短链都可以读取：

```js
surfing_read_bili({ url: "https://b23.tv/example" })
```

```text
视频：“破防”是什么意思？
P1：正片；UP主：示例UP主；人工字幕（中文）

[00:00–00:30] 今天我们聊聊“破防”这个词……
```

**IPv6**

内置的常见地址范围是下面三段，普通用户不用填写：

```text
198.18.0.0/15
fdfe:dcba:9876::/64
2001:2::/48
```

同时解析到 IPv4 和 IPv6 虚拟地址时，优先连接 IPv4；只有 IPv6 时连接 IPv6。

**遇到其他内网地址**

开启后，只要解析结果里有不在上述范围内的内网或保留地址，这次读取仍会被拒绝，每次跳转也会重新检查：

```text
[tool failed] 这个网址解析到了未放行的内网或保留地址，所以没有读取。只有确认这是你改过的代理地址池时，才需要把它加入自定义地址范围；否则请检查网址和代理设置。
```

这个网址也可能真的指向内网，不要只为了让读取通过就添加地址。

**自定义地址范围**

只有改过代理的地址池才需要这一步，比如 mihomo 的 `fake-ip-range` 或 `fake-ip-range6`。展开“高级设置”，在“自定义地址范围（可选）”中每行填一个范围，离开输入框时保存：

```text
172.19.0.0/16
fd00:1234::/64
```

这些范围是对内置范围的补充，只在代理兼容模式开启时生效。填写的范围有多大，放行的地址就有多少，例如 `10.0.0.0/8` 会放行整段内网。

写错时不会保存，面板会指出是哪一行：

```text
自定义地址范围第 2 行无法识别：172.19.0.0。每行填一个范围，例如 172.19.0.0/16 或 fd00:1234::/64。
```

**关闭**

再次点击“开启”取消高亮，下次读取恢复默认规则。已填写的自定义范围会保留，但不再生效。

**这个模式解决不了的问题**

- 网站要求登录或验证时，仍然读不到，例如回执显示“网页未允许本次公开读取。”。
- 代理连不上目标网站时，读取仍会失败或超时。
- 网址本身的限制不变，仍不能直接读取 `localhost`、内网域名或 IP 地址。

**不开启的替代做法**

也可以改代理配置，让 DNS 返回真实地址。将 `dns.enhanced-mode` 改为 `redir-host`；或者保留 fake-ip，在 `fake-ip-filter-mode: blacklist` 下把要读取的域名加入 `fake-ip-filter`。搜索、跳转和字幕可能用到其他域名，它们也需要返回真实地址。配置含义见 [mihomo DNS 文档](https://wiki.metacubex.one/config/dns/)。修改后重新加载代理配置再重试。

## 许可

MIT License，见 [LICENSE](LICENSE)。

## Cortico 0.2.1

已移除 B站登录。旧部署可从部署目录的 `.env` 中删除 `CORTICO_SURFING_BILI_SESSION`；本版本不再读取或写入该配置。

发布前从 Cortico 仓库运行 `pnpm describe:extension <本包目录>` 和 `pnpm check:extension <本包目录>`。工具与默认提示词通过 `describe.json` 提供给扩展市场；发布规则见 [AGENTS.md](AGENTS.md)，更新说明见 [CHANGELOG.md](CHANGELOG.md)。
