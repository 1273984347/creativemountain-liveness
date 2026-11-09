// tools/laya-probe/state-text.mjs
// 可见性受限的 state 文本化（规格 §7 + 预研红线 3 / 设计 §4.5）。
//
// ⚠️ 只允许访问**公开集**：棋盘格位与地形、各家资源·HP·位次·身份·阵营·印记·持牌数·装备计数·活人席、
//   认证池与票数（pending / 签印进度 / 复议票）、山议已投票、**自己**的手牌、已公开亮牌、对峙双方座位。
//   禁止集（他人手牌 id、牌堆顺序、对峙双方的锁定牌）在本文件内**不得出现字段访问**。
//
// ⚠️ 为什么白名单必须是**结构性**的，而不是「先序列化再过滤」（Task 8 硬要求）：
//   · 事后 scrub 意味着私密信息已经在内存里被读出来过 —— 红线 3 要防的正是这一步，
//     「模型最终没看到」与「程序根本没读」不是同一件事（前者只在最后一次输出上成立）；
//   · 过滤器漏一个字段就前功尽弃，而「不写访问」不可遗漏：没写就是没读；
//   · 反过来，任何事后过滤器都必须**点名**它要过滤的字段 ⇒ 常驻结构守卫
//     （`tests/engine/legal-probe.test.ts` 的「结构层」用例，扫**去注释后的源码**）
//     把「直接输出」与「先读再洗」两种写法一并拦住 —— 它认的是字段名与访问形状，不是数据流方向。
//
// ⚠️【控制器裁定 · 评审 3】设计 §4.5 把「本局日志摘要」也列进了公开集，本轮**裁定为不做**：
//   日志 message 是各分支自撰的自由文本（对峙结算就会把牌名直接写进 message），而输出侧的可见性
//   现在靠**封闭词表**判定（用例 ①）—— 要消费日志就得把「任意人写的自由文本」整体放进词表，
//   词表一开这个口子就等于没有。⇒ 本文件继续**不读日志**；设计 §4.5 这一条交 Task 9 修订
//   （降级为「先给日志立字段级白名单，再谈进公开集」）。
//
// ⚠️【封闭词表的代价 · 改这个文件的人必须知道】文本层每新增一个公开字段、每改一句文案，
//   测试侧的模板词表都要同步补一条，否则用例 ① 直接判红。这是有意的评审点：
//   「这个字段要不要进公开集」本来就该是一次被看见的决定，不该由格式化顺手带过去。
//   ⇒ 由此得出本文件的**写法纪律**：模板词与数据之间留分隔符（`阶段 行动`、`身份 identity_0`、
//     `已有 1 / 门槛 3`），数据与数据之间也留分隔符（`座0 vs 座1`）；粘连写法在词表法下会被
//     切成一整段未知 token —— 那正是评审 2 要的牙齿，别把它当格式问题顺手抹平。
//
// ⚠️ 本文件在 tools/ 下：不得被发布包引用（红线 2，esbuild 会把引用链打进单文件 HTML）。
//   直接 import 引擎模块是 tools/*.mjs 的既有做法（doc-sync-lib / ir-validate 同法）。

import { getLegalActions } from '../../engine/core/legal.ts';
import { actionKey } from '../../engine/core/action-key.ts';
import { certificationThreshold, signatureCount } from '../../engine/core/certification.ts';
import { distanceToPeak } from '../../engine/core/victory.ts';
import { tileAt } from '../../engine/core/board.ts';

/** 一句话动作语义的长度预算（`rl_agent_config.head_max_len=256` ⇒ 每候选一句、≤40 字符）。 */
const ONE_LINE_MAX = 40;

/** 超出预算时截断（题面靠 key 精确区分，语义只需要「一眼认出这是什么动作」）。 */
function cut(text) {
  return text.length > ONE_LINE_MAX ? text.slice(0, ONE_LINE_MAX) : text;
}

/** 列表为空时写「无」，不许留下「已投票座位：」这种没有内容的标签（评审 5）。 */
function orNone(values) {
  return values.length === 0 ? '无' : values.map((x) => String(x)).join('、');
}

