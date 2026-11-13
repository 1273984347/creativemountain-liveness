// policy.mjs 的类型声明（sim 决策层单一真相源的 TS 侧契约；与 tools/*.d.mts 同法）。
//
// ⚠️ 这里**只描述契约**，实现全在 tests/sim/policy.mjs（纯 JS，无类型）。
//   改签名必须同步改 policy.mjs：门 ① 只核对 TS 侧，门 ⑨ 才核对行为。
// ⚠️ 依赖方向同 policy.mjs：本文件**不得**引用 run.mjs。

import type { LogEntry, State } from '../../engine/core/state.ts';
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
 * · `calls` —— **该面被问出口**的次数（`askPolicy` 的站点面 ≡ `policy.face` ∧ 拿到候选才算）；
 * · `fallbacks` —— 其中**回落原启发式**的次数（null / 非字符串 / 非法 key / 不在候选集 / 抛错 / 超时）；
 * · `emptyCandidates` —— **未问出口的到达数**（⚠️ B70 终审 I3：不是「该面无候选的时刻」），
 *   四类成因同口径合并：
 *   未登记的 face / **站点面与 `policy.face` 不符**（B70 评审 N-1：跨面问出口在问出口之前短路）/
 *   该面在本局面没有候选 / 按调用点的收窄条件（certify 面：当前 target）过滤后为空。
 *   ⇒ 没问出口 ⇒ 既不计 calls 也不计 fallbacks。
 * ⚠️ 不变式：`calls + emptyCandidates` == 该局到达注入点的时刻数（每个到达恰好计一次，
 *   既不静默丢弃也不重复计）—— Task 5 用 `fallbacks / calls` 读回落率的分母靠的就是这条。
 */
export interface InjectionCounters {
  /** ⚠️ 字段可变：`askPolicy` 就地递增（故**不**声明为 readonly —— 声明成只读就是谎报）。 */
  calls: number;
  fallbacks: number;
  emptyCandidates: number;
  /**
   * `emptyCandidates` 的**按成因拆分**（B70 终审 I3）：四个子字段之和恒等于 `emptyCandidates`。
   * 它**不是**第四种顶层计数（顶层仍只有 calls / fallbacks / emptyCandidates 三种语义），
   * 只用于让读者自己算出「其中跨站点到达占多少」。
   */
  emptyByReason: {
    /** `policy.face` 未登记（拼错 / `Object.prototype` 成员名）⇒ 连这一面的类型表都拿不到。 */
    unregisteredFace: number;
    /** 站点面 ≠ `policy.face`（在 play/council/certify 某个站点上被另一个面的策略到达）。 */
    stationMismatch: number;
    /** 站点面 ≡ 策略面，但该面在本局面**本来就没有候选**（如 play 面在待认证锁定回合）。 */
    noCandidate: number;
    /** 该面有候选，但按调用点的收窄条件（certify 面：当前 target）过滤后为空。 */
    narrowedEmpty: number;
  };
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
   * ⚠️ 运行时守卫（B70 Task 3 修复轮 1 + 修复轮 2 的 N-1/N-2）：`.mjs` 调用方（Task 5 的
   *   评估器）构造的对象拿不到这层字面量联合类型的保护，故实现侧两道兜底，**都不抛错**：
   *   · 面未登记（拼错，或取到 `Object.prototype` 的成员名如 `'toString'`）⇒ 按「问不到候选」
   *     处理（`emptyCandidates += 1` 后回落）—— 判据是 `Array.isArray(FACE_TYPES[face])`，
   *     `=== undefined` 挡不住原型链上的值（N-2）；
   *   · **站点 ≡ 面**：每个注入站点自己声明属于哪个面，与 `policy.face` 不符时在**问出口之前**
   *     短路（同样只计 `emptyCandidates`）⇒ 不会出现「在 certify 站点拿到 play 候选、
   *     引擎签了印而 JSONL 记下没打出的牌」（N-1）。
   *   两条都只改计数、不改行为 ⇒ 与缺省路径逐字同结局。
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

/** 转发给 `advanceAuto` 的选项（`onDuelPick` 除外 —— 它由实现内部占用，见下）。 */
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

/** 试炼失败后的归宿（由玩家 flags 推导，逐座位一项）。 */
export interface TrialFailOutcome {
  readonly failed: boolean;
  readonly passedAfterFail: boolean;
  readonly releasedAfterFail: boolean;
}

/** 身份目标计数器的实际值分布（`value` = 当前计数，`count` = 目标要求值）。 */
export interface CounterValue {
  readonly kind: string;
  readonly value: number;
  readonly count: number;
}

/**
 * 一局的统计与异常（`playOne` 的返回）。
 *
 * ⚠️ B73 收口：字段**逐项具名**（不再用索引签名放行）—— 这样 `.ts` 测试里打错字段名会在
 *   `tsc` 阶段报错，而不是静默得到 `unknown`。`.mjs` 消费方（评估器）本就不受 TS 保护，
 *   故本声明只影响测试与 IDE。字段集合以 `policy.mjs` 的 `return {...}` 为准，新增读数必须同步。
 */
export interface SimGameResult {
  readonly reason: string;
  readonly rounds: number;
  readonly winners: readonly number[];
  readonly identities: readonly string[];
  readonly factions: readonly string[];
  readonly turnOrder: readonly number[];
  readonly firstPendingSeat: number;
  readonly firstPendingRound: number;
  readonly firstPendingPos: number;
  readonly certRound: number;
  readonly liveSeats: Readonly<Record<number, number>>;
  readonly seatTotal: number;
  readonly abilityOps: readonly string[];
  readonly trialFailOutcomes: readonly TrialFailOutcome[];
  readonly duelCount: number;
  readonly trialEvents: readonly LogEntry[];
  readonly passiveOps: readonly string[];
  readonly goalKinds: readonly string[];
  readonly markCount: number;
  readonly markKinds: readonly string[];
  readonly counterValues: readonly CounterValue[];
  readonly anomalies: readonly string[];
  /** B70 Task 3 的注入计数（缺省 policy ⇒ 三个 0）。 */
  readonly injection: InjectionCounters;
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

/**
 * B75：要装备哪张手牌（取「最不需要打出」的可支付、非位移牌）。
 * 手牌 < 2 或无可装备牌 ⇒ `undefined`。位移判定与引擎同源（`cardHasMovement`）。
 */
export declare function pickEquipCard(state: State, seat: number): Card | undefined;

/**
 * B75：仲裁者是否应在**本次**山议使用否决（存活 ∧ 持权 ∧ 未用过 ∧ 票已齐 ∧ 本人被最高票）。
 * 判据与引擎 `useCouncilVeto` 逐条一致 —— 不一致就是「启发式多发一次必拒动作」。
 */
export declare function shouldVeto(state: State, seat: number): boolean;

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
 * ⚠️ play 面注入只在**基线本来就要出牌**的那一段（`s.rng.next() >= 0.85`）接管「选哪张牌 + 打谁」
 *   （B70 终审 C1）：0.16/0.75/0.85 三段行动分段两臂完全相同（`roll` 两臂都恰好消耗一次）。
 * ⚠️ 模型臂的 rng 流在**第一次打出不同的牌之后**与基线分叉（牌不同 ⇒ 之后的状态与 rng 使用不同）；
 *   这不是「跳过了一次 rng」，而是同一起点上的状态分叉，是策略注入的固有效应。
 */
export declare function playOne(
  theme: ThemePack,
  players: number,
  seed: number,
  gateReserve?: number,
  policy?: FacePolicy
): Promise<SimGameResult>;
