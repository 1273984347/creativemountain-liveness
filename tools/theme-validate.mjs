// 主题包校验器 —— 结构 + 引用完整性 + ops 白名单 + goal kind 白名单 + 数量一致性。
//
// 全部判据**从 engine/types/theme.ts 派生**（见 tools/theme-schema.mjs），
// 不存在手抄的第二事实源。任一错误 → exit 1。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { deriveThemeSchema } from './theme-schema.mjs';
import { isDerivable, renderTrialText } from '../build/trial-text.mjs';
import { SCALES } from '../engine/scales.ts';

/**
 * 不可派生题面（`fallback: true`）的**期望条数**（B77 规格 §6.3 第 3 条）。
 *
 * ⚠️ 刻意硬编码成常量、不做配置项：今天四套 48 条判定全在白名单内 ⇒ 0。
 *   将来真要加一条非机械判定（例如按标记位判过关），必须改这个数字并在批次记录写理由
 *   ——「放宽守卫」这件事得出现在 diff 里，而不是靠某个人记得配置文件里改过一行。
 */
export const EXPECTED_FALLBACK_COUNT = 0;

/** `terms` 的十八叶路径（B80 §2.1 由十五叶长成：句子层八叶 + `deck` = 九叶，再加 types 四 / colors 二 / statuses 三。校验**叶子**而非顶层 6 个键：只查顶层时，`types` 缺一个也照样绿）。 */
const TERM_LEAVES = [
  ['hp'], ['deck'], ['resource'], ['gate'],
  // B79 §3.1：句子层要用 {path} / {peak} ⇒ 必须是必填叶
  //   （此前它们只活在开放索引的 glossary 里，缺键不红，展开器只能静默兜底）
  ['path'], ['peak'],
  // B80 §2.1：裂隙 / 险径 / 玩家称谓进句子层（{rift} / {hazard} / {player}），同理必填
  ['rift'], ['hazard'], ['player'],
  ['types', 'motion'], ['types', 'attack'], ['types', 'defense'], ['types', 'utility'],
  ['colors', 'red'], ['colors', 'black'],
  // B78 §4 R4：三叶（不是四叶——skip_turn 只有动词位、无名词位读取点，见规格 R4 取证）
  ['statuses', 'poison'], ['statuses', 'slow'], ['statuses', 'silence'],
];

/** 试炼牌名的上限（B78 §2.2）。 */
const NAME_MAX = 6;
/**
 * 合并禁字表（B78 §2.2）。
 *
 * 量化词（张/枚/点/至少/不低于/≥/回合 + 两个颜色词组）来自第 2 节原裁定：
 *   名字的活是「这场考验在叙事上是什么」，量化口径只属于题面。
 * 类目词（试炼 + 四套 gate 词全集）来自 r1 合并：头部已印「{gate}试炼」，名字再含它就是复读。
 * ⚠️ **单字颜色 / 单字关允许**：禁的是词组（「赤步」「红移」「朱守」「赤关」合法，
 *   「红色校验」「关隘守」非法）。
 */
const NAME_BANNED = ['张', '枚', '点', '至少', '不低于', '≥', '红色', '黑色', '回合',
  '试炼', '关隘', '封锁线', '安全闸', '阵门'];

/**
 * 题面真值守卫（B77 §6.3）：凡判定可派生，`text` 必须逐字等于 `renderTrialText` 的结果。
 *
 * 为什么挂在门 ⑤ 而不是只写在测试里：题面漂移是**印刷事故**，而 IR 只搬运 text
 * （build-ir.mjs:138）⇒ 只有主题包校验器站在源头，能拦住「牌面一套、引擎一套」。
 */
