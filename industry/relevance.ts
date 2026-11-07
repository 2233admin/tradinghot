// 本站的“什么算市场信息”：分词后按主体、事件、动作、数字加权，给每条资料 0–100 的相关度分。
// 精选只收达到门槛的条目；全部动态仍保留所有资料。词表是站点自己的行业知识，换行业时整份替换。
//
// 原则：政治、地缘、外交本身就是市场信息，不要求出现“股价/指数”这类词；真正要排除的是
// 论坛闲聊、广告和没有信息量的短句（见 noise）。

export interface TermGroup {
  /** 同一个概念的几种写法，命中任意一种都只算一次。 */
  id: string;
  terms: string[];
}

export const RELEVANCE = {
  /** 达到这个分数才进精选；按本站一天的流量校准，不要照抄模型的 60/76。 */
  threshold: 45,
  /** 网页 AI 评分（selection=webai）进精选的门槛；比词表分严格。 */
  webaiThreshold: 60,
  /** 信源分级的底分：一手官方来源天然更值得看。 */
  baseByTier: { T1: 15, T1_5: 12, T2: 8 } as Record<string, number>,
  /** 主体：公司、指数、品种、机构。同一条只取命中过的不同 id。 */
  entities: [
    { id: "fed", terms: ["美联储", "联邦储备", "federal reserve", "fomc"] },
    { id: "ecb", terms: ["欧洲央行", "ecb"] },
    { id: "boj", terms: ["日本央行", "boj"] },
    { id: "pboc", terms: ["中国人民银行", "央行", "pboc"] },
    { id: "treasury", terms: ["美国财政部", "财政部", "treasury"] },
    { id: "nvidia", terms: ["英伟达", "nvidia", "nvda"] },
    { id: "tsmc", terms: ["台积电", "tsmc"] },
    { id: "apple", terms: ["苹果公司", "苹果", "apple"] },
    { id: "microsoft", terms: ["微软", "microsoft", "msft"] },
    { id: "google", terms: ["谷歌", "google", "alphabet", "googl"] },
    { id: "amazon", terms: ["亚马逊", "amazon", "amzn"] },
    { id: "meta", terms: ["meta", "facebook"] },
    { id: "tesla", terms: ["特斯拉", "tesla", "tsla"] },
    { id: "openai", terms: ["openai", "chatgpt"] },
    { id: "anthropic", terms: ["anthropic", "claude"] },
    { id: "bitcoin", terms: ["比特币", "bitcoin", "btc"] },
    { id: "ethereum", terms: ["以太坊", "ethereum", "eth"] },
    { id: "gold", terms: ["黄金", "gold", "金价"] },
    { id: "oil", terms: ["原油", "油价", "crude", "brent", "wti"] },
    { id: "dollar", terms: ["美元", "dollar", "dxy"] },
    { id: "yuan", terms: ["人民币", "yuan", "rmb", "cny"] },
    { id: "nasdaq", terms: ["纳斯达克", "纳指", "nasdaq"] },
    { id: "sp500", terms: ["标普500", "标普", "s&p 500", "s&p"] },
    { id: "dow", terms: ["道琼斯", "道指", "dow jones", "dow"] },
    { id: "hangseng", terms: ["恒生指数", "恒指", "hang seng"] },
    { id: "ashare", terms: ["a股", "沪深", "上证", "深证", "创业板", "a-share"] },
    { id: "treasury-bond", terms: ["美国国债", "国债", "treasury yield", "bond yield"] },
    { id: "trump", terms: ["特朗普", "trump"] },
  ] as TermGroup[],
  /** 地名与政治主体：外交、战争、选举同样影响市场，单独给分。 */
  places: [
    { id: "us", terms: ["美国", "白宫", "united states", "u.s."] },
    { id: "china", terms: ["中国", "北京", "china", "beijing"] },
    { id: "eu", terms: ["欧盟", "european union", "eu"] },
    { id: "uk", terms: ["英国", "britain", "uk"] },
    { id: "japan", terms: ["日本", "japan"] },
    { id: "russia", terms: ["俄罗斯", "russia", "moscow"] },
    { id: "ukraine", terms: ["乌克兰", "ukraine", "kyiv", "zelensky", "泽连斯基"] },
    { id: "iran", terms: ["伊朗", "iran"] },
    { id: "israel", terms: ["以色列", "israel"] },
    { id: "saudi", terms: ["沙特", "saudi"] },
  ] as TermGroup[],
  /** 事件：宏观数据、政策、战争、选举、公司资本动作。 */
  events: [
    { id: "rates", terms: ["利率", "interest rate", "interest rates", "降息", "加息", "降准", "rate cut", "rate hike"] },
    { id: "inflation", terms: ["通胀", "通货膨胀", "inflation", "cpi", "ppi", "pce"] },
    { id: "jobs", terms: ["非农", "就业", "失业率", "payroll", "unemployment", "jobs report"] },
    { id: "growth", terms: ["gdp", "经济增长", "gross domestic product"] },
    { id: "earnings", terms: ["财报", "业绩", "营收", "净利", "利润", "earnings", "revenue", "profit"] },
    { id: "guidance", terms: ["指引", "guidance", "forecast"] },
    { id: "capital", terms: ["回购", "分红", "增持", "减持", "buyback", "dividend", "增发"] },
    { id: "deals", terms: ["并购", "收购", "合并", "merger", "acquisition", "takeover", "ipo", "上市"] },
    { id: "orders", terms: ["采购", "订单", "签约", "中标", "contract", "order", "orders"] },
    { id: "rating", terms: ["评级", "credit rating", "downgrade", "upgrade", "rating"] },
    { id: "product", terms: ["发布", "推出", "亮相", "上线", "launch", "launches", "unveil", "unveils", "debut", "release"] },
    { id: "trade", terms: ["关税", "贸易战", "tariff", "trade war", "出口管制", "export control"] },
    { id: "sanctions", terms: ["制裁", "sanction", "sanctions", "封锁", "embargo"] },
    { id: "war", terms: ["战争", "冲突", "袭击", "空袭", "导弹", "巡航导弹", "无人机", "拦截", "击落", "军事", "打击", "war", "conflict", "attack", "strike", "missile", "drone", "intercept", "airstrike", "military", "troops", "invasion", "ceasefire", "停火"] },
    { id: "election", terms: ["大选", "选举", "中期选举", "选民", "提案", "公投", "投票", "计票", "election", "midterm", "voters", "ballot", "referendum", "vote"] },
    { id: "diplomacy", terms: ["国事访问", "访问", "峰会", "summit", "谈判", "talks", "meeting", "会晤", "会谈", "visit"] },
    { id: "policy", terms: ["监管", "调查", "禁令", "法案", "regulation", "probe", "investigation", "ban", "bill", "policy"] },
    { id: "energy", terms: ["减产", "增产", "opec", "供应中断", "supply cut", "output cut"] },
    { id: "crisis", terms: ["违约", "破产", "挤兑", "default", "bankruptcy", "bailout", "crisis"] },
  ] as TermGroup[],
  /** 动作：价格和决策的方向词，单独一条只给少量分。 */
  actions: [
    { id: "up", terms: ["上涨", "大涨", "暴涨", "新高", "涨", "surge", "soar", "rally", "jump", "rise", "rises", "gain"] },
    { id: "down", terms: ["下跌", "大跌", "暴跌", "新低", "跌", "plunge", "slump", "fall", "falls", "drop", "tumble"] },
    { id: "approve", terms: ["批准", "通过", "approve", "approves", "clears"] },
    { id: "halt", terms: ["暂停", "停止", "halt", "suspend", "pause"] },
  ] as TermGroup[],
  /** 广告、论坛闲聊、抽奖：命中即不进精选。 */
  noise: ["红包", "实盘", "粉丝", "点赞", "打赏", "直播", "加群", "抽奖", "福利", "荐股", "开户", "广告", "抄作业", "龙虎榜讨论区", "求关注"],
} as const;
