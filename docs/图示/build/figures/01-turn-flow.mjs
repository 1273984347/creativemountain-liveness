// 01 回合流程 —— 时序图（角色化）。
//
// 讲的是一次「回合」在引擎里怎么跑：玩家出牌 → 引擎结算 → 骰子与 20 面指令表 →
// 对峙分支（橘红）→ 回合解锁。四条生命线：玩家 / UI / 引擎 / 指令表·骰子。
//
// 事实来源：engine/core/turn-runner.ts（performAction 三选一行棋 / 问天 / 行事；
//          finishTurn = 地形结算 → 裁牌 → 收入；advanceTurn 见 duel!==null 直接返回
//          = 回合阻塞；山议（7）与认证（8）只在 round 末触发）、
//          engine/core/duel.ts（startDuel 待决对峙、submitDuelCard 锁定亮牌、
//          settleDuel 同时揭晓、红 > 黑 → 同色比点数 → 平局各弃 1 张、
//          败者推后 1 格并抽 1 张、胜者不获额外收益）、
//          engine/core/dice.ts（rollD6 六面移动骰 / rollD20 二十面指令骰）、
//          engine/core/instruction-table.ts（20 面指令表，INSTRUCTION_TABLE 唯一出处）、
//          web/main.ts（对峙未结算时只显示对峙面板；点手牌调用 submitDuelCard，
//          duel 归零后 advanceTurn 继续推进）、
//          web/legal-gate.ts（DUEL_SUBMIT_CARD 只发给对峙参与者且只发自己手牌）、
//          tests/e2e/duel-e2e.mjs（门⑩：触发对峙 → 回合锁定 → 选牌 → 揭晓 → 解锁）、
//          README.md「对峙已落地（B13）」段。
//
// ⚠️ 母版坐标：内容区 x 40..920、y 40..480；所有 x/y/w/h 必须是 4 的倍数。
// ⚠️ 对峙分支用 kind:'accent'（橘红）强调 ⇒ 全图橘红元素 = 2 条消息，正好用满上限。

import { lifeline, activation, message, nodeBox, callout } from '../svg-kit.mjs';

const P_X = 140;   // 玩家
const UI_X = 360;  // UI
const ENG_X = 580; // 引擎
const TAB_X = 800; // 指令表·骰子
const HEAD_TOP = 40;

