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
