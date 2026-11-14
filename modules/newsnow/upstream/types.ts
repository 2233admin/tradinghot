// The item shape the NewsNow adapters return, ported from upstream's shared/types.ts (MIT).
export interface NewsItem {
  /** Unique inside the source. */
  id: string | number;
  title: string;
  url: string;
  mobileUrl?: string;
  /** The publication time, as a timestamp or as the source's own text. */
  pubDate?: number | string;
  extra?: {
    hover?: string;
    /** The publication time as the source prints it, for the sources that print it apart from pubDate. */
    date?: number | string;
    info?: false | string;
    diff?: number;
    icon?: false | string | {
      url: string;
      scale: number;
    };
  };
}
