// Truth Social's own API, read by its own adapter: a post keeps its own words, its own time, its own
// media and its own edits, and it is never dressed up as an X post. A post with only a picture is kept.
// The window of a run is bounded, the platform's listing is read again from its newest post, and a
// refused answer is a failure of the read, not an empty listing.
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { identityKeyForUrl } from "@aihot/backend/lib/url";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { truthSocialCandidate } from "@aihot/backend/sources/truthsocial";

const ACCOUNT_ID = "107780257626128497";
const ACCOUNT = {
  id: ACCOUNT_ID,
  acct: "realDonaldTrump",
  username: "realDonaldTrump",
  display_name: "Donald J. Trump",
  verified: true,
  url: "https://truthsocial.com/@realDonaldTrump",
};

const status = (over: Record<string, unknown> & { id: string; created_at: string }) => ({
  content: "<p>A post</p>",
  url: `https://truthsocial.com/@realDonaldTrump/${over.id}`,
  uri: `https://truthsocial.com/@realDonaldTrump/${over.id}`,
  language: "en",
  spoiler_text: "",
  edited_at: null,
  version: "1",
  visibility: "public",
  account: ACCOUNT,
  media_attachments: [],
  replies_count: 0,
  reblogs_count: 0,
  favourites_count: 0,
  ...over,
});

const IMAGE = "https://static-assets-1.truthsocial.com/tmtg:prime-ts-assets/media_attachments/files/117/609/500/306/250/862/original/90a2d50b4c54db87.jpg";
const VIDEO = "https://static-assets-1.truthsocial.com/tmtg:prime-ts-assets/media_attachments/files/117/588/112/160/229/233/original/84800cfcce0fc7f7.mp4";
const POSTER = "https://static-assets-1.truthsocial.com/tmtg:prime-ts-assets/media_attachments/thumbnails/117/588/112/160/229/233/original/111683722e1b6052.jpg";

const textPost = status({
  id: "117611608680849019",
  created_at: "2026-11-13T22:58:48.161Z",
  content: "<p>Coast Guard rescue praised</p><p>The President thanked the rescuers.</p>",
});
const picturePost = status({
  id: "117609500488513990",
  created_at: "2026-11-13T14:02:39.699Z",
  content: "<p></p>",
  language: null,
  media_attachments: [{ id: "1", type: "image", url: IMAGE, preview_url: IMAGE.replace("/original/", "/small/"), description: null,
    meta: { original: { width: 906, height: 1133 } } }],
});
const videoPost = status({
  id: "117588112160229233",
  created_at: "2026-11-12T09:00:00.000Z",
  content: "<p>Watch this</p>",
  media_attachments: [{ id: "2", type: "video", url: VIDEO, preview_url: POSTER, description: "A short clip",
    meta: { original: { width: 1200, height: 788, duration: 13.09 } } }],
});
const editedPost = status({
  id: "117606259365899322",
  created_at: "2026-11-13T00:18:24.093Z",
  content: "<p>Corrected numbers</p>",
  edited_at: "2026-11-13T00:41:02.500Z",
  version: "2",
});
const filler = Array.from({ length: 16 }, (_v, i) => status({
  id: `1176000000000000${String(10 + i).padStart(2, "0")}`,
  created_at: "2026-11-11T09:00:00.000Z",
  content: `<p>Filler post ${i}</p>`,
}));
const older = [status({ id: "117500000000000001", created_at: "2026-11-09T09:00:00.000Z", content: "<p>An older post</p>" })];

const requests: string[] = [];
let answer: "ok" | "challenge" | "garbage" = "ok";
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  requests.push(`${url.pathname}${url.search}`);
  if (answer === "challenge") {
    res.writeHead(403, { "content-type": "text/html" });
    res.end("<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body>challenge</body></html>");
    return;
  }
  if (answer === "garbage") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("not json at all");
    return;
  }
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/api/v1/accounts/lookup") {
    res.end(JSON.stringify(ACCOUNT));
    return;
  }
  if (url.pathname === `/api/v1/accounts/${ACCOUNT_ID}/statuses`) {
    res.end(JSON.stringify(url.searchParams.get("max_id") ? older : [textPost, picturePost, videoPost, editedPost, ...filler]));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end("{}");
});
const listening = Promise.withResolvers<void>();
server.listen(0, "127.0.0.1", () => listening.resolve());
await listening.promise;
const address = server.address();
const base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
const previousPrivateFetch = config.allowPrivateNetworkFetch;
config.allowPrivateNetworkFetch = true;
after(async () => {
  config.allowPrivateNetworkFetch = previousPrivateFetch;
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
});

const truthSocialConfig = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  url: `${base}/api/v1/accounts/${ACCOUNT_ID}/statuses`,
  mode: "truth_social",
  truthSocial: { account: "realDonaldTrump", accountId: ACCOUNT_ID, pages: 2 },
  ...extra,
});

const source = (extra: Record<string, unknown> = {}) => ({
  id: "truthsocial-test",
  kind: "json_list",
  config: truthSocialConfig(extra),
}) as never;

/** The material's own payload, read as the record the adapter stored. */
function payloadOf(candidate: { raw?: unknown }): Record<string, unknown> {
  const raw = candidate.raw;
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw));
}

