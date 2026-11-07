// 脚本化教学演示（规格 §6.6 / §13.2 裁定 2）。
//
// 2 个虚拟玩家按预设脚本跑完一局 **5 回合迷你流程**，
// 覆盖「天机 → 行动 → 关隘 → 裁牌 → 一次简化认证」。
//
// 目的不是陪练，而是让新玩家在 3 分钟内看懂一局长什么样。
// **走的是真实引擎**（与真实对局同一套规则），因此不引入任何新规则。

import type { State } from '../engine/core/state.ts';
import { createInitialState } from '../engine/core/state.ts';
import { performAction, advanceTurn } from '../engine/core/turn-runner.ts';
import { currentPlayer } from '../engine/core/round.ts';
import { enterPendingCertification, certifySign } from '../engine/core/certification.ts';

/** 教学演示的一步说明。 */
export interface TutorialStep {
  /** 标题 */
  readonly title: string;
  /** 说明 */
  readonly detail: string;
  /** 该步结束后的状态 */
  readonly state: State;
}

/**
 * 运行教学演示。
 *
 * 固定 seed，保证每次演示完全一致。
 */
export function runTutorial(playerCount = 3): TutorialStep[] {
  const steps: TutorialStep[] = [];
  let state = createInitialState({ players: playerCount as 3 | 4 | 5 | 6 | 7 | 8, seed: 20261107, deckSize: 40 });
  steps.push({
    title: '开局',
    detail: '每名玩家发 ' + state.scales.handStart + ' 张符箓；山道共 ' + state.board.length + ' 格，峰顶在第 ' + state.board.peakIndex + ' 格。规则书上的「登顶即胜」在这里被改写了——登顶只是拿到入场券。',
    state,
  });
  // 天机：翻开一张天机牌
  const heaven = state.decks.heaven[0];
  if (heaven !== undefined) {
    state = { ...state, phaseValue: 'night', log: [...state.log, { round: state.round, turnIndex: state.turnIndex, actor: -1, kind: 'heaven', message: '天机牌翻开：' + heaven.name + '——' + heaven.text }] };
  }
  steps.push({
    title: '天机',
    detail: '每回合开始翻开一张「天机牌」，对全场生效。' + (heaven?.text ?? ''),
    state,
  });
  // 行动 5 回合
  for (let i = 0; i < 5; i++) {
    const seat = currentPlayer(state);
    if (seat < 0) { break; }
    const before = state.players[seat]?.position ?? 0;
    state = performAction(state, seat, 'move');
    const after = state.players[seat]?.position ?? before;
    state = advanceTurn(state, 'newbie');
    steps.push({
      title: '行动 ' + (i + 1) + ' / 5',
      detail: '座' + seat + ' 掷移动骰前进（必须走满，不能少走）：位置 ' + before + ' → ' + after + '。回合末结算裁牌与灵枢收入。',
      state,
    });
  }
  // 简化认证：把当前玩家送到峰顶并让其他玩家签印
  const peak = state.board.peakIndex;
  const certifier = state.players.find((p) => p.alive && p.seat !== 0);
  if (certifier !== undefined) {
    const moved = { ...state, players: state.players.map((p) => (p.seat === 0 ? { ...p, position: peak } : p)) };
    const entered = enterPendingCertification(moved, 0);
    if (entered.ok) {
      const signed = certifySign(entered.state, certifier.seat, 0);
      state = signed.ok ? signed.state : entered.state;
      steps.push({
        title: '活人认证',
        detail: '座0 抵达峰顶 → 进入「待认证」，但这不算赢。需集齐 ' + certificationNeed(state) + ' 枚签印才算「坐上活人席」。座' + certifier.seat + ' 已签印。真实对局里其他玩家还可以选择「质疑」——出 3 道当场可验证的题，答对 2 问才算通过。',
        state,
      });
    }
  }
  return steps;
}

/** 当前认证门槛（用于教学文案）。 */
function certificationNeed(state: State): number {
  const pending = state.certification.pending[0];
  if (pending === undefined) { return 0; }
  const alive = state.players.filter((p) => p.alive).length;
  return Math.max(1, Math.min(state.scales.threshold, alive - 1));
}
