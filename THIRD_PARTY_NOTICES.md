# src/snapshots.ts、src/bili.ts 与 package.json 的来源和授权

本包作者为 DTMosken，本包源码采用 MIT。依赖各自保留原许可证。

`src/snapshots.ts` 中的字符加权估算函数改编自 [Cortico 的字符加权估算器](https://github.com/Pal-AI-Lab/Cortico/blob/main/src/protocol/open-responses/tokens.ts)。保留 Copyright (c) 2026 Phantivia；该部分的 MIT 授权声明见本包 [LICENSE](LICENSE)。

字幕协议字段、WBI 排序表和字幕 URL 常量依据 B站网页播放器及公开接口响应核验。字幕读取路线参考 [Rimagination/bili-note](https://github.com/Rimagination/bili-note)，原生协议读取器在本包独立实现。B站接口、服务返回的字幕和网页内容不属于本包 MIT 授权的源码。

运行依赖通过包管理器安装，许可证随相应依赖保留：

| 依赖 | 作者或版权声明 | 许可证 |
|---|---|---|
| @mozilla/readability 0.6.0 | Copyright (c) 2010 Arc90 Inc；Mozilla 维护 | Apache-2.0，见该包 LICENSE.md |
| jsdom 27.4.0 | Copyright (c) 2010 Elijah Insua | MIT，见该包 LICENSE.txt |
| ipaddr.js 2.5.0 | Copyright (C) 2011–2017 whitequark <whitequark@whitequark.org> | MIT，见该包 LICENSE |
| playwright 1.63.0 | Copyright (c) Microsoft Corporation | Apache-2.0，见该包 LICENSE、NOTICE |

Playwright 的 NOTICE 原文：

```text
Playwright
Copyright (c) Microsoft Corporation

This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer),
available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).
```

Chromium 由 Playwright 的安装器下载，浏览器自身保留其发行包所带的授权声明。
