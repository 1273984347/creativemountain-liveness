// dist-artifact-lock.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。
//
// ⚠️ 为什么需要它（门 ① 的 tsc --noEmit 判红实录）：
//   本仓 .mjs **不参与** tsc（allowJs 关闭），但 tests/**/*.test.ts **会** import 它
//   ⇒ TS 找不到类型声明 ⇒ **TS7016**「Could not find a declaration file for module …」
//   ⇒ 且因返回值退化为 any，调用处的回调参数**连带**报 TS7006（隐式 any）
//   ⇒ 门 ①（语法与类型）红。
//   ⇒ 按仓内先例（tools/ir-validate.d.mts）**配一份声明**。
//
// ⚠️ 本声明与 tools/dist-artifact-lock.mjs 的实现**必须同改**（否则类型撒谎）。
//   声明是**契约**：改了实现不改声明 ⇒ 门 ① 不会发现（它只查类型一致性），
//   但调用方会按旧契约写代码 ⇒ 运行时才炸 ⇒ 故两处要一起动。

/** 基线里的一条产物记录（**期望值**：SHA256 + 字节数）。 */
export interface BaselineEntry {
  readonly sha256: string;
  readonly bytes: number;
}

/** 解析后的入库基线。 */
export interface Baseline {
  readonly artifacts: Readonly<Record<string, BaselineEntry>>;
}

/** 比对结果：issues 为空数组即逐字节一致。 */
export interface ArtifactComparison {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

/**
 * 算内容的 SHA256（十六进制，小写）。
 *
 * @param buf 内容字节。
 */
export declare function sha256Hex(buf: Uint8Array): string;

/**
 * 解析入库基线文本 —— 形状不合法**抛错**（失败关闭，绝不当成「无漂移」）。
 *
 * @param text 基线文件全文。
 */
export declare function parseBaseline(text: string): Baseline;

/**
 * 比对「入库基线」与「本次构建产出」—— **集合层先判**，再逐个比字节层。
 *
 * @param baseline 基线登记的产物。
 * @param actual 本次构建产出的产物。
 */
export declare function compareArtifacts(
  baseline: Readonly<Record<string, BaselineEntry>>,
  actual: Readonly<Record<string, BaselineEntry>>,
): ArtifactComparison;
