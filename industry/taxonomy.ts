// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（教程、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * tagColor 是飞书推送卡片里跟在标题后面的一类小标签的颜色（飞书 text_tag 的颜色名）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "market", tagColor: "orange", label: "市场", feedLabel: "市场行情", section: "市场与资金", guide: "指数、成交额、资金流、涨跌家数与板块轮动、汇率与商品市场的联动、海外市场开盘收盘。主体是市场整体或一组成分股，不点名某一家公司；点名公司并以其为主体的归个股。" },
  { key: "macro", tagColor: "blue", label: "宏观", feedLabel: "宏观与政策", section: "宏观与政策", guide: "央行与利率、通胀就业等经济数据、财政与产业政策、监管新规、地缘与海外央行事件对定价的影响。主体是政策、数据或监管机构，不是某家上市公司。" },
  { key: "stock", tagColor: "turquoise", label: "个股", feedLabel: "个股与公司", section: "个股与公司", guide: "点名一家上市或拟上市公司的实质事件：财报与业绩预告、公告与问询、回购增减持、并购重组、IPO 与停复牌、监管处罚、重大合同订单。只有股价异动、没有公司自身消息的归市场。" },
  { key: "industry", tagColor: "indigo", label: "行业", feedLabel: "行业与板块", section: "行业与板块", guide: "产业链与板块层面的变化：景气度、产品价格、产能与库存、销量与订单、供需缺口、政策对某个行业的影响、多家公司同向变动。点名了一家公司并以其为主体的归个股。没有归上类的资料也放在这一节。" },
  { key: "quant", tagColor: "violet", label: "量化", feedLabel: "量化与策略", section: "量化与工具", guide: "量化策略与因子、组合与风控方法、回测与数据处理、交易工具与开源实现、量化机构与产品动态、监管对程序化交易的规定。面向普通读者的入门做法归教程。" },
  { key: "tip", tagColor: "green", label: "教程", section: "观点与教程", guide: "读者可以照着做的方法：读财报、看估值、做筛选、控仓位与止损、使用行情或交易工具的步骤。重点是可复用的做法；只有看法没有做法归观点。", commentary: true },
  { key: "opinion", tagColor: "purple", label: "观点", section: "观点与教程", guide: "分析师、基金经理、交易员或财经作者的解释、判断、预测、复盘与访谈。讨论行情不自动归市场，作者是名人不自动归观点。", commentary: true },
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
  "A股", "港股", "美股", "中概股", "ETF", "可转债", "期权", "期货", "商品", "汇率", "债券", "资金流", "板块轮动", "估值", "分红", "并购重组",
  "量化因子", "回测", "高频交易", "风控", "仓位管理",
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
