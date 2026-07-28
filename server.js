/**
 * 每天烈刻 · AI市场部 · 第一期服务器
 * 撰写助理
 */

require('dotenv').config();
const express = require('express');
const { spawnSync, spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const CFG = require('./config/market-config');
const {
  assemblePrompt,
  summarizeModules,
  writePromptRunSnapshot,
} = require('./lib/context-harness');

const XHS_PUBLISHER_DIR = path.join(os.homedir(), 'xhs-publisher');
const XHS_LAUNCHER = path.join(XHS_PUBLISHER_DIR, 'launch_playwright.py');
const XHS_PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';
const CHATGPT_AUTOMATION_URL = 'https://chatgpt.com/?lieke_gpt_profile=gpt-a';
const FORCED_GPT_ACCOUNT_SLUG = 'gpt-a';
const FORCED_GPT_ACCOUNT_EMAIL = 'farewell13710@gmail.com';
const GPT_IMAGE_ACCOUNT = FORCED_GPT_ACCOUNT_SLUG;
const GPT_CDP_PORT = Number(process.env.MARKET_HUB_GPT_CDP_PORT || 9223);
const GPT_COMPANION_PORT = Number(process.env.MARKET_HUB_GPT_COMPANION_PORT || 8766);
const XHS_CDP_PORT = Number(process.env.MARKET_HUB_XHS_CDP_PORT || 9224);
const XHS_COMPANION_PORT = Number(process.env.MARKET_HUB_XHS_COMPANION_PORT || 8767);
const XHS_LEGACY_PROFILE_FRAGMENT = path.join('xhs-publisher', 'chrome-ext-profile').toLowerCase();

const IMAGE_POOL_CONFIG_PATH = path.join(__dirname, 'image-pool-config.json');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const IMAGE_CACHE_DIR = path.join(__dirname, 'feishu-image-cache');
const FEISHU_RESULT_BASE = process.env.FEISHU_RESULT_BASE_TOKEN || '';
const FEISHU_RESULT_SCENE_TABLE = 'tblpU9jAjb26Nelp';
const FEISHU_RESULT_FIELDS = {
  name: 'fldgghMP0S',
  satisfied: 'fldiSo13LG',
  replaced: 'fld1KIV11Q',
  status: 'fldNGl8w9z',
};

// ─── 框架基础模板覆盖（用户可编辑，存磁盘）──────────────────────────
const BASE_OVERRIDES_PATH = path.join(__dirname, 'base-overrides.json');
const TOPIC_SIGNALS_PATH = path.join(__dirname, 'topic-signals.json');
const TOPIC_RECOMMENDATIONS_PATH = path.join(__dirname, 'topic-recommendations.json');
const TOPIC_PIPELINE_PATH = path.join(__dirname, 'topic_pipeline.py');
const TOPIC_CONFIG_PATH = path.join(__dirname, 'topic-config.json');
const MARKET_INSIGHTS_PATH = path.join(__dirname, 'market-insights.json');
const PROMPT_RUNS_PATH = path.join(__dirname, 'data', 'prompt-runs.jsonl');
const MARKET_INSIGHT_TABLE = 'tbl6uTJb7IGWWzVg';
const MARKET_INSIGHT_NAME_FIELD = 'fldtel2qsK';
let topicRefreshRunning = false;
let insightRefreshRunning = false;

const DEFAULT_TOPIC_CONFIG = {
  cacheHours: 4,
  seeds: ['低度酒', '果酒推荐', '女生喝什么酒', '烧烤喝什么', '微醺'],
  sources: {
    homeFeed: true,
    keywordSearch: true,
    topicSearch: true,
    crossPlatform: true,
    savedResearchFallback: true,
  },
};

function loadTopicConfig() {
  let incoming = {};
  try { incoming = JSON.parse(fs.readFileSync(TOPIC_CONFIG_PATH, 'utf8')); }
  catch (e) { incoming = {}; }
  const seeds = Array.isArray(incoming.seeds)
    ? [...new Set(incoming.seeds.map(v => String(v || '').trim()).filter(Boolean))].slice(0, 20)
    : [];
  const sourceInput = incoming.sources && typeof incoming.sources === 'object' ? incoming.sources : {};
  return {
    cacheHours: Math.max(0.25, Math.min(Number(incoming.cacheHours) || DEFAULT_TOPIC_CONFIG.cacheHours, 24)),
    seeds: seeds.length ? seeds : DEFAULT_TOPIC_CONFIG.seeds,
    sources: Object.fromEntries(Object.entries(DEFAULT_TOPIC_CONFIG.sources).map(([key, val]) => [key, key in sourceInput ? !!sourceInput[key] : val])),
  };
}

function saveTopicConfig(config) {
  fs.writeFileSync(TOPIC_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function loadBaseOverrides() {
  try { return JSON.parse(fs.readFileSync(BASE_OVERRIDES_PATH, 'utf8')); }
  catch (e) { return {}; }
}
function saveBaseOverrides(overrides) {
  fs.writeFileSync(BASE_OVERRIDES_PATH, JSON.stringify(overrides, null, 2), 'utf8');
}

// ─── 框架基础模板（硬编码默认值，用户编辑后覆盖写入磁盘）────────────
const BASE_TEMPLATES = {
  A: {
    id: 'base-A', name: '基础写法', isBase: true,
    desc: '问题解决型写作顺序（自动注入）',
    body: '问题解决型核心：读者有具体不适，产品是那个解法。不是直接说"它很好"，而是先让读者认出自己的问题。\n\n可能的切入方式（选一种，每次换角度）：\n- 痛点代入：描述某个具体不适场景（辣嗓/涨肚/上头/甜腻），读者先认出自己，产品作为转折点出现\n- 失望转机：试过很多办法都没用，这个意外有效——强调"终于"\n- before/after：某个具体场景下喝酒体验的前后对比，画面要具体\n- 受众画像：精准描述"那种人"的困境（怕辣/不敢喝/聚会压力），让他们感到被看见，再引出产品\n- 意外解题：原本以为会辣/上头，喝了之后发现不是——可以是测试，可以是朋友推荐后的惊喜\n\n收口：给一个低门槛的安全感，让读者觉得试试没有风险，不要悬空结束。',
    example: `每次聚会喝酒都很纠结，啤酒喝两瓶就涨肚想吐，传统白酒一口下去嗓子像吞刀片，第二天头疼半天。直到上次在局上被安利了这个「每天烈刻」，我才真的找到了喝酒的舒适区。

它解决的最大痛点就是「入口难」。虽然是正经白酒，用的是茅台产区10年的老酒做基酒，但把度数降到了10度！而且加了北纬37度红心苹果发酵的果汁，入口完全是气泡水的顺滑感，完全没有那种辛辣的酒精味，果香特别明显。

对于控糖党来说，它0糖0卡的属性太加分了。以前喝甜酒长痘长肉，喝这个完全没有心理负担。

如果你也是那种「想微醺但怕高度数」的人，真心建议试试。它保留了白酒的松香麦韵，但去掉了所有让人难受的刺激感。不管是配火锅还是独酌，既好入口又不容易醉，这才是成年人该有的快乐水啊。`,
  },
  B: {
    id: 'base-B', name: '基础写法', isBase: true,
    desc: '场景种草型写作顺序（自动注入）',
    body: '场景种草型核心：靠具体的人、具体的时刻、具体的感官细节让读者感到"这说的就是我"，不是直接夸产品。\n\n以下是这个框架下的几种细分切入方向，每次根据卖点/人群/方向选一种（或自由组合），不要每次走同一条路：\n- 生活切片：某个具体的日常时刻（等外卖/下班/配火锅/独处夜晚），产品自然出现其中\n- 感官探索：从口感/嗅觉/视觉入手（气泡炸开/苹果酸甜/尾韵回甘），从感受写到产品背后\n- 情绪共鸣：某种情绪状态（需要微醺的夜晚/想喝点什么但不想断片），产品是那个对应物\n- 意外发现：某个细节或事实引发好奇（配料表/度数/产区），信息本身成为切入点\n- 人格认同：描述"那种人"的生活切片，让读者觉得说的就是自己\n- 颠覆认知：原本以为XX，结果发现YY——可以是第一次体验，也可以是对比记忆\n\n品牌事实融入方式：翻译成感受和体验，不直接报数据参数，每段取1-2个锚点。',
    example: `第一次喝的时候真的被惊艳到了，完全打破了我对白酒的刻板印象，原来白酒也可以这么轻盈、这么好玩。

以前聚会总是很纠结，喝啤酒涨肚，喝传统白酒度数太高容易上头，而且那个辣嗓子的感觉真的劝退。但这瓶「每天烈刻」真的打开了我的新世界大门。

它居然是用茅台产区10年藏的酱酒做基酒！你能想象吗？那种松香和麦子的底蕴还在，但因为它融合了北纬37度红心苹果发酵的果汁，入口瞬间被细腻的气泡炸开，口感居然像香槟一样顺滑。

我选的是青提口味，真的有那种咬破葡萄皮爆汁的清爽感，果香和酒香平衡得刚刚好。最关键的是它只有10度，对于我们这种想微醺又不想断片的人太友好了，喝完身上暖暖的，但是脑子很清醒。

而且它是0糖0卡的，这点真的深得我心。平时控糖戒糖，喝酒总会有负罪感，喝这个完全没有负担。周末和闺蜜下午茶，倒上一杯，加两块冰，瞬间氛围感拉满。

真的建议大家都去试试，特别是那些平时不碰白酒的朋友。这可能是你喝过最「不像」白酒的白酒。`,
  },
  C: {
    id: 'base-C', name: '基础写法', isBase: true,
    desc: '对比评测型写作顺序（自动注入）',
    body: '对比评测型核心：读者有疑虑或选择困难，需要有依据的判断，不是广告腔夸奖。用事实说话，结论克制。\n\n可能的切入方式（选一种，每次换角度）：\n- 配料表解读：主动扒成分/工艺，带读者一起"发现"——信息驱动，不是夸奖驱动\n- 自我怀疑验证：我也觉得是噱头，然后逐一用事实验证，转变要有依据\n- 购前顾虑打消：列出买之前的真实疑虑（会不会有白酒味/是不是兑的/糖分高不高），逐条用事实回答\n- 品类横向视角：同价位/同类型喝了很多，这款哪里不一样——不编竞品数据，只说自己的发现\n- 原料溯源：从产地/工艺角度切入，让读者理解"为什么这样做出来的"，建立信任\n\n禁止：不编造实验室数据、真实竞品比较、销量数字。',
    example: `最近市面上各种「果酒」「气泡酒」层出不穷，到底哪些是糖水兑香精，哪些是真材实料？今天特意扒了「每天烈刻」的配料表和工艺，结果真的有点意外。

首先看基酒。很多果酒用的是食用酒精，但它用的是茅台产区糯高粱酿制的10年藏酒！这一点就拉开了差距，底子有那种很高级的松香和麦子气息。

再看融合工艺。不是简单勾兑，而是用了北纬37度产区的红心苹果进行发酵融合。这就解释了为什么喝起来既有青提/菠萝的果香，又有白酒的醇厚，而不是像廉价果酒那样只有甜腻的糖精味。

口感方面，它做到了0糖0卡。只有10度，气泡细腻像香槟，喝完没有负担。

结论：如果你想喝点有底蕴的，又不想喝传统白酒，这款绝对是性价比和口感的双重赢家。`,
  },
  D: {
    id: 'base-D', name: '基础写法', isBase: true,
    desc: '教程干货型写作顺序（自动注入）',
    body: '教程干货型核心：读者能学到东西、觉得值得收藏。每个干货点必须实用，不是废话，方法要连回产品事实。\n\n可能的切入方式（选一种，每次换角度）：\n- 方法论清单：X件事让你喝出最好状态——适合喜欢step-by-step的读者\n- 常见误区：很多人在XX这步做错了——纠错型，带优越感的收藏动机\n- 新手引路：从零开始的选/喝/搭指南——降低门槛，适合完全不懂的受众\n- 原理解密：为什么加冰/换杯子/这样搭配有效——满足"知道为什么"的好奇心\n- 场合匹配：不同场合选不同喝法（独酌/聚会/配餐）——实用性强，容易转化\n\n收藏价值：每个方法要具体到操作层面，不要只说"更好喝"，要说"怎么做/为什么"。',
    example: `最近发现很多高端局和明星私厨都在上一种「气泡白酒」，很多人第一次见都不知道怎么喝才对。今天教大家几招，把「每天烈刻」喝出米其林的感觉。

第一步：必须加冰。因为它有细腻的气泡，像香槟一样，最佳饮用温度是6-8度。加冰后，北纬37度红心苹果的香气会更收敛，而茅台基酒的松香味会慢慢透出来，层次感极强。

第二步：选对杯子。千万别用那种普通玻璃杯，要用笛形杯或者郁金香杯。这样能聚住气泡，喝起来每一口都是爆珠的感觉。

第三步：搭配神器。青提口味配海鲜刺身，菠萝口味配辣味火锅。因为它是0糖0卡的，能完美解辣解腻，又不会像啤酒那样让海鲜变腥。

很多朋友问这酒和普通预调酒有啥区别？区别就在于它是「真白酒」。10年基酒打底，只是用苹果发酵把度数降到了10度。既过了酒瘾，又保了命。学会这几招，下次聚会你就是最懂酒的行家。`,
  },
};

// ─── 切入方式（按框架，服务器预选轮转）──────────────────────────────
const ENTRY_ANGLES = {
  A: [
    { id:'A1', name:'痛点代入',    desc:'描述某个具体不适场景（辣嗓/涨肚/上头/甜腻），读者先认出自己，产品作为转折点出现' },
    { id:'A2', name:'失望转机',    desc:'试过很多办法都没用，这个意外有效——重点在"终于"和有过尝试之后的对比感' },
    { id:'A3', name:'before/after', desc:'某个具体场景下喝酒体验的前后对比，画面要具体，不要泛泛而论' },
    { id:'A4', name:'受众画像',    desc:'精准描述"那种人"的困境（怕辣/不敢喝/聚会压力），让他们感到被看见，再引出产品' },
    { id:'A5', name:'意外解题',    desc:'原本以为会辣/上头，喝了之后发现不是——可以是主动测试，也可以是朋友推荐后的惊喜' },
  ],
  B: [
    { id:'B1', name:'生活切片',    desc:'某个具体的日常时刻（等外卖/下班/配火锅/独处夜晚），产品自然出现其中，不喧宾夺主' },
    { id:'B2', name:'感官探索',    desc:'从某个具体感官瞬间入手，从感受本身写到产品背后，不要先介绍产品再写感受' },
    { id:'B3', name:'情绪共鸣',    desc:'某种情绪状态（想微醺但不想断片/需要独处但不想沉默），产品是那个情绪的对应物' },
    { id:'B4', name:'意外发现',    desc:'某个具体细节或事实引发好奇（配料表/度数/产区），信息本身成为切入点' },
    { id:'B5', name:'人格认同',    desc:'描述"那种人"的生活切片，让读者看完觉得说的就是自己，进而被产品吸引' },
    { id:'B6', name:'颠覆认知',    desc:'原本以为XX，结果发现YY——用一个具体的事件/对比表达，不要只说"没想到"' },
    { id:'B7', name:'哲学种草',    desc:'读者内心状态是主角，产品嵌入情感叙事不单独介绍。写内心生活，无CTA，情绪是主要叙事介质，人称和具体规范见输出格式模块。', isSpecial: true },
  ],
  C: [
    { id:'C1', name:'配料表解读',  desc:'主动扒成分/工艺，带读者一起"发现"——信息驱动，不是夸奖驱动，每个细节要有来源' },
    { id:'C2', name:'自我怀疑验证', desc:'我也觉得是噱头，然后逐一用事实验证——转变要有具体依据，不能只说"没想到真不错"' },
    { id:'C3', name:'购前顾虑打消', desc:'列出买之前的真实疑虑（会不会有白酒味/是不是兑的/糖分高），逐条用事实回答' },
    { id:'C4', name:'品类横向视角', desc:'同价位/同类型喝了很多，这款哪里不一样——不编竞品数据，只说自己的具体发现' },
    { id:'C5', name:'原料溯源',    desc:'从产地/工艺角度切入，让读者理解"为什么这样做出来的"，建立理性信任' },
  ],
  D: [
    { id:'D1', name:'方法论清单',  desc:'X件事让你喝出最好状态——每件事要具体可操作，不是废话' },
    { id:'D2', name:'常见误区',    desc:'很多人在XX这步做错了——纠错型，带一点优越感，收藏动机强' },
    { id:'D3', name:'新手引路',    desc:'从零开始的选/喝/搭指南——降低门槛，适合完全不了解这个品类的读者' },
    { id:'D4', name:'原理解密',    desc:'为什么加冰/换杯子/这样搭配有效——满足"知道为什么"的好奇心，每个原理要有依据' },
    { id:'D5', name:'场合匹配',    desc:'不同场合用不同喝法（独酌/聚会/配餐）——实用性强，容易转化为真实购买决策' },
  ],
};

// 各框架核心机制一句话（角度模式下代替全量 body）
const FW_CORE = {
  A: '问题解决型核心：读者有具体不适，产品是解法。先让读者认出自己的问题，再引出产品作为转折点。',
  B: '场景种草型核心：让读者想要那个时刻，不是那瓶酒。产品是那个时刻的一部分，不是主角。',
  C: '对比评测型核心：读者有疑虑，需要有依据的判断。用事实说话，结论克制，不是广告腔夸奖。',
  D: '教程干货型核心：读者能学到东西、觉得值得收藏。每个干货点必须实用具体，方法连回产品事实。',
};

// 哲学种草模式——完全独立的写作指令（B7 专用，不遵循标准场景种草规范）
const PHIL_FW_BLOCK = `## 哲学种草模式（B7）——独立写作规范，覆盖所有标准场景种草规则

底层逻辑：小红书是造梦平台，用户找的不是产品，是向往的生活切片。种草的本质是身份认同触发——读者看完想成为内容里那种人，或想拥有那个时刻。产品是那个生活里自然存在的道具，不是主角。调性靠写法渗透，不靠说出来（不在文里贴「野性」「不将就」等标签，让语言本身带出来）。

核心机制：读者的内心生活是主角，产品是情感叙事的一部分，不是被介绍的对象。产品信息可以出现，但只在服务那个情感时刻时出现——它是身份认同的载体，不是功能清单。

写作规范：
- 人称遵循输出格式模块的规定，框架层不强制；叙事方式写向读者的内心世界
- 产品出现1-2次，嵌入叙事时刻，不单独成段介绍
- 产品的某个特质（如10度、气泡、名字本身）可以出现，但作用是强化那个情感状态，不是介绍功能
  ✓ "我们拿起10度的每天烈刻，不是因为怕醉，是因为只想要那个刚好的状态"——特质服务情感
  ✗ "它只有10度，还是0糖0卡的，喝了不上头不发胖"——功能介绍
- 有一个明确的情感领地，选一个深挖，不要并列多个：
  独立自主 / 与自己和解 / 清醒中的孤独 / 悲观底色里的韧劲 / 不愿被磨损的理想主义 / 野性与逃离
- 结尾留白，情绪停在半开的门口，不做总结，不收结论
- 禁止：推荐句式（"建议试试" / "值得一买"）、评论区CTA、产品功能罗列`;

const PHIL_EXAMPLE = `## 风格参考范文（圆周旅迹·旅行箱品牌，学习其结构和调性，内容完全原创）

【结构分析】
- 开场：直接一句话说出读者的某种状态（"你太迷恋出发了"）——不是介绍，是精准命名
- 品牌出现：正文中段自然嵌入（"数次旅程都有圆周旅迹的陪伴"/"有故事的旅行箱"）——产品特质服务于情感叙事，不单独成段介绍
- 节奏：多个"你太X了"段落，每段深挖一种内心特质，不并联，不堆砌
- 收口：开放，情绪停在往前走的门口，无CTA，无结论

【范文原文】
我才真正意义上清楚地看见你，才真正感受到你所有流动的情绪，才真正感受到你身体里持续生长的韧劲。

你太迷恋出发了。
今年，你凭借自己去了很多个城市，数次旅程都有圆周旅迹的陪伴。当出发的念想抵达你的身体，那些畏惧未知的声音从未淹没你，你依旧是迷恋出发的旅人，迷恋用出发的体验重塑自己，迷恋那些充盈你、让你有力量挣脱束缚的事物。

当你在圆周旅迹点进「有故事的旅行箱」时，你发现今年抵达的城市比过往的任何一年都多。你知道，出发后遇见的人和事都在塑造你的生命，你不会停止想要出发的念想，像表姐在给你庆生时写下的那句："她成为了一只自由的飞鸟。"

你太独立了。
无数次在网络上看到的那句"No one is coming"真实地发生在你的身上。站在二十出头的年纪，迷惘、混乱、痛哭占据你的生活，你一次次在那些际遇中看清身边人，直到他们无数次漠视你的痛苦和眼泪，说出那句"你一定会后悔你当下的选择"，你开始走向自己的选择。

你太安静了。
你总是静静地坐着，沉默地感受着这个世界，直到一次次在绚丽的景色前留下眼泪。在那样的时刻，你的世界好安静，连流泪都是无声的。

老己，我爱你。
爱你的眼泪，爱你身体里迸发的力量，爱你思想里不变的自我。我们继续往前走吧，不要回到那些痛苦的时光，不要再责怪自己。

"你已经长大了，很安全。"不要害怕预想的下坠，不要害怕会失去想要的自己。这几年，你很好地成为了自己。

等到某一天，我们一起扔掉过去的事物，轻盈地往前走吧。

【迁移到每天烈刻的要点】
- 情感领地换成：自我觉醒/清醒/反叛/与自己和解/不被磨损的野性——从brand-facts中选一个与本次场景最契合的
- 品牌/产品植入同样只一句，出现在某个叙事时刻里（不是产品介绍段落）
- 不写气泡/口感/度数/原料，只写那个时刻本身`;

const PHIL_OUTPUT_BLOCK = `## 输出格式要求（哲学种草模式）

严格按以下格式输出，不加额外说明或前置语：

### 备选标题（2个）
标题1：（不含emoji，16字以内，直接说出读者的某种状态，如"你太清醒了"）
标题2：（含1个emoji，16字以内，情绪认同感角度）

### 正文
（纯散文，无分段标题，无bullet，无分割线。全程第二人称。产品只出现一次。500-700字。）

### 适配话题标签（5个）
（自我成长/文字/情绪/年轻人/INFJ 方向，不含品牌产品词）

### 推断依据
（情感领地选择、产品植入位置说明、目标读者画像）`;

// ─── 切入方式轮转状态（持久化到磁盘，重启不丢失）────────────────────
const ANGLE_STATE_PATH = path.join(__dirname, 'angle-state.json');

function loadAngleState() {
  try { return JSON.parse(fs.readFileSync(ANGLE_STATE_PATH, 'utf8')); }
  catch { return { A: 0, B: 0, C: 0, D: 0 }; }
}
function saveAngleState(s) {
  fs.writeFileSync(ANGLE_STATE_PATH, JSON.stringify(s, null, 2), 'utf8');
}
function getCurrentAngle(framework) {
  const s = loadAngleState();
  const angles = ENTRY_ANGLES[framework] || [];
  if (!angles.length) return null;
  const idx = (s[framework] || 0) % angles.length;
  return { ...angles[idx], idx, total: angles.length };
}
function advanceAngle(framework) {
  const s = loadAngleState();
  const angles = ENTRY_ANGLES[framework] || [];
  const rotatable = angles.filter(a => !a.isSpecial);
  if (!rotatable.length) return null;
  // 只在非 special 角度里轮转
  const currentIdx = (s[framework] || 0);
  const currentAngle = angles[currentIdx];
  const rotatableWithIdx = rotatable.map((a, ri) => ({ ...a, realIdx: angles.indexOf(a), ri }));
  const curRi = rotatableWithIdx.findIndex(a => a.realIdx === currentIdx);
  const nextRi = curRi === -1 ? 0 : (curRi + 1) % rotatableWithIdx.length;
  s[framework] = rotatableWithIdx[nextRi].realIdx;
  saveAngleState(s);
  return getCurrentAngle(framework);
}
function setAngleIdx(framework, idx) {
  const s = loadAngleState();
  const angles = ENTRY_ANGLES[framework] || [];
  if (!angles.length) return null;
  s[framework] = Math.max(0, Math.min(parseInt(idx) || 0, angles.length - 1));
  saveAngleState(s);
  return getCurrentAngle(framework);
}

const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (/^https:\/\/www\.xiaohongshu\.com$/.test(origin) || /^chrome-extension:\/\//.test(origin) || /^http:\/\/127\.0\.0\.1:3377$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '2mb' }));
const staticDir = path.resolve(__dirname);
app.use(express.static(staticDir, {
  index: 'index.html',
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));
app.get('/', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));

// ─── 简单单用户会话状态 ─────────────────────────────────────────────
const state = {
  contextCache: null,
  contextCacheTime: 0,
};
let lastPromptSnapshot = null;

// ─── lark-cli 封装 ──────────────────────────────────────────────────
function larkCli(args, opts = {}) {
  const proxyEnv = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    ? {}
    : { HTTPS_PROXY: 'http://127.0.0.1:7890', HTTP_PROXY: 'http://127.0.0.1:7890' };
  const result = spawnSync('lark-cli', args, {
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    shell: true,
    cwd: opts.cwd || __dirname,
    env: { ...process.env, ...proxyEnv, NO_PROXY: process.env.NO_PROXY || 'localhost,127.0.0.1', PATH: process.env.PATH },
  });
  if (result.error) throw new Error(`lark-cli spawn error: ${result.error.message}`);
  if (!result.stdout) {
    const errMsg = result.stderr || `lark-cli exit code ${result.status}`;
    throw new Error(errMsg);
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch (e) { throw new Error(`lark-cli non-JSON: ${result.stdout.slice(0, 300)}`); }
  if (!parsed.ok) throw new Error(parsed.error?.message || JSON.stringify(parsed.error));
  return parsed;
}

function defaultImagePoolDir() {
  return process.env.IMAGE_POOL_DIR || path.join(os.homedir(), 'Desktop', 'AI工具', '换图结果池');
}

function loadImagePoolDir() {
  try {
    const cfg = JSON.parse(fs.readFileSync(IMAGE_POOL_CONFIG_PATH, 'utf8'));
    if (cfg && cfg.dir) {
      const configured = String(cfg.dir);
      const normalized = configured.toLowerCase().replace(/[\\/]+/g, path.sep);
      const pointsToOneOffResultDir = normalized.includes(`${path.sep}xhs-publisher${path.sep}output${path.sep}gpt-results${path.sep}`);
      if (!pointsToOneOffResultDir && fs.existsSync(configured)) return configured;
    }
  } catch {}
  return defaultImagePoolDir();
}

function saveImagePoolDir(dir) {
  const raw = String(dir || '').trim();
  if (!raw) throw new Error('图片池路径不能为空');
  const resolved = path.resolve(raw);
  fs.mkdirSync(resolved, { recursive: true });
  const real = fs.realpathSync(resolved);
  fs.writeFileSync(IMAGE_POOL_CONFIG_PATH, JSON.stringify({ dir: real }, null, 2), 'utf8');
  return real;
}

function ensureImagePool() {
  const dir = path.resolve(loadImagePoolDir());
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

function resolvePoolImage(filePath) {
  const root = ensureImagePool();
  const resolved = path.resolve(String(filePath || ''));
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('图片不在共享图片池内');
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error('图片文件不存在');
  }
  if (!IMAGE_EXTS.has(path.extname(resolved).toLowerCase())) {
    throw new Error('不支持的图片格式');
  }
  return resolved;
}

function resolveUploadImage(fileRef) {
  const raw = typeof fileRef === 'object' && fileRef ? fileRef.path : fileRef;
  const allowOutsidePool = Boolean(typeof fileRef === 'object' && fileRef?.allowOutsidePool);
  if (!allowOutsidePool) return resolvePoolImage(raw);
  const resolved = path.resolve(String(raw || ''));
  const cacheRoot = path.resolve(IMAGE_CACHE_DIR);
  if (!resolved.startsWith(cacheRoot + path.sep) && resolved !== cacheRoot) {
    throw new Error('外部图片只允许来自飞书成品图缓存');
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error('图片文件不存在');
  }
  if (!IMAGE_EXTS.has(path.extname(resolved).toLowerCase())) {
    throw new Error('不支持的图片格式');
  }
  return resolved;
}

function downloadFeishuResultImageRef(ref) {
  const m = String(ref || '').match(/^feishu:([^:]+):([^:]+)$/);
  if (!m) return null;
  resolveFeishuResultImage(ref);
  const [, recordId, fileToken] = m;
  return { path: downloadFeishuResultImage(recordId, fileToken), allowOutsidePool: true };
}

function listImagePoolFiles() {
  const root = ensureImagePool();
  return fs.readdirSync(root)
    .map(name => path.join(root, name))
    .filter(p => {
      try { return fs.statSync(p).isFile() && IMAGE_EXTS.has(path.extname(p).toLowerCase()); }
      catch { return false; }
    })
    .map(p => {
      const st = fs.statSync(p);
      return {
        name: path.basename(p),
        path: p,
        sizeKb: Math.round(st.size / 1024),
        mtime: st.mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function uploadPoolImageToLark(filePath) {
  const resolved = resolvePoolImage(filePath);
  const name = path.basename(resolved);
  const res = larkCli(['drive', '+upload', '--file', resolved, '--name', name, '--format', 'json']);
  const token = res.data?.file_token || res.data?.token || res.data?.file?.file_token || res.file_token || res.token;
  if (!token) throw new Error(`上传图片成功但未返回 file_token: ${JSON.stringify(res).slice(0, 300)}`);
  return { file_token: token, name };
}

function readFeishuResultImageState() {
  const res = larkCli([
    'base', '+record-list',
    '--base-token', FEISHU_RESULT_BASE,
    '--table-id', FEISHU_RESULT_SCENE_TABLE,
    '--limit', '200',
    '--format', 'json',
  ]);
  const records = res.data.data || [];
  const fieldIds = res.data.field_id_list || [];
  const recordIds = res.data.record_id_list || [];
  const idx = {};
  fieldIds.forEach((fid, i) => { idx[fid] = i; });
  const read = (row, fid) => (idx[fid] === undefined ? null : row[idx[fid]]);
  let satisfiedRows = 0;
  let replacedRows = 0;
  const files = records.flatMap((row, i) => {
    const recordId = recordIds[i];
    const name = read(row, FEISHU_RESULT_FIELDS.name) || recordId;
    const statusVal = read(row, FEISHU_RESULT_FIELDS.status);
    const status = Array.isArray(statusVal) ? statusVal.join('、') : (statusVal || '');
    const satisfied = read(row, FEISHU_RESULT_FIELDS.satisfied);
    const replaced = read(row, FEISHU_RESULT_FIELDS.replaced);
    if (Array.isArray(satisfied) && satisfied.length) satisfiedRows += 1;
    if (Array.isArray(replaced) && replaced.length) replacedRows += 1;
    const chosen = (Array.isArray(satisfied) && satisfied.length ? satisfied : null)
      || (Array.isArray(replaced) && replaced.length ? replaced : null)
      || [];
    return chosen.map((att, n) => ({
      recordId,
      fileToken: att.file_token,
      name: att.name || `${name}-${n + 1}`,
      sceneName: name,
      status,
      source: Array.isArray(satisfied) && satisfied.includes(att) ? '满意的图片' : '替换结果图',
      key: `feishu:${recordId}:${att.file_token}`,
    })).filter(x => x.fileToken);
  });
  return { files, totalRecords: records.length, satisfiedRows, replacedRows, hasMore: Boolean(res.data.has_more) };
}

function readFeishuResultImages() {
  return readFeishuResultImageState().files;
}

function resolveFeishuResultImage(ref) {
  const m = String(ref || '').match(/^feishu:([^:]+):([^:]+)$/);
  if (!m) return null;
  const [, recordId, fileToken] = m;
  const found = readFeishuResultImages().find(x => x.recordId === recordId && x.fileToken === fileToken);
  if (!found) throw new Error('飞书成品图不存在或已被删除');
  return { file_token: found.fileToken, name: found.name };
}

function downloadFeishuResultImage(recordId, fileToken) {
  const item = readFeishuResultImages().find(x => x.recordId === recordId && x.fileToken === fileToken);
  if (!item) throw new Error('飞书成品图不存在或已被删除');
  fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
  const ext = path.extname(item.name || '') || '.jpg';
  const out = path.join(IMAGE_CACHE_DIR, `${recordId}_${fileToken}${ext}`);
  if (fs.existsSync(out)) return out;
  const result = spawnSync('lark-cli', [
    'base', '+record-download-attachment',
    '--base-token', FEISHU_RESULT_BASE,
    '--table-id', FEISHU_RESULT_SCENE_TABLE,
    '--record-id', recordId,
    '--file-token', fileToken,
    '--output', out,
    '--overwrite',
    '--format', 'json',
  ], {
    encoding: 'utf8',
    timeout: 30000,
    shell: true,
    cwd: __dirname,
    env: { ...process.env, PATH: process.env.PATH },
  });
  if (result.error) throw new Error(`下载飞书图片失败：${result.error.message}`);
  if (result.status !== 0) throw new Error(result.stderr || '下载飞书图片失败');
  if (!fs.existsSync(out)) throw new Error('下载飞书图片后未找到本地缓存');
  return out;
}

// ─── 从记录中提取指定字段值 ────────────────────────────────────────
function extractField(record, idxMap, fieldCfg) {
  const idx = idxMap[fieldCfg.id];
  if (idx === undefined) return null;
  const val = record[idx];
  if (Array.isArray(val)) return val[0] ?? null; // select 类型
  return val ?? null;
}

// ─── 素材库（人/货/场）表配置 ────────────────────────────────────────
const MAT_BASE = process.env.MAT_BASE_TOKEN || process.env.FEISHU_BASE_TOKEN || ''; // 内容生产表
const OUTPUT_BASE  = process.env.OUTPUT_BASE_TOKEN || ''; // 脚本生产输出表
const OUTPUT_TABLE = 'tblagggirJGbcWIh';
const MATERIALS_CFG = {
  人: {
    tableId: 'tblTRMhxy1c1kdMf',
    fields: { name: 'fldOV2jwZp', mood: 'fldRiHdzmG', desc: 'fldZDaGs3l' },
    fieldNames: { name: '人群名称', mood: '情绪状态', desc: '详细描述' },
  },
  货: {
    tableId: 'tblzgf8xfGlSca84',
    fields: { name: 'flds5zRyer', dim: 'fld2z9D7vj', angle: 'fldBfOrJvW', main: 'fldBxW8jBI', desc: 'fldg5Va9ZV', src: 'fldNWNn8tJ' },
    fieldNames: { name: '卖点简称', dim: '维度', angle: '角度类型', main: '是否主卖点', desc: '核心描述', src: '来源' },
  },
  场: {
    tableId: 'tblq0Y4KX4gJ7FMO',
    fields: { name: 'fld89kuUYZ', mood: 'fldAxo8dLq', visual: 'fldiKL55MW', guide: 'fldnt1I4eU', srcNote: 'fldoaEljbM' },
    fieldNames: { name: '场景名称', mood: '情绪分类', visual: '画面描述', guide: '团队指导', srcNote: '来源笔记' },
  },
};

// 发布数据表字段 ID 映射
const OUTPUT_FIELDS = {
  标题:     'fld8r1kMve',
  正文:     'fld7V7kUMc',
  话题:     'fld35qjtsW',
  发布计划: 'fldJX7DnZv',
  是否发布: 'fldNhY7hvG',
  发布链接: 'fld1R5bywz',
  场景名称: 'fldJhuKffL',
  货角度:   'fldZHRkRbj',
  框架类型: 'fldwvpo34f',
  收藏数:   'fld167R4VM',
  点赞数:   'flduZ36FeP',
  评论数:   'fldqv3TKYd',
  测试结论: 'fld5v30x60',
  图片:     'fldwBz8ZZm',
  发布账号: 'fldxaFUuUt',
  参考链接: 'fldYdip12B',
};

const COMPETITOR_TABLE_ID = 'tblGpK7czdgjFZbi';
const COMPETITOR_FIELDS = {
  sourceUrl: 'fldPISrmKu',
  noteUrl: 'fldTKifb9m',
  title: 'fldcBaFZ4R',
  body: 'fldURB6y4Z',
  tags: 'fldOhE1pEY',
  attachment: 'fldAr3m51B',
  searchTerm: 'fldKz1cHR3',
  matchTerm: 'fldgMnJgMh',
  purpose: 'fldmJAOy5N',
  hotspot: 'flde2g1XaJ',
  imageStatus: 'flduPncUd8',
  category: 'fldYfZRMEX',
  angle: 'fld9y5JlJo',
  brand: 'fld7zYXUpX',
  likes: 'fldkwhCXdq',
  collects: 'fldrRTrjMW',
  comments: 'fldsiNypBW',
  shares: 'fldsNoorh7',
  commentText: 'fldL90EX2O',
  commentImages: 'fldsjl0bni',
};

function readMatTable(tableId) {
  const res = larkCli([
    'base', '+record-list',
    '--base-token', MAT_BASE,
    '--table-id', tableId,
    '--limit', '200',
    '--format', 'json',
  ]);
  const records = res.data.data || [];
  const fieldIdList = res.data.field_id_list || [];
  const recordIds = res.data.record_id_list || [];
  const idxMap = {};
  fieldIdList.forEach((fid, i) => { idxMap[fid] = i; });
  return { records, idxMap, recordIds };
}

function fetchMaterials() {
  const f人 = MATERIALS_CFG.人.fields;
  const f货 = MATERIALS_CFG.货.fields;
  const f场 = MATERIALS_CFG.场.fields;

  const parse = (tableId, mapper) => {
    try {
      const { records, idxMap, recordIds } = readMatTable(tableId);
      return records.map((r, i) => ({ ...mapper(r, idxMap), _id: recordIds[i] })).filter(x => x.name);
    } catch (e) {
      console.warn(`[materials ${tableId} error]`, e.message);
      return [];
    }
  };

  return {
    人: parse(MATERIALS_CFG.人.tableId, (r, idx) => ({
      name: extractField(r, idx, { id: f人.name }),
      mood: extractField(r, idx, { id: f人.mood }),
      desc: extractField(r, idx, { id: f人.desc }),
    })),
    货: parse(MATERIALS_CFG.货.tableId, (r, idx) => ({
      name:  extractField(r, idx, { id: f货.name }),
      dim:   extractField(r, idx, { id: f货.dim }),
      angle: extractField(r, idx, { id: f货.angle }),
      main:  extractField(r, idx, { id: f货.main }),
      desc:  extractField(r, idx, { id: f货.desc }),
      src:   extractField(r, idx, { id: f货.src }),
    })),
    场: parse(MATERIALS_CFG.场.tableId, (r, idx) => ({
      name:    extractField(r, idx, { id: f场.name }),
      mood:    extractField(r, idx, { id: f场.mood }),
      visual:  extractField(r, idx, { id: f场.visual }),
      guide:   extractField(r, idx, { id: f场.guide }),
      srcNote: extractField(r, idx, { id: f场.srcNote }),
    })),
  };
}

// ─── 读取飞书表 ──────────────────────────────────────────────────────
function readTable(tableCfg) {
  const res = larkCli([
    'base', '+record-list',
    '--base-token', CFG.feishu.baseToken,
    '--table-id', tableCfg.id,
    '--limit', '200',
    '--format', 'json',
  ]);
  const records = res.data.data || [];
  const fieldIdList = res.data.field_id_list || [];
  const recordIds = res.data.record_id_list || [];
  const idxMap = {};
  fieldIdList.forEach((fid, i) => { idxMap[fid] = i; });
  return { records, idxMap, recordIds };
}

// ─── 读取并整理飞书上下文 ────────────────────────────────────────────
async function fetchFeishuContext() {
  const now = Date.now();
  if (state.contextCache && (now - state.contextCacheTime < CFG.contextCacheTtl)) {
    return state.contextCache;
  }

  const ctx = {};

  // 1. 特征工程-金句修改对比（学习人工修改偏好）
  const iterCfg = CFG.feishu.tables.iterComp;
  try {
    const { records: iterRecs, idxMap: iterIdx } = readTable(iterCfg);
    ctx.iterComp = iterRecs
      .slice(-iterCfg.readLimit)
      .map(r => ({
        修改前:   extractField(r, iterIdx, iterCfg.fields.修改前),
        修改后:   extractField(r, iterIdx, iterCfg.fields.修改后),
        修改理由: extractField(r, iterIdx, iterCfg.fields.修改理由),
      }))
      .filter(r => r.修改前 && r.修改后);
  } catch (e) {
    console.warn('[iterComp read error]', e.message);
    ctx.iterComp = [];
  }

  // 2. 参考-图文文案（品牌=低度酒，取最新 readLimit 条或用户选定条目）
  const refCfg = CFG.feishu.tables.reference;
  const { records: refRecs, idxMap: refIdx, recordIds: refRecordIds } = readTable(refCfg);

  const allRefRecords = refRecs
    .map((r, i) => ({
      标题:     extractField(r, refIdx, refCfg.fields.标题),
      标签:     extractField(r, refIdx, refCfg.fields.标签),
      文案内容: extractField(r, refIdx, refCfg.fields.文案内容),
      品牌:     extractField(r, refIdx, refCfg.fields.品牌),
      _id:      refRecordIds[i],
    }))
    .filter(r => r.文案内容 && r.品牌 === refCfg.filterBrand);

  const isDenseReferenceTemplate = (r) => {
    const text = `${r.标题 || ''}\n${r.标签 || ''}\n${r.文案内容 || ''}`;
    const denseHit = /测评|对比|清单|参数|表格|攻略|复盘|总结|教程|说明书/.test(text);
    const lineCount = String(r.文案内容 || '').split(/\n+/).filter(Boolean).length;
    const longDense = lineCount >= 6 || String(r.文案内容 || '').length > 500;
    return denseHit || longDense;
  };
  const usableRefRecords = allRefRecords.filter(r => !isDenseReferenceTemplate(r));

  const selectedIds = loadSelectedRefIds();
  if (selectedIds.length > 0) {
    const pinned = usableRefRecords.filter(r => selectedIds.includes(r._id));
    ctx.reference = pinned.length > 0
      ? pinned
      : (usableRefRecords.length > 0 ? usableRefRecords.slice(-refCfg.readLimit) : allRefRecords.slice(-refCfg.readLimit));
  } else {
    ctx.reference = usableRefRecords.length > 0 ? usableRefRecords.slice(-refCfg.readLimit) : allRefRecords.slice(-refCfg.readLimit);
  }

  state.contextCache = ctx;
  state.contextCacheTime = now;
  return ctx;
}

// ─── 框架说明 ─────────────────────────────────────────────────────────
const FRAMEWORK_LABELS = {
  A: '问题解决型',
  B: '场景种草型',
  C: '对比评测型',
  D: '教程干货型',
};

// ─── 本地文件缓存（POST 保存时主动失效）────────────────────────────
const _fileCache = {};
const FILE_CACHE_TTL = 5 * 60 * 1000;

function readFileCached(filePath, fallback = '') {
  const now = Date.now();
  const c = _fileCache[filePath];
  if (c && now - c.time < FILE_CACHE_TTL) return c.content;
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch { content = fallback; }
  _fileCache[filePath] = { content, time: now };
  return content;
}

function invalidateFile(filePath) { delete _fileCache[filePath]; }

// ─── 加载本地文件 ─────────────────────────────────────────────────
function loadWritingInstructions() {
  return readFileCached(path.join(__dirname, 'writing-instructions.md'));
}
function loadOutputFormatSingle() {
  return readFileCached(path.join(__dirname, 'output-format-single.md'));
}
function loadOutputFormatPhil() {
  return readFileCached(path.join(__dirname, 'output-format-phil.md'));
}
function loadOutputFormatBatch() {
  return readFileCached(path.join(__dirname, 'output-format-batch.md'));
}
function loadProductInfo() {
  return readFileCached(path.join(__dirname, 'product-info.md'));
}
function loadBrandFacts() {
  const { brand } = CFG;
  const fallback = `## 固定品牌事实（可按需取用，不要全部堆砌）\n品牌名：${brand.name} | 品类：${brand.category}\n品牌定位：${brand.positioning}\n品牌调性：${brand.archetype}；${brand.tone}\n\n### 原料与工艺锚点\n${brand.facts.map(f => `- ${f}`).join('\n')}`;
  return readFileCached(path.join(__dirname, 'brand-facts.md'), fallback);
}

// ─── 标题灵感库（飞书多维表格）───────────────────────────────────────
const TITLE_TABLE = 'tbljHmaT4eJj6sMV'; // 好标题灵感库，在 OUTPUT_BASE 下
const TITLE_HOOKS = ['新奇/反常识', '利他/利益前置', '梦想生活/人格认同', '品类新定义', '好奇心缺口'];
const TITLE_FIELD_IDS = { title: 'fldTdzdDVZ', hook: 'fldb5oq6pN', note: 'fldv68IwCu', source: 'fldsilb4os', date: 'fld397LrRv' };

let _titleCache = null;
let _titleCacheTime = 0;
const TITLE_CACHE_TTL = 5 * 60 * 1000;

function loadTitleLibrary() {
  const now = Date.now();
  if (_titleCache && now - _titleCacheTime < TITLE_CACHE_TTL) return _titleCache;
  try {
    const res = larkCli(['base', '+record-list', '--base-token', OUTPUT_BASE, '--table-id', TITLE_TABLE, '--limit', '200', '--format', 'json']);
    const records = res.data.data || [];
    const fieldIdList = res.data.field_id_list || [];
    const recordIds = res.data.record_id_list || [];
    const idxMap = {};
    fieldIdList.forEach((fid, i) => { idxMap[fid] = i; });
    const lib = records.map((r, i) => {
      const get = (fid) => { const v = r[idxMap[fid]]; return Array.isArray(v) ? (v[0] || '') : (v || ''); };
      return { id: recordIds[i], title: get(TITLE_FIELD_IDS.title), hook: get(TITLE_FIELD_IDS.hook) || '未分类', note: get(TITLE_FIELD_IDS.note), source: get(TITLE_FIELD_IDS.source), date: get(TITLE_FIELD_IDS.date) };
    }).filter(t => t.title);
    _titleCache = lib;
    _titleCacheTime = now;
    return lib;
  } catch (e) {
    console.warn('[TitleLib]', e.message);
    return _titleCache || [];
  }
}

function invalidateTitleCache() { _titleCache = null; _titleCacheTime = 0; }

function titleLibraryBlock() {
  const lib = loadTitleLibrary();
  if (!lib.length) return '';
  const byHook = {};
  lib.forEach(t => {
    const h = t.hook || '未分类';
    if (!byHook[h]) byHook[h] = [];
    byHook[h].push(t.title);
  });
  const lines = ['### 优先级0·好标题收录（学习角度多样性和点击欲望，不要直接复用字句）'];
  Object.entries(byHook).forEach(([hook, titles]) => {
    lines.push(`[${hook}]`);
    titles.slice(-8).forEach(t => lines.push(`  · ${t}`));
  });
  return lines.join('\n') + '\n\n';
}

function loadTemplates() {
  let userTemplates;
  try {
    userTemplates = JSON.parse(fs.readFileSync(path.join(__dirname, 'templates.json'), 'utf8'));
  } catch (e) {
    userTemplates = { A: [], B: [], C: [], D: [] };
  }
  const overrides = loadBaseOverrides();
  const merged = {};
  for (const fw of ['A', 'B', 'C', 'D']) {
    const ov = overrides[fw];
    let baseEntry = { ...BASE_TEMPLATES[fw] };
    if (ov) {
      // 支持旧格式（string = body only）和新格式（object）
      if (typeof ov === 'string') baseEntry.body = ov;
      else {
        if (ov.body) baseEntry.body = ov.body;
        if (ov.example !== undefined) baseEntry.example = ov.example;
      }
    }
    merged[fw] = [
      baseEntry,
      ...(userTemplates[fw] || []).filter(t => !t.isBase),
    ];
  }
  return merged;
}

// ─── 构建 Claude Prompt ──────────────────────────────────────────────
function buildPrompt(ctx, direction, sellingPoint, framework, subTemplate = null, persona = null, scene = null, refArticle = null, spItems = [], angle = null, toneStyle = 'narrative', bRoute = 'product', topicSignal = null) {
  const { brand } = CFG;
  const fwLabel = FRAMEWORK_LABELS[framework] || '场景种草型';

  // ① 撰写系统指令（用户可编辑）；KOC 模式只保留品牌底线，不注入写作规范
  const writingInstructions = loadWritingInstructions();
  const kocBrandGuardrails = `## 品牌底线（所有模式通用）\n- 禁止广告腔：不写"满足您的……""为您带来……""品质保证……"\n- 禁止无依据事实：不编销量、获奖、实验室数据、真实竞品名\n- 禁止把0糖0卡说成减肥/医疗功效\n- 正文必须像真人写的，不像品牌公告`;
  const systemBlock = toneStyle === 'koc'
    ? kocBrandGuardrails
    : (writingInstructions || `## 撰写规范\n（writing-instructions.md 未找到，使用默认规范）`);

  // ② 品牌固定事实（从 brand-facts.md 读取，支持 UI 编辑）
  const brandBlock = loadBrandFacts();

  const longTailTerms = topicSignal ? [...new Set([
    ...(Array.isArray(topicSignal.longTailTerms) ? topicSignal.longTailTerms : []),
    ...(Array.isArray(topicSignal.searchTerms) ? topicSignal.searchTerms : []),
    topicSignal.bridge,
    topicSignal.intervention,
  ].filter(Boolean).map(x => String(x).trim()))].slice(0, 8) : [];

  const topicSignalBlock = topicSignal ? `## 用户决策路径 brief（写作前先读）
种子词/热点词：${topicSignal.trafficKeyword || topicSignal.coreConcept || topicSignal.title || '(missing)'}
核心概念：${topicSignal.coreConcept || topicSignal.title || '(missing)'}
用户为什么会停下来：${topicSignal.searchIntent || topicSignal.rationale || topicSignal.bridge || '(根据参考文和搜索词推断)'}
当前决策阶段：${topicSignal.decisionStage || topicSignal.intervention || '(判断是停留、代入、理解、信任还是购买)'}
内容要完成的任务：${topicSignal.contentTask || topicSignal.direction || '(只完成一个任务)'}
想进入的状态：${topicSignal.desiredState || topicSignal.scene || '(从用户缺口推断)'}
产品承接：${topicSignal.productBridge || topicSignal.bridge || '(只选一个真实产品事实)'}
证据：${(topicSignal.evidence || []).slice(0, 3).map(x => typeof x === 'string' ? x : x.title).filter(Boolean).join(' / ') || '(missing)'}

写作动作：
1. 先判断这篇内容解决用户决策路径里的哪一步。
2. 写出一个具体人、具体时间地点、具体物件、具体动作，让用户有“这说的不就是我吗”的代入。
3. 产品只在能承接这个状态的位置出现；不要把文章改成产品说明书。
4. 搜索词像真人自问、判断、比较那样进入正文，不能堆成关键词列表。
` : '';

  const searchTermBlock = topicSignal ? `## 搜索词布局与造梦约束
核心搜索词：${[topicSignal.trafficKeyword, topicSignal.coreConcept].filter(Boolean).join(' / ') || '(none)'}
长尾词：${longTailTerms.join(' / ') || '(从搜索意图里推导 3-5 个自然长尾词)'}
固定品牌词：每天烈刻气泡白酒
可用造梦时刻：${Array.isArray(topicSignal.dreamMoments) ? topicSignal.dreamMoments.join(' / ') : '(根据用户缺口生成 2-3 个生活时刻)'}
可用物件承载：${Array.isArray(topicSignal.objectCarriers) ? topicSignal.objectCarriers.join(' / ') : '(杯子、桌面、冰箱灯、杯壁水汽、聊天记录、便利店小票等)'}

布局规则：
1. 标题先负责点击欲望和参考母本的标题机制；核心搜索词优先进入前 120 字正文，只有自然时才进入标题。
2. 至少两个长尾词进入正文，写成自然语境里的问句、判断句或自我解释。
3. 标签保留品牌词和核心搜索根，但标签不能替代正文埋词。
4. 若参考文是氛围/互动/生活切片，搜索词必须服从参考文主题和情绪推进。
5. 输出前检查：如果删掉搜索词后文章还只是泛泛氛围，说明没有解决用户决策问题；如果只剩产品卖点，说明造梦失败。
` : '';

  const referencePriorityBlock = refArticle ? `## Reference priority
- The reference article's structure, cadence, density, and emotional progression outrank the generic writing rules.
- Read the whole reference body before choosing the angle; do not rely on the title or excerpt only.
- The reference body is complete; do not fill blanks yourself or expand it into a new product explainer.
- Before drafting, silently extract the reference's real subject, central emotional question, paragraph-by-paragraph function, sentence-and-pause pattern, and product exposure ratio.
- Preserve that subject-level mechanism, emotional curve, paragraph rhythm and image-to-text atmosphere. Turning it into a generic tasting review is a failed adaptation.
- Product facts may enter only where the reference naturally introduces an object, action or consumption detail. They must not replace the reference theme.
` : '';

  const referenceSearchSynthesisBlock = refArticle && topicSignal ? `## 参考笔记 + 决策路径合成（第一执行步骤）
1. 先提取参考文的真正主题、核心矛盾、段落功能、情绪推进、产品露出比例。
2. 再判断本次搜索词对应用户决策路径里的哪一步：停留、代入、理解、信任或购买。
3. 用“用户为什么搜这个词”改造开头和正文里的选择动机；标题优先保留参考母本的点击机制。
4. 核心搜索根进入前 120 字正文；至少两个长尾词进入后文，但必须像参考文叙述者自己的想法。
5. 参考文主题必须可被读者识别，搜索词必须可被平台检索，产品事实必须自然出现。三者同时成立才算完成。
` : '';

  const bRouteBlock = framework === 'B' ? (() => {
    if (bRoute === 'resonance') return `## B框架本次种草重心：共鸣种草
- 人物状态、关系或想进入的生活是主角，产品只在关键时刻短暂出现。
- 可以写“我清楚地看见你”式的持续命名、情绪共鸣和品牌态度。
- 产品露出约占正文10%-30%，只保留1-2个最贴场景的事实，不展开销售说明。`;
    if (bRoute === 'reference') return `## B框架本次种草重心：跟参考走
- 参考笔记决定结构、篇幅、产品露出比例和销售强度。
- 如果参考笔记长篇讲产品，就长篇讲产品；如果它只短暂露出品牌，就保持克制。
- B框架只保证内容落在可感知的场景中，不得把参考笔记改造成品牌散文。`;
    return `## B框架本次种草重心：产品种草
- 产品负责解决一个明确的感受问题或购买问题，但不得抢走本次切入角度的叙事发动机。
- 只允许一个主卖点被充分展开，最多再带一个支撑事实；不要把口感、工艺、产区、0糖、度数、价格全铺满。
- 产品相关内容建议占正文35%-55%；如果本次角度偏情绪、人格或生活切片，降到25%-40%。
- 可以明确推荐，但推荐必须从本次发动机自然长出来，不要写成完整产品说明书。`;
  })() : '';

  const bAngleEngineBlock = framework === 'B' && angle && !angle.isSpecial ? (() => {
    const engines = {
      B1: {
        name: '生活切片',
        lead: '主角是一个具体时刻，不是产品参数。',
        path: '从时间/动作/物件进入 → 产品作为当下动作的一部分出现 → 只解释它为什么适合这个时刻。',
        facts: '最多1个感官事实 + 1个场景价值。',
        forbid: '禁止用配料表、白酒刻板印象或参数清单开头。'
      },
      B2: {
        name: '感官探索',
        lead: '主角是第一口、气味、口腔触感或冰块/杯壁这种感官事件。',
        path: '先写感官事件 → 再给一个类比/动作 → 最后用一个事实解释为什么会这样。',
        facts: '最多1个口感事实 + 1个原因事实。',
        forbid: '禁止先介绍产品、先翻配料表、先讲品牌背景。'
      },
      B3: {
        name: '情绪共鸣',
        lead: '主角是读者想进入的状态，产品只是把这个状态落地的物件。',
        path: '先命名一种情绪/关系/疲惫 → 写它需要被怎样安放 → 产品短暂出现并承担这个功能。',
        facts: '最多1个产品事实，且必须服务情绪，不展开销售说明。',
        forbid: '禁止写成长篇产品测评。'
      },
      B4: {
        name: '意外发现',
        lead: '主角是一个意外点，但只能有一个意外点。',
        path: '先写发现的动作或场景 → 抛出唯一反差事实 → 立刻转到它带来的真实体验变化。',
        facts: '只选1个主事实；第二个事实只能一句带过。',
        forbid: '禁止把20%果汁、10度、0糖、产区、价格连续堆在同一段。'
      },
      B5: {
        name: '人格认同',
        lead: '主角是“我是哪种人/我不想再怎样喝”的选择感。',
        path: '先写一种生活选择或审美边界 → 产品作为这个选择的证据出现 → 收束到“这个东西适合哪种人”。',
        facts: '最多1个身份相关事实 + 1个体验事实。',
        forbid: '禁止再写“平时不碰白酒、怕辣嗓、想微醺但不想断片”的泛人群套话。'
      },
      B6: {
        name: '颠覆认知',
        lead: '主角是一个旧判断被具体事件推翻。',
        path: '先写旧判断 → 用一个具体瞬间推翻 → 写感官证据 → 给出新的判断。',
        facts: '最多1个推翻旧判断的关键事实。',
        forbid: '禁止空喊“打破刻板印象/颠覆认知”，必须有事件和证据。'
      },
    };
    const engine = engines[angle.id] || {
      name: angle.name || '本次角度',
      lead: '主角是本次切入方式，不是产品资料堆叠。',
      path: '按本次角度建立入口，再让产品事实服务这个入口。',
      facts: '最多2个事实。',
      forbid: '禁止套用基础范文的固定叙事顺序。'
    };
    return `## B框架本次叙事发动机：${engine.name}
- 本篇只能使用这一种发动机：${engine.lead}
- 推荐行文顺序：${engine.path}
- 产品事实预算：${engine.facts}
- 禁止动作：${engine.forbid}
- 总禁令：不得把“配料表发现、旧经验反转、第一口测评、场景安放、价格转化”全部写完；选一个入口写透，比把所有卖点讲完更重要。`;
  })() : '';

  // ②-1 本次主推卖点详情（从货表选择的完整信息）
  let sellingPointBlock = '';
  if (spItems && spItems.length > 0) {
    const lines = ['## 本次主推卖点（重点围绕以下卖点展开，不要面面俱到）\n'];
    spItems.forEach((sp, i) => {
      lines.push(`**卖点${i + 1}：${sp.name}**`);
      if (sp.dim)   lines.push(`维度：${sp.dim}`);
      if (sp.angle) lines.push(`角度类型：${sp.angle}`);
      if (sp.desc)  lines.push(`核心描述：${sp.desc}`);
      if (sp.main === '是') lines.push(`（主卖点，优先展开）`);
      lines.push('');
    });
    sellingPointBlock = lines.join('\n');
  }

  const sellingPointGuardBlock = `## 本次生成的硬约束
- 先服从用户显式选择的卖点；未选择人群/场景时，不要自行假设一个人群或场景。
- 如果本次选择了风格子模板，以子模板的参考示例和写作规则为最高优先级；框架基础示例只作为底层框架，不覆盖子模板。
- 如果没有选择风格子模板，也不要默认仿写基础示例；先服从本次切入角度和叙事发动机。
- 正文围绕“${sellingPoint}”展开，但产品事实只选最能支撑这个卖点的 1 个主事实 + 最多 1 个辅助事实，并翻译成读者能感受到的口感、情绪或场景价值。
- 如果没有目标人群和场景，不要沿用“平时不碰白酒、怕辣嗓、想微醺但不想断片”的泛人群套话；改从本次角度自然长出一个具体身份、动作或场景。
- 输出时先像一篇有入口、有现场感的小红书笔记，再像产品推荐；不要先像一篇产品介绍。
- 正文可以有 1 个轻互动，但必须像真实分享里顺手带出的反应或一句朋友间闲聊，不要为了拉评论硬提问。优先写成“我以前真的会躲白酒，这个有人懂吗”这类共鸣确认；只有特别自然时才用二选一。结尾以明确推荐或真实购买动作收住，不要运营式号召评论。
- 少用“不是……而是……”“不是那种”“不是XX，是XX”这类解释型句式，正文最多出现 1 次。优先用正面感官直写，例如把“不是香精甜”改成“青提味贴着舌面走，收得很干净”。评论区话术也要像真人回复，不要写成客服 FAQ 或销售催单。`;

  // ③ 本次定向素材（选择的人群/场景）
  let materialBlock = '';
  if (persona || scene) {
    const lines = ['## 本次定向素材（依据此定向撰写，不要偏离）\n'];
    if (persona) {
      lines.push(`**目标人群：${persona.name}**`);
      if (persona.mood) lines.push(`情绪状态：${persona.mood}`);
      if (persona.desc) lines.push(`人群洞察：${persona.desc}`);
      lines.push('');
    }
    if (scene) {
      lines.push(`**场景：${scene.name}**`);
      if (scene.mood) lines.push(`情绪分类：${scene.mood}`);
      if (scene.visual) lines.push(`画面方向：${scene.visual}`);
      if (scene.guide) lines.push(`团队指导：${scene.guide}`);
    }
    materialBlock = lines.join('\n');
  }

  // ② 动态产品信息（用户随时维护）
  const productInfo = loadProductInfo();
  const productBlock = productInfo
    ? `## 动态产品信息（最新，优先参考）\n\n${productInfo}`
    : '';

  // ③ 框架写作逻辑：有预选角度时只注入核心机制+指定角度，避免给Claude"选单"
  const templates = loadTemplates();
  const baseTemplate = (templates[framework] || []).find(t => t.isBase);
  const baseTemplateBody = framework === 'B' && bRoute === 'product'
    ? `产品场景种草核心：读者看完知道“为什么这个东西和我有关”，而不是看完一篇完整产品说明。产品事实是证据，叙事发动机才是入口。

写作机制：
1. 先确定本篇唯一叙事发动机：生活切片、感官探索、情绪共鸣、意外发现、人格认同或颠覆认知，只能选一种写透。
2. 围绕1个主卖点充分展开，最多补1个辅助事实；不要把所有产品资料平均塞进正文。
3. 允许直接表达惊喜、好喝和推荐，但每个判断后面都要有感官、动作、比较或事实支撑。
4. 场景负责让销售理由可信，但不能把固定范文里的“翻配料表—第一口—解释甜味—价格收束”机械复刻一遍。
5. 结尾给出明确适用人群、喝法或购买建议，但必须接住本篇开头的入口。

关键约束：产品事实默认最多2个；品牌理念最多一句；宁可少讲一个卖点，也不要把正文写成资料汇总。`
    : (baseTemplate?.body || FW_CORE[framework] || '');
  let frameworkLogicBlock = '';
  const isPhilMode = angle?.isSpecial === true && !subTemplate && !refArticle;
  if (isPhilMode) {
    frameworkLogicBlock = PHIL_FW_BLOCK + '\n\n' + PHIL_EXAMPLE;
  } else if (angle && !subTemplate && !refArticle) {
    frameworkLogicBlock = `## 框架${framework} · ${fwLabel}

${baseTemplateBody}

**本次切入方式（已预选，严格按此角度展开，不使用其他切入方式）：${angle.name}**
${angle.desc}`;
  } else if (baseTemplate) {
    frameworkLogicBlock = subTemplate
      ? `## 框架${framework} · ${fwLabel}（底层说明）\n\n用户已选择风格子模板，本次以子模板的参考示例、写作规则和内容主线为准。基础框架只提供大类方向，不注入基础模板正文，避免和子模板打架。`
    : refArticle
      ? `## 框架${framework}内容逻辑（参考范文优先）\n\n只保留“内容必须落在具体场景中”这一层框架约束。结构、篇幅、产品露出比例和销售强度全部以参考范文为准。`
      : `## 框架${framework}写作逻辑\n\n${baseTemplateBody}`;
  }

  // ③a 仿写参考范文（用户在参考文案库中选择后注入）
  const imitBlock = refArticle
    ? `## ★ 本次首要任务：仿写以下参考范文\n本次生成的节奏、情绪走向、句式结构必须以此范文为蓝本。品牌事实和框架内容逻辑服务于这个结构，不得覆盖它。内容完全原创，不得复制原文字句。\n\n标题：${refArticle.title || '（无标题）'}\n标签：${refArticle.tag || '（无标签）'}\n\n${(refArticle.content || '')}`
    : '';

  // 参考示例优先级：选中的子模板 example > 框架基础模板 example。
  // 框架基础 example 是目标风格锚点，不是问题样例；普通生成也应注入。
  const activeExample = subTemplate?.example || baseTemplate?.example || '';
  const activeExampleName = subTemplate?.example ? `子模板「${subTemplate.name}」` : `框架${framework}基础模板`;
  const exampleRouteGuidance = framework === 'B' && bRoute === 'resonance'
    ? '学习示例如何持续命名人物状态、使用物件承接情绪，以及让产品短暂而准确地出现。允许克制、留白和文学质地，不要强行补成长篇产品介绍。'
    : '学习示例的产品信息密度、情绪强度、痛点转折、明确推荐和评论区话术。写得像真人认真讲一个好东西，允许直接说好喝和推荐，不要改成品牌散文。';
  const shouldInjectFrameworkExample = Boolean(subTemplate?.example || !angle);
  const frameworkExampleBlock = (!isPhilMode && !imitBlock && activeExample && shouldInjectFrameworkExample)
    ? `## 参考示例（来自${activeExampleName}，本次写法参考）\n这是本次文风和行文逻辑的主要参照。${exampleRouteGuidance}\n示例里的具体口味、原料、年份和价格只学习所在位置与表达方法，事实以本次产品信息和卖点为准；内容必须原创。\n\n${activeExample}`
    : '';
  const styleLocked = Boolean(frameworkExampleBlock || subTemplate);
  const effectiveSystemBlock = styleLocked
    ? `${kocBrandGuardrails}\n- 本次有明确参考示例或风格子模板时，必须强模仿该示例/模板。全局写作规范只负责品牌底线，不负责改写语气和结构。`
    : systemBlock;

  // ③b 风格子模板（用户主动选择时叠加注入）
  const subTemplateBlock = subTemplate
    ? `## 本次仿写风格模板：${subTemplate.name}\n${subTemplate.desc ? `说明：${subTemplate.desc}\n` : ''}\n${subTemplate.body}\n\n（用户选择了这个模板时，必须强模仿此模板；框架基础示例只作为底层框架，不覆盖它。）`
    : '';


  // ⑤ 语言偏好库与飞书实时学习材料
  // 语言偏好库永远参考，但只校准句子层面的真人感，不决定文风、结构或内容主线。
  let languagePreferenceBlock = '## 语言偏好库（一直参考，只校准表达）\n\n这些是 AI 句、人手修改和修改理由。只学习“怎么把一句话改得更像真人”，不学习里面的选题、结构、段落顺序和内容主线。\n\n';
  let learningBlock = '## 小红书参考笔记（平台表达辅助）\n\n这些材料用于学习平台原生表达、标题钩子、种草语感、情绪浓度和可用内容角度。\n\n';

  const titleBlock = titleLibraryBlock();
  if (titleBlock) learningBlock += titleBlock;

  if (ctx.iterComp.length > 0) {
    languagePreferenceBlock += `### AI句 + 人手修改 + 修改逻辑\n`;
    ctx.iterComp.slice(-10).forEach((r, i) => {
      if (r.修改前 && r.修改后) {
        languagePreferenceBlock += `[${i+1}] AI句：${r.修改前.slice(0, 120)}\n    人手修改：${r.修改后.slice(0, 120)}\n`;
        if (r.修改理由) languagePreferenceBlock += `    修改逻辑：${r.修改理由.slice(0, 80)}\n`;
      }
    });
    languagePreferenceBlock += '\n';
  } else {
    languagePreferenceBlock += '（暂无人工修改偏好记录）\n';
  }

  if (!refArticle && ctx.reference.length > 0) {
    learningBlock += `### 参考图文文案\n`;
    ctx.reference.slice(-10).forEach((r, i) => {
      const title = r.标题 ? `【${r.标题}】` : '';
      const tag = r.标签 ? `（${r.标签}）` : '';
      const preview = (r.文案内容 || '').slice(0, 150);
      learningBlock += `[${i+1}]${title}${tag}\n${preview}\n\n`;
    });
  }

  if (!titleBlock && (refArticle || ctx.reference.length === 0)) {
    learningBlock += '（本次无额外小红书参考笔记，依据参考模板、卖点和品牌事实撰写）\n';
  }

  const compactFeedbackLines = [];
  if (ctx.iterComp.length > 0) {
    ctx.iterComp.slice(-6).forEach((r, i) => {
      const before = String(r.修改前 || '').replace(/\s+/g, ' ').slice(0, 70);
      const after = String(r.修改后 || '').replace(/\s+/g, ' ').slice(0, 70);
      const reason = String(r.修改理由 || '').replace(/\s+/g, ' ').slice(0, 50);
      if (before && after) compactFeedbackLines.push(`${i + 1}. ${before} → ${after}${reason ? `｜${reason}` : ''}`);
    });
  }
  const compactFeedbackBlock = compactFeedbackLines.length
    ? `## 复盘偏好摘要\n这些是人工修改留下的语言偏好，只用于校准句子手感和表达取舍。\n${compactFeedbackLines.join('\n')}`
    : '';

  const compactReferenceLines = [];
  if (!refArticle && ctx.reference.length > 0) {
    ctx.reference.slice(-6).forEach((r, i) => {
      const title = String(r.标题 || '').trim();
      const tag = String(r.标签 || '').trim();
      const content = String(r.文案内容 || '').replace(/\s+/g, ' ').trim();
      const first = content.slice(0, 80);
      if (title || first) compactReferenceLines.push(`${i + 1}. ${title ? `《${title}》` : '无标题'}${tag ? `｜${tag}` : ''}｜开头/质感：${first}`);
    });
  }
  const compactReferenceBlock = compactReferenceLines.length
    ? `## 参考笔记结构信号\n这些是历史参考的标题、标签和开头质感，用来学习平台表达和互动入口；本次主题仍由当前热点、用户路径和造梦 brief 决定。\n${compactReferenceLines.join('\n')}`
    : '';

  const compactFrameworkExampleBlock = (!refArticle && activeExample)
    ? `## 框架基础范文骨架\n框架：${framework} · ${fwLabel}\n用途：学习它的段落功能、信息密度和转折节奏，再用本次热点、用户决策路径和造梦 brief 重新落地。\n${String(activeExample).slice(0, 1200)}`
    : '';

  // ⑤ 当前任务
  const fwNote = refArticle
    ? `框架${framework} · ${fwLabel}（内容逻辑参考，结构节奏以上方参考范文为准）`
    : frameworkExampleBlock
    ? `框架${framework} · ${fwLabel}（风格以上方参考范例为准）`
    : `框架${framework} · ${fwLabel}（严格遵守此框架的写作逻辑和写作顺序）`;
  const taskFocus = (() => {
    const who = persona?.name ? `目标人群：${persona.name}` : '';
    const where = scene?.name ? `使用场景：${scene.name}` : '';
    const context = [who, where].filter(Boolean).join('；');
    if (framework === 'A') {
      return `本次主推卖点：${sellingPoint}
写法焦点：先建立一个具体痛点、顾虑或不适，再让产品作为解决方案出现。${context ? `素材只作为痛点背景：${context}。` : ''}不要写成普通生活方式故事。`;
    }
    if (framework === 'B') {
      if (bRoute === 'resonance') {
        return context
          ? `共鸣构思：${context}。先准确写出这个人的状态或关系压力，再让“${sellingPoint}”作为场景里的一个物件出现。`
          : `本次主推卖点：${sellingPoint}。写法焦点：持续命名一个具体的人和她想进入的状态，产品只短暂承担情绪或关系功能。`;
      }
      if (bRoute === 'reference' && refArticle) {
        return `本次主推卖点：${sellingPoint}。写法焦点：严格跟随参考范文的结构、长短、产品信息密度和推荐力度；不要用品牌理念重写参考。`;
      }
      return context
        ? `产品种草场景：${context}。围绕“${sellingPoint}”选一个最有力的产品事实写透；场景负责让体验可信，不要把所有卖点都讲完。`
        : frameworkExampleBlock
        ? `本次主推卖点：${sellingPoint}。写法焦点：沿用上方参考示例的热情销售种草感，但只选一个核心购买理由写透，不要扩写成全量产品说明。`
        : `本次主推卖点：${sellingPoint}。写法焦点：先按本次切入角度建立入口，再用1个主产品事实证明它；不要回到“配料表震惊—白酒刻板印象—第一口不辣—解释甜味—微醺—价格”的固定链路。`;
    }
    if (framework === 'C') {
      return `本次主推卖点：${sellingPoint}
写法焦点：用“怀疑/对比/验证/配料或工艺解释”的路径建立可信判断。${context ? `人群和场景只用于设定测试条件：${context}。` : ''}不要写成单纯体验种草故事。`;
    }
    if (framework === 'D') {
      return `本次主推卖点：${sellingPoint}
写法焦点：输出可收藏的具体方法、步骤、喝法、搭配或避坑清单。${context ? `人群和场景只用于限定教程适用对象：${context}。` : ''}不要写成情绪化体验故事。`;
    }
    return `本次主推卖点：${sellingPoint}`;
  })();
  const stylePriorityLine = frameworkExampleBlock || subTemplateBlock || imitBlock
    ? '1. 先强模仿本次选择的参考示例/风格子模板的结构、语气、段落节奏和评论区话术。'
    : '1. 先服从本次切入方式和框架逻辑，不要回到基础模板的固定叙事；本次没有强制仿写范文。';

  const taskBlock = `## 当前任务
内容框架：${fwNote}
方向：${direction}
${taskFocus}

本次写作优先级：
${stylePriorityLine}
2. 再围绕本次主推卖点组织产品事实和感官细节。
3. 如果要加互动，把它写成正文里的即时反应或朋友间闲聊，例如“我以前真的会躲白酒，这个有人懂吗”；不要为了完成任务突然抛运营问题，评论区话术不能替代正文里的真实交流感。
4. 语言偏好库只用于润色局部表达、吸收人工修改偏好，不改变本次参考模板的写法。
5. 开头优先用具体误判、动作反应或朋友原话，例如“喝第一口，我以为装错了”，不要只用“第一次喝就被惊艳到了”这种抽象情绪句。
6. 最终正文读感应当接近参考示例那种热情卖点种草，而不是测评报告、配料表分析或品牌说明书。`;

  // ⑥ 输出格式（优先读取用户编辑的自定义文件，否则用内置默认值；哲学模式强制用专属格式）
  const _customFmt = isPhilMode ? loadOutputFormatPhil() : loadOutputFormatSingle();
  const outputBlock = _customFmt || (isPhilMode ? PHIL_OUTPUT_BLOCK : (refArticle
    ? `## 输出格式要求
严格按以下格式输出，不要加额外说明或前置语：

### 备选标题（3个）
标题1：（含emoji，16字以内，反差/反转角度）
标题2：（含emoji，16字以内，痛点解决/利益角度）
标题3：（含emoji，16字以内，好奇心/测评/新鲜感角度）

### 正文
（不限字数。分段方式、emoji节标题、分割线（-）、bullet列表等结构元素完全参照上方★仿写范文。品牌事实翻译成感官感受或决策价值嵌入对应位置，不要在范文结构之外新增额外段落。）

### 评论区话术（3条）
1. （触发讨论）
2. （解答顾虑）
3. （推动试用/收藏/转化）

### 优化方向
1.
2.
3.

### 推断依据
（框架选择理由、目标人群、主次卖点逻辑）`
    : `## 输出格式要求
严格按以下格式输出，不要加额外说明或前置语：

### 备选标题（3个）
标题1：（含emoji，16字以内，反差/反转角度）
标题2：（含emoji，16字以内，痛点解决/利益角度）
标题3：（含emoji，16字以内，好奇心/测评/新鲜感角度）

### 正文
（KOC口吻，有具体生活细节，不打广告腔，至少锚定2条品牌事实。充分展开，不要截断，具体度和信息密度参考上方框架示例。）

### 评论区话术（3条）
1. （触发讨论）
2. （解答顾虑）
3. （推动试用/收藏/转化）

### 优化方向
1.
2.
3.

### 推断依据
（框架选择理由、目标人群、主次卖点逻辑）`));

  const kocToneBlock = (!isPhilMode && toneStyle === 'koc') ? `## ⚡ 本次语气目标\n\n语气、能量、开场方式、句式节奏全部对齐上方注入的参考范例。直接给感受和产品事实，产品好就直接说好，结尾给出明确推荐。` : '';

  const naturalnessBlock = `## 输出前自然度自检
成稿需要满足这 5 点：
1. 开头有一个具体动作、判断或现场反应。
2. 每一段都服务本次内容入口，段落之间有推进。
3. 至少有一个能被拍出来的物件或场景细节。
4. 产品事实落在具体体验、选择或信任理由里。
5. 评论区话术像真实读者会接话的问题或补充。`;

  const leanSystemBlock = `## 生成原则（瘦身版）
先确定这篇内容解决用户决策路径里的哪一步，再写正文。
如果有参考笔记，参考笔记的主题、段落功能、情绪推进和产品露出比例优先。
如果没有参考笔记，基础范文只提供骨架；本次热点、用户路径和造梦 brief 决定正文内容。
造梦只负责给出具体时刻、物件和状态，不负责把每篇都写成同一种散文腔。
产品事实只选 1 个主事实，最多 1 个辅助事实。`;

  const leanTaskBlock = `## 本次任务 brief
框架：${framework} · ${fwLabel}
方向：${direction || '未指定'}
主推卖点：${sellingPoint || '未指定'}
${persona?.name ? `人群：${persona.name}` : ''}
${scene?.name ? `场景：${scene.name}` : ''}
${topicSignal?.coreConcept || topicSignal?.trafficKeyword ? `搜索/热点：${topicSignal.coreConcept || topicSignal.trafficKeyword}` : ''}

执行顺序：
1. 先提炼用户为什么停下来、哪个场景击中她、她需要相信什么。
2. 再选择一个内容入口：问题、场景、互动封面、产品推荐、评测/对比、教程。
3. 用一个具体物件承载状态，例如杯子、桌面、冰箱灯、杯壁水汽、聊天记录、便利店小票。
4. 搜索词自然进入开头或正文判断句；标题只在自然时携带搜索词，不承担硬埋词任务。
5. 输出时只给成稿，不解释方法。`;

  const leanModules = [
    { name: '00 生成原则（瘦身版）', content: leanSystemBlock },
    ...(referenceSearchSynthesisBlock ? [{ name: '01 参考笔记与搜索合成', content: referenceSearchSynthesisBlock }] : []),
    ...(imitBlock ? [{ name: '02 参考母本', content: imitBlock }] : []),
    ...(topicSignalBlock ? [{ name: '03 用户决策路径 brief', content: topicSignalBlock }] : []),
    ...(searchTermBlock ? [{ name: '04 搜索词与造梦约束', content: searchTermBlock }] : []),
    { name: '05 本次任务', content: leanTaskBlock },
    ...(compactFrameworkExampleBlock ? [{ name: '05-1 框架基础范文骨架', content: compactFrameworkExampleBlock }] : []),
    ...(compactFeedbackBlock ? [{ name: '05-2 飞书复盘偏好摘要', content: compactFeedbackBlock }] : []),
    ...(compactReferenceBlock ? [{ name: '05-3 飞书参考笔记结构信号', content: compactReferenceBlock }] : []),
    { name: '06 必要品牌事实', key: 'brand', content: brandBlock.slice(0, 2600) },
    ...(sellingPointBlock ? [{ name: '07 选中卖点详情', content: sellingPointBlock }] : []),
    ...(materialBlock ? [{ name: '08 人群/场景材料', content: materialBlock }] : []),
    ...(productBlock ? [{ name: '09 产品信息补充', key: 'product', content: productBlock.slice(0, 2200) }] : []),
    { name: '10 输出前检查', content: naturalnessBlock },
    { name: '11 输出格式', key: isPhilMode ? 'output-phil' : 'output-single', content: outputBlock },
  ];

  if (!isPhilMode) {
    const assembled = assemblePrompt(leanModules, { mode: 'single-lean' });
    return { prompt: assembled.prompt, modules: assembled.modules, stats: assembled.stats };
  }

  const modules = [
    ...(referenceSearchSynthesisBlock ? [{ name: '00 参考主题与搜索词融合（最高执行优先级）', content: referenceSearchSynthesisBlock }] : []),
    ...(searchTermBlock ? [{ name: '00 搜索词＋长尾词（最高优先级）', content: searchTermBlock }] : []),
    ...(topicSignalBlock ? [{ name: '01 本次选题信号', content: topicSignalBlock }] : []),
    // KOC 模式：example 放最前，先定调；跳过飞书学习材料（防止其中文学性内容拉偏风格）
    ...(!imitBlock && frameworkExampleBlock ? [{ name: '① 风格参考范例（本次写法基准）', content: frameworkExampleBlock }] : []),
    ...(subTemplateBlock ? [{ name: '①-2 风格子模板（用户选择，优先于框架基础）', content: subTemplateBlock }] : []),
    { name: frameworkExampleBlock ? '② 撰写规范' : '① 撰写规范', key: styleLocked ? undefined : 'writing', content: effectiveSystemBlock },
    { name: '② 品牌事实', key: 'brand',   content: brandBlock },
    ...(referencePriorityBlock ? [{ name: '②-0b 参考范文优先级', content: referencePriorityBlock }] : []),
    ...(bRouteBlock ? [{ name: '②-1 B框架种草重心', content: bRouteBlock }] : []),
    ...(bAngleEngineBlock ? [{ name: '②-2 B框架叙事发动机（本次唯一结构）', content: bAngleEngineBlock }] : []),
    ...(sellingPointBlock ? [{ name: '② 本次主推卖点详情', content: sellingPointBlock }] : []),
    { name: '②-3 本次生成硬约束', content: sellingPointGuardBlock },
    ...(materialBlock ? [{ name: '③ 定向素材（人/场）', content: materialBlock }] : []),
    ...(productBlock    ? [{ name: '④ 动态产品信息', key: 'product', content: productBlock }]    : []),
    ...(imitBlock       ? [{ name: '⑤ 仿写参考范文★',    content: imitBlock }]        : []),
    // 角度/哲学模式下内容由硬编码生成，不可保存；只有无角度（base template 模式）时才挂 key 允许编辑
    ...(frameworkLogicBlock ? [{ name: (angle || isPhilMode) ? '⑥ 框架写作逻辑（角度模式·动态）' : '⑥ 框架写作逻辑（可保存）', key: (angle || isPhilMode) ? undefined : `fw-body-${framework}`, content: frameworkLogicBlock }] : []),
    { name: '⑦ 小红书参考笔记（平台表达辅助）', content: learningBlock },
    { name: '⑨ 语言偏好库（AI句→人手修改，永远参考）', content: languagePreferenceBlock },
    { name: '⑩ 当前任务',    content: taskBlock },
    { name: '⑩-2 自然度自检', content: naturalnessBlock },
    ...(kocToneBlock ? [{ name: '⑩ 语气覆写（KOC）', content: kocToneBlock }] : []),
    { name: '⑪ 输出格式', key: isPhilMode ? 'output-phil' : 'output-single', content: outputBlock },
  ];
  const assembled = assemblePrompt(modules, { mode: 'single-full' });
  return { prompt: assembled.prompt, modules: assembled.modules, stats: assembled.stats };
}

// ─── 批量生产专用 Prompt（简化输出）─────────────────────────────────
function buildBatchPrompt(ctx, direction, sellingPoint, framework, persona = null, scene = null, refArticle = null, spItems = []) {
  const { brand } = CFG;
  const fwLabel = FRAMEWORK_LABELS[framework] || '场景种草型';
  const writingInstructions = loadWritingInstructions();
  const systemBlock = writingInstructions || '## 撰写规范\n（writing-instructions.md 未找到）';
  const brandBlock = loadBrandFacts();

  let materialBlock = '';
  if (persona || scene) {
    const lines = ['## 本次定向素材（依据此定向撰写）\n'];
    if (persona) {
      lines.push(`目标人群：${persona.name}`);
      if (persona.mood) lines.push(`情绪状态：${persona.mood}`);
      if (persona.desc) lines.push(`人群洞察：${persona.desc}`);
    }
    if (scene) {
      lines.push(`场景：${scene.name}`);
      if (scene.mood) lines.push(`情绪分类：${scene.mood}`);
      if (scene.visual) lines.push(`画面方向：${scene.visual}`);
    }
    materialBlock = lines.join('\n');
  }

  const templates = loadTemplates();
  const baseTemplate = (templates[framework] || []).find(t => t.isBase);
  const frameworkBlock = baseTemplate ? `## 框架${framework}写作逻辑\n${baseTemplate.body}` : '';
  const batchExampleBlock = baseTemplate?.example && !refArticle
    ? `## 框架${framework}参考示例（学习节奏和句式，内容必须完全原创）\n\n${baseTemplate.example}`
    : '';

  let learningBatchBlock = '';
  const batchTitleBlock = titleLibraryBlock();
  if (batchTitleBlock) learningBatchBlock += '## 飞书学习材料\n' + batchTitleBlock;
  if (ctx.iterComp && ctx.iterComp.length > 0) {
    learningBatchBlock += `## 飞书学习材料\n### 优先级1·金句修改对比（学习人工修改偏好）\n`;
    ctx.iterComp.slice(-6).forEach((r, i) => {
      if (r.修改前 && r.修改后) {
        learningBatchBlock += `[${i+1}] 修改前：${r.修改前.slice(0, 120)}\n    修改后：${r.修改后.slice(0, 120)}\n`;
        if (r.修改理由) learningBatchBlock += `    原因：${r.修改理由.slice(0, 80)}\n`;
      }
    });
    learningBatchBlock += '\n';
  }
  if (!refArticle && ctx.reference && ctx.reference.length > 0) {
    if (!learningBatchBlock) learningBatchBlock += '## 飞书学习材料\n';
    learningBatchBlock += `### 优先级2·参考图文文案（学习平台原生爆款句式和感官描写）\n`;
    ctx.reference.slice(-8).forEach((r, i) => {
      const title = r.标题 ? `【${r.标题}】` : '';
      const tag = r.标签 ? `（${r.标签}）` : '';
      const preview = (r.文案内容 || '').slice(0, 150);
      learningBatchBlock += `[${i+1}]${title}${tag}\n${preview}\n\n`;
    });
  }

  // 卖点详情
  let batchSpBlock = '';
  if (spItems && spItems.length > 0) {
    const lines = ['## 本次主推卖点（重点围绕以下卖点展开）\n'];
    spItems.forEach((sp, i) => {
      lines.push(`**卖点${i + 1}：${sp.name}**`);
      if (sp.dim)   lines.push(`维度：${sp.dim}`);
      if (sp.angle) lines.push(`角度类型：${sp.angle}`);
      if (sp.desc)  lines.push(`核心描述：${sp.desc}`);
      lines.push('');
    });
    batchSpBlock = lines.join('\n');
  }

  let imitBatchBlock = '';
  if (refArticle) {
    imitBatchBlock = `## ★ 本次首要任务：仿写以下参考范文\n节奏、情绪走向、句式结构以此范文为蓝本，品牌事实和框架逻辑服务于这个结构。内容完全原创。\n\n标题：${refArticle.title || '（无标题）'}\n标签：${refArticle.tag || '（无标签）'}\n\n${(refArticle.content || '')}`;
  }

  const batchTaskFocus = (() => {
    const who = persona?.name ? `目标人群：${persona.name}` : '';
    const where = scene?.name ? `使用场景：${scene.name}` : '';
    const context = [who, where].filter(Boolean).join('；');
    if (framework === 'A') {
      return `主推卖点：${sellingPoint}
批量写法焦点：每条都从具体痛点、顾虑或不适切入，再让产品作为解决方案出现。${context ? `素材只作为痛点背景：${context}。` : ''}不要写成普通生活方式故事。`;
    }
    if (framework === 'B') {
      return context
        ? `批量造梦构思：${context}。${sellingPoint}是这个时刻里自然出现的道具，不是硬广主角。每条换一个生活切面。`
        : `主推卖点：${sellingPoint}。批量写法焦点：围绕不同具体生活时刻展开，让产品自然出现。`;
    }
    if (framework === 'C') {
      return `主推卖点：${sellingPoint}
批量写法焦点：每条用“怀疑/对比/验证/配料或工艺解释”的路径建立可信判断。${context ? `人群和场景只用于设定测试条件：${context}。` : ''}不要写成单纯体验种草故事。`;
    }
    if (framework === 'D') {
      return `主推卖点：${sellingPoint}
批量写法焦点：每条输出可收藏的具体方法、步骤、喝法、搭配或避坑清单。${context ? `人群和场景只用于限定教程适用对象：${context}。` : ''}不要写成情绪化体验故事。`;
    }
    return `主推卖点：${sellingPoint}`;
  })();
  const taskBlock = `## 当前任务\n框架：${framework} · ${fwLabel}\n方向：${direction || '不限'}\n${batchTaskFocus}`;

  const _customFmtBatch = loadOutputFormatBatch();
  const outputBlock = _customFmtBatch || `## 输出格式（严格按此格式，不加任何额外说明或前置语）

### 标题
（含emoji，16字以内）

### 正文
（150-250字，KOC口吻，有具体生活细节，不打广告腔，至少锚定1条品牌事实）

### 话题
（5-8个话题标签，#开头，空格分隔，例如 #微醺 #低度酒 #下班后）`;

  const modules = [
    { name: '① 撰写规范',     key: 'writing',  content: systemBlock },
    { name: '② 品牌事实',     key: 'brand',    content: brandBlock },
    ...(batchSpBlock    ? [{ name: '② 本次主推卖点详情', content: batchSpBlock }]       : []),
    ...(materialBlock    ? [{ name: '③ 定向素材（人/场）', content: materialBlock }]    : []),
    ...(learningBatchBlock ? [{ name: '④ 飞书学习材料',   content: learningBatchBlock }] : []),
    ...(imitBatchBlock   ? [{ name: '⑤ 仿写参考范文★',   content: imitBatchBlock }]    : []),
    ...(frameworkBlock   ? [{ name: '⑥ 框架写作逻辑（基础模板 body）', key: `fw-body-${framework}`, content: frameworkBlock }] : []),
    ...(batchExampleBlock? [{ name: '⑦ 框架参考示例（基础模板 example）', key: `fw-example-${framework}`, content: batchExampleBlock }] : []),
    { name: '⑧ 当前任务',     content: taskBlock },
    { name: '⑨ 输出格式',     key: 'output-batch', content: outputBlock },
  ];
  const assembled = assemblePrompt(modules, { mode: 'batch' });
  return { prompt: assembled.prompt, modules: assembled.modules, stats: assembled.stats };
}

// ─── 解析批量生产输出 ────────────────────────────────────────────────
function parseBatchResult(text) {
  const extract = (label) => {
    const re = new RegExp(`###\\s*${label}\\s*\\n([\\s\\S]*?)(?=\\n###|$)`);
    const m = text.match(re);
    return m ? m[1].trim() : '';
  };
  return {
    title: extract('标题'),
    body:  extract('正文'),
    tags:  extract('话题'),
  };
}

// ─── 解析 Claude 输出（单方案）────────────────────────────────────────
function parsePlan(text) {
  const titleLines = [];
  const titleMatch = text.match(/###\s*备选标题[（(]3[个个][）)]\s*\n([\s\S]*?)(?=\n###|\n---)/);
  if (titleMatch) {
    titleMatch[1].split('\n').forEach(line => {
      const m = line.match(/标题\d+[：:]\s*(.+)/);
      if (m) titleLines.push(m[1].trim());
    });
  }
  const bodyMatch = text.match(/###\s*正文\s*\n([\s\S]*?)(?=\n###|$)/);
  const body = bodyMatch ? bodyMatch[1].trim() : '';
  return { full: text.trim(), titles: titleLines, body };
}

// ─── 发送飞书群消息（cc-connect bot REDACTED）───────────
const https = require('https');
const CC_APP_ID     = process.env.FEISHU_APP_ID     || 'REDACTED';
const CC_APP_SECRET = process.env.FEISHU_APP_SECRET || '';

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendFeishuMessage(content) {
  try {
    const tokenRes = await httpsPost(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      { app_id: CC_APP_ID, app_secret: CC_APP_SECRET }, {}
    );
    if (tokenRes.code !== 0) throw new Error(`get_token: ${JSON.stringify(tokenRes)}`);
    const token = tokenRes.tenant_access_token;
    const msgRes = await httpsPost(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      { receive_id: CFG.feishu.groupId, msg_type: 'text', content: JSON.stringify({ text: content }) },
      { Authorization: `Bearer ${token}` }
    );
    if (msgRes.code !== 0) throw new Error(`send_msg: ${JSON.stringify(msgRes)}`);
    return true;
  } catch (e) {
    console.error('[Feishu Message]', e.message);
    return false;
  }
}

// ─── 写入飞书表（统一实现）────────────────────────────────────────────
function writeToBase(tableId, fields, baseToken = CFG.feishu.baseToken) {
  const tmpName = `_tmp_lark_${Date.now()}.json`;
  const tmpFile = path.join(__dirname, tmpName);
  fs.writeFileSync(tmpFile, JSON.stringify(fields), 'utf8');
  try {
    return larkCli(['base', '+record-upsert', '--base-token', baseToken, '--table-id', tableId, '--json', `@${tmpName}`]);
  } finally { try { fs.unlinkSync(tmpFile); } catch (_) {} }
}

function updateBaseRecord(tableId, recordId, fields, baseToken = CFG.feishu.baseToken) {
  const tmpName = `_tmp_lark_update_${Date.now()}.json`;
  const tmpFile = path.join(__dirname, tmpName);
  fs.writeFileSync(tmpFile, JSON.stringify(fields), 'utf8');
  try {
    return larkCli([
      'base', '+record-upsert',
      '--base-token', baseToken,
      '--table-id', tableId,
      '--record-id', recordId,
      '--json', `@${tmpName}`,
    ]);
  } finally { try { fs.unlinkSync(tmpFile); } catch (_) {} }
}

function clearBaseAttachmentField(recordId, fieldId) {
  if (!recordId || !fieldId) return;
  updateBaseRecord(OUTPUT_TABLE, recordId, { [fieldId]: [] }, OUTPUT_BASE);
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateGeneratedImageFiles(filePaths, queueItems = [], expectedImageCount = filePaths.length) {
  const files = (filePaths || []).map(resolvePoolImage);
  if (files.length !== expectedImageCount) {
    throw new Error(`成品图数量不对：${files.length}/${expectedImageCount}`);
  }
  const seen = new Map();
  const failures = [];
  files.forEach((file, index) => {
    if (!fs.existsSync(file)) {
      failures.push(`第${index + 1}张文件不存在`);
      return;
    }
    const size = fs.statSync(file).size;
    if (size < 30 * 1024) failures.push(`第${index + 1}张文件过小，疑似未成功下载`);
    const hash = fileSha256(file);
    if (seen.has(hash)) failures.push(`第${index + 1}张与第${seen.get(hash) + 1}张完全重复`);
    seen.set(hash, index);
    const item = queueItems[index] || {};
    const qc = item.quality_gate || {};
    if (qc.status && qc.status !== 'pass') {
      failures.push(`第${index + 1}张质检未通过：${qc.reason || qc.status}`);
    }
    if (!qc.status) {
      failures.push(`第${index + 1}张缺少成品图一致性质检结果`);
    }
  });
  if (failures.length) throw new Error(`成品图质检失败：${failures.join('；')}`);
  return files;
}

function cleanupGeneratedImageFiles(files, job = null) {
  for (const file of files || []) {
    try {
      const resolved = resolvePoolImage(file);
      if (/^gpt-replace-/i.test(path.basename(resolved))) fs.unlinkSync(resolved);
    } catch (error) {
      if (job) dailyLog(job, `本地成品图清理跳过：${error.message}`);
    }
  }
}

function stopStaleDirectGptRunners(job = null) {
  if (process.platform !== 'win32') return;
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"",
    "| Where-Object { $_.CommandLine -like '*direct_gpt_queue_runner.js*' }",
    "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 && job) {
    dailyLog(job, `旧 direct GPT runner 清理失败：${String(result.stderr || result.stdout || '').slice(0, 200)}`);
  }
}

function startDirectGptQueueRunner(job, expectedImageCount) {
  const script = path.join(XHS_PUBLISHER_DIR, 'scripts', 'direct_gpt_queue_runner.js');
  if (!fs.existsSync(script)) throw new Error(`direct GPT runner 不存在：${script}`);
  stopStaleDirectGptRunners(job);
  const logDir = path.join(XHS_PUBLISHER_DIR, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const outFile = path.join(logDir, `direct-gpt-auto-${stamp}.out.log`);
  const errFile = path.join(logDir, `direct-gpt-auto-${stamp}.err.log`);
  const out = fs.openSync(outFile, 'a');
  const err = fs.openSync(errFile, 'a');
  const child = spawn(process.execPath, [script, '--limit', String(Math.max(1, Math.min(9, expectedImageCount || 1)))], {
    cwd: XHS_PUBLISHER_DIR,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, err],
    env: {
      ...process.env,
      GPT_CDP: `http://127.0.0.1:${GPT_CDP_PORT}`,
      GPT_COMPANION: `http://127.0.0.1:${GPT_COMPANION_PORT}`,
    },
  });
  child.unref();
  dailyLog(job, `已启动 direct GPT runner：PID ${child.pid}，日志 ${path.basename(outFile)}`);
  return { pid: child.pid, outFile, errFile };
}

function writeOutputRecord(fields) {
  const normalized = {};
  for (const [key, value] of Object.entries(fields || {})) {
    normalized[OUTPUT_FIELDS[key] || key] = value;
  }
  return writeToBase(OUTPUT_TABLE, normalized, OUTPUT_BASE);
}
function writeMatRecord(tableId, fields) { return writeToBase(tableId, fields, MAT_BASE); }
function writeRecord(tableId, fields) { return writeToBase(tableId, fields); }

function extractRecordIdFromWrite(result) {
  return result?.data?.record?.record_id
    || result?.data?.record_id
    || result?.data?.id
    || result?.record_id
    || result?.id
    || '';
}

function findOutputRecordIdByTitle(title) {
  const needle = String(title || '').trim();
  if (!needle) return '';
  const out = larkCli([
    'base', '+record-list',
    '--base-token', OUTPUT_BASE,
    '--table-id', OUTPUT_TABLE,
    '--limit', '100',
    '--format', 'json',
  ]);
  const rows = out.data?.data || [];
  const fields = out.data?.fields || [];
  const ids = out.data?.record_id_list || [];
  const titleIdx = fields.indexOf('标题');
  if (titleIdx < 0) return '';
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]?.[titleIdx] || '').trim() === needle) return ids[i] || '';
  }
  return '';
}

function findOutputRecordIdByReference(referenceUrl) {
  const needle = String(referenceUrl || '').trim();
  if (!needle) return '';
  const out = larkCli([
    'base', '+record-list',
    '--base-token', OUTPUT_BASE,
    '--table-id', OUTPUT_TABLE,
    '--field-id', 'fldYdip12B',
    '--field-id', 'fldNhY7hvG',
    '--limit', '200',
    '--format', 'json',
  ]);
  const rows = out.data?.data || [];
  const fields = out.data?.fields || [];
  const ids = out.data?.record_id_list || [];
  const refIdx = fields.indexOf('参考链接');
  const publishedIdx = fields.indexOf('是否发布');
  if (refIdx < 0) return '';
  const textOf = value => Array.isArray(value) ? value.join(' ') : String(value || '');
  for (let i = rows.length - 1; i >= 0; i--) {
    const ref = textOf(rows[i]?.[refIdx]);
    const published = publishedIdx >= 0 ? textOf(rows[i]?.[publishedIdx]) : '否';
    if (ref.includes(needle) && published !== '是') return ids[i] || '';
  }
  return '';
}

function readOutputRecordBody(recordId) {
  if (!recordId) return '';
  const out = larkCli([
    'base', '+record-get',
    '--base-token', OUTPUT_BASE,
    '--table-id', OUTPUT_TABLE,
    '--record-id', recordId,
    '--field-id', OUTPUT_FIELDS.正文,
    '--format', 'json',
  ]);
  const fields = out.data?.record?.fields || out.data?.fields || {};
  return cellText(fields[OUTPUT_FIELDS.正文] || fields.正文 || '');
}

function readOutputRecordSnapshot(recordId) {
  if (!recordId) return { title: '', body: '', reference: '', images: [] };
  const out = larkCli([
    'base', '+record-get',
    '--base-token', OUTPUT_BASE,
    '--table-id', OUTPUT_TABLE,
    '--record-id', recordId,
    '--field-id', 'fld8r1kMve',
    '--field-id', 'fld7V7kUMc',
    '--field-id', 'fldwBz8ZZm',
    '--field-id', 'fldYdip12B',
    '--format', 'json',
  ]);
  const names = out.data?.fields || [];
  const row = out.data?.data?.[0] || [];
  const value = name => row[names.indexOf(name)];
  return {
    title: String(value('标题') || '').trim(),
    body: String(value('正文') || '').trim(),
    images: Array.isArray(value('图片')) ? value('图片') : [],
    reference: String(value('参考链接') || '').trim(),
  };
}

function uploadBaseAttachments(recordId, fieldId, filePaths, options = {}) {
  const files = (filePaths || []).map(resolveUploadImage);
  if (!recordId) throw new Error('附件上传缺少发布表 recordId');
  if (!fieldId) throw new Error('附件上传缺少飞书图片字段 ID');
  if (!files.length) throw new Error('附件上传没有本地成品图');
  if (options.clearExisting !== false) clearBaseAttachmentField(recordId, fieldId);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-hub-base-attach-'));
  try {
    const args = [
      'base', '+record-upload-attachment',
      '--base-token', OUTPUT_BASE,
      '--table-id', OUTPUT_TABLE,
      '--record-id', recordId,
      '--field-id', fieldId,
      '--format', 'json',
    ];
    files.forEach((src, i) => {
      const safeName = `publish-image-${String(i + 1).padStart(2, '0')}${path.extname(src).toLowerCase() || '.jpg'}`;
      fs.copyFileSync(src, path.join(tmpDir, safeName));
      args.push('--file', safeName);
    });
    const out = larkCli(args, { cwd: tmpDir });
    return { count: files.length, files: out?.data || out };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function waitForOutputImages(recordId, expectedImageCount, timeoutMs = 90000) {
  const startedAt = Date.now();
  let last = readOutputRecordSnapshot(recordId);
  while (Date.now() - startedAt < timeoutMs) {
    last = readOutputRecordSnapshot(recordId);
    if ((last.images || []).length >= expectedImageCount) return last;
    await waitMs(3000);
  }
  throw new Error(`飞书附件上传未完成：图片=${(last.images || []).length}/${expectedImageCount}`);
}

const WORK_BASE = process.env.WORK_BASE_TOKEN || '';
const WORK_TABLES = {
  tasks: { id: 'tblYrOGqZbPv18eF', name: '统一任务池' },
  reports: { id: 'tblpB7KAgqRl9XJ1', name: '每日工作汇报-剪辑运营助理' },
  notices: { id: 'tblrX2U0VPi4OZrp', name: '临时通知栏' },
};

function workWrite(tableId, fields, recordId = null) {
  const tmpName = `_tmp_work_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`;
  const tmpFile = path.join(__dirname, tmpName);
  fs.writeFileSync(tmpFile, JSON.stringify(fields), 'utf8');
  try {
    const args = ['base', '+record-upsert', '--base-token', WORK_BASE, '--table-id', tableId];
    if (recordId) args.push('--record-id', recordId);
    args.push('--json', `@${tmpName}`);
    return larkCli(args);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

function workList(tableId, limit = 200) {
  const items = [];
  let offset = 0;
  while (true) {
    const res = larkCli([
      'base', '+record-list',
      '--base-token', WORK_BASE,
      '--table-id', tableId,
      '--limit', String(limit),
      '--offset', String(offset),
      '--format', 'json',
      '--as', 'user',
    ]);
    if (!res.ok) break;
    const data = res.data || {};
    const rows = data.items || data.data || [];
    if (Array.isArray(data.items)) {
      for (const row of data.items) {
        items.push({ id: row.record_id || row.id || '', fields: row.fields || {} });
      }
    } else {
      const fields = data.fields || [];
      const ids = data.record_id_list || [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];
        const obj = {};
        fields.forEach((name, idx) => { obj[name] = row[idx]; });
        items.push({ id: ids[i] || '', fields: obj });
      }
    }
    if (!data.has_more) break;
    offset += limit;
  }
  return items;
}

function cleanText(v) {
  if (Array.isArray(v)) return v.map(cleanText).filter(Boolean).join(', ');
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.record_id) return String(v.record_id);
    if (v.id) return String(v.id);
    if (v.full_address) return String(v.full_address);
    if (v.name) return String(v.name);
    return JSON.stringify(v);
  }
  return String(v);
}

function toOptionName(v) {
  if (!v) return '';
  if (Array.isArray(v)) return v.map(toOptionName).filter(Boolean).join(', ');
  if (typeof v === 'object') return v.name || v.text || v.value || v.id || '';
  return String(v);
}

function linkIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(v => {
      if (typeof v === 'string') return { id: v };
      if (v && typeof v === 'object' && v.id) return { id: v.id };
      return null;
    }).filter(Boolean);
  }
  if (typeof value === 'object' && value.id) return [{ id: value.id }];
  return [];
}

// ─── Claude 异步调用（用于批量/竞品分析，不阻塞事件循环）─────────────
function runCodexAsync(prompt, timeoutMs = 420000) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const outputFile = path.join(require('os').tmpdir(), `market-hub-codex-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    const codexBin = path.join(process.env.APPDATA || '', 'npm', 'codex.cmd');
    const child = spawn(codexBin, ['exec', '--skip-git-repo-check', '-o', outputFile], {
      shell: true, cwd: __dirname, env: process.env, windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.stdin.write(prompt, 'utf8');
    child.stdin.end();
    const timer = setTimeout(() => {
      try { require('child_process').spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { shell: true, detached: true }).unref(); } catch (_) {}
      reject(new Error(`Codex generation timeout (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      let text = '';
      try { text = fs.readFileSync(outputFile, 'utf8').trim(); fs.unlinkSync(outputFile); } catch (_) {}
      if (!text) return reject(new Error(stderr.trim().slice(-500) || `codex exit ${code}`));
      resolve(text);
    });
  });
}

function runClaudeAsync(prompt, timeoutMs = 90000) {
  const provider = (process.env.MARKET_HUB_TEXT_PROVIDER || 'gpt-plus').toLowerCase();
  if (provider === 'codex') {
    return runCodexAsync(prompt, timeoutMs);
  }
  if (provider !== 'claude') {
    return (async () => {
      try {
        await ensureGptImageProfile(null, GPT_IMAGE_ACCOUNT);
        await assertGptImageProfileLoggedIn(null, GPT_IMAGE_ACCOUNT);
      } catch (e) {
        throw new Error(`GPT Plus 文案引擎未能打开：${e.message}`);
      }
      let cdpReady = false;
      for (let attempt = 0; attempt < 35; attempt++) {
        try {
          await getLocalJson(`http://127.0.0.1:${GPT_CDP_PORT}/json/version`, 1500);
          cdpReady = true;
          break;
        } catch {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      if (!cdpReady) throw new Error('GPT Profile 已启动，但浏览器在 35 秒内没有准备好');
      const data = await postLocalJson(`http://127.0.0.1:${GPT_COMPANION_PORT}/gpt_text`, {
        prompt,
        timeout: Math.ceil(Math.max(timeoutMs, 90000) / 1000),
      }, Math.max(timeoutMs + 60000, 180000));
      if (!data.ok || !data.text) throw new Error(data.error || 'GPT Plus 文案引擎没有返回文本');
      return data.text;
    })();
  }
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const npmBin = path.join(process.env.APPDATA || '', 'npm');
    const child = spawn('claude', ['-p', '--dangerously-skip-permissions'], {
      shell: true,
      env: {
        ...process.env,
        PATH: `${npmBin};${process.env.PATH || ''}`,
        CLAUDE_CODE_GIT_BASH_PATH: 'D:\\nodes\\Git\\usr\\bin\\bash.exe',
      },
    });
    let stdout = '', stderr = '';
    child.stdin.write(prompt, 'utf8');
    child.stdin.end();
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      // child.kill() on Windows only kills cmd.exe shell and orphans the real claude.exe;
      // taskkill /T walks the full process tree from child.pid, cleaning up everything.
      try { require('child_process').spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { shell: true, detached: true }).unref(); } catch (_) {}
      const secs = Math.round(timeoutMs / 1000);
      reject(new Error(`claude 超时（>${secs}s），可能是网络问题或 claude CLI 卡住，请稍后重试`));
    }, timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      const text = stdout.trim();
      if (!text || /not logged in|invalid api key|please run \/login/i.test(text)) return reject(new Error('Claude CLI 未登录或无输出'));
      resolve(text);
    });
    child.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ═══════════════════════════════════════════════════════════════════
// API 路由
// ═══════════════════════════════════════════════════════════════════

function runTopicCollector() {
  return new Promise((resolve, reject) => {
    const child = spawn('python', [TOPIC_PIPELINE_PATH], {
      cwd: __dirname,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('选题信号采集超过 10 分钟'));
    }, 600000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim() || stdout.trim() || `collector exit ${code}`));
      try { resolve(JSON.parse(stdout.trim())); }
      catch { resolve({ ok: true }); }
    });
  });
}

function loadTopicJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function compactTopicSignals(signals) {
  const note = row => ({
    id: row.id || '',
    type: row.type || '',
    title: row.title,
    keyword: row.keyword || '',
    source: row.source || '',
    likes: row.likes || 0,
    collects: row.collects || 0,
    comments: row.comments || 0,
    cover: row.cover || '',
    url: row.url || '',
  });
  return {
    generatedAt: signals.generatedAt,
    skills: signals.skills,
    seeds: signals.seeds || signals.config?.seeds || [],
    hotQueries: (signals.hotQueries || []).slice(0, 30),
    homeFeed: (signals.homeFeed || []).slice(0, 15).map(note),
    searchNotes: (signals.searchNotes || []).slice(0, 35).map(note),
    topics: (signals.topics || []).slice(0, 25),
    crossPlatform: (signals.crossPlatform || []).slice(0, 35),
    errors: signals.errors || [],
  };
}

function buildTopicDigestPrompt(signals) {
  const insight = selectedMarketInsight();
  return `你是每天烈刻气泡白酒的选题编辑。下面是三套方法合并后的真实信号：
1. xiaohongshu-ops：首页推荐流里的高互动表达与视觉形式；
2. xhs-content-plan：酒饮相关关键词按热门/最新检索得到的笔记、搜索联想与话题；
3. inkroam-topic-expert：跨平台热点，并按热度、相关性、时效性、可写性、差异化判断。

品牌任务：卖气泡白酒，兼顾强销售转化与场景种草。产品事实由后续 Market Hub 品牌事实模块提供，本步骤不得编造功效、价格、原料、度数或销量。

本次市场洞察（热点必须服务这条洞察）：
${JSON.stringify(insight || {}, null, 2)}

生成 3-5 张“今日选题卡”。每张卡包含：
- trafficKeyword：平台已有的大流量词，只负责被找到；
- searchTerms：本次正文必须布局的核心搜索词与长尾词，优先取市场洞察；
- coreConcept：本篇自己建立的记忆概念，负责被记住。优先 6-14 个字，把产品功效翻译成一种让人想进入的身份、状态或场景；禁止写成“气泡白酒的XX”“XX气泡白酒”这类产品说明，也不能只是品牌口号；
- bridge：流量词与气泡白酒的自然关联；
- framework：A/B/C/D 之一，不改变既有框架定义；
- intervention：仅标签 / 标题与标签 / 标题开头与标签 / 整篇语境；
- direction：带入撰写台“补充方向”的一句操作指令；
- rationale：为什么今天值得测试，必须引用信号，不得声称没有时间序列支持的上涨百分比；
- visual：首图/图组建议，至少保留一张真实产品锚点图；
- evidence：1-3 条真实证据，复制 title/source/likes/cover/url，不得虚构；优先选择带可读取 url 的具体笔记；
- evidence：1-3 条真实证据，复制 title/source/likes/cover/url，不得虚构；优先选择 type=normal、带可读取 url、正文可用于改写的图文笔记，视频只能作为趋势证据，不得排在图文仿写候选第一位；
- evidence 第 1 条就是后续仿写母本：标题与 keyword 必须直接命中本卡的具体生活场景/用户问题；相关性高于点赞量。泛酒单、泛果酒推荐、聚会内容不能替代“下班独处小酌”，除非卡片本身就是这些主题。
- sources：实际贡献到该卡的 skill 名称数组；
- score：0-100；kind：行业需求 / 平台表达 / 跨界热点。

流量大词不能压过 coreConcept。coreConcept 要像一个用户愿意复述、搜索或拿来形容自己的新说法，而不是品类词换序。跨界热点关联弱时宁可不选。输出严格 JSON，不要 Markdown：
{"generatedAt":"...","recommendations":[{"id":"topic-1","kind":"行业需求","trafficKeyword":"","searchTerms":[""],"coreConcept":"","bridge":"","framework":"B","intervention":"标题开头与标签","direction":"","rationale":"","visual":"","score":82,"sources":["xhs-content-plan"],"evidence":[{"title":"","source":"","likes":0,"cover":"","url":""}]}]}

真实信号：
${JSON.stringify(compactTopicSignals(signals), null, 2)}`;
}

function parseTopicDigest(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('选题整理未返回 JSON');
  let jsonText = match[0];
  let inString = false;
  let escaped = false;
  let repaired = '';
  for (const ch of jsonText) {
    if (inString && ch.charCodeAt(0) < 0x20) {
      repaired += ' ';
      continue;
    }
    repaired += ch;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') inString = !inString;
  }
  const parsed = JSON.parse(repaired);
  if (!Array.isArray(parsed.recommendations)) throw new Error('选题整理缺少 recommendations');
  parsed.recommendations = parsed.recommendations.slice(0, 5).map((item, index) => ({
    ...item,
    id: item.id || `topic-${Date.now()}-${index}`,
    score: Math.max(0, Math.min(100, Number(item.score) || 0)),
    sources: Array.isArray(item.sources) ? item.sources : [],
    evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 3) : [],
  }));
  return parsed;
}

app.get('/api/insights', (req, res) => {
  res.json({ ok: true, ...loadMarketInsights(), tableId: MARKET_INSIGHT_TABLE });
});

app.post('/api/insights/preview-prompt', async (req, res) => {
  try {
    const manualBehavior = req.body?.manualBehavior ?? loadMarketInsights().manualBehavior ?? '';
    let signals = loadTopicJson(TOPIC_SIGNALS_PATH, null);
    if (!signals || signals.error) throw new Error(signals?.error || '没有可用搜索信号');
    const saved = loadMarketInsights();
    const prompt = buildMarketInsightPrompt(signals, manualBehavior, saved.lastSeedPlan || null, saved.lastValidation || []);
    res.json({
      ok: true,
      prompt,
      seedPrompt: buildMarketInsightSeedPrompt(manualBehavior),
      signals: compactInsightSignals(signals),
      seedPlan: saved.lastSeedPlan || null,
      validation: saved.lastValidation || usefulSearchEvidence(signals, saved.lastSeedPlan || null),
      manualBehavior,
    });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.post('/api/insights/refresh', async (req, res) => {
  if (insightRefreshRunning) return res.json({ ok: false, error: '市场洞察正在生成，请稍后查看' });
  insightRefreshRunning = true;
  try {
    const manualBehavior = String(req.body?.manualBehavior ?? loadMarketInsights().manualBehavior ?? '');
    const collected = await collectSignalsForMarketInsight(manualBehavior, { forceCollect: req.body?.forceCollect === true });
    const signals = collected.signals;
    const prompt = buildMarketInsightPrompt(signals, manualBehavior, collected.seedPlan, collected.validation);
    const raw = await runClaudeAsync(prompt, 300000);
    const parsed = parseMarketInsights(raw);
    const state = saveMarketInsights({
      ...parsed,
      selectedId: '',
      manualBehavior,
      lastPrompt: prompt,
      lastSeedPrompt: collected.seedPrompt,
      lastSeedPlan: collected.seedPlan,
      lastValidation: collected.validation,
      usefulSeeds: collected.usefulSeeds,
      lastSignals: compactInsightSignals(signals),
    });
    res.json({ ok: true, ...state, tableId: MARKET_INSIGHT_TABLE });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  } finally {
    insightRefreshRunning = false;
  }
});

app.post('/api/insights/select', (req, res) => {
  try {
    const result = selectMarketInsight(String(req.body?.id || '').trim());
    res.json({ ok: true, ...result.state, selected: result.insight, tableId: MARKET_INSIGHT_TABLE });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.get('/api/topics', (req, res) => {
  const data = loadTopicJson(TOPIC_RECOMMENDATIONS_PATH, { generatedAt: null, recommendations: [] });
  const signals = loadTopicJson(TOPIC_SIGNALS_PATH, null);
  res.json({
    ok: true,
    ...data,
    config: loadTopicConfig(),
    signalGeneratedAt: signals?.generatedAt || null,
    skillStatus: signals?.skills || null,
    signalErrors: signals?.errors || [],
    marketInsight: selectedMarketInsight(),
  });
});

app.get('/api/topics/config', (req, res) => {
  res.json({ ok: true, config: loadTopicConfig() });
});

app.post('/api/topics/config', (req, res) => {
  try {
    const body = req.body || {};
    const current = loadTopicConfig();
    const seeds = Array.isArray(body.seeds)
      ? [...new Set(body.seeds.map(v => String(v || '').trim()).filter(Boolean))].slice(0, 20)
      : current.seeds;
    const sources = body.sources && typeof body.sources === 'object'
      ? Object.fromEntries(Object.entries(current.sources).map(([key, val]) => [key, key in body.sources ? !!body.sources[key] : val]))
      : current.sources;
    const config = {
      cacheHours: Math.max(0.25, Math.min(Number(body.cacheHours) || current.cacheHours, 24)),
      seeds: seeds.length ? seeds : current.seeds,
      sources,
    };
    saveTopicConfig(config);
    res.json({ ok: true, config });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/topics/refresh', async (req, res) => {
  if (topicRefreshRunning) return res.json({ ok: false, error: '今日选题正在刷新，请稍后查看' });
  topicRefreshRunning = true;
  try {
    const config = loadTopicConfig();
    let signals = loadTopicJson(TOPIC_SIGNALS_PATH);
    const age = signals?.generatedAt ? Date.now() - new Date(signals.generatedAt).getTime() : Infinity;
    if (!signals || age > config.cacheHours * 60 * 60 * 1000 || req.body?.forceCollect === true) {
      await runTopicCollector();
      signals = loadTopicJson(TOPIC_SIGNALS_PATH);
    }
    if (!signals) throw new Error('采集完成但没有生成 topic-signals.json');
    const raw = await runClaudeAsync(buildTopicDigestPrompt(signals), 300000);
    const digest = parseTopicDigest(raw);
    digest.generatedAt = new Date().toISOString();
    fs.writeFileSync(TOPIC_RECOMMENDATIONS_PATH, JSON.stringify(digest, null, 2), 'utf8');
    res.json({ ok: true, ...digest, config, signalGeneratedAt: signals.generatedAt || null, skillStatus: signals.skills, signalErrors: signals.errors || [] });
  } catch (e) {
    console.error('[topics/refresh]', e.message);
    res.json({ ok: false, error: e.message });
  } finally {
    topicRefreshRunning = false;
  }
});

// 生成文案
app.post('/api/generate', async (req, res) => {
  try {
    const { framework = 'B', direction, sellingPoint, spItems = [], subTemplate = null, persona: reqPersona = null, scene: reqScene = null, refArticle = null, rawPrompt = null, angle: reqAngle = null, toneStyle = 'narrative', bRoute = 'product', topicSignal = null } = req.body;
    if (!sellingPoint && !rawPrompt) return res.json({ ok: false, error: '请选择或填写主推卖点' });

    let prompt;
    let ctx = { iterComp: [], reference: [] };
    let usedAngle = reqAngle;
    let autoPersona = null, autoScene = null;
    let persona = reqPersona, scene = reqScene;

    if (rawPrompt) {
      prompt = rawPrompt;
      lastPromptSnapshot = {
        at: new Date().toISOString(),
        mode: 'raw',
        framework,
        sellingPoint: sellingPoint || null,
        bRoute,
        usedAngle: null,
        inputs: { direction: direction || '', toneStyle, subTemplate: null, persona: null, scene: null, refArticle: null },
        modules: [],
        promptChars: prompt.length,
        prompt,
      };
    } else {
      try { ctx = await fetchFeishuContext(); }
      catch (e) { console.error('[Context fetch]', e.message); }

      // 切入方式：只使用客户端显式传入的角度。
      // 服务器自动轮转会覆盖框架/子模板的参考示例，导致模板模仿不稳定。
      if (!usedAngle) usedAngle = null;

      // 用户没选人群/场景时不要自动补齐。
      // 之前这里会随机注入人群和场景，导致“只选卖点”的生成结果被其他维度污染。
      // 当前策略：只使用用户显式选择的素材维度；需要扩展时由用户主动选择。

      const built = buildPrompt(ctx, direction, sellingPoint, framework, subTemplate, persona, scene, refArticle, spItems, usedAngle, toneStyle, bRoute, topicSignal);
      prompt = built.prompt;
      lastPromptSnapshot = {
        at: new Date().toISOString(),
        mode: 'single',
        framework,
        sellingPoint,
        bRoute,
        usedAngle: usedAngle ? { id: usedAngle.id || null, name: usedAngle.name || null, desc: usedAngle.desc || null } : null,
        inputs: {
          direction: direction || '',
          toneStyle,
          subTemplate: subTemplate?.name || null,
          persona: persona?.name || null,
          scene: scene?.name || null,
          refArticle: refArticle?.title || refArticle?.name || null,
          topicSignal: topicSignal?.coreConcept || topicSignal?.title || null,
        },
        modules: summarizeModules(built.modules || []).modules,
        promptChars: prompt.length,
        contextHarness: built.stats || summarizeModules(built.modules || []),
        prompt,
      };
    }

    const rawText = await runClaudeAsync(prompt, 420000);
    const plan = parsePlan(rawText);
    try {
      writePromptRunSnapshot(PROMPT_RUNS_PATH, {
        ...lastPromptSnapshot,
        outputChars: rawText.length,
        output: plan.full || rawText,
      });
    } catch (e) {
      console.warn('[PromptRun snapshot]', e.message);
    }

    // 生成成功后推进切入方式轮转
    if (!rawPrompt) advanceAngle(framework);

    const fullText = plan.full;
    const cutAt = fullText.search(/###\s*(优化方向)/);
    const sendContent = cutAt > 0 ? fullText.slice(0, cutAt).trim() : fullText;
    const fwLabel = FRAMEWORK_LABELS[framework] || framework;
    const angleNote = usedAngle ? ` · ${usedAngle.name}` : '';
    const msg = `【每天烈刻 · 小红书文案】框架${framework} · ${fwLabel}${angleNote}\n方向：${direction}　卖点：${sellingPoint}\n\n${sendContent}`;
    sendFeishuMessage(msg).catch(e => console.error('[Feishu Message]', e.message));

    res.json({
      ok: true,
      main: plan,
      usedAngle,
      autoPersona,
      autoScene,
      nextAngle: getCurrentAngle(framework),
      contextStats: {
        iterComp: ctx.iterComp.length,
        reference: ctx.reference.length,
        promptChars: prompt.length,
        modules: lastPromptSnapshot?.modules || [],
      },
    });

  } catch (e) {
    console.error('[Generate]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ─── 提示词预览（不真正生成，只返回完整 prompt 和模块列表）────────────
app.get('/api/last-prompt', (req, res) => {
  if (!lastPromptSnapshot) {
    return res.json({ ok: false, error: '还没有生成过内容，暂无真实 prompt 快照' });
  }
  res.json({ ok: true, ...lastPromptSnapshot });
});

app.post('/api/preview-prompt', async (req, res) => {
  try {
    const { framework = 'B', direction = '', sellingPoint = '（预览）', spItems = [], subTemplate = null, persona = null, scene = null, refArticle = null, mode = 'single', angle = null, toneStyle = 'narrative', bRoute = 'product', topicSignal = null } = req.body;
    let ctx;
    try { ctx = await fetchFeishuContext(); } catch { ctx = { iterComp: [], reference: [] }; }
    const result = mode === 'batch'
      ? buildBatchPrompt(ctx, direction, sellingPoint, framework, persona, scene, refArticle, spItems)
      : buildPrompt(ctx, direction, sellingPoint, framework, subTemplate, persona, scene, refArticle, spItems, angle, toneStyle, bRoute, topicSignal);
    const titleCount = (() => { try { return loadTitleLibrary().length; } catch { return 0; } })();
    res.json({
      ok: true,
      prompt: result.prompt,
      modules: result.modules,
      contextStats: {
        iterComp: ctx.iterComp.length,
        reference: ctx.reference.length,
        titles: titleCount,
        promptChars: result.prompt.length,
        harness: result.stats || summarizeModules(result.modules || []),
      },
      inputs: { framework, direction, sellingPoint, bRoute, angle: angle?.name || null, topicSignal: topicSignal?.coreConcept || null, subTemplate: subTemplate?.name || null, persona: persona?.name || null, scene: scene?.name || null, refArticle: refArticle?.title || refArticle?.name || null },
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 修改对比归档（手动选片段归档到特征工程-金句修改对比）
app.post('/api/archive-comparison', (req, res) => {
  try {
    const { aiText, humanText, reason } = req.body;
    if (!aiText || !humanText) return res.json({ ok: false, error: 'AI创作和人手修改不能为空' });
    writeRecord(CFG.feishu.tables.iterComp.id, {
      [CFG.feishu.tables.iterComp.fields.修改前.name]: aiText,
      [CFG.feishu.tables.iterComp.fields.修改后.name]: humanText,
      [CFG.feishu.tables.iterComp.fields.修改理由.name]: reason || '（未填写修改理由）',
    });
    state.contextCacheTime = 0;
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 撰写台一键保存到小红书发布表
app.get('/api/image-pool/config', (req, res) => {
  try {
    res.json({ ok: true, dir: ensureImagePool() });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/image-pool/config', (req, res) => {
  try {
    const dir = saveImagePoolDir(req.body?.dir);
    res.json({ ok: true, dir });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/image-pool/open', (req, res) => {
  try {
    const dir = ensureImagePool();
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    res.json({ ok: true, dir });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/image-pool/list', (req, res) => {
  try {
    const files = listImagePoolFiles().slice(0, 120).map(f => ({
      ...f,
      url: `/api/image-pool/file?path=${encodeURIComponent(f.path)}`,
    }));
    res.json({ ok: true, dir: ensureImagePool(), files });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/image-pool/file', (req, res) => {
  try {
    const file = resolvePoolImage(req.query.path);
    res.sendFile(file);
  } catch (e) {
    res.status(404).send(e.message);
  }
});

app.get('/api/feishu-result-images/list', (req, res) => {
  try {
    const state = readFeishuResultImageState();
    const files = state.files.slice(0, 120).map(f => ({
      ...f,
      url: `/api/feishu-result-images/file?recordId=${encodeURIComponent(f.recordId)}&fileToken=${encodeURIComponent(f.fileToken)}`,
    }));
    res.json({ ok: true, files, totalRecords: state.totalRecords, satisfiedRows: state.satisfiedRows, replacedRows: state.replacedRows, hasMore: state.hasMore });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/feishu-result-images/file', (req, res) => {
  try {
    const file = downloadFeishuResultImage(String(req.query.recordId || ''), String(req.query.fileToken || ''));
    res.sendFile(file);
  } catch (e) {
    res.status(404).send(e.message);
  }
});

app.post('/api/save-to-publish', (req, res) => {
  try {
    const { title, body, tags = '', imagePaths = [], publishAccount = '' } = req.body;
    if (!body || !body.trim()) return res.json({ ok: false, error: '正文不能为空' });
    const fields = {
      '标题':    title  || '',
      '正文':    body.trim(),
      '是否发布': '待发布',
      '发布计划': '自动生成',
    };
    if (publishAccount) fields['发布账号'] = String(publishAccount).slice(0, 120);
    if (tags) fields['话题'] = sanitizeDailyTagString(tags).slice(0, 240);

    const selectedImages = Array.isArray(imagePaths) ? imagePaths.slice(0, 9) : [];
    const localImages = selectedImages.map(x => downloadFeishuResultImageRef(x) || x);

    const written = writeOutputRecord(fields);
    const recordId = extractRecordIdFromWrite(written) || findOutputRecordIdByTitle(title || '');
    if (localImages.length) {
      if (!recordId) throw new Error('已写入发布表，但未拿到 record_id，无法上传本地图片');
      uploadBaseAttachments(recordId, OUTPUT_FIELDS.图片, localImages);
    }
    res.json({ ok: true, recordId, imageCount: selectedImages.length });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/output/update-tags', (req, res) => {
  try {
    const recordId = String(req.body?.recordId || '').trim();
    const tags = sanitizeDailyTagString(req.body?.tags || '');
    if (!recordId) throw new Error('缺少发布表 recordId');
    updateBaseRecord(OUTPUT_TABLE, recordId, { [OUTPUT_FIELDS.话题]: tags }, OUTPUT_BASE);
    res.json({ ok: true, recordId, tags });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 覆盖矩阵：场×货 与发布记录交叉
app.get('/api/matrix', (req, res) => {
  try {
    const materials = fetchMaterials();
    const pubRes = larkCli(['base', '+record-list', '--base-token', OUTPUT_BASE, '--table-id', OUTPUT_TABLE, '--limit', '200', '--format', 'json']);
    const pubRecs = pubRes.data.data || [];
    const pubFids = pubRes.data.field_id_list || [];
    const pubIdx  = {};
    pubFids.forEach((fid, i) => { pubIdx[fid] = i; });

    const published = pubRecs.map(r => ({
      scene:     extractField(r, pubIdx, { id: OUTPUT_FIELDS.场景名称 }),
      angle:     extractField(r, pubIdx, { id: OUTPUT_FIELDS.货角度 }),
      framework: extractField(r, pubIdx, { id: OUTPUT_FIELDS.框架类型 }),
      收藏:      Number(extractField(r, pubIdx, { id: OUTPUT_FIELDS.收藏数 })) || 0,
      点赞:      Number(extractField(r, pubIdx, { id: OUTPUT_FIELDS.点赞数 })) || 0,
      评论:      Number(extractField(r, pubIdx, { id: OUTPUT_FIELDS.评论数 })) || 0,
      结论:      extractField(r, pubIdx, { id: OUTPUT_FIELDS.测试结论 }),
      link:      extractField(r, pubIdx, { id: OUTPUT_FIELDS.发布链接 }),
      title:     extractField(r, pubIdx, { id: OUTPUT_FIELDS.标题 }),
    })).filter(r => r.scene || r.angle);

    res.json({ ok: true, scenes: materials.场, angles: materials.货, published });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 参考笔记列表（供竞品研究台拉取）
app.get('/api/references/list', (req, res) => {
  try {
    const refCfg = CFG.feishu.tables.reference;
    const { records, idxMap, recordIds } = readTable(refCfg);
    const all = records.map((r, i) => ({
      id:      recordIds[i],
      title:   extractField(r, idxMap, refCfg.fields.标题),
      tag:     extractField(r, idxMap, refCfg.fields.标签),
      brand:   extractField(r, idxMap, refCfg.fields.品牌),
      preview: (extractField(r, idxMap, refCfg.fields.文案内容) || '').slice(0, 80),
      full:    extractField(r, idxMap, refCfg.fields.文案内容) || '',
    })).filter(r => r.brand === refCfg.filterBrand);
    const selectedIds = loadSelectedRefIds();
    res.json({ ok: true, references: all, selectedIds });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 竞品分析结果存入场表
app.post('/api/materials/save-scene', (req, res) => {
  try {
    const { name, mood, visual, guide, srcNote } = req.body;
    if (!name) return res.json({ ok: false, error: '场景名称不能为空' });
    const f = MATERIALS_CFG.场.fields;
    const fields = { [MATERIALS_CFG.场.fieldNames.name]: name };
    if (mood)    fields[MATERIALS_CFG.场.fieldNames.mood]    = mood;
    if (visual)  fields[MATERIALS_CFG.场.fieldNames.visual]  = visual;
    if (guide)   fields[MATERIALS_CFG.场.fieldNames.guide]   = guide;
    if (srcNote) fields[MATERIALS_CFG.场.fieldNames.srcNote] = srcNote;
    writeMatRecord(MATERIALS_CFG.场.tableId, fields);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 竞品分析结果存入货表
app.post('/api/materials/save-angle', (req, res) => {
  try {
    const { name, dim, angle, desc } = req.body;
    if (!name) return res.json({ ok: false, error: '卖点简称不能为空' });
    const fields = {
      [MATERIALS_CFG.货.fieldNames.name]:  name,
      [MATERIALS_CFG.货.fieldNames.src]:   '竞品提炼',
    };
    if (dim)   fields[MATERIALS_CFG.货.fieldNames.dim]   = dim;
    if (angle) fields[MATERIALS_CFG.货.fieldNames.angle] = angle;
    if (desc)  fields[MATERIALS_CFG.货.fieldNames.desc]  = desc;
    writeMatRecord(MATERIALS_CFG.货.tableId, fields);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── 标题灵感库 ───────────────────────────────────────────────────
app.get('/api/titles', (req, res) => {
  res.json({ ok: true, titles: loadTitleLibrary(), hooks: TITLE_HOOKS });
});

app.post('/api/titles/add', (req, res) => {
  try {
    const { title, hook, note, source } = req.body;
    if (!title || !title.trim()) return res.json({ ok: false, error: '标题不能为空' });
    const result = writeToBase(TITLE_TABLE, {
      '标题': title.trim(),
      '钩子类型': hook || '未分类',
      '备注': note || '',
      '来源': source || 'manual',
      '日期': new Date().toISOString().slice(0, 10),
    }, OUTPUT_BASE);
    invalidateTitleCache();
    const id = result?.data?.record?.record_id_list?.[0] || '';
    res.json({ ok: true, id });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.delete('/api/titles/:id', (req, res) => {
  try {
    larkCli(['base', '+record-delete', '--base-token', OUTPUT_BASE, '--table-id', TITLE_TABLE, '--record-id', req.params.id, '--yes']);
    invalidateTitleCache();
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// 读取撰写指令
app.get('/api/writing-prompt', (req, res) => {
  try {
    const content = fs.readFileSync(path.join(__dirname, 'writing-instructions.md'), 'utf8');
    res.json({ ok: true, content });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 保存撰写指令
app.post('/api/writing-prompt', (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string' || !content.trim()) return res.json({ ok: false, error: '内容不能为空' });
    const p = path.join(__dirname, 'writing-instructions.md');
    fs.writeFileSync(p, content, 'utf8');
    invalidateFile(p);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 清除上下文缓存
app.post('/api/clear-cache', (req, res) => {
  state.contextCache = null;
  state.contextCacheTime = 0;
  res.json({ ok: true });
});

// ─── 基础模板编辑（覆盖写入磁盘）────────────────────────────────────
app.post('/api/base-template', (req, res) => {
  try {
    const { fw, body, example } = req.body;
    if (!['A','B','C','D'].includes(fw)) return res.json({ ok: false, error: '无效框架' });
    const overrides = loadBaseOverrides();
    const current = (typeof overrides[fw] === 'object' && overrides[fw]) ? overrides[fw] : {};
    if (body !== undefined) {
      if (!body.trim()) return res.json({ ok: false, error: '写作逻辑不能为空' });
      current.body = body.trim();
    }
    if (example !== undefined) current.example = example.trim();
    overrides[fw] = current;
    saveBaseOverrides(overrides);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── 参考注入选择（持久化选定 ID）────────────────────────────────────
const SELECTED_REFS_PATH = path.join(__dirname, 'selected-refs.json');

function loadSelectedRefIds() {
  try { return JSON.parse(fs.readFileSync(SELECTED_REFS_PATH, 'utf8')); }
  catch (e) { return []; }
}

app.get('/api/references/selected', (req, res) => {
  res.json({ ok: true, ids: loadSelectedRefIds() });
});

app.post('/api/references/select', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.json({ ok: false, error: 'ids 必须为数组' });
    fs.writeFileSync(SELECTED_REFS_PATH, JSON.stringify(ids), 'utf8');
    state.contextCacheTime = 0; // 强制下次刷新 context
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── 批量生成 ──────────────────────────────────────────────────────
const dailyRunStore = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;
const MARKET_INSIGHT_TTL_MS = 7 * DAY_MS;
const TOPIC_DIGEST_TTL_MS = 3 * DAY_MS;

function dailyLog(job, message) {
  job.logs.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`);
  if (job.logs.length > 100) job.logs.splice(0, job.logs.length - 100);
}

function parseTimeMs(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function isFreshTimestamp(value, ttlMs) {
  const time = parseTimeMs(value);
  return !!time && Date.now() - time < ttlMs;
}

function pickMarketInsightForRun({ forceInsight = false } = {}) {
  const state = loadMarketInsights();
  if (forceInsight || !isFreshTimestamp(state.generatedAt, MARKET_INSIGHT_TTL_MS) || !Array.isArray(state.insights) || !state.insights.length) {
    return { insight: null, state, needsRefresh: true, reason: forceInsight ? '手动强制刷新' : '库存为空或已超过 7 天' };
  }
  const candidates = [...state.insights].filter(item => item.coreSearchTerm);
  const unused = candidates.filter(item => !item.usedAt);
  const pool = unused.length ? unused : candidates;
  const picked = [...pool].sort((a, b) => {
    const usedDelta = parseTimeMs(a.usedAt) - parseTimeMs(b.usedAt);
    if (usedDelta) return usedDelta;
    return Number(b.score || 0) - Number(a.score || 0);
  })[0] || null;
  if (!picked) return { insight: null, state, needsRefresh: true, reason: '没有可用市场洞察' };
  state.selectedId = picked.id;
  saveMarketInsights(state);
  return { insight: picked, state, needsRefresh: false, reason: unused.length ? '使用未消耗洞察库存' : '洞察库存已轮完，复用最早使用的一条' };
}

function markMarketInsightUsed(insightId, patch = {}) {
  const state = loadMarketInsights();
  const target = state.insights.find(item => item.id === insightId);
  if (target) {
    Object.assign(target, patch, { usedAt: new Date().toISOString() });
    state.selectedId = insightId;
    saveMarketInsights(state);
  }
  return target;
}

function loadMarketInsights() {
  return loadTopicJson(MARKET_INSIGHTS_PATH, {
    generatedAt: null,
    category: '低度酒 / 气泡白酒',
    selectedId: '',
    manualBehavior: '',
    lastPrompt: '',
    lastSignals: null,
    insights: [],
  });
}

function saveMarketInsights(state) {
  fs.writeFileSync(MARKET_INSIGHTS_PATH, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

function compactInsightSignals(signals) {
  const compact = compactTopicSignals(signals || {});
  return {
    seeds: compact.seeds,
    hotQueries: compact.hotQueries,
    searchNotes: compact.searchNotes.slice(0, 24),
    topics: compact.topics.slice(0, 18),
  };
}

function normalizeInsightSeedTerms(items, fallback = '') {
  const raw = Array.isArray(items) ? items : String(fallback || '').split(/\r?\n|[>→，,；;]/);
  return [...new Set(raw.map(item => {
    if (item && typeof item === 'object') return String(item.seed || item.term || item.keyword || item.coreSearchTerm || '').trim();
    return String(item || '').replace(/^\s*[-*、\d.]+\s*/, '').trim();
  }).filter(Boolean))].slice(0, 12);
}

function buildMarketInsightSeedPrompt(manualBehavior = '') {
  const manual = String(manualBehavior || '').trim() || '气泡白酒';
  return `你是每天烈刻气泡白酒的“小红书搜索行为规划员”。先不要写内容，也不要总结洞察。

你的任务：从一个很粗的入口词，推演真实用户可能会怎样搜索“跟饮酒有关的生活问题”，并产出后续要拿去小红书验证的搜索词。

入口词 / 用户给定线索：
${manual}

生成规则：
1. 先想一个具体用户行为，不是品牌卖点。比如：下班回家想喝一点、一个人在家不想喝醉、朋友来家里吃饭要准备小酒、女生想找不像白酒的酒。
2. 从这个行为衍生出人群特征：她处在什么场景、有什么顾虑、为什么会搜。
3. 再给出她真的可能输入的小红书搜索词。搜索词要像真人会搜的，不要像品牌投放词。
4. 每个词后面写清楚：预期如果搜到什么样的高赞内容，才算“有用”。
5. 只保留和饮酒、微醺、聚会、独处、家里小酌、低度酒、气泡酒、果酒/白酒认知变化相关的词。

产品事实只作为边界，不要直接改写成搜索词：
${loadProductInfo().slice(0, 4000)}

输出严格 JSON，不要 Markdown：
{"baseQuery":"气泡白酒","behaviorSeeds":[{"seed":"下班微醺喝什么酒","userFeature":"下班后想要一个属于自己的缓冲时间","userBehavior":"回家后在冰箱或外卖旁边找一瓶能喝一点的酒","whySearch":"她不是找酒单，而是在找一个今晚可执行的放松方式","expectedUsefulContent":"高赞图文里有真实下班/居家/小酌场景，可学习标题、正文和配图","referenceNeed":"生活切片或氛围种草图文","minUsefulLikes":80}]}`;
}

function parseMarketInsightSeedPlan(raw, manualBehavior = '') {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('用户搜索行为规划没有返回 JSON');
  const parsed = JSON.parse(match[0]);
  const behaviorSeeds = Array.isArray(parsed.behaviorSeeds) ? parsed.behaviorSeeds : [];
  const normalized = behaviorSeeds.map((item, index) => ({
    id: item.id || `seed-${Date.now()}-${index}`,
    seed: String(item.seed || '').trim(),
    userFeature: String(item.userFeature || '').trim(),
    userBehavior: String(item.userBehavior || '').trim(),
    whySearch: String(item.whySearch || '').trim(),
    expectedUsefulContent: String(item.expectedUsefulContent || '').trim(),
    referenceNeed: String(item.referenceNeed || '').trim(),
    minUsefulLikes: Math.max(0, Number(item.minUsefulLikes) || 80),
  })).filter(item => item.seed).slice(0, 12);
  const fallbackSeeds = normalizeInsightSeedTerms([], manualBehavior || '气泡白酒');
  const finalSeeds = normalized.length ? normalized : fallbackSeeds.map((seed, index) => ({
    id: `fallback-seed-${index + 1}`,
    seed,
    userFeature: '人工输入线索',
    userBehavior: '',
    whySearch: '',
    expectedUsefulContent: '搜索后按赞藏评验证是否有可模仿内容',
    referenceNeed: '',
    minUsefulLikes: 80,
  }));
  if (!finalSeeds.length) throw new Error('用户搜索行为规划没有可用搜索词');
  return {
    generatedAt: new Date().toISOString(),
    baseQuery: String(parsed.baseQuery || manualBehavior || '气泡白酒').trim(),
    behaviorSeeds: finalSeeds,
  };
}

function usefulSearchEvidence(signals, seedPlan = null) {
  const seedTerms = new Set(normalizeInsightSeedTerms(seedPlan?.behaviorSeeds || [], ''));
  const rows = (signals?.searchNotes || []).map(row => {
    const score = Number(row.likes || 0) + Number(row.collects || 0) * 2 + Number(row.comments || 0) * 3;
    return {
      keyword: String(row.keyword || '').trim(),
      title: String(row.title || '').trim(),
      source: String(row.source || '').trim(),
      likes: Number(row.likes || 0),
      collects: Number(row.collects || 0),
      comments: Number(row.comments || 0),
      score,
      url: row.url || '',
      cover: row.cover || '',
    };
  }).filter(row => row.keyword && (!seedTerms.size || seedTerms.has(row.keyword)));
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.keyword)) grouped.set(row.keyword, []);
    grouped.get(row.keyword).push(row);
  }
  return [...grouped.entries()].map(([keyword, items]) => {
    const top = [...items].sort((a, b) => b.score - a.score).slice(0, 5);
    const best = top[0] || {};
    return {
      keyword,
      useful: Number(best.likes || 0) >= 80 || Number(best.score || 0) >= 300,
      bestScore: Number(best.score || 0),
      bestLikes: Number(best.likes || 0),
      count: items.length,
      top,
    };
  }).sort((a, b) => b.bestScore - a.bestScore);
}

async function collectSignalsForMarketInsight(manualBehavior = '', { forceCollect = true } = {}) {
  const savedInsightState = loadMarketInsights();
  const seedPrompt = buildMarketInsightSeedPrompt(manualBehavior || savedInsightState.manualBehavior || '');
  const rawSeedPlan = await runClaudeAsync(seedPrompt, 180000);
  const seedPlan = parseMarketInsightSeedPlan(rawSeedPlan, manualBehavior || savedInsightState.manualBehavior || '');
  const previousConfig = loadTopicConfig();
  const plannedSeeds = normalizeInsightSeedTerms(seedPlan.behaviorSeeds, manualBehavior || '');
  saveTopicConfig({ ...previousConfig, seeds: plannedSeeds });
  await runTopicCollector();
  const signals = loadTopicJson(TOPIC_SIGNALS_PATH, null);
  if (!signals || signals.error) throw new Error(signals?.error || '没有可用搜索信号');
  const validation = usefulSearchEvidence(signals, seedPlan);
  const useful = validation.filter(item => item.useful);
  if (!useful.length) {
    const best = validation.slice(0, 5).map(item => `${item.keyword}: likes=${item.bestLikes}, score=${item.bestScore}`).join('；');
    throw new Error(`用户搜索行为没有验证出高互动内容；${best || '没有搜索结果'}`);
  }
  return {
    signals,
    seedPlan: { ...seedPlan, behaviorSeeds: seedPlan.behaviorSeeds.map(item => ({ ...item, verified: useful.some(v => v.keyword === item.seed) })) },
    validation,
    usefulSeeds: useful.map(item => item.keyword),
    seedPrompt,
  };
}

function normalizeBehaviorChain(raw) {
  return String(raw || '')
    .split(/\r?\n|[>→]/)
    .map(v => v.replace(/^\s*[-*、\d.]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function buildMarketInsightPrompt(signals, manualBehavior = '', seedPlan = null, validation = []) {
  const seedTerms = normalizeBehaviorChain(manualBehavior);
  const seedBlock = seedTerms.length
    ? `\n\n## 人工输入的种子词 / 假设词\n${seedTerms.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\n这些不是完整路径。请把它们当作入口线索，反推出真实用户可能怎样一步步搜索、比较、相信和行动。`
    : '\n\n## 人工输入的种子词 / 假设词\n暂无。请从真实信号里挑出最有生产价值的入口词，再反推用户决策路径。';
  const seedPlanBlock = seedPlan ? `\n\n## 已先行推演并验证的用户搜索行为\n${JSON.stringify({
    baseQuery: seedPlan.baseQuery,
    behaviorSeeds: seedPlan.behaviorSeeds,
    usefulEvidence: (validation || []).filter(item => item.useful).slice(0, 8),
  }, null, 2)}

请优先围绕 usefulEvidence=true 的搜索词产出洞察。没有高互动证据的词，只能作为辅助长尾词，不能作为核心洞察。` : '';
  return `你是每天烈刻气泡白酒的市场洞察编辑。你的任务不是列关键词，而是从一个“可能会被搜的词”反推用户决策路径。

核心问题：
1. 用户为什么会被这个词吸引并停下来？
2. 她正被哪个具体场景击中？
3. 她看到什么内容会有“这说的不就是我吗”的代入感？
4. 她需要看到什么证据才会开始相信？
5. 她从感兴趣走到咨询、下单或收藏，需要跨过哪一个顾虑？

请输出 3-5 条可直接驱动热点抓取和写作的洞察。每条洞察只解决一个主要决策阶段，结构必须完整：
- coreSearchTerm：用户最可能真的输入的核心搜索词。
- longTailTerms：3-5 个继续搜索词，必须体现用户从模糊兴趣到具体顾虑的递进。
- searchBehaviorChain：从种子词反推出来的搜索路径，写成 4-6 步；每一步都要像真实用户会搜的词。
- searchIntent：解释她为什么这样搜，以及这一搜背后的真实需求。
- userProblem：她当下遇到的问题，不要写成品牌想表达的卖点。
- decisionStage：只能选 停留 / 代入 / 理解 / 信任 / 购买。
- desiredState：她想进入的状态，也就是内容要帮她“造梦”的方向。
- dreamMoments：三个被产品改变的具体时刻。每个时刻都要有：人物状态、时间地点、动作、物件、情绪变化。
- objectCarriers：承载欲望的物件，优先是杯子、冰箱灯、外卖袋、桌面、杯壁水汽、聊天记录、便利店小票这类生活物件；产品只作为其中一个物件。
- productBridge：每天烈刻用一个真实产品事实自然接住，不要堆资料。
- contentTask：这篇内容应该完成的单一任务。
- referenceNeed：后续应该抓什么样的图文笔记作为母本，比如互动封面、氛围文字图、产品推荐图、生活切片。
- evidence：列出真实信号依据。

判断标准：
- 好洞察会像“用户真的会这么搜”，不是品牌自己想说什么。
- 好造梦不是漂亮形容词，而是三个能拍出来、能写进正文、能放进封面的生活时刻。
- 搜索词布局要服务内容主题：核心词进标题或前 120 字，长尾词进正文的自然问句、判断句或评论引导。
- 只使用下面真实信号里出现或能直接组合出的搜索表达，不编造搜索量、增幅和用户规模。
- “0糖0卡”只能客观陈述，不能写成0负担、健康、减肥或身体负担更轻；气泡清爽不能推导成解腻、刮油；低度不能推导成不醉、不上头。
- 不输出空泛人群画像、复杂内容矩阵、传播策略或多余分类。

产品事实：
${loadProductInfo().slice(0, 8000)}

输出严格 JSON：
{"generatedAt":"","category":"低度酒 / 气泡白酒","insights":[{"id":"insight-1","name":"","coreSearchTerm":"","longTailTerms":[""],"searchBehaviorChain":[""],"searchIntent":"","userProblem":"","decisionStage":"代入","contentTask":"","productBridge":"","scene":"","desiredState":"","objectCarriers":[""],"dreamMoments":[""],"referenceNeed":"","evidence":[""],"score":85}]}
${seedBlock}
${seedPlanBlock}

真实搜索信号：
${JSON.stringify(compactInsightSignals(signals), null, 2)}`;
}

function parseMarketInsights(raw) {
  const cleaned = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('市场洞察没有返回 JSON');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed.insights)) throw new Error('市场洞察缺少 insights');
  const allowedStages = new Set(['停留', '代入', '理解', '信任', '购买']);
  parsed.generatedAt = new Date().toISOString();
  parsed.category = parsed.category || '低度酒 / 气泡白酒';
  parsed.insights = parsed.insights.slice(0, 5).map((item, index) => ({
    id: item.id || `insight-${Date.now()}-${index}`,
    name: String(item.name || item.coreSearchTerm || `洞察 ${index + 1}`).trim(),
    coreSearchTerm: String(item.coreSearchTerm || '').trim(),
    longTailTerms: Array.isArray(item.longTailTerms) ? item.longTailTerms.map(String).map(v => v.trim()).filter(Boolean).slice(0, 5) : [],
    searchBehaviorChain: Array.isArray(item.searchBehaviorChain) ? item.searchBehaviorChain.map(String).map(v => v.trim()).filter(Boolean).slice(0, 8) : [],
    searchIntent: String(item.searchIntent || '').trim(),
    userProblem: String(item.userProblem || '').trim(),
    decisionStage: allowedStages.has(item.decisionStage) ? item.decisionStage : '代入',
    contentTask: String(item.contentTask || '').trim(),
    productBridge: String(item.productBridge || '').trim(),
    scene: String(item.scene || '').trim(),
    desiredState: String(item.desiredState || '').trim(),
    objectCarriers: Array.isArray(item.objectCarriers) ? item.objectCarriers.map(String).map(v => v.trim()).filter(Boolean).slice(0, 5) : [],
    dreamMoments: Array.isArray(item.dreamMoments) ? item.dreamMoments.map(String).map(v => v.trim()).filter(Boolean).slice(0, 3) : [],
    referenceNeed: String(item.referenceNeed || '').trim(),
    evidence: Array.isArray(item.evidence) ? item.evidence.map(String).filter(Boolean).slice(0, 3) : [],
    score: Math.max(0, Math.min(100, Number(item.score) || 0)),
  })).filter(item => item.coreSearchTerm && item.userProblem);
  if (!parsed.insights.length) throw new Error('市场洞察没有有效搜索词');
  return parsed;
}

function findMarketInsightRecordId(name) {
  const listed = larkCli([
    'base', '+record-list', '--base-token', OUTPUT_BASE,
    '--table-id', MARKET_INSIGHT_TABLE, '--limit', '100',
    '--field-id', MARKET_INSIGHT_NAME_FIELD, '--format', 'json',
  ]);
  const rows = listed.data?.data || [];
  const ids = listed.data?.record_id_list || [];
  const fields = listed.data?.field_id_list || [];
  const nameIndex = fields.indexOf(MARKET_INSIGHT_NAME_FIELD);
  const matchIndex = rows.findIndex(row => String(row[nameIndex] || '').trim() === String(name || '').trim());
  return matchIndex >= 0 ? ids[matchIndex] : '';
}

function writeInsightToFeishu(insight, status = '本次采用') {
  const extendedEvidence = [
    ...(insight.evidence || []),
    insight.searchIntent ? `搜索意图：${insight.searchIntent}` : '',
    insight.desiredState ? `想进入的状态：${insight.desiredState}` : '',
    (insight.searchBehaviorChain || []).length ? `搜索行为链：${insight.searchBehaviorChain.join(' → ')}` : '',
    (insight.objectCarriers || []).length ? `物件承载：${insight.objectCarriers.join(' / ')}` : '',
    (insight.dreamMoments || []).length ? `造梦三时刻：\n${insight.dreamMoments.map((v, i) => `${i + 1}. ${v}`).join('\n')}` : '',
    insight.referenceNeed ? `后续参考笔记要求：${insight.referenceNeed}` : '',
  ].filter(Boolean);
  const fields = {
    洞察名称: insight.name,
    品类: '低度酒 / 气泡白酒',
    核心搜索词: insight.coreSearchTerm,
    长尾词: insight.longTailTerms.join('\n'),
    用户问题: insight.userProblem,
    决策阶段: insight.decisionStage,
    内容任务: insight.contentTask,
    产品承接: insight.productBridge,
    使用场景: insight.scene,
    信号证据: extendedEvidence.join('\n'),
    状态: status,
  };
  const existingId = findMarketInsightRecordId(insight.name);
  if (existingId) {
    updateBaseRecord(MARKET_INSIGHT_TABLE, existingId, fields, OUTPUT_BASE);
    return existingId;
  }
  const result = writeToBase(MARKET_INSIGHT_TABLE, fields, OUTPUT_BASE);
  const directId = extractRecordIdFromWrite(result);
  if (directId) return directId;
  return findMarketInsightRecordId(insight.name);
}

function selectMarketInsight(insightId, { writeFeishu = true } = {}) {
  const state = loadMarketInsights();
  const insight = state.insights.find(item => item.id === insightId);
  if (!insight) throw new Error('市场洞察不存在');
  state.selectedId = insight.id;
  if (writeFeishu && !insight.feishuRecordId) insight.feishuRecordId = writeInsightToFeishu(insight);
  saveMarketInsights(state);
  const current = loadTopicConfig();
  const seeds = [insight.coreSearchTerm, ...insight.longTailTerms].filter(Boolean).slice(0, 8);
  saveTopicConfig({ ...current, seeds: seeds.length ? seeds : current.seeds });
  return { state, insight };
}

function selectedMarketInsight() {
  const state = loadMarketInsights();
  return state.insights.find(item => item.id === state.selectedId) || null;
}

function postLocalJson(url, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const raw = Buffer.from(JSON.stringify(payload || {}), 'utf8');
    const request = require(u.protocol === 'https:' ? 'https' : 'http').request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': raw.length }, timeout: timeoutMs,
    }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(text || '{}')); }
        catch { reject(new Error(`local service returned invalid JSON (${response.statusCode})`)); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('local service timeout')));
    request.on('error', reject);
    request.end(raw);
  });
}

function getLocalJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const request = require('http').get(url, { timeout: timeoutMs }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(text || '{}')); }
        catch { reject(new Error(`local service returned invalid JSON (${response.statusCode})`)); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('local service timeout')));
    request.on('error', reject);
  });
}

async function openCdpUrl(port, targetUrl) {
  const safePort = Number(port) || GPT_CDP_PORT;
  const response = await fetch(`http://127.0.0.1:${safePort}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`CDP open url failed: ${response.status}`);
  return response.json();
}

function currentCdpCommandLine(port = GPT_CDP_PORT) {
  const safePort = Number(port) || GPT_CDP_PORT;
  const script = `$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*--remote-debugging-port=${safePort}*' } | Select-Object -First 1 -ExpandProperty CommandLine; if ($p) { $p }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 10000 });
  return String(result.stdout || '').trim();
}

function loadGptAccountRegistry() {
  const registryPath = path.join(XHS_PUBLISHER_DIR, 'gpt-accounts.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  registry.accounts = Array.isArray(registry.accounts) ? registry.accounts : [];
  return { registryPath, registry };
}

function getForcedGptAccount() {
  const { registry } = loadGptAccountRegistry();
  const account = registry.accounts.find(item => {
    const values = [item?.slug, item?.email, item?.label].map(v => String(v || '').toLowerCase());
    return values.includes(FORCED_GPT_ACCOUNT_SLUG) || values.includes(FORCED_GPT_ACCOUNT_EMAIL);
  });
  if (!account) throw new Error(`GPT 账号表缺少 Farewell：${FORCED_GPT_ACCOUNT_EMAIL}`);
  const email = String(account.email || '').toLowerCase();
  const slug = String(account.slug || '').toLowerCase();
  if (email !== FORCED_GPT_ACCOUNT_EMAIL || slug !== FORCED_GPT_ACCOUNT_SLUG) {
    throw new Error(`GPT 账号表配置错误：必须是 ${FORCED_GPT_ACCOUNT_EMAIL}/${FORCED_GPT_ACCOUNT_SLUG}`);
  }
  return account;
}

function setDefaultGptAccount() {
  const registryPath = path.join(XHS_PUBLISHER_DIR, 'gpt-accounts.json');
  try {
    const loaded = loadGptAccountRegistry();
    const registry = loaded.registry;
    const accounts = registry.accounts;
    const index = accounts.findIndex(item => {
      const values = [item?.slug, item?.email, item?.label].map(v => String(v || '').toLowerCase());
      return values.includes(FORCED_GPT_ACCOUNT_SLUG) || values.includes(FORCED_GPT_ACCOUNT_EMAIL);
    });
    if (index < 0) throw new Error(`找不到 Farewell GPT 账号：${FORCED_GPT_ACCOUNT_EMAIL}`);
    if (registry.activeIndex !== index || accounts.length !== 1) {
      registry.activeIndex = index;
      registry.accounts = [accounts[index]];
      registry.activeIndex = 0;
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
    }
    return { ok: true, activeIndex: 0, account: registry.accounts[0] || accounts[index] };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function getGptProfileFragment() {
  const fallback = path.normalize(
    path.join(XHS_PUBLISHER_DIR, 'profiles', 'gpt', FORCED_GPT_ACCOUNT_SLUG)
  ).toLowerCase();
  try {
    const account = getForcedGptAccount();
    const profileDir = account?.profile_dir ? String(account.profile_dir) : '';
    if (!profileDir) return fallback;
    const absolute = path.isAbsolute(profileDir)
      ? profileDir
      : path.join(XHS_PUBLISHER_DIR, profileDir);
    return path.normalize(absolute).toLowerCase();
  } catch {
    return fallback;
  }
}

function commandUsesForcedGptProfile(command) {
  const raw = String(command || '').toLowerCase();
  if (!raw) return false;
  if (/playwright_chromiumdev_profile|automation-hub|gpt-b|gpt-b-from-chrome-profile3/.test(raw)) return false;
  return raw.includes(getGptProfileFragment());
}

const CHATGPT_LOGIN_GATE_PATTERN = /log in|login|sign in|sign up|continue with google|use google|chatgpt\s*(?:plus|pro)?\s*log in|登录|登陆|登入|註冊|注册|使用\s*google|继续使用\s*google|繼續使用\s*google|两步|兩步|验证码|驗證碼|session expired|尚未登入|未登录|未登入/i;

function evaluateCdpExpression(tab, expression, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    if (!tab?.webSocketDebuggerUrl) return reject(new Error('tab has no websocket debugger url'));
    let WebSocketImpl;
    try { WebSocketImpl = require('ws'); } catch { WebSocketImpl = global.WebSocket; }
    if (!WebSocketImpl) return reject(new Error('WebSocket unavailable'));
    const ws = new WebSocketImpl(tab.webSocketDebuggerUrl);
    const id = 1;
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('CDP Runtime.evaluate timeout'));
    }, timeoutMs);
    const cleanup = () => clearTimeout(timer);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
    ws.on('message', data => {
      let message = null;
      try { message = JSON.parse(String(data)); } catch {}
      if (!message || message.id !== id) return;
      cleanup();
      try { ws.close(); } catch {}
      if (message.error) return reject(new Error(message.error.message || 'Runtime.evaluate failed'));
      resolve(message.result?.result?.value);
    });
    ws.on('error', error => {
      cleanup();
      reject(error);
    });
  });
}

async function inspectChatGptTabDom(tab) {
  const expression = `(() => {
    const text = String(document.body?.innerText || '');
    const title = String(document.title || '');
    const href = String(location.href || '');
    const loginPattern = ${CHATGPT_LOGIN_GATE_PATTERN.toString()};
    const loginGate = loginPattern.test(text) || loginPattern.test(title) || /\\/login|\\/signin|auth\\.openai\\.com|accounts\\.google\\.com/i.test(href);
    const composer = !!document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"], div[role="textbox"]');
    const accountish = Array.from(document.querySelectorAll('button,a,[role="button"]'))
      .map(el => String(el.innerText || el.getAttribute('aria-label') || '').trim())
      .filter(Boolean)
      .join('\\n')
      .slice(0, 2000);
    return { href, title, loginGate, composer, accountish, sample: text.slice(0, 1200) };
  })()`;
  try {
    return await evaluateCdpExpression(tab, expression, 7000);
  } catch (error) {
    return { href: tab.url || '', title: tab.title || '', loginGate: true, composer: false, error: error.message };
  }
}

function runGptRecoveryHarness(job) {
  const script = path.join(XHS_PUBLISHER_DIR, 'gpt_preflight.py');
  if (!fs.existsSync(script)) {
    throw new Error(`GPT Recovery Harness 缺失：${script}`);
  }
  const result = spawnSync('python', [script], {
    cwd: XHS_PUBLISHER_DIR,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  let payload = null;
  try {
    payload = stdout ? JSON.parse(stdout) : null;
  } catch {
    payload = null;
  }
  if (result.error) {
    throw new Error(`GPT Recovery Harness 执行失败：${result.error.message}`);
  }
  if (result.status !== 0 || !payload?.ok) {
    const reason = payload?.reason || stderr || stdout || `exit ${result.status}`;
    const facts = payload ? JSON.stringify(payload).slice(0, 1200) : [stdout, stderr].filter(Boolean).join(' | ').slice(0, 1200);
    const message = `GPT Recovery Harness 未通过，已停止建队列：${reason}${facts ? `；${facts}` : ''}`;
    if (job) dailyLog(job, message);
    throw new Error(message);
  }
  if (job) dailyLog(job, `GPT Recovery Harness 通过：Farewell / ${FORCED_GPT_ACCOUNT_EMAIL} / ${FORCED_GPT_ACCOUNT_SLUG}`);
  return payload;
}

function launchPublisherChromium(args = [], extraEnv = {}) {
  if (!fs.existsSync(XHS_LAUNCHER)) throw new Error(`找不到发布助手启动器：${XHS_LAUNCHER}`);
  const child = spawn('python', [XHS_LAUNCHER, ...args], {
    cwd: XHS_PUBLISHER_DIR,
    env: { ...process.env, ...extraEnv },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function waitForCdpProfile(profileFragment, timeoutMs = 120000, port = GPT_CDP_PORT) {
  const needle = String(profileFragment || '').toLowerCase();
  const startedAt = Date.now();
  let lastCommand = '';
  let lastPortError = '';
  while (Date.now() - startedAt < timeoutMs) {
    lastCommand = currentCdpCommandLine(port);
    if (lastCommand.toLowerCase().includes(needle)) {
      try {
        await getLocalJson(`http://127.0.0.1:${port}/json/version`, 5000);
        return lastCommand;
      } catch (error) {
        lastPortError = error.message || String(error);
      }
    }
    await waitMs(1500);
  }
  throw new Error(`等待 Chromium profile 超时：${profileFragment}；当前=${lastCommand || '未启动'}；CDP=${lastPortError || '未就绪'}`);
}

async function waitForCompanionProfile(profileSlug, timeoutMs = 90000, port = GPT_COMPANION_PORT) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      last = await getLocalJson(`http://127.0.0.1:${port}/profile`, 5000);
      if (String(last.profile_slug || '').toLowerCase() === String(profileSlug || '').toLowerCase()) return last;
    } catch {}
    await waitMs(1500);
  }
  throw new Error(`等待发布助手 profile 超时：${profileSlug}；当前=${last ? JSON.stringify(last) : '无响应'}`);
}

async function inspectGptCdpPort(port) {
  try {
    const command = currentCdpCommandLine(port);
    if (!command) return { ok: false, port, reason: 'not_running' };
    if (!commandUsesForcedGptProfile(command)) {
      return { ok: false, port, command, reason: 'wrong_profile_not_farewell' };
    }
    const tabs = await getLocalJson(`http://127.0.0.1:${port}/json`, 5000);
    const list = Array.isArray(tabs) ? tabs : [];
    const urls = list.map(tab => String(tab.url || ''));
    const titles = list.map(tab => String(tab.title || ''));
    const chatTabs = list.filter(tab => /^https:\/\/chatgpt\.com/i.test(String(tab.url || '')));
    const chatChecks = [];
    for (const tab of chatTabs) {
      chatChecks.push(await inspectChatGptTabDom(tab));
    }
    const authGate = urls.some(url => /accounts\.google\.com|auth\.openai\.com|sessionexpired/i.test(url))
      || chatTabs.some(tab => /\/signin|\/login/i.test(String(tab.url || ''))
        || CHATGPT_LOGIN_GATE_PATTERN.test(String(tab.title || '')))
      || chatChecks.some(check => check?.loginGate);
    const usable = chatChecks.some(check => check?.composer && !check?.loginGate)
      && !authGate;
    return { ok: usable, port, command, tabs: list, urls, titles, chatChecks, reason: usable ? 'usable_farewell' : (chatTabs.length ? 'chatgpt_auth_or_uncertain' : 'no_chatgpt_tab') };
  } catch (error) {
    return { ok: false, port, reason: error.message || String(error) };
  }
}

async function findUsableGptCdp() {
  const inspected = [];
  for (const port of [GPT_CDP_PORT]) {
    const info = await inspectGptCdpPort(port);
    inspected.push(info);
    if (info.ok) return { ...info, inspected };
  }
  return { ok: false, inspected };
}

async function ensureGptImageProfile(job, accountSlug = GPT_IMAGE_ACCOUNT) {
  const registry = setDefaultGptAccount();
  if (!registry.ok) throw new Error(`GPT Farewell 账号锁定失败：${registry.error}`);
  if (job) dailyLog(job, `GPT 默认账号已固定：Farewell / ${FORCED_GPT_ACCOUNT_EMAIL}（activeIndex=${registry.activeIndex}）`);
  const usable = await findUsableGptCdp();
  if (usable.ok) {
    if (job) dailyLog(job, `检测到 Farewell ChatGPT 登录态：CDP ${usable.port}，本轮直接复用，不再重复拉起登录页`);
    return usable;
  }
  const profileFragment = getGptProfileFragment();
  const command = currentCdpCommandLine(GPT_CDP_PORT);
  if (!commandUsesForcedGptProfile(command)) {
    if (job) dailyLog(job, `切换到 Farewell GPT 生图 profile：${FORCED_GPT_ACCOUNT_SLUG}`);
    launchPublisherChromium(['--gpt-account', FORCED_GPT_ACCOUNT_SLUG], {
      XHS_PUBLISHER_CDP_PORT: String(GPT_CDP_PORT),
      XHS_PUBLISHER_COMPANION_PORT: String(GPT_COMPANION_PORT),
    });
    await waitForCdpProfile(profileFragment, 150000, GPT_CDP_PORT);
    await waitForCompanionProfile(FORCED_GPT_ACCOUNT_SLUG, 120000, GPT_COMPANION_PORT);
  } else if (job) {
    dailyLog(job, `Farewell GPT 生图 profile 已在运行：${FORCED_GPT_ACCOUNT_SLUG}`);
  }
  const tabs = await getLocalJson(`http://127.0.0.1:${GPT_CDP_PORT}/json`, 10000);
  const hasChatGpt = (Array.isArray(tabs) ? tabs : []).some(t => String(t.url || '').includes('chatgpt.com'));
  const hasMarkerChatGpt = (Array.isArray(tabs) ? tabs : []).some(t => String(t.url || '').includes('chatgpt.com') && String(t.url || '').includes('lieke_gpt_profile=gpt-a'));
  if (!hasChatGpt || !hasMarkerChatGpt) {
    await openCdpUrl(GPT_CDP_PORT, CHATGPT_AUTOMATION_URL);
    await waitForCdpProfile(profileFragment, 90000, GPT_CDP_PORT);
  }
  return inspectGptCdpPort(GPT_CDP_PORT);
}

async function assertGptImageProfileLoggedIn(job, accountSlug = GPT_IMAGE_ACCOUNT) {
  runGptRecoveryHarness(job);
  const usable = await findUsableGptCdp();
  if (!usable.ok) {
    const visible = (usable.inspected || [])
      .flatMap(info => [`${info.port}:${info.reason}`, ...(info.urls || []), ...(info.titles || []), ...((info.chatChecks || []).map(check => check.sample || check.error || '').filter(Boolean))])
      .filter(Boolean)
      .slice(0, 8)
      .join(' | ');
    const message = `Farewell GPT 生图 profile 未处于可用登录态，已停止建队列：${visible || '无可用页面'}`;
    if (job) dailyLog(job, message);
    throw new Error(message);
  }
  if (job) dailyLog(job, `GPT 登录态门禁通过：Farewell / ${FORCED_GPT_ACCOUNT_EMAIL}（CDP ${usable.port}）`);
  return usable;
}

async function ensureXhsPublishProfile(job, profileSlug = 'legacy') {
  const command = currentCdpCommandLine(XHS_CDP_PORT);
  if (!command.toLowerCase().includes(XHS_LEGACY_PROFILE_FRAGMENT)) {
    if (job) dailyLog(job, `切回小红书发布 profile：${profileSlug}`);
    launchPublisherChromium(['--profile', profileSlug, '--url', XHS_PUBLISH_URL], {
      XHS_PUBLISHER_CDP_PORT: String(XHS_CDP_PORT),
      XHS_PUBLISHER_COMPANION_PORT: String(XHS_COMPANION_PORT),
    });
    await waitForCdpProfile(XHS_LEGACY_PROFILE_FRAGMENT, 150000, XHS_CDP_PORT);
    await waitForCompanionProfile(profileSlug, 120000, XHS_COMPANION_PORT);
  } else if (job) {
    dailyLog(job, `小红书发布 profile 已在运行：${profileSlug}`);
  }
}

function gptQueueRecordId(queueState = {}) {
  if (queueState.publish_record_id) return queueState.publish_record_id;
  const item = (queueState.items || []).find(row => row.publish_record_id || row.publishRecordId);
  return item ? (item.publish_record_id || item.publishRecordId || '') : '';
}

function assertGptQueueBoundToRecord(queueState = {}, recordId, context = 'GPT 队列') {
  const targetRecordId = String(recordId || '').trim();
  if (!targetRecordId) throw new Error(`${context}缺少发布表 recordId`);
  const items = Array.isArray(queueState.items) ? queueState.items : [];
  const queueRecordId = String(gptQueueRecordId(queueState) || '').trim();
  if (!queueRecordId) {
    throw new Error(`${context}缺少 publish_record_id，拒绝把未绑定队列图片写入发布表`);
  }
  if (queueRecordId !== targetRecordId) {
    throw new Error(`${context}属于发布记录 ${queueRecordId}，不能上传到当前记录 ${targetRecordId}`);
  }
  const unboundIndexes = [];
  const wrongIndexes = [];
  items.forEach((item, index) => {
    const itemRecordId = String(item.publish_record_id || item.publishRecordId || '').trim();
    if (!itemRecordId) unboundIndexes.push(index + 1);
    else if (itemRecordId !== targetRecordId) wrongIndexes.push(`${index + 1}:${itemRecordId}`);
  });
  if (unboundIndexes.length) {
    throw new Error(`${context}存在未绑定任务：第 ${unboundIndexes.join(', ')} 张，拒绝上传`);
  }
  if (wrongIndexes.length) {
    throw new Error(`${context}存在跨记录任务：${wrongIndexes.join(', ')}，拒绝上传`);
  }
  return queueRecordId;
}

function summarizeGptQueue(queueState = {}) {
  const items = queueState.items || [];
  const completed = Number(queueState.completed_count ?? items.filter(item => ['done', 'complete', 'completed'].includes(item.status)).length);
  const failed = Number(queueState.failed_count ?? items.filter(item => item.status === 'failed').length);
  const pending = Number(queueState.pending_count ?? items.filter(item => item.status === 'pending').length);
  return {
    ok: queueState.ok !== false,
    queueId: queueState.queue_id || '',
    publishRecordId: gptQueueRecordId(queueState),
    status: queueState.status || 'empty',
    stage: queueState.stage || queueState.status || 'empty',
    expected: Number(queueState.expected_count || queueState.batch_limit || items.length || 0),
    total: items.length,
    completed,
    failed,
    pending,
    lastUpdatedAt: queueState.last_updated_at || '',
  };
}

async function safeLocalJson(name, url, timeoutMs = 10000) {
  try {
    const data = await getLocalJson(url, timeoutMs);
    return { name, ok: true, data };
  } catch (error) {
    return { name, ok: false, error: error.message };
  }
}

async function getDailyAutomationHealth({ includeRaw = false } = {}) {
  const [publisher, gptAccounts, imageTool] = await Promise.all([
    safeLocalJson('publisher', `http://127.0.0.1:${XHS_COMPANION_PORT}/profile`, 10000),
    safeLocalJson('gptAccounts', `http://127.0.0.1:${GPT_COMPANION_PORT}/gpt_accounts`, 10000),
    safeLocalJson('imageTool', 'http://127.0.0.1:5000/api/gpt-queue-state', 10000),
  ]);
  const dailyJobs = [...dailyRunStore.values()].map(job => ({
    id: job.id,
    ok: job.ok,
    done: job.done,
    startedAt: job.startedAt,
    stage: job.result?.stage || '',
    recordId: job.result?.recordId || '',
    error: job.error || '',
  }));
  return {
    ok: publisher.ok && imageTool.ok,
    publisher: publisher.ok ? { ok: true, profile: publisher.data } : { ok: false, error: publisher.error },
    gptAccounts: gptAccounts.ok ? {
      ok: true,
      count: Array.isArray(gptAccounts.data.accounts) ? gptAccounts.data.accounts.length : 0,
      active: gptAccounts.data.active || gptAccounts.data.current || '',
      data: gptAccounts.data,
    } : { ok: false, error: gptAccounts.error },
    imageTool: imageTool.ok ? {
      ok: true,
      queue: summarizeGptQueue(imageTool.data),
      ...(includeRaw ? { raw: imageTool.data } : {}),
    } : { ok: false, error: imageTool.error },
    runningJobs: dailyJobs.filter(job => !job.done),
    recentJobs: dailyJobs.slice(-10),
  };
}

async function cleanupGptResultConversations() {
  const ports = [GPT_COMPANION_PORT, XHS_COMPANION_PORT].filter((port, index, arr) => arr.indexOf(port) === index);
  const localResults = await Promise.allSettled(ports.map(port => postLocalJson(`http://127.0.0.1:${port}/cleanup_gpt_results`, {}, 30000)));
  const cleanupScript = path.join(XHS_PUBLISHER_DIR, 'scripts', 'cleanup_gpt_image_conversations.py');
  if (!fs.existsSync(cleanupScript)) return { localResults, conversationCleanup: { ok: false, reason: 'cleanup_script_missing' } };
  const proc = spawnSync('python', [cleanupScript], {
    cwd: XHS_PUBLISHER_DIR,
    encoding: 'utf8',
    timeout: 90000,
  });
  return {
    localResults,
    conversationCleanup: {
      ok: proc.status === 0,
      status: proc.status,
      stdout: (proc.stdout || '').slice(0, 4000),
      stderr: (proc.stderr || '').slice(0, 4000),
    },
  };
}

async function openXhsPublishPageViaCompanion() {
  try {
    return await postLocalJson(`http://127.0.0.1:${XHS_COMPANION_PORT}/open_publish_page`, {}, 30000);
  } catch (firstError) {
    if (XHS_COMPANION_PORT === GPT_COMPANION_PORT) throw firstError;
    return postLocalJson(`http://127.0.0.1:${GPT_COMPANION_PORT}/open_publish_page`, {}, 30000);
  }
}

async function getFeishuProductReferenceIds() {
  const payload = await getLocalJson('http://127.0.0.1:5000/api/feishu-products?refresh=1', 60000);
  const products = (payload.products || []).filter(p => p.record_id && p.file_token);
  if (!products.length) throw new Error('\u4ea7\u54c1\u7d20\u6750\u8868\u6ca1\u6709\u53ef\u7528\u7684\u4ea7\u54c1\u56fe\u7247');
  const withLabel = products.filter(p => p.label_file_token);
  // One product photo is not enough for GPT to reconstruct bottle identity.
  // Prefer records with a label crop, then add more full-bottle angles so the
  // task receives: label detail + silhouette/proportion + perspective evidence.
  const ordered = [...withLabel, ...products.filter(p => !withLabel.some(x => x.record_id === p.record_id))];
  return ordered.slice(0, 4).map(p => p.record_id);
}

function buildImageOverlayTexts(body, count) {
  const clean = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/#[^\s#]+/g, '')
    .replace(/未成年人及孕妇禁止饮酒。?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const salesWords = /每天烈刻|气泡白酒|白酒|青提|菠萝|口感|入口|回甘|0糖|0卡|配料|购买|下单|链接|推荐|适合|喝什么|朋友家|火锅|烧烤|测评|好喝|不亏|一瓶|两瓶|价格|酒精|度数|孕妇|未成年/;
  const riskyWords = /崩溃|散掉|治愈|修好|恢复|救命|续命|解药|靠酒|断片|不上头|不醉/;
  const sentenceParts = clean
    .split(/(?<=[。！？!?…])\s*|[；;]/)
    .map(s => s.trim())
    .filter(Boolean);
  const sentenceCandidates = [];
  for (let i = 0; i < sentenceParts.length; i++) {
    const one = sentenceParts[i].replace(/[，,]\s*/g, '，').trim();
    const next = (sentenceParts[i + 1] || '').replace(/[，,]\s*/g, '，').trim();
    if (one) sentenceCandidates.push(one);
    if (next) {
      const pair = `${one}${next}`;
      if (pair.length <= 86 && /不是|而是|原来|真正|我知道|总有|允许自己|找回来/.test(pair)) {
        sentenceCandidates.push(pair);
      }
    }
  }
  const literaryWords = /原来|真正|不是|而是|我知道|总有|允许自己|慢一点|属于自己|找回来|一步一步|平静|生活|自由|远方|风景|答案|留下来|灯亮|安静|认真|记得|明白|有一天/;
  const structureWords = /不是.*而是|原来.*不是|有一天.*依然|总有.*自己|不是.*自由|而是.*找回来/;
  const mundaneWords = /租约|存款|未来计划|回复消息|赶进度|工作刚稳定|白天|晚上回到家|第二天醒来|待完成|换工作|搬家/;
  const candidates = sentenceCandidates
    .map(text => text.trim())
    .filter(text => text.length >= 10 && text.length <= 86)
    .filter(text => !salesWords.test(text) && !riskyWords.test(text))
    .map((text, index) => ({
      text,
      index,
      score:
        (structureWords.test(text) ? 24 : 0)
        + (literaryWords.test(text) ? 12 : 0)
        + (/[，,]/.test(text) ? 4 : 0)
        + (text.length >= 18 && text.length <= 56 ? 5 : 0)
        - (mundaneWords.test(text) ? 10 : 0)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.text);
  const paragraphs = String(body || '')
    .split(/\n\s*\n+/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 22 && p.length <= 80 && literaryWords.test(p) && !salesWords.test(p) && !riskyWords.test(p));
  const fallback = candidates.length ? candidates : paragraphs;
  const safeFallbacks = [
    '今晚只想把自己慢慢放回来。',
    '人要有一点属于自己的安静。',
    '把今天放轻一点，再回到生活里。',
    '留一盏灯，也留一点松弛给自己。',
  ];
  if (/崩溃|喝酒|靠酒|治愈|修好|恢复|难喝|百威|rio/i.test(clean)) {
    return Array.from({ length: count }, (_, i) => safeFallbacks[i % safeFallbacks.length]);
  }
  return Array.from({ length: count }, (_, i) => {
    const source = fallback[i % Math.max(1, fallback.length)] || safeFallbacks[i % safeFallbacks.length];
    return source.slice(0, 86);
  });
}

function isEngagementCoverReference(reference) {
  const text = [reference?.title, reference?.body, reference?.tags, reference?.purpose, reference?.angle].join(' ');
  if (/人工指定母本|巴黎|品牌调性|造梦|氛围|文字封面参考|生活方式|旅行|随笔|美学/.test(text)) return false;
  return /想囤点|求推荐|有没有|友友|评论|心情|崩溃|难喝|喝点酒|小酌喝什么|推荐吗|问一下/.test(text);
}

function buildEngagementCoverHooks(reference, draft, count) {
  const title = String(reference?.title || '');
  const body = String(draft?.body || '');
  const hooks = [];
  if (/囤点/.test(title) || /推荐/.test(title)) hooks.push('想囤一点晚上的松弛，求推荐');
  if (/下班|小酌|微醺/.test(body)) hooks.push('下班后想小酌一杯，有推荐吗？');
  hooks.push('一个人小酌喝什么，友友们有答案吗？');
  hooks.push('想找一瓶不难入口的晚安小酒');
  return Array.from({ length: count }, (_, i) => hooks[i % hooks.length]);
}

const waitMs = ms => new Promise(resolve => setTimeout(resolve, ms));

function newestThreeReferenceImages() {
  const roots = [path.join(__dirname, 'xhs-image-cache'), path.join(__dirname, '.tmp')];
  const groups = new Map();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(?:png|jpe?g|webp)$/i.test(entry.name)) {
          const key = entry.name.replace(/-\d+\.(?:png|jpe?g|webp)$/i, '') || path.dirname(full);
          const stat = fs.statSync(full);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push({ path: full, mtime: stat.mtimeMs });
        }
      }
    };
    walk(root);
  }
  return [...groups.values()].filter(files => files.length >= 3)
    .sort((a, b) => Math.max(...b.map(x => x.mtime)) - Math.max(...a.map(x => x.mtime)))[0]
    ?.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 3).map(x => x.path) || [];
}

function extractUrlFromCell(value) {
  const text = String(value || '');
  const match = text.match(/https?:\/\/[^\s)\]]+/);
  return match ? match[0] : '';
}

function asArrayCell(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function cellText(value) {
  if (Array.isArray(value)) return value.map(v => {
    if (v && typeof v === 'object') return v.name || v.text || v.value || JSON.stringify(v);
    return String(v || '');
  }).join(' ');
  if (value && typeof value === 'object') return value.name || value.text || value.value || JSON.stringify(value);
  return String(value || '');
}

function readCompetitorReferences(limit = 200) {
  const args = [
    'base', '+record-list',
    '--base-token', CFG.feishu.baseToken,
    '--table-id', COMPETITOR_TABLE_ID,
    '--limit', String(Math.min(Math.max(limit, 1), 200)),
    '--format', 'json',
  ];
  Object.values(COMPETITOR_FIELDS).forEach(fid => args.push('--field-id', fid));
  const out = larkCli(args);
  const rows = out.data?.data || [];
  const ids = out.data?.record_id_list || [];
  const fieldIds = out.data?.field_id_list || [];
  const idx = {};
  fieldIds.forEach((fid, i) => { idx[fid] = i; });
  return rows.map((row, i) => {
    const get = fid => row[idx[fid]];
    const attachments = asArrayCell(get(COMPETITOR_FIELDS.attachment))
      .filter(file => file && /\.(?:png|jpe?g|webp)$/i.test(file.name || 'file.jpg'));
    const url = extractUrlFromCell(get(COMPETITOR_FIELDS.noteUrl)) || extractUrlFromCell(get(COMPETITOR_FIELDS.sourceUrl));
    return {
      id: ids[i],
      url,
      title: cellText(get(COMPETITOR_FIELDS.title)),
      body: cellText(get(COMPETITOR_FIELDS.body)),
      tags: cellText(get(COMPETITOR_FIELDS.tags)),
      searchTerm: cellText(get(COMPETITOR_FIELDS.searchTerm)),
      matchTerm: cellText(get(COMPETITOR_FIELDS.matchTerm)),
      hotspot: cellText(get(COMPETITOR_FIELDS.hotspot)),
      purpose: cellText(get(COMPETITOR_FIELDS.purpose)),
      imageStatus: cellText(get(COMPETITOR_FIELDS.imageStatus)),
      category: cellText(get(COMPETITOR_FIELDS.category)),
      angle: cellText(get(COMPETITOR_FIELDS.angle)),
      brand: cellText(get(COMPETITOR_FIELDS.brand)),
      likes: Number(get(COMPETITOR_FIELDS.likes) || 0),
      collects: Number(get(COMPETITOR_FIELDS.collects) || 0),
      comments: Number(get(COMPETITOR_FIELDS.comments) || 0),
      shares: Number(get(COMPETITOR_FIELDS.shares) || 0),
      commentText: cellText(get(COMPETITOR_FIELDS.commentText)),
      commentImages: asArrayCell(get(COMPETITOR_FIELDS.commentImages)),
      attachments,
    };
  }).filter(r => r.id && r.url && r.attachments.length >= 1);
}

function scoreReferenceForTopic(ref, topic) {
  const hay = [ref.title, ref.body, ref.tags, ref.searchTerm, ref.matchTerm, ref.hotspot, ref.purpose, ref.angle, ref.brand].join(' ');
  const topicTerms = [
    topic?.trafficKeyword,
    topic?.coreConcept,
    ...(String(topic?.bridge || '').match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) || []).slice(0, 8),
  ].filter(Boolean).map(String);
  let score = 0;
  for (const term of topicTerms) {
    if (term && hay.includes(term)) score += term === topic?.trafficKeyword ? 8 : 3;
  }
  if (/图片参考|可直接换图/.test(ref.purpose)) score += 12;
  if (/热点话题/.test(ref.purpose)) score += 5;
  if (/调酒|氛围|生活|意境|分享/.test(ref.angle + ref.title + ref.tags)) score += 5;
  if (/文字封面参考/.test(ref.purpose)) score += 18;
  if (/叙事|造梦|城市|旅行|桌面/.test(ref.angle + ref.title + ref.tags)) score += 8;
  if (ref.attachments.length >= 6) score += 8;
  if (/无效|失败|重排失败|不合格/.test(ref.imageStatus + ref.purpose + ref.title)) score -= 50;
  if (/视频/.test(ref.category)) score -= 8;
  if (/测评|攻略|揭秘|真相|0失误|信息图/.test(ref.title) && !/可直接换图/.test(ref.purpose)) score -= 20;
  const ces = ref.likes + ref.collects + ref.comments * 4 + ref.shares * 4;
  if (ces > 0) score += Math.min(18, Math.log10(ces + 1) * 3);
  const effectiveCommentCount = String(ref.commentText || '').split(/\r?\n/).filter(line => /^\d+\.\s+/.test(line)).length;
  score += Math.min(6, effectiveCommentCount / 2);
  score += Math.min(6, ref.commentImages.length);
  score += Math.min(ref.attachments.length, 9);
  return score;
}

function isAutoImageReferenceUsable(ref) {
  const text = [ref.title, ref.body, ref.tags, ref.purpose, ref.angle, ref.category].join(' ');
  const mlCount = (text.match(/\b\d+\s*ml\b/gi) || []).length;
  // Only confirmed image/text notes may enter the image-post pipeline.
  // Empty legacy classifications are not evidence that a note is image/text.
  if (!/文案|图文/.test(ref.category) || /视频/.test(ref.category)) return false;
  if (/无效|失败|不合格|重排失败|跳过/.test(ref.imageStatus + ref.purpose + ref.title)) return false;
  if (/求个名字|取个名字|叫什么|不带.+字/.test(text)) return false;
  if (String(ref.body || '').replace(/\s+/g, '').length < 80) return false;
  if (/配方|公式|教程|攻略|揭秘|真相|测评|认识一款酒|信息图|知识点|一图秒懂|懂酒达人|基酒|酒单|合集|清单|无限回购|严选|穷人版/.test(ref.title)) return false;
  if (mlCount >= 2 && /调酒|鸡尾酒|金酒|糖浆|柠檬汁|菠萝汁/.test(text)) return false;
  const hasUsableScene = /氛围|生活|居家|聚会|餐桌|桌面|冰杯|酒饮|微醺|喝酒日常|调酒|鸡尾酒|露营|烧烤|便利店/.test(text);
  const hasImagePurpose = /图片参考|可直接换图|热点话题/.test(ref.purpose);
  return hasUsableScene && hasImagePurpose && ref.attachments.length >= 1;
}

function chooseReferenceForTopic(topic) {
  const refs = readCompetitorReferences(200)
    .filter(isAutoImageReferenceUsable)
    .map(ref => ({ ...ref, score: scoreReferenceForTopic(ref, topic) }))
    .filter(ref => ref.score > -10)
    .sort((a, b) => b.score - a.score);
  if (!refs.length) throw new Error('竞品表没有找到 3 张以上附件的可用参考 post');
  return refs[0];
}

function downloadCompetitorAttachments(recordId, maxImages = Number.POSITIVE_INFINITY) {
  const dir = path.join(__dirname, '.tmp', `daily-reference-${recordId}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const outputDir = path.relative(__dirname, dir) || '.';
  larkCli([
    'base', '+record-download-attachment',
    '--base-token', CFG.feishu.baseToken,
    '--table-id', COMPETITOR_TABLE_ID,
    '--record-id', recordId,
    '--output', outputDir,
    '--overwrite',
    '--format', 'json',
  ]);
  const files = fs.readdirSync(dir)
    .filter(name => /\.(?:png|jpe?g|webp)$/i.test(name))
    .filter(name => !/(?:^|[-_\s])comment(?:[-_\s]|\d|$)/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map(name => path.join(dir, name));
  return files.slice(0, maxImages);
}

function markCompetitorImageStatus(recordId, status) {
  if (!recordId || !status) return;
  try {
    updateBaseRecord(COMPETITOR_TABLE_ID, recordId, { 换图状态: status }, CFG.feishu.baseToken);
  } catch (e) {
    console.warn('[competitor status]', e.message);
  }
}

function parseDailyDraft(raw) {
  const plan = parsePlan(raw);
  let title = plan.titles?.[0] || '';
  let body = plan.body || '';
  const sectionTitle = String(raw || '').match(/(?:^|\n)\s*(?:#{1,4}\s*)?标题\s*\n+([^\n]+)/);
  if (sectionTitle?.[1]) title = sectionTitle[1].trim().replace(/^[-—（(\s]+|[）)\s]+$/g, '');
  const sectionBody = String(raw || '').match(/(?:^|\n)\s*(?:#{1,4}\s*)?正文\s*\n+([\s\S]*?)(?=\n\s*(?:#{1,4}\s*)?(?:评论区话术|优化方向|推断依据)|$)/);
  if (sectionBody?.[1]) body = sectionBody[1].trim();
  if (/备选标题|评论区话术|优化方向|推断依据/.test(body)) {
    body = body
      .replace(/^[\s\S]*?(?:^|\n)\s*(?:#{1,4}\s*)?正文\s*\n+/m, '')
      .replace(/\n\s*(?:#{1,4}\s*)?评论区话术[\s\S]*$/m, '')
      .replace(/\n\s*(?:#{1,4}\s*)?优化方向[\s\S]*$/m, '')
      .replace(/\n\s*(?:#{1,4}\s*)?推断依据[\s\S]*$/m, '')
      .trim();
  }
  if (!title) {
    const match = raw.match(/(?:\u6807\u9898\s*\d*|title)\s*[\uff1a:]\s*(.+)/i);
    title = match ? match[1].trim() : '';
  }
  if (!body) {
    const match = raw.match(/###\s*\u6b63\u6587\s*\n([\s\S]*?)(?=\n###|$)/);
    body = match ? match[1].trim() : raw.trim();
  }
  body = body
    .replace(/^\s*(?:编辑|編輯|Edit)\s*$/gim, '')
    .replace(/^\s*(?:标题|正文)\s*[：:]\s*/gm, '')
    .replace(/\n\s*(?:#[^\s#]+\s*){2,}[\s\S]*$/m, '')
    .trim();
  return { title: title || '\u4eca\u65e5\u5c0f\u7ea2\u4e66\u8349\u7a3f', body };
}

function buildReferenceBlueprintPrompt(reference) {
  return `只分析下面这一篇参考笔记，不谈产品、不做营销、不调用任何旧模板。

标题：${reference.title || ''}
正文：
${reference.body || ''}

输出严格 JSON：
{"coreSubject":"这篇真正写的生活主题，不是表层场景","centralTension":"叙述者在为什么犹豫、缺少或做选择","emotionalCurve":["起点","转折","落点"],"paragraphFunctions":["第1段作用"],"voice":"人称、语气、句长与留白","imageTextMechanism":"原文适合放进氛围图的文字机制","productExposure":"原文物件或产品出现比例"}

若正文为空或不足以判断，coreSubject 必须写 INVALID。`;
}

function parseReferenceBlueprint(raw) {
  const match = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('参考笔记主题分析没有返回 JSON');
  const parsed = JSON.parse(match[0]);
  if (!parsed.coreSubject || parsed.coreSubject === 'INVALID') throw new Error('参考笔记正文不足，不能据此仿写');
  return parsed;
}

function buildEngagementBlueprint(reference) {
  return {
    coreSubject: '互动共鸣封面：用一个真实小问题让用户停下、代入并愿意评论推荐',
    centralTension: sanitizeDailySeedText(`${reference?.title || ''} ${reference?.body || ''}`) || '想找一个不麻烦、不难入口的晚间小酌选择',
    emotionalCurve: ['一句问题停留', '读者代入自己的小酌场景', '评论区给出推荐'],
    paragraphFunctions: ['开头直接抛问题', '中间给出自己正在寻找的标准', '结尾邀请评论推荐'],
    voice: '口语、短句、像真实用户发问，不写测评腔',
    imageTextMechanism: '大字互动问题，文字少，留白明确，核心是评论入口',
    productExposure: '首图不露产品，正文和话题轻挂品牌词与搜索词',
  };
}

function buildDailyReferencePrompt(reference, topic, insight, blueprint) {
  const searchTerms = [...new Set([
    insight?.coreSearchTerm,
    ...(insight?.longTailTerms || []),
    ...(topic?.searchTerms || []),
    topic?.trafficKeyword,
  ].filter(Boolean).map(String))];
  const multiProductRule = /酒单|回购|严选|测评|评测|合集|清单|推荐|九宫格|多款|多瓶|top|TOP|榜单|横评/i.test([
    reference?.title,
    reference?.category,
    reference?.purpose,
    reference?.angle,
    reference?.body,
  ].map(v => String(v || '')).join(' ')) ? `

## 多产品/酒单测评硬规则
这篇参考属于多产品、酒单、合集、严选、回购或测评类时，只允许替换“第一款产品 / 第一个推荐位 / 左上角或首个出现的产品位”。
- 文案结构可以保留多产品清单感，但每天烈刻只能占第一个产品位。
- 其它产品位不得被改成每天烈刻，也不得虚构每天烈刻的其它 SKU、其它口味或其它排名。
- 正文只围绕第一款替换位解释每天烈刻为什么适合作为本清单里的第一个选择；其它位置最多写成泛化陪衬，不写竞品品牌名。
- 图片换图也只替换第一款产品，其它产品、格子、排版和背景逻辑保持原参考图的多产品测评感。` : '';

  return `你只完成一次“单篇参考笔记改写”。不要调用或复用 Market Hub 的旧框架、旧范文、固定种草结构、火锅聚会开场或产品测评套路。

## 最高优先级：参考笔记主题指纹
真正主题：${blueprint?.coreSubject || ''}
核心矛盾：${blueprint?.centralTension || ''}
情绪推进：${(blueprint?.emotionalCurve || []).join(' → ')}
段落功能：${(blueprint?.paragraphFunctions || []).join(' / ')}
叙述声音：${blueprint?.voice || ''}
氛围图文字机制：${blueprint?.imageTextMechanism || ''}
原文产品露出：${blueprint?.productExposure || ''}
${multiProductRule}

成稿必须仍在谈这个主题和矛盾。市场洞察、搜索词与产品只能进入原文已有的叙事位置，不能另起一个饮酒故事。

## 唯一写作蓝本
标题：${reference.title}
原话题：${reference.tags || '无'}
正文：
${reference.body}

## 本次市场洞察
洞察：${insight?.name || ''}
搜索行为链：${(insight?.searchBehaviorChain || []).join(' → ')}
搜索意图：${insight?.searchIntent || ''}
用户问题：${insight?.userProblem || ''}
决策阶段：${insight?.decisionStage || ''}
内容任务：${insight?.contentTask || ''}
使用场景：${insight?.scene || ''}
想进入的状态：${insight?.desiredState || ''}
物件承载：${(insight?.objectCarriers || []).join(' / ')}
造梦三时刻：
${(insight?.dreamMoments || []).map((v, i) => `${i + 1}. ${v}`).join('\n')}
参考笔记筛选要求：${insight?.referenceNeed || ''}
产品承接：${insight?.productBridge || ''}

## 搜索布局
核心搜索词：${searchTerms[0] || ''}
长尾词：${searchTerms.slice(1).join(' / ')}
固定必带话题词：气泡白酒 / 每天烈刻气泡白酒

原话题只用来识别参考笔记的流量入口和互动机制，不允许直接继承。凡是原话题里的竞品品牌、产品名、代言人、活动口号、同款词、平台广告词，全部删除，不得进入标题、正文或话题。

布局顺序：
1. 标题必须优先复现参考标题的点击机制和情绪钩子；搜索词不硬塞进标题，除非它本身就是最自然的点击句。
2. 正文前 120 字必须自然出现核心搜索词；不能硬塞，必须是叙述者真实处境里的问句、判断句或选择句。
3. 长尾词不要求逐字生硬堆砌；允许嵌入长句中形成可被搜索切中的连续片段。比如长尾词“夫人”可以存在于“丈夫人很好”这种连续文本片段里，但不能为了埋词破坏语义。
4. 至少 2 个长尾词要分散进入正文中段/结尾/评论引导，不集中堆在一段。
5. 话题标签承担收录补充：必须包含 #气泡白酒 和 #每天烈刻气泡白酒；再补 1 个核心词、2-3 个长尾词、1-2 个品类词。不用泛泛的 #生活 #分享，也不得继承原话题里的竞品广告 tag。
6. 如果参考文是品牌调性/造梦/巴黎式母本，搜索词只作为“可被搜到的暗线”，不得压过母本的审美、情绪和标题机制。

## 可使用的少量产品事实（最多取两条）
${loadBrandFacts().slice(0, 2200)}

## 改写规则
1. 第一优先级是复现“真正主题 + 核心矛盾 + 情绪推进 + 段落作用”，不是复现表面名词。读者看完必须能说出它与参考文在讨论同一种人生问题。
2. 段落数量与原文相差不超过 1 段。每段继续承担原文对应段落的作用，内容和句子必须原创。
3. 市场洞察只负责提供搜索意图和造梦材料：把“用户为什么搜、想进入什么状态、三个具体时刻”融进原文已有主题。不要把它改成旧的 Market Hub 饮酒测评模板。
4. 产品只在原文出现物件、饮用动作或消费选择的位置进入；产品露出比例跟随原文。若原文没有产品中心段，品牌只允许作为一个生活物件出现一次。
   参考文里的竞品品牌、酒名、口味、颜色、包装和购买数量全部只是占位符，成稿不得保留；只能换成“可使用的少量产品事实”里真实存在的每天烈刻信息。
5. 搜索词必须被改写成符合叙述者处境的自然语句；不能为了埋词把地点、人物、事件改成聚会、火锅、测评或第一口体验。核心词进入前 120 字正文，至少两个长尾词进入后文；长尾词可以作为连续字词片段自然藏在一句话里。成稿里要能明确看见搜索布局：正文前段有核心词，中后段有长尾词，话题有核心词/长尾词。
6. 正文只使用一个主产品事实，最多一个辅助事实。不得把资料平均铺满。
7. 正文至少保留两段可直接放进氛围图片的文字：每段 45-120 字，写人生处境、选择或情绪转折，不写口感、参数、购买和劝酒。
8. 标题保留参考标题的点击机制，控制在 20 个汉字左右；标题负责停留和点击，搜索意图主要交给正文前 120 字与标签承接。不得连续复用参考标题 6 个以上相同字词。正文末尾附未成年人及孕妇禁酒提示。
9. 输出前自检：若正文的主语换成任意酒仍成立、或主题变成“什么时候喝/好不好喝”，说明已经跑偏，必须重写后再输出。
10. 直接输出成品，不解释方法，不输出优化方向、推断依据或写作分析。

严格格式：
### 标题
（一个标题）

### 正文
（完整正文）`;
}

function collectDailyDraftIssues(draft, reference, topic, insight) {
  const issues = [];
  const title = String(draft?.title || '').trim();
  const body = String(draft?.body || '').trim();
  const all = `${title}\n${body}`;
  const searchTerms = [...new Set([
    insight?.coreSearchTerm,
    ...(insight?.longTailTerms || []),
    ...(topic?.searchTerms || []),
    topic?.trafficKeyword,
  ].filter(Boolean).map(String))];
  if (title.length < 8 || title.length > 28) issues.push('标题长度不适合小红书，需要 8-28 个汉字左右');
  if (/[，,、；;：:]$/.test(title) || /想囤点$|喝什么$/.test(title)) issues.push('标题像半句话或烂尾，需要完整、有点击点');
  if (body.length < 160) issues.push('正文太短，无法承接参考文的主题和搜索词布局');
  if (/崩溃.*喝酒|靠酒|治愈|修好|恢复行动力|续命|救命|解药|无负担|0负担|刮油|解腻|不上头|不醉|不伤身|健康喝酒/.test(all)) {
    issues.push('存在不适合酒类内容的情绪/健康暗示，需要改成生活状态与小仪式，不写靠酒解决问题');
  }
  if (/330ml|500ml|750ml/.test(all) && !/330ml|500ml|750ml/.test(loadBrandFacts())) {
    issues.push('出现了资料里未确认的容量参数，需要删除');
  }
  if (hasDailyCompetitorOrAdTerm(all)) {
    issues.push('残留了参考笔记里的竞品品牌、代言人、活动口号或广告词，必须删除并改写为每天烈刻自己的表达');
  }
  if (searchTerms[0] && !all.includes(searchTerms[0])) {
    issues.push(`核心搜索词「${searchTerms[0]}」没有布局`);
  }
  const longTailHits = searchTerms.slice(1).filter(term => term && all.includes(term)).length;
  if (searchTerms.slice(1).length >= 2 && longTailHits < 2) {
    issues.push('长尾搜索词布局不足，至少自然放入两个');
  }
  const referenceBody = String(reference?.body || '');
  if (referenceBody && body && body.includes(referenceBody.slice(0, 30))) {
    issues.push('正文疑似直接复用参考原文，需要保留主题结构但重写表达');
  }
  return issues;
}

function buildDailyDraftRepairPrompt(draft, reference, topic, insight, blueprint, issues) {
  const searchTerms = [...new Set([
    insight?.coreSearchTerm,
    ...(insight?.longTailTerms || []),
    ...(topic?.searchTerms || []),
    topic?.trafficKeyword,
  ].filter(Boolean).map(String))];
  return `只修下面这篇小红书草稿。保留参考笔记的主题指纹，不要回到旧 Market Hub 模板，不要另起炉灶。

参考笔记主题：${blueprint?.coreSubject || ''}
核心矛盾：${blueprint?.centralTension || ''}
参考标题：${reference?.title || ''}
参考正文：${reference?.body || ''}

搜索词要求：
核心搜索词：${searchTerms[0] || ''}
长尾词：${searchTerms.slice(1).join(' / ')}
品牌词：每天烈刻气泡白酒

需要修掉的问题：
${issues.map((item, i) => `${i + 1}. ${item}`).join('\n')}

当前草稿：
### 标题
${draft.title || ''}

### 正文
${draft.body || ''}

修稿要求：
1. 标题写完整，保留点击点；核心搜索词优先进入前 120 字正文，标题不为埋词牺牲点击感。
2. 至少两个长尾词自然进入正文，像真实搜索或自问，不像堆词。
3. 酒只能作为生活物件、小仪式、场景道具出现；不写靠酒解决情绪、健康、睡眠或身体问题。
4. 氛围图可取的句子要短、安静、完整；正文里至少保留 2 句适合放在图上的短句。
5. 不输出分析，不输出优化方向。

严格格式：
### 标题
（一个标题）

### 正文
（完整正文）`;
}

async function repairDailyDraftIfNeeded(draft, reference, topic, insight, blueprint) {
  const firstIssues = collectDailyDraftIssues(draft, reference, topic, insight);
  if (!firstIssues.length) return { draft, issues: [], repairedFrom: [] };
  const repairedRaw = await runClaudeAsync(
    buildDailyDraftRepairPrompt(draft, reference, topic, insight, blueprint, firstIssues),
    300000,
  );
  const repaired = parseDailyDraft(repairedRaw);
  const secondIssues = collectDailyDraftIssues(repaired, reference, topic, insight);
  return { draft: repaired, issues: secondIssues, repairedFrom: firstIssues };
}

const DAILY_REQUIRED_TAGS = ['气泡白酒', '每天烈刻气泡白酒'];
const DAILY_SAFE_FALLBACK_TAGS = ['低度酒', '微醺', '小酌'];
const DAILY_COMPETITOR_OR_AD_RE = /张裕|熊司令|于适|于适同款|小熊|盒马|山姆|Costco|开市客|酒鬼严选|RIO|锐澳|梅见|贝瑞甜心|十七光年|江小白|野格|百利甜|巴黎水|Perrier|三得利|朝日|麒麟|雪花|青岛|百威|喜力|科罗娜|莫奈花园|琉璃|喜茶|茶特调|酸木瓜|枇杷|同款|代言|官方|旗舰店|联名|真实力不用装/i;
const DAILY_WRONG_CATEGORY_RE = /葡萄酒|果汁葡萄酒|红酒|白葡萄|威士忌|啤酒|精酿|清酒|莫斯卡托|甜白|起泡酒/i;
const DAILY_UNSAFE_CLAIM_RE = /0负担|无负担|解腻|刮油|不上头|不醉|不伤身|健康喝酒|减肥|助眠|治愈|续命|救命|330ml|500ml|750ml/i;
const DAILY_GENERIC_TAG_RE = /^(生活|分享|日常|好物|种草|推荐|我的日常)$/i;

function hasDailyCompetitorOrAdTerm(value) {
  return DAILY_COMPETITOR_OR_AD_RE.test(String(value || ''));
}

function normalizeDailyTag(value) {
  return String(value || '')
    .replace(/^#+/, '')
    .replace(/\[话题\]$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function isUnsafeDailyTag(value) {
  const tag = normalizeDailyTag(value);
  if (!tag || tag.length < 2 || tag.length > 24) return true;
  if (DAILY_REQUIRED_TAGS.includes(tag)) return false;
  if (DAILY_COMPETITOR_OR_AD_RE.test(tag)) return true;
  if (DAILY_UNSAFE_CLAIM_RE.test(tag)) return true;
  if (DAILY_WRONG_CATEGORY_RE.test(tag) && !/气泡白酒|白酒/.test(tag)) return true;
  if (DAILY_GENERIC_TAG_RE.test(tag)) return true;
  return false;
}

function isUnsafeDailySearchTerm(value) {
  const term = String(value || '').trim();
  if (!term || term.length < 2 || term.length > 32) return true;
  if (DAILY_COMPETITOR_OR_AD_RE.test(term)) return true;
  if (DAILY_UNSAFE_CLAIM_RE.test(term)) return true;
  if (DAILY_WRONG_CATEGORY_RE.test(term) && !/气泡白酒|白酒/.test(term)) return true;
  return false;
}

function collectDailySearchTerms(topic, insight) {
  return [...new Set([
    insight?.coreSearchTerm,
    ...(insight?.longTailTerms || []),
    ...(topic?.searchTerms || []),
    topic?.trafficKeyword,
    topic?.coreConcept,
  ].filter(Boolean).map(value => String(value).trim()).filter(value => !isUnsafeDailySearchTerm(value)))];
}

function buildDailyTags(reference, topic, insight) {
  const mandatory = DAILY_REQUIRED_TAGS;
  const searchTerms = collectDailySearchTerms(topic, insight);
  const referenceTags = String(reference?.tags || '').match(/#[^#\s\[\]]+/g) || [];
  const raw = [
    ...mandatory,
    ...searchTerms,
    topic?.trafficKeyword,
    topic?.coreConcept,
    ...(topic?.searchTerms || []),
    ...referenceTags,
    ...DAILY_SAFE_FALLBACK_TAGS,
  ];
  const cleaned = raw.map(normalizeDailyTag).filter(value => !isUnsafeDailyTag(value));
  const unique = [...new Set(cleaned)];
  const ordered = [
    ...mandatory,
    ...searchTerms.map(normalizeDailyTag).filter(value => !mandatory.includes(value) && !isUnsafeDailyTag(value)),
    ...unique.filter(value => !mandatory.includes(value)),
  ];
  return [...new Set(ordered)].slice(0, 10).map(value => `#${value}`).join(' ');
}

function sanitizeDailyTagString(value, { keepFallback = true } = {}) {
  const rawTags = String(value || '').match(/#[^#\s\[\]]+/g) || String(value || '').split(/[\s,，;；/]+/);
  const cleaned = rawTags
    .map(normalizeDailyTag)
    .filter(tag => tag && !isUnsafeDailyTag(tag));
  const ordered = [
    ...DAILY_REQUIRED_TAGS,
    ...cleaned.filter(tag => !DAILY_REQUIRED_TAGS.includes(tag)),
    ...(keepFallback ? DAILY_SAFE_FALLBACK_TAGS : []),
  ];
  return [...new Set(ordered)]
    .slice(0, 10)
    .map(tag => `#${tag}`)
    .join(' ');
}

function sanitizeDailySeedText(value) {
  return String(value || '')
    .replace(/0糖0负担/g, '0糖')
    .replace(/0负担|无负担/g, '')
    .replace(/解腻刮油|刮油|解腻/g, '清爽')
    .replace(/不醉|不上头|不伤身|健康喝酒/g, '')
    .replace(/330ml|500ml|750ml/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeDailySeed(value) {
  if (Array.isArray(value)) return value.map(sanitizeDailySeed).filter(v => v !== '');
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeDailySeed(item)]));
  }
  return typeof value === 'string' ? sanitizeDailySeedText(value) : value;
}

function loadTopicDigest() {
  return loadTopicJson(TOPIC_RECOMMENDATIONS_PATH, { generatedAt: null, recommendations: [] });
}

function saveTopicDigest(digest) {
  fs.writeFileSync(TOPIC_RECOMMENDATIONS_PATH, JSON.stringify(digest || { recommendations: [] }, null, 2), 'utf8');
  return digest;
}

function topicHasUsableEvidence(topic) {
  return Array.isArray(topic?.evidence) && topic.evidence.some(item => /^https?:\/\//.test(String(item?.url || '')));
}

function pickTopicForRun(digest, { forceDigest = false } = {}) {
  const recommendations = Array.isArray(digest?.recommendations) ? digest.recommendations : [];
  if (forceDigest || !isFreshTimestamp(digest?.generatedAt, TOPIC_DIGEST_TTL_MS) || !recommendations.length) {
    return { topic: null, needsRefresh: true, reason: forceDigest ? '手动强制刷新' : '热点库存为空或已超过 3 天' };
  }
  const usable = recommendations.filter(topic => topicHasUsableEvidence(topic));
  const unused = usable.filter(topic => !topic.usedAt);
  const pool = unused.length ? unused : usable;
  const topic = [...pool].sort((a, b) => {
    const usedDelta = parseTimeMs(a.usedAt) - parseTimeMs(b.usedAt);
    if (usedDelta) return usedDelta;
    return Number(b.score || 0) - Number(a.score || 0);
  })[0] || null;
  if (!topic) return { topic: null, needsRefresh: true, reason: '热点没有可登记的笔记链接' };
  return { topic, needsRefresh: false, reason: unused.length ? '使用未消耗热点库存' : '热点库存已轮完，复用最早使用的一条' };
}

function markTopicUsed(topicId, patch = {}) {
  const digest = loadTopicDigest();
  const target = (digest.recommendations || []).find(item => item.id === topicId);
  if (target) {
    Object.assign(target, patch, { usedAt: new Date().toISOString() });
    saveTopicDigest(digest);
  }
  return target;
}

function runCompetitorEnricher(recordId) {
  const script = path.join(__dirname, 'scripts', 'enrich_competitor_from_xhs.py');
  const result = spawnSync('python', [script, '--record-ids', recordId, '--max-images', '9', '--max-comments', '10'], {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 240000,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', HTTPS_PROXY: process.env.HTTPS_PROXY || 'http://127.0.0.1:7890', HTTP_PROXY: process.env.HTTP_PROXY || 'http://127.0.0.1:7890' },
  });
  if (result.error) throw result.error;
  let parsed = {};
  try { parsed = JSON.parse(result.stdout || '{}'); } catch {}
  const row = parsed.results?.[0];
  if (result.status !== 0 || !row?.ok) throw new Error(row?.error || result.stderr || '竞品笔记抓取失败');
  return row;
}

function extractXhsNoteIdFromUrl(url) {
  const text = String(url || '');
  return text.match(/(?:explore|discovery\/item)\/([0-9a-f]{20,32})/i)?.[1] || '';
}

function normalizeReferenceUrl(value) {
  const raw = String(value || '').trim().split('?')[0].replace(/\/$/, '');
  const noteId = extractXhsNoteIdFromUrl(raw);
  return noteId ? `xhs:${noteId}` : raw;
}

function findCompetitorRecordIdByUrl(url) {
  const target = normalizeReferenceUrl(url);
  if (!target) return '';
  const out = larkCli([
    'base', '+record-list', '--base-token', CFG.feishu.baseToken,
    '--table-id', COMPETITOR_TABLE_ID, '--limit', '200',
    '--field-id', COMPETITOR_FIELDS.sourceUrl,
    '--field-id', COMPETITOR_FIELDS.noteUrl,
    '--format', 'json',
  ]);
  const rows = out.data?.data || [];
  const ids = out.data?.record_id_list || [];
  const fields = out.data?.field_id_list || [];
  const sourceIndex = fields.indexOf(COMPETITOR_FIELDS.sourceUrl);
  const noteIndex = fields.indexOf(COMPETITOR_FIELDS.noteUrl);
  const index = rows.findIndex(row => {
    const candidate = extractUrlFromCell(row[noteIndex]) || extractUrlFromCell(row[sourceIndex]);
    return candidate && normalizeReferenceUrl(candidate) === target;
  });
  return index >= 0 ? ids[index] : '';
}

function ensureCompetitorReferenceForTopic(topic, insight, options = {}) {
  const excludeReferenceIds = new Set((options.excludeReferenceIds || []).map(String).filter(Boolean));
  const excludeReferenceUrls = new Set((options.excludeReferenceUrls || []).map(normalizeReferenceUrl).filter(Boolean));
  const maxReferenceImages = Number.isFinite(Number(options.maxReferenceImages))
    ? Math.max(1, Number(options.maxReferenceImages))
    : Number.POSITIVE_INFINITY;
  const candidates = [...new Set((topic?.evidence || []).map(item => String(item?.url || '').trim()).filter(Boolean))];
  if (!candidates.length) throw new Error('本次热点没有携带具体笔记链接，已停止，避免拿无关旧笔记凑数');
  const failures = [];
  const validReferences = [];
  for (const url of candidates) {
    try {
      const cleanUrl = normalizeReferenceUrl(url);
      if (excludeReferenceUrls.has(cleanUrl)) {
        failures.push(`${cleanUrl}：已按本轮要求排除旧参考`);
        continue;
      }
      let recordId = findCompetitorRecordIdByUrl(url);
      if (recordId && excludeReferenceIds.has(recordId)) {
        failures.push(`${cleanUrl}：已按本轮要求排除旧参考记录 ${recordId}`);
        continue;
      }
      if (!recordId) {
        const created = writeToBase(COMPETITOR_TABLE_ID, {
          地址贴这里: url,
          笔记地址: url,
          热点来源: topic.coreConcept || topic.trafficKeyword || insight?.name || '市场洞察',
          搜索词: insight?.coreSearchTerm || topic.trafficKeyword || '',
          匹配词: [...new Set([...(insight?.longTailTerms || []), ...(topic.searchTerms || [])])].join(' / '),
          换图状态: '待抓取',
        }, CFG.feishu.baseToken);
        recordId = extractRecordIdFromWrite(created) || findCompetitorRecordIdByUrl(url);
      }
      if (!recordId) throw new Error('登记后没有返回 record_id');
      let ref = readCompetitorReferences(260).find(item => item.id === recordId);
      if (!ref || String(ref.body || '').replace(/\s+/g, '').length < 80) {
        runCompetitorEnricher(recordId);
        ref = readCompetitorReferences(260).find(item => item.id === recordId);
      }
      const bodyLength = String(ref?.body || '').replace(/\s+/g, '').length;
      if (!ref || /视频/.test(ref.category || '') || bodyLength < 80) {
        try { markCompetitorImageStatus(recordId, /视频/.test(ref?.category || '') ? '视频待转写' : '正文过短'); } catch {}
        throw new Error(/视频/.test(ref?.category || '') ? '视频笔记暂不用于本轮图文仿写' : `正文仅 ${bodyLength} 字`);
      }
      const attachmentCount = Array.isArray(ref.attachments) ? ref.attachments.length : 0;
      if (attachmentCount > maxReferenceImages) {
        failures.push(`${cleanUrl}：参考图 ${attachmentCount} 张，超过本轮上限 ${maxReferenceImages} 张`);
        continue;
      }
      validReferences.push({ ...ref, score: scoreReferenceForTopic(ref, topic) });
    } catch (error) {
      failures.push(`${url.split('?')[0]}：${error.message}`);
    }
  }
  if (validReferences.length) {
    return validReferences.sort((a, b) => b.score - a.score)[0];
  }
  throw new Error(`候选热点笔记都不满足“正文与图片同源且正文完整”：${failures.join('；')}`);
}

function registerManualCompetitorReference(url, meta = {}) {
  const cleanUrl = String(url || '').trim();
  if (!/^https?:\/\/(www\.)?xiaohongshu\.com\//i.test(cleanUrl)) {
    throw new Error('请粘贴有效的小红书笔记链接');
  }
  let recordId = findCompetitorRecordIdByUrl(cleanUrl);
  if (!recordId) {
    const created = writeToBase(COMPETITOR_TABLE_ID, {
      地址贴这里: cleanUrl,
      笔记地址: cleanUrl,
      热点来源: meta.source || '人工指定母本',
      搜索词: meta.searchTerm || '',
      匹配词: meta.matchTerm || '',
      参考用途: meta.purpose || '人工灵感入库 / 可直接仿写',
      换图状态: '待抓取',
    }, CFG.feishu.baseToken);
    recordId = extractRecordIdFromWrite(created) || findCompetitorRecordIdByUrl(cleanUrl);
  }
  if (!recordId) throw new Error('登记竞品表后没有拿到 record_id');
  let ref = readCompetitorReferences(300).find(item => item.id === recordId);
  const existingTitle = String(ref?.title || '').trim();
  const existingBodyLength = String(ref?.body || '').replace(/\s+/g, '').length;
  const existingAttachmentCount = Array.isArray(ref?.attachments) ? ref.attachments.length : 0;
  if (existingTitle && existingBodyLength >= 40 && existingAttachmentCount >= 1) {
    try {
      updateBaseRecord(COMPETITOR_TABLE_ID, recordId, {
        热点来源: meta.source || ref.hotspot || '人工指定母本',
        搜索词: meta.searchTerm || ref.searchTerm || '',
        匹配词: meta.matchTerm || ref.matchTerm || '',
        参考用途: meta.purpose || ref.purpose || '人工灵感入库 / 可直接仿写',
      }, CFG.feishu.baseToken);
      ref = readCompetitorReferences(300).find(item => item.id === recordId) || ref;
    } catch {}
    return ref;
  }
  runCompetitorEnricher(recordId);
  ref = readCompetitorReferences(300).find(item => item.id === recordId);
  if (!ref) throw new Error(`竞品记录已登记但读取失败：${recordId}`);
  const title = String(ref.title || '').trim();
  const bodyLength = String(ref.body || '').replace(/\s+/g, '').length;
  const attachmentCount = Array.isArray(ref.attachments) ? ref.attachments.length : 0;
  if (!title || bodyLength < 40 || attachmentCount < 1) {
    try { markCompetitorImageStatus(recordId, `入库不完整：标题=${title ? '有' : '空'}，正文=${bodyLength}字，图片=${attachmentCount}张`); } catch {}
    throw new Error(`母本入库不完整：标题=${title ? '有' : '空'}，正文=${bodyLength}字，图片=${attachmentCount}张。不能只登记空链接。`);
  }
  return ref;
}

function inferQueueSceneMode(reference, engagementCover = false) {
  if (engagementCover) return 'engagement_cover';
  const text = [
    reference?.title,
    reference?.category,
    reference?.purpose,
    reference?.angle,
    reference?.body,
  ].map(v => String(v || '')).join(' ');
  if (/酒单|回购|严选|测评|评测|合集|清单|榜单|横评|九宫格|多款|多瓶|TOP|top/i.test(text)) {
    return 'product_replace';
  }
  if (/巴黎|品牌调性|人工指定母本/i.test(text) && /巴黎水|perrier|易拉罐|罐|瓶|产品/i.test(text)) {
    return 'auto';
  }
  if (/造梦|氛围|文字图|情绪|生活方式|街景|风景|截图|金句/i.test(text)) {
    return 'atmosphere';
  }
  if (/产品|瓶|罐|包装|开箱|种草|品酒|葡萄酒|起泡酒|甜酒|莫斯卡托|果酒/i.test(text)) {
    return 'product_replace';
  }
  return 'auto';
}

app.post('/api/daily/intake-reference', (req, res) => {
  try {
    const ref = registerManualCompetitorReference(req.body?.url || '', {
      source: req.body?.source || '人工指定母本',
      searchTerm: req.body?.searchTerm || '',
      matchTerm: req.body?.matchTerm || '',
      purpose: req.body?.purpose || '人工灵感入库 / 可直接仿写',
    });
    res.json({
      ok: true,
      reference: {
        id: ref.id,
        title: ref.title,
        url: ref.url,
        category: ref.category,
        purpose: ref.purpose,
        attachmentCount: ref.attachments?.length || 0,
      },
    });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.get('/api/daily/preview-reference', (req, res) => {
  try {
    const digest = loadTopicJson(TOPIC_RECOMMENDATIONS_PATH, { recommendations: [] });
    const topic = [...(digest.recommendations || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
    if (!topic) throw new Error('\u6ca1\u6709\u53ef\u7528\u7684\u70ed\u70b9\u9009\u9898');
    const requestedReferenceId = String(req.query.id || req.query.referenceId || '').trim();
    const selectedReference = requestedReferenceId
      ? readCompetitorReferences(300).find(ref => ref.id === requestedReferenceId)
      : chooseReferenceForTopic(topic);
    if (!selectedReference) throw new Error(`指定的竞品记录不存在：${requestedReferenceId}`);
    res.json({
      ok: true,
      topic: {
        coreConcept: topic.coreConcept || '',
        trafficKeyword: topic.trafficKeyword || '',
        searchTerms: topic.searchTerms || [],
        score: topic.score || '',
      },
      reference: {
        id: selectedReference.id,
        title: selectedReference.title,
        url: selectedReference.url,
        purpose: selectedReference.purpose,
        category: selectedReference.category,
        angle: selectedReference.angle,
        score: selectedReference.score,
        attachmentCount: selectedReference.attachments.length,
      },
    });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.get('/api/daily/preview-references', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(30, Number(req.query.limit || 12)));
    const digest = loadTopicJson(TOPIC_RECOMMENDATIONS_PATH, { recommendations: [] });
    const topic = [...(digest.recommendations || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
    if (!topic) throw new Error('\u6ca1\u6709\u53ef\u7528\u7684\u70ed\u70b9\u9009\u9898');
    const references = readCompetitorReferences(260)
      .filter(isAutoImageReferenceUsable)
      .map(ref => ({ ...ref, score: scoreReferenceForTopic(ref, topic) }))
      .filter(ref => ref.score > -10)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(ref => ({
        id: ref.id,
        title: ref.title,
        url: ref.url,
        purpose: ref.purpose,
        category: ref.category,
        angle: ref.angle,
        score: ref.score,
        attachmentCount: ref.attachments.length,
      }));
    res.json({ ok: true, topic: { coreConcept: topic.coreConcept || '', trafficKeyword: topic.trafficKeyword || '', score: topic.score || '' }, references });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.get('/api/daily/health', async (req, res) => {
  res.json(await getDailyAutomationHealth());
});

app.get('/api/gpt/preflight', (req, res) => {
  try {
    const preflight = runGptRecoveryHarness(null);
    res.json({ ok: true, preflight });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.get('/api/daily/status', async (req, res) => {
  const health = await getDailyAutomationHealth();
  res.json({
    ok: true,
    health,
    jobs: [...dailyRunStore.values()].map(job => ({
      id: job.id,
      ok: job.ok,
      done: job.done,
      startedAt: job.startedAt,
      error: job.error,
      result: job.result,
      logs: job.logs,
    })),
  });
});

app.post('/api/daily/run', (req, res) => {
  const running = [...dailyRunStore.values()].find(job => !job.done);
  if (running) return res.json({ ok: true, jobId: running.id, resumed: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const job = { id, done: false, ok: true, error: '', logs: [], result: {} };
  dailyRunStore.set(id, job);
  res.json({ ok: true, jobId: id });

  (async () => {
    try {
      dailyLog(job, '第 0 步：读取市场洞察库存（7 天内轮用）');
      let insightPick = pickMarketInsightForRun({ forceInsight: req.body?.forceInsight === true });
      let insight = insightPick.insight;
      let insightWasCreated = false;
      if (insightPick.needsRefresh) {
        dailyLog(job, `市场洞察需要刷新：${insightPick.reason}`);
        const savedInsightState = loadMarketInsights();
        const collected = await collectSignalsForMarketInsight(savedInsightState.manualBehavior || '', { forceCollect: true });
        const broadSignals = collected.signals;
        const insightPrompt = buildMarketInsightPrompt(broadSignals, savedInsightState.manualBehavior || '', collected.seedPlan, collected.validation);
        const rawInsight = await runClaudeAsync(insightPrompt, 300000);
        const parsedInsights = parseMarketInsights(rawInsight);
        saveMarketInsights({
          ...parsedInsights,
          selectedId: '',
          manualBehavior: savedInsightState.manualBehavior || '',
          lastPrompt: insightPrompt,
          lastSeedPrompt: collected.seedPrompt,
          lastSeedPlan: collected.seedPlan,
          lastValidation: collected.validation,
          usefulSeeds: collected.usefulSeeds,
          lastSignals: compactInsightSignals(broadSignals),
        });
        insight = [...parsedInsights.insights].sort((a, b) => b.score - a.score)[0];
        insight = selectMarketInsight(insight.id).insight;
        insightWasCreated = true;
      } else {
        dailyLog(job, `市场洞察复用：${insightPick.reason}`);
      }
      dailyLog(job, `市场洞察已采用并登记飞书：${insight.name}｜${insight.coreSearchTerm}`);

      const requestedReferenceId = String(req.body?.referenceId || '').trim();
      let topic;
      let selectedReference;
      if (requestedReferenceId) {
        selectedReference = readCompetitorReferences(300).find(ref => ref.id === requestedReferenceId);
        if (!selectedReference) throw new Error(`指定的竞品记录不存在：${requestedReferenceId}`);
        topic = {
          id: `manual-${requestedReferenceId}`,
          kind: '人工指定参考',
          trafficKeyword: selectedReference.searchTerm || insight.coreSearchTerm || '',
          coreConcept: selectedReference.hotspot || selectedReference.title,
          searchTerms: [...new Set([
            selectedReference.searchTerm,
            ...String(selectedReference.matchTerm || '').split(/\s*\/\s*|[，,；;]/),
          ].filter(Boolean))],
          bridge: `以人工指定笔记“${selectedReference.title}”的主题、结构和互动机制为母本；市场洞察只补充搜索意图与产品承接。`,
          score: 100,
        };
        dailyLog(job, `第 1 步：使用人工指定参考；不再另抓热点覆盖母本｜${selectedReference.title}`);
      } else {
        dailyLog(job, '第 1 步：读取热点库存（3 天内且未用完则不刷新）');
        let signals = loadTopicJson(TOPIC_SIGNALS_PATH, null);
        let digest = loadTopicDigest();
        let topicPick = pickTopicForRun(digest, { forceDigest: req.body?.forceDigest === true || req.body?.forceCollect === true });
        if (req.body?.forceCollect === true || insightWasCreated || !signals || topicPick.needsRefresh) {
          dailyLog(job, topicPick.needsRefresh ? `热点需要刷新：${topicPick.reason}` : '热点信号需要刷新');
          await runTopicCollector();
          signals = loadTopicJson(TOPIC_SIGNALS_PATH, null);
          dailyLog(job, '洞察定向热点信号采集完成');
        } else {
          dailyLog(job, `热点复用：${topicPick.reason}`);
        }
        digest = loadTopicDigest();
        topicPick = pickTopicForRun(digest, { forceDigest: req.body?.forceDigest === true || req.body?.forceCollect === true });
        if (signals && !signals.error && topicPick.needsRefresh) {
          try {
            const rawDigest = await runClaudeAsync(buildTopicDigestPrompt(signals), 300000);
            digest = parseTopicDigest(rawDigest);
            digest.generatedAt = new Date().toISOString();
            saveTopicDigest(digest);
            dailyLog(job, '热点筛选与选题评分完成');
          } catch (error) {
            dailyLog(job, `选题重算失败，沿用最近结果：${error.message}`);
          }
        }
        topicPick = pickTopicForRun(loadTopicDigest(), { forceDigest: false });
        topic = topicPick.topic;
        if (!topic) throw new Error('没有可用的热点选题');
        const excludeReferenceIds = Array.isArray(req.body?.excludeReferenceIds) ? req.body.excludeReferenceIds : [];
        const excludeReferenceUrls = Array.isArray(req.body?.excludeReferenceUrls) ? req.body.excludeReferenceUrls : [];
        selectedReference = ensureCompetitorReferenceForTopic(topic, insight, {
          excludeReferenceIds,
          excludeReferenceUrls,
          maxReferenceImages: req.body?.maxReferenceImages,
        });
      }
      const contentInsight = sanitizeDailySeed(insight);
      const contentTopic = sanitizeDailySeed(topic);
      dailyLog(job, `已选中：${topic.coreConcept || topic.trafficKeyword || topic.id}`);

      if (!selectedReference) throw new Error(`\u6307\u5b9a\u7684\u7ade\u54c1\u8bb0\u5f55\u4e0d\u5b58\u5728\uff1a${requestedReferenceId}`);
      const engagementCover = isEngagementCoverReference(selectedReference);
      dailyLog(job, `第 2 步：竞品笔记已登记并补齐正文/附件：${selectedReference.title || selectedReference.url}`);
      const expectedImageCount = engagementCover ? 1 : selectedReference.attachments.length;
      if (req.body?.draftOnly !== true) {
        dailyLog(job, `GPT 登录门禁：预计需要 ${expectedImageCount} 张图，先确认 GPT 可用后再生成文案和写发布表`);
        await ensureGptImageProfile(job, GPT_IMAGE_ACCOUNT);
        await assertGptImageProfileLoggedIn(job, GPT_IMAGE_ACCOUNT);
      }

      dailyLog(job, '第 3 步：先提取单篇竞品的主题指纹，再按同一主题改写');
      const referenceBlueprint = engagementCover
        ? buildEngagementBlueprint(selectedReference)
        : parseReferenceBlueprint(await runClaudeAsync(buildReferenceBlueprintPrompt(selectedReference), 180000));
      const dailyPrompt = buildDailyReferencePrompt(selectedReference, contentTopic, contentInsight, referenceBlueprint);
      const compliance = '\n\n\u5408\u89c4\u8981\u6c42\uff1a0\u7cd60\u5361\u53ea\u80fd\u5ba2\u89c2\u9648\u8ff0\uff0c\u4e0d\u80fd\u5ef6\u4f38\u4e3a\u8eab\u4f53\u8d1f\u62c5\u8f7b\u3001\u51cf\u80a5\u3001\u5065\u5eb7\u6216\u65e0\u8d1f\u62c5\u3002\u4e0d\u5f97\u627f\u8bfa\u4e0d\u9189\u3001\u4e0d\u4e0a\u5934\u6216\u65e0\u523a\u6fc0\u3002';
      const rawDraft = await runClaudeAsync(dailyPrompt + compliance, 420000);
      let draft = parseDailyDraft(rawDraft);
      const repairResult = await repairDailyDraftIfNeeded(draft, selectedReference, contentTopic, contentInsight, referenceBlueprint);
      draft = repairResult.draft;
      if (repairResult.repairedFrom?.length) dailyLog(job, `文案质检已自动修稿：${repairResult.repairedFrom.join('；')}`);
      if (repairResult.issues?.length) dailyLog(job, `文案仍需人工复核：${repairResult.issues.join('；')}`);
      const tags = buildDailyTags(selectedReference, contentTopic, contentInsight);
      const visibleSearchTerms = collectDailySearchTerms(contentTopic, contentInsight);
      dailyLog(job, `搜索布局：核心词「${visibleSearchTerms[0] || '未取到'}」；长尾词「${visibleSearchTerms.slice(1, 5).join(' / ') || '未取到'}」；话题已过滤竞品广告 tag`);
      job.result = {
        topic,
        reference: { id: selectedReference.id, title: selectedReference.title, url: selectedReference.url, coreSubject: referenceBlueprint.coreSubject },
        draft: { title: draft.title, body: draft.body, tags },
        stage: 'draft_generated',
      };
      dailyLog(job, `文案已生成并通过初步质检：${draft.title}`);
      const outputFields = {
        '\u6807\u9898': draft.title, '\u6b63\u6587': draft.body, '\u8bdd\u9898': tags,
        '\u53d1\u5e03\u8ba1\u5212': '\u81ea\u52a8\u751f\u6210', '\u662f\u5426\u53d1\u5e03': '\u5426',
        '\u53d1\u5e03\u8d26\u53f7': '\u6bcf\u5929\u70c8\u523b / legacy',
        '\u53c2\u8003\u94fe\u63a5': selectedReference.url,
      };
      const existingRecordId = req.body?.createNew === true ? '' : findOutputRecordIdByReference(selectedReference.url);
      const normalizedOutputFields = Object.fromEntries(
        Object.entries(outputFields).map(([key, value]) => [OUTPUT_FIELDS[key] || key, value])
      );
      const written = existingRecordId
        ? updateBaseRecord(OUTPUT_TABLE, existingRecordId, normalizedOutputFields, OUTPUT_BASE)
        : writeOutputRecord(outputFields);
      const recordId = existingRecordId || extractRecordIdFromWrite(written) || findOutputRecordIdByTitle(draft.title);
      if (!recordId) throw new Error('\u53d1\u5e03\u8868\u5199\u5165\u540e\u672a\u62ff\u5230 recordId');
      dailyLog(job, `\u6587\u6848\u5df2\u56de\u586b\u53d1\u5e03\u8868${recordId ? `\uff08${recordId}\uff09` : ''}`);
      if (insight.feishuRecordId) {
        try { updateBaseRecord(MARKET_INSIGHT_TABLE, insight.feishuRecordId, { 状态: '已进入生产' }, OUTPUT_BASE); } catch {}
      }
      const savedBody = readOutputRecordBody(recordId) || draft.body;

      if (req.body?.draftOnly === true) {
        markTopicUsed(topic.id, { publishRecordId: recordId, referenceRecordId: selectedReference.id, referenceUrl: selectedReference.url, stage: 'draft_saved' });
        markMarketInsightUsed(insight.id, { lastTopicId: topic.id, lastPublishRecordId: recordId, stage: 'draft_saved' });
        if (insight.feishuRecordId) {
          try { updateBaseRecord(MARKET_INSIGHT_TABLE, insight.feishuRecordId, { 状态: '已进入生产' }, OUTPUT_BASE); } catch {}
        }
        job.result = {
          topic,
          reference: { id: selectedReference.id, title: selectedReference.title, url: selectedReference.url, coreSubject: referenceBlueprint.coreSubject },
          draft: { title: draft.title, tags },
          recordId,
          imageTasks: expectedImageCount,
          stage: 'draft_saved',
        };
        dailyLog(job, `轻量模式：已写入发布表并停在待换图阶段（预计后续需要 ${expectedImageCount} 张图）`);
        return;
      }
      const refs = downloadCompetitorAttachments(selectedReference.id, expectedImageCount);
      if (refs.length !== expectedImageCount) throw new Error(`\u7ade\u54c1\u8868\u767b\u8bb0 ${expectedImageCount} \u5f20\u56fe\uff0c\u5b9e\u9645\u4e0b\u8f7d ${refs.length} \u5f20`);
      markCompetitorImageStatus(selectedReference.id, '\u5df2\u5efa\u961f\u5217');
      await ensureGptImageProfile(job, GPT_IMAGE_ACCOUNT);
      await assertGptImageProfileLoggedIn(job, GPT_IMAGE_ACCOUNT);
      const health = await getDailyAutomationHealth({ includeRaw: true });
      if (!health.imageTool.ok) throw new Error(`GPT 换图工具未连接：${health.imageTool.error || 'unknown'}`);
      if (!health.publisher.ok) throw new Error(`发布助手未连接：${health.publisher.error || 'unknown'}`);
      dailyLog(job, `稳定性检查：发布助手在线，GPT 队列状态=${health.imageTool.queue.stage}，GPT账号=${health.gptAccounts.ok ? health.gptAccounts.count : '未知'} 个`);
      const existingQueue = health.imageTool.raw || {};
      const existingQueueSummary = summarizeGptQueue(existingQueue);
      const reusableQueue = existingQueueSummary.publishRecordId === recordId && existingQueueSummary.total === expectedImageCount;
      const occupiedByOtherRecord = existingQueueSummary.total > 0
        && !['empty', 'completed'].includes(existingQueueSummary.status)
        && existingQueueSummary.publishRecordId
        && existingQueueSummary.publishRecordId !== recordId;
      if (reusableQueue) {
        await postLocalJson('http://127.0.0.1:5000/api/gpt-queue-state', { action: 'retry' }, 30000);
        dailyLog(job, `检测到当前发布记录已有 GPT 队列，复用断点：${existingQueueSummary.completed}/${existingQueueSummary.total}`);
      } else {
        if (occupiedByOtherRecord && req.body?.replaceQueue === false) {
          throw new Error(`GPT 队列被其他发布记录占用：${existingQueueSummary.publishRecordId}，已按 replaceQueue=false 停止`);
        }
        try {
          await postLocalJson('http://127.0.0.1:5000/api/gpt-queue-state', { action: 'clear' }, 30000);
          dailyLog(job, existingQueueSummary.total ? `已清空旧 GPT 换图队列（旧记录 ${existingQueueSummary.publishRecordId || '未知'}）` : 'GPT 换图队列为空，可创建新队列');
        } catch (error) {
          dailyLog(job, `旧 GPT 队列清理失败：${error.message}`);
        }
      }
      const productReferenceIds = engagementCover ? [] : await getFeishuProductReferenceIds();
      const overlayTextList = engagementCover
        ? buildEngagementCoverHooks(selectedReference, { title: draft.title, body: savedBody }, refs.length)
        : buildImageOverlayTexts(savedBody, refs.length);
      dailyLog(job, engagementCover
        ? `已识别互动共鸣封面，只生成 1 张无产品互动图`
        : `\u5df2\u4ece\u53d1\u5e03\u8868\u6b63\u6587\u5b57\u6bb5\u63d0\u53d6 ${overlayTextList.length} \u6761\u6c1b\u56f4\u56fe\u6587\u5b57`);
      let queue = reusableQueue ? { ok: true, reused: true, count: existingQueueSummary.total } : await postLocalJson('http://127.0.0.1:5000/api/gpt-helper-queue', {
        publish_record_id: recordId,
        scenes: refs.map(file => ({ path: file, record_id: selectedReference.id, name: path.basename(file) })),
        batch_size: expectedImageCount, gen_count: 1, match_mode: 'manual', product_record_ids: productReferenceIds,
        scene_modes: Object.fromEntries(refs.map((_, i) => [String(i), engagementCover ? 'engagement_cover' : 'auto'])),
        overlay_texts: Object.fromEntries(overlayTextList.map((text, i) => [String(i), text])),
        positive: '\u9010\u56fe\u5224\u65ad\u3002\u65e0\u4ea7\u54c1\u7684\u6c1b\u56f4\u56fe\uff1a\u751f\u6210\u76f8\u4f3c\u6c1b\u56f4\u65b0\u573a\u666f\uff0c\u6392\u5165\u672c\u7bc7 post \u6b63\u6587\u91d1\u53e5\u7247\u6bb5\u3002\u539f\u56fe\u5df2\u6709\u660e\u786e\u9152\u7c7b\u4ea7\u54c1\uff1a\u4ec5\u66ff\u6362\u8be5\u4ea7\u54c1\uff0c\u5e76\u4e25\u683c\u4f7f\u7528\u98de\u4e66\u4ea7\u54c1\u7d20\u6750\u8868\u7684\u74f6\u8eab\u4e0e\u6807\u7b7e\u7ec6\u8282\u56fe\u3002',
        negative: '\u6a21\u7cca\u3001\u53d8\u5f62\u3001\u9519\u8bef\u74f6\u6807\u3001\u591a\u4f59\u74f6\u5b50\u3001AI\u611f\u3001\u590d\u5236\u539f\u56fe\u6587\u5b57\u3001\u590d\u5236\u5546\u6807\u6216\u6c34\u5370\u3001\u76f4\u63a5\u7167\u642c\u539f\u56fe\u4eba\u7269\u548c\u88c5\u9970',
      }, 120000);
      if (!queue.ok) throw new Error(queue.error || '\u521b\u5efa GPT \u6362\u56fe\u961f\u5217\u5931\u8d25');
      const queueState = await getLocalJson('http://127.0.0.1:5000/api/gpt-queue-state');
      const queueItems = queueState.items || [];
      const mismatchedItems = queueItems.filter(item => item.scene_record_id !== selectedReference.id);
      const unboundItems = queueItems.filter(item => (item.publish_record_id || item.publishRecordId || '') !== recordId);
      if (queueItems.length !== expectedImageCount || mismatchedItems.length || unboundItems.length) {
        throw new Error('\u65b0 GPT \u961f\u5217\u6821\u9a8c\u5931\u8d25\uff1a\u53c2\u8003\u56fe\u4e0d\u662f\u5f53\u524d\u9009\u4e2d post');
      }
      dailyLog(job, engagementCover
        ? `已按互动封面策略创建 1 个 GPT 生图任务`
        : `\u5df2\u6309\u539f post \u9644\u4ef6\u6570\u521b\u5efa ${expectedImageCount} \u4e2a GPT \u751f\u56fe\u4efb\u52a1`);
      await ensureGptImageProfile(job, GPT_IMAGE_ACCOUNT);
      await assertGptImageProfileLoggedIn(job, GPT_IMAGE_ACCOUNT);
      dailyLog(job, `GPT 生图 profile 已确认：${GPT_IMAGE_ACCOUNT}，启动本地 direct runner 处理队列`);
      startDirectGptQueueRunner(job, expectedImageCount);

      job.result = { topic, reference: { id: selectedReference.id, title: selectedReference.title, url: selectedReference.url, coreSubject: referenceBlueprint.coreSubject }, draft: { title: draft.title, tags }, recordId, imageTasks: expectedImageCount, stage: 'waiting_images' };
      dailyLog(job, `\u5df2\u8fdb\u5165\u751f\u56fe\u9636\u6bb5\uff0c\u5c06\u81ea\u52a8\u7b49\u5f85 ${expectedImageCount} \u5f20\u7ed3\u679c\u56fe`);

      let lastDone = -1;
      let unchanged = 0;
      for (let attempt = 0; attempt < 720; attempt++) {
        await waitMs(10000);
        const state = await getLocalJson('http://127.0.0.1:5000/api/gpt-queue-state');
        const items = state.items || [];
        const completed = items.filter(item => ['done', 'complete'].includes(item.status)).length;
        const failed = items.filter(item => item.status === 'failed');
        if (failed.length) throw new Error(`GPT 换图任务失败：${failed.map(item => item.error || `第 ${Number(item.index || 0) + 1} 张`).join('；')}`);
        if (completed !== lastDone) {
          lastDone = completed; unchanged = 0;
          dailyLog(job, `GPT \u751f\u56fe\u8fdb\u5ea6\uff1a${completed}/${items.length || expectedImageCount}`);
        } else { unchanged += 1; }
        if (items.length === expectedImageCount && completed >= expectedImageCount) break;
        if (unchanged >= 60 && completed === 0) {
          throw new Error('GPT 队列 10 分钟没有生成结果；队列已保留，可在修复登录或额度后继续');
        }
      }
      const finalQueueState = await getLocalJson('http://127.0.0.1:5000/api/gpt-queue-state');
      const files = (finalQueueState.items || [])
        .slice(0, expectedImageCount)
        .map(item => item.result_file || (Array.isArray(item.result_files) ? item.result_files[0] : ''))
        .filter(Boolean);
      if (files.length < expectedImageCount) throw new Error(`GPT \u53ea\u4e0b\u8f7d\u5230 ${files.length} \u5f20\u56fe\uff0c\u5e94\u6709 ${expectedImageCount} \u5f20`);
      const checkedFiles = validateGeneratedImageFiles(files, finalQueueState.items || [], expectedImageCount);
      uploadBaseAttachments(recordId, OUTPUT_FIELDS.\u56fe\u7247, checkedFiles);
      const saved = await waitForOutputImages(recordId, expectedImageCount);
      if (!saved.title || !saved.body || !saved.reference || saved.images.length < expectedImageCount) {
        throw new Error(`\u53d1\u5e03\u8868\u9a8c\u6536\u5931\u8d25\uff1a\u6807\u9898=${saved.title ? '\u6709' : '\u7a7a'}\uff0c\u6b63\u6587=${saved.body ? '\u6709' : '\u7a7a'}\uff0c\u53c2\u8003\u94fe\u63a5=${saved.reference ? '\u6709' : '\u7a7a'}\uff0c\u56fe\u7247=${saved.images.length}/${expectedImageCount}`);
      }
      cleanupGeneratedImageFiles(checkedFiles, job);
      markCompetitorImageStatus(selectedReference.id, '\u5df2\u5b8c\u6210');
      markTopicUsed(topic.id, { publishRecordId: recordId, referenceRecordId: selectedReference.id, referenceUrl: selectedReference.url });
      markMarketInsightUsed(insight.id, { lastTopicId: topic.id, lastPublishRecordId: recordId });
      if (insight.feishuRecordId) {
        try { updateBaseRecord(MARKET_INSIGHT_TABLE, insight.feishuRecordId, { \u72b6\u6001: '\u5df2\u5b8c\u6210' }, OUTPUT_BASE); } catch {}
      }
      dailyLog(job, `\u5df2\u4e0a\u4f20 ${files.length} \u5f20\u6210\u54c1\u56fe\u5230\u98de\u4e66\u9644\u4ef6\u5b57\u6bb5`);
      const reviewWarnings = [];
      try { await cleanupGptResultConversations(); }
      catch (error) { reviewWarnings.push(`GPT 对话清理未完成：${error.message}`); }
      try {
        await ensureXhsPublishProfile(job, 'legacy');
        await openXhsPublishPageViaCompanion();
      } catch (error) {
        reviewWarnings.push(`小红书发布页未自动打开：${error.message}`);
      }
      try { fs.rmSync(path.dirname(refs[0]), { recursive: true, force: true }); } catch {}
      job.result.stage = 'ready_for_review';
      job.result.imageCount = files.length;
      if (reviewWarnings.length) {
        job.result.warnings = reviewWarnings;
        reviewWarnings.forEach(message => dailyLog(job, `提醒：${message}`));
        dailyLog(job, '飞书发布表已就绪；发布页打开失败不影响附件和文案回填');
      } else {
        dailyLog(job, '本地缓存已清理，小红书发布页已打开，等待人工审核');
      }
    } catch (error) {
      job.ok = false; job.error = error.message; dailyLog(job, `\u5931\u8d25\uff1a${error.message}`);
    } finally { job.done = true; }
  })();
});

app.get('/api/daily/poll/:id', (req, res) => {
  const job = dailyRunStore.get(req.params.id);
  if (!job) return res.json({ ok: false, error: '\u4efb\u52a1\u4e0d\u5b58\u5728' });
  res.json({ ok: job.ok, done: job.done, error: job.error, logs: job.logs, result: job.result });
});

app.post('/api/daily/finalize-images', async (req, res) => {
  try {
    const recordId = String(req.body?.recordId || '').trim();
    const expectedImageCount = Math.max(1, Math.min(9, Number(req.body?.expectedImageCount || 1)));
    if (!recordId) throw new Error('缺少发布表 recordId');
    const finalQueueState = await getLocalJson('http://127.0.0.1:5000/api/gpt-queue-state');
    assertGptQueueBoundToRecord(finalQueueState, recordId, 'GPT 收图队列');
    const items = finalQueueState.items || [];
    const failed = items.filter(item => item.status === 'failed');
    if (failed.length) throw new Error(`GPT 队列仍有失败任务：${failed.map(item => item.error || item.status).join('；')}`);
    const files = items
      .slice(0, expectedImageCount)
      .map(item => item.result_file || (Array.isArray(item.result_files) ? item.result_files[0] : ''))
      .filter(Boolean);
    if (files.length < expectedImageCount) {
      throw new Error(`GPT 结果图不足：已有 ${files.length} 张，应有 ${expectedImageCount} 张。请先恢复 GPT 登录态并继续原队列。`);
    }
    const checkedFiles = validateGeneratedImageFiles(files, items, expectedImageCount);
    uploadBaseAttachments(recordId, OUTPUT_FIELDS.\u56fe\u7247, checkedFiles);
    await waitForOutputImages(recordId, expectedImageCount);
    cleanupGeneratedImageFiles(checkedFiles);
    const warnings = [];
    try { await cleanupGptResultConversations(); }
    catch (error) { warnings.push(`GPT 对话清理未完成：${error.message}`); }
    try {
      await ensureXhsPublishProfile(null, 'legacy');
      await openXhsPublishPageViaCompanion();
    } catch (error) {
      warnings.push(`小红书发布页未自动打开：${error.message}`);
    }
    res.json({ ok: true, recordId, imageCount: files.length, files, warnings });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

app.post('/api/daily/resume-gpt-images', async (req, res) => {
  try {
    const requestedRecordId = String(req.body?.recordId || '').trim();
    const expectedImageCount = Math.max(1, Math.min(9, Number(req.body?.expectedImageCount || 1)));
    let queueState = await getLocalJson('http://127.0.0.1:5000/api/gpt-queue-state');
    const items = queueState.items || [];
    const queueRecordId = items.map(item => item.publish_record_id || item.publishRecordId || '').find(Boolean) || '';
    if (requestedRecordId && queueRecordId && requestedRecordId !== queueRecordId) {
      throw new Error(`GPT 恢复队列属于发布记录 ${queueRecordId}，不能上传到当前记录 ${requestedRecordId}`);
    }
    const recordId = requestedRecordId || queueRecordId;
    if (!recordId) {
      throw new Error('缺少发布表 recordId：新队列会自动记录；旧队列请手填一次发布表 recordId。');
    }
    assertGptQueueBoundToRecord(queueState, recordId, 'GPT 恢复队列');

    if (items.some(item => item.status === 'failed')) {
      await postLocalJson('http://127.0.0.1:5000/api/gpt-queue-state', { action: 'retry' }, 30000);
    }
    try {
      await ensureGptImageProfile(null, GPT_IMAGE_ACCOUNT);
      await assertGptImageProfileLoggedIn(null, GPT_IMAGE_ACCOUNT);
    } catch (error) {
      throw new Error(`GPT Profile 打开失败：${error.message}`);
    }

    for (let attempt = 0; attempt < 120; attempt++) {
      await waitMs(10000);
      queueState = await getLocalJson('http://127.0.0.1:5000/api/gpt-queue-state');
      const currentItems = queueState.items || [];
      const failed = currentItems.filter(item => item.status === 'failed');
      if (failed.length) {
        throw new Error(`GPT 队列仍有失败任务：${failed.map(item => item.error || item.status).join('；')}`);
      }
      const files = currentItems
        .slice(0, expectedImageCount)
        .map(item => item.result_file || (Array.isArray(item.result_files) ? item.result_files[0] : ''))
        .filter(Boolean);
      if (files.length >= expectedImageCount) {
        assertGptQueueBoundToRecord(queueState, recordId, 'GPT 恢复队列');
        const checkedFiles = validateGeneratedImageFiles(files, currentItems, expectedImageCount);
        uploadBaseAttachments(recordId, OUTPUT_FIELDS.\u56fe\u7247, checkedFiles);
        await waitForOutputImages(recordId, expectedImageCount);
        cleanupGeneratedImageFiles(checkedFiles);
        await cleanupGptResultConversations();
        await ensureXhsPublishProfile(null, 'legacy');
        await openXhsPublishPageViaCompanion();
        return res.json({ ok: true, recordId, imageCount: files.length, files });
      }
    }
    throw new Error(`GPT 结果图不足：请确认 GPT 已登录并让原队列继续跑。`);
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

const batchStore = new Map();

app.post('/api/batch-start', async (req, res) => {
  const { jobs } = req.body;
  if (!Array.isArray(jobs) || jobs.length === 0)
    return res.json({ ok: false, error: '请添加至少一个任务' });

  const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // 将每个任务按 qty 展开为独立 job
  const batchJobs = [];
  let jidx = 0;
  jobs.forEach(j => {
    const qty = Math.min(Math.max(1, parseInt(j.qty) || 1), 10);
    for (let q = 0; q < qty; q++) {
      batchJobs.push({
        id: jidx++, framework: j.framework || 'B', direction: j.direction,
        sellingPoint: j.sellingPoint, persona: j.persona || null, scene: j.scene || null,
        qtyLabel: qty > 1 ? `第${q+1}条/共${qty}条` : '',
        status: 'pending', result: null, error: null, archived: false, archiveError: null,
      });
    }
  });
  batchStore.set(batchId, { jobs: batchJobs, done: false });
  res.json({ ok: true, batchId });

  (async () => {
    const batch = batchStore.get(batchId);
    let ctx;
    try { ctx = await fetchFeishuContext(); }
    catch { ctx = { iterComp: [], reference: [] }; }

    for (const job of batch.jobs) {
      job.status = 'generating';
      try {
        const { prompt: batchPrompt } = buildBatchPrompt(ctx, job.direction, job.sellingPoint, job.framework, job.persona, job.scene, job.refArticle, job.spItems || []);
        const rawText = await runClaudeAsync(batchPrompt);
        job.result = parseBatchResult(rawText);
        job.status = 'done';
        // 自动归档到飞书输出表
        try {
          writeOutputRecord({
            '标题':    job.result.title || '',
            '正文':    job.result.body  || '',
            '话题':    job.result.tags  || '',
            '发布计划': '立即发布',
            '是否发布': '否',
          });
          job.archived = true;
        } catch (archErr) {
          job.archiveError = archErr.message;
        }
      } catch (e) {
        job.error = e.message;
        job.status = 'failed';
      }
    }
    batch.done = true;
  })();
});

app.get('/api/batch-poll/:id', (req, res) => {
  const batch = batchStore.get(req.params.id);
  if (!batch) return res.json({ ok: false, error: '批次不存在' });
  res.json({ ok: true, jobs: batch.jobs, done: batch.done });
});

// 批量生产归档到输出表
app.post('/api/batch-archive', (req, res) => {
  try {
    const { title, body, tags, plan } = req.body;
    if (!body) return res.json({ ok: false, error: '正文不能为空' });
    const fields = {
      '标题':    title || '',
      '正文':    body,
      '话题':    tags  || '',
      '发布计划': '立即发布',
      '是否发布': '否',
    };
    writeOutputRecord(fields);
    res.json({ ok: true });
  } catch (e) {
    console.error('[batch-archive]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ─── 竞品研究台提示词（文件化）──────────────────────────────────────
const RESEARCH_PROMPTS = {
  writing: path.join(__dirname, 'research-prompt-writing.md'),
  selling: path.join(__dirname, 'research-prompt-selling.md'),
};

function loadResearchPrompt(mode) {
  return readFileCached(RESEARCH_PROMPTS[mode] || RESEARCH_PROMPTS.writing);
}

app.get('/api/research-prompt/:mode', (req, res) => {
  const { mode } = req.params;
  if (!RESEARCH_PROMPTS[mode]) return res.json({ ok: false, error: '无效 mode' });
  res.json({ ok: true, content: loadResearchPrompt(mode) });
});

app.post('/api/research-prompt/:mode', (req, res) => {
  const { mode } = req.params;
  if (!RESEARCH_PROMPTS[mode]) return res.json({ ok: false, error: '无效 mode' });
  const { content } = req.body;
  if (typeof content !== 'string' || !content.trim()) return res.json({ ok: false, error: '内容不能为空' });
  const p = RESEARCH_PROMPTS[mode];
  fs.writeFileSync(p, content, 'utf8');
  invalidateFile(p);
  res.json({ ok: true });
});

// ─── 竞品分析 ──────────────────────────────────────────────────────
app.post('/api/analyze-competitor', async (req, res) => {
  try {
    const { notes, currentTemplate } = req.body;
    if (!notes || !notes.trim()) return res.json({ ok: false, error: '请粘贴竞品笔记' });

    const { brand } = CFG;
    const taskPrompt = loadResearchPrompt('writing');
    const prompt = `你是一个小红书内容策略专家。

## 品牌背景
${brand.name}·${brand.category}·定位：${brand.positioning}
调性：${brand.archetype}；${brand.tone}

## 当前撰写模板
${currentTemplate || '（未提供）'}

## 待分析笔记
${notes}

${taskPrompt}`;

    const rawText = await runClaudeAsync(prompt, 180000);
    res.json({ ok: true, analysis: rawText });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 读取产品信息
app.get('/api/product-info', (req, res) => {
  try {
    const content = fs.readFileSync(path.join(__dirname, 'product-info.md'), 'utf8');
    res.json({ ok: true, content });
  } catch (e) {
    res.json({ ok: true, content: '' });
  }
});

// 保存产品信息
app.post('/api/product-info', (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.json({ ok: false, error: '内容格式错误' });
    const p = path.join(__dirname, 'product-info.md');
    fs.writeFileSync(p, content, 'utf8');
    invalidateFile(p);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── 输出格式（撰写台 / 批量）─────────────────────────────────────
app.post('/api/output-format', (req, res) => {
  try {
    const { mode, content } = req.body;
    if (!['single', 'batch', 'phil'].includes(mode)) return res.json({ ok: false, error: '无效的 mode' });
    if (typeof content !== 'string') return res.json({ ok: false, error: '内容格式错误' });
    const fname = mode === 'batch' ? 'output-format-batch.md' : mode === 'phil' ? 'output-format-phil.md' : 'output-format-single.md';
    const p = path.join(__dirname, fname);
    fs.writeFileSync(p, content, 'utf8');
    invalidateFile(p);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── 品牌事实 ─────────────────────────────────────────────────────
app.get('/api/brand-facts', (req, res) => {
  res.json({ ok: true, content: loadBrandFacts() });
});

app.post('/api/brand-facts', (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.json({ ok: false, error: '内容格式错误' });
    const p = path.join(__dirname, 'brand-facts.md');
    fs.writeFileSync(p, content, 'utf8');
    invalidateFile(p);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── 框架基础写法 ──────────────────────────────────────────────────
app.get('/api/base-frameworks', (req, res) => {
  try {
    const overrides = loadBaseOverrides();
    const result = {};
    for (const fw of ['A', 'B', 'C', 'D']) {
      const ov = overrides[fw] || {};
      result[fw] = {
        body: (typeof ov === 'string' ? ov : ov.body) || BASE_TEMPLATES[fw]?.body || '',
        example: (typeof ov === 'object' ? ov.example : undefined) ?? BASE_TEMPLATES[fw]?.example ?? '',
      };
    }
    res.json({ ok: true, frameworks: result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/base-frameworks/:fw', (req, res) => {
  try {
    const { fw } = req.params;
    if (!['A', 'B', 'C', 'D'].includes(fw)) return res.json({ ok: false, error: '无效框架' });
    const { body, example } = req.body;
    const filePath = path.join(__dirname, 'base-overrides.json');
    let data = {};
    try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
    if (!data[fw] || typeof data[fw] === 'string') data[fw] = {};
    if (typeof body === 'string') data[fw].body = body;
    if (typeof example === 'string') data[fw].example = example;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 读取模板库
app.get('/api/templates', (req, res) => {
  res.json({ ok: true, templates: loadTemplates() });
});

// 保存模板库（只写用户模板，基础模板永不入文件）
app.post('/api/templates', (req, res) => {
  try {
    const { templates } = req.body;
    if (!templates || typeof templates !== 'object') return res.json({ ok: false, error: '格式错误' });
    const toSave = {};
    for (const fw of ['A', 'B', 'C', 'D']) {
      toSave[fw] = (templates[fw] || []).filter(t => !t.isBase);
    }
    fs.writeFileSync(path.join(__dirname, 'templates.json'), JSON.stringify(toSave, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// 读取素材库（人/货/场）
app.get('/api/materials', (req, res) => {
  try {
    res.json({ ok: true, ...fetchMaterials() });
  } catch (e) {
    console.error('[materials]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// 新增素材
app.post('/api/materials/add', (req, res) => {
  try {
    const { type, fields } = req.body;
    if (!type || !MATERIALS_CFG[type]) return res.json({ ok: false, error: '无效的素材类型' });
    writeMatRecord(MATERIALS_CFG[type].tableId, fields);
    res.json({ ok: true });
  } catch (e) {
    console.error('[materials/add]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// 更新素材
app.post('/api/materials/update', (req, res) => {
  try {
    const { type, recordId, fields } = req.body;
    if (!type || !MATERIALS_CFG[type] || !recordId) return res.json({ ok: false, error: '参数缺失' });
    const tmpName = `_tmp_lark_${Date.now()}.json`;
    const tmpFile = path.join(__dirname, tmpName);
    fs.writeFileSync(tmpFile, JSON.stringify(fields), 'utf8');
    try {
      larkCli([
        'base', '+record-upsert',
        '--base-token', MAT_BASE,
        '--table-id', MATERIALS_CFG[type].tableId,
        '--record-id', recordId,
        '--json', `@${tmpName}`,
      ]);
    } finally { try { fs.unlinkSync(tmpFile); } catch (_) {} }
    res.json({ ok: true });
  } catch (e) {
    console.error('[materials/update]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ─── 素材造梦优化 ────────────────────────────────────────────────────
app.post('/api/materials/dream-optimize', async (req, res) => {
  try {
    const { type, name, mood, desc, dim, angle, visual, guide } = req.body;
    if (!type || !name) return res.json({ ok: false, error: '参数缺失' });

    const typeLabel = { 人: '人群', 货: '卖点', 场: '场景' }[type] || type;
    let context = `类型：${typeLabel}\n名称：${name}`;
    if (type === '人') {
      if (mood) context += `\n情绪状态：${mood}`;
      if (desc) context += `\n当前描述：${desc}`;
    } else if (type === '货') {
      if (dim)   context += `\n维度：${dim}`;
      if (angle) context += `\n角度类型：${angle}`;
      if (desc)  context += `\n当前描述：${desc}`;
    } else if (type === '场') {
      if (mood)   context += `\n情绪分类：${mood}`;
      if (visual) context += `\n画面描述：${visual}`;
      if (guide)  context += `\n当前指导语：${guide}`;
    }

    const prompt = `你是每天烈刻气泡白酒的内容策划。我要你把以下素材的描述升级为「造梦表达」。

造梦的含义：展现读者向往但可及的生活切片。读者看完内容后，想成为那种人，或想拥有那个时刻。动作和状态都可以保留，但核心要让读者感到「这说的就是我想要的那种生活」，而不是在描述产品或动作序列。

要求：
- 状态和动作都写，少一些过于细节的行为，多一些情绪温度
- 不要广告腔，不要直接提产品
- 不贴调性标签（不写「野性」「不将就」等词），让语言本身渗透出来
- 不超过80字
- 只返回优化后的描述文字，不加任何标题、说明、引号

素材：
${context}`;

    const result = await runClaudeAsync(prompt, 60000);
    res.json({ ok: true, result: result.trim() });
  } catch (e) {
    console.error('[dream-optimize]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ─── 参考文案库 ────────────────────────────────────────────────────
function readRefTable() {
  const refCfg = CFG.feishu.tables.reference;
  const res = larkCli([
    'base', '+record-list',
    '--base-token', CFG.feishu.baseToken,
    '--table-id', refCfg.id,
    '--limit', '200',
    '--format', 'json',
  ]);
  const records = res.data.data || [];
  const fieldIdList = res.data.field_id_list || [];
  const recordIds = res.data.record_id_list || [];
  const idxMap = {};
  fieldIdList.forEach((fid, i) => { idxMap[fid] = i; });
  return records.map((r, i) => ({
    title:   extractField(r, idxMap, refCfg.fields.标题)     || '',
    tag:     extractField(r, idxMap, refCfg.fields.标签)     || '',
    content: extractField(r, idxMap, refCfg.fields.文案内容) || '',
    brand:   extractField(r, idxMap, refCfg.fields.品牌)     || '',
    _id:     recordIds[i],
  })).filter(x => x.content && x.brand === refCfg.filterBrand);
}

app.get('/api/context-stats', async (req, res) => {
  try {
    const ctx = await fetchFeishuContext();
    res.json({
      ok: true,
      iterComp: ctx.iterComp.length,
      reference: ctx.reference.length,
      cache: {
        cached: !!state.contextCache,
        ageSeconds: state.contextCache ? Math.round((Date.now() - state.contextCacheTime) / 1000) : null,
        ttlSeconds: Math.round(CFG.contextCacheTtl / 1000),
      },
      lastPrompt: lastPromptSnapshot ? {
        at: lastPromptSnapshot.at,
        mode: lastPromptSnapshot.mode,
        promptChars: lastPromptSnapshot.promptChars || String(lastPromptSnapshot.prompt || '').length,
        modules: lastPromptSnapshot.modules || [],
      } : null,
      promptRunsPath: PROMPT_RUNS_PATH,
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/references', (req, res) => {
  try {
    const refs = readRefTable();
    res.json({ ok: true, refs });
  } catch (e) {
    console.error('[references]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/references/add', (req, res) => {
  try {
    const { title, tag, content } = req.body;
    if (!content?.trim()) return res.json({ ok: false, error: '笔记内容不能为空' });
    const refCfg = CFG.feishu.tables.reference;
    const fields = { [refCfg.fields.文案内容.name]: content.trim() };
    if (title?.trim()) fields[refCfg.fields.标题.name] = title.trim();
    if (tag?.trim()) fields[refCfg.fields.标签.name] = tag.trim();
    const tmpName = `_tmp_ref_${Date.now()}.json`;
    const tmpFile = path.join(__dirname, tmpName);
    fs.writeFileSync(tmpFile, JSON.stringify(fields), 'utf8');
    try {
      larkCli(['base', '+record-upsert', '--base-token', CFG.feishu.baseToken, '--table-id', refCfg.id, '--json', `@${tmpName}`]);
    } finally { try { fs.unlinkSync(tmpFile); } catch (_) {} }
    res.json({ ok: true });
  } catch (e) {
    console.error('[references/add]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// 删除飞书参考文案（用 POST 模拟 DELETE，避免 Express 5 路由注册问题）
app.post('/api/references/delete', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ ok: false, error: '缺少记录 ID' });
    const refCfg = CFG.feishu.tables.reference;
    larkCli(['base', '+record-delete', '--base-token', CFG.feishu.baseToken, '--table-id', refCfg.id, '--record-id', id, '--yes']);
    res.json({ ok: true });
  } catch (e) {
    console.error('[references/delete]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ─── 活人感语料专区 ───────────────────────────────────────────────
const WRITING_PATH = path.join(__dirname, 'writing-instructions.md');
const CORPUS_HEADER = '## 活人感语料参考';

function readCorpus() {
  const content = fs.readFileSync(WRITING_PATH, 'utf8');
  const idx = content.indexOf(CORPUS_HEADER);
  if (idx === -1) return [];
  const section = content.slice(idx + CORPUS_HEADER.length);
  return section.split('\n')
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2).trim())
    .filter(Boolean);
}

function writeCorpus(items) {
  let content = fs.readFileSync(WRITING_PATH, 'utf8');
  const idx = content.indexOf(CORPUS_HEADER);
  if (idx === -1) {
    content += `\n\n${CORPUS_HEADER}\n\n以下是从真实笔记中收集的活人感表达，写作时可学习其语感、节奏与口吻：\n`;
    fs.writeFileSync(WRITING_PATH, content, 'utf8');
    return writeCorpus(items);
  }
  const before = content.slice(0, idx + CORPUS_HEADER.length);
  const after   = content.slice(idx + CORPUS_HEADER.length);
  // 保留 header 下面到第一条 bullet 之前的说明段落
  const descMatch = after.match(/^([\s\S]*?)(?=\n- |\n##|$)/);
  const desc = descMatch ? descMatch[1] : '';
  const bullets = items.map(t => `- ${t}`).join('\n');
  fs.writeFileSync(WRITING_PATH, `${before}${desc}\n${bullets}\n`, 'utf8');
}

app.get('/api/corpus', (req, res) => {
  try { res.json({ ok: true, items: readCorpus() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/corpus/add', (req, res) => {
  try {
    const { item } = req.body;
    if (!item?.trim()) return res.json({ ok: false, error: '语料不能为空' });
    const items = readCorpus();
    items.push(item.trim());
    writeCorpus(items);
    res.json({ ok: true, items });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/corpus/delete', (req, res) => {
  try {
    const { index } = req.body;
    const items = readCorpus();
    if (index < 0 || index >= items.length) return res.json({ ok: false, error: '索引越界' });
    items.splice(index, 1);
    writeCorpus(items);
    res.json({ ok: true, items });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// 竞品卖点提取
app.post('/api/extract-selling-points', async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes?.trim()) return res.json({ ok: false, error: '请粘贴竞品笔记' });

    const { brand } = CFG;
    const productInfo = loadProductInfo();
    let currentGoods = '（暂无）';
    try {
      const mats = fetchMaterials();
      if (mats.货.length > 0) {
        currentGoods = mats.货.map(g => `• ${g.name}（${g.dim||'-'}/${g.angle||'-'}）：${(g.desc||'').slice(0,40)}`).join('\n');
      }
    } catch (_) {}

    const taskPrompt = loadResearchPrompt('selling');
    const prompt = `你是产品文案策略专家，正在为品牌"${brand.name}"（${brand.category}，${brand.positioning}）分析笔记内容。

## 我们产品的真实信息（分析必须以此为准，不得推断与此矛盾的卖点）
${productInfo || brand.facts.map(f => `- ${f}`).join('\n')}

## 我们已有的货卖点库
${currentGoods}

## 待分析笔记
${notes}

${taskPrompt}`;

    const rawText = await runClaudeAsync(prompt, 180000);

    let suggestions = [];
    const jsonMatch = rawText.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try { suggestions = JSON.parse(jsonMatch[1]); } catch (_) {}
    }

    res.json({ ok: true, analysis: rawText, suggestions });
  } catch (e) {
    console.error('[extract-selling-points]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ─── 爆款体检 ─────────────────────────────────────────────────────
app.post('/api/diagnose', async (req, res) => {
  try {
    const { title, body, tags } = req.body;
    if (!body?.trim()) return res.json({ ok: false, error: '正文不能为空' });

    const prompt = `你是犀利但靠谱的小红书内容策略师，正在为「每天烈刻」气泡白酒品牌做笔记体检。所有诊断必须基于具体证据，不能模棱两可。

## 待检笔记

标题：${title || '（未填写）'}
正文：
${body}
话题标签：${tags || '（未填写）'}

---

## 体检标准

### CES 算法权重（核心目标）
CES = 点赞×1 + 收藏×1 + 评论×4 + 转发×4 + 关注×8
评论权重是点赞4倍，笔记设计必须偏向能拿评论的结构（争议/求助/二选一），而不只是拿点赞的美图。
信息密度每增加一个可验证细节，CES+5%。

### 标题诊断维度
- 前18字必须含关键词（小红书首页只显示前18字）
- 核心钩子放前10字
- 16字以内，含1个emoji
- 降权词：「绝绝子」「保姆级」「一篇看懂」「不看后悔」「震惊」

### AI味检测（2026小红书音画识别模型会降权）
以下任何一种出现即严重扣分：
- 万能开头："Hi大家好""相信很多姐妹都""今天给大家分享"
- 万能总结："希望对你有帮助""以上就是今天的分享"
- 结构词："Tips:" "划重点！" "敲黑板！"
- "X又不失X"句式："舒适又不失高级"
- 关联词密度："不仅…而且…""既…又…"同一篇超过3次
- 模板化段落：首先/其次/最后三段式，或"你是否也有…烦恼？其实只需要以下几点"
- Emoji均匀分布：每段开头一个✨✅🎯（AI特征），单篇超过15个

### 具体度诊断
以下"具体"至少需要3种：
- 具体数字："第4瓶""喝了3口之后"
- 具体时间："上周五晚上"
- 具体地点："三里屯那家烤鱼店"
- 具体对话："朋友说'这个喝起来不像白酒啊'"
- 具体感受："第一口气泡在舌尖噼啪完之后，有一点点回甘"

### 互动钩子
正文里有无触发评论的句子（问句/争议观点/求助/二选一）？
互动钩子在中段比在结尾效果高，中段钩子更优。

### ARETA 心理路径
读者经历的心理步骤，每步都要有对应内容承接：
- Attention（注意）：首句/标题能否在 0.5 秒内让人停住？靠画面、反差、或强烈具体的细节。
- Relevance（相关）：读者能否在前3行认出"这说的就是我"？靠人群标签或场景代入。
- Empathy（代入）："这不就是我吗？" 有没有让读者觉得被看见的句子？
- Trust（信任）：有没有可信锚点？数字/工艺细节/行业对比/真实经历，选一个就够。
- Action（行动）：结尾有没有低门槛下一步？不一定是买，也可以是"你试过这个场景吗"。

### 品牌每天烈刻专项检查
- 有无把品牌事实翻译成感官感受（而非直接报数据）？
- 有无广告腔（"满足您的…""品质保证"）？
- 有无把0糖0卡说成减肥/医疗功效？

---

## 输出格式（严格按此，不加任何前置语）

### 总评 X/10
[一句直击要害的总评，不能模棱两可]

### ARETA X/10
Attention: [首句能停住吗？引用原文]
Relevance: [前3行有没有"这说的就是我"？]
Empathy: [有没有被看见的句子？]
Trust: [可信锚点是什么？缺的话说缺什么]
Action: [结尾引导是什么？有/无]
**最薄弱的一环：[点名一个，一句话说为什么]**

### AI味 X/10
[列出具体证据，引用原文词句，没有就说"未发现"]

### 具体度 X/10
[列出文中有/缺的具体类型，引用原文]

### 标题 X/10
[前10字钩子、关键词、降权词，引用原文]

### 互动钩子 X/10
[有几个、在哪个位置、是否在中段]

### 致命问题 Top3
1. **[问题]** — [为什么致命，引用具体规则]
2. **[问题]** — [...]
3. **[问题]** — [...]

### 改写示范
**标题改写（3条）：**
- [改写1]
- [改写2]
- [改写3]

**开头3行：**
[直接写出改后版本]

**加一个中段互动钩子：**
[在正文第X段后加：...]

### 一句话总结
[有记忆点的一句话，不要废话]`;

    const rawText = await runClaudeAsync(prompt, 360000);
    // 只保留从"### 总评"开始的诊断内容，截掉 Claude 可能输出的前置废话
    const cutIdx = rawText.search(/###\s*总评/);
    const diagnosis = cutIdx >= 0 ? rawText.slice(cutIdx) : rawText;
    res.json({ ok: true, diagnosis });
  } catch (e) {
    console.error('[diagnose]', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    engineReady: true,
    contextCached: !!state.contextCache,
    contextAge: state.contextCache ? Math.round((Date.now() - state.contextCacheTime) / 1000) + 's' : 'none',
  });
});

// ─── 切入方式 API ─────────────────────────────────────────────────
app.get('/api/angles/:fw', (req, res) => {
  const { fw } = req.params;
  if (!ENTRY_ANGLES[fw]) return res.json({ ok: false, error: '无效框架' });
  res.json({ ok: true, current: getCurrentAngle(fw), all: ENTRY_ANGLES[fw].map((a, i) => ({ ...a, idx: i })) });
});

app.post('/api/angles/:fw/next', (req, res) => {
  const { fw } = req.params;
  if (!ENTRY_ANGLES[fw]) return res.json({ ok: false, error: '无效框架' });
  const current = advanceAngle(fw);
  res.json({ ok: true, current, all: ENTRY_ANGLES[fw].map((a, i) => ({ ...a, idx: i })) });
});

app.post('/api/angles/:fw/set', (req, res) => {
  const { fw } = req.params;
  const { idx } = req.body;
  if (!ENTRY_ANGLES[fw]) return res.json({ ok: false, error: '无效框架' });
  const current = setAngleIdx(fw, idx);
  res.json({ ok: true, current, all: ENTRY_ANGLES[fw].map((a, i) => ({ ...a, idx: i })) });
});

// ═══════════════════════════════════════════════════════════════════
// Ares Chat API
// ═══════════════════════════════════════════════════════════════════
function workflowPayload() {
  const tasks = workList(WORK_TABLES.tasks.id).map(rec => ({
    id: rec.id,
    title: cleanText(rec.fields['任务标题']),
    role: toOptionName(rec.fields['岗位']),
    owner: cleanText(rec.fields['责任人']),
    source: toOptionName(rec.fields['任务来源']),
    priority: toOptionName(rec.fields['优先级']),
    status: toOptionName(rec.fields['状态']),
    progress: rec.fields['进度'] ?? null,
    dueTime: cleanText(rec.fields['截止时间']),
    planDate: cleanText(rec.fields['计划日期']),
    waiting: cleanText(rec.fields['对接人/等待谁']),
    currentProgress: cleanText(rec.fields['当前进展']),
    nextStep: cleanText(rec.fields['下一步']),
    blocker: cleanText(rec.fields['阻塞原因']),
    bossNote: cleanText(rec.fields['老板备注']),
    reportLinks: linkIds(rec.fields['关联日报']).map(x => x.id),
  }));

  const reports = workList(WORK_TABLES.reports.id).map(rec => ({
    id: rec.id,
    title: cleanText(rec.fields['汇报标题']),
    date: cleanText(rec.fields['汇报日期']),
    person: cleanText(rec.fields['汇报人']),
    role: toOptionName(rec.fields['岗位']),
    completed: cleanText(rec.fields['已完成']),
    ongoing: cleanText(rec.fields['进行中/有进度']),
    carryover: cleanText(rec.fields['顺延任务']),
    coordination: cleanText(rec.fields['需对接/等待反馈']),
    tomorrow: cleanText(rec.fields['明日重点']),
    issue: cleanText(rec.fields['问题/需老板确认']),
    summary: cleanText(rec.fields['一键汇总文本']),
    submitStatus: toOptionName(rec.fields['提交状态']),
    linkedTaskIds: linkIds(rec.fields['今日关联任务']).map(x => x.id),
  }));

  const notices = workList(WORK_TABLES.notices.id).map(rec => {
    const status = toOptionName(rec.fields['展示状态']) || '取消';
    const roles = Array.isArray(rec.fields['适用岗位']) ? rec.fields['适用岗位'] : (rec.fields['适用岗位'] ? [rec.fields['适用岗位']] : []);
    return {
      id: rec.id,
      title: cleanText(rec.fields['通知标题']),
      body: cleanText(rec.fields['通知内容']),
      status,
      roles: roles.map(toOptionName).filter(Boolean),
      order: rec.fields['排序'] ?? 0,
      start: cleanText(rec.fields['开始时间']),
      end: cleanText(rec.fields['结束时间']),
      note: cleanText(rec.fields['备注']),
      visible: status === '展示',
    };
  }).sort((a, b) => (a.order || 0) - (b.order || 0));

  return { tasks, reports, notices };
}

app.get('/api/workflow/state', (req, res) => {
  try {
    res.json({ ok: true, ...workflowPayload() });
  } catch (e) {
    res.json({ ok: false, error: e.message, tasks: [], reports: [], notices: [] });
  }
});

app.post('/api/workflow/tasks/upsert', (req, res) => {
  try {
    const { recordId = null, task = {} } = req.body || {};
    const fields = {
      '任务标题': task.title || '',
      '岗位': task.role || null,
      '责任人': task.owner || '',
      '任务来源': task.source || null,
      '优先级': task.priority || null,
      '状态': task.status || null,
      '进度': task.progress === '' || task.progress == null ? null : Number(task.progress),
      '截止时间': task.dueTime || null,
      '计划日期': task.planDate || null,
      '对接人/等待谁': task.waiting || '',
      '当前进展': task.currentProgress || '',
      '下一步': task.nextStep || '',
      '阻塞原因': task.blocker || '',
      '老板备注': task.bossNote || '',
    };
    const result = workWrite(WORK_TABLES.tasks.id, fields, recordId || null);
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/workflow/reports/upsert', (req, res) => {
  try {
    const { recordId = null, report = {} } = req.body || {};
    const fields = {
      '汇报标题': report.title || '',
      '汇报日期': report.date || null,
      '汇报人': report.person || '',
      '岗位': report.role || null,
      '今日关联任务': linkIds(report.linkedTaskIds || []),
      '已完成': report.completed || '',
      '进行中/有进度': report.ongoing || '',
      '顺延任务': report.carryover || '',
      '需对接/等待反馈': report.coordination || '',
      '明日重点': report.tomorrow || '',
      '问题/需老板确认': report.issue || '',
      '一键汇总文本': report.summary || '',
      '提交状态': report.submitStatus || '已提交',
    };
    const result = workWrite(WORK_TABLES.reports.id, fields, recordId || null);
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/workflow/notices/upsert', (req, res) => {
  try {
    const { recordId = null, notice = {} } = req.body || {};
    const fields = {
      '通知标题': notice.title || '',
      '通知内容': notice.body || '',
      '展示状态': notice.status || '展示',
      '适用岗位': notice.roles || [],
      '排序': notice.order === '' || notice.order == null ? 0 : Number(notice.order),
      '开始时间': notice.start || null,
      '结束时间': notice.end || null,
      '备注': notice.note || '',
    };
    const result = workWrite(WORK_TABLES.notices.id, fields, recordId || null);
    res.json({ ok: true, result });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const Anthropic = require('@anthropic-ai/sdk');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const aresHistories = {};

function loadAresSystemPrompt() {
  const skillPath = path.join(os.homedir(), '.claude', 'skills', 'aris-marketing', 'SKILL.md');
  let skill = '';
  try { skill = fs.readFileSync(skillPath, 'utf8'); } catch {}
  return `你是 Ares 的营销判断引擎，蒸馏自她在内容创作、市场营销上积累的真实判断。

关键原则：
- 不给选项列表，直接给判断和结论
- 像真正懂这个品牌的人一样说话，不像顾问
- 审稿时逐句指出问题，不是泛泛评价
- 热点评估给契合度评分(1-10)和具体角度，不是"可以考虑"
- 发现值得记录的洞见时主动提示"这个值得存下来"

品牌：每天烈刻气泡白酒
产品事实（至少用一个）：茅台产区10年基酒 / 10度 / 0糖0卡 / 细腻气泡 / 不辣嗓子 / 青提·菠萝口味
目标用户：25-32岁女性，微醺场景，情绪消费驱动

---
${skill}

今天：${new Date().toLocaleDateString('zh-CN')}`;
}

// GET /api/ares/hot-topics
app.get('/api/ares/hot-topics', (req, res) => {
  try {
    const r = larkCli(['--as', 'user', 'base', '+record-list',
      '--base-token', process.env.FEISHU_BASE_TOKEN || '',
      '--table-id', 'tblto6HMz9sjdgTp',
      '--limit', '8', '--format', 'json']);
    const items = (r.data?.items || []).map(rec => {
      const fields = rec.fields || {};
      return { title: fields['帖子标题'] || fields['搜索词'] || '—', date: fields['日期'] || '' };
    }).filter(x => x.title !== '—');
    res.json({ ok: true, items });
  } catch(e) { res.json({ ok: false, items: [], error: e.message }); }
});

// GET /api/ares/recent-kb
app.get('/api/ares/recent-kb', (req, res) => {
  try {
    const r = larkCli(['--as', 'user', 'base', '+record-list',
      '--base-token', process.env.FEISHU_BASE_TOKEN || '',
      '--table-id', 'tbl8GgYJbuObKWtE',
      '--limit', '8', '--format', 'json',
      '--field-id', 'key takeaway', '--field-id', '内容类型', '--field-id', '个人想法']);
    const items = (r.data?.items || []).map(rec => {
      const f = rec.fields || {};
      const takeaway = f['key takeaway'] || f['个人想法'] || '';
      const type = Array.isArray(f['内容类型']) ? f['内容类型'][0] : (f['内容类型'] || '');
      return { takeaway, type };
    }).filter(x => x.takeaway);
    res.json({ ok: true, items });
  } catch(e) { res.json({ ok: false, items: [], error: e.message }); }
});

// POST /api/ares/chat  (SSE streaming)
app.post('/api/ares/chat', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;
  if (!aresHistories[sessionId]) aresHistories[sessionId] = [];
  aresHistories[sessionId].push({ role: 'user', content: message });
  if (aresHistories[sessionId].length > 30) {
    aresHistories[sessionId] = aresHistories[sessionId].slice(-30);
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: loadAresSystemPrompt(),
      messages: aresHistories[sessionId],
    });

    let full = '';
    stream.on('text', (text) => {
      full += text;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });
    await stream.finalMessage();
    aresHistories[sessionId].push({ role: 'assistant', content: full });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch(e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// POST /api/ares/save-insight
app.post('/api/ares/save-insight', (req, res) => {
  const { content, category = '方法论', type = '方法论' } = req.body;
  try {
    larkCli(['--as', 'user', 'base', '+record-upsert',
      '--base-token', process.env.FEISHU_BASE_TOKEN || '',
      '--table-id', 'tbl8GgYJbuObKWtE',
      '--fields', JSON.stringify({
        '个人想法': '[Ares对话洞见] ' + content.slice(0, 200),
        '大类': [category],
        '内容类型': [type],
      })]);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// DELETE /api/ares/chat/:sessionId
app.delete('/api/ares/chat/:sessionId', (req, res) => {
  delete aresHistories[req.params.sessionId];
  res.json({ ok: true });
});

// ══ XHS 评论抓取 ═════════════════════════════════════════════════════

const XHS_BASE      = process.env.XHS_BASE_TOKEN || process.env.FEISHU_BASE_TOKEN || '';
const XHS_TABLE     = 'tblGpK7czdgjFZbi';
const XHS_TRIED_F   = path.join(os.homedir(), 'xhs_tried.json');
const PUBLISH_BASE  = process.env.PUBLISH_BASE_TOKEN || '';
const COMMENT_PHOTO_TABLE = 'tblJbrnsxyfvgteW';
const COMMENT_LEARNING_CACHE = path.join(__dirname, 'data', 'comment-learning-cache.json');
const UV_BIN        = path.join(os.homedir(), '.local', 'bin', 'uv.exe');
const XHS_CLI_DIR   = path.join(os.homedir(), 'xiaohongshu-cli');
const XHS_LOGIN_SCRIPT = path.join(__dirname, 'scripts', 'xhs-login-qrcode.ps1');
const xhsJobStore   = new Map();

function xhsLoadTried() {
  try { return new Set(JSON.parse(fs.readFileSync(XHS_TRIED_F, 'utf8'))); }
  catch { return new Set(); }
}
function xhsSaveTried(t) { fs.writeFileSync(XHS_TRIED_F, JSON.stringify([...t]), 'utf8'); }

function xhsExtractUrl(cell) {
  if (!cell) return '';
  const s = Array.isArray(cell) ? String(cell[0] ?? '') : String(cell);
  const m = s.match(/\((https?:\/\/[^)]+)\)/) || s.match(/(https?:\/\/\S+)/);
  return m ? m[1] : '';
}

function xhsResolveShort(url) {
  return new Promise(resolve => {
    if (!url.includes('xhslink.com')) return resolve(url);
    const mod = require(url.startsWith('https') ? 'https' : 'http');
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, res => {
      resolve(res.headers.location || url); res.resume();
    });
    req.on('error', () => resolve(url));
    req.setTimeout(8000, () => { req.destroy(); resolve(url); });
  });
}

function xhsParseNote(url) {
  const m = url.match(/\/(?:discovery\/item|explore)\/([0-9a-f]{24})/);
  if (!m) return null;
  const t = url.match(/xsec_token=([^&\s]+)/);
  return { noteId: m[1], xsecToken: t ? decodeURIComponent(t[1]) : '' };
}

function xhsFriendlyError(code, msg = '') {
  if (code === 'not_authenticated') return '小红书登录态已过期。请先执行 xhs login，或扫码登录后再抓评论。';
  if (code === 'verification_required') return '小红书触发验证码/风控。请先在浏览器里完成验证，稍后再抓。';
  if (/xsec_token/i.test(msg)) return '缺少或无法复用 xsec_token。请优先导入带 xsec_token 的完整小红书链接。';
  return msg || code || '未知错误';
}

function xhsFetchComments(noteId, xsecToken, sourceUrl = '') {
  const target = sourceUrl && sourceUrl.includes('xiaohongshu.com/') ? sourceUrl : noteId;
  const cmd = [UV_BIN, 'run', 'xhs', 'comments', target, '--all', '--json'];
  if (!sourceUrl && xsecToken) cmd.push('--xsec-token', xsecToken);
  const r = spawnSync(cmd[0], cmd.slice(1), {
    encoding: 'utf8', timeout: 60000,
    cwd: XHS_CLI_DIR, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  let data;
  try { data = JSON.parse(r.stdout || '{}'); } catch { return { ok: false, code: 'parse_error', msg: r.stderr || r.stdout || '' }; }
  if (!data.ok) {
    const code = data.error?.code || 'unknown';
    const msg = data.error?.message || '';
    return { ok: false, code, msg, hint: xhsFriendlyError(code, msg) };
  }
  const texts = [], imgs = [];
  for (const c of (data.data?.comments || [])) {
    for (const item of [c, ...(c.sub_comments || [])]) {
      if (item.content?.trim()) texts.push(item.content.trim());
      for (const p of (item.pictures || [])) { const u = p.url_default || p.url_pre; if (u) imgs.push(u); }
    }
  }
  return { ok: true, texts, imgs };
}

function xhsFetchAllRecords() {
  const tried = xhsLoadTried();
  const records = [];
  let offset = 0;
  while (true) {
    const r = larkCli(['--as', 'user', 'base', '+record-list',
      '--base-token', XHS_BASE, '--table-id', XHS_TABLE,
      '--field-id', 'fldPISrmKu', '--field-id', 'fldTKifb9m',
      '--field-id', 'fldcBaFZ4R', '--field-id', 'fldL90EX2O',
      '--field-id', 'fldsjl0bni',
      '--field-id', 'fldkwhCXdq', '--field-id', 'fldrRTrjMW',
      '--field-id', 'fldsiNypBW', '--field-id', 'fldsNoorh7',
      '--format', 'json', '--limit', '100', '--offset', String(offset)]);
    if (!r.ok) break;
    const d = r.data;
    const rows = d.data || [], ids = d.record_id_list || [], flds = d.fields || [];
    const ui = flds.indexOf('地址贴这里');
    const noteUi = flds.indexOf('笔记地址');
    const titleI = flds.indexOf('笔记标题');
    const textI = flds.indexOf('评论文字');
    const imageI = flds.indexOf('评论图片');
    const likesI = flds.indexOf('点赞数');
    const collectsI = flds.indexOf('收藏数');
    const commentsI = flds.indexOf('评论数');
    const sharesI = flds.indexOf('分享数');
    for (let i = 0; i < ids.length; i++) {
      const row = rows[i] || [];
      const url = xhsExtractUrl(ui >= 0 ? row[ui] : '') || xhsExtractUrl(noteUi >= 0 ? row[noteUi] : '');
      const commentText = textI >= 0 ? String(row[textI] || '') : '';
      const images = imageI >= 0 && Array.isArray(row[imageI]) ? row[imageI] : [];
      if (url || commentText) records.push({
        id: ids[i], url, title: titleI >= 0 ? String(row[titleI] || '') : '',
        commentText, commentCount: commentText ? commentText.split(/\r?\n/).filter(Boolean).length : 0,
        imageCount: images.length, hasData: !!commentText, tried: tried.has(ids[i]),
        likes: Number(likesI >= 0 ? row[likesI] : 0) || 0,
        collects: Number(collectsI >= 0 ? row[collectsI] : 0) || 0,
        comments: Number(commentsI >= 0 ? row[commentsI] : 0) || 0,
        shares: Number(sharesI >= 0 ? row[sharesI] : 0) || 0,
      });
    }
    if (!d.has_more) break;
    offset += 100;
  }
  return records;
}

function xhsFetchCommentPhotoPool(limit = 80) {
  const photos = [];
  let offset = 0;
  while (photos.length < limit) {
    const r = larkCli(['--as', 'user', 'base', '+record-list',
      '--base-token', PUBLISH_BASE, '--table-id', COMMENT_PHOTO_TABLE,
      '--field-id', 'fldXemvWcH', '--field-id', 'fldiKFkAkf',
      '--format', 'json', '--limit', '100', '--offset', String(offset)]);
    if (!r.ok) break;
    const d = r.data || {};
    const rows = d.data || [], ids = d.record_id_list || [], flds = d.fields || [];
    const seqI = flds.indexOf('序号');
    const photoI = flds.indexOf('照片');
    for (let i = 0; i < ids.length && photos.length < limit; i++) {
      const row = rows[i] || [];
      const attachments = photoI >= 0 && Array.isArray(row[photoI]) ? row[photoI] : [];
      if (attachments.length) photos.push({
        id: ids[i],
        seq: seqI >= 0 ? String(row[seqI] || '') : '',
        count: attachments.length,
      });
    }
    if (!d.has_more) break;
    offset += 100;
  }
  return photos;
}

function xhsTempJsonArg(prefix, payload) {
  const dir = path.join(__dirname, '.tmp');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`;
  const full = path.join(dir, name);
  fs.writeFileSync(full, JSON.stringify(payload), 'utf8');
  return `@.tmp/${name}`;
}
function xhsFetchCommentQueue(limit = 80) {
  const rowsOut = [];
  let offset = 0;
  const fieldsWanted = ['序号', '照片', '评论内容', '评论类型', '评论状态', '目标笔记链接', '目标评论', '发布账号', '关联发布记录', '计划时间', '执行时间', '执行结果', '生成来源'];
  while (rowsOut.length < limit) {
    const args = ['--as', 'user', 'base', '+record-list',
      '--base-token', PUBLISH_BASE, '--table-id', COMMENT_PHOTO_TABLE,
      '--format', 'json', '--limit', '100', '--offset', String(offset)];
    for (const f of fieldsWanted) args.push('--field-id', f);
    const r = larkCli(args);
    if (!r.ok) throw new Error(r.error?.message || r.error || '读取评论队列失败');
    const d = r.data || {};
    const rows = d.data || [], ids = d.record_id_list || [], flds = d.fields || [];
    const idx = name => flds.indexOf(name);
    for (let i = 0; i < ids.length && rowsOut.length < limit; i++) {
      const row = rows[i] || [];
      const photos = idx('照片') >= 0 && Array.isArray(row[idx('照片')]) ? row[idx('照片')] : [];
      rowsOut.push({
        id: ids[i],
        seq: idx('序号') >= 0 ? String(row[idx('序号')] || '') : '',
        photoCount: photos.length,
        photoNames: photos.map(p => p.name).filter(Boolean),
        photos: photos.map(p => ({
          fileToken: p.file_token || p.fileToken || '',
          name: p.name || 'comment-image.jpg',
        })).filter(p => p.fileToken),
        content: idx('评论内容') >= 0 ? String(row[idx('评论内容')] || '') : '',
        type: idx('评论类型') >= 0 ? (Array.isArray(row[idx('评论类型')]) ? row[idx('评论类型')][0] : row[idx('评论类型')]) || '' : '',
        status: idx('评论状态') >= 0 ? (Array.isArray(row[idx('评论状态')]) ? row[idx('评论状态')][0] : row[idx('评论状态')]) || '' : '',
        targetNoteUrl: idx('目标笔记链接') >= 0 ? String(row[idx('目标笔记链接')] || '') : '',
        targetComment: idx('目标评论') >= 0 ? String(row[idx('目标评论')] || '') : '',
        account: idx('发布账号') >= 0 ? String(row[idx('发布账号')] || '') : '',
        publishRecord: idx('关联发布记录') >= 0 ? String(row[idx('关联发布记录')] || '') : '',
        plannedAt: idx('计划时间') >= 0 ? String(row[idx('计划时间')] || '') : '',
        executedAt: idx('执行时间') >= 0 ? String(row[idx('执行时间')] || '') : '',
        result: idx('执行结果') >= 0 ? String(row[idx('执行结果')] || '') : '',
        source: idx('生成来源') >= 0 ? String(row[idx('生成来源')] || '') : '',
      });
    }
    if (!d.has_more) break;
    offset += 100;
  }
  return rowsOut;
}

function xhsNoteIdFromUrl(value = '') {
  const text = String(value || '');
  return text.match(/xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-f]+)/i)?.[1]?.toLowerCase() || '';
}

function xhsPublishedTargets() {
  const r = larkCli(['--as', 'user', 'base', '+record-list',
    '--base-token', PUBLISH_BASE, '--table-id', 'tblagggirJGbcWIh',
    '--field-id', 'fldNhY7hvG', '--field-id', 'fld1R5bywz',
    '--format', 'json', '--limit', '200']);
  const d = r.data || {}, fields = d.fields || [], rows = d.data || [], ids = d.record_id_list || [];
  const statusI = fields.indexOf('是否发布'), linkI = fields.indexOf('发布链接');
  return ids.map((id, index) => {
    const row = rows[index] || [];
    const status = statusI >= 0 ? row[statusI] : '';
    const link = linkI >= 0 ? String(row[linkI] || '') : '';
    return { id, published: Array.isArray(status) ? status.includes('是') : status === '是', link, noteId: xhsNoteIdFromUrl(link) };
  }).filter(item => item.published && item.noteId);
}

function xhsVerifyPublishedTarget(recordId, url) {
  const noteId = xhsNoteIdFromUrl(url);
  if (!recordId || !noteId) return false;
  return xhsPublishedTargets().some(item => item.id === recordId && item.noteId === noteId);
}

function xhsWriteCommentQueue(items = [], context = {}) {
  const usableItems = (Array.isArray(items) ? items : [])
    .map(item => ({
      role: String(item.role || context.accountRole || '').trim(),
      text: String(item.text || '').trim(),
      intent: String(item.intent || '').trim(),
      imageHint: String(item.imageHint || '').trim(),
    }))
    .filter(item => item.text);
  if (!usableItems.length) return [];

  const queue = xhsFetchCommentQueue(120);
  const photoRows = queue.filter(row => row.photoCount > 0 && row.photos?.length);
  if (!photoRows.length) throw new Error('“评论区照片”表里还没有可复用的照片');
  const targetRows = queue.filter(row => row.photoCount > 0 && !row.content && !row.status).slice(0, usableItems.length);
  while (targetRows.length < usableItems.length) {
    const source = photoRows[targetRows.length % photoRows.length];
    const cloneDir = path.join('.tmp', `comment-photo-${Date.now()}-${targetRows.length}`);
    const fullDir = path.join(__dirname, cloneDir);
    fs.mkdirSync(fullDir, { recursive: true });
    try {
      const localFiles = [];
      for (let p = 0; p < source.photos.length; p++) {
        const photo = source.photos[p];
        const safeName = `${p + 1}-${String(photo.name || 'comment-image.jpg').replace(/[^\w.\-\u4e00-\u9fff]+/g, '_')}`;
        const relativeFile = path.join(cloneDir, safeName);
        larkCli(['--as', 'user', 'base', '+record-download-attachment',
          '--base-token', PUBLISH_BASE, '--table-id', COMMENT_PHOTO_TABLE,
          '--record-id', source.id, '--file-token', photo.fileToken,
          '--output', relativeFile, '--overwrite', '--format', 'json']);
        localFiles.push(relativeFile);
      }
      const created = larkCli(['--as', 'user', 'base', '+record-upsert',
        '--base-token', PUBLISH_BASE, '--table-id', COMMENT_PHOTO_TABLE,
        '--json', xhsTempJsonArg('comment-photo-clone', { '序号': `自动复用-${Date.now()}-${targetRows.length + 1}` }), '--format', 'json']);
      const recordId = created.data?.record?.record_id || created.data?.record_id || created.record?.record_id;
      if (!recordId) throw new Error('复制评论图片时未取得新记录 ID');
      const uploadArgs = ['--as', 'user', 'base', '+record-upload-attachment',
        '--base-token', PUBLISH_BASE, '--table-id', COMMENT_PHOTO_TABLE,
        '--record-id', recordId, '--field-id', 'fldiKFkAkf', '--format', 'json'];
      localFiles.forEach(file => uploadArgs.push('--file', file));
      larkCli(uploadArgs);
      targetRows.push({ id: recordId, seq: '', photoCount: localFiles.length, photoNames: localFiles.map(path.basename), photos: source.photos });
    } finally {
      fs.rmSync(fullDir, { recursive: true, force: true });
    }
  }

  const written = [];
  const allowedAccounts = (Array.isArray(context.accountRoles) ? context.accountRoles : [])
    .map(value => String(value || '').trim()).filter(Boolean);
  for (let i = 0; i < targetRows.length; i++) {
    const item = usableItems[i];
    const row = targetRows[i];
    const patch = {
      '评论内容': item.text,
      '评论类型': context.mode === 'reply' ? '定向回复' : '造势评论',
      '评论状态': context.status || '待执行',
      '目标笔记链接': context.targetNoteUrl || '',
      '目标评论': context.userComment || '',
      '发布账号': allowedAccounts.length
        ? (allowedAccounts.includes(item.role) ? item.role : allowedAccounts[i % allowedAccounts.length])
        : (context.accountRole || item.role || ''),
      '关联发布记录': context.publishRecord || '',
      '生成来源': context.source || `Market Hub ${new Date().toISOString()}`,
      '执行结果': item.intent || item.imageHint ? `意图：${item.intent || ''}${item.imageHint ? `；配图：${item.imageHint}` : ''}` : '',
    };
    const r = larkCli(['--as', 'user', 'base', '+record-upsert',
      '--base-token', PUBLISH_BASE, '--table-id', COMMENT_PHOTO_TABLE,
      '--record-id', row.id, '--json', xhsTempJsonArg('comment-queue', patch), '--format', 'json']);
    if (!r.ok) throw new Error(r.error?.message || r.error || `写入评论队列失败：${row.id}`);
    written.push({ ...row, content: item.text, type: patch['评论类型'], status: patch['评论状态'], account: patch['发布账号'], intent: item.intent, imageHint: item.imageHint });
  }
  return written;
}
function xhsSplitCommentLines(text = '', limit = 12) {
  return String(text || '')
    .split(/\r?\n+/)
    .map(s => s.replace(/^\s*\d+[.、)]\s*/, '').trim())
    .filter(s => s.length >= 8)
    .slice(0, limit);
}

function xhsBuildCommentLearningCorpus() {
  const records = xhsFetchAllRecords()
    .filter(r => r.commentText && r.commentText.trim())
    .sort((a, b) => {
      const score = r => (r.commentCount || 0) * 6 + (r.imageCount || 0) * 5 + Math.log1p((r.likes || 0) + (r.collects || 0) + (r.comments || 0) * 4);
      return score(b) - score(a);
    })
    .slice(0, 28);
  const noteSamples = records.map((r, idx) => ({
    rank: idx + 1,
    id: r.id,
    title: r.title || '',
    url: r.url || '',
    metrics: { likes: r.likes || 0, collects: r.collects || 0, comments: r.comments || 0, shares: r.shares || 0 },
    commentImageCount: r.imageCount || 0,
    comments: xhsSplitCommentLines(r.commentText, 10),
  }));
  const photoPool = xhsFetchCommentPhotoPool(80);
  return {
    generatedAt: new Date().toISOString(),
    source: {
      competitorRecords: noteSamples.length,
      commentLines: noteSamples.reduce((sum, item) => sum + item.comments.length, 0),
      competitorCommentImages: records.reduce((sum, item) => sum + (item.imageCount || 0), 0),
      standaloneCommentPhotoRecords: photoPool.length,
      standaloneCommentPhotos: photoPool.reduce((sum, item) => sum + (item.count || 0), 0),
    },
    noteSamples,
    photoPool,
  };
}

function xhsLoadCommentLearningCache() {
  try { return JSON.parse(fs.readFileSync(COMMENT_LEARNING_CACHE, 'utf8')); }
  catch { return null; }
}

function xhsSaveCommentLearningCache(cache) {
  fs.mkdirSync(path.dirname(COMMENT_LEARNING_CACHE), { recursive: true });
  fs.writeFileSync(COMMENT_LEARNING_CACHE, JSON.stringify(cache, null, 2), 'utf8');
}

function xhsBuildHeuristicCommentSummary(corpus) {
  const comments = (corpus.noteSamples || []).flatMap(note => (note.comments || []).map(text => ({ text, title: note.title || '' })));
  const pick = re => comments.filter(item => re.test(item.text)).slice(0, 8).map(item => `- ${item.text}`).join('\n') || '- 暂无明显样本';
  return `## 评论区互动机制
1. 求图/借图：用户用“礼貌拿图、借图、求图”表达低门槛互动，适合氛围图和文字封面。
${pick(/拿图|借图|求图|分享.*图|图一|图\d/)}

2. 求推荐/求评价：用户会问“好不好喝、有没有推荐、怎么买、口味怎么样”，适合品牌号轻承接。
${pick(/推荐|推介|评价|怎么样|好喝|买|口味|喝过/)}

3. 纠错/补充：用户会围绕颜色、做法、搭配、场景纠正细节，适合用运营号补充信息。
${pick(/不是|正确|为什么|颜色|搭配|加点|兑|调/)}

4. 真实困扰：用户会提到甜、胖、睡觉、酒量、苦、喝不惯等具体顾虑，适合短回复承接。
${pick(/太甜|胖|睡|酒量|喝不惯|苦|浪费|难/)}

5. 晒清单/晒图：长评论和带图评论通常承担“我也有/我买了/我怎么搭”的证明功能，后续可以作为评论图片学习源。

## 可迁移到每天烈刻的评论打法
- 自有笔记下先放 2-3 条低门槛接话：求口味、求图、问搭配、问“这个度数会不会冲”。
- 第二层评论承接顾虑：甜不甜、白酒味重不重、适不适合在家小酌、怎么兑更稳。
- 第三层用品牌事实轻露出：10度、气泡、真实果汁、海盐菠萝/青提风味；避免一上来硬讲参数。

## 造势评论生成规则
- 每条 12-45 字，像普通评论区接话。
- 角色可分：求推荐的人、怕白酒味的人、在家小酌的人、想看图的人、轻微玩梗的人。
- 有图时，评论可以围绕“这个图好有感觉/想拿来做壁纸/求同款搭配/求开瓶场景”。

## 定向回复生成规则
- 先接住原评论的一个具体词，再补一句信息，最后可轻问一句。
- 对口味顾虑：回答“更像清爽气泡果酒方向，白酒冲感弱”，不要说疗效或绝对承诺。
- 对购买/价格/链接：只给合规引导，不说包邮、库存、私信等无法确认的话。

## 评论图片使用规则
- 评论区照片表适合作为“用户晒图/场景证明”的风格参考。
- 竞品评论图片要和评论文字一起看：订单截图、到货图、酒杯图、场景图的用途不同。
- 评论图片后续换图时优先保留原图的互动功能：证明、求图、晒单、场景代入。

## 禁止踩线
- 不冒充真实消费者购买/饮用经历。
- 不承诺助眠、减肥、健康收益。
- 不用强销售口吻压迫用户。`;
}

function xhsFallbackCommentItems(mode = 'seed', userComment = '') {
  const c = String(userComment || '');
  if (mode === 'reply') {
    if (/甜|腻|糖/.test(c)) return [
      { role: '运营号', text: '怕甜的话可以先加冰，气泡感会把甜感压得更清爽一点', intent: '承接口味顾虑', imageHint: '' },
      { role: '运营号', text: '这个点很真实，低度酒最怕腻，口味一定要收得干净才行', intent: '接住原评论', imageHint: '' },
      { role: '运营号', text: '你平时更怕甜还是更怕白酒味？这两个方向其实差挺多的', intent: '引导追问', imageHint: '' },
    ];
    if (/白酒|冲|辣|上头|度数/.test(c)) return [
      { role: '运营号', text: '怕白酒冲感的人确实会先犹豫，气泡和果香就是用来把入口放轻的', intent: '降低顾虑', imageHint: '' },
      { role: '运营号', text: '这个问题问得很准，低度只是基础，入口顺不顺才是关键', intent: '承接问题', imageHint: '' },
      { role: '运营号', text: '如果你平时不太碰白酒，建议先冰一下，小口试会更稳', intent: '场景建议', imageHint: '' },
    ];
    return [
      { role: '运营号', text: '你这个说法好真实，评论区很多人其实都是卡在这个点上', intent: '接住情绪', imageHint: '' },
      { role: '运营号', text: '对，这种东西最重要的是别有负担，轻轻喝一点就够了', intent: '品牌状态承接', imageHint: '' },
      { role: '运营号', text: '想问问你更在意口味、度数，还是喝完之后的舒服度？', intent: '引导讨论', imageHint: '' },
    ];
  }
  return [
    { role: '素人号', text: '这个标题太懂我了，下班后真的只想喝点轻松的', intent: '开启共鸣', imageHint: '' },
    { role: '怕白酒味的人', text: '想问这个会不会有白酒那种冲嗓子的感觉？', intent: '抛出核心顾虑', imageHint: '' },
    { role: '求图号', text: '封面这个氛围好好，想礼貌拿图当聊天背景', intent: '拉互动', imageHint: '适合配评论区氛围图' },
    { role: '场景号', text: '感觉适合冰箱里备一瓶，突然想小酌的时候拿出来', intent: '带出使用场景', imageHint: '' },
    { role: '口味号', text: '海盐菠萝听起来会比普通果酒更清爽一点诶', intent: '轻露出卖点', imageHint: '' },
    { role: '互动号', text: '你们一个人在家的时候会喝酒吗，还是只喝饮料？', intent: '引导讨论', imageHint: '' },
    { role: '老粉口吻', text: '低度、有气泡、别太甜，这三个点真的很难同时做好', intent: '放大判断标准', imageHint: '' },
    { role: '轻玩梗', text: '成年人冰箱里需要一点“今天先放过自己”的东西', intent: '造梦状态', imageHint: '' },
  ];
}

app.get('/api/xhs/records', (req, res) => {
  try { res.json({ ok: true, records: xhsFetchAllRecords() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/xhs/comment-learning', (req, res) => {
  try {
    const corpus = xhsBuildCommentLearningCorpus();
    const cache = xhsLoadCommentLearningCache();
    res.json({ ok: true, corpus, cache });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/xhs/comment-queue', (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 80)));
    const queue = xhsFetchCommentQueue(limit);
    res.json({ ok: true, queue, pending: queue.filter(row => row.content && !['已发送', '已跳过'].includes(row.status || '')).length });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/xhs/comment-queue/status', (req, res) => {
  try {
    const { recordId = '', status = '', result = '' } = req.body || {};
    const id = String(recordId || '').trim();
    const nextStatus = String(status || '').trim();
    if (!id || !nextStatus) return res.status(400).json({ ok: false, error: 'recordId 和 status 必填' });
    const allowed = new Set(['待执行', '需人工确认', '已发送', '失败', '已跳过']);
    if (!allowed.has(nextStatus)) return res.status(400).json({ ok: false, error: `不支持的评论状态：${nextStatus}` });
    const patch = {
      '评论状态': nextStatus,
      '执行结果': String(result || '').slice(0, 1000),
    };
    if (nextStatus === '已发送') {
      const now = new Date();
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace('T', ' ');
      patch['执行时间'] = local;
    }
    const r = larkCli(['--as', 'user', 'base', '+record-upsert',
      '--base-token', PUBLISH_BASE, '--table-id', COMMENT_PHOTO_TABLE,
      '--record-id', id, '--json', xhsTempJsonArg('comment-status', patch), '--format', 'json']);
    if (!r.ok) throw new Error(r.error?.message || r.error || `更新评论状态失败：${id}`);
    res.json({ ok: true, recordId: id, status: nextStatus });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/xhs/comment-learning/refresh', async (req, res) => {
  try {
    const corpus = xhsBuildCommentLearningCorpus();
    if (!corpus.source.commentLines) return res.json({ ok: false, error: '还没有可学习的评论文字。先给竞品表补全评论文字/评论图片。' });
    const brandFacts = [
      fs.readFileSync(path.join(__dirname, 'brand-facts.md'), 'utf8'),
      fs.readFileSync(path.join(__dirname, 'product-info.md'), 'utf8'),
    ].join('\n\n').slice(0, 12000);
    const prompt = `你是每天烈刻的评论运营研究员。请把下面这些已登记竞品笔记的评论区样本，压缩成一个可复用的“评论学习缓存”。

任务：
1. 总结评论区里最容易触发互动的 6-10 种机制：提问、求链接、晒图、跟风、争议、玩梗、真实困扰、购买意图等。
2. 区分两类可用输出：
   - 造势评论：品牌自有笔记下，由不同运营账号开启讨论或承接讨论。
   - 定向回复：回复某个用户原评论，接住对方的话。
3. 提炼评论图片的使用方向：哪些图适合晒订单/到货/场景/表情包/产品替代，哪些只适合学习氛围。
4. 给后续生成器一份短规则，要求像真实评论区，不写长广告。

品牌事实只用于判断能不能承接，不要编造体验、销量和功效：
${brandFacts}

评论样本 JSON：
${JSON.stringify(corpus, null, 2).slice(0, 45000)}

输出用 Markdown，分为：
## 评论区互动机制
## 可迁移到每天烈刻的评论打法
## 造势评论生成规则
## 定向回复生成规则
## 评论图片使用规则
## 禁止踩线`;
    let summary = '';
    let fallback = false;
    let modelError = '';
    try {
      summary = await runClaudeAsync(prompt, 180000);
    } catch (error) {
      fallback = true;
      modelError = error.message || String(error);
      summary = xhsBuildHeuristicCommentSummary(corpus);
    }
    const cache = { generatedAt: new Date().toISOString(), source: corpus.source, summary, fallback, modelError };
    xhsSaveCommentLearningCache(cache);
    res.json({ ok: true, cache, corpus });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/xhs/comment-plan', async (req, res) => {
  try {
    const { mode = 'seed', noteTitle = '', noteBody = '', userComment = '', accountRole = '', accountRoles = [], count = 5, targetNoteUrl = '', publishRecord = '', save = true } = req.body || {};
    if (save !== false && (!String(targetNoteUrl).trim() || !String(publishRecord).trim())) {
      return res.status(400).json({ ok: false, error: '造势评论只允许关联发布表中已发布的笔记：缺少发布记录 ID 或发布链接' });
    }
    if (save !== false && !xhsVerifyPublishedTarget(String(publishRecord).trim(), String(targetNoteUrl).trim())) {
      return res.status(400).json({ ok: false, error: '评论目标与发布表中的已发布记录/发布链接不一致，已拒绝生成' });
    }
    const cache = xhsLoadCommentLearningCache();
    const learning = cache?.summary || '暂无缓存，请先刷新评论学习。';
    const brandFacts = [
      fs.readFileSync(path.join(__dirname, 'brand-facts.md'), 'utf8'),
      fs.readFileSync(path.join(__dirname, 'product-info.md'), 'utf8'),
    ].join('\n\n').slice(0, 10000);
    const prompt = `你是每天烈刻的小红书评论运营助手。基于评论学习缓存，生成可复制的评论候选。

模式：${mode === 'reply' ? '定向回复别人评论' : '自有笔记下造势评论'}
账号角色：${accountRole || '未指定，默认普通运营账号'}
目标笔记标题：${noteTitle || '未提供'}
目标笔记正文摘要：${String(noteBody || '').slice(0, 3000) || '未提供'}
被回复评论：${String(userComment || '').slice(0, 800) || '无'}

评论学习缓存：
${learning.slice(0, 18000)}

品牌事实：
${brandFacts}

要求：
- 生成 ${Math.max(1, Math.min(12, Number(count) || 5))} 条。
- 每条 12-60 字。
- 像真实评论区里的接话、提问、补充、轻微玩梗或求图，不写硬广。
- 不冒充真实购买体验；账号是运营号时可以用品牌/运营口吻。
- 如果是定向回复，必须接住原评论里的一个具体词或情绪。

输出严格 JSON：
{"mode":"seed|reply","items":[{"role":"","text":"","intent":"","imageHint":""}],"notes":""}`;
    const raw = await runClaudeAsync(prompt + `\n可用评论账号（role 必须从中选择）：${JSON.stringify(accountRoles.length ? accountRoles : [accountRole].filter(Boolean))}`, 180000);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('评论计划未返回 JSON');
    const parsed = JSON.parse(match[0]);
    const queued = save === false ? [] : xhsWriteCommentQueue(parsed.items || [], { mode, targetNoteUrl, userComment, accountRole, accountRoles, publishRecord, source: 'Market Hub 评论生成 ' + new Date().toISOString() });
    res.json({ ok: true, ...parsed, queued, queuedCount: queued.length, learningGeneratedAt: cache?.generatedAt || '' });
  } catch (e) {
    console.error('[xhs/comment-plan]', e.message);
    const mode = req.body?.mode === 'reply' ? 'reply' : 'seed';
    const fallbackItems = xhsFallbackCommentItems(mode, req.body?.userComment || '');
    let queued = [];
    try {
      if (req.body?.save !== false) queued = xhsWriteCommentQueue(fallbackItems, {
        mode,
        targetNoteUrl: req.body?.targetNoteUrl || '',
        userComment: req.body?.userComment || '',
        accountRole: req.body?.accountRole || '',
        accountRoles: req.body?.accountRoles || [],
        publishRecord: req.body?.publishRecord || '',
        source: 'Market Hub 评论 fallback ' + new Date().toISOString(),
      });
    } catch (writeError) {
      return res.json({ ok: false, fallback: true, modelError: e.message, error: writeError.message, items: fallbackItems });
    }
    res.json({
      ok: true,
      fallback: true,
      modelError: e.message,
      mode,
      items: fallbackItems,
      queued,
      queuedCount: queued.length,
      notes: '模型暂不可用，已使用本地评论规则生成候选；人工确认后再使用。',
      learningGeneratedAt: xhsLoadCommentLearningCache()?.generatedAt || '',
    });
  }
});

app.get('/api/xhs/status', (req, res) => {
  try {
    const r = spawnSync(UV_BIN, ['run', 'xhs', 'status', '--json'], {
      encoding: 'utf8', timeout: 30000,
      cwd: XHS_CLI_DIR, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let data;
    try { data = JSON.parse(r.stdout || '{}'); }
    catch { data = { ok: false, error: { code: 'parse_error', message: r.stderr || r.stdout || '' } }; }
    if (!data.ok) {
      const code = data.error?.code || 'unknown';
      const msg = data.error?.message || '';
      return res.json({ ok: false, code, error: xhsFriendlyError(code, msg), raw: msg });
    }
    res.json({ ok: true, user: data.data?.user || data.data || null });
  } catch (e) { res.json({ ok: false, code: 'exception', error: e.message }); }
});

app.post('/api/xhs/open-verify', async (req, res) => {
  try {
    const targetUrl = String(req.body?.url || 'https://www.xiaohongshu.com/').trim();
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    const allowed = host === 'xiaohongshu.com'
      || host.endsWith('.xiaohongshu.com')
      || host === 'xhslink.com'
      || host.endsWith('.xhslink.com');
    if (!allowed || !/^https?:$/.test(parsed.protocol)) {
      return res.json({ ok: false, error: '只允许打开小红书相关链接' });
    }
    await ensureXhsPublishProfile(null, 'legacy');
    const tab = await openCdpUrl(XHS_CDP_PORT, parsed.toString());
    res.json({ ok: true, url: parsed.toString(), port: XHS_CDP_PORT, tab });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/xhs/sync-cookies', (req, res) => {
  try {
    const code = [
      'import json',
      'import topic_pipeline',
      'result = topic_pipeline.sync_xhs_cookies_from_cdp()',
      'print(json.dumps(result, ensure_ascii=False))',
    ].join('\n');
    const r = spawnSync('python', ['-c', code], {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        XHS_COOKIE_CDP_PORTS: String(req.body?.ports || `${XHS_CDP_PORT},${GPT_CDP_PORT}`),
      },
    });
    const stdout = String(r.stdout || '').trim();
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(String(r.stderr || stdout || `python exit ${r.status}`).slice(0, 800));
    const jsonLine = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || '{}';
    let payload;
    try { payload = JSON.parse(jsonLine); }
    catch { throw new Error(`cookie sync returned non-JSON: ${stdout.slice(0, 500)}`); }
    res.json(payload.ok ? { ok: true, ...payload } : { ok: false, ...payload });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/xhs/enrich-competitor-images', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  const limit = Math.max(1, Math.min(100, Number(req.body?.limit || 30)));
  const maxImages = Math.max(1, Math.min(9, Number(req.body?.maxImages || 9)));
  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const job = { done: false, logs: [], results: [] };
  xhsJobStore.set(jobId, job);
  res.json({ ok: true, jobId });

  const script = path.join(__dirname, 'scripts', 'enrich_competitor_from_xhs.py');
  const args = [script, '--limit', String(limit), '--max-images', String(maxImages), '--max-comments', '10'];
  if (ids.length) args.push('--record-ids', ids.join(','));
  const child = spawn('python', args, {
    cwd: __dirname,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', HTTPS_PROXY: process.env.HTTPS_PROXY || 'http://127.0.0.1:7890', HTTP_PROXY: process.env.HTTP_PROXY || 'http://127.0.0.1:7890' },
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  child.on('close', code => {
    try {
      const parsed = JSON.parse(stdout || '{}');
      job.results = parsed.results || [];
      job.logs.push(...job.results.map(item => item.ok
        ? `✅ ${item.title || item.id}｜原图 ${item.images}｜有效评论 ${item.comments}｜评论图 ${item.comment_images}`
        : `❌ ${item.id}｜${item.error || '补全失败'}`));
      if (code !== 0 || parsed.ok === false) job.logs.push(`❌ ${parsed.error || stderr || `exit ${code}`}`);
    } catch (error) {
      job.logs.push(`❌ 补全结果解析失败：${error.message} ${stderr}`);
    }
    job.done = true;
  });
  child.on('error', error => { job.logs.push(`❌ 启动失败：${error.message}`); job.done = true; });
});

app.post('/api/xhs/login-qrcode', (req, res) => {
  try {
    if (!fs.existsSync(XHS_LOGIN_SCRIPT)) {
      return res.json({ ok: false, error: '登录脚本不存在，请检查 scripts/xhs-login-qrcode.ps1' });
    }
    const child = spawn('powershell.exe', [
      '-NoExit',
      '-ExecutionPolicy', 'Bypass',
      '-File', XHS_LOGIN_SCRIPT,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/xhs/import', (req, res) => {
  try {
    const urls = [...new Set((req.body?.urls || [])
      .map(v => String(v || '').trim())
      .filter(v => /^https?:\/\/(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)\//i.test(v)))];
    if (!urls.length) return res.json({ ok: false, error: '请粘贴有效的小红书笔记链接' });
    const existingRecords = xhsFetchAllRecords();
    const existing = new Map(existingRecords.filter(r => r.url).map(r => [r.url, r.id]));
    const fresh = urls.filter(url => !existing.has(url));
    if (!fresh.length) return res.json({ ok: true, created: 0, duplicate: urls.length, ids: urls.map(url => existing.get(url)).filter(Boolean) });
    const created = larkCli(['--as', 'user', 'base', '+record-batch-create',
      '--base-token', XHS_BASE, '--table-id', XHS_TABLE,
      '--json', xhsTempJsonArg('xhs-import', { fields: ['地址贴这里', '笔记地址'], rows: fresh.map(url => [url, url]) }),
      '--format', 'json']);
    const createdIds = created.data?.record_id_list || [];
    const ids = [...createdIds, ...urls.filter(url => existing.has(url)).map(url => existing.get(url))];
    res.json({ ok: true, created: fresh.length, duplicate: urls.length - fresh.length, ids });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/xhs/analyze-comments', async (req, res) => {
  try {
    const rec = xhsFetchAllRecords().find(r => r.id === req.body?.id);
    if (!rec?.commentText) return res.json({ ok: false, error: '这条记录还没有评论数据' });
    const brandFacts = [
      fs.readFileSync(path.join(__dirname, 'brand-facts.md'), 'utf8'),
      fs.readFileSync(path.join(__dirname, 'product-info.md'), 'utf8'),
    ].join('\n\n').slice(0, 18000);
    let prompt = `你是每天烈刻的评论研究员。请研究下面一组小红书热门笔记评论，不是续写笔记，也不要假装真实消费者。

目标：提炼评论区为什么会形成互动，以及以后可复用的“评论布局”。必须区分两类：
1. 造势评论：用于品牌自有笔记下，由运营账号主动开启讨论；
2. 定向回复：针对用户原话回答，必须承接对方问题、情绪或误解。

输出固定为：
## 评论区发生了什么
## 高频触发器（问题 / 异议 / 求图 / 玩梗 / 购买意图 / 圈层暗号）
## 对话链布局（哪些评论适合接第二句、第三句）
## 可迁移到每天烈刻的机制
## 不能照搬的内容
## 造势评论模板（只写结构和变量，不伪造使用经历）
## 定向回复模板（原评论类型 → 回应结构）

品牌事实仅用于判断能否承接，禁止添加未提供的功效、销量和体验：
${brandFacts}

样本标题：${rec.title || '未填写'}
评论序列：
${rec.commentText.slice(0, 30000)}`;
    prompt += `

特别重要：这份结果要给员工直接用，不要只做宏观分析。请额外输出以下落地部分：

## 可执行回复清单
从评论序列里挑 8-12 条最值得运营介入的代表评论。每条按这个格式写：
- 原评论：引用原评论原文，尽量短，不要改写用户意思
- 是否值得回复：值得 / 不建议 / 只点赞不回
- 回复目标：澄清误解 / 承接购买意图 / 引导追问 / 放大玩梗 / 降低争议 / 引导场景分享
- 回复策略：先接住对方哪一个词，再补哪一个信息，最后要不要反问
- 可复制回复 A：不超过 60 字，像真人运营号，不假装消费者
- 可复制回复 B：不超过 60 字，更俏皮一点，但不油
- 插件执行建议：适合插件直接回 / 需要人工确认 / 不适合回

## 插件落地建议
说明这些回复以后应该怎样接入小红书插件或发布助手：哪些内容由 Market Hub 生成，哪些动作必须由已登录的小红书账号执行，哪些回复必须人工确认后才能发。

回复约束：
- 不要说自己买过、喝过、库存、销量、疗效、醒酒效果，除非品牌事实里明确给出；
- 不要冒充普通用户，只能用品牌/运营口吻；
- 每条回复都要短，能直接复制进评论框；
- 如果原评论不值得回，要明确说为什么。`;
    const analysis = await runClaudeAsync(prompt, 120000);
    res.json({ ok: true, analysis });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/xhs/reply-suggestion', async (req, res) => {
  try {
    const { comment = '', noteTitle = '', noteUrl = '', context = '' } = req.body || {};
    const cleanComment = String(comment || '').trim().slice(0, 800);
    if (!cleanComment) return res.json({ ok: false, error: '请先选中一条评论或粘贴评论文本' });
    const publishedTarget = xhsPublishedTargets().find(item => item.noteId === xhsNoteIdFromUrl(noteUrl));
    if (!publishedTarget) return res.status(400).json({ ok: false, error: '这不是发布表中已登记发布链接的笔记，评论助手不会在这里生成回复' });
    const learningCache = xhsLoadCommentLearningCache();
    const commentLearning = learningCache?.summary
      ? learningCache.summary.slice(0, 12000)
      : '暂无评论学习缓存。生成时只按品牌事实和当前评论判断；建议先在 Market Hub 评论维护页刷新评论学习。';
    const prompt = `你是每天烈刻气泡白酒的小红书评论回复助手。请根据当前笔记语境，为“被选中的这条评论”生成可复制回复。

安全边界：
- 不冒充真实消费者，不说“我买了/我喝过/我们家还有货/包邮/私信你”等无法确认的话。
- 不承诺功效、减肥、助眠、健康收益，不劝酒，不诱导未成年人饮酒。
- 不自动销售压迫；像真人轻轻接话，短、准、有情绪。
- 如果评论不适合品牌号回复，直接标注“不建议回复”，并说明原因。
- 如果适合回复，给 3 条不同风格，每条 12-45 字。

当前笔记标题：${noteTitle || '未知'}
当前笔记链接：${noteUrl || '未知'}
页面上下文：${context || '无'}
评论学习缓存：
${commentLearning}
被选中的评论：${cleanComment}

输出严格 JSON：
{"okToReply":true,"reason":"","replies":[{"style":"轻松接话","text":""},{"style":"产品轻露出","text":""},{"style":"引导讨论","text":""}],"copyHint":""}`;
    const raw = await runClaudeAsync(prompt, 180000);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('回复建议未返回 JSON');
    const parsed = JSON.parse(match[0]);
    res.json({
      ok: true,
      okToReply: parsed.okToReply !== false,
      reason: parsed.reason || '',
      replies: Array.isArray(parsed.replies) ? parsed.replies.slice(0, 5) : [],
      copyHint: parsed.copyHint || '',
    });
  } catch (e) {
    console.error('[xhs/reply-suggestion]', e.message);
    const fallbackReplies = xhsFallbackCommentItems('reply', req.body?.comment || '').slice(0, 3);
    res.json({
      ok: true,
      fallback: true,
      modelError: e.message,
      okToReply: true,
      reason: '模型暂不可用，已使用本地评论规则生成候选。',
      replies: fallbackReplies.map(item => ({ style: item.intent || item.role || '候选回复', text: item.text })),
      copyHint: '模型暂不可用：先使用本地候选，人工确认后再复制发送。',
    });
  }
});

app.post('/api/xhs/reset-tried', (req, res) => {
  try { xhsSaveTried(new Set()); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/xhs/scrape', (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.json({ ok: false, error: '无记录 ID' });
  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  xhsJobStore.set(jobId, { done: false, logs: [], results: [] });
  res.json({ ok: true, jobId });

  (async () => {
    const job = xhsJobStore.get(jobId);
    const log = m => { job.logs.push(m); console.log('[xhs]', m); };
    const tried = xhsLoadTried();

    // 获取这批记录的 URL
    let recs = [];
    try {
      let offset = 0;
      const remaining = new Set(ids);
      while (remaining.size > 0) {
        const r = larkCli(['--as', 'user', 'base', '+record-list',
          '--base-token', XHS_BASE, '--table-id', XHS_TABLE,
          '--field-id', 'fldPISrmKu', '--format', 'json',
          '--limit', '100', '--offset', String(offset)]);
        if (!r.ok) break;
        const d = r.data;
        const rows = d.data || [], recIds = d.record_id_list || [], flds = d.fields || [];
        const ui = flds.indexOf('地址贴这里');
        for (let i = 0; i < recIds.length; i++) {
          if (remaining.has(recIds[i])) {
            recs.push({ id: recIds[i], url: xhsExtractUrl(ui >= 0 ? (rows[i]||[])[ui] : '') });
            remaining.delete(recIds[i]);
          }
        }
        if (!d.has_more || remaining.size === 0) break;
        offset += 100;
      }
    } catch (e) { log('❌ 读取记录失败: ' + e.message); job.done = true; return; }

    for (const rec of recs) {
      log(`📌 ${rec.id.slice(-8)}  ${rec.url.slice(0, 50)}`);
      let url = rec.url;
      if (!url) { log('  ⚠ 无链接，跳过'); tried.add(rec.id); xhsSaveTried(tried); job.results.push({ id: rec.id, status: 'skip', reason: 'no_url' }); continue; }

      if (url.includes('xhslink.com')) {
        log('  🔗 解析短链…');
        url = await xhsResolveShort(url);
        log('  → ' + url.slice(0, 70));
      }

      const info = xhsParseNote(url);
      if (!info) {
        log('  ⚠ 无法提取 note_id，跳过');
        tried.add(rec.id); xhsSaveTried(tried);
        job.results.push({ id: rec.id, status: 'skip', reason: 'no_note_id' });
        continue;
      }

      log(`  🕷 ${info.noteId} 抓取中…`);
      const result = xhsFetchComments(info.noteId, info.xsecToken, url);

      tried.add(rec.id); xhsSaveTried(tried);

      if (!result.ok) {
        const hint = result.hint || `${result.code} ${result.msg || ''}`;
        log(`  ⚠ ${hint}`);
        job.results.push({ id: rec.id, status: 'skip', reason: result.code });
        continue;
      }

      log(`  ✅ ${result.texts.length} 条文字  ${result.imgs.length} 张图`);

      if (result.texts.length === 0) {
        job.results.push({ id: rec.id, status: 'empty' });
        continue;
      }

      try {
        larkCli(['--as', 'user', 'base', '+record-upsert',
          '--base-token', XHS_BASE, '--table-id', XHS_TABLE,
          '--record-id', rec.id, '--json', xhsTempJsonArg('xhs-comments', { '评论文字': result.texts.join('\n') })]);
        log('  ✍ 写回飞书完成');
        job.results.push({ id: rec.id, status: 'done', texts: result.texts.length });
      } catch (e) {
        log('  ✗ 写回失败: ' + e.message);
        job.results.push({ id: rec.id, status: 'error', reason: e.message });
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    job.done = true;
    log('🏁 批次完成');
  })();
});

app.get('/api/xhs/scrape-poll/:id', (req, res) => {
  const job = xhsJobStore.get(req.params.id);
  if (!job) return res.json({ ok: false });
  res.json({ ok: true, done: job.done, logs: job.logs, results: job.results });
});

const PORT = CFG.server.port;
const httpServer = app.listen(PORT, () => {
  console.log(`\n🍾 每天烈刻 · AI市场部 第二期`);
  console.log(`📡 http://localhost:${PORT}`);
  console.log(`\n环境检查:`);
  console.log(`  生成引擎:          GPT Plus 网页账户（本机 ChatGPT Profile）`)
  console.log(`  飞书 base: ${CFG.feishu.baseToken}`);
  console.log(`  飞书群:    ${CFG.feishu.groupId}`);
});
httpServer.setTimeout(0); // 禁用 socket 超时，由 runClaudeAsync 的应用层超时控制





