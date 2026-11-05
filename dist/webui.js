// src/config.ts
var SURFING_MICROLINK_SECRET = "CORTICO_SURFING_MICROLINK_API_KEY";
var SURFING_DEFAULTS = {
  enabled: false,
  reading: { maxResponseEstimatedTokens: 3e3, maxSourceChars: 3e5 },
  bili: { subtitleGroupSec: 30, maxSubtitleRetries: 2, subtitleRetryDelayMs: 1e3 },
  network: { maxDownloadBytes: 8 * 1024 * 1024, requestTimeoutMs: 2e4 },
  cache: { ttlMs: 9e5, maxBytes: 32 * 1024 * 1024 },
  search: { bili: true, tieba: true, moegirl: true, baike: true, maxResults: 5 }
};
var SURFING_CONFIG_GROUP = {
  id: "world:surfing",
  owner: "world:surfing",
  schema: { type: "object", title: "\u9605\u8BFB\u4E0E\u5B57\u5E55", properties: {
    "worlds.surfing.reading.maxResponseEstimatedTokens": {
      type: "integer",
      title: "\u5355\u6B21\u8FD4\u56DE\u4E0A\u9650",
      minimum: 1024,
      maximum: 32768,
      "x-suffix": "\u4F30\u7B97 token",
      "x-hot": true,
      description: "\u5305\u542B\u6B63\u6587\u548C\u7EED\u8BFB\u4FE1\u606F\uFF1B\u4E0B\u6B21\u8C03\u7528\u751F\u6548\u3002\u8FDE\u7EED\u7EED\u8BFB\u4F1A\u7D2F\u79EF\u4E0A\u4E0B\u6587\u3002"
    },
    "worlds.surfing.bili.subtitleGroupSec": {
      type: "integer",
      title: "\u5B57\u5E55\u65F6\u95F4\u5206\u7EC4",
      minimum: 1,
      maximum: 120,
      "x-suffix": "\u79D2",
      "x-hot": true,
      description: "\u5408\u5E76\u663E\u793A\u65F6\u95F4\u6233\uFF0C\u4FDD\u7559\u539F\u53E5\uFF1B\u65B0\u8BFB\u53D6\u751F\u6548\u3002"
    },
    "worlds.surfing.bili.maxSubtitleRetries": {
      type: "integer",
      title: "\u7A7A\u5B57\u5E55\u91CD\u8BD5\u6B21\u6570",
      minimum: 0,
      maximum: 5,
      "x-suffix": "\u6B21",
      "x-hot": true,
      description: "\u9996\u6B21\u4E3A\u7A7A\u540E\u989D\u5916\u91CD\u8BD5\uFF1B0 \u8868\u793A\u5173\u95ED\u3002\u65B0\u8BFB\u53D6\u751F\u6548\u3002"
    },
    "worlds.surfing.bili.subtitleRetryDelayMs": {
      type: "integer",
      title: "\u9996\u6B21\u91CD\u8BD5\u7B49\u5F85",
      minimum: 100,
      maximum: 1e4,
      "x-scale": 1e3,
      "x-suffix": "\u79D2",
      "x-hot": true,
      description: "\u540E\u7EED\u6BCF\u6B21\u7B49\u5F85\u7FFB\u500D\uFF0C\u91CD\u8BD5\u5171\u7528\u5355\u6B21\u8BFB\u53D6\u8D85\u65F6\u3002\u65B0\u8BFB\u53D6\u751F\u6548\u3002"
    }
  } }
};
var SURFING_SEARCH_CONFIG_GROUP = {
  id: "world:surfing:search",
  owner: "world:surfing",
  schema: { type: "object", title: "\u7AD9\u70B9\u641C\u7D22", description: "surfing_search_bili \u4E0D\u53D7 B\u7AD9\u5F00\u5173\u5F71\u54CD\u3002", properties: {
    "worlds.surfing.search.maxResults": {
      type: "integer",
      title: "\u6BCF\u6E90\u663E\u793A\u6761\u6570",
      minimum: 1,
      maximum: 10,
      "x-suffix": "\u6761",
      "x-hot": true,
      description: "\u4F5C\u7528\u4E8E B\u7AD9\u548C\u8D34\u5427\uFF0C\u4E0B\u6B21\u8C03\u7528\u751F\u6548\u3002"
    },
    "worlds.surfing.search.bili": { type: "boolean", title: "B\u7AD9", "x-hot": true },
    "worlds.surfing.search.tieba": { type: "boolean", title: "\u8D34\u5427", "x-hot": true },
    "worlds.surfing.search.moegirl": { type: "boolean", title: "\u840C\u5A18\u767E\u79D1", "x-hot": true },
    "worlds.surfing.search.baike": { type: "boolean", title: "\u767E\u5EA6\u767E\u79D1", "x-hot": true }
  } }
};
var SURFING_LIMITS_CONFIG_GROUP = {
  id: "world:surfing:limits",
  owner: "world:surfing",
  schema: { type: "object", title: "\u83B7\u53D6\u4E0E\u7F13\u5B58\u9650\u5236", properties: {
    "worlds.surfing.reading.maxSourceChars": {
      type: "integer",
      title: "\u5355\u4EFD\u6750\u6599\u4FDD\u7559\u4E0A\u9650",
      minimum: 1e4,
      maximum: 2e6,
      "x-suffix": "\u5B57\u7B26",
      description: "\u6B63\u6587\u3001\u94FE\u63A5\u5730\u5740\u548C\u641C\u7D22\u7ED3\u679C\u5408\u8BA1\uFF1B\u89E6\u9650\u65F6\u6807\u660E\u6750\u6599\u4E0D\u5B8C\u6574\u3002\u65B0\u8BFB\u53D6\u751F\u6548\u3002"
    },
    "worlds.surfing.network.maxDownloadBytes": {
      type: "integer",
      title: "\u5355\u6B21\u8BFB\u53D6\u4E0B\u8F7D\u4E0A\u9650",
      minimum: 1048576,
      maximum: 67108864,
      "x-scale": 1048576,
      "x-suffix": "MiB",
      description: "\u6309\u89E3\u538B\u540E\u6570\u636E\u7D2F\u8BA1\uFF0C\u5305\u542B\u91CD\u5B9A\u5411\u53CA\u6E32\u67D3\u8BF7\u6C42\u3002"
    },
    "worlds.surfing.network.requestTimeoutMs": {
      type: "integer",
      title: "\u5355\u6B21\u8BFB\u53D6\u8D85\u65F6",
      minimum: 3e3,
      maximum: 12e4,
      "x-scale": 1e3,
      "x-suffix": "\u79D2",
      description: "\u6574\u6B21\u8BFB\u53D6\u5171\u7528\u65F6\u9650\uFF1B\u4E0B\u6B21\u8C03\u7528\u751F\u6548\u3002"
    },
    "worlds.surfing.cache.ttlMs": {
      type: "integer",
      title: "\u7EED\u8BFB\u4FDD\u7559\u65F6\u95F4",
      minimum: 6e4,
      maximum: 72e5,
      "x-scale": 6e4,
      "x-suffix": "\u5206\u949F",
      description: "\u5230\u671F\u9700\u91CD\u65B0\u8BFB\u53D6\uFF1B\u65B0\u5FEB\u7167\u751F\u6548\u3002"
    },
    "worlds.surfing.cache.maxBytes": {
      type: "integer",
      title: "\u6587\u672C\u7F13\u5B58\u4E0A\u9650",
      minimum: 8388608,
      maximum: 268435456,
      "x-scale": 1048576,
      "x-suffix": "MiB",
      description: "\u6309\u4FDD\u5B58\u7684\u6570\u636E\u5927\u5C0F\u6838\u7B97\uFF0C\u8D85\u9650\u6DD8\u6C70\u6700\u4E45\u672A\u8BFB\u7684\u6750\u6599\u3002"
    }
  } }
};
var SURFING_CONFIG_GROUPS = [SURFING_CONFIG_GROUP, SURFING_SEARCH_CONFIG_GROUP, SURFING_LIMITS_CONFIG_GROUP];

