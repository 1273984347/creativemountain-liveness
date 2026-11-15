// build/trial-text.mjs 的类型声明（tests 引 .mjs 需要，与 build/build-themes.d.mts 同法）。
//
// ⚠️ 参数刻意写成 `unknown`：实现在纯 JS 里，输入是 theme.json / theme-data 的原始数据
//   —— 形状由门 ⑤ 的校验负责（`terms` 十叶、题面 == 判定），不在这里再抄一份类型当第二事实源。
//   渲染器对残缺数据的态度是**抛错**，所以放宽静态约束不会让错误静默溜过。

/** 可派生判定白名单（`pred.kind` 的集合）。 */
export declare const DERIVABLE_PREDICATES: ReadonlySet<string>;

/** 判定能否机械派生；非对象 / 缺 `kind` / 白名单外 ⇒ false。 */
export declare function isDerivable(pred: unknown): boolean;

/** 试炼题面 = 条件句 + 奖励句 + 失败后果；白名单外的判定抛错（调用方负责标 `fallback`）。 */
export declare function renderTrialText(effect: unknown, terms: unknown): string;

/** 试炼失败的唯一中文后果口径（真值：gate.ts:204-221 只写 gate_pay_<格>，不退格也不封口）。 */
export declare const GATE_FALLBACK_CLAUSE: string;
/** 改为付费后仍付不起的后果（真值：gate.ts:250-252 + failGate gate.ts:337-352 —— 退格与封口在这一侧）。 */
export declare const GATE_PAY_FAIL_CLAUSE: string;
/** 裸后果句（else 缺失 ⇒ undefined）；题面括注与卡面页脚共用。 */
export declare function renderTrialFailure(elseEffect: unknown, terms: unknown): string | undefined;
/** 页脚整句（题面括注 / 卡面页脚 / 规则书三处同源的那一句）。 */
export declare function renderTrialFooter(): string;
