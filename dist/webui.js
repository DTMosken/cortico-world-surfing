// src/config.ts
var SURFING_MICROLINK_SECRET = "CORTICO_SURFING_MICROLINK_API_KEY";
var SURFING_DEFAULTS = {
  enabled: false,
  reading: { maxResponseEstimatedTokens: 3e3, maxSourceChars: 3e5 },
  bili: { subtitleGroupSec: 30, maxSubtitleRetries: 2, subtitleRetryDelayMs: 1e3 },
  network: { maxDownloadBytes: 8 * 1024 * 1024, requestTimeoutMs: 2e4 },
  cache: { ttlMs: 9e5, maxBytes: 32 * 1024 * 1024 }
};

// src/webui/client.ts
async function mount(ctx) {
  const { ui } = ctx;
  const sheet = ui.sheet({ title: "Microlink\uFF08\u53EF\u9009\uFF09" });
  sheet.el.style.cssText = "max-width:960px;margin:auto";
  sheet.body.append(ui.h("p", null, "\u7F51\u9875\u5148\u63D0\u53D6\u9759\u6001\u6B63\u6587\uFF0C\u518D\u5C1D\u8BD5\u672C\u673A Chromium\uFF1B\u672C\u673A\u6D4F\u89C8\u5668\u4E0D\u53EF\u7528\u65F6\uFF0C\u5C06\u7F51\u9875 URL \u4EA4\u7ED9 Microlink \u8FDC\u7A0B\u6E32\u67D3\u3002"));
  sheet.body.append(ui.h("p", null, "API Key \u53EF\u9009\u3002\u7559\u7A7A\u4F7F\u7528\u514D Key \u63A5\u53E3\uFF1B\u914D\u7F6E\u540E\u4F7F\u7528\u8BE5 Key \u7684\u989D\u5EA6\u3002\u4FDD\u5B58\u540E\u4E0B\u6B21\u8FDC\u7A0B\u8BFB\u53D6\u751F\u6548\u3002"));
  const buttons = ui.rowbar();
  const status = ui.msgline("");
  let keyStatus = ui.pill("\u514D Key", "off");
  async function refresh() {
    const state = await ctx.invoke("state");
    const next = ui.pill(state.keySet ? "API Key \u5DF2\u914D\u7F6E" : "\u514D Key", state.keySet ? "on" : "off");
    keyStatus.replaceWith(next);
    keyStatus = next;
    await ctx.refresh();
  }
  async function action(method) {
    try {
      if (method === "openKeyFile") {
        await ctx.invoke(method);
        status.textContent = "\u5DF2\u6253\u5F00\u5BC6\u94A5\u6587\u4EF6";
      } else {
        await refresh();
        status.textContent = "\u5DF2\u5237\u65B0\u5BC6\u94A5\u72B6\u6001";
      }
      status.classList.remove("bad");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "\u64CD\u4F5C\u5931\u8D25";
      status.classList.add("bad");
    }
  }
  buttons.append(
    keyStatus,
    ui.button("\u6253\u5F00\u5BC6\u94A5\u6587\u4EF6", { onClick: () => {
      void action("openKeyFile");
    } }),
    ui.button("\u5237\u65B0\u5BC6\u94A5\u72B6\u6001", { onClick: () => {
      void action("state");
    } }),
    status
  );
  sheet.body.append(buttons);
  const help = ui.foldSheet("surfing-microlink-registration", { title: "\u5982\u4F55\u53D6\u5F97\u53EF\u9009 API Key", defaultOpen: false });
  const link = ui.h("a", null, "\u6CE8\u518C Microlink \u8D26\u53F7");
  link.href = "https://dashboard.microlink.io/signup";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const steps = ui.h("ol");
  steps.style.cssText = "padding-left:24px;line-height:1.8";
  for (const text of [
    "\u6253\u5F00\u6CE8\u518C\u94FE\u63A5\uFF0C\u6309\u9875\u9762\u63D0\u793A\u6CE8\u518C\u5E76\u767B\u5F55\u3002",
    "\u5728 Microlink \u63A7\u5236\u53F0\u53D6\u5F97\u5E76\u590D\u5236\u514D\u8D39 API Key\uFF0C\u65E0\u9700\u8D2D\u4E70\u4ED8\u8D39\u5957\u9910\u3002",
    `\u70B9\u51FB\u300C\u6253\u5F00\u5BC6\u94A5\u6587\u4EF6\u300D\uFF0C\u5C06 Key \u586B\u5728 ${SURFING_MICROLINK_SECRET}= \u540E\u9762\uFF0C\u4E0D\u52A0\u5F15\u53F7\uFF0C\u4FDD\u5B58\u6587\u4EF6\u3002`,
    "\u70B9\u51FB\u300C\u5237\u65B0\u5BC6\u94A5\u72B6\u6001\u300D\u67E5\u770B\u914D\u7F6E\u72B6\u6001\u3002\u5220\u9664 Key \u7684\u503C\u5E76\u4FDD\u5B58\u5373\u53EF\u6062\u590D\u514D Key \u8C03\u7528\u3002"
  ]) steps.append(ui.h("li", null, text));
  const limits = ui.h("a", null, "Microlink \u989D\u5EA6\u8BF4\u660E");
  limits.href = "https://microlink.io/docs/api/basics/rate-limit";
  limits.target = "_blank";
  limits.rel = "noopener noreferrer";
  help.body.append(link, steps, limits);
  sheet.body.append(help.el);
  ctx.root.replaceChildren(sheet.el);
  await refresh();
}
var client_default = { panels: { microlink: { mount } } };
export {
  client_default as default
};