function checkTrialTruth(theme, err) {
  for (const path of TERM_LEAVES) {
    const got = path.reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), theme.terms);
    if (typeof got !== 'string' || got.length === 0) {
      err(`terms.${path.join('.')} 必须是非空字符串（试炼题面的取词表，B77 §6.2）`);
    }
  }
  let fallback = 0;
  const seenNames = new Map();
  (theme.trials ?? []).forEach((t, i) => {
    // ---- B78 §2.2：name 判据（必填 / ≤6 字 / 禁数字 / 合并禁字表 / 套内不撞名）----
    if (typeof t.name !== 'string' || t.name.length === 0) {
      err(`trials[${i}]（${t.id}）缺 name ⇒ 实体件版面靠它起标题行（B78 §3.1 站 9）`);
    } else {
      if (t.name.length > NAME_MAX) { err(`trials[${i}]（${t.id}）的 name「${t.name}」超过 ${String(NAME_MAX)} 字`); }
      if (/[0-9０-９]/.test(t.name)) { err(`trials[${i}]（${t.id}）的 name「${t.name}」含数字 ⇒ parity 锚定串 #N+name 的唯一性靠「无数字」`); }
      for (const w of NAME_BANNED) {
        if (t.name.includes(w)) { err(`trials[${i}]（${t.id}）的 name「${t.name}」含禁字「${w}」（量化词或类目词，B78 §2.2）`); }
      }
      seenNames.set(t.name, (seenNames.get(t.name) ?? 0) + 1);
    }
    const conditional = (t.effects ?? []).find((e) => e.op === 'conditional');
    if (!isDerivable(conditional?.pred)) {
      // 不可派生 ⇒ 只查非空，但**必须**留下 fallback 标记，否则守卫对它视而不见
      if (t.fallback !== true) {
        err(`trials[${i}]（${t.id}）的判定 ${String(conditional?.pred?.kind)} 不在可派生白名单内，必须标 fallback: true`);
      }
      fallback += 1;
      return;
    }
    if (t.fallback === true) {
      err(`trials[${i}]（${t.id}）明明可派生却标了 fallback ⇒ 视为绕过守卫（B77 §6.3）`);
      return;
    }
    let want;
    try {
      want = renderTrialText(conditional, theme.terms);
    } catch (e) {
      err(`trials[${i}]（${t.id}）题面派生失败：${e.message}`);
      return;
    }
    if (t.text !== want) { err(`trials[${i}]（${t.id}）题面与判定不符：判[${want}] / 印[${t.text}]`); }
  });
  for (const [n, c] of seenNames) {
    if (c > 1) {
      err(`trials[].name「${n}」在本套内出现 ${String(c)} 次 ⇒ 同套 12 张必须互异（门 ⑧ 管的是跨套，两者不同判据）`);
    }
  }
  if (fallback !== EXPECTED_FALLBACK_COUNT) {
    err(`不可派生题面数 = ${String(fallback)}，守卫期望 EXPECTED_FALLBACK_COUNT = ${String(EXPECTED_FALLBACK_COUNT)}：真要加非机械判定，改这个常量并在批次记录说明理由`);
  }
}

/** 可用座位数上限（规模表 3–8 人）。 */
const MAX_SEATS = Math.max(...SCALES.map((s) => s.players));

/**
 * `terms`（句子层唯一取词）与 `glossary`（印刷层对照表）的重叠键必须逐字等值（B79 §3.3）。
 *
 * ⚠️ 这是 **B78 §4 R6 承诺却从未实现的守卫（E136）**：`ir-validate:42` 的注释、B78 规格 §4、
 *   B78 验收 12 三处互相引用「门⑤ 判等」，代码零行——B79 开工探针实测「只改 `glossary.gate`」
 *   得 0 条错误（五个键全如此），见 `docs/批次/B79-…-执行记录.md` §6。
 * ⚠️ `deck` **故意不比**：`terms.deck` 是单张牌名（符箓/道箓/指令/异能牌），`glossary.deck`
 *   是牌库名（符箓库/…），四套实测两表**全部不等** ⇒ 比了就是把正确数据判红。
 *   （同一条理由见 B79 §4.4：`deck` 也不进句子层占位符集合。）
 */
const TERMS_GLOSSARY_PAIRS = [
  ['hp', 'HP'], ['resource', 'resource'], ['gate', 'gate'], ['path', 'path'], ['peak', 'peak'],
  // B80 §2.1：三新叶同样两边一档（hybrid 的 glossary 三键随 terms 一起换词，见规格 §2.1.2）
  ['rift', 'rift'], ['hazard', 'hazard'], ['player', 'player'],
];

function checkTermsGlossaryAgreement(theme, err) {
  for (const [leaf, key] of TERMS_GLOSSARY_PAIRS) {
    const a = theme.terms?.[leaf];
    const b = theme.glossary?.[key];
    // 缺值由 TERM_LEAVES（terms 侧）与「glossary 缺少核心术语」（glossary 侧）各自报，
    // 这里只判**两边都有值却不相等**的情形——否则缺键会一次报三条，掩盖真正的不一致。
    if (typeof a !== 'string' || typeof b !== 'string') { continue; }
    if (a !== b) {
      err(`terms.${leaf}「${a}」与 glossary.${key}「${b}」不一致 ⇒ 句子层与印刷层在说两个词（B79 §3.3）`);
    }
  }
}

