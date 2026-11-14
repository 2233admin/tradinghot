import type { NewsItem } from "../types.ts"
import { defineSource, myFetch } from "../runtime.ts"

interface HotSearchRes {
  ok: number
  data: {
    realtime: {
      word: string
      icon?: string
      small_icon_desc?: string
    }[]
  }
}

// The upstream adapter read the hot list with another person's session cookie, which is not ours
// to use. The hot list is published as JSON for every reader, so that is what is read now; the
// entries are the same words the page prints.
export default defineSource(async () => {
  const res = await myFetch<HotSearchRes>("https://weibo.com/ajax/side/hotSearch", {
    headers: {
      "referer": "https://weibo.com/",
    },
  })
  const hotNews: NewsItem[] = (res.data?.realtime ?? []).map((item) => ({
    id: item.word,
    title: item.word,
    url: `https://s.weibo.com/weibo?q=${encodeURIComponent(item.word)}`,
    extra: item.icon ? { icon: { url: item.icon, scale: 1.5 } } : undefined,
  }))
  return hotNews
})
