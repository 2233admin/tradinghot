# 信源

信源在后台“信源”页管理：新建、试抓一次看看抓到什么、改频率、启停、看失败原因和最近的条目。首次启动时，`industry/sources.json` 里的示范信源会被导入。

## 六种信源

| 类型 | 适合 | 需要 |
|---|---|---|
| `rss` | 有 RSS / Atom 的博客、媒体、Substack、公众号转 RSS 服务 | 无 |
| `web_list` | 没有 RSS 的网页列表（新闻页、博客列表、更新日志） | 写选择器；按需配置 Jina Reader 渲染（按次计费） |
| `json_list` | 返回 JSON 的接口（GitHub Releases 等） | 写字段路径 |
| `x_search` | X（推特）账号 | SocialData 的 key，按请求计费 |
| `mp_account` | 微信公众号 | 极致了（Dajiala）的 key，按请求计费 |
| `external` | 你自己的脚本推送进来的内容 | `INGEST_TOKEN`，见下文 |

`json_list` 的地址或配置可能携带凭据，只跟随同源重定向（协议、主机和端口都相同）。若接口搬到另一个来源，请直接更新信源地址；不要依赖跨源跳转传递认证信息。

抓取默认不连内网地址。订阅或列表地址指向自建在内网的服务时（比如同一 Docker 网络里的 RSSHub，地址写 `http://rsshub:1200/...`），在 `.env` 里设 `PRIVATE_FEED_HOSTS=rsshub`（逗号分隔的完整主机名，不区分大小写），重启 API 和 worker。放行只对 `rss` 的 `feedUrl`、`web_list` 与 `json_list` 的 `url` 本身生效，这些主机直连、不走 `EGRESS_PROXY_URL`；跳转到别的主机、文章正文、详情页、图片和图标仍按原规则拒绝内网地址，链路本地和云元数据地址（`169.254.0.0/16`、`100.100.100.200` 等）任何时候都拒绝。

每种信源认哪些配置项写在 [`config-keys.ts`](../packages/backend/src/sources/config-keys.ts)。填了不认识的配置项，保存会被拒绝、抓取会直接失败并在后台显示原因，不会悄悄退回通用解析。

## 快速加信源：watchlist.txt

盯一个 X 账号、一个 Discord 频道或一个网站，不用写 JSON：在 [`industry/watchlist.txt`](../industry/watchlist.txt) 里加一行。worker 每小时读一次这份文件（`COLLECT_ENABLED=true` 时），新的一行自动导入；想马上生效就运行 `npm run sources:sync`（Docker 部署运行 `docker compose run --rm setup`；文件打在镜像里，改完要重新构建）。

```
@DeItaone Walter Bloomberg !fast
https://x.com/KobeissiLetter
https://discord.com/channels/111111111111111111/222222222222222222 某财经社区·快讯 !fast
https://www.example.com/markets/ 某财经站
```

