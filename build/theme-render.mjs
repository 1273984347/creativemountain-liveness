// 卡面文本渲染器：从 effects 结构**派生**可读文本（规格 §6.5 / B8）。
//
// 为什么派生而不是手写：
//   主题包每套 48 张卡 × 3 套新主题 = 144 条卡面文案。手写必然与 effects 漂移
//   （改了 op 参数却忘了改文案 ⇒ 规则书印的说明与实际效果不符 ⇒ 玩家被误导）。
//   派生保证「文本 == 效果」恒成立；主题感由 **terms 术语层**提供。
//
// 与 IR 的关系：这里产出的是 **theme.json 的 card.text 字段**（落盘即为数据），
//   ir.json 只负责**搬运**它 —— 不在渲染期现编，parity-check 的文本可追溯性不被破坏。

/** 负面状态中文名。 */
const STATUS_CN = {
  poison: '中毒',
  slow: '减速',
  silence: '封口',
  skip_turn: '跳过回合',
};

/** 卡类型中文名。 */
const TYPE_CN = {
  motion: '位移',
  attack: '攻击',
  defense: '防御',
  utility: '功能',
};

/** 比较运算符中文符号。 */
const CMP_CN = {
  lte: '≤',
  gte: '≥',
  eq: '=',
  neq: '≠',
};

/**
 * 主题术语层：一套主题对通用词表的替换。
 *
 * @typedef {Object} Terms
 * @property {string} hp        HP 的主题词（如「灵力」「机体完整度」）
 * @property {string} deck      单张牌的主题词（如「符箓」「指令」）
 * @property {string} resource  资源的主题词（如「灵枢」「算力」）
 * @property {string} gate      关隘的主题词（如「关隘」「安全闸」）
 */

/** 去掉末尾句号（供子句拼接）。 */
function stripPeriod(s) {
  return s.replace(/。$/, '');
}

/** 渲染谓词为中文子句。 */
export function renderPredicate(pred, terms) {
  switch (pred.kind) {
    case 'tile_kind':
      return `位于${pred.kind === 'peak' ? '峰顶' : pred.kind === 'gate' ? terms.gate : '该'}地形格`;
    case 'has_card': {
      const f = pred.filter ?? {};
      const parts = [];
      if (f.color !== undefined) parts.push(f.color === 'red' ? '红色' : '黑色');
      if (f.type !== undefined) parts.push(TYPE_CN[f.type]);
      const desc = parts.length > 0 ? parts.join('') : '任意';
      return `手中有${desc}${terms.deck}`;
    }
    case 'resource_at_least':
      return `${terms.resource} ${CMP_CN.gte} ${pred.amount}`;
    case 'hand_count':
      return `在手${terms.deck}数 ${CMP_CN[pred.op]} ${pred.count}`;
    case 'is_pending_cert':
      return '处于待认证状态';
    case 'phase_is':
      return `本回合为${pred.value === 'night' ? '夜' : '昼'}`;
    case 'players_alive':
      return `存活人数 ${CMP_CN[pred.op]} ${pred.count}`;
    case 'card_type_is':
      return `在手${terms.deck}中有${TYPE_CN[pred.type]}牌`;
    case 'identity_is':
      return `身份为 ${pred.identityId}`;
    case 'faction_is':
      return `阵营为 ${pred.factionId}`;
    case 'hp_at_least':
      return `其${terms.hp} ${CMP_CN.gte} ${pred.amount}`;
    case 'flag_set':
      return '相关标记已置';
    case 'last_dice_even':
      return '上次骰点为偶数';
    case 'dice_is_at_least':
      return `骰点 ${CMP_CN.gte} ${pred.amount}`;
    case 'card_color_is':
      return '牌色符合条件';
    default:
      return '条件成立';
  }
}

