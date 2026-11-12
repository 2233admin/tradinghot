// industry/watchlist.txt: one source per line, expanded into the same rows industry/sources.json holds.
// A line is an X account (@handle or its x.com address), a Discord channel link, or a feed address,
// then an optional display name; "!fast" checks it every minute, "!hot" counts it as heat evidence only.
import { createHash } from "node:crypto";

export interface WatchSource {
  id: string;
  name: string;
  kind: "rss" | "json_list" | "x_search";
  config: Record<string, unknown>;
  tier: string;
  participation_mode: string;
  interval_minutes: number;
  tags: string[];
}

const X_HANDLE = /^(?:@|https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?)([A-Za-z0-9_]{1,15})\/?$/;
const DISCORD_CHANNEL = /^https?:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/?$/;

export function parseWatchlist(text: string): WatchSource[] {
  const out = new Map<string, WatchSource>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [target, ...rest] = line.split(/\s+/) as [string, ...string[]];
    const flags = rest.filter((word) => word.startsWith("!"));
    const unknown = flags.find((flag) => flag !== "!fast" && flag !== "!hot");
    if (unknown) throw new Error(`watchlist.txt 第 ${index + 1} 行：不认识的标记 ${unknown}（只有 !fast 和 !hot）`);
    const label = rest.filter((word) => !word.startsWith("!")).join(" ");
    const shared = {
      tier: "T2",
      participation_mode: flags.includes("!hot") ? "hot_signal" : "editorial",
    };
    const aihot = flags.includes("!fast") ? { _aihot: { fast: true } } : {};
    const x = X_HANDLE.exec(target);
    const discord = DISCORD_CHANNEL.exec(target);
    let source: WatchSource;
    if (x) {
      const handle = x[1]!;
      source = {
        ...shared, id: `x-${handle.toLowerCase()}`, name: `X：${label || handle} (@${handle})`, kind: "x_search",
        config: { query: `from:${handle} -filter:replies`, searchType: "Latest", ...aihot },
        interval_minutes: 30, tags: ["X"],
      };
    } else if (discord) {
      const [, guild, channel] = discord;
      // The bot token is added when the channel is read (DISCORD_BOT_TOKEN), never stored with the source.
      // A message is its own body: discord.com has no public page to read one from.
      source = {
        ...shared, id: `discord-${channel}`, name: label || `Discord ${channel}`, kind: "json_list",
        config: {
          url: `https://discord.com/api/v10/channels/${channel}/messages?limit=50`,
          titlePaths: ["content", "embeds.0.title", "embeds.0.description"],
          summaryPaths: ["content", "embeds.0.description"],
          summaryIsBody: true,
          authorPaths: ["author.global_name", "author.username"],
          publishedAtPath: "timestamp",
          externalIdPath: "id",
          urlTemplate: `https://discord.com/channels/${guild}/${channel}/{id}`,
          ...aihot,
        },
        interval_minutes: 10, tags: ["Discord"],
      };
    } else {
      let url: URL;
      try { url = new URL(target); } catch { throw new Error(`watchlist.txt 第 ${index + 1} 行：看不懂 ${target}（要 @账号、Discord 频道链接或订阅地址）`); }
      if (!/^https?:$/.test(url.protocol)) throw new Error(`watchlist.txt 第 ${index + 1} 行：订阅地址要以 http(s) 开头`);
      const slug = url.hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      source = {
        ...shared, id: `rss-${slug}-${createHash("sha256").update(url.href).digest("hex").slice(0, 6)}`, name: label || url.hostname.replace(/^www\./, ""), kind: "rss",
        config: { feedUrl: url.href, ...aihot },
        interval_minutes: 30, tags: ["RSS"],
      };
    }
    if (!out.has(source.id)) out.set(source.id, source);
  });
  return [...out.values()];
}

/** The watchlist entries a source list does not already follow under another id (same X account or feed). */
export function newToList(watch: WatchSource[], listed: Array<{ kind: string; config: Record<string, unknown> }>): WatchSource[] {
  const key = (s: { kind: string; config: Record<string, unknown> }) =>
    s.kind === "x_search" ? `x:${/^from:(\w+)/i.exec(String(s.config.query ?? ""))?.[1]?.toLowerCase() ?? s.config.query}` : `${s.kind}:${s.config.feedUrl ?? s.config.url}`;
  const have = new Set(listed.map(key));
  return watch.filter((s) => !have.has(key(s)));
}