/** 座位画像：全部公开字段。手牌在这里**只取条数**（持牌数对全场公开），不取任何一张牌。 */
function seatLine(state, p) {
  const seats = state.liveSeats[p.seat] ?? 0;
  return `座${p.seat} 身份 ${p.identityId} 阵营 ${p.factionId}`
    + ` 位${p.position} 距峰${distanceToPeak(state, p.seat)}`
    + ` 血${p.hp}/${p.hpMax} 资源${p.resource} 持牌${p.hand.length} 装备${p.equipment.length} 席${seats}`
    + (p.hasMark ? ' 持印记' : '') + (p.pendingCert ? ' 待认证' : '') + (p.alive ? '' : ' 已出局');
}

/**
 * 当前格地形。只写 kind（主题契约 TileKind 的**闭合枚举**，types/theme.ts:168），
 * 不写格名 —— 格名是主题包的自由文本，进了输出就等于往封闭词表里灌任意文本（与日志同理）。
 */
function tileKindAt(state, position) {
  const tile = tileAt(state.board, position);
  return tile === undefined ? '山道起点' : tile.kind;
}

/**
 * 复议票的**计数**（评审 3：投票人必须知道自己这一票的分量）。
 *
 * 只报数、不重写规则：多数决（含平票保护、独立第三方不足 2 人时掷骰）本身留在
 * certification.ts 的 `resolveAppeals`；这里复用的只是它那条**公开**的「独立第三方」集合口径
 * （存活 − 判定人 − 待认证者），判定人取自公开的 judgments 键。
 */
function appealTally(state, target) {
  const c = state.certification;
  const challenger = Object.keys(c.judgments)
    .map((k) => Number(k))
    .find((s) => c.judgments[s] === false);
  const thirdParties = state.players
    .filter((p) => p.alive && p.seat !== target && p.seat !== challenger)
    .map((p) => p.seat);
  const cast = thirdParties.filter((s) => c.appealVotes[s] !== undefined);
  const overturns = cast.filter((s) => c.appealVotes[s] === true).length;
  return `第三方 ${String(thirdParties.length)} 人｜已投 ${String(cast.length)}`
    + `（推翻 ${String(overturns)}、维持 ${String(cast.length - overturns)}）`
    + `｜未投 ${String(thirdParties.length - cast.length)}`;
}

/**
 * 局面描述（`/v1/systemone` 的 `state` 字段）。
 *
 * @param {object} state 引擎状态（只读）
 * @param {number} seat 决策座位 —— **可见性视角**：文本里只允许出现这个座位自己的手牌内容
 */