export default {
  slug: 'turn-flow',
  index: '01',
  name: '回合流程',
  total: 8,
  typeLabel: '时序图',
  eyebrow: '机制 · 回合编排与对峙',
  title: '回合流程',
  subtitle:
    '一次回合在引擎里怎么跑：玩家出牌 → 引擎结算 → 骰子与 20 面指令表 → 对峙分支（橘红）→ 回合解锁。',
  desc:
    '时序图：玩家在界面上选行棋 / 问天 / 出牌，界面把动作交给引擎 performAction；引擎掷 6 面移动骰或 20 面指令骰，并向 20 面指令表取该面的指令文案，结算地形、裁牌与收入后推进手番；若落点与其他存活玩家同格则进入对峙，回合阻塞，界面提交锁定亮牌后才同时揭晓，败者后退 1 格并抽 1 张，揭晓后回合解锁。',
  legend: [
    { kind: 'input', label: '玩家输入' },
    { kind: 'step', label: '引擎调用' },
    { kind: 'store', label: '骰子与指令表' },
    { kind: 'external', label: '界面呈现' },
  ],
  render(ctx) {
    const parts = [];

    // ── 生命线（顶部执行者盒 + 竖虚线）──────────────────────────
    // 玩家与指令表只在各自那条消息处有交互 ⇒ 生命线到 272 收束；
    // UI 与引擎贯穿到 400，与下方两块规则盒底边对齐。
    parts.push(
      lifeline(ctx, {
        x: P_X, top: HEAD_TOP, bottom: 272, w: 160,
        actor: '玩家', sub: '人类操作者',
      }),
      lifeline(ctx, {
        x: UI_X, top: HEAD_TOP, bottom: 400, w: 160,
        actor: 'UI', sub: 'web/ui · legal-gate.ts',
      }),
      lifeline(ctx, {
        x: ENG_X, top: HEAD_TOP, bottom: 400, w: 160,
        actor: '引擎', sub: 'engine/core',
      }),
      lifeline(ctx, {
        x: TAB_X, top: HEAD_TOP, bottom: 272, w: 160,
        actor: '指令表 · 骰子', sub: 'instruction-table.ts',
      }),
    );

    // ── 激活条：谁在什么时候握着控制权 ─────────────────────────
    parts.push(
      activation(ctx, { x: UI_X, top: 104, height: 264 }),   // 界面全程在场
      activation(ctx, { x: ENG_X, top: 140, height: 132 }),   // 引擎执行阶段
      activation(ctx, { x: ENG_X, top: 300, height: 100 }),   // 引擎接手对峙
    );

    // ── 消息（时间自上而下）────────────────────────────────────
    // 1) 玩家在界面上选行动
    parts.push(
      message(ctx, { x1: P_X, x2: UI_X, y: 116, label: '行棋 / 问天 / 出牌' }),
    );
    // 2) 界面把声明式动作交给引擎
    parts.push(
      message(ctx, { x1: UI_X, x2: ENG_X, y: 152, label: 'performAction' }),
    );
    // 3) 引擎掷骰（6 面移动骰 / 20 面指令骰）
    parts.push(
      message(ctx, { x1: ENG_X, x2: TAB_X, y: 188, label: 'rollD6·rollD20' }),
    );
    // 4) 指令表回该面的文案（20 面表的唯一出处）
    parts.push(
      message(ctx, { x1: TAB_X, x2: ENG_X, y: 224, label: '第 N 面指令' }),
    );
    // 5) 结算地形 / 裁牌 / 收入，推进手番
    parts.push(
      message(ctx, { x1: ENG_X, x2: UI_X, y: 260, label: '结算 · 回合推进' }),
    );
    // 6) 对峙分支：同格相遇 ⇒ 待决对峙，回合阻塞（橘红）
    parts.push(
      message(ctx, {
        x1: ENG_X, x2: UI_X, y: 328, kind: 'accent', label: '待决对峙 startDuel',
      }),
    );
    // 7) 界面把玩家锁定的那张亮牌交给引擎
    parts.push(
      message(ctx, { x1: UI_X, x2: ENG_X, y: 364, label: 'submitDuelCard' }),
    );
    // 8) 双方都锁定 ⇒ 同时揭晓，回合解锁（橘红）
    parts.push(
      message(ctx, {
        x1: ENG_X, x2: UI_X, y: 392, kind: 'accent', label: '同时揭晓 · 回合解锁',
      }),
    );

    // ── 规则盒（左右各一，填住下半区；均为非焦点样式）──────────
    parts.push(
      nodeBox(ctx, {
        x: 40, y: 300, w: 300, h: 100, kind: 'step',
        label: '回合阻塞与解锁',
        sub: 'engine/core/turn-runner.ts · duel!==null 时直接返回（回合阻塞）；揭晓后 duel=null，继续推进下一手番。',
      }),
    );
    parts.push(
      nodeBox(ctx, {
        x: 600, y: 300, w: 320, h: 100, kind: 'store',
        label: '对峙结算（规格 §3.3）',
        sub: 'engine/core/duel.ts · settleDuel：红>黑；同色比点数；平局各弃 1 张；败者后退 1 格并抽 1 张，胜者不获额外收益。',
      }),
    );

    // ── 编辑批注（≤2 处）─────────────────────────────────────
    parts.push(
      callout(ctx, {
        x: 40,
        y: 428,
        maxWidth: 880,
        text:
          '一个手番 = 一名玩家的行动与结算；山议（7）与认证（8）只在 round 末触发，不在单个手番内（engine/core/turn-runner.ts）。',
      }),
    );

    return parts.join('\n');
  },
};