/** 校验结果。 */
export function validateTheme(theme, schema) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  // ---------- 顶层结构 ----------
  if (theme === null || typeof theme !== 'object' || Array.isArray(theme)) {
    return { errors: ['主题包根必须是对象'], warnings };
  }
  const requiredTop = ['meta', 'glossary', 'counts', 'factions', 'identities', 'cards', 'board', 'heavenCards', 'certificationCards'];
  for (const k of requiredTop) {
    if (theme[k] === undefined) { err(`缺少顶层字段：${k}`); }
  }
  if (errors.length > 0) { return { errors, warnings }; }

  // ---------- meta / glossary ----------
  for (const k of ['id', 'name', 'tagline', 'resourceName', 'deckName']) {
    if (typeof theme.meta[k] !== 'string' || theme.meta[k].length === 0) {
      err(`meta.${k} 必须是非空字符串`);
    }
  }
  // glossary 至少覆盖四个核心术语（§10.1 必须差异化项）
  for (const k of ['HP', 'deck', 'hand', 'resource']) {
    if (typeof theme.glossary[k] !== 'string' || theme.glossary[k].length === 0) {
      err(`glossary 缺少核心术语：${k}`);
    }
  }
  // 两张词表的重叠键必须逐字等值（B79 §3.3，销 B78 R6 空守卫 E136）
  checkTermsGlossaryAgreement(theme, err);

  // ---------- counts ----------
  for (const k of ['handStart', 'deckTotal', 'trialTotal', 'certTotal']) {
    if (!Number.isInteger(theme.counts[k]) || theme.counts[k] < 0) {
      err(`counts.${k} 必须是非负整数`);
    }
  }

  // ---------- 阵营（4 个）----------
  if (!Array.isArray(theme.factions) || theme.factions.length !== 4) {
    err(`阵营必须恰好 4 个，实际 ${theme.factions?.length ?? 0}`);
  }
  const factionIds = new Set();
  for (const f of theme.factions ?? []) {
    if (typeof f.id !== 'string' || f.id.length === 0) { err('阵营缺少 id'); }
    else if (factionIds.has(f.id)) { err(`阵营 id 重复：${f.id}`); }
    else { factionIds.add(f.id); }
    if (typeof f.name !== 'string' || f.name.length === 0) { err(`阵营 ${f.id} 缺少 name`); }
    if (!Number.isInteger(f.hpBase) || f.hpBase < 1) { err(`阵营 ${f.id} 的 hpBase 必须是正整数`); }
    if (!Number.isInteger(f.resourceBase)) { err(`阵营 ${f.id} 的 resourceBase 必须是整数`); }
    if (!Array.isArray(f.deckTags)) { err(`阵营 ${f.id} 的 deckTags 必须是数组`); }
  }

  // ---------- 身份（goal kind 白名单）----------
  if (!Array.isArray(theme.identities) || theme.identities.length !== 8) {
    err(`身份必须恰好 8 个，实际 ${theme.identities?.length ?? 0}`);
  }
  const identityIds = new Set();
  for (const id of theme.identities ?? []) {
    if (typeof id.id !== 'string' || id.id.length === 0) { err('身份缺少 id'); }
    else if (identityIds.has(id.id)) { err(`身份 id 重复：${id.id}`); }
    else { identityIds.add(id.id); }
    if (id.goal === undefined) { err(`身份 ${id.id} 缺少 goal`); }
    else {
      if (!schema.goalKinds.includes(id.goal.kind)) {
        err(`身份 ${id.id} 的 goal.kind 不在白名单：${id.goal.kind}`);
      }
      if (id.goal.count !== undefined && (!Number.isInteger(id.goal.count) || id.goal.count < 1)) {
        err(`身份 ${id.id} 的 goal.count 必须是正整数`);
      }
    }
    // ---------- B75：权限位 rights ----------
    // ⚠️ 未知值**判红**：`setup.ts` 只认白名单里的 right，写错一枚字面量会静默失权
    //   （玩家读了规则书却按不到按钮）⇒ 与其等人工发现，不如门禁拦下。
    const RIGHTS = new Set(['council_veto']);
    if (id.rights !== undefined) {
      if (!Array.isArray(id.rights)) { err(`身份 ${id.id} 的 rights 必须是数组`); }
      else {
        for (const r of id.rights) {
          if (!RIGHTS.has(r)) { err(`身份 ${id.id} 的 rights 未知值：${String(r)}`); }
        }
      }
    }
    // ⚠️ 文本与权限口径**软警告**（不阻断）：passiveText 是要印进规则书的，
    //   写了「否决」却没给 rights（或反之）都是**内容事故**而非格式事故 ⇒
    //   门 ⑤ 只认退出码，警告进 stdout 供人工核对，不因主题作者改文案就红一片。
    const textHasVeto = typeof id.passiveText === 'string' && id.passiveText.includes('否决');
    const dataHasVeto = Array.isArray(id.rights) && id.rights.includes('council_veto');
    if (textHasVeto !== dataHasVeto) {
      warn(`身份 ${id.id}：passiveText 与 rights 的否决口径不一致（文本=${textHasVeto} rights=${dataHasVeto}）`);
    }
  }
  // ---------- 卡牌 ----------
  const cardIds = new Set();
  if (!Array.isArray(theme.cards)) {
    err('cards 必须是数组');
  }
  const colorCount = { red: 0, black: 0 };
  for (const c of theme.cards ?? []) {
    if (typeof c.id !== 'string' || c.id.length === 0) { err('卡牌缺少 id'); continue; }
    if (cardIds.has(c.id)) { err(`卡牌 id 重复：${c.id}`); }
    cardIds.add(c.id);
    if (typeof c.name !== 'string' || c.name.length === 0) { err(`卡牌 ${c.id} 缺少 name`); }
    if (!schema.cardTypes.includes(c.type)) {
      err(`卡牌 ${c.id} 的 type 不在白名单：${c.type}（允许 ${schema.cardTypes.join('/')}）`);
    }
    if (!Number.isInteger(c.cost) || c.cost < 0) { err(`卡牌 ${c.id} 的 cost 必须是非负整数`); }
    if (c.color !== 'red' && c.color !== 'black') { err(`卡牌 ${c.id} 的 color 必须是 red/black`); }
    else { colorCount[c.color] += 1; }
    if (!Number.isInteger(c.rank) || c.rank < 2 || c.rank > 14) {
      err(`卡牌 ${c.id} 的 rank 必须是 2–14 的整数（A=14），实际 ${c.rank}`);
    }
    if (typeof c.text !== 'string' || c.text.length === 0) { err(`卡牌 ${c.id} 缺少 text`); }
    if (!Array.isArray(c.effects)) { err(`卡牌 ${c.id} 的 effects 必须是数组`); }
  }
  // 红黑比例（§3.3 建议各半）——建议级，不判红
  const total = colorCount.red + colorCount.black;
  if (total > 0) {
    const ratio = colorCount.red / total;
    if (ratio < 0.4 || ratio > 0.6) {
      warn(`红黑比例偏离各半：红 ${colorCount.red} / 黑 ${colorCount.black}（建议各半）`);
    }
  }

  // ---------- 效果（ops 白名单 + 参数）----------
  /** 主题内可引用的卡牌 id（含造物牌） */
  const knownCardIds = new Set([
    ...(theme.cards ?? []).map((c) => c.id),
    ...(theme.creationDeck ?? []).map((c) => c.cardId),
  ]);
  const knownIdentityIds = new Set((theme.identities ?? []).map((i) => i.id));
  const knownFactionIds = new Set((theme.factions ?? []).map((f) => f.id));
  const boardLength = theme.board?.length ?? 0;

  /** 递归校验一个 effect 及其嵌套。 */
  function checkEffect(effect, path) {
    if (effect === null || typeof effect !== 'object') {
      err(`${path}：效果必须是对象`);
      return;
    }
    const op = effect.op;
    if (typeof op !== 'string') { err(`${path}：效果缺少 op`); return; }
    const spec = schema.ops[op];
    if (spec === undefined) {
      err(`${path}：未注册的算子「${op}」`);
      return;
    }
    const present = Object.keys(effect).filter((k) => k !== 'op');
    for (const r of spec.required) {
      if (!present.includes(r)) { err(`${path}（${op}）：缺少必填参数 ${r}`); }
    }
    for (const o of spec.optional) {
      if (present.includes(o) && effect[o] === undefined) {
        err(`${path}（${op}）：可选参数 ${o} 不应为 undefined`);
      }
    }
    for (const k of present) {
      if (!spec.required.includes(k) && !spec.optional.includes(k)) {
        err(`${path}（${op}）：多余参数 ${k}`);
      }
    }
    // 递归嵌套
    if (op === 'sequence') {
      if (!Array.isArray(effect.effects)) { err(`${path}（sequence）：effects 必须是数组`); }
      else { effect.effects.forEach((e, i) => checkEffect(e, `${path}.effects[${i}]`)); }
    }
    if (op === 'conditional') {
      checkPredicate(effect.pred, `${path}.pred`);
      checkEffect(effect.then, `${path}.then`);
      if (effect.else !== undefined) { checkEffect(effect.else, `${path}.else`); }
    }
    if (op === 'count') {
      checkEffect(effect.effect, `${path}.effect`);
    }
    checkEffectValues(effect, path);
  }

  /**
   * 效果**参数取值域**校验。
   *
   * ⚠️ B8 补：原先只校验算子名与参数**名**合法 —— 参数取值越界（如 damage 的
   *   amount 为负、immunity 的 status 写错、cardId 引用不存在的牌）会**静默失效**：
   *   引擎要么失败要么打空，而校验器照样放行。实测注入 13 条非法取值，只有
   *   谓词侧那一条被抓到 —— 效果侧完全是盲区。
   */
  function checkEffectValues(effect, path) {
    const op = effect.op;
    // ---- 数值参数：必须为正整数 ----
    for (const key of ['amount', 'count']) {
      const v = effect[key];
      if (v === undefined) {
        continue;
      }
      if (!Number.isInteger(v) || v <= 0) {
        err(`${path}（${op}）：${key} 必须是正整数，实际 ${JSON.stringify(v)}`);
      }
    }
    // ---- 骰子点数 ----
    if (op === 'set_die_result') {
      if (!Number.isInteger(effect.value) || effect.value < 1 || effect.value > 20) {
        err(`${path}（set_die_result）：value 必须是 1–20 的整数，实际 ${JSON.stringify(effect.value)}`);
      }
    }
    if (op === 'move_by_dice' || op === 'dice_is_at_least') {
      if (effect.faces !== 6 && effect.faces !== 20) {
        err(`${path}（${op}）：faces 只能是 6（移动骰）或 20（指令骰），实际 ${JSON.stringify(effect.faces)}`);
      }
    }
    // ---- 目标座位 ----
    if (effect.target !== undefined) {
      if (!Number.isInteger(effect.target) || effect.target < 0 || effect.target >= MAX_SEATS) {
        err(`${path}（${op}）：target 必须是 0–${MAX_SEATS - 1} 的座位号，实际 ${JSON.stringify(effect.target)}`);
      }
    }
    // ---- 负面状态 ----
    if (op === 'immunity') {
      if (!schema.negativeStatuses.includes(effect.status)) {
        err(`${path}（immunity）：status 不在白名单：${effect.status}（允许 ${schema.negativeStatuses.join('/')}）`);
      }
    }
    // ---- 阵营轮来源 ----
    if (op === 'spirit_wheel' && effect.source !== undefined) {
      if (effect.source !== 'manual' && effect.source !== 'command') {
        err(`${path}（spirit_wheel）：source 只能是 manual / command，实际 ${JSON.stringify(effect.source)}`);
      }
    }
    // ---- 昼夜值 ----
    if (op === 'set_phase') {
      if (effect.value !== 'night' && effect.value !== 'day') {
        err(`${path}（set_phase）：value 只能是 night / day，实际 ${JSON.stringify(effect.value)}`);
      }
    }
    // ---- 棋盘格号 ----
    for (const key of ['tileIndex']) {
      const v = effect[key];
      if (v === undefined) {
        continue;
      }
      if (!Number.isInteger(v) || v < 1 || v > boardLength) {
        err(`${path}（${op}）：${key} 必须是 1–${boardLength} 的格号，实际 ${JSON.stringify(v)}`);
      }
    }
    // ---- 卡牌引用完整性 ----
    if (typeof effect.cardId === 'string' && !knownCardIds.has(effect.cardId)) {
      err(`${path}（${op}）：引用了不存在的卡牌 ${effect.cardId}`);
    }
    if (Array.isArray(effect.cardIds)) {
      for (const id of effect.cardIds) {
        if (typeof id !== 'string' || !knownCardIds.has(id)) {
          err(`${path}（${op}）：引用了不存在的卡牌 ${JSON.stringify(id)}`);
        }
      }
    }
    // ---- 身份 / 阵营引用完整性 ----
    if (typeof effect.identityId === 'string' && !knownIdentityIds.has(effect.identityId)) {
      err(`${path}（${op}）：引用了不存在的身份 ${effect.identityId}`);
    }
    if (typeof effect.factionId === 'string' && !knownFactionIds.has(effect.factionId)) {
      err(`${path}（${op}）：引用了不存在的阵营 ${effect.factionId}`);
    }
    // ---- 标记名 ----
    for (const key of ['flag']) {
      const v = effect[key];
      if (v !== undefined && (typeof v !== 'string' || v.length === 0)) {
        err(`${path}（${op}）：${key} 必须是非空字符串`);
      }
    }
  }
  /**
   * 递归校验一个谓词 —— **含参数取值白名单**。
   *
   * B8 补：谓词**名**合法不等于**参数取值**合法。
   * 参数越界（如 `phase_is` 取了 'night' 以外的值）会让条件**永不成立**，
   * 卡牌就此静默失效 —— 玩家看到「效果生效」却什么都没发生。
   * 故判据从 `engine/types/theme.ts` **派生**（同源铁律），不手抄。
   */
  function checkPredicate(pred, path) {
    if (pred === null || typeof pred !== 'object') { err(`${path}：谓词必须是对象`); return; }
    if (!schema.predicateNames.includes(pred.kind)) {
      err(`${path}：未注册的谓词「${pred.kind}」`);
      return;
    }
    switch (pred.kind) {
      case 'phase_is': {
        const allowed = schema.predicateEnums?.phase_is ?? [];
        if (allowed.length === 0) {
          // 白名单派不出 ⇒ 判红（不能静默跳过：改一次类型声明就能让整条检查失效）
          err(`${path}（phase_is）：无法从类型定义派生取值白名单——检查已失效，必须修`);
        } else if (!allowed.includes(pred.value)) {
          err(`${path}（phase_is）：value 必须是 ${allowed.join(' / ')}，实际 ${JSON.stringify(pred.value)}`);
        }
        break;
      }
      case 'card_type_is':
        if (!schema.cardTypes.includes(pred.type)) {
          err(`${path}（card_type_is）：type 不在白名单：${pred.type}（允许 ${schema.cardTypes.join('/')}）`);
        }
        break;
      case 'tile_kind':
        // 判别字段与参数名同为 `kind` ⇒ JSON 里互相覆盖 ⇒ 该谓词当前无法正确表达。
        err(`${path}（tile_kind）：该谓词的参数名与判别字段冲突，当前不可用（见规格 §6.4 备注）`);
        break;
      case 'hand_count':
      case 'players_alive': {
        if (!schema.compareOps.includes(pred.op)) {
          err(`${path}（${pred.kind}）：op 不在白名单：${pred.op}（允许 ${schema.compareOps.join('/')}）`);
        }
        if (!Number.isInteger(pred.count) || pred.count < 0) {
          err(`${path}（${pred.kind}）：count 必须是非负整数`);
        }
        break;
      }
      case 'has_card':
        checkCardFilter(pred.filter, `${path}.filter`);
        break;
      case 'identity_is':
        if (typeof pred.identityId !== 'string' || pred.identityId.length === 0) {
          err(`${path}（identity_is）：identityId 必须是非空字符串`);
        }
        break;
      case 'faction_is':
        if (typeof pred.factionId !== 'string' || pred.factionId.length === 0) {
          err(`${path}（faction_is）：factionId 必须是非空字符串`);
        }
        break;
      case 'hp_at_least':
      case 'resource_at_least':
        if (!Number.isInteger(pred.amount) || pred.amount < 0) {
          err(`${path}（${pred.kind}）：amount 必须是非负整数`);
        }
        break;
      case 'has_card_count':
        if (!Number.isInteger(pred.count) || pred.count < 1) {
          err(`${path}（has_card_count）：count 必须是正整数`);
        }
        break;
      case 'dice_is_at_least':
        if (!Number.isInteger(pred.amount) || pred.amount < 0) {
          err(`${path}（dice_is_at_least）：amount 必须是非负整数`);
        }
        if (!Number.isInteger(pred.faces) || pred.faces < 2) {
          err(`${path}（dice_is_at_least）：faces 必须是 ≥2 的整数`);
        }
        break;
      case 'flag_set':
        if (typeof pred.flag !== 'string' || pred.flag.length === 0) {
          err(`${path}（flag_set）：flag 必须是非空字符串`);
        }
        break;
      case 'card_color_is':
        if (pred.color !== 'red' && pred.color !== 'black') {
          err(`${path}（card_color_is）：color 必须是 red/black`);
        }
        if (pred.source?.kind !== 'deckTop' && pred.source?.kind !== 'cardId') {
          err(`${path}（card_color_is）：source.kind 必须是 deckTop / cardId`);
        }
        if (pred.source?.kind === 'cardId'
          && (typeof pred.source.cardId !== 'string' || pred.source.cardId.length === 0)) {
          err(`${path}（card_color_is）：source.cardId 必须是非空字符串`);
        }
        break;
      default:
        break;
    }
  }

  /** 校验卡牌筛选条件（五字段 AND；空 filter 匹配任意牌）。 */
  function checkCardFilter(filter, path) {
    if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
      err(`${path}：filter 必须是对象`);
      return;
    }
    if (filter.type !== undefined && !schema.cardTypes.includes(filter.type)) {
      err(`${path}：type 不在白名单：${filter.type}`);
    }
    if (filter.color !== undefined && filter.color !== 'red' && filter.color !== 'black') {
      err(`${path}：color 必须是 red/black`);
    }
    if (filter.suit !== undefined && (typeof filter.suit !== 'string' || filter.suit.length === 0)) {
      err(`${path}：suit 必须是非空字符串`);
    }
    if (filter.cardId !== undefined && (typeof filter.cardId !== 'string' || filter.cardId.length === 0)) {
      err(`${path}：cardId 必须是非空字符串`);
    }
    if (filter.cost !== undefined) {
      if (filter.cost === null || typeof filter.cost !== 'object') {
        err(`${path}.cost：必须是对象`);
      } else {
        if (!schema.costOps.includes(filter.cost.op)) {
          err(`${path}.cost.op 不在白名单：${filter.cost.op}（允许 ${schema.costOps.join('/')}）`);
        }
        if (!Number.isInteger(filter.cost.value) || filter.cost.value < 0) {
          err(`${path}.cost.value 必须是非负整数`);
        }
      }
    }
  }
  for (const c of theme.cards ?? []) {
    (c.effects ?? []).forEach((e, i) => checkEffect(e, `card[${c.id}].effects[${i}]`));
  }
  for (const f of theme.factions ?? []) {
    if (f.ability !== undefined) { checkEffect(f.ability, `faction[${f.id}].ability`); }
    if (f.wheel !== undefined) { checkEffect(f.wheel, `faction[${f.id}].wheel`); }
  }
  for (const id of theme.identities ?? []) {
    if (id.passive !== undefined) { checkEffect(id.passive, `identity[${id.id}].passive`); }
  }
  for (const h of theme.heavenCards ?? []) {
    (h.effects ?? []).forEach((e, i) => checkEffect(e, `heaven[${h.id}].effects[${i}]`));
  }
  for (const t of theme.trials ?? []) {
    (t.effects ?? []).forEach((e, i) => checkEffect(e, `trial[${t.id}].effects[${i}]`));
  }
  for (const cc of theme.creationDeck ?? []) {
    (cc.effects ?? []).forEach((e, i) => checkEffect(e, `creation[${cc.cardId}].effects[${i}]`));
  }
  // ---------- 棋盘 ----------
  const board = theme.board;
  if (!Number.isInteger(board.length) || board.length < 2) { err('board.length 必须是 ≥2 的整数'); }
  if (!Number.isInteger(board.peakIndex) || board.peakIndex !== board.length) {
    err(`board.peakIndex 必须等于 board.length（峰顶即末格）`);
  }
  if (!Array.isArray(board.tiles)) { err('board.tiles 必须是数组'); }
  else {
    const tileIdx = new Set();
    for (const t of board.tiles) {
      if (!Number.isInteger(t.index) || t.index < 1 || t.index > board.length) {
        err(`格位 index 越界：${t.index}`);
      }
      if (tileIdx.has(t.index)) { err(`格位 index 重复：${t.index}`); }
      tileIdx.add(t.index);
      if (typeof t.kind !== 'string') { err(`格位 ${t.index} 缺少 kind`); }
      if (t.gate !== undefined) {
        if (!Number.isInteger(t.gate.fee) || t.gate.fee < 0) { err(`关隘 ${t.index} 的 fee 必须是非负整数`); }
        if (!Array.isArray(t.gate.trialIds) || t.gate.trialIds.length === 0) {
          err(`关隘 ${t.index} 必须声明 trialIds`);
        }
      }
      if (t.branches !== undefined) {
        if (!Array.isArray(t.branches) || t.branches.length === 0) { err(`支路格 ${t.index} 的 branches 不能为空`); }
        for (const br of t.branches ?? []) {
          if (!Number.isInteger(br.to) || br.to < 1 || br.to > board.length) {
            err(`支路 ${t.index} 的终点越界：${br.to}`);
          }
        }
      }
    }
    if (board.tiles.length !== board.length) {
      err(`棋盘格数与 length 不符：${board.tiles.length} ≠ ${board.length}`);
    }
  }

  // ---------- 引用完整性 ----------
  const trialIds = new Set((theme.trials ?? []).map((t) => t.id));
  for (const t of board.tiles ?? []) {
    for (const tid of t.gate?.trialIds ?? []) {
      if (!trialIds.has(tid)) { err(`关隘 ${t.index} 引用了不存在的试炼牌：${tid}`); }
    }
  }
  for (const cc of theme.creationDeck ?? []) {
    if (typeof cc.cardId !== 'string' || cc.cardId.length === 0) { err('造物牌缺少 cardId'); continue; }
    if (!cardIds.has(cc.cardId)) { err(`造物牌引用了不存在的卡牌：${cc.cardId}`); }
    if (typeof cc.name !== 'string' || cc.name.length === 0) { err(`造物牌 ${cc.cardId} 缺少 name`); }
    if (typeof cc.text !== 'string' || cc.text.length === 0) { err(`造物牌 ${cc.cardId} 缺少 text`); }
  }

  // ---------- 主题专属名词表（结构校验）----------
  if (theme.domainWords !== undefined) {
    if (!Array.isArray(theme.domainWords)) {
      err('domainWords 必须是数组');
    } else {
      for (const w of theme.domainWords) {
        if (typeof w !== 'string' || w.length === 0) { err('domainWords 含空值或非字符串'); }
      }
    }
  }

  // ---------- 数量一致性 ----------
  if (theme.counts.deckTotal !== (theme.cards?.length ?? 0)) {
    err(`counts.deckTotal（${theme.counts.deckTotal}）与 cards 实际数量（${theme.cards?.length ?? 0}）不符`);
  }
  if (theme.counts.trialTotal !== (theme.trials?.length ?? 0)) {
    err(`counts.trialTotal（${theme.counts.trialTotal}）与 trials 实际数量（${theme.trials?.length ?? 0}）不符`);
  }
  if (theme.counts.certTotal !== (theme.certificationCards?.length ?? 0)) {
    err(`counts.certTotal（${theme.counts.certTotal}）与 certificationCards 实际数量（${theme.certificationCards?.length ?? 0}）不符`);
  }
  // 认证题卡 ≥ 8 张且主题化（§10.1 必须差异化项）
  if ((theme.certificationCards?.length ?? 0) < 8) {
    err(`认证题卡至少 8 张，实际 ${theme.certificationCards?.length ?? 0}（§10.1 必须差异化项）`);
  }
  for (const cc of theme.certificationCards ?? []) {
    if (typeof cc.prompt !== 'string' || cc.prompt.length === 0) { err(`认证题卡 ${cc.id} 缺少 prompt`); }
  }
  // 天机牌 / 试炼牌基本结构
  if ((theme.heavenCards?.length ?? 0) === 0) { err('天机牌不得为空'); }
  for (const h of theme.heavenCards ?? []) {
    if (typeof h.name !== 'string' || h.name.length === 0) { err(`天机牌 ${h.id} 缺少 name`); }
    if (typeof h.text !== 'string' || h.text.length === 0) { err(`天机牌 ${h.id} 缺少 text`); }
  }
  for (const t of theme.trials ?? []) {
    if (typeof t.text !== 'string' || t.text.length === 0) { err(`试炼牌 ${t.id} 缺少 text`); }
  }
  // 题面真值（B77 §6.3）：放在非空检查之后——空题面先按「缺少 text」报，别混成派生失败
  checkTrialTruth(theme, err);

  return { errors, warnings };
}

