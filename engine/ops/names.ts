// 算子 / 谓词 / 目标 kind 的**运行时清单**
//
// 类型层由 `EffectMap` / `PredicateMap` / `GoalKind` 保证；
// 本文件提供同源的**运行时数组**，供测试遍历与 doc-sync 门禁交叉核对。

import type { GoalKind, OpName, PredicateName } from '../types/theme.ts';

export const OP_NAME_LIST: readonly OpName[] = [
  'gain_resource', 'spend_resource', 'transfer_resource', 'set_resource',
  'draw_cards', 'gain_card', 'discard_self', 'discard_opponent', 'exhaust_card',
  'peek_deck', 'add_to_deck', 'remove_from_deck', 'swap_deck_top',
  'move_forward', 'move_backward', 'move_to_tile', 'move_relative_to',
  'swap_position', 'teleport', 'move_by_dice',
  'extra_roll', 'reroll', 'keep_die', 'set_die_result', 'roll_opponent',
  'shield', 'poison', 'slow', 'silence', 'skip_turn', 'immunity',
  'double_next_vote', 'extra_signatures_required', 'set_phase', 'set_flag', 'clear_flag',
  'damage', 'heal', 'compare_cards', 'disarm',
  'vote_modifier', 'extra_vote', 'cancel_vote', 'exempt_from_vote',
  'certify_extra_signer', 'certify_free_pass', 'certify_extra_round', 'certify_forbid_challenge',
  'spirit_wheel',
  'sequence', 'conditional', 'count', 'random_from_deck',
  'place_barrier', 'gate_fallback_pay', 'modify_judgement', 'create_card', 'equip_card',
];

export const PREDICATE_NAME_LIST: readonly PredicateName[] = [
  'tile_kind', 'has_card', 'has_card_count', 'resource_at_least', 'hand_count', 'is_pending_cert', 'phase_is',
  'players_alive', 'card_type_is', 'identity_is', 'faction_is', 'hp_at_least', 'flag_set',
  'last_dice_even', 'dice_is_at_least', 'card_color_is',
];

export const GOAL_KIND_LIST: readonly GoalKind[] = [
  'pass_gates', 'equip_count', 'draw_count', 'veto_success',
  'survive_with_hp', 'steal_count', 'reroll_count', 'successful_challenge',
];
