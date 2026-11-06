// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * 词表用金十适配器（OhMyOpenCLI 的 `adapters/jin10/_shared.js`）里的资产类别，key 与那里的名字一致；
 * 一条消息命中多个类别时，按这里的先后顺序取第一个，与那个适配器 `ASSET_RULES` 的顺序相同。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节，也就是「其他」）。
 * tagColor 是飞书推送卡片里跟在标题后面的一类小标签的颜色（飞书 text_tag 的颜色名）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "equities_us", tagColor: "violet", label: "美股", feedLabel: "美股", section: "股市", guide: "美股大盘与个股：指数与成交、财报与指引、回购与增持、IPO 与停复牌、监管处罚。关键词：美股、纳斯达克、纳指、道指、标普、SPX、NASDAQ、NYSE；在美上市的公司（英伟达、苹果、特斯拉、微软）按美股归类。" },
  { key: "equities_cn", tagColor: "wathet", label: "A股", feedLabel: "A股", section: "股市", guide: "沪深两市的市场整体与个股：指数与成交、政策与资金面、上市公司公告与财报、监管处罚、IPO 与停复牌。关键词：A股、上证、深成指、创业板、沪深、北向资金、科创板；茅台、宁德时代、比亚迪归 A股。" },
  { key: "equities_hk", tagColor: "indigo", label: "港股", feedLabel: "港股", section: "股市", guide: "港股大盘与个股、南向资金、中概与外资动向、港股通与上市规则。关键词：港股、恒生、恒指、国企指数；腾讯等在港上市的公司按港股归类。" },
  { key: "macro_data", tagColor: "blue", label: "宏观数据", feedLabel: "宏观数据", section: "宏观与利率", guide: "经济数据与统计口径的变化：CPI、PPI、GDP、PMI、非农、初请、失业率、通胀、零售销售、社融与信贷。只是评论数据、没有新数字的归其他。" },
  { key: "bonds_rates", tagColor: "purple", label: "债券与利率", feedLabel: "债券与利率", section: "宏观与利率", guide: "国债与美债收益率、信用债与违约、可转债条款、央行与利率决议、降息加息、公开市场操作与流动性。关键词：美债、国债、收益率、利率、央行、美联储、FOMC、货币政策。" },
  { key: "energy", tagColor: "orange", label: "能源", feedLabel: "能源与原油", section: "商品与汇率", guide: "原油、天然气、成品油与电力：价格、库存、产量、OPEC 与地缘扰动、EIA 与 API 数据。关键词：原油、WTI、布伦特、OPEC、欧佩克、天然气、油价、EIA。" },
  { key: "precious_metals", tagColor: "green", label: "贵金属", feedLabel: "贵金属", section: "商品与汇率", guide: "黄金、白银、铂钯的价格与成交、ETF 持仓、央行购金、实际利率与避险情绪。关键词：黄金、白银、贵金属、金价、银价、铂、钯。铜、铝等工业金属归大宗商品。" },
  { key: "commodities", tagColor: "turquoise", label: "大宗商品", feedLabel: "大宗商品", section: "商品与汇率", guide: "工业品与农产品：铜、铝、铁矿、螺纹钢、小麦、玉米、大豆的价格、库存、产量与需求。关键词：大宗商品、铜、铝、铁矿、螺纹、农产品。原油归能源，金银归贵金属。" },
  { key: "crypto", tagColor: "carmine", label: "加密货币", feedLabel: "加密货币", section: "商品与汇率", guide: "比特币、以太坊与加密资产的价格、资金流、监管与交易所事件。关键词：比特币、以太坊、加密货币、BTC、ETH。" },
  { key: "geopolitics", tagColor: "red", label: "地缘政治", feedLabel: "地缘政治", section: "地缘", guide: "影响定价的地缘事件：冲突与停火、制裁与禁运、选举与谈判、航运与能源通道。关键词：伊朗、以色列、俄乌、战争、制裁、霍尔木兹、黎巴嫩、停火、谈判。" },
  { key: "fx", tagColor: "yellow", label: "外汇", feedLabel: "外汇与汇率", section: "商品与汇率", guide: "货币对与汇率：美元、欧元、英镑、日元、瑞郎、澳元、加元、纽元、离岸人民币、美元指数。关键词：DXY、外汇、汇率。落到某只股票或某个股市的新闻归对应市场。" },
  { key: "other", tagColor: "neutral", label: "其他", feedLabel: "其他财经内容", section: "其他", guide: "不属于上面任何一类的内容：方法论与教程、量化与工具、行业研究、人物观点与访谈。量化内容归这里，但首标签必须是“量化/策略”或“工具/代码”，主题标签带上“量化因子”“回测”“风控”或“仓位管理”，主题页和标签筛选靠它们收集。没有归上类的资料也放在这一节。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布：日报报头的“N 个…”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 * 股票站的“财报”分散在各家公司、也常由媒体转述，配不出一手名录下的稳定数字，所以不设。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["a股", "港股", "美股", "etf", "ipo", "cpi", "ppi", "pmi", "gdp", "lpr", "mlf", "fomc", "fed", "csi", "q1", "q2", "q3", "q4"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["market_move", "company_event", "macro_data", "research_report", "quant_method", "opinion_analysis", "tutorial_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "行情异动", "公司事件", "财报", "宏观数据", "政策/监管", "研报/数据", "量化/策略", "工具/代码", "教程/实践", "观点/分析", "传闻/预期",
  "非股票/通用", "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "A股", "港股", "美股", "中概股", "ETF", "可转债", "期权", "期货", "商品", "汇率", "美元指数", "债券", "美债", "黄金", "白银", "原油", "铜",
  "资金流", "板块轮动", "估值", "分红", "并购重组", "量化因子", "回测", "高频交易", "风控", "仓位管理",
] as const;