// src/webui/client.ts
var errorText = (error) => error instanceof Error ? error.message : "\u64CD\u4F5C\u5931\u8D25";
async function mount(ctx) {
  const { ui } = ctx;
  const state = await ctx.invoke("state");
  const layout = ui.h("div");
  layout.style.cssText = "display:grid;gap:20px;max-width:960px;margin:auto";
  let saves = Promise.resolve();
  for (const group of SURFING_CONFIG_GROUPS) {
    const sheet = group === SURFING_LIMITS_CONFIG_GROUP ? ui.foldSheet("surfing-limits", { title: group.schema.title, defaultOpen: false }) : ui.sheet({ title: group.schema.title });
    const grid = ui.h("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px 24px";
    const saved = ui.msgline("");
    const toggles = ui.h("div", "segwrap umulti");
    for (const [path, property] of Object.entries(group.schema.properties)) {
      const save = (value, apply) => {
        saves = saves.then(async () => {
          apply((await ctx.invoke("save", [path, value])).values[path]);
          saved.textContent = `\u5DF2\u4FDD\u5B58\uFF1A${property.title}`;
          saved.classList.remove("bad");
          void ctx.refresh().catch(() => void 0);
        }).catch((error) => {
          saved.textContent = errorText(error);
          saved.classList.add("bad");
        });
      };
      if (property.type === "boolean") {
        const toggle = ui.h("button", "seg", property.title);
        toggle.type = "button";
        const show = (enabled) => {
          toggle.classList.toggle("active", enabled);
          toggle.setAttribute("aria-pressed", String(enabled));
        };
        show(state.values[path] === true);
        toggle.addEventListener("click", () => {
          const value = !toggle.classList.contains("active");
          show(value);
          save(value, (next) => {
            if (toggle.classList.contains("active") === value) show(next === true);
          });
        }, { signal: ctx.signal });
        toggles.append(toggle);
        continue;
      }
      const note = ui.h("small", "muted", property.description);
      note.id = path;
      const scale = property["x-scale"] ?? 1;
      const input = ui.input({ type: "number", value: String(Number(state.values[path]) / scale), onChange: (value) => {
        save(Number(value) * scale, (next) => {
          if (input.value === value) input.value = String(Number(next) / scale);
        });
      } });
      input.min = String(property.minimum / scale);
      input.max = String(property.maximum / scale);
      input.setAttribute("aria-describedby", note.id);
      const row = ui.h("div");
      row.append(ui.field(`${property.title}\uFF08${property["x-suffix"]}\uFF09`, input), note);
      grid.append(row);
    }
    if (toggles.children.length) {
      const caption = ui.h("span", "fieldlabel", "\u6765\u6E90");
      caption.id = `${group.id}:sources`;
      toggles.setAttribute("role", "group");
      toggles.setAttribute("aria-labelledby", caption.id);
      const field = ui.h("div", "fieldrow");
      field.append(caption, toggles);
      const row = ui.h("div");
      row.append(field, ui.h("small", "muted", group.schema.description));
      grid.append(row);
    }
    sheet.body.append(grid, saved);
    layout.append(sheet.el);
  }
  const anchor = (text, href) => {
    const link = ui.h("a", null, text);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  };
  const keyStatus = ui.msgline("");
  let keyPill = ui.pill("", "off");
  const showKey = (keySet) => {
    const next = ui.pill(keySet ? "API Key \u5DF2\u914D\u7F6E" : "\u514D Key", keySet ? "on" : "off");
    keyPill.replaceWith(next);
    keyPill = next;
  };
  async function keyAction(run) {
    try {
      keyStatus.textContent = await run();
      keyStatus.classList.remove("bad");
    } catch (error) {
      keyStatus.textContent = errorText(error);
      keyStatus.classList.add("bad");
    }
  }
  const keyBar = ui.rowbar();
  keyBar.append(
    keyPill,
    ui.button("\u6253\u5F00\u5BC6\u94A5\u6587\u4EF6", { onClick: () => {
      void keyAction(async () => {
        await ctx.invoke("openKeyFile");
        return "\u5DF2\u6253\u5F00\u5BC6\u94A5\u6587\u4EF6";
      });
    } }),
    ui.button("\u5237\u65B0\u5BC6\u94A5\u72B6\u6001", { onClick: () => {
      void keyAction(async () => {
        showKey((await ctx.invoke("state")).keySet);
        void ctx.refresh().catch(() => void 0);
        return "\u5DF2\u5237\u65B0\u5BC6\u94A5\u72B6\u6001";
      });
    } }),
    keyStatus
  );
  showKey(state.keySet);
  const steps = ui.h("ol");
  steps.style.cssText = "list-style:decimal;padding-left:24px;margin:6px 0;line-height:1.8";
  const secret = ui.h("code", "mono", `${SURFING_MICROLINK_SECRET}=`);
  for (const parts of [
    ["\u6253\u5F00", anchor("Microlink \u6CE8\u518C\u9875", "https://dashboard.microlink.io/signup"), "\uFF0C\u6CE8\u518C\u8D26\u53F7\u5E76\u767B\u5F55\uFF0C\u65E0\u9700\u8D2D\u4E70\u4ED8\u8D39\u5957\u9910\u3002"],
    ["\u5728\u63A7\u5236\u53F0\u5DE6\u4FA7\u9009\u62E9\u300COverview\u300D\uFF0C\u70B9\u51FB\u300CUsage\u300D\u6807\u7B7E\u3002"],
    ["\u70B9\u51FB\u300CDevelopment\u300D\u6807\u7B7E\u53F3\u4E0A\u89D2\u7684\u300C\u2026\u300D\uFF0C\u590D\u5236 API Key\u3002"],
    ["\u70B9\u51FB\u300C\u6253\u5F00\u5BC6\u94A5\u6587\u4EF6\u300D\uFF0C\u5C06 Key \u586B\u5728 ", secret, " \u540E\u9762\uFF0C\u4E0D\u52A0\u5F15\u53F7\uFF0C\u4FDD\u5B58\u6587\u4EF6\u3002"],
    ["\u4FDD\u5B58\u540E\uFF0C\u4E0B\u6B21\u8FDC\u7A0B\u8BFB\u53D6\u4F7F\u7528\u8BE5 Key \u7684\u989D\u5EA6\u3002\u70B9\u51FB\u300C\u5237\u65B0\u5BC6\u94A5\u72B6\u6001\u300D\u53EF\u67E5\u770B\u914D\u7F6E\u72B6\u6001\u3002\u6E05\u7A7A Key \u7684\u503C\u5E76\u4FDD\u5B58\u53EF\u6062\u590D\u514D Key \u8C03\u7528\u3002"]
  ]) {
    const step = ui.h("li");
    step.append(...parts);
    steps.append(step);
  }
  const limits = ui.h("p", "muted");
  limits.append("\u514D Key \u548C\u514D\u8D39 Key \u7684\u989D\u5EA6\u4E0D\u540C\uFF0C\u5F53\u524D\u9650\u5236\u89C1", anchor("Microlink \u989D\u5EA6\u8BF4\u660E", "https://microlink.io/docs/api/basics/rate-limit"), "\u3002");
  const microlink = ui.sheet({
    title: "Microlink \u8FDC\u7A0B\u6E32\u67D3",
    desc: "\u672C\u673A Chromium \u4E0D\u53EF\u7528\u65F6\uFF0C\u5C06\u7F51\u9875 URL \u4EA4\u7ED9 Microlink \u6E32\u67D3\u3002API Key \u53EF\u9009\uFF0C\u7559\u7A7A\u4F7F\u7528\u514D Key \u989D\u5EA6\u3002"
  });
  const help = ui.foldSheet("surfing-microlink-key", { title: "\u5982\u4F55\u53D6\u5F97 API Key", defaultOpen: false });
  help.body.append(steps, limits);
  microlink.body.append(keyBar, help.el);
  layout.append(microlink.el);
  ctx.root.replaceChildren(layout);
}
var client_default = { panels: { config: { mount } } };
export {
  client_default as default
};