test("a post keeps its own words, its own time and its own platform", async () => {
  const items = await fetchJsonList(source());
  const post = items.find((item) => item.url.endsWith("/117611608680849019"))!;
  assert.equal(post.title, "Coast Guard rescue praised");
  assert.equal(post.bodyText, "Coast Guard rescue praised The President thanked the rescuers.");
  assert.match(post.bodyHtml!, /<p>Coast Guard rescue praised<\/p>/);
  assert.equal(post.publishedAt?.toISOString(), "2026-11-13T22:58:48.161Z");
  assert.equal(post.publicationTime, "2026-11-13T22:58:48.161Z");
  assert.equal(post.author, "realDonaldTrump");
  assert.equal(post.language, "en");
  assert.equal(post.bodyStatus, "ok");
  // Its own platform, never X: no X fields, and an address of its own.
  assert.equal(post.xPost, undefined);
  assert.equal(payloadOf(post).platform, "truthsocial");
  assert.equal(payloadOf(post).externalId, "117611608680849019");
  assert.match(identityKeyForUrl(post.url)!, /^url:https:\/\/truthsocial\.com\//);
});

test("a repost keeps the original post's video when the wrapper has no attachments", () => {
  const item = truthSocialCandidate(status({
    id: "117600000000000099",
    created_at: "2026-11-13T22:00:00.000Z",
    content: "",
    reblog: { id: "42", content: "<p>Original video</p>", media_attachments: [{ type: "video", url: VIDEO, preview_url: POSTER }] },
  }), source());
  assert.equal(item?.bodyText, "Original video");
  assert.equal(item?.media?.[0]?.url, VIDEO);
  assert.equal(item?.media?.[0]?.poster, POSTER);
});

test("a post with only a picture is kept, with the picture it carries", async () => {
  const items = await fetchJsonList(source());
  const picture = items.find((item) => item.url.endsWith("/117609500488513990"))!;
  assert.deepEqual(picture.media, [{ kind: "image", url: IMAGE, width: 906, height: 1133, alt: null, poster: null }]);
  assert.equal(picture.title, "[图片]");
  assert.equal(picture.bodyText, "[图片]");
  assert.match(picture.bodyHtml!, /<img[^>]*src="https:\/\/static-assets-1\.truthsocial\.com[^"]*90a2d50b4c54db87\.jpg"/);
  assert.equal(picture.language, null);
});

test("a video post keeps the platform's own file and its poster", async () => {
  const items = await fetchJsonList(source());
  const video = items.find((item) => item.url.endsWith("/117588112160229233"))!;
  assert.deepEqual(video.media, [{ kind: "video", url: VIDEO, width: 1200, height: 788, alt: "A short clip", poster: POSTER }]);
  assert.match(video.bodyHtml!, /<video[^>]*src="https:\/\/static-assets-1\.truthsocial\.com[^"]*\.mp4"/);
  assert.match(video.bodyHtml!, /<video[^>]*poster="https:\/\/static-assets-1\.truthsocial\.com[^"]*\.jpg"/);
});

test("an edited post keeps the time of its edit", async () => {
  const items = await fetchJsonList(source());
  const edited = items.find((item) => item.url.endsWith("/117606259365899322"))!;
  assert.equal(edited.sourceUpdatedAt?.toISOString(), "2026-11-13T00:41:02.500Z");
  assert.equal(payloadOf(edited).version, "2");
});

test("the window of a run is bounded: one page reads one request", async () => {
  requests.length = 0;
  const items = await fetchJsonList(source({ truthSocial: { account: "realDonaldTrump", accountId: ACCOUNT_ID, pages: 1 } }));
  assert.equal(requests.filter((path) => path.includes("/statuses")).length, 1);
  assert.equal(items.some((item) => item.url.endsWith("/117500000000000001")), false);
});

test("a second page is read from the oldest post read, and the listing starts at the newest every time", async () => {
  requests.length = 0;
  const items = await fetchJsonList(source());
  const statusReads = requests.filter((path) => path.includes("/statuses"));
  assert.equal(statusReads.length, 2);
  assert.match(statusReads[1]!, /max_id=117600000000000025/);
  assert.equal(items.some((item) => item.url.endsWith("/117500000000000001")), true);
  // The account's own id is known, so no lookup is needed.
  assert.equal(requests.some((path) => path.includes("/lookup")), false);
});

test("the account is looked up when its id is not configured", async () => {
  requests.length = 0;
  const items = await fetchJsonList(source({ truthSocial: { account: "realDonaldTrump", pages: 1 } }));
  assert.equal(requests.some((path) => path.includes("/lookup?acct=realDonaldTrump")), true);
  assert.equal(items.length, 20);
});

test("a refused answer is a failure of the read, not an empty listing", async () => {
  answer = "challenge";
  await assert.rejects(() => fetchJsonList(source()), /HTTP 403/);
  answer = "garbage";
  await assert.rejects(() => fetchJsonList(source()), /not JSON/);
  answer = "ok";
});

test("the config of a Truth Social source is one the collector implements", () => {
  assert.deepEqual(unsupportedConfig("json_list", truthSocialConfig()), []);
  assert.deepEqual(
    unsupportedConfig("json_list", { url: "https://truthsocial.com/api/v1/accounts/1/statuses", mode: "truth_social", itemsPath: "data" }),
    ["itemsPath"],
  );
  assert.deepEqual(
    unsupportedConfig("json_list", { url: "https://truthsocial.com/api/v1/accounts/1/statuses", mode: "truth_social", truthSocial: { pages: 9 } }),
    ["truthSocial.pages"],
  );
});
