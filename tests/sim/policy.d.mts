// policy.mjs 的类型声明（sim 决策层单一真相源的 TS 侧契约；与 tools/*.d.mts 同法）。
//
// ⚠️ 这里**只描述契约**，实现全在 tests/sim/policy.mjs（纯 JS，无类型）。
//   改签名必须同步改 policy.mjs：门 ① 只核对 TS 侧，门 ⑨ 才核对行为。
// ⚠️ 依赖方向同 policy.mjs：本文件**不得**引用 run.mjs。

import type { State } from '../../engine/core/state.ts';
import type { Action } from '../../engine/core/action.ts';
import type { RuleMode } from '../../engine/scales.ts';
import type { Card, ThemePack } from '../../engine/types/theme.ts';

/**
 * 决策点记录器的一行（B56 口径：**恰 11 个字段**，`seq` 从 0 起 ⇒ `seq` == JSONL 行号）。
 * 由 `tests/gates/sim-record.test.ts` 逐字段锁定。
 */
export interface DecisionRecord {
  readonly seq: number;
  readonly themeId: string;
  readonly players: number;
  readonly seed: number;
  readonly round: number;
  readonly turnIndex: number;
  readonly seat: number;
  readonly phase: string;
  /** 引擎产生的**骰面点数**；无骰面的决策点为 null（动作执行后回填）。 */
  readonly face: number | null;
  /** 启发式选中的动作（`actionKey`；对峙选牌用 `actionKey` 的规范形 `duel:card:<id>`）。 */
  readonly heuristic: string;
  /** `stateToJson(state)` 的**动作执行前**全量局面（⚠️ 含 rng 内部状态 ⇒ 不得直接喂模型）。 */
  readonly state: string;
}

/** 记录器（null = 关闭）。 */
export type Recorder = DecisionRecord[] | null;

/**
 * 注入计数的字段形状（`playOne` 返回值的 `injection`）。
 *
 * · `calls` —— **真的问了策略器**的次数（候选非空才问得出口）；
 * · `fallbacks` —— 其中**回落原启发式**的次数（null / 非字符串 / 非法 key / 不在候选集 / 抛错 / 超时）；
 * · `emptyCandidates` —— 该面**问不到候选**的次数（本来就没有 / certify 面按当前 target
 *   收窄后为空 / 未登记的 face ⇒ 没问出口 ⇒ 既不计 calls 也不计 fallbacks）。
 */
export interface InjectionCounters {
  /** ⚠️ 字段可变：`askPolicy` 就地递增（故**不**声明为 readonly —— 声明成只读就是谎报）。 */
  calls: number;
  fallbacks: number;
  emptyCandidates: number;
}

/**
 * B70 Task 3：**单个决策面**的策略注入（默认关闭 —— `playOne` 不传即完全不走这条路）。
 *
 * ⚠️ 一次只注入**一个面 + 一个座位**（`face` ∧ `seat` 同时命中才问）⇒ 读数可归因，
 *   也避免「三面全交给模型 + 每步一次推理」把一局拉到跑不完。
 * ⚠️ `decide` 的返回类型这里写 `Promise<unknown>` 而不是 `Promise<string | null>`：
 *   超时用例要交一个**永不 resolve** 的 `new Promise(() => {})`（TS 推成 `Promise<unknown>`），
 *   收窄到 `string | null` 会让那条常驻用例在门 ① 直接编译不过。
 *   **契约不受影响**：`askPolicy` 对非字符串一律按回落处理，异常/超时同样回落并计数。
 */
export interface FacePolicy {
  /**
   * 注入哪个决策面。
   * ⚠️ 运行时守卫（B70 Task 3 修复轮 1）：`.mjs` 调用方（Task 5 的评估器）构造的对象拿不到
   *   这层字面量联合类型的保护 ⇒ 拼错 / 未登记的 face **不抛错**，按「该面问不到候选」处理
   *   （`emptyCandidates += 1` 后回落原启发式），既不新增计数种类也不影响缺省路径。
   */
  readonly face: 'play' | 'council' | 'certify';
  /** 只接管这一个座位（其余座位恒走原启发式）。 */
  readonly seat: number;
  /**
   * 策略器：拿到**动作执行前**的局面、决策座位、该面的合法候选，返回一个 `actionKey` 或 null。
   * 只允许读公开信息；禁止集字段（他人手牌 id / 牌堆顺序 / `duel.pickA` / `duel.pickB`）
   * 由 Task 5 的题面层负责剥离，本层不做序列化。
   */
  readonly decide: (state: State, seat: number, candidates: readonly Action[]) => Promise<unknown>;
  /** 超时（毫秒），缺省 30000。声明得这么短只为让超时用例不必真等 30 秒。 */
  readonly timeoutMs?: number;
}

/** `advanceWithDuel` 的透传选项（与 `advanceAuto` 的第三参同形）。 */
export interface AdvanceOpts {
  readonly gateReserve?: number;
  /**
   * ⚠️ **本字段由实现内部占用，调用方传入会被忽略**（B70 评审 I-3 的如实声明）。
   *
   * `tests/sim/policy.mjs` 的 `advanceWithDuel` 在展开 `...opts` **之后**无条件把
   * `onDuelPick` 覆盖成自己的 `record(stateAtPick, seat, actionKey({ type: 'DUEL_SUBMIT_CARD', actor: seat, cardId }))`
   * （B56 决策点记录 / B57 对峙面观测口径），因此外部回调永远拿不到选牌时刻。
   * ⇒ 想在此注入自定义回调，必须先改实现（把覆盖改成包装/透传）；但那会动
   *   `advanceAuto`/B56 既有的对局记录路径，与 B70「零行为变更」原则冲突，故未采纳。
   * 保留声明只为如实描述实现所读写的字段形状，不构成对调用方的承诺。
   */
  readonly onDuelPick?: (seat: number, cardId: string, stateAtPick: State) => void;
}

