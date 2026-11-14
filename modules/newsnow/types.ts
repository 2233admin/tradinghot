// What the site's api answers about the NewsNow sources: the list of sources, and one source's feed.
export type NewsnowSourceType = "hottest" | "realtime";

export interface NewsnowSource {
  /** The source's own name, as the upstream registry has it. */
  id: string;
  name: string;
  /** The subtitle the source prints, when it has one. */
  title?: string;
  /** Upstream attribution or qualification, when provided. */
  description?: string;
  /** Where the source lives. */
  home?: string;
  /** The column the source belongs to (china, tech, finance, world, sports). */
  category?: string;
  /** A hot list (a ranking) or a running feed (the newest first). */
  type: NewsnowSourceType;
  /** How often the source is read, in milliseconds. */
  intervalMs: number;
}

export interface NewsnowSourcesResponse {
  sources: NewsnowSource[];
}

export interface NewsnowFeedItem {
  id: string;
  title: string;
  url: string;
  /** When the source published it; null when the source prints no time for that entry. */
  publishedAt: string | null;
}

export type NewsnowFeedStatus = "success" | "cache" | "error";

export interface NewsnowFeedResponse {
  id: string;
  /** "success": read just now. "cache": the last reading, still served. "error": nothing to serve. */
  status: NewsnowFeedStatus;
  /** When the source was really read; null when that is not known. */
  refreshedAt: string | null;
  items: NewsnowFeedItem[];
  /** Why the last reading failed, when it did. */
  error?: string;
}
