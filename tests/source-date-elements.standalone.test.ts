// Real listing date labels can carry a Unix debugging tooltip, while detail rules can select a
// metadata element. Unlabelled or modified times must not stand in for a publication date.
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { fetchDetail, fromBarronsMarket, fromHtml } from "@aihot/backend/sources/web-list";

const html = `<html><head><meta name="date" content="2026-09-11T19:58:33Z"></head><body>` +
  `<article><a href="/post">A real article</a><span title="Unix: 1789171113866">Sep 11, 2026</span></article></body></html>`;
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  if (req.url === "/modified") return res.end(`<meta property="article:modified_time" content="2026-10-14T00:00:00Z"><time itemprop="dateModified" datetime="2026-10-14T00:00:00Z">Updated today</time>`);
  if (req.url === "/unlabelled") return res.end(`<time datetime="2026-10-14T00:00:00Z">2026-10-14</time>`);
  if (req.url === "/published") return res.end(`<time itemprop="datePublished" datetime="2020-02-15T00:00:00Z">Published February 15, 2020</time>`);
  res.end(html);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const previousPrivateFetch = config.allowPrivateNetworkFetch;
config.allowPrivateNetworkFetch = true;
after(async () => {
  config.allowPrivateNetworkFetch = previousPrivateFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("a listing date held in an epoch attribute is the timestamp, and a teaser becomes the excerpt", () => {
  const list = `<ul><li class="flash" data-time="1794017564">` +
    `<h4><a href="/article/1">央行连续第24个月增持黄金</a></h4>` +
    `<div class="summary">据央行，10月末黄金储备报7830万盎司。</div></li></ul>`;
  const [item] = fromHtml(list, base, { config: {
    url: base, itemSelector: "li.flash", linkSelector: "h4 a", titleSelector: "h4 a",
    summarySelector: ".summary", publishedAtAttribute: "data-time",
  } } as never);
  assert.equal(item?.publishedAt?.toISOString(), "2026-11-07T02:12:44.000Z");
  assert.equal(item?.excerpt, "据央行，10月末黄金储备报7830万盎司。");
});

test("a listing uses the visible date when its tooltip is not a publication date", () => {
  const items = fromHtml(html, base, { config: { url: base, itemSelector: "article", publishedAtSelector: "span[title^='Unix:']", publishedAtUtcOffset: "+00:00" } } as never);
  assert.equal(items[0]!.publishedAt?.toISOString(), "2026-09-11T00:00:00.000Z");
});

test("a detail date selector reads meta content and an invalid tooltip does not mask visible text", async () => {
  for (const [publishedAtSelector, expected] of [["meta[name='date']", "2026-09-11T19:58:33.000Z"], ["span", "2026-09-11T00:00:00.000Z"]]) {
    const item = await fetchDetail(base + "/post", { config: { detail: { publishedAtSelector, publishedAtAuthoritative: true, publishedAtUtcOffset: "+00:00" } } } as never, { date: true, title: false, summary: false });
    assert.equal(item.publishedAt?.toISOString(), expected);
  }
});

// An article can put its update time first; only explicit publication metadata or a source rule is trusted.
test("generic detail metadata does not promote modified or unlabelled time elements to publication", async () => {
  const source = { config: { detail: { maxFetches: 1 } } } as never;
  for (const path of ["/modified", "/unlabelled"]) {
    const detail = await fetchDetail(base + path, source, { date: true, title: false, summary: false });
    assert.equal(detail.publishedAt, null, path);
  }
  const published = await fetchDetail(base + "/published", source, { date: true, title: false, summary: false });
  assert.equal(published.publishedAt?.toISOString(), "2020-02-15T00:00:00.000Z");
});

// Barron's market-data page: the headlines are in the HTML, but the moment each article was published
// is only in the page's own state (window.__STATE__), where every article carries its headline, its
// summary, its byline and the epoch it was published at.
const barronsPage = (state: string) => `<!doctype html><html><head><title>Market Data</title></head><body>
<h2 class="headline"><a href="https://www.barrons.com/articles/costco-an-ai-shelter-182f8c30">Costco: An AI Shelter?</a></h2>
<div class="timestamp"></div>
<script>
      window.__STATE__ = ${state};
    </script></body></html>`;

const barronsSource = (config: Record<string, unknown> = {}) => ({
  id: "web-barrons-markets",
  kind: "web_list",
  config: { url: "https://www.barrons.com/market-data", adapter: "barrons_market", allowUrlPrefixes: ["https://www.barrons.com/articles/"], ...config },
}) as never;

test("an article's own state carries its time, its summary and its byline", () => {
  const items = fromBarronsMarket(barronsPage(JSON.stringify({
    data: { rows: [{ type: "article", data: {
      headline: "Costco: An AI Shelter?",
      summary: "The big-box retailer could be a good defensive stock.",
      byline: "By George Glover",
      timestamp: 1794601200000,
      url: "https://www.barrons.com/articles/costco-an-ai-shelter-182f8c30",
    } }] },
  })), "https://www.barrons.com/market-data", barronsSource());
  assert.equal(items.length, 1);
  assert.equal(items[0]!.title, "Costco: An AI Shelter?");
  assert.equal(items[0]!.url, "https://www.barrons.com/articles/costco-an-ai-shelter-182f8c30");
  assert.equal(items[0]!.publishedAt?.toISOString(), "2026-11-13T20:20:00.000Z");
  assert.equal(items[0]!.publicationTime, "2026-11-13T20:20:00.000Z");
  assert.equal(items[0]!.excerpt, "The big-box retailer could be a good defensive stock.");
  assert.equal(items[0]!.author, "George Glover");
});

test("the same article twice in the page is one article, and another site's article is not this source's", () => {
  const article = { type: "article", data: { headline: "Costco: An AI Shelter?", timestamp: 1794601200000, url: "https://www.barrons.com/articles/costco-an-ai-shelter-182f8c30" } };
  const other = { type: "article", data: { headline: "Another site", timestamp: 1794601200000, url: "https://www.example.com/articles/other" } };
  assert.equal(fromBarronsMarket(barronsPage(JSON.stringify({ a: [article], b: [article] })), "https://www.barrons.com/market-data", barronsSource()).length, 1);
  assert.equal(fromBarronsMarket(barronsPage(JSON.stringify({ rows: [other] })), "https://www.barrons.com/market-data", barronsSource()).length, 0);
});

test("a page without a readable state fails the fetch instead of listing nothing", () => {
  assert.throws(() => fromBarronsMarket("<html><body>no state here</body></html>", "https://www.barrons.com/market-data", barronsSource()), /barrons_market/);
  assert.throws(() => fromBarronsMarket(barronsPage("{oops;"), "https://www.barrons.com/market-data", barronsSource()), /barrons_market/);
});
