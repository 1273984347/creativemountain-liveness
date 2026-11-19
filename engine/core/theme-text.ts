// 句子层占位符的唯一替换实现（B79 §4.1）。
//
// 为什么用占位符而不是「把 terms 注进引擎」：`State` 里没有 themeId，engine/** 也不 import
// 任何主题数据（架构事实）；注词表要改 40 个调用点，还会把 `uiAllows` 的 null 判据与签名
// 重新耦合。占位符只多一个纯函数，引擎继续只报机制事实（B78 P1 的延伸）。
//
// 分工：engine/** 发「机制事实 + `{leaf}`」，本函数负责**怎么换**，四个显示出口
// （日志 / notice / alert / 面板按钮，B79 §4.3）负责**在哪儿换**。
import type { ThemeTerms } from '../types/theme.ts';

/**
 * 允许出现在玩家可见句子里的占位符（顺序稳定，供守卫与文档引用）。
 *
 * ⚠️ 集合里**没有 `deck`**：`scifi-ai` 的 `terms.deck` 是「指令」，与四套共用的规则词
 *   「问天指令骰 / 第 N 条指令」同形（规格 §4.4）——接进句子层会把合规实现判红。
 *   B80 §2.1 复核过：句层里 `deck` 一类六个 glossary 键**实测 0 处**，所以不是"暂不加"而是"无对象"。
 * 与 `tools/theme-diff-check.mjs` 的 `SENTENCE_LEAVES` 各自声明、由
 * `tests/build/expand-theme-words.test.ts` 钉住两者相等（漂移 = 门⑧ 比 N 叶而 R1 只禁 M 叶，两边各错一半）。
 */
export const TERM_TOKENS = ['resource', 'gate', 'path', 'peak', 'hp', 'rift', 'hazard', 'player'] as const;

/**
 * 把 `{leaf}` 换成主题词。缺叶**抛错**，不静默保留占位符——
 * 漏印 `{path}` 给玩家看，和印出错的主题词是同一类缺陷（B78 页脚假话的形状）。
 *
 * 无占位符的文本恒等返回 ⇒ 出口可以无条件调用，不需要「这条是不是主题句」的分支。
 */
export function expandThemeWords(raw: string, terms: ThemeTerms): string {
  let out = raw;
  for (const token of TERM_TOKENS) {
    const value = terms[token];
    // 类型上 value 必是 string（TERM_TOKENS 是字面量元组、四叶在 ThemeTerms 里必填）；
    // 这道守卫为的是**运行时**：测试会喂残缺对象验证抛错分支，而门⑤ 之外没有第二道闸。
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`terms.${token} 缺失或非字符串 ⇒ 无法展开 {${token}}（句子：${raw}）`);
    }
    out = out.split(`{${token}}`).join(value);
  }
  return out;
}
