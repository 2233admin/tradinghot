import { defineSource, myFetch } from "../runtime.ts";

interface KuaishouRes {
  defaultClient: {
    ROOT_QUERY: {
      "visionHotRank({\"page\":\"home\"})": {
        type: string
        id: string
        typename: string
      }
      [key: string]: any
    }
    [key: string]: any
  }
}

interface HotRankData {
  result: number
  pcursor: string
  webPageArea: string
  items: {
    type: string
    generated: boolean
    id: string
    typename: string
  }[]
}

type HtmlFetch = (url: string, options: { headers: Record<string, string>; responseType: "text" }) => Promise<string>

export async function readKuaishou(fetchHtml: HtmlFetch = myFetch) {
  const html = await fetchHtml("https://www.kuaishou.com/?isHome=1", {
    headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36" },
    responseType: "text",
  })
  // 提取window.__APOLLO_STATE__中的数据
  const matches = (html as string).match(/window\.__APOLLO_STATE__\s*=\s*(\{.+?\});/)
  if (!matches) {
    throw new Error("无法获取快手热榜数据")
  }

  // 解析JSON数据
  const data: KuaishouRes = JSON.parse(matches[1])

  // 获取热榜数据ID
  const hotRankId = data.defaultClient.ROOT_QUERY["visionHotRank({\"page\":\"home\"})"].id

  // 获取热榜列表数据
  const hotRankData = data.defaultClient[hotRankId] as HotRankData
  // 转换数据格式
  return hotRankData.items.filter(k => data.defaultClient[k.id].tagType !== "置顶").map((item) => {
    // 从id中提取实际的热搜词
    const hotSearchWord = item.id.replace("VisionHotRankItem:", "")

    // 获取具体的热榜项数据
    const hotItem = data.defaultClient[item.id]

    return {
      id: hotSearchWord,
      title: hotItem.name,
      url: `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(hotItem.name)}`,
      extra: {
        icon: hotItem.iconUrl,
      },
    }
  })
}

export default defineSource(readKuaishou)