/**
 * 一局的统计与异常（`playOne` 的返回）。
 *
 * ⚠️ B70 只锁定下游**确实消费**的字段；其余平衡指标（`identities` / `factions` /
 *   `turnOrder` / `liveSeats` / `abilityOps` / `trialFailOutcomes` …）以索引签名放行，
 *   取值侧自行收窄 —— 本任务的原则是**零行为变更**，不在此处重新设计读数契约。
 */
export interface SimGameResult {
  readonly reason: string;
  readonly rounds: number;
  readonly winners: readonly number[];
  readonly anomalies: readonly string[];
  /** B70 Task 3 的注入计数（缺省 policy ⇒ 三个 0）。 */
  readonly injection: InjectionCounters;
  readonly [metric: string]: unknown;
}

/**
 * 记一个决策点。`recorder === null`（默认）时是**空操作**并返回 -1 ⇒ 日常模拟零开销。
 * 纯读：不改 state、不改控制流、不消耗 rng ⇒ 报告逐字不变。
 */
export declare function record(state: State, seat: number, heuristic: string, face?: number | null): number;

/** 由 run.mjs 装配记录器（null = 关闭）；装配时 `recordSeq` 归零。 */
export declare function setRecorder(value: Recorder): void;

/** 读取当前记录器（run.mjs 落盘段用它，不再持有模块级变量）。 */
export declare function getRecorder(): Recorder;

/** 状态合法性体检（跑完一局后逐玩家核对）；返回问题描述列表，空 = 正常。 */
export declare function checkState(s: State, label: string): string[];

/**
 * 挑一个默认出牌目标：除自己外位置最高的存活玩家**的座位号**。
 * 位置并列时**随机**选（用 `state.rng` ⇒ 仍可复现，且不引入座位号偏置）。
 * 无可挑目标 ⇒ `undefined`（不是 null —— 调用点按 `=== undefined` 判）。
 */
export declare function pickTarget(s: State, seat: number): number | undefined;

/**
 * 山议：每人投给位置最高的对手，然后结算。
 * B70 Task 3 起可注入 council 面。后三参**必传**（`playOne` 恒传；缺省 policy 时 `hit` 恒 false
 * ⇒ 行为与注入前逐字相同）⇒ 这里不写成可选，免得 TS 侧允许出「运行必崩」的调用。
 */
export declare function councilTurn(
  s: State,
  policy: FacePolicy | undefined,
  counters: InjectionCounters,
  hit: (seat: number) => boolean
): Promise<State>;

/**
 * 认证一轮：签印/质疑 → 判定 → 待认证者复议 → 第三方投票 → 复议裁定。
 * B70 Task 3 起可注入 certify 面（只改道「签印/质疑/弃权」三选，判定与复议恒走原逻辑）；
 * 后三参同 `councilTurn`，**必传**。
 */
export declare function certificationTurn(
  s: State,
  policy: FacePolicy | undefined,
  counters: InjectionCounters,
  hit: (seat: number) => boolean
): Promise<State>;

/** 从手牌里挑一张**付得起**且优先级最高的牌；无可打牌 ⇒ `undefined`。 */
export declare function pickPlayableCard(hand: readonly Card[], resource: number): Card | undefined;

/** 约 1/4 的行动机会发动被动；未发动 ⇒ `null`（发动成功带回新 state 与 op）。 */
export declare function maybeUseAbility(s: State, seat: number): { state: State; op: string } | null;

/** 推进手番；若结算后进入对峙 ⇒ AI 选牌后继续推进（回合阻塞 + 关隘的闭环）。 */
export declare function advanceWithDuel(s: State, mode: RuleMode, opts?: AdvanceOpts): Promise<State>;

/**
 * 跑一局，返回该局的统计与异常。
 *
 * ⚠️ `async` 是为 B70 Task 3 的**可注入策略**铺路（模型调用要 await）。
 * ⚠️ **形参数是硬契约**：`tests/engine/policy-extraction.test.ts` 断言 `playOne.length === 5`
 *   ⇒ 实现里第 5 参**不得写默认值**、也不得改成 rest（`Function.length` 遇到第一个带默认值
 *   或 rest 的形参就停止计数，写了等于那条 arity 守护当场失效）。
 *   TS 侧仍以可选参数声明（缺省即「不注入」），运行时缺省值是 `undefined` ⇒ `hit` 恒 false
 *   ⇒ 三处改道分支一次都不进 ⇒ 与注入前**逐字同行为**（门 ⑨ 报告 diff 为空是硬约束）。
 * ⚠️ 模型臂（注入命中）的 rng 流自**首个分歧**起与基线分叉：改道命中时原决策块被跳过，
 *   那一次的 `s.rng.next()` 不再消耗。这是策略注入的固有效应，不是 bug。
 */
export declare function playOne(
  theme: ThemePack,
  players: number,
  seed: number,
  gateReserve?: number,
  policy?: FacePolicy
): Promise<SimGameResult>;
