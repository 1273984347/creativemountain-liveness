// engine/core/action-key.ts
// 动作 ↔ 稳定 key（唯一、可逆、不含自由文本）。
//
// ⚠️ 为什么落在 engine 而不是 tools：`web/legal-gate.ts` 要用它做漂移守卫，
//   而 tools/ 不得被发布包引用（红线 2）——esbuild 会把它打进单文件 HTML。
// ⚠️ 为什么 actor 不入 key：actor 由请求上下文（哪个座位在决策）决定，
//   入 key 会让同一个选择在别的位置得到不同 key，模型学到的偏好无法迁移。

import type { Action } from './action.ts';

export function actionKey(a: Action): string {
  switch (a.type) {
    case 'MOVE': return 'move';
    case 'ROLL_WHEEL': return 'ask';
    case 'PASS': return 'pass';
    case 'PLAY_CARD': return a.target === undefined ? `play:${a.cardId}` : `play:${a.cardId}->${a.target}`;
    case 'ABILITY': return a.target === undefined ? `ability:${a.abilityId}` : `ability:${a.abilityId}->${a.target}`;
    case 'VOTE': return `vote:${a.target}`;
    case 'COMPARE': return `gate:${a.cardId}->${a.target}`;
    // ⚠️ B18：关隘通道选择 —— 三段（`gate:resolve:<channel>`），与 COMPARE 的两段不冲突。
    case 'GATE_RESOLVE': return `gate:resolve:${a.channel}`;
    // ⚠️ B18-b：裂隙通道 —— 三段（`barrier:resolve:<channel>`）。
    case 'BARRIER_RESOLVE': return `barrier:resolve:${a.channel}`;
    case 'CERTIFY_SIGN': return `cert:sign:${a.target}`;
    case 'CERTIFY_CHALLENGE': return `cert:challenge:${a.target}`;
    case 'CERTIFY_ABSTAIN': return `cert:abstain:${a.target}`;
    case 'CERTIFY_APPEAL': return `cert:appeal:${a.target}`;
    case 'CERTIFY_APPEAL_VOTE': return `cert:appealvote:${a.target}:${a.overturn ? 'overturn' : 'uphold'}`;
    case 'CERTIFY_ANSWER': return `cert:answer:${a.target}:${a.passed ? 'pass' : 'fail'}`;
  }
}

/**
 * 反解（`actor` 留 `-1`，由 `withActor` 补齐）。
 *
 * ⚠️ **只认规范形**：缺段、空段、非整数座位、多余尾段一律抛错，绝不猜。
 *   key 的下游消费方（`web/legal-gate.ts` 漂移守卫、`tools/laya-probe/**` 探针）拿到的
 *   是**模型输出**的字符串；宽松反解会把 `vote:` 编造成「投座位 0」、把 `play:->3` 编造成
 *   「打出 id 为空的牌」，这类动作再进引擎就绕过了「需目标而未选目标 ⇒ 不出牌」的守卫
 *   （见 `performAction` 的 `act` 分支），属于正确性问题而非风格问题。
 */
export function actionFromKey(key: string): Action {
  const action = decodeKey(key);
  // 单射校验：反解结果再编码必须与输入逐字符相等。
  // 这一条把「多余尾段」（`move:junk`、`cert:appealvote:0:overturn:junk`）与
  // 一切非规范写法（`vote:0x2`、`vote:1e2`）一并拒掉；
  // 但 `play:->3` 这类「空 id」反解后再编码仍等于输入，故仍需下面的逐段空串校验。
  const canonical = actionKey(action);
  if (canonical !== key) { throw new Error(`key 非规范形：${key}`); }
  return action;
}

