// build/build-ir.mjs 的类型声明（`.ts` 测试引 `.mjs` 需要，与 build/theme-render.d.mts 同法：
// tsconfig 严格且**不开 allowJs**，没有这份声明门 ① 直接编译失败）。
//
// ⚠️ 参数刻意写成 unknown：主题包与规模表的形状由门 ⑤ / doc-sync 负责，
//   不在这里抄第二份类型（抄了就又是「两处声明会漂」那一类债）。
export declare function termsOf(theme: unknown): Record<string, string>;
export declare function buildIr(theme: unknown, scales: unknown): Record<string, unknown>;
