import * as cheerio from "cheerio"
import type { NewsItem } from "../types.ts"
import { defineSource, myFetch, parseRelativeDate } from "../runtime.ts";

export default defineSource(async () => {
  const response: ArrayBuffer = await myFetch("https://www.zaochenbao.com/realtime/", {
    responseType: "arrayBuffer",
  })
  const base = "https://www.zaochenbao.com"
  const utf8String = new TextDecoder("gb18030").decode(response)
  const $ = cheerio.load(utf8String)
  const $main = $("div.list-block>a.item")
  const news: NewsItem[] = []
  $main.each((_, el) => {
    const a = $(el)
    const url = a.attr("href")
    const title = a.find(".eps")?.text()
    const date = a.find(".pdt10")?.text().replace(/-\s/g, " ")
    if (url && title && date) {
      news.push({
        url: base + url,
        title,
        id: url,
        pubDate: parseRelativeDate(date, "Asia/Shanghai").valueOf(),
      })
    }
  })
  return news.sort((m, n) => n.pubDate! > m.pubDate! ? 1 : -1)
})
