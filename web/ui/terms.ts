// 渲染层的主题词展开绑定（B79 §4.3）。
//
// 为什么不直接在各调用点写 `expandThemeWords(x, terms)`：展开点有四类（日志 / notice /
// alert / 面板按钮），绑一次 `t` 让「玩家可见文本」在源码里长得一样，一眼能看出
// 「这句过没过展开器」；也让 R2 的正则有单一形状可匹配（`alert(t(…))` 合法、
// `alert('…{resource}…')` 违规）。
//
// ⚠️ 这里**不做兜底**：拿不到 `terms` 就不是渲染层该管的事——主题包缺叶由门 ⑤ 拦，
//   常驻防线是 R3（T14 跑真局验展开后文本）。在此处补默认值就又发明了第三套词（B79 §3.2）。
import { expandThemeWords } from '../../engine/core/theme-text.ts';
import type { ThemeTerms } from '../../engine/types/theme.ts';

/** 把展开器绑到一套词表上：`const t = termExpander(theme.terms)`。 */
export function termExpander(terms: ThemeTerms): (raw: string) => string {
  return (raw: string) => expandThemeWords(raw, terms);
}
