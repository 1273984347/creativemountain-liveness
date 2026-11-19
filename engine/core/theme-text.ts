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

/**
 * `{identity:N}` —— 第 N 号座位在本套主题下的身份称谓（B80 §2.3）。
 *
 * 与 `expandThemeWords` 分两个函数、两种数据源：那一个查**静态词表**（`terms`），这一个查
 * **运行时主体**（座位 → 玩家身份 → 主题身份表）。合成一个"大替换"就把两件不同的事糊成一团，
 * 将来加 `{faction:N}` 时没有落点。
 *
 * ⚠️ 正则**每次调用新建**：带 `g` 的字面量正则带 `lastIndex` 状态，提到模块级常量复用会在
 *   第二次调用时从中途开始匹配（静默少替换，且只在一条消息含两个占位符时才暴露——正是难查的那种）。
 */
export function expandIdentityNames(raw: string, nameOf: (seat: number) => string): string {
  // 1) 先拒畸形：**剥掉合法 token 后**还剩 `{identity` 就是畸形。
  //    ⚠️ 别用 `/\{identity(?!\d+\})/` 这类负向预查来判——合法 token 是 `{identity:0}`，
  //    `{identity` 后面紧跟的是冒号而不是数字，那条式子会把**每个合法句子**判成畸形
  //    （计划 T2 Step 3 的"更清晰等价版"就是这么写的，执行期修正 #14）。
  const residueAfterValid = raw.replace(/\{identity:\d+\}/g, '');
  if (residueAfterValid.includes('{identity')) {
    throw new Error(`身份占位符格式非法：${raw}`);
  }
  // 2) 全局替换。名字里理论上不含占位符，仍循环到干净（上限 4 轮：数据被写坏时不无限循环）。
  let out = raw;
  for (let i = 0; i < 4 && /\{identity:\d+\}/.test(out); i += 1) {
    out = out.replace(/\{identity:(\d+)\}/g, (_m, digits: string) => nameOf(Number(digits)));
  }
  // 3) 残留即抛：把裸 `{identity:3}` 印给玩家，和缺叶一样是缺陷（B79 的缺叶口径）。
  if (out.includes('{identity')) { throw new Error(`身份占位符残留：${out}（句子：${raw}）`); }
  return out;
}
