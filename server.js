/**
 * 每天烈刻 · AI市场部 · 第一期服务器
 * 撰写助理
 */

require('dotenv').config();
const express = require('express');
const { spawnSync } = require('child_process');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CFG = require('./config/market-config');

// ─── 框架基础模板覆盖（用户可编辑，存磁盘）──────────────────────────
const BASE_OVERRIDES_PATH = path.join(__dirname, 'base-overrides.json');

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

// ─── lark-cli 封装 ──────────────────────────────────────────────────
function larkCli(args) {
  const result = spawnSync('lark-cli', args, {
    encoding: 'utf8',
    timeout: 30000,
    shell: true,
    cwd: __dirname,
    env: { ...process.env, PATH: process.env.PATH },
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

  const selectedIds = loadSelectedRefIds();
  if (selectedIds.length > 0) {
    const pinned = allRefRecords.filter(r => selectedIds.includes(r._id));
    ctx.reference = pinned.length > 0 ? pinned : allRefRecords.slice(-refCfg.readLimit);
  } else {
    ctx.reference = allRefRecords.slice(-refCfg.readLimit);
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
function buildPrompt(ctx, direction, sellingPoint, framework, subTemplate = null, persona = null, scene = null, refArticle = null, spItems = [], angle = null, toneStyle = 'narrative') {
  const { brand } = CFG;
  const fwLabel = FRAMEWORK_LABELS[framework] || '场景种草型';

  // ① 撰写系统指令（用户可编辑）
  const writingInstructions = loadWritingInstructions();
  const systemBlock = writingInstructions
    ? `${writingInstructions}`
    : `## 撰写规范\n（writing-instructions.md 未找到，使用默认规范）`;

  // ② 品牌固定事实（从 brand-facts.md 读取，支持 UI 编辑）
  const brandBlock = loadBrandFacts();

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
  let frameworkLogicBlock = '';
  const isPhilMode = angle?.isSpecial === true;
  if (isPhilMode) {
    frameworkLogicBlock = PHIL_FW_BLOCK + '\n\n' + PHIL_EXAMPLE;
  } else if (angle) {
    frameworkLogicBlock = `## 框架${framework} · ${fwLabel}

${FW_CORE[framework] || ''}

**本次切入方式（已预选，严格按此角度展开，不使用其他切入方式）：${angle.name}**
${angle.desc}`;
  } else if (baseTemplate) {
    frameworkLogicBlock = refArticle
      ? `## 框架${framework}内容逻辑（内容方向参考，结构节奏以参考范文为准）\n\n${baseTemplate.body}`
      : `## 框架${framework}写作逻辑\n\n${baseTemplate.body}`;
  }

  // 框架示例不注入 prompt——注入示例会导致 Claude 照抄模板结构（已验证，勿改）
  const frameworkExampleBlock = '';

  // ③a 仿写参考范文（用户在参考文案库中选择后注入）
  const imitBlock = refArticle
    ? `## ★ 本次首要任务：仿写以下参考范文\n本次生成的节奏、情绪走向、句式结构必须以此范文为蓝本。品牌事实和框架内容逻辑服务于这个结构，不得覆盖它。内容完全原创，不得复制原文字句。\n\n标题：${refArticle.title || '（无标题）'}\n标签：${refArticle.tag || '（无标签）'}\n\n${(refArticle.content || '').slice(0, 1000)}`
    : '';

  // ③b 风格子模板（用户主动选择时叠加注入）
  const subTemplateBlock = subTemplate
    ? `## 本次仿写风格模板：${subTemplate.name}\n${subTemplate.desc ? `说明：${subTemplate.desc}\n` : ''}\n${subTemplate.body}\n\n（在参考范文结构基础上，同时参考以上风格句式节奏）`
    : '';


  // ⑤ 飞书实时学习材料
  let learningBlock = '## 飞书学习材料（按优先级排列）\n\n';

  const titleBlock = titleLibraryBlock();
  if (titleBlock) learningBlock += titleBlock;

  if (ctx.iterComp.length > 0) {
    learningBlock += `### 优先级1·人工修改偏好（从改动中学习用户偏好方向）\n`;
    ctx.iterComp.slice(-10).forEach((r, i) => {
      if (r.修改前 && r.修改后) {
        learningBlock += `[${i+1}] 修改前：${r.修改前.slice(0, 120)}\n    修改后：${r.修改后.slice(0, 120)}\n`;
        if (r.修改理由) learningBlock += `    原因：${r.修改理由.slice(0, 80)}\n`;
      }
    });
    learningBlock += '\n';
  }

  if (!refArticle && ctx.reference.length > 0) {
    learningBlock += `### 优先级2·参考图文文案（学习平台原生爆款句式和感官描写）\n`;
    ctx.reference.slice(-10).forEach((r, i) => {
      const title = r.标题 ? `【${r.标题}】` : '';
      const tag = r.标签 ? `（${r.标签}）` : '';
      const preview = (r.文案内容 || '').slice(0, 150);
      learningBlock += `[${i+1}]${title}${tag}\n${preview}\n\n`;
    });
  }

  if (ctx.iterComp.length === 0 && (refArticle || ctx.reference.length === 0)) {
    learningBlock += '（暂无飞书学习材料，依据品牌事实撰写）\n';
  }

  // ⑤ 当前任务
  const fwNote = refArticle
    ? `框架${framework} · ${fwLabel}（内容逻辑参考，结构节奏以上方参考范文为准）`
    : `框架${framework} · ${fwLabel}（严格遵守此框架的写作逻辑和写作顺序）`;
  const dreamLine = (persona && scene)
    ? `造梦构思：${persona.name}在「${scene.name}」里的一个生活时刻。${sellingPoint}是这个时刻里自然出现的道具，不是主角。内容从这个人和这个时刻出发，单点展开。`
    : `本次主推卖点：${sellingPoint}`;
  const taskBlock = `## 当前任务
内容框架：${fwNote}
方向：${direction}
${dreamLine}`;

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

  const kocToneBlock = (!isPhilMode && toneStyle === 'koc') ? `## 语气风格：热情KOC（本次生成优先遵守此项）

写作口吻像真实用户在向朋友安利，有热情，有具体感受，语气直接。
- 情绪直接说出来——惊喜就写惊喜，落在具体感官瞬间就不空洞
- 感叹号可以用，语气有起伏，不刻意压平
- 推荐句式可以出现：「真的建议试试」「这个不踩雷」「可以入」
- 像发朋友圈或给好友发消息，不是写散文，不是叙事文学
- 不要用意识流、对话碎片、第三者视角等文学手法` : '';

  const modules = [
    { name: '① 撰写规范', key: 'writing', content: systemBlock },
    ...(kocToneBlock ? [{ name: '① 语气风格（KOC）', content: kocToneBlock }] : []),
    { name: '② 品牌事实', key: 'brand',   content: brandBlock },
    ...(sellingPointBlock ? [{ name: '② 本次主推卖点详情', content: sellingPointBlock }] : []),
    ...(materialBlock   ? [{ name: '③ 定向素材（人/场）', content: materialBlock }]   : []),
    ...(productBlock    ? [{ name: '④ 动态产品信息', key: 'product', content: productBlock }]    : []),
    ...(imitBlock       ? [{ name: '⑤ 仿写参考范文★',    content: imitBlock }]        : []),
    // 角度/哲学模式下内容由硬编码生成，不可保存；只有无角度（base template 模式）时才挂 key 允许编辑
    ...(frameworkLogicBlock ? [{ name: (angle || isPhilMode) ? '⑥ 框架写作逻辑（角度模式·动态）' : '⑥ 框架写作逻辑（可保存）', key: (angle || isPhilMode) ? undefined : `fw-body-${framework}`, content: frameworkLogicBlock }] : []),
    ...(!imitBlock && frameworkExampleBlock ? [{ name: '⑦ 框架参考示例（基础模板 example）', key: `fw-example-${framework}`, content: frameworkExampleBlock }] : []),
    ...(subTemplateBlock ? [{ name: '⑧ 风格子模板',      content: subTemplateBlock }] : []),
    { name: '⑨ 飞书学习材料', content: learningBlock },
    { name: '⑩ 当前任务',    content: taskBlock },
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
    imitBatchBlock = `## ★ 本次首要任务：仿写以下参考范文\n节奏、情绪走向、句式结构以此范文为蓝本，品牌事实和框架逻辑服务于这个结构。内容完全原创。\n\n标题：${refArticle.title || '（无标题）'}\n标签：${refArticle.tag || '（无标签）'}\n\n${(refArticle.content || '').slice(0, 800)}`;
  }

  const batchDreamLine = (persona && scene)
    ? `造梦构思：${persona.name}在「${scene.name}」里的一个生活时刻。${sellingPoint}是这个时刻里自然出现的道具，不是主角。内容从这个人和这个时刻出发，单点展开。`
    : `主推卖点：${sellingPoint}`;
  const taskBlock = `## 当前任务\n框架：${framework} · ${fwLabel}\n方向：${direction || '不限'}\n${batchDreamLine}`;

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

function writeOutputRecord(fields) { return writeToBase(OUTPUT_TABLE, fields, OUTPUT_BASE); }
function writeMatRecord(tableId, fields) { return writeToBase(tableId, fields, MAT_BASE); }
function writeRecord(tableId, fields) { return writeToBase(tableId, fields); }

// ─── Claude 异步调用（用于批量/竞品分析，不阻塞事件循环）─────────────
function runClaudeAsync(prompt, timeoutMs = 90000) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const { ANTHROPIC_API_KEY: _drop, ...envWithoutKey } = process.env;
    const claudeCmd = path.join(process.env.APPDATA || '', 'npm', 'claude.cmd');
    // 强制 64 位上下文：显式用 System32\cmd.exe，覆盖 VBS 可能传入的 32 位环境变量
    const child = spawn('C:\\Windows\\System32\\cmd.exe', ['/c', claudeCmd, '-p', '--dangerously-skip-permissions'], {
      shell: false,
      env: {
        ...envWithoutKey,
        PROCESSOR_ARCHITECTURE: 'AMD64',
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
      if (!text) return reject(new Error(stderr.trim() || `exit ${code}`));
      resolve(text);
    });
    child.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ═══════════════════════════════════════════════════════════════════
// API 路由
// ═══════════════════════════════════════════════════════════════════

// 生成文案
app.post('/api/generate', async (req, res) => {
  try {
    const { framework = 'B', direction, sellingPoint, spItems = [], subTemplate = null, persona: reqPersona = null, scene: reqScene = null, refArticle = null, rawPrompt = null, angle: reqAngle = null, toneStyle = 'narrative' } = req.body;
    if (!sellingPoint && !rawPrompt) return res.json({ ok: false, error: '请选择或填写主推卖点' });

    let prompt;
    let ctx = { iterComp: [], reference: [] };
    let usedAngle = reqAngle;
    let autoPersona = null, autoScene = null;
    let persona = reqPersona, scene = reqScene;

    if (rawPrompt) {
      prompt = rawPrompt;
    } else {
      try { ctx = await fetchFeishuContext(); }
      catch (e) { console.error('[Context fetch]', e.message); }

      // 切入方式：使用客户端传入的，否则从服务器取当前轮转值
      if (!usedAngle) usedAngle = getCurrentAngle(framework);

      // 自动补齐人群/场景（用户未选时随机注入，强制起点多样性）
      if (!persona || !scene) {
        try {
          const mats = fetchMaterials();
          if (!persona && mats.人.length > 0) {
            autoPersona = mats.人[Math.floor(Math.random() * mats.人.length)];
            persona = autoPersona;
          }
          if (!scene && mats.场.length > 0) {
            autoScene = mats.场[Math.floor(Math.random() * mats.场.length)];
            scene = autoScene;
          }
        } catch (e) { console.warn('[auto-select materials]', e.message); }
      }

      ({ prompt } = buildPrompt(ctx, direction, sellingPoint, framework, subTemplate, persona, scene, refArticle, spItems, usedAngle, toneStyle));
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
app.post('/api/preview-prompt', async (req, res) => {
  try {
    const { framework = 'B', direction = '', sellingPoint = '（预览）', spItems = [], subTemplate = null, persona = null, scene = null, refArticle = null, mode = 'single', angle = null, toneStyle = 'narrative' } = req.body;
    let ctx;
    try { ctx = await fetchFeishuContext(); } catch { ctx = { iterComp: [], reference: [] }; }
    const result = mode === 'batch'
      ? buildBatchPrompt(ctx, direction, sellingPoint, framework, persona, scene, refArticle, spItems)
      : buildPrompt(ctx, direction, sellingPoint, framework, subTemplate, persona, scene, refArticle, spItems, angle, toneStyle);
    const titleCount = (() => { try { return loadTitleLibrary().length; } catch { return 0; } })();
    res.json({
      ok: true,
      prompt: result.prompt,
      modules: result.modules,
      contextStats: { iterComp: ctx.iterComp.length, reference: ctx.reference.length, titles: titleCount },
      inputs: { framework, direction, sellingPoint, subTemplate: subTemplate?.name || null, persona: persona?.name || null, scene: scene?.name || null, refArticle: refArticle?.name || null },
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
app.post('/api/save-to-publish', (req, res) => {
  try {
    const { title, body, tags, scene, angle, framework } = req.body;
    if (!body || !body.trim()) return res.json({ ok: false, error: '正文不能为空' });
    const fields = {
      '标题':    title  || '',
      '正文':    body.trim(),
      '话题':    tags   || '',
      '发布计划': '立即发布',
      '是否发布': '否',
    };
    if (scene)     fields['场景名称'] = scene;
    if (angle)     fields['货角度']   = angle;
    if (framework) fields['框架类型'] = framework;
    writeOutputRecord(fields);
    res.json({ ok: true });
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

    const rawText = await runClaudeAsync(prompt, 240000);
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

function xhsFetchComments(noteId, xsecToken) {
  const cmd = [UV_BIN, 'run', 'xhs', 'comments', noteId, '--all', '--json'];
  if (xsecToken) cmd.push('--xsec-token', xsecToken);
  const r = spawnSync(cmd[0], cmd.slice(1), {
    encoding: 'utf8', timeout: 60000,
    cwd: XHS_CLI_DIR, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  let data;
  try { data = JSON.parse(r.stdout || '{}'); } catch { return { ok: false, code: 'parse_error' }; }
  if (!data.ok) return { ok: false, code: data.error?.code || 'unknown', msg: data.error?.message || '' };
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
      '--field-id', 'fldPISrmKu', '--field-id', 'fldL90EX2O',
      '--format', 'json', '--limit', '100', '--offset', String(offset)]);
    if (!r.ok) break;
    const d = r.data;
    const rows = d.data || [], ids = d.record_id_list || [], flds = d.fields || [];
    const ui = flds.indexOf('地址贴这里'), ti = flds.indexOf('评论文字');
    for (let i = 0; i < ids.length; i++) {
      const row = rows[i] || [];
      const url = xhsExtractUrl(ui >= 0 ? row[ui] : '');
      const hasData = ti >= 0 && !!row[ti];
      if (url) records.push({ id: ids[i], url, hasData, tried: tried.has(ids[i]) });
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
      const result = xhsFetchComments(info.noteId, info.xsecToken);

      tried.add(rec.id); xhsSaveTried(tried);

      if (!result.ok) {
        const hint = result.code === 'verification_required' ? '验证码触发' : `${result.code} ${result.msg}`;
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
  console.log(`  生成引擎:          claude CLI (Pro 账户)`)
  console.log(`  飞书 base: ${CFG.feishu.baseToken}`);
  console.log(`  飞书群:    ${CFG.feishu.groupId}`);
});
httpServer.setTimeout(0); // 禁用 socket 超时，由 runClaudeAsync 的应用层超时控制
