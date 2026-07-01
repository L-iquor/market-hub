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

const CFG = require('./config/market-config');

const IMAGE_POOL_CONFIG_PATH = path.join(__dirname, 'image-pool-config.json');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const IMAGE_CACHE_DIR = path.join(__dirname, 'feishu-image-cache');
const FEISHU_RESULT_BASE = 'REDACTED';
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
let topicRefreshRunning = false;

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
    ? incoming.seeds.map(v => String(v || '').trim()).filter(Boolean).slice(0, 20)
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
    timeout: 30000,
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
    if (cfg && cfg.dir) return String(cfg.dir);
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
const MAT_BASE = 'REDACTED'; // 内容生产表，非 CFG.feishu.baseToken
const OUTPUT_BASE  = 'REDACTED'; // 脚本生产输出表
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

  const topicSignalBlock = topicSignal ? `## Topic signal
- Topic keyword: ${topicSignal.trafficKeyword || '(missing)'}
- Core concept: ${topicSignal.coreConcept || topicSignal.title || '(missing)'}
- Bridge term: ${topicSignal.bridge || '(missing)'}
- Intervention: ${topicSignal.intervention || '(missing)'}
- Evidence: ${(topicSignal.evidence || []).slice(0, 3).map(x => typeof x === 'string' ? x : x.title).filter(Boolean).join(' / ') || '(missing)'}

Requirements:
1. Translate the topic into the natural way users would actually search and click.
2. Make sure search terms appear naturally in the title, first two body paragraphs, and tags.
3. Always keep the brand term: 每天烈刻气泡白酒.
4. If there are hot words, scene words, or colloquial terms, embed them naturally instead of dumping a keyword list.
5. Write the search-layout first, then the body.
` : '';

  const searchTermBlock = topicSignal ? `## Search terms and long-tail terms — highest priority
- Core search terms: ${[topicSignal.trafficKeyword, topicSignal.coreConcept].filter(Boolean).join(' / ') || '(none)'}
- Long-tail terms: ${longTailTerms.join(' / ') || '(derive 3-5 natural long-tail phrases from core search intent)'}
- Brand term fixed: #每天烈刻气泡白酒
- Search priority: title > first two paragraphs > tags
- You may split words into more natural phrases, but keep the searchable root terms.
- Decide search intent and placement before choosing the narrative structure and writing the full text.
- These terms are a hard retrieval constraint, but they must not replace the reference article's subject, emotional curve or cadence. Plan their placement before drafting.
` : '';

  const referencePriorityBlock = refArticle ? `## Reference priority
- The reference article's structure, cadence, density, and emotional progression outrank the generic writing rules.
- Read the whole reference body before choosing the angle; do not rely on the title or excerpt only.
- The reference body is complete; do not fill blanks yourself or expand it into a new product explainer.
- Before drafting, silently extract the reference's real subject, central emotional question, paragraph-by-paragraph function, sentence-and-pause pattern, and product exposure ratio.
- Preserve that subject-level mechanism, emotional curve, paragraph rhythm and image-to-text atmosphere. Turning it into a generic tasting review is a failed adaptation.
- Product facts may enter only where the reference naturally introduces an object, action or consumption detail. They must not replace the reference theme.
` : '';

  const referenceSearchSynthesisBlock = refArticle && topicSignal ? `## Reference + search synthesis — first execution step
1. Use the complete reference body as the narrative blueprint: preserve its core subject, emotional progression, paragraph functions, cadence, restraint and product exposure ratio.
2. Build a search placement map before drafting. The exact core search root must appear naturally in the title or first 120 Chinese characters; place at least two distinct long-tail phrases in later body paragraphs; include the brand term once in the body and again in tags.
3. Tags do not count as body placement. Do not dump keywords, repeat one root mechanically, or add a detached SEO paragraph.
4. Search phrases must sound like thoughts and actions belonging to the reference's narrator. If a keyword breaks the atmosphere, rewrite the surrounding sentence rather than abandoning the reference theme.
5. Final check: readers should recognize the reference's subject and emotional movement without seeing copied sentences, while search intent remains retrievable from title, opening, body and tags.
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
提交前先默读一遍，删掉以下痕迹：
- 像客服回答的句子：如“很多人问”“有人问”“能接受”“放心”“想尝鲜的抓紧”“直接冲”。
- 过度网感或 AI 常用热词：如“破防了”“真的绝”“上头了”“狠狠”“封神”，除非参考范例明确使用。
- 像运营硬拉互动的句子：如突兀的二选一、为了评论而评论的问题。
- 解释型套话：连续使用“不是那种”“而是”“反而”“关键是”。
- 故作冷静的散文腔：如“整个人懵了两秒”“不慌不乱”“完全清醒地爽着”“那个时刻很对劲”“敬而远之”。
- 空泛情绪词：只说“惊艳/好喝/绝了”，但后面没有具体口感或动作。
- 固定链路：配料表震惊 → 白酒刻板印象 → 第一口不辣 → 解释甜味来源 → 10度微醺 → 49.9购买建议。除非本次叙事发动机明确要求其中某一环，否则不要连着写。
- 假装事后考证的口头禅：如“后来又翻了一下”“甜的来源后来搞明白了”“才注意到是0糖”。如果不是本篇核心发现，不要用这种补说明结构。

保留真人分享感：短句、具体动作、朋友原话、即时反应、明确判断。不要为了显得高级而压低情绪。`;

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
  const prompt = modules.map(m => m.content).join('\n\n---\n\n');
  return { prompt, modules };
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
  const prompt = modules.map(m => m.content).join('\n\n---\n\n');
  return { prompt, modules };
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