| 写法 | 变成 | 需要 |
|---|---|---|
| `@账号` 或 `https://x.com/账号` | `x_search`，`from:账号 -filter:replies`，30 分钟 | 同 [x_search](#x_search)：`SOCIALDATA_API_KEY`，或本机已登录的 opencli |
| Discord 频道链接（右键频道 →“复制链接”） | `json_list`，读频道最近 50 条消息，10 分钟 | `DISCORD_BOT_TOKEN`，见下 |
| 其它网址：订阅地址，或网站的首页、栏目页 | 自动识别成 `rss` 或 `web_list`，30 分钟 | 无 |

地址后面的文字是显示名。`!fast` 等于 `"_aihot": { "fast": true }`（[抓取频率](#抓取频率)，X 快速账号更费 SocialData 预算）；`!hot` 把参与方式设成 `hot_signal`，只作热度证据。分级都是 `T2`，要调到后台改。

已经有信源在盯的账号和地址会跳过，已导入的信源不会被覆盖，删掉一行也不会删信源（到后台“信源”页暂停）。

### 网址怎么自动识别

按这个顺序试，第一个**真的读出条目**的就用（[`discover.ts`](../packages/backend/src/sources/discover.ts)）：

1. 地址本身就是 RSS / Atom。
2. 页面在 `<link rel="alternate">` 里声明的订阅（评论订阅不算）。
3. 页面所在目录和站点根目录下的常见路径：`feed`、`rss`、`rss.xml`、`atom.xml`、`feed.xml`、`index.xml`。
4. 都没有时当网页列表读：把页面上的站内链接按所在结构分组，取标题文字最多、不少于 5 条的那一组当文章列表，写成 `itemSelector`。列表上没有日期的条目，等读到原文页的发布时间后才公开。

识别不出来的行（页面要执行 JavaScript 才有内容、要登录、被风控拦截）不会导入，同步时打印原因，之后每次同步再试；这类站点仍按[中文财经站点](#中文财经站点没有-rss-时怎么接)的办法在后台手写配置。自动认出的网页列表可能混进栏目里的专题或广告链接，导入后在后台“预览抓取”看一眼，不对就改 `itemSelector` 或加 `allowUrlPrefixes`。

### 自动维护

自动识别的信源在配置里记着它那一行的网址（`_aihot.watch`）。它连续 5 次抓取失败（订阅搬家、页面改版）后，每小时的维护任务按这个网址重新识别一遍：找到一种能读出条目、又和现在不同的方式，就换上并立刻重抓，后台“审计”里记一条 `system` 的修改；你在后台给它加的过滤等设置保留。重新识别也失败的不动，照旧在后台标红。手写配置的信源（没有 `_aihot.watch`）不会被自动改。

X 账号改名由原有的 `sources.x-renames` 任务跟随（需要 SocialData）。

### 命令行入口（给人和 Agent）

不进后台也能查看和配置信源，每条命令输出一份 JSON，出错时是 `{"error": "..."}` 并以非零状态退出：

```bash
npm run sources -- list                                  # 所有信源：读哪里、是否启用、连续失败次数和最近的错误
npm run sources -- check https://www.example.com/markets/  # 这个网址会被识别成什么，不保存
npm run sources -- add "@DeItaone Walter Bloomberg !fast"  # 立刻加一个信源，写法同 watchlist.txt 的一行
npm run sources -- sync                                  # 导入 watchlist 新行，修复坏掉的自动识别信源
npm run sources -- pause <id>                            # 暂停；resume <id> 恢复
npm run sources -- fetch <id>                            # 现在抓一次
```

`add` 直接写进数据库，并把这一行追加到 `industry/watchlist.txt`（文件写不了时只进数据库，比如在镜像里运行）。Docker 部署里这样调用：`docker compose run --rm setup node scripts/sources.ts list`。`check`、`add`、`sync`、`fetch` 会访问外部网站，X 和 Jina 的请求照常计费并受预算限制。

### Discord 频道

Discord 没有公开订阅，频道由你自己的机器人读：

1. 在 [discord.com/developers](https://discord.com/developers/applications) 建一个应用，Bot 页打开 **Message Content Intent**（不开的话消息正文是空的），复制 token 填进后端 `.env` 的 `DISCORD_BOT_TOKEN`，重启 API 和 worker。token 只在读取时带上，不存进信源配置。
2. 把机器人邀请进频道所在的服务器，给它“查看频道”和“读取消息历史”。这一步要服务器管理员同意；进不去的服务器，如果目标是公告频道，可以在自己的服务器里“关注”它，再让机器人读自己服务器里的那个频道。不要用个人账号的 token 代替机器人，这违反 Discord 的服务条款。
3. 把频道链接写进 `watchlist.txt` 并同步。

每条消息是一条资料：有文字的用文字，只有卡片（很多快讯机器人这样发）的用第一张卡片的标题和描述，只有图片或附件的跳过。原文链接指向 Discord 里的那条消息，读者要在该服务器里才打得开。每轮只读最近 50 条，不翻页：停机期间超过 50 条的消息会漏掉。没有填 token 时信源在后台报 `DISCORD_BOT_TOKEN is not configured`；机器人不在服务器里或没有权限时是 HTTP 403。

## 先预览，再创建

进入 `/admin/sources/new`，填写 ID、名称，选择类型，再把[下一节](#每种信源怎么配置)对应的 JSON 填入“采集配置（JSON）”。这里填的是配置对象，不要包上 `kind` 或 `config`。切换类型会重置配置，先选类型再粘贴。

名称里全角括号中的备注（比如“某媒体（热点 RSS）”）只给后台看，读者在网页、RSS、Agent Markdown、MCP 和搜索里看到的是去掉备注的名字；X 账号写成 `X：显示名 (@handle)` 的，读者只看到显示名。公开 API 的 JSON 里仍是完整的名字。

`rss`、`web_list`、`json_list`、`x_search` 可以点“预览抓取”：显示条目总数和前 20 条的标题、原文链接、发布时间、摘要，不把条目存入文章库。检查抓到的是文章而不是导航，日期与原文一致，再点“创建”。预览和正式采集套用同一组过滤（地址前缀、分类、噪声词、地址改写、`publishedAfter`），看到的就是正式采集会收的条目；但它不等于完成生产采集，也不经过后续详情补齐、精选和公开发布流程。

预览仍会发出抓取请求；X 和 Jina 预览也可能产生费用，经过付费回执和预算。`COLLECT_ENABLED=false` 只关闭后台自动采集，不能用它来保证手动预览不访问外部服务。下面的本地 HTML/JSON 示例不需要任何 API key。

## 每种信源怎么配置

### rss

```json
{ "feedUrl": "https://example.com/feed.xml" }
```

可选：`summaryIsBody`（确认文字订阅里的摘要就是全文时，将 RSS 的 `description`、Atom 的 `summary` 当正文，不再去抓原文页）、`allowCategories` / `denyCategories`（按订阅里的分类过滤）。

所有信源的 YouTube、Vimeo 视频播放页都不作为文章正文提取。Media RSS 的视频描述保留为摘要，即使设置了 `summaryIsBody` 也不会把描述当成视频字幕；订阅通过 `content` / `content:encoded` 提供的真实文字仍可使用。其他文章中嵌入视频，不影响文章本身的正文读取。

文章正文中的原生视频保留安全的媒体地址和候选格式，使用浏览器控件手动播放。视频文件由浏览器直连原站，封面沿用图片代理；不自动播放、不循环，预加载提示设为 `none`，但浏览器不保证交互前完全没有请求。没有媒体地址和可用封面的播放器只保留后备文字。Markdown 和允许再分发的全文 RSS 保留视频结构，能否播放取决于阅读器；动态平台播放器和 iframe 不在此范围。

文章插图里内嵌的 SVG 图不保留图形本身（颜色和字体依赖原站样式表），换成原站给这张图写的无障碍文字说明（`aria-label`、`aria-labelledby` 指向的文字，或图里的 `<title>`、`<desc>`），作为纯文字放在图原来的位置；同一张图的宽窄两版只留一份，插图里已经显示的文字（图注、小标题）不重复。没有文字说明的图和插图之外的 SVG 图标照旧去掉。

没有网页的播客单集（没有 `<link>`、`guid` 也不是网址），原文链接用它的音频或视频文件，浏览器可以直接播放；这类单集不抓网页，按订阅里的文字处理。

### web_list

支持普通 CSS 选择器，`div` 列表也能采集。关键是 `itemSelector` 要选中**每条新闻**，而不是包住所有新闻的容器。例如：

```html
<div class="news-list">
  <div class="news-item">
    <h2><a href="/posts/first">第一条示例新闻</a></h2>
    <time datetime="2026-10-01T09:00:00+08:00">10 月 1 日</time>
  </div>
  <div class="news-item">
    <h2><a href="/posts/second">第二条示例新闻</a></h2>
    <time datetime="2026-10-01T10:00:00+08:00">10 月 1 日</time>
  </div>
</div>
```

对应配置（`example.com` 是占位地址，换成目标网页；可运行版本见[本地示例](#本地跑通-htmljson-示例)）：

```json
{
  "url": "https://example.com/news",
  "parseMode": "html",
  "itemSelector": ".news-list > .news-item",
  "linkSelector": "h2 a",
  "titleSelector": "h2 a",
  "publishedAtSelector": "time",
  "allowUrlPrefixes": ["https://example.com/posts/"]
}
```

- `itemSelector` 在整个页面找条目；`linkSelector`、`titleSelector` 在每个条目内取第一个匹配节点，也可以匹配条目自身。选 `.news-list` 只会得到一个容器，通常只取到第一条新闻；只写 `div` 又会混入嵌套容器。要选重复出现的新闻节点。
- `authorSelector` 可选，在每个条目内取第一个匹配节点的文字作为作者；不要选包含多个作者或其他内容的外层容器。
- 链接取自 `href`；`/posts/first` 等相对链接按列表重定向后的最终地址解析，也可用 `baseUrl` 指定基准地址。标题取节点文字。重复链接会合并；Markdown 列表先出现“Read more”等按钮、后出现真实标题时，使用真实标题。指向列表自身的链接通常会跳过。
- 日期在条目内查找 `publishedAtSelector`，依次尝试 `datetime`、`content`、`title` 属性和文字，无法解析的提示文字不会遮住同一节点的有效日期。没有时区的日期时间可用 `publishedAtUtcOffset`（默认 `+08:00`）；自带时区的时间保留原时区语义，纯 `YYYY-MM-DD` 按 UTC 零点读。不完整的月份、产品版本号和不存在的日历日期不作为发布日期。
- `parseMode`：普通网页默认 `html`；`markdown` 按 Markdown 链接读；`docusaurus_changelog` 读更新日志标题；`intercom_changelog` 按 Intercom 帮助中心的日期章节读取标题和正文，每节保留自己的网址锚点，默认按 UTC 日历日读取，也可指定 `publishedAtUtcOffset`。需要 Jina 时，显式把 `url` 写成 `https://r.jina.ai/https://目标站/路径` 并配置 `JINA_API_KEY`，不是抓不到就自动切换。Jina 默认返回 Markdown；要继续使用 CSS 选择器，显式设 `parseMode: "html"`。
- `detail`：列表缺日期、标题或摘要时抓详情页补齐（`publishedAtSelector`、`titleSelector`、`summarySelector` 等）。`maxFetches` 是每轮最多读几篇详情页，不设时为 0，即一篇都不读：每读一篇就多一次请求，所以要信源自己声明。读取失败或本轮 `maxFetches` 用完的条目，后续抓取继续补全；补元数据时保留已确认的正文。已有真实标题不会因为列表仍写“Read the Blog”而被换回按钮文字，也不会仅因标题较长再次读取详情。需要强制使用详情标题时设置 `titleAuthoritative: true`。详情页和正文提取读到不带时区的时间时，先用 `detail.publishedAtUtcOffset`，未设则继承信源的 `publishedAtUtcOffset`，两处都未设时默认 `+08:00`。RSS、JSON 列表也可以用 `detail`。
- Jina 列表的 `detail.titleRegex`、`publishedAtRegex` 匹配 Jina 文本，可共用同一次详情响应；CSS 选择器读取原站 HTML。应按实际可读取的页面选择规则。
- `allowUrlPrefixes` / `denyUrlPrefixes`：只收某些路径下的文章。

### json_list

假设接口返回下面的结构，`itemsPath` 指向数组，其他字段路径相对**每个数组元素**填写。路径用点分隔，不是 JSONPath，不写 `$` 或 `[*]`。

```json
{
  "data": {
    "items": [
      {
        "id": "first",
        "title": "第一条示例新闻",
        "url": "https://example.com/posts/first",
        "summary": "第一条新闻的摘要。",
        "published_at": "2026-10-01T09:00:00+08:00"
      }
    ]
  }
}
```

对应配置：

```json
{
  "url": "https://example.com/api/news",
  "mode": "json_api",
  "itemsPath": "data.items",
  "titlePaths": ["title"],
  "urlTemplate": "{raw:url}",
  "summaryPaths": ["summary"],
  "publishedAtPath": "published_at",
  "externalIdPath": "id"
}
```

- 接口本身返回数组时，省略 `itemsPath`。`titlePaths`、`summaryPaths`、`authorPaths` 是候选路径数组，按顺序取第一个非空值，例如 `["title", "name"]`。
- 已有完整网址时用 `{raw:url}`；只有 slug 时可用 `https://example.com/posts/{slug}`。`{字段路径}` 会编码字段值，`{raw:字段路径}` 原样插入。JSON 列表不会自动把相对网址补成绝对网址，模板应产出完整的 HTTP(S) 地址。
- `summaryIsBody`：确认接口里的摘要就是全文时设为 `true`，把 `summaryPaths` 取到的文字当正文，不再去抓原文页。
- 日期建议返回带时区的 ISO 字符串；`2026-09-30 17:43:58` 这类不带时区的时间，与网页列表一样按 `publishedAtUtcOffset` 读（默认 `+08:00`）；数字时间戳分别设 `publishedAtUnit: "epoch_s"`（秒）或 `"epoch_ms"`（毫秒），`20261001` 这类日期设 `"yyyymmdd"`。
- 缺少标题或无法生成链接的条目会跳过。非空数组全部映射失败时，会报 `no items mapped (check title/url paths)`；路径不是数组时，会报 `items path did not resolve to an array`。
- `pagination`：仅支持直接 GET JSON 列表，填写 `{"pageParam":"pagenum","startPage":1,"maxPages":3}`，每轮从起始页读到空页或上限；`maxPages` 为 1–10。快速信源每页在读取下一页前先持久缓存。达到上限时运行标为覆盖未验证；分页不保证排序稳定，也不能保证停机期间超过窗口的帖子不遗漏。分页不能与浏览器、Jina、POST、`requireBoolean` 或 `minNumeric` 一起使用。

### 本地跑通 HTML/JSON 示例

仓库提供两份虚构示例：[news.html](examples/sources/news.html) 和 [news.json](examples/sources/news.json)，各有两条新闻。它们用于核对选择器和字段映射，不是运营信源；示例文章链接不提供正文。

在仓库根目录、Node.js 24.11 以上运行以下命令。服务只监听本机，只提供这两份文件；用 `Ctrl+C` 停止。

```bash
node --input-type=module -e '
import http from "node:http";
import { readFileSync } from "node:fs";
const files = {
  "/news.html": ["text/html; charset=utf-8", readFileSync("docs/examples/sources/news.html")],
  "/news.json": ["application/json", readFileSync("docs/examples/sources/news.json")]
};
http.createServer((req, res) => {
  const file = files[req.url];
  res.writeHead(file ? 200 : 404, { "content-type": file ? file[0] : "text/plain" });
  res.end(file ? file[1] : "Not found");
}).listen(8787, "127.0.0.1");'
```

在同一台机器上，按[非 Docker 部署方式](deploy.md#不用-docker)准备好数据库，用 `npm run dev:api`、`npm run dev:web` 运行开发 API 和网页，保持采集、模型、飞书和 IndexNow 开关关闭，不启动 worker。仅为此次本机示例，在开发 API 进程设置 `ALLOW_PRIVATE_NETWORK_FETCH=true` 后重启；默认禁止抓内网地址，生产环境拒绝启用此项，验证后移除。若 API 在容器或另一台服务器，`127.0.0.1` 指向它自己，此命令的地址不能直接用于该部署。

分别选择 `web_list`、`json_list`，粘贴配置并点“预览抓取”，无需创建信源：

```json
{
  "url": "http://127.0.0.1:8787/news.html",
  "parseMode": "html",
  "itemSelector": ".news-list > .news-item",
  "linkSelector": "h2 a",
  "titleSelector": "h2 a",
  "publishedAtSelector": "time",
  "allowUrlPrefixes": ["http://127.0.0.1:8787/posts/"]
}
```

```json
{
  "url": "http://127.0.0.1:8787/news.json",
  "mode": "json_api",
  "itemsPath": "data.items",
  "titlePaths": ["title"],
  "urlTemplate": "http://127.0.0.1:8787/posts/{id}",
  "summaryPaths": ["summary"],
  "publishedAtPath": "published_at",
  "externalIdPath": "id"
}
```

两次都应显示 **2 条**，依次为下表内容。JSON 示例还显示对应摘要，HTML 示例没有配置摘要提取。预览 API 的日期是 UTC，后台界面按 `+08:00` 显示为 09:00 和 10:00。

| 标题 | 原文链接 | 预览 API 的 publishedAt |
|---|---|---|
| 第一条示例新闻 | `http://127.0.0.1:8787/posts/first` | `2026-10-01T01:00:00.000Z` |
| 第二条示例新闻 | `http://127.0.0.1:8787/posts/second` | `2026-10-01T02:00:00.000Z` |

可以把 HTML 的 `itemSelector` 暂改成 `.news-list` 对照：只会返回第一条。改回 `.news-list > .news-item` 后恢复两条，这就是“列表容器”和“每条新闻”的区别。

抓真实网页时先看原始 HTTP 响应中有没有新闻节点。普通 HTML 模式不执行 JavaScript；浏览器里看得到、响应里没有的内容，不能靠换一个 CSS 选择器生成。优先找 RSS 或 JSON 接口，或按需配置 Jina / 自己维护的外部采集。`no items matched (html)` 还可能是选择器不匹配、没有 `href` 或标题、链接被前缀规则过滤；先核对响应与配置，不必先更换采集器。

### x_search

这类信源使用 SocialData 搜索，不是把 X 个人主页 URL 填入网页列表。以 `https://x.com/SomeAccount` 为例，取用户名 `SomeAccount`，不要包含 `@` 或整段 URL：

```json
{ "query": "from:SomeAccount -filter:replies", "searchType": "Latest" }
```

`SomeAccount` 是占位用户名，换成你要关注的真实账号。`-filter:replies` 排除回复；`Latest` 按最新内容查找。

在后端运行环境的 `.env` 配置 `SOCIALDATA_API_KEY`，重启 API（预览）和 worker（定时采集）后生效；不要把 key 写进信源 JSON 或提交到仓库。先在后台“设置 → 付费请求上限”检查 SocialData 额度，再按需预览。未配置 key 时会改用浏览器回退（见下），不再报 `SOCIALDATA_API_KEY is not configured`；服务拒绝请求或预算熔断时看后台错误原因。预览可能有付费请求，本文不要求用真实服务验证，结果取决于账号和服务当时的返回。

没有 `SOCIALDATA_API_KEY` 时，程序用本机 opencli 的 `twitter search`，借浏览器里已登录的 X 会话执行查询，不产生付费请求。前提：Chrome 安装 OpenCLI 扩展并在 x.com 登录（`opencli twitter whoami` 能看到账号）；同时连着多个 Browser Bridge 配置时，在 `.env` 填 `X_OPENCLI_PROFILE=<profile>`（`opencli profile list` 查看），重启 API 与 worker。浏览器按账号分别搜索，同一进程最多并行两条 X 搜索；这一限制不跨进程，多个进程仍共享浏览器和平台额度。每次最多读 60 条且不返回可续读游标；已观察的帖子会按身份去重保存，但无法证明结果完整，因此不推进覆盖水位、不丢弃已有付费分页位置，后台运行记录标为覆盖未验证。无效响应报错，不当成空结果。首次导入完成后记录导入时间，后续发现的新帖不会一直按历史导入处理。X 长文（Article）正文仍要 SocialData 的 `getArticle`，没有 key 时正文只保留推文文本。配置 key 后自动回到付费接口。

使用 SocialData 时，生产自动采集的普通账号会被自动合并成一次搜索（每次最多二十几个账号），省请求数；单个信源的手动预览不是合并采集。

### mp_account

```json
{ "ghid": "gh_xxxxxxxx", "nickname": "公众号名称" }
```

每个公众号按它的抓取间隔检查一次（查列表按次计费），新文章的正文一并取回。

需要在后端 `.env` 配置 `DAJIALA_KEY`，`ghid` 换成公众号原始 ID。配置字段用上面的 `ghid` / `nickname`，不要写成 `biz` / `name`。当前 `mp_account` 不支持“预览抓取”；`external` 也不支持主动试抓，按下方推送接口接入。

### 中文财经站点：没有 RSS 时怎么接

中文财经站大多不提供 RSS，公开列表又是浏览器里执行 JavaScript 后才出现。能用的入口只有三类：站点自己的 JSON 接口、服务端渲染好文章链接的列表页、以及少数仍在维护的 RSS。`industry/sources.json` 里已按这三类各接了一批，配置见下（预览、采集、公开页、搜索都走同一套，不需要为某个站单独加代码）。

| 信源 | kind | 入口 | 单次上限 / 频率 |
|---|---|---|---|
| 财联社 · 电报 | `json_list` | `www.cls.cn/v1/roll/get_roll_list`（`itemsPath: data.roll_data`） | 50 条 / 10 分钟 |
| 格隆汇 · 快讯 | `json_list` | `www.gelonghui.com/api/live-channels/all/lives/v4` | 15 条 / 10 分钟 |
| 格隆汇 · 资讯 | `json_list` | `www.gelonghui.com/api/channels/web_home_page/articles/v8` | 12 条 / 30 分钟 |
| 第一财经 · 新闻 | `json_list` | `www.yicai.com/api/ajax/getjuhelist?action=news&page=1&pagesize=30` | 30 条 / 30 分钟 |
| 财新 · 最新 | `json_list` | `gateway.caixin.com/api/dataplatform/scroll/index`（`time` 是毫秒时间戳） | 20 条 / 60 分钟 |
| 每日经济新闻 · 要闻 | `web_list` | `www.nbd.com.cn/columns/3/`，`li.u-news-title` | 列表 20 条 + 详情 20 页 / 30 分钟 |
| 集思录 · 最新发表 | `web_list` | `www.jisilu.cn/home/explore/category-__sort_type-add_time` | 启用自动采集前须确认平台授权 |
| 华尔街见闻 · 快讯 | `json_list` | `api-one.wallstcn.com/apiv1/content/lives?channel=global-channel`（`data.items`，`display_time` 秒） | 100 条 / 10 分钟 |
| 智通财经 · 推荐 | `json_list` | `r.jina.ai` + `www.zhitongcaijing.com/content/recommend.html?data_type=1&page=1` | 20 条 / 30 分钟 |
| 界面新闻 · 快讯 | `web_list` | `www.jiemian.com/lists/1324kb.html`，`data-time` 属性是秒级时间戳 | 列表 20 条 / 15 分钟 |
| 雪球 · 热门讨论 | `json_list` | `xueqiu.com/statuses/hot/listV2.json`，`via: opencli` 用已登录浏览器读 | 20 条 / 30 分钟 |
| 东方财富 · 合作伙伴资讯 | `rss` | `rss.eastmoney.com/rss_partener.xml` | 按 feed / 30 分钟 |
| 淘股吧 · 首页帖子 | `json_list` | `www.tgb.cn/newIndex/getZh?pageNo=1` | 首页 / 快速模式 |
| 韭研公社 · 最新发布 | `web_list` | `www.jiuyangongshe.com/study_publish`，`.community-bar ul > li` | 列表首页 / 快速模式 |
| 东方财富股吧 · 首页 | `web_list` | `guba.eastmoney.com/index.html`，`.balist ul.newlist > li` | 首页 / 快速模式；按最后更新排序 |

三类要点：

- **财联社的 URL 带签名**。`sign` 是 `md5(sha1(参数按字段名排序后拼成的查询串))`，参数固定（`app=CailianpressWeb&category=&last_time=&os=web&refresh_type=1&rn=50&sv=7.7.5`）时签名也不变，所以能整段写进配置。改动 `rn` 或其它参数必须重算签名；站点轮换 `sv` 或客户端 ID 时这个地址会返回签名错误，表现为采集失败、`last_error` 停在 `errno 10012`，重算签名即可恢复。
- **列表默认只取第一页**。JSON 列表可按上面的 `pagination` 显式启用有限翻页；其他列表仍只请求配置里的一个地址。首次导入只回填 `_aihot.initialBackfillLimit` 条（默认 30），之后靠轮询去重；超过分页窗口或因排序变化跨页移动的条目仍可能遗漏。
- **站点从本机网络不可达时，用 Jina 中转**。把列表或接口地址写成 `https://r.jina.ai/<原地址>`，三种 kind 都认：`web_list` 会向 Jina 要渲染后的 HTML（`parseMode: html` 时）或 Markdown，`json_list` 会把 Jina 取回的 JSON 正文照常按 `itemsPath` 解析。Jina 免费额度接受不带 key 的读，代码里 `JINA_API_KEY` 因此是可选的；配了 key 就走账号额度、按 token 计费。智通财经和证券时报的站点直连超时，智通就是靠这条路接进来的。代价是一次列表读取要经过第三方，`r.jina.ai` 本身不可达时该源会失败。

**列表里可以直接给摘要和时间**：`web_list` 的 `summarySelector` 把列表里已有的提要写进 `excerpt`，`publishedAtAttribute` 读取元素属性里的时间戳。列表自带摘要时不必再为每条抓详情。集思录的列表时间可能是回复时间，因此最新发表源只从详情页的“发表时间”取原帖时间；每经用详情的 `"pubDate"` 字段补发布时间。`detail.maxFetches` 是每轮最多读几页详情，按列表长度和站点容忍度设。

东方财富股吧首页按最后更新排列，帖子出现在首页不等于刚发表；页面时间缺少年份，配置不把它当作可信发布时间。原帖详情若要求身份核实，标题和链接仍可缓存，发布时间和正文可能无法补齐，不能据此保证所有新帖被发现或公开。

#### 指定论坛作者

已知作者的站内 ID 后，可以在后台分别建一个快速信源，不必等待作者的帖子出现在广场首页。下面的 ID 占位符要替换成实际用户的 ID；这些是单页轮询，不保证高产账号、置顶帖或访问受限时不漏帖。

集思录的[服务协议第四条第三款第（6）项](https://www.jisilu.cn/account/agreement/)将利用爬虫、数据挖掘等自动化工具抓取数据或内容列为禁止行为。对首页或指定作者启用自动采集前，应先取得平台授权或使用经授权的数据服务；公开页面可以访问不代表已获得采集许可。

淘股吧选择 `json_list`，使用用户主页 `/blog/` 后的数字 ID；移动站的用户主帖接口返回原帖时间和作者，而不是最新回复时间：

```json
{
  "url": "https://m.tgb.cn/mBlogTopicAjax?userID=用户ID&sortFlag=W&pageNo=1",
  "itemsPath": "dto.listTopic",
  "titlePaths": ["subject"],
  "summaryPaths": ["content"],
  "authorPaths": ["userName"],
  "publishedAtPath": "postDate",
  "externalIdPath": "topicID",
  "urlTemplate": "https://m.tgb.cn/a/{newTopicID}",
  "_aihot": { "fast": true }
}
```

韭研公社选择 `web_list`，使用用户主页 `/u/` 后的用户 ID。作者页公开列表与最新发布页使用相同的条目结构：

```json
{
  "url": "https://www.jiuyangongshe.com/u/用户ID",
  "itemSelector": ".community-bar ul > li",
  "linkSelector": ".html-text a",
  "titleSelector": ".book-title",
  "authorSelector": ".username .fs16-bold",
  "publishedAtSelector": ".fs13-ash",
  "allowUrlPrefixes": ["https://www.jiuyangongshe.com/a/"],
  "_aihot": { "fast": true }
}
```

东方财富股吧的用户主页地址中有数字用户 ID。选择 `json_list`，用作者动态列表中的原帖时间、作者和股吧代码生成链接；该接口包含发帖与转发，不包括单独的评论列表：

```json
{
  "url": "https://i.eastmoney.com/api/guba/userdynamiclistv2?uid=用户ID&pagenum=1&pagesize=20&type=1",
  "itemsPath": "result",
  "titlePaths": ["post_title", "post_content"],
  "summaryPaths": ["post_content"],
  "authorPaths": ["post_user.user_nickname"],
  "publishedAtPath": "post_publish_time",
  "externalIdPath": "post_id",
  "urlTemplate": "https://guba.eastmoney.com/news,{post_guba.stockbar_code},{post_id}.html",
  "pagination": { "pageParam": "pagenum", "startPage": 1, "maxPages": 3 },
  "_aihot": { "fast": true }
}
```

东方财富动态接口本次单次公开样本返回 20 条；示例最多读取三页，达到上限时会报告覆盖未验证，不能保证密集发帖或离线期间不漏帖。访问权限、账号可见性和发帖到缓存的持续时效仍需逐账号核实。集思录自动采集须先确认平台授权。来源内容默认只公开摘要和原文链接，不因接口返回正文而开放全文。

**只认登录态浏览器接口的站点，用 opencli 读**（雪球）：`json_list` 配置里写 `"via": "opencli"`，采集器会用本机 opencli 把这个接口地址当成标签页打开（`browser <session> open ... --window background`），再取页面文本当响应体，跳过站点对匿名请求的风控。前提是 Chrome 装了 OpenCLI 扩展、雪球已登录；同时连着多个 Browser Bridge 配置时必须在 `.env` 里指定 `OPENCLI_PROFILE`（`opencli profile list` 查看），否则 opencli 会拒绝执行。每条信源用自己的 session（默认取信源 id），两轮采集不会抢同一个标签页。代价是一次采集要驱动一次浏览器，雪球这一轮实测约 37 秒；Twitter 的搜索额度（429 `SearchTimeline`）也会连带影响 X 信源，冷却 15–30 分钟后再抓即可。

**查询**：新信源不需要单独接入搜索。条目发布后会进 `publications.search_text`（中文标题 + 摘要 + 信源名），站内搜索、`/api/site/pool?q=`、`/api/v1/items?q=`、`/api/v1/agent/search` 和 MCP 的 `search` 工具读的是同一份数据。中文按子串匹配，`多模态RAG` 会拆成 `多模态` 和 `rag` 两个词；两字词（如「豆粕」）在 trigram 索引上退化为扫描，条目量增长后要按查询计划再决定是否加短词索引。

### 政府一手数据：部委的 RSS

部委网站大多还在维护 RSS，而且是**事件第一次公开的地方**：媒体把 CPI、PMI、国务院文件写成稿子要晚几分钟到几十分钟，一手页面本身带权威数字和原文链接。已接的是：

| 信源 | kind | 入口 | 单页容量 / 频率 |
|---|---|---|---|
| 国家统计局 · 数据发布 | `rss` | `www.stats.gov.cn/sj/zxfb/rss.xml` | 500 条全量 / 30 分钟 |
| 国家统计局 · 数据解读 | `rss` | `www.stats.gov.cn/sj/sjjd/rss.xml` | 500 条全量 / 60 分钟 |
| 中国政府网 · 原创推荐 | `rss` | `www.gov.cn/pushinfo/v150203/rss.xml` | 60 条 / 60 分钟 |

三个要点：

- **统计局的 feed 是全量存档，不是增量**：一次返回 500 条、约 2.1 MB，最早到 2024 年。所以必须靠 `_aihot.initialBackfillLimit`（这里设 30）限制首次导入，之后靠轮询按 URL 去重；不要指望列表长度本身是“这一轮的新内容”。它带 `ETag` 和 `Last-Modified`，内容没变时响应是 304，只有发布日才会真正下载那 2 MB。
- **`pubDate` 是不带时区的北京时间**（`2026-11-04 09:30:00`）。`readPublicationDate` 在没有显式时区时按信源的 `publishedAtUtcOffset` 读，缺省就是 `+08:00`，所以这里不用写这个键；写成别的值会把每一条整体平移。中国政府网的 `pubDate` 是带 `GMT` 的 RFC 822，走另一条分支。两者的时区都由文字本身决定，不受运行机器时区影响。
- **正文页有 JavaScript 反爬**：同一个地址，普通抓取会拿到 `<noscript>Please enable JavaScript…</noscript>` 的挑战页；采集器的 UA 能拿到真页面，但取到的正文开头带着页面自身的“2026/11/04 09:30 | Aa 字体：小 中 大”这一行。模型写作开着时这一行会被摘要改写掉；临时用 `writing=source` 时它会原样出现在摘要里，这不是解析错误。

这些源按 `T1` 官方一手登记：入选门槛 60（`industry/selection.ts`），同一条新闻有多篇报道时优先当代表报道。政府文件属于公开信息，但站内仍按默认只展示摘要和原文链接（`site_fulltext: false`），需要全文展示时再逐源打开。

### 央行、财政部、证监会、海关总署与沪深交易所

同样是一手披露，但这五家的页面各自挡住了普通抓取，接入方式分三种：

| 信源 | kind | 入口 | 方式 |
|---|---|---|---|
| 中国人民银行 · 新闻 | `web_list` | `www.pbc.gov.cn/goutongjiaoliu/113456/113469/index.html` | 直连，`td:has(font.newslist_style)` + `span.hui12` |
| 财政部 · 财政新闻 | `web_list` | `www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/` | 直连，`ul.xwfb_listbox > li`，日期在 `span` |
| 证监会 · 证监会要闻 | `web_list` | `www.csrc.gov.cn/csrc/c106311/common_list.shtml` | `via: opencli`，`li:has(span.date)` |
| 海关总署 · 要闻 | `web_list` | `www.customs.gov.cn/` | `via: opencli`，`ul.news_list li` |
| 上交所 · 上市公司公告 | `json_list` | `www.cninfo.com.cn/new/hisAnnouncement/query` | 表单 POST（`bodyForm`），`plate=sh` |
| 深交所 · 上市公司公告 | `json_list` | 同上 | 表单 POST，`plate=sz` |

四个坑：

- **`via: opencli` 现在对 `web_list` 也生效，而且管到正文**。证监会是阿里云 WAF、海关总署是加速乐，直接 `fetch` 拿到的是滑块页或 412；把地址交给信源自己的浏览器标签页打开、再取 `document.documentElement.outerHTML`，才拿得到带日期的列表。同一个信源的文章正文也要走这条：`pageRules()` 见到 `via: opencli` 会给每篇文章单开一个会话（名字取 `article:<id>`），读完就 `browser <session> close`，既不会两个抓取抢同一个标签页，也不会留下几十个标签页。代价是一次抓取要驱动浏览器，证监会一轮 18 条约 22 秒，正文每篇再多几秒。**挑战脚本有时在等待窗口（约 20 秒）内没跑完**，那一条就记为 `unconfirmed`：标题和链接在库里，但没有正文，因此没有摘要、不进公开列表；下一轮采集按新条目重新试，不改写旧记录。
- **证监会要闻的栏目号会变**：`c100028` 是旧栏目，页面上还挂着 2021 年的稿子；当前稿子在 `c106311`。接入前先在浏览器里看一眼“最新一条的日期”，别被静态列表骗了。
- **沪深公告走巨潮资讯的表单接口**，不是 JSON：同一个接口用 JSON 提交会被忽略过滤条件（返回 36 万条），必须 `bodyForm` + `application/x-www-form-urlencoded`。`seDate` 留空表示“最新一页”，不用在配置里写死日期。`plate=sh`/`plate=sz` 才是沪深两市的切分条件（`column` 传什么都一样）；`category` 只有 `category_fxts_szsh`（风险提示）这类真编码会生效，写错编码等于不加过滤。
- **公告链接是 PDF，正文不抓**。`json_list` 见到 `url` 以 `.pdf/.doc/.xls` 结尾时把 `bodyStatus` 记为 `none`：公告标题已经带公司名和事项，PDF 正文走 Jina 读取既慢又会失败（实测 30 条里只有 4 条读成）。摘要用 `summaryTemplate` 由字段拼成「证券名称（代码）」，卡片上至少能看出是哪家公司。这个字段只在 JSON 接口里生效。

**体量提醒**：沪深公告合计每天约一千条，而这个采集器每次只取列表第一页。`pageSize=30`、30 分钟一轮，理论容量 1440 条/天，能覆盖日均量，但公告集中在 15:30–19:00 和 8:00–9:00，高峰时段会漏。要更细，就在后台给这两个源设 `selection_class: filings`（把入选门槛抬到 72），或者把 `pageSize` 加到 50（接口允许），别指望它覆盖全部公告。

## 分级、参与方式与全文

- **分级** `tier`：`T1` 官方一手（官网、官方博客、机构）、`T1_5` 官方账号与准官方创作者、`T2` 媒体与个人、`EXCLUDE_MP` 不参与精选。入选门槛按分级不同（`industry/selection.ts`）。
- **信源类别**（可选）：日常内容主要写给开发者或业内的官方信源，可以在后台“信源”页选一个类别（`industry/selection.ts` 的 `classes`），入选门槛抬到不低于类别的数，见 [精选与校准](selection.md#门槛industryselectionts)。`industry/sources.json` 不带这一项，导入后在后台设。
- **参与方式** `participation_mode`：`editorial` 进精选和全部动态；`hot_signal` 不单独展示，只作为“大家在讨论什么”的热度证据；`isolated` 不进任何公开页面。
- **一手**：只有 `T1` 算一手，不单独设置。同一条新闻有几篇报道时，代表报道优先选一手的，事件页也优先展示一手报道。
- **发布方**（可选，写在 `config` 里）：
  - `publisherUrlPrefixes`：`T1` 信源自己文章网址的前缀，比如 `["https://example.com/blog/"]`。别的信源（聚合站、转帖）带来的这些网址的文章，只要能认定是唯一一个官方信源的，就改记到它名下。网页列表信源不写时，认它自己列表所在的路径（这篇也要在它的列表里出现过）。
  - `publisherRole`：`T1_5` 账号的身份，`organization`（机构官方账号）或 `person`（官方人员）。再填上信源的 `owner_entity_id`（`industry/taxonomy.ts` 的 `ENTITIES` id），这个账号发的、主体正是这家公司的新闻，就能当代表报道（排在 `T1` 之后）。
- **全文**：`site_fulltext` 决定站内能不能显示全文，`syndicate_fulltext` 决定全文 RSS 能不能带正文。两者**默认都关**，只显示摘要和原文链接；来源明确允许时再打开。公众号、付费墙内容不会因为技术上抓得到就获得全文展示。

## 抓取频率

每个信源有自己的抓取间隔。每天 04:20 会按近 7 天的产出自动调整：产出多的抓得勤，最短 15 分钟（经 Jina 读的网页列表最短 60 分钟）；最长的，一般信源 60 分钟，X 账号和经 Jina 读的网页列表 120 分钟，只作热度证据的 180 分钟。合并搜索的 X 账号跟着合并后的节奏：进精选的半小时一次，只作热度证据的一小时一次。

抓取失败不推进位置，下次从同一处继续；连续失败的信源在后台标红，每周一会在运营群发一份信源周报（配置了飞书告警时）。

需要优先缓存新帖时，在信源的采集配置 JSON 中设置 `"_aihot": { "fast": true }`；已有 `_aihot` 里的首次回填设置要一并保留。保存后，已启用的信源立即标记为到期，由调度器检查并入队；成功采集后按一分钟重新检查，每日自动调频不会改变它原来的普通间隔。删除 `fast` 或改为 `false` 即恢复普通间隔。经 Jina 读取的列表仍遵守原有调频与费用限制。

快速模式先把列表中通过已知过滤条件的条目保存在数据库 `fast_source_items`；发布时间须由权威详情判断时，先缓存再应用时间边界。系统再补详情并按原规则决定是否进入文章库；缓存本身不会公开。快速来源每轮最多补一篇详情，未处理缓存会在后续成功采集时继续处理，即使条目已离开首页；来源暂停、关闭快速模式或列表持续抓取失败时，补齐也会暂停。缓存随信源删除，其他情况下保留。合并采集的 X 账号仍在搜索完成后直接入文章库。发布时间缺失或不可信时内容不公开。

X 快速账号在使用 SocialData 时单独合并搜索，相同查询的付费回执每分钟更新，不与普通账号的半小时回执混用。频繁搜索会更快消耗 SocialData 预算：默认每天 1000 次，一个每分钟只请求一页的分片每天就需 1440 次；多个分片或分页需要更多。预算熔断或能识别为 HTTP 429 的失败使快速源等待 10 分钟再检查，但日预算未恢复时仍会被熔断；OpenCLI 后续页的错误可能被适配器吞掉，平台也可能要求更长冷却。付费搜索的旧续读区间在超时、超数量或游标被拒时可能被丢弃，首次导入也不能证明完整覆盖。浏览器回退在单进程中最多并行两条 X 搜索，其他 OpenCLI 命令仍逐条独占；平台限流、搜索索引延迟、单次结果上限、队列积压或停机时，不能保证三分钟内入库。

浏览器分片中任一账号明确收到 429 后，本轮不再启动该分片的其他账号；已经发出的搜索可能仍会完成。不同进程或分片不共用这次停止状态，平台也可能要求超过十分钟的冷却。

`industry/sources.json` 只在首次导入新信源时生效。已有信源需要在后台“信源”页的采集配置中加入 `fast`，不会自动覆盖运营中修改过的配置；只对确实需要高频监控的来源开启。指定博主需要先把可读取其帖子的账号地址或查询建为信源，再启用快速模式，平台要求的登录和权限仍然适用。

「7 天没有新内容」按**信源自己的节奏**判断，而不是一个固定的窗口：日报和周报里分两类。**超出自身更新节奏**的排在前面，先对照原站（把最近 90 天的**产出日**去重到「天」，相邻两天的间隔取中位数当它的节奏；至少有 4 个这样的日子才算有节奏，静默时长要超过中位间隔的 4 倍才算超）。产出日取该条内容的发布时间，页面没给时间就用我们发现它的那天；**一次首次导入算一天**——它是一次交付，发布时间往回铺多远都不算多次产出（否则一个从没产出过的源会显得很准时，跨月的首次导入还会把中位间隔撑大，把一个已经安静的源藏起来）。窗口只算这 90 天里的产出日，更早的历史说明不了它现在多久发一次；发现时间与发布时间没有固定先后，任一个落在窗口内就读，产出日再按窗口夹一次。**判断不了节奏的仍然列出**，但不当作故障，分两种：窗口内没有可比较的产出（它产出过，只是都在窗口外），以及从未收到过内容（那是采集问题）；在自身节奏内的不再列出。抓取间隔 `interval_minutes` 不参与判断——它表示我们多久看一次，不是它多久发一次。

## 规则：旧文不刷屏

首次发现时原文已经发布超过 48 小时的资料、新信源第一次导入的存量条目、标记为回灌的推送，都按原文时间归档：不进入“今天”，也不推送。没有可信发布时间的资料先不公开（不进公开列表、精选、报告、热点和推送），从原信源或原文页读到日期后再判断新旧。这条规则所有入口共用，防止一次性导入历史内容刷屏。

新信源第一次导入时，只取列表里前 `_aihot.initialBackfillLimit` 条（默认 30）、`_aihot.initialBackfillMonths` 个月以内（默认 12）的条目。之后的抓取只收发布时间在信源第一次导入前 48 小时以内或之后的条目，列表里更早的存量不再进来，不会为整个订阅存档付费；第一次导入以后发布的条目，排在长列表第几条都会收。列表上没有发布时间的条目照收，按上面的规则等读到日期再判断。X 账号按抓取位置往后读，不受这条限制。

OpenCLI 的 X 搜索无法续读已返回页面，首次导入会保留该次观察到、通过首次导入日期过滤的结果（最多 60 条，仍按首次导入归档），不按 30 条截断；它仍无法证明页面之外没有遗漏。

如果只想从一个固定时间之后开始监控，可在 RSS、网页列表、JSON 配置中设置 `publishedAfter`，例如 `"2026-10-01T00:00:00.000Z"`。必须是完整的 UTC 时间，可省略毫秒；预览、首次和后续采集都只接受**严格晚于**它且发布日期可信的条目，未知日期也会排除。起点当天的单页更新章节若仍使用同一发布日期，之后追加的内容也不会被纳入；选择起点时要把这个限制考虑进去。

## 外部推送接口

自己写脚本抓的内容，可以推进站里，走和普通采集一样的判重、精选和归组。

```
POST /api/ingest/items
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{
  "sourceId": "my-crawler",
  "sourceName": "我的抓取脚本",
  "items": [
    { "title": "必填", "url": "必填", "publishedAt": "2026-10-01T08:00:00+08:00", "author": "可选" }
  ]
}
```

- `INGEST_TOKEN` 在 `.env` 里设置，至少 16 位；不设置时接口一律返回 401。
- 每次最多 50 条，超过返回 413。每个客户端每分钟能推几次由 `INGEST_RATE_LIMIT` 决定：`docker compose` 默认 10，超过返回 429（带 `Retry-After: 60`）；不用 Docker 时默认不限，前面没有反向代理限流的话在 `.env` 里设上，设成 0 表示不限。
- 返回 `{"ok": true, "created": <新建条数>}`。不是 JSON 对象的条目、缺标题或网址的条目会被跳过，同一请求里重复的网址只取第一条。
- `sourceId` 不存在时会自动建一个 `external` 信源，默认不进公开页面：到后台把它的参与方式改成 `editorial` 才会出现在站上。
- 在后台暂停信源后，推送接口返回 409，不再接收新文章；恢复信源后可以继续推送。
- 条目的 `raw._aihot.backfill` 为 `true` 时按历史回灌处理（不进入“今天”、不推送）。

## 把信源池接到另一个前端

信源池**不需要搬出去**，也不要复制一份配置给别的项目：运行真相在数据库里，`industry/sources.json` 只是新站首次启动的种子（`INSERT ... ON CONFLICT DO NOTHING`），后台改过的间隔、停用的源、每天 04:20 的自动调频都不会回写它。复制这份文件等于制造第二份会立刻漂移的真相。

另一个前端读两个公开接口就够了：

| 接口 | 用途 | 缓存 |
|---|---|---|
| `GET /api/v1/sources` | 信源清单：`id`（稳定 slug）、显示名、`kind`、是否一手、`tags`、状态、上次成功时间、近 7 天条数 | 60 秒，ETag/304，CORS 开放 |
| `GET /api/v1/items?source=<id>` | 只要某个源的公开条目；与 `mode`/`window`/`category`/`q` 可叠加 | 60 秒，ETag/304 |

要点：

- **用 `id` 关联，不用名字**。显示名会随编辑变化（`publicSourceName` 还会剥掉「X：」这类前缀），`id` 是信源表的主键，比如 `cn-nbs-release`、`cn-sse-announcements`。条目里的 `source` 现在是 `{name, id}`，直接拿 `source.id` 回查清单。
- **过滤值进游标**：`source` 参与 cursor 的查询绑定，拿一个不带 source 的游标去查带 source 的列表会得到 400，反过来也一样。这是防止翻页串源，不是故障。
- **未知 `id` 返回空列表**，不报错；`source` 的格式不合法（空串、超过 80 字符、含其他字符）才返回 400。
- **看不到的东西**：清单只包含 `enabled` 且非 `isolated` 的信源；采集地址、错误原文、采集配置都不在公开投影里。另一个前端只消费已发布的公开条目，不接触采集器。
- **状态会滞后**：`status` 是上一次采集的结果，后台改配置触发的重新发布是异步的，别把清单当成配置回执。按 `s-maxage` 重验证即可。
- **要自己跑采集是另一件事**：那需要把 worker、数据库和抓取凭据一起交出去（或者把采集做成独立服务），不是读这两个接口能解决的。现在的接口只解决“另一个前端展示我们采集到的内容”。