/** 渲染单个效果为中文子句（不含句末句号，由上层决定）。 */
export function renderEffect(effect, terms) {
  const n = effect.amount ?? effect.count ?? '';
  switch (effect.op) {
    // ---- 位移 ----
    case 'move_forward':
      return `前进 ${n} 格`;
    case 'move_backward':
      return `使一名对手后退 ${n} 格`;
    case 'move_to_tile':
      return `移动到前方第 ${effect.tileIndex} 格`;
    case 'move_relative_to':
      return `相对一名对手移动 ${n} 格`;
    case 'swap_position':
      return '与一名对手交换位置';
    case 'teleport':
      return `移动到第 ${effect.tileIndex} 格`;
    case 'move_by_dice':
      return `掷 ${effect.faces} 面骰，按点数前进`;
    // ---- 战斗 ----
    case 'damage':
      return `对一名对手造成 ${n} 点伤害`;
    case 'heal':
      return `恢复 ${n} 点${terms.hp}`;
    case 'shield':
      return `获得 ${n} 点护盾`;
    case 'poison':
      return `使一名对手中毒 ${n} 层`;
    case 'slow':
      return `使一名对手减速 ${n} 层`;
    case 'silence':
      return `使一名对手封口 ${n} 回合`;
    case 'skip_turn':
      return `使一名对手跳过 ${n} 个回合`;
    case 'immunity':
      return `免疫${STATUS_CN[effect.status]} ${effect.amount} 回合`;
    case 'compare_cards':
      return `与一名对手比牌`;
    case 'disarm':
      return '解除一名对手的装备';
    // ---- 牌 ----
    case 'draw_cards':
      return `抽 ${n} 张${terms.deck}`;
    case 'gain_card':
      return `获得 ${n ?? 1} 张${terms.deck}`;
    case 'discard_self':
      return `弃 ${n} 张${terms.deck}`;
    case 'discard_opponent':
      return `使一名对手弃 ${n} 张${terms.deck}`;
    case 'exhaust_card':
      return '消耗一张牌';
    case 'peek_deck':
      return `查看${terms.deck}库顶 ${n} 张`;
    case 'add_to_deck':
      return '将牌置入牌库';
    case 'remove_from_deck':
      return '从牌库移除一张牌';
    case 'swap_deck_top':
      return `交换牌库顶 ${n} 张牌`;
    case 'random_from_deck':
      return `随机获得 ${n} 张${terms.deck}`;
    // ---- 资源 ----
    case 'gain_resource':
      return `获得 ${n} 枚${terms.resource}`;
    case 'spend_resource':
      return `失去 ${n} 枚${terms.resource}`;
    case 'transfer_resource':
      return `给予一名对手 ${n} 枚${terms.resource}`;
    case 'set_resource':
      return `将${terms.resource}设为 ${n}`;
    // ---- 骰子 ----
    case 'extra_roll':
      return `本回合额外获得 ${n} 次掷骰机会`;
    case 'reroll':
      return `重掷 ${n} 次骰子`;
    case 'keep_die':
      return `保留 ${n} 颗骰子`;
    case 'set_die_result':
      return `将下次掷骰点数设为 ${effect.value}`;
    case 'roll_opponent':
      return '令一名对手掷骰';
    // ---- 状态 ----
    case 'double_next_vote':
      return '下一次投票权重翻倍';
    case 'extra_signatures_required':
      return `需要额外 ${n} 枚签印`;
    case 'set_phase':
      return `本回合进入${effect.value === 'night' ? '夜' : '昼'}`;
    case 'set_flag':
      return '置入标记';
    case 'clear_flag':
      return '清除标记';
    // ---- 投票 ----
    case 'vote_modifier':
      return `投票权重 ${n > 0 ? '+' : ''}${n}`;
    case 'extra_vote':
      return `额外投 ${n} 票`;
    case 'cancel_vote':
      return '取消一名对手的投票';
    case 'exempt_from_vote':
      return '一名对手免于本轮投票';
    // ---- 认证 ----
    case 'certify_extra_signer':
      return `认证时需要额外 ${n} 名签印人`;
    case 'certify_free_pass':
      return '本次认证免于被质疑';
    case 'certify_extra_round':
      return `认证时多进行 ${n} 轮`;
    case 'certify_forbid_challenge':
      return '本次认证不可被质疑';
    // ---- 阵营 ----
    case 'spirit_wheel':
      return '发动一次阵营轮';
    // ---- 组合 ----
    case 'sequence':
      return effect.effects.map((e) => stripPeriod(renderEffect(e, terms))).join('，');
    case 'conditional': {
      const then = stripPeriod(renderEffect(effect.then, terms));
      if (effect.else === undefined) {
        return `若${renderPredicate(effect.pred, terms)}，则${then}`;
      }
      const els = stripPeriod(renderEffect(effect.else, terms));
      return `若${renderPredicate(effect.pred, terms)}，则${then}；否则${els}`;
    }
    case 'count':
      return `重复 ${effect.count} 次：${stripPeriod(renderEffect(effect.effect, terms))}`;
    // ---- 棋盘 / 判定与装备 ----
    case 'place_barrier':
      return `在第 ${effect.tileIndex} 格放置封路印`;
    case 'modify_judgement':
      return '修改一次判定结果';
    case 'create_card':
      return '造出一件造物';
    case 'equip_card':
      return '装备一件造物';
    default:
      return '（未知效果）';
  }
}

/** 渲染一组效果为一段卡面文本（末尾带句号）。 */
export function renderCardText(effects, terms) {
  if (!Array.isArray(effects) || effects.length === 0) {
    return '无效果。';
  }
  const body = effects.map((e) => stripPeriod(renderEffect(e, terms))).join('，');
  return body + '。';
}