function uploadBaseAttachments(recordId, fieldId, filePaths) {
  const files = (filePaths || []).map(resolvePoolImage);
  if (!recordId || !fieldId || !files.length) return { count: 0, files: [] };
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

const WORK_BASE = 'REDACTED';
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
  if (provider !== 'claude') {
    return (async () => {
      try {
        await postLocalJson('http://127.0.0.1:8765/gpt_launch', { rotate: false }, 30000);
      } catch (e) {
        throw new Error(`GPT Plus 文案引擎未能打开：${e.message}`);
      }
      const data = await postLocalJson('http://127.0.0.1:8765/gpt_text', {
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
      reject(new Error('选题信号采集超过 5 分钟'));
    }, 300000);
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
    title: row.title,
    keyword: row.keyword || '',
    source: row.source || '',
    likes: row.likes || 0,
    collects: row.collects || 0,
    comments: row.comments || 0,
    cover: row.cover || '',
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
  return `你是每天烈刻气泡白酒的选题编辑。下面是三套方法合并后的真实信号：
1. xiaohongshu-ops：首页推荐流里的高互动表达与视觉形式；
2. xhs-content-plan：酒饮相关关键词按热门/最新检索得到的笔记、搜索联想与话题；
3. inkroam-topic-expert：跨平台热点，并按热度、相关性、时效性、可写性、差异化判断。

品牌任务：卖气泡白酒，兼顾强销售转化与场景种草。产品事实由后续 Market Hub 品牌事实模块提供，本步骤不得编造功效、价格、原料、度数或销量。

生成 3-5 张“今日选题卡”。每张卡包含：
- trafficKeyword：平台已有的大流量词，只负责被找到；
- coreConcept：本篇自己建立的记忆概念，负责被记住。优先 6-14 个字，把产品功效翻译成一种让人想进入的身份、状态或场景；禁止写成“气泡白酒的XX”“XX气泡白酒”这类产品说明，也不能只是品牌口号；
- bridge：流量词与气泡白酒的自然关联；
- framework：A/B/C/D 之一，不改变既有框架定义；
- intervention：仅标签 / 标题与标签 / 标题开头与标签 / 整篇语境；
- direction：带入撰写台“补充方向”的一句操作指令；
- rationale：为什么今天值得测试，必须引用信号，不得声称没有时间序列支持的上涨百分比；
- visual：首图/图组建议，至少保留一张真实产品锚点图；
- evidence：1-3 条真实证据，复制 title/source/likes/cover，不得虚构；
- sources：实际贡献到该卡的 skill 名称数组；
- score：0-100；kind：行业需求 / 平台表达 / 跨界热点。

流量大词不能压过 coreConcept。coreConcept 要像一个用户愿意复述、搜索或拿来形容自己的新说法，而不是品类词换序。跨界热点关联弱时宁可不选。输出严格 JSON，不要 Markdown：
{"generatedAt":"...","recommendations":[{"id":"topic-1","kind":"行业需求","trafficKeyword":"","coreConcept":"","bridge":"","framework":"B","intervention":"标题开头与标签","direction":"","rationale":"","visual":"","score":82,"sources":["xhs-content-plan"],"evidence":[{"title":"","source":"","likes":0,"cover":""}]}]}

真实信号：
${JSON.stringify(compactTopicSignals(signals), null, 2)}`;
}

function parseTopicDigest(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('选题整理未返回 JSON');
  const parsed = JSON.parse(match[0]);
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
      ? body.seeds.map(v => String(v || '').trim()).filter(Boolean).slice(0, 20)
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
        modules: (built.modules || []).map(m => ({ name: m.name, chars: (m.content || '').length })),
        prompt,
      };
    }

    const rawText = await runClaudeAsync(prompt, 420000);
    const plan = parsePlan(rawText);

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
      contextStats: { iterComp: ctx.iterComp.length, reference: ctx.reference.length },
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
      contextStats: { iterComp: ctx.iterComp.length, reference: ctx.reference.length, titles: titleCount },
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
    if (tags) fields['话题'] = String(tags).trim().slice(0, 240);

    const selectedImages = Array.isArray(imagePaths) ? imagePaths.slice(0, 9) : [];
    const localImages = [];
    if (selectedImages.length) {
      const feishuImages = selectedImages.map(x => {
        const feishuImage = resolveFeishuResultImage(x);
        if (feishuImage) return feishuImage;
        localImages.push(x);
        return null;
      }).filter(Boolean);
      if (feishuImages.length) fields['图片'] = feishuImages;
    }

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

function dailyLog(job, message) {
  job.logs.push(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`);
  if (job.logs.length > 100) job.logs.splice(0, job.logs.length - 100);
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
  const text = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*(?:备选标题|标题\d*|评论区话术|优化方向|推断依据|框架选择理由|目标人群|主次卖点逻辑)\s*[：:].*$/gm, '')
    .replace(/^\s*\d+[\.、]\s*/gm, '')
    .replace(/#[^\s#]+/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^(---|标题|正文|评论|优化|推断|备选)/.test(line))
    .join(' ');
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentences = clean
    .split(/(?<=[\u3002\uff01\uff1f!?])/)
    .map(s => s.trim())
    .filter(s => s.length >= 12 && s.length <= 90 && !/备选标题|评论区话术|优化方向|推断依据|标题\d/.test(s));
  return Array.from({ length: count }, (_, i) => {
    const s = sentences[i % Math.max(1, sentences.length)] || clean.slice(i * 35, i * 35 + 65);
    return s.slice(0, 72);
  });
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
      attachments,
    };
  }).filter(r => r.id && r.url && r.attachments.length >= 3);
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
  score += Math.min(ref.attachments.length, 9);
  return score;
}

function isAutoImageReferenceUsable(ref) {
  const text = [ref.title, ref.body, ref.tags, ref.purpose, ref.angle, ref.category].join(' ');
  const mlCount = (text.match(/\b\d+\s*ml\b/gi) || []).length;
  if (/视频/.test(ref.category)) return false;
  if (/无效|失败|不合格|重排失败|跳过/.test(ref.imageStatus + ref.purpose + ref.title)) return false;
  if (/求个名字|取个名字|叫什么|不带.+字/.test(text)) return false;
  if (/配方|公式|教程|攻略|揭秘|真相|测评|认识一款酒|信息图|知识点|一图秒懂|懂酒达人|基酒|酒单|合集|清单|无限回购|严选|穷人版/.test(ref.title)) return false;
  if (mlCount >= 2 && /调酒|鸡尾酒|金酒|糖浆|柠檬汁|菠萝汁/.test(text)) return false;
  const hasUsableScene = /氛围|生活|居家|聚会|餐桌|桌面|冰杯|酒饮|微醺|喝酒日常|调酒|鸡尾酒|露营|烧烤|便利店/.test(text);
  const hasImagePurpose = /图片参考|可直接换图|热点话题/.test(ref.purpose);
  return hasUsableScene && hasImagePurpose && ref.attachments.length >= 3;
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
  return { title: title || '\u4eca\u65e5\u5c0f\u7ea2\u4e66\u8349\u7a3f', body };
}

app.get('/api/daily/preview-reference', (req, res) => {
  try {
    const digest = loadTopicJson(TOPIC_RECOMMENDATIONS_PATH, { recommendations: [] });
    const topic = [...(digest.recommendations || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
    if (!topic) throw new Error('\u6ca1\u6709\u53ef\u7528\u7684\u70ed\u70b9\u9009\u9898');
    const selectedReference = chooseReferenceForTopic(topic);
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

app.post('/api/daily/run', (req, res) => {
  const running = [...dailyRunStore.values()].find(job => !job.done);
  if (running) return res.json({ ok: true, jobId: running.id, resumed: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const job = { id, done: false, ok: true, error: '', logs: [], result: {} };
  dailyRunStore.set(id, job);
  res.json({ ok: true, jobId: id });

  (async () => {
    try {
      dailyLog(job, '\u5f00\u59cb\u68c0\u67e5\u70ed\u70b9\u4fe1\u53f7');
      let signals = loadTopicJson(TOPIC_SIGNALS_PATH, null);
      if (req.body?.forceCollect === true) {
        try {
          await runTopicCollector();
          signals = loadTopicJson(TOPIC_SIGNALS_PATH, signals);
          dailyLog(job, '\u70ed\u70b9\u4fe1\u53f7\u91c7\u96c6\u5b8c\u6210');
        } catch (error) {
          dailyLog(job, `\u5b9e\u65f6\u91c7\u96c6\u4e0d\u53ef\u7528\uff0c\u4f7f\u7528\u6700\u8fd1\u6709\u6548\u70ed\u70b9\uff1a${error.message}`);
        }
      } else {
        dailyLog(job, '\u4f7f\u7528 12 \u5c0f\u65f6\u70ed\u70b9\u7f13\u5b58\uff0c\u4e0d\u91cd\u590d\u89e6\u53d1\u5e73\u53f0\u98ce\u63a7');
      }

      let digest = loadTopicJson(TOPIC_RECOMMENDATIONS_PATH, { recommendations: [] });
      if (signals && !signals.error) {
        try {
          const rawDigest = await runClaudeAsync(buildTopicDigestPrompt(signals), 300000);
          digest = parseTopicDigest(rawDigest);
          digest.generatedAt = new Date().toISOString();
          fs.writeFileSync(TOPIC_RECOMMENDATIONS_PATH, JSON.stringify(digest, null, 2), 'utf8');
          dailyLog(job, '\u70ed\u70b9\u7b5b\u9009\u4e0e\u9009\u9898\u8bc4\u5206\u5b8c\u6210');
        } catch (error) {
          dailyLog(job, `\u9009\u9898\u91cd\u7b97\u5931\u8d25\uff0c\u6cbf\u7528\u6700\u8fd1\u7ed3\u679c\uff1a${error.message}`);
        }
      }
      const topic = [...(digest.recommendations || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
      if (!topic) throw new Error('\u6ca1\u6709\u53ef\u7528\u7684\u70ed\u70b9\u9009\u9898');
      dailyLog(job, `\u5df2\u9009\u4e2d\uff1a${topic.coreConcept || topic.trafficKeyword || topic.id}`);

      const requestedReferenceId = String(req.body?.referenceId || '').trim();
      const selectedReference = requestedReferenceId
        ? readCompetitorReferences(300).find(ref => ref.id === requestedReferenceId)
        : chooseReferenceForTopic(topic);
      if (!selectedReference) throw new Error(`\u6307\u5b9a\u7684\u7ade\u54c1\u8bb0\u5f55\u4e0d\u5b58\u5728\uff1a${requestedReferenceId}`);
      const refArticle = {
        title: selectedReference.title,
        tag: selectedReference.tags,
        content: selectedReference.body,
      };
      dailyLog(job, `\u5df2\u9009\u4e2d\u6362\u56fe\u53c2\u8003\uff1a${selectedReference.title || selectedReference.url}`);

      let ctx;
      try { ctx = await fetchFeishuContext(); } catch { ctx = { iterComp: [], reference: [] }; }
      const sellingPoint = '\u6bcf\u5929\u70c8\u523b\u6c14\u6ce1\u767d\u9152\uff1a10\u5ea6\u30010\u7cd60\u5361\u300120%\u539f\u69a8\u679c\u6c41\u3001\u6c14\u6ce1\u53e3\u611f';
      const built = buildPrompt(ctx, topic.direction || topic.bridge || '', sellingPoint, topic.framework || 'B', null, null, null, refArticle, [], null, 'narrative', 'reference', topic);
      dailyLog(job, '\u6b63\u5728\u751f\u6210\u5305\u542b\u70ed\u70b9\u8bcd\u548c\u641c\u7d22\u8bcd\u7684\u6587\u6848');
      const compliance = '\n\n\u5408\u89c4\u8981\u6c42\uff1a0\u7cd60\u5361\u53ea\u80fd\u5ba2\u89c2\u9648\u8ff0\uff0c\u4e0d\u80fd\u5ef6\u4f38\u4e3a\u8eab\u4f53\u8d1f\u62c5\u8f7b\u3001\u51cf\u80a5\u3001\u5065\u5eb7\u6216\u65e0\u8d1f\u62c5\u3002\u4e0d\u5f97\u627f\u8bfa\u4e0d\u9189\u3001\u4e0d\u4e0a\u5934\u6216\u65e0\u523a\u6fc0\u3002';
      const rawDraft = await runClaudeAsync(built.prompt + compliance, 420000);
      const draft = parseDailyDraft(rawDraft);
      const tags = ['#\u6bcf\u5929\u70c8\u523b\u6c14\u6ce1\u767d\u9152', topic.trafficKeyword, topic.coreConcept]
        .filter(Boolean).map(x => String(x).startsWith('#') ? String(x) : `#${x}`).join(' ');
      const written = writeOutputRecord({
        '\u6807\u9898': draft.title, '\u6b63\u6587': draft.body, '\u8bdd\u9898': tags,
        '\u53d1\u5e03\u8ba1\u5212': '\u81ea\u52a8\u751f\u6210', '\u662f\u5426\u53d1\u5e03': '\u5426',
        '\u53d1\u5e03\u8d26\u53f7': '\u6bcf\u5929\u70c8\u523b / legacy',
        '\u53c2\u8003\u94fe\u63a5': selectedReference.url,
      });
      const recordId = extractRecordIdFromWrite(written) || findOutputRecordIdByTitle(draft.title);
      dailyLog(job, `\u6587\u6848\u5df2\u56de\u586b\u53d1\u5e03\u8868${recordId ? `\uff08${recordId}\uff09` : ''}`);
      const savedBody = readOutputRecordBody(recordId) || draft.body;

      const expectedImageCount = selectedReference.attachments.length;
      const refs = downloadCompetitorAttachments(selectedReference.id, expectedImageCount);
      if (refs.length !== expectedImageCount) throw new Error(`\u7ade\u54c1\u8868\u767b\u8bb0 ${expectedImageCount} \u5f20\u56fe\uff0c\u5b9e\u9645\u4e0b\u8f7d ${refs.length} \u5f20`);
      markCompetitorImageStatus(selectedReference.id, '\u5df2\u5efa\u961f\u5217');
      try {
        await postLocalJson('http://127.0.0.1:5000/api/gpt-queue-state', { action: 'clear' }, 30000);
        dailyLog(job, '\u5df2\u6e05\u7a7a\u65e7 GPT \u6362\u56fe\u961f\u5217');
      } catch (error) {
        dailyLog(job, `\u65e7 GPT \u961f\u5217\u6e05\u7406\u5931\u8d25\uff1a${error.message}`);
      }
      const productReferenceIds = await getFeishuProductReferenceIds();
      const overlayTextList = buildImageOverlayTexts(savedBody, refs.length);
      dailyLog(job, `\u5df2\u4ece\u53d1\u5e03\u8868\u6b63\u6587\u5b57\u6bb5\u63d0\u53d6 ${overlayTextList.length} \u6761\u6c1b\u56f4\u56fe\u6587\u5b57`);
      const queue = await postLocalJson('http://127.0.0.1:5000/api/gpt-helper-queue', {
        scenes: refs.map(file => ({ path: file, record_id: selectedReference.id, name: path.basename(file) })),
        batch_size: expectedImageCount, gen_count: 1, match_mode: 'manual', product_record_ids: productReferenceIds,
        scene_modes: Object.fromEntries(refs.map((_, i) => [String(i), 'auto'])),
        overlay_texts: Object.fromEntries(overlayTextList.map((text, i) => [String(i), text])),
        positive: '\u9010\u56fe\u5224\u65ad\u3002\u65e0\u4ea7\u54c1\u7684\u6c1b\u56f4\u56fe\uff1a\u751f\u6210\u76f8\u4f3c\u6c1b\u56f4\u65b0\u573a\u666f\uff0c\u6392\u5165\u672c\u7bc7 post \u6b63\u6587\u91d1\u53e5\u7247\u6bb5\u3002\u539f\u56fe\u5df2\u6709\u660e\u786e\u9152\u7c7b\u4ea7\u54c1\uff1a\u4ec5\u66ff\u6362\u8be5\u4ea7\u54c1\uff0c\u5e76\u4e25\u683c\u4f7f\u7528\u98de\u4e66\u4ea7\u54c1\u7d20\u6750\u8868\u7684\u74f6\u8eab\u4e0e\u6807\u7b7e\u7ec6\u8282\u56fe\u3002',
        negative: '\u6a21\u7cca\u3001\u53d8\u5f62\u3001\u9519\u8bef\u74f6\u6807\u3001\u591a\u4f59\u74f6\u5b50\u3001AI\u611f\u3001\u590d\u5236\u539f\u56fe\u6587\u5b57\u3001\u590d\u5236\u5546\u6807\u6216\u6c34\u5370\u3001\u76f4\u63a5\u7167\u642c\u539f\u56fe\u4eba\u7269\u548c\u88c5\u9970',
      }, 120000);
      if (!queue.ok) throw new Error(queue.error || '\u521b\u5efa GPT \u6362\u56fe\u961f\u5217\u5931\u8d25');
      const queueState = await getLocalJson('http://127.0.0.1:5000/api/gpt-queue-state');
      const queueItems = queueState.items || [];
      const mismatchedItems = queueItems.filter(item => item.scene_record_id !== selectedReference.id);
      if (queueItems.length !== expectedImageCount || mismatchedItems.length) {
        throw new Error('\u65b0 GPT \u961f\u5217\u6821\u9a8c\u5931\u8d25\uff1a\u53c2\u8003\u56fe\u4e0d\u662f\u5f53\u524d\u9009\u4e2d post');
      }
      dailyLog(job, `\u5df2\u6309\u539f post \u9644\u4ef6\u6570\u521b\u5efa ${expectedImageCount} \u4e2a GPT \u751f\u56fe\u4efb\u52a1`);
      try {
        await postLocalJson('http://127.0.0.1:8765/gpt_launch', { rotate: false }, 30000);
        dailyLog(job, '\u5df2\u6253\u5f00 GPT Profile\uff0c\u7b49\u5f85\u6269\u5c55\u5904\u7406\u961f\u5217');
      } catch (error) { dailyLog(job, `GPT Profile \u6253\u5f00\u5931\u8d25\uff1a${error.message}`); }

      job.result = { topic, reference: { id: selectedReference.id, title: selectedReference.title, url: selectedReference.url }, draft: { title: draft.title, tags }, recordId, imageTasks: expectedImageCount, stage: 'waiting_images' };
      dailyLog(job, `\u5df2\u8fdb\u5165\u751f\u56fe\u9636\u6bb5\uff0c\u5c06\u81ea\u52a8\u7b49\u5f85 ${expectedImageCount} \u5f20\u7ed3\u679c\u56fe`);

      let lastDone = -1;
      let unchanged = 0;
      for (let attempt = 0; attempt < 720; attempt++) {
        await waitMs(10000);
        const state = await getLocalJson('http://127.0.0.1:5000/api/gpt-queue-state');
        const items = state.items || [];
        const completed = items.filter(item => ['done', 'complete'].includes(item.status)).length;
        if (completed !== lastDone) {
          lastDone = completed; unchanged = 0;
          dailyLog(job, `GPT \u751f\u56fe\u8fdb\u5ea6\uff1a${completed}/${items.length || expectedImageCount}`);
        } else { unchanged += 1; }
        if (items.length === expectedImageCount && completed >= expectedImageCount) break;
        if (unchanged >= 12 && completed === 0) {
          throw new Error('GPT Profile \u9700\u8981\u5b8c\u6210\u4e00\u6b21\u767b\u5f55\uff1b\u961f\u5217\u5df2\u4fdd\u7559\uff0c\u767b\u5f55\u540e\u4f1a\u7ee7\u7eed');
        }
      }
      const finalQueueState = await getLocalJson('http://127.0.0.1:5000/api/gpt-queue-state');
      const files = (finalQueueState.items || [])
        .slice(0, expectedImageCount)
        .map(item => item.result_file || (Array.isArray(item.result_files) ? item.result_files[0] : ''))
        .filter(Boolean);
      if (files.length < expectedImageCount) throw new Error(`GPT \u53ea\u4e0b\u8f7d\u5230 ${files.length} \u5f20\u56fe\uff0c\u5e94\u6709 ${expectedImageCount} \u5f20`);
      uploadBaseAttachments(recordId, OUTPUT_FIELDS.\u56fe\u7247, files);
      markCompetitorImageStatus(selectedReference.id, '\u5df2\u5b8c\u6210');
      dailyLog(job, `\u5df2\u4e0a\u4f20 ${files.length} \u5f20\u6210\u54c1\u56fe\u5230\u98de\u4e66\u9644\u4ef6\u5b57\u6bb5`);
      await Promise.allSettled([
        postLocalJson('http://127.0.0.1:8765/cleanup_gpt_results', {}, 30000),
        postLocalJson('http://127.0.0.1:8765/open_publish_page', {}, 30000),
      ]);
      try { fs.rmSync(path.dirname(refs[0]), { recursive: true, force: true }); } catch {}
      job.result.stage = 'ready_for_review';
      job.result.imageCount = files.length;
      dailyLog(job, '\u672c\u5730\u7f13\u5b58\u5df2\u6e05\u7406\uff0c\u5c0f\u7ea2\u4e66\u53d1\u5e03\u9875\u5df2\u6253\u5f00\uff0c\u7b49\u5f85\u4eba\u5de5\u5ba1\u6838');
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
    res.json({ ok: true, iterComp: ctx.iterComp.length, reference: ctx.reference.length });
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
      '--base-token', 'REDACTED',
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
      '--base-token', 'REDACTED',
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
      '--base-token', 'REDACTED',
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

const XHS_BASE      = 'REDACTED';
const XHS_TABLE     = 'tblGpK7czdgjFZbi';
const XHS_TRIED_F   = path.join(os.homedir(), 'xhs_tried.json');
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
      '--format', 'json', '--limit', '100', '--offset', String(offset)]);
    if (!r.ok) break;
    const d = r.data;
    const rows = d.data || [], ids = d.record_id_list || [], flds = d.fields || [];
    const ui = flds.indexOf('地址贴这里');
    const noteUi = flds.indexOf('笔记地址');
    const titleI = flds.indexOf('笔记标题');
    const textI = flds.indexOf('评论文字');
    const imageI = flds.indexOf('评论图片');
    for (let i = 0; i < ids.length; i++) {
      const row = rows[i] || [];
      const url = xhsExtractUrl(ui >= 0 ? row[ui] : '') || xhsExtractUrl(noteUi >= 0 ? row[noteUi] : '');
      const commentText = textI >= 0 ? String(row[textI] || '') : '';
      const images = imageI >= 0 && Array.isArray(row[imageI]) ? row[imageI] : [];
      if (url || commentText) records.push({
        id: ids[i], url, title: titleI >= 0 ? String(row[titleI] || '') : '',
        commentText, commentCount: commentText ? commentText.split(/\r?\n/).filter(Boolean).length : 0,
        imageCount: images.length, hasData: !!commentText, tried: tried.has(ids[i]),
      });
    }
    if (!d.has_more) break;
    offset += 100;
  }
  return records;
}

app.get('/api/xhs/records', (req, res) => {
  try { res.json({ ok: true, records: xhsFetchAllRecords() }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
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
    const existing = new Set(xhsFetchAllRecords().map(r => r.url).filter(Boolean));
    const fresh = urls.filter(url => !existing.has(url));
    if (!fresh.length) return res.json({ ok: true, created: 0, duplicate: urls.length, ids: [] });
    const created = larkCli(['--as', 'user', 'base', '+record-batch-create',
      '--base-token', XHS_BASE, '--table-id', XHS_TABLE,
      '--json', JSON.stringify({ fields: ['地址贴这里', '笔记地址'], rows: fresh.map(url => [url, url]) }),
      '--format', 'json']);
    res.json({ ok: true, created: fresh.length, duplicate: urls.length - fresh.length,
      ids: created.data?.record_id_list || [] });
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
    res.json({ ok: false, error: e.message });
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
          '--record-id', rec.id, '--json', JSON.stringify({ '评论文字': result.texts.join('\n') })]);
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