export function describeState(state, seat) {
  const me = state.players[seat];
  if (me === undefined) {
    throw new Error(`describeState：座${String(seat)} 不存在（本局 ${String(state.players.length)} 人）`);
  }
  const c = state.certification;
  // 评审 5：表头必须说清「本手是谁在动」以及「读文本的人是不是那个座位」——
  // 过去只有一句 `第N手`，模型连现在轮不轮到自己都不知道，行动面与等待面全靠猜。
  const activeSeat = state.turnOrder[state.turnIndex];
  const lines = [
    `第${state.round}轮 第${state.turnIndex + 1}手 阶段 ${state.phase}`
      + `｜本手行动：${activeSeat === undefined ? '无人' : `座${activeSeat}`}`
      + `｜${activeSeat === seat ? '轮到你了' : '不是你的手番'}`,
    `你的手牌：${me.hand.length === 0
      ? '无'
      : me.hand.map((x) => `${x.name}(费${x.cost},${x.color === 'red' ? '红' : '黑'})`).join('、')}`,
    // 评审 3：棋盘格位**与地形**（设计 §4.5 的公开集）。`MOVE` 的价值全在「还差几格到峰顶」，
    // 过去只交了 `位N`，模型得自己知道棋盘多长、峰顶在第几格 —— 那是人类玩家一眼就能看到的事实。
    `棋盘 ${state.board.length} 格｜峰顶 第 ${state.board.peakIndex} 格`
      + `｜你在 第 ${me.position} 格 距峰顶 ${distanceToPeak(state, seat)} 格`
      + `｜地形 ${tileKindAt(state, me.position)}`,
    ...state.players.map((p) => seatLine(state, p)),
  ];
  // 已公开亮牌（§3.3：比较后留在场上公开、不回任何人的手牌，round 末清空）——公开集，可写。
  if (state.publicCards.length > 0) {
    lines.push(`公开亮牌：${state.publicCards
      .map((x) => `座${x.seat}·${x.name}（${x.color === 'red' ? '红' : '黑'}·${x.rank}）`).join('、')}`);
  }
  // 评审 4：对峙未决时**行动窗口整体关闭**（legal.ts 的 actionWindowOpen），题面会是空的；
  // 空题面 + 一句都不提对峙 = 读者无法把「没有候选」与「模型拒答」分开。这里把公开事实写出来：
  // 只写两个公开座位，**绝不**读双方锁定的牌，也不写「谁已经锁了」——
  // 锁定进度本身属于 DuelState 的私密面（用例「对峙期」有不可反推的反向钉子）。
  if (state.duel !== null) {
    lines.push(`对峙进行中：座${state.duel.seatA} vs 座${state.duel.seatB}`
      + '（双方各需锁定 1 张暗牌 · 揭晓前互不可见）');
  }
  if (c.pending.length > 0) {
    lines.push(`待认证：${orNone(c.pending)}｜已签印：${orNone(c.signed)}｜已质疑：${orNone(c.challenged)}`);
    // 评审 3：认证 pending 的**票数**。CERTIFY_SIGN 的投票人必须知道候选人差几票过线，
    // 否则「签印 / 质疑 / 弃权」三选一是在没有分母的情况下瞎选。门槛走引擎自己的 §5.2 公式
    // （含印记减半与 extraSignaturesRequired），不在文本层重写那份算术。
    lines.push(`签印进度：${c.pending.map((t) => {
      const have = signatureCount(state, t);
      const need = certificationThreshold(state, t);
      return `座${t} 已有 ${have} / 门槛 ${need}（还差 ${Math.max(0, need - have)}）`;
    }).join('、')}`);
  }
  if (c.appealed.length > 0) {
    lines.push(`复议中：${orNone(c.appealed)}｜复议票：${c.appealed.map((t) => appealTally(state, t)).join('、')}`);
  }
  if (state.council.resolved === false) {
    lines.push(`山议进行中，已投票座位：${orNone(Object.keys(state.council.votes))}`);
  }
  return lines.join('\n');
}

/**
 * 一句话动作语义（≤40 字符）。
 *
 * ⚠️ **第三参数 seat 必填**（评审 6 的裁定；此前是可选 + 「调用方自觉」）：
 *   牌面文本取自 `action.actor` 的手牌，把**别人**的动作传进来就等于经由「合法动作」这条
 *   文本路径交出他人私牌（红线 3），而且事后从题面上看不出它是越权来的。
 *   现在 TS 侧漏传直接编译不过，JS 侧漏传同样落进下面这条越权分支 —— 两条通道都不留口子；
 *   sidecar 的唯一入口 `buildChoice` 传的就是决策座位（枚举出的动作 actor 恒等于 seat）。
 *
 * @param {object} state 引擎状态（只读）
 * @param {object} action 动作（`Action` 判别式联合的成员）
 * @param {number} seat 决策座位；与 `action.actor` 不符即抛错（漏传也走这条分支）
 * @returns {string} 一句话语义（绝不返回 undefined：未覆盖的动作类型一律抛错）
 */