/** 可选的实体标签（公司、机构、平台）。 */
export const ENTITY_TAGS = ["英伟达", "台积电", "苹果", "特斯拉", "微软", "腾讯", "阿里巴巴", "贵州茅台", "宁德时代", "比亚迪", "中芯国际", "寒武纪", "美联储"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  市场: "行情异动", 行情: "行情异动", 盘面: "行情异动", 涨跌: "行情异动", 指数: "行情异动", 资金面: "行情异动",
  公司: "公司事件", 公告: "公司事件", 业绩: "财报", "业绩预告": "财报", 财报业绩: "财报", 定期报告: "财报", 年报: "财报", 季报: "财报",
  并购: "公司事件", 重组: "公司事件", 回购: "公司事件", 增持: "公司事件", 减持: "公司事件", 上市: "公司事件", ipo: "公司事件", 停牌: "公司事件",
  经济数据: "宏观数据", 央行: "宏观数据", 货币政策: "宏观数据", 通胀: "宏观数据", 利率: "宏观数据",
  政策: "政策/监管", 监管: "政策/监管", 法规: "政策/监管", 处罚: "政策/监管",
  研报: "研报/数据", 研究报告: "研报/数据", 研究: "研报/数据", 数据: "研报/数据", 测算: "研报/数据",
  策略: "量化/策略", 因子: "量化/策略", 回测: "量化/策略", 量化: "量化/策略", 组合: "量化/策略", 模型: "量化/策略",
  工具: "工具/代码", 开源: "工具/代码", 仓库: "工具/代码", 代码: "工具/代码", "open-source": "工具/代码",
  教程: "教程/实践", 指南: "教程/实践", 方法: "教程/实践", 实操: "教程/实践", 技巧: "教程/实践", 最佳实践: "教程/实践",
  观点: "观点/分析", 评论: "观点/分析", 解读: "观点/分析", 分析: "观点/分析", 访谈: "观点/分析",
  传闻: "传闻/预期", 传言: "传闻/预期", 预期: "传闻/预期", 小作文: "传闻/预期",
  非股票: "非股票/通用", "non-stock": "非股票/通用", 通用: "非股票/通用", 其他行业: "非股票/通用",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；orgNames 是这家公司发消息时开头用的组织名（公司、实验室、团队），
 * 在它自己的主题页上读者知道说的是谁，可以省去；otherNames 是公司的其他称呼（官方账号名、子品牌）。
 * 所有这些名字都用来认出说的是哪家公司，比如把事实的主体对到发布方。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {
  nvidia: { name: "英伟达", displayTag: "英伟达", aliases: ["英伟达", "NVIDIA", "NVDA"], orgNames: ["NVIDIA", "英伟达"], otherNames: ["NVIDIA Newsroom"] },
  tsmc: { name: "台积电", displayTag: "台积电", aliases: ["台积电", "TSMC", "台湾积体电路制造"], orgNames: ["台积电", "TSMC"], otherNames: ["TSMC News"] },
  apple: { name: "苹果", displayTag: "苹果", aliases: ["苹果", "Apple", "AAPL"], orgNames: ["Apple", "苹果"] },
  tesla: { name: "特斯拉", displayTag: "特斯拉", aliases: ["特斯拉", "Tesla", "TSLA"], orgNames: ["Tesla", "特斯拉"] },
  microsoft: { name: "微软", displayTag: "微软", aliases: ["微软", "Microsoft", "MSFT"], orgNames: ["Microsoft", "微软"] },
  tencent: { name: "腾讯", displayTag: "腾讯", aliases: ["腾讯", "Tencent", "0700", "00700"], orgNames: ["腾讯", "Tencent"], otherNames: ["腾讯控股"] },
  alibaba: { name: "阿里巴巴", displayTag: "阿里巴巴", aliases: ["阿里巴巴", "阿里", "Alibaba", "BABA", "9988"], orgNames: ["阿里巴巴", "Alibaba", "Alibaba Group"], otherNames: ["阿里云"] },
  moutai: { name: "贵州茅台", displayTag: "贵州茅台", aliases: ["贵州茅台", "茅台", "600519"], orgNames: ["贵州茅台", "茅台集团"] },
  catl: { name: "宁德时代", displayTag: "宁德时代", aliases: ["宁德时代", "CATL", "300750"], orgNames: ["宁德时代", "CATL"] },
  byd: { name: "比亚迪", displayTag: "比亚迪", aliases: ["比亚迪", "BYD", "002594"], orgNames: ["比亚迪", "BYD"] },
  smic: { name: "中芯国际", displayTag: "中芯国际", aliases: ["中芯国际", "SMIC", "688981", "0981"], orgNames: ["中芯国际", "SMIC"] },
  cambricon: { name: "寒武纪", displayTag: "寒武纪", aliases: ["寒武纪", "688256"], orgNames: ["寒武纪", "中科寒武纪"] },
  fed: { name: "美联储", displayTag: "美联储", aliases: ["美联储", "Federal Reserve", "FOMC", "鲍威尔", "Powell"], orgNames: ["美联储", "Federal Reserve", "FOMC"] },
  pboc: { name: "中国人民银行", displayTag: null, aliases: ["中国人民银行", "央行", "人民银行", "PBOC"], orgNames: ["中国人民银行", "人民银行", "PBOC"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "nvidia", name: "英伟达", patterns: [/nvidia|英伟达|\bnvda\b/i] },
  { id: "tsmc", name: "台积电", patterns: [/台积电|\btsmc\b/i] },
  { id: "apple", name: "苹果", patterns: [/苹果|\bapple\b|\baapl\b/i] },
  { id: "tesla", name: "特斯拉", patterns: [/特斯拉|\btesla\b|\btsla\b/i] },
  { id: "microsoft", name: "微软", patterns: [/微软|\bmicrosoft\b|\bmsft\b/i] },
  { id: "tencent", name: "腾讯", patterns: [/腾讯|\btencent\b|\b0700\b/i] },
  { id: "alibaba", name: "阿里巴巴", patterns: [/阿里巴巴|阿里(?:云|巴巴|控股)?|\balibaba\b|\bbaba\b|\b9988\b/i] },
  { id: "moutai", name: "贵州茅台", patterns: [/茅台|\bmoutai\b|\b600519\b/i] },
  { id: "catl", name: "宁德时代", patterns: [/宁德时代|\bcatl\b|\b300750\b/i] },
  { id: "byd", name: "比亚迪", patterns: [/比亚迪|\bbyd\b|\b002594\b/i] },
  { id: "smic", name: "中芯国际", patterns: [/中芯国际|\bsmic\b|\b688981\b|\b0981\b/i] },
  { id: "cambricon", name: "寒武纪", patterns: [/寒武纪|\bcambricon\b|\b688256\b/i] },
  { id: "fed", name: "美联储", patterns: [/美联储|\bfed\b|\bfomc\b|鲍威尔|powell/i] },
  { id: "pboc", name: "中国人民银行", patterns: [/中国人民银行|人民银行|\bpboc\b|中国央行/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如交易所信息披露页不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "nvidia", domains: ["nvidia.com"] },
  { entityId: "apple", domains: ["apple.com"] },
  { entityId: "tesla", domains: ["tesla.com"] },
  { entityId: "microsoft", domains: ["microsoft.com"] },
  { entityId: "tencent", domains: ["tencent.com"] },
  { entityId: "alibaba", domains: ["alibabagroup.com"] },
  { entityId: "catl", domains: ["catl.com"] },
  { entityId: "byd", domains: ["bydglobal.com"] },
  { entityId: "smic", domains: ["smics.com"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "fed", pattern: /@federalreserve\b/i },
];
