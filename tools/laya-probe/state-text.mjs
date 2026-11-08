// tools/laya-probe/state-text.mjs
// 可见性受限的 state 文本化（规格 §7 + 预研红线 3 / 设计 §4.5）。
//
// ⚠️ 只允许访问**公开集**：棋盘/地形、各家资源·HP·位次·身份·阵营·印记·持牌数·装备计数·活人席、
//   认证池与票数、山议已投票、**自己**的手牌、已公开亮牌。
//   禁止集（他人手牌 id、牌堆顺序、对峙双方的锁定牌）在本文件内**不得出现字段访问**。
//
// ⚠️ 为什么白名单必须是**结构性**的，而不是「先序列化再过滤」（Task 8 硬要求）：
//   · 事后 scrub 意味着私密信息已经在内存里被读出来过 —— 红线 3 要防的正是这一步，
//     「模型最终没看到」与「程序根本没读」不是同一件事（前者只在最后一次输出上成立）；
//   · 过滤器漏一个字段就前功尽弃，而「不写访问」不可遗漏：没写就是没读；
//   · 反过来，任何事后过滤器都必须**点名**它要过滤的字段 ⇒ 常驻结构守卫
//     （`tests/engine/legal-probe.test.ts` 的「结构层」用例，扫**去注释后的源码**）
//     把「直接输出」与「先读再洗」两种写法一并拦住 —— 它认的是字段名，不是数据流方向。
//
// ⚠️ 日志摘要（设计 §4.5 也把它列进公开集）这里**不消费**：日志文案是各分支自撰的自由文本
//   （对峙结算就会把牌名写进 message），「这一句有没有夹带私牌」在文本层无法静态核对，
//   要开得先给日志本身立白名单 —— 留给 Task 15 之前单独裁定。
//
// ⚠️ 本文件在 tools/ 下：不得被发布包引用（红线 2，esbuild 会把引用链打进单文件 HTML）。
//   直接 import 引擎模块是 tools/*.mjs 的既有做法（doc-sync-lib / ir-validate 同法）。

import { getLegalActions } from '../../engine/core/legal.ts';
import { actionKey } from '../../engine/core/action-key.ts';

/** 一句话动作语义的长度预算（`rl_agent_config.head_max_len=256` ⇒ 每候选一句、≤40 字符）。 */
const ONE_LINE_MAX = 40;

/** 超出预算时截断（题面靠 key 精确区分，语义只需要「一眼认出这是什么动作」）。 */
function cut(text) {
  return text.length > ONE_LINE_MAX ? text.slice(0, ONE_LINE_MAX) : text;
}

/** 座位画像：全部公开字段。⚠️ `hand` 在这里**只取条数**（持牌数对全场公开），不取任何一张牌。 */
function seatLine(state, p) {
  const seats = state.liveSeats[p.seat] ?? 0;
  return `座${p.seat} 身份${p.identityId} 阵营${p.factionId} 位${p.position} 血${p.hp}/${p.hpMax}`
    + ` 资源${p.resource} 持牌${p.hand.length} 装备${p.equipment.length} 席${seats}`
    + (p.hasMark ? ' 持印记' : '') + (p.pendingCert ? ' 待认证' : '') + (p.alive ? '' : ' 已出局');
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
  const lines = [
    `第${state.round}轮 第${state.turnIndex + 1}手 阶段${state.phase}`,
    `你的手牌：${me.hand.map((x) => `${x.name}(费${x.cost},${x.color === 'red' ? '红' : '黑'})`).join('、')}`,
    ...state.players.map((p) => seatLine(state, p)),
  ];
  // 已公开亮牌（§3.3：比较后留在场上公开、不回任何人的手牌，round 末清空）——公开集，可写。
  if (state.publicCards.length > 0) {
    lines.push(`公开亮牌：${state.publicCards
      .map((x) => `座${x.seat}·${x.name}(${x.color === 'red' ? '红' : '黑'}${x.rank})`).join('、')}`);
  }
  if (c.pending.length > 0) {
    lines.push(`待认证：${c.pending.join('、')}｜已签印：${c.signed.join('、')}｜已质疑：${c.challenged.join('、')}`);
  }
  if (state.council.resolved === false) {
    lines.push(`山议进行中，已投票座位：${Object.keys(state.council.votes).join('、')}`);
  }
  return lines.join('\n');
}

/**
 * 一句话动作语义（≤40 字符）。
 *
 * ⚠️ **只能描述 `action.actor` 自己的动作**：牌面文本取自该座位的手牌，
 *   把**别人**的动作传进来就等于经由「合法动作」这条文本路径交出他人私牌（红线 3），
 *   而且事后从题面上看不出它是越权来的。故调用方知道决策座位时**必须**传第三参数 `seat`，
 *   本函数当场核对归属并抛错 —— `buildChoice` 正是这么做到的（枚举出的动作 actor 恒等于 seat）。
 *   不传 `seat` 时只按 actor 自己的视角渲染：这是**文档化行为**而不是漏洞，此时函数无从知道
 *   「谁在看」，越权拦截的责任落在调用方，sidecar 侧唯一入口 `buildChoice` 永远显式传 seat。
 *
 * @param {object} state 引擎状态（只读）
 * @param {object} action 动作（`Action` 判别式联合的成员）
 * @param {number} [seat] 决策座位；给出即校验 `action.actor === seat`
 * @returns {string} 一句话语义（绝不返回 undefined：未覆盖的动作类型一律抛错）
 */
export function describeAction(state, action, seat) {
  if (seat !== undefined && action.actor !== seat) {
    throw new Error(`describeAction：动作归属越权——决策座位是 ${String(seat)}，`
      + `而 ${String(action.type)} 的 actor 是 ${String(action.actor)}（越权描述等于泄露他人手牌）`);
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
    // ⚠️ COMPARE **不查手牌**（与 brief 的写法不同，这里是故意的）：关隘试炼牌由 `drawTrial`
    //   从 `decks.trial` **抽**出来（gate.ts），不是玩家手牌里的一张 ⇒ 拿 `action.cardId` 去手牌里
    //   find 要么抛错、要么在 id 巧合时读出**另一张牌**的名字。
    //   且 `cardId`/`target` 两字段的确切含义要等 B14 接线才定得下来（`legal.ts` 今天根本不枚举它），
    //   所以语义先只说「以试炼牌闯关」，不把未裁定的形状写成断言。
    case 'COMPARE': return cut('过隘：以试炼牌闯关（入口待 B14）');
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
  return { instructions: '现在轮到该玩家行动，应选哪个动作？', criteria };
}