function decodeKey(key: string): Action {
  const parts = key.split(':');
  const head = String(parts[0]);
  /** 必需的自由文本段（卡牌/能力 id）：缺失或空串都抛错——绝不把 undefined 拼成 'undefined' 蒙混过关。 */
  const need = (v: string | undefined): string => {
    if (v === undefined || v === '') { throw new Error(`key 缺字段段：${key}`); }
    return v;
  };
  const num = (v: string | undefined): number => {
    // `Number('')` / `Number(' ')` 都是 0：空段必须先看出来，否则截断的 key 会编造出座位 0。
    if (v === undefined || v.trim() === '') { throw new Error(`key 缺座位信息：${key}`); }
    const n = Number(v);
    if (!Number.isInteger(n)) { throw new Error(`key 座位段非整数：${key}`); }
    return n;
  };
  /** `x-><seat>` 形式的两段：id 段与目标段都必需且非空。 */
  const idTarget = (v: string | undefined): readonly [string, string | undefined] => {
    const seg = need(v).split('->');
    const id = seg[0];
    const target = seg[1];
    if (id === undefined || id === '') { throw new Error(`key 缺字段段：${key}`); }
    return [id, target] as const;
  };
  /** 二元标志段：只接受 actionKey 写出的那两个字面量，缺段或拼错一律抛错，不做默认值猜测。 */
  const flag = (v: string | undefined, yes: string, no: string): boolean => {
    if (v === yes) { return true; }
    if (v === no) { return false; }
    throw new Error(`key 标志位非法：${key}`);
  };
  switch (head) {
    case 'move': return { type: 'MOVE', actor: -1, steps: 0 };
    case 'ask': return { type: 'ROLL_WHEEL', actor: -1 };
    case 'pass': return { type: 'PASS', actor: -1 };
    case 'vote': return { type: 'VOTE', actor: -1, target: num(parts[1]) };
    case 'play': {
      const [id, t] = idTarget(parts[1]);
      return t === undefined
        ? { type: 'PLAY_CARD', actor: -1, cardId: id }
        : { type: 'PLAY_CARD', actor: -1, cardId: id, target: num(t) };
    }
    case 'ability': {
      const [id, t] = idTarget(parts[1]);
      return t === undefined
        ? { type: 'ABILITY', actor: -1, abilityId: id }
        : { type: 'ABILITY', actor: -1, abilityId: id, target: num(t) };
    }
    case 'gate': {
      // ⚠️ B18：`gate:resolve:<channel>`（三段）= 关隘通道选择；`gate:<id>-><seat>`（两段）= COMPARE。
      if (parts[1] === 'resolve') {
        const ch = need(parts[2]);
        if (ch !== 'pay' && ch !== 'trial') { throw new Error(`key 关隘通道非法：${key}`); }
        return { type: 'GATE_RESOLVE', actor: -1, channel: ch };
      }
      const [id, t] = idTarget(parts[1]);
      if (t === undefined) { throw new Error(`key 缺目标：${key}`); }
      return { type: 'COMPARE', actor: -1, cardId: id, target: num(t) };
    }
    case 'barrier': {
      // ⚠️ B18-b：`barrier:resolve:<channel>`（三段）= 裂隙通道（放印 / 不放）。
      const ch = need(parts[2]);
      if (ch !== 'place' && ch !== 'skip') { throw new Error(`key 裂隙通道非法：${key}`); }
      return { type: 'BARRIER_RESOLVE', actor: -1, channel: ch };
    }
    case 'cert': {
      const kind = need(parts[1]);
      // ⚠️ 编码形如 `cert:<kind>:<target>` 或 `cert:<kind>:<target>:<flag>`（设计 §5 文法）；
      //   parts 已按 ':' 切好，标志位在 parts[3]——不得再对 parts[2] 二次 split，
      //   那样 tail 恒为 [target]，会把 overturn/passed 的正向取值静默降为 false。
      const target = num(parts[2]);
      switch (kind) {
        case 'sign': return { type: 'CERTIFY_SIGN', actor: -1, target };
        case 'challenge': return { type: 'CERTIFY_CHALLENGE', actor: -1, target };
        case 'abstain': return { type: 'CERTIFY_ABSTAIN', actor: -1, target };
        case 'appeal': return { type: 'CERTIFY_APPEAL', actor: -1, target };
        case 'appealvote': return { type: 'CERTIFY_APPEAL_VOTE', actor: -1, target, overturn: flag(parts[3], 'overturn', 'uphold') };
        case 'answer': return { type: 'CERTIFY_ANSWER', actor: -1, target, passed: flag(parts[3], 'pass', 'fail') };
        default: throw new Error(`未知认证动作：${key}`);
      }
    }
    default: throw new Error(`未知动作 key：${key}`);
  }
}

export function withActor(action: Action, seat: number): Action {
  return { ...action, actor: seat } as Action;
}