export function describeAction(state, action, seat) {
  if (action.actor !== seat) {
    throw new Error(`describeAction：动作归属越权——决策座位是 ${String(seat)}，`
      + `而 ${String(action.type)} 的 actor 是 ${String(action.actor)}（越权描述等于泄露他人手牌；`
      + '第三参数 seat 必填）');
  }
  const actorPlayer = state.players[action.actor];
  if (actorPlayer === undefined) {
    throw new Error(`describeAction：动作归属座位 ${String(action.actor)} 不存在`);
  }
  /** 取**动作归属座位自己**手里的牌；手牌里没有 ⇒ 抛错，绝不拼出 'undefined'。 */
  const cardOf = (cardId) => {
    const card = actorPlayer.hand.find((x) => x.id === cardId);
    if (card === undefined) {
      throw new Error(`describeAction：座${String(action.actor)} 的手牌里没有 ${String(cardId)}`);
    }
    return card;
  };
  const target = action.target === undefined ? '' : `→座${String(action.target)}`;
  switch (action.type) {
    case 'MOVE': return cut('行棋：掷骰前进');
    case 'ROLL_WHEEL': return cut('问天：掷指令骰');
    case 'PASS': return cut('结束手番');
    // ⚠️ **B53 更正**：本分支此前写的是「过隘：以试炼牌闯关（入口待 B14）」⇒ **语义是反的**。
    //   B19 已定案（规格 §3.5）：`COMPARE { actor, cardId, target }` = **出牌比对** ——
    //   **我出自己手牌里的一张** vs **目标玩家的手牌顶**（明牌），比颜色 → 比点数。
    //   ⇒ `cardId` 就是**我手牌里的一张**（与 PLAY_CARD 同款，可查手牌）；
    //   而「以试炼牌闯关」是**试炼通道**（`GATE_RESOLVE{trial}`）的语义，两者**不是同一条路**。
    //   ⚠️ B53 之前 `legal.ts` 根本不枚举 COMPARE ⇒ 本分支**不可达** ⇒ 错误语义一直藏着；
    //   删掉探针里的 B18 占位分支后它**变得可达** ⇒ 必须同时更正语义。
    case 'COMPARE': {
      const card = cardOf(action.cardId);
      return cut(`出牌比对：出「${card.name}」${target}`);
    }
    case 'PLAY_CARD': {
      const card = cardOf(action.cardId);
      return cut(`出「${card.name}」${target}（费${card.cost}）`);
    }
    case 'ABILITY': return cut(`发动被动 ${String(action.abilityId)}${target}`);
    case 'VOTE': return cut(`山议投座${String(action.target)}`);
    case 'CERTIFY_SIGN': return cut(`给座${String(action.target)}签印`);
    case 'CERTIFY_CHALLENGE': return cut(`质疑座${String(action.target)}`);
    case 'CERTIFY_ABSTAIN': return cut(`对座${String(action.target)}弃权`);
    case 'CERTIFY_APPEAL': return cut('自己申请复议（-2 资源）');
    // ⚠️ 复议票必须把**对象座位**写进语义：`certification.appealed` 是列表，同场可能有两条复议
    //   ⇒ 只写「推翻/维持」会让两条不同 key 的候选得到同一句话，模型无从区分。
    case 'CERTIFY_APPEAL_VOTE': return cut(`复议票：座${String(action.target)}${action.overturn ? '推翻' : '维持'}`);
    case 'CERTIFY_ANSWER': return cut(`判定座${String(action.target)}${action.passed ? '通过' : '不通过'}`);
    default: throw new Error(`describeAction：未知动作类型 ${String(action.type)}`);
  }
}

/**
 * 官方 `/v1/systemone` 的 choice 题面（设计 §4.5）。
 *
 * ⚠️ criteria 的 key 是 `actionKey`（模型只输出 key，不产出自由文本），值是一句话语义；
 *   两个不同候选编出同一个 key 时**抛错**而不是覆盖 —— 覆盖等于题面静默少一个选项，
 *   P1/P3 的候选计数会随之失真，而这类失真在本仓库已经被登记过两次。
 *
 * ⚠️ `noLegalActions`（评审 4a）：候选为空**不等于**「模型拒答」。引擎口径下至少有两条正常路径
 *   会交出空候选——待认证锁定（§5.1）与对峙未决（B13，即 G-f：对峙锁牌走 submitDuelCard，
 *   **没有对应的 Action 成员**，因而枚举不出来）。⇒ Task 15 的 P1/P2 读数必须按这个标记分桶，
 *   G-f 本身交 Task 9 登记；文本层不得为了「让题面看起来有候选」而绕开 legal.ts 的口径。
 *
 * @param {object} state 引擎状态（只读）
 * @param {number} seat 决策座位
 */
export function buildChoice(state, seat) {
  const criteria = {};
  for (const a of getLegalActions(state, seat)) {
    const key = actionKey(a);
    if (Object.hasOwn(criteria, key)) {
      throw new Error(`buildChoice：座${String(seat)} 的候选 key「${key}」撞车 ——`
        + '两条不同动作编出同一个 key，题面会静默少一个选项。'
        + '要修的是 id 唯一性（主题副本 id 带 #dupN 后缀即为此），不得在这里给 key 加后缀：'
        + 'key 必须能原样反解回动作。');
    }
    criteria[key] = describeAction(state, a, seat);
  }
  return {
    instructions: '现在轮到该玩家行动，应选哪个动作？',
    criteria,
    noLegalActions: Object.keys(criteria).length === 0,
  };
}
