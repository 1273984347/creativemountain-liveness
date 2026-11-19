// 渲染层的主题词展开绑定（B79 §4.3 + B80 §2.3）。
//
// 为什么不直接在各调用点写 `expandThemeWords(x, terms)`：展开点有四类（日志 / notice /
// alert / 面板按钮），绑一次 `t` 让「玩家可见文本」在源码里长得一样，一眼能看出
// 「这句过没过展开器」；也让 R2 的正则有单一形状可匹配（`alert(t(…))` 合法、
// `alert('…{resource}…')` 违规）。
//
// B80 §2.3 加了第二种数据源：`{identity:N}` 查的是**运行时主体**（座位 → 身份 → 主题身份表），
// 不是静态词表，所以它要一个 `nameOf` 解析器。两类展开合成一个 `t`，调用点形状不变。
//
// ⚠️ 这里**不做兜底**：拿不到 `terms` 就不是渲染层该管的事——主题包缺叶由门 ⑤ 拦，
//   常驻防线是 R3（T14 跑真局验展开后文本）。在此处补默认值就又发明了第三套词（B79 §3.2）。
//   同理，句子里有 `{identity:N}` 却没接解析器 ⇒ **抛错**：那是接线漏了，
//   静默把花括号印给玩家是同一类缺陷。
import { expandIdentityNames, expandThemeWords } from '../../engine/core/theme-text.ts';
import type { State } from '../../engine/core/state.ts';
import type { ThemePack, ThemeTerms } from '../../engine/types/theme.ts';

/**
 * 第 `seat` 号座位在本套主题下的身份称谓（B80 §2.3）。
 *
 * 两种解析不到都**抛错**，不做「默认取当前手番」的兜底：那个默认正是 `council.ts:190`
 * 会喊错人的形状（否决者是 `vetoBy`，不是正在发言的人）。
 */
export function identityName(state: State, theme: ThemePack, seat: number): string {
  const p = state.players.find((x) => x.seat === seat);
  if (p === undefined) {
    throw new Error(`identityName：状态里没有 ${String(seat)} 号座位 ⇒ 句子会漏占位符（B80 §2.3）`);
  }
  const name = theme.identities.find((i) => i.id === p.identityId)?.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      `identityName：座位 ${String(seat)} 的身份 ${p.identityId} 在主题 ${theme.meta.id} 的身份表里查无此人`,
    );
  }
  return name;
}

/**
 * 把展开器绑到一套词表上：`const t = termExpander(theme.terms)`。
 *
 * `nameOf` 可选是**形状**考虑（B79 的三个调用点里没有身份句），不是允许漏接：
 * 句子含 `{identity:N}` 而没给解析器 ⇒ 当场抛，理由见文件头。
 */
export function termExpander(terms: ThemeTerms, nameOf?: (seat: number) => string): (raw: string) => string {
  return (raw: string) => {
    const byTerms = expandThemeWords(raw, terms);
    if (nameOf === undefined) {
      if (byTerms.includes('{identity')) {
        throw new Error(`出口缺身份称谓解析器，但句子含 {identity:…} ⇒ ${byTerms}（B80 §2.3）`);
      }
      return byTerms;
    }
    return expandIdentityNames(byTerms, nameOf);
  };
}