// ---------- CLI ----------
//
// 用法：
//   `node tools/theme-validate.mjs`            → 校验 themes/ 下**全部**主题包（B8 起为 4 套）
//   `node tools/theme-validate.mjs <路径> ...`  → 只校验指定的主题包
//
// 门卫第 ⑤ 门用无参形式 ⇒ 新增主题包后**自动纳入门禁**，不会漏检。

/** 列出 themes/ 下的全部主题包路径（按目录名排序）。 */
export function listThemePaths(root = 'themes') {
  const dir = resolve(root);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => resolve(dir, e.name, 'theme.json'))
    .filter((p) => existsSync(p))
    .sort();
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const schema = deriveThemeSchema();
  const args = process.argv.slice(2);
  const paths = args.length > 0 ? args.map((p) => resolve(p)) : listThemePaths();
  if (paths.length === 0) {
    console.error('FAIL  未找到任何主题包（themes/*/theme.json）');
    process.exit(1);
  }
  let failed = 0;
  for (const p of paths) {
    let theme;
    try {
      theme = JSON.parse(readFileSync(p, 'utf8'));
    } catch (err) {
      console.error(`FAIL  主题包读取/解析失败：${p}`);
      console.error(`      ${err.message}`);
      failed += 1;
      continue;
    }
    const result = validateTheme(theme, schema);
    for (const w of result.warnings) {
      console.log(`WARN  [${theme.meta?.id ?? p}] ${w}`);
    }
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        console.error(`FAIL  [${theme.meta?.id ?? p}] ${e}`);
      }
      console.error(`      主题包校验失败：${result.errors.length} 项错误（${p}）`);
      failed += 1;
      continue;
    }
    console.log(
      `PASS  ${p}` +
      `\n      卡牌 ${theme.cards.length} · 阵营 ${theme.factions.length} · 身份 ${theme.identities.length}` +
      ` · 天机 ${theme.heavenCards.length} · 试炼 ${(theme.trials ?? []).length}` +
      ` · 认证题 ${theme.certificationCards.length} · 造物 ${(theme.creationDeck ?? []).length}`,
    );
  }
  if (failed > 0) {
    console.error(`\nFAIL：${failed} 套主题包校验失败（共 ${paths.length} 套）`);
    process.exit(1);
  }
  console.log(`\nPASS：${paths.length} 套主题包全部校验通过`);
}
