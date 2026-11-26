// dist 产物**字节基线一致性**判据（门 ⑯）—— 让 `dist/` 的单文件产物进入门禁的比对面。
//
// ⚠️ 起因（B98 · E153 同族）：`dist/` 是**不入库的生成物**，其字节基线此前**只以文字形式**
//   记在批次文档里（B97 记录：「单文件产物新基线 A0A85EE5… / 212,032 bytes」）⇒
//   **没有任何机器守卫** ⇒ ① 产物字节变了没人知道；② 那条手抄基线**自己漂了也没人知道**
//   （E153 的老毛病：同一个数值有两个出处，只有会自动更新的那个会更新，另一个静默过期）。
//   ⇒ 本门把「产物字节」接进门禁的比对面：产物的 SHA256 + 字节数 vs **入库基线**。
//
// ⚠️ 口径（**先定后写**，E156 教训）：
//   ① **比对面 = 独立重建的产物**：门 ⑯ 自己跑一次 esbuild 构建（输出到**源根下的独立临时目录**），
//      **不**复用门 ④ 的 `dist/`，**不**就地覆盖 ⇒ 避免「自己重生成出来的自己」式同义反复。
//   ② **期望值 = 入库基线**（`docs/baselines/dist-artifact.sha256.json`）：一份**人工维护**的
//      静态文件 ⇒ 与被检查对象（现构建产物）**来源不同** ⇒ 期望值不可由被检查对象伪造。
//   ③ **容差 = 0（逐字节相等）**：依据**实测** —— 同一 checkout 连续**三次独立构建**，
//      两个产物的 SHA256 与字节数**全等**；且**把整个 checkout 复制到别处再构建，产物字节不变**
//      ⇒ 构建逐字节可复现、**与 checkout 路径无关** ⇒ 任何差异都是**真漂移**。
//      （B89 亦实测过：依赖升级后产物 SHA 与基线**逐字节相同**。）
//   ④ **集合层也要判**：本次构建产出的**文件集合**必须等于基线登记的集合（多一个 / 少一个都判红）
//      ⇒ 「构建入口新增了输出格式却忘了登记基线」不会静默变成盲区。
//
// ⚠️ 这层比对覆盖的是「**产物字节是否仍由当前源产生**」；
//   「产物的**功能正确性**」由门 ⑭ 浏览器走查与门 ⑩ 对峙端到端承担（两个口径正交，不可互相替代）
//   ⇒ 已登记为覆盖边界（`tools/coverage-boundaries.mjs` 的 `dist-artifact-byte-only`）。

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 基线文件的**形状**（人工维护的期望值）。
 *
 * @typedef {{ sha256: string, bytes: number }} BaselineEntry
 * @typedef {{ artifacts: Record<string, BaselineEntry> }} Baseline
 */

/** 禁止出现在基线条目名里的**危险键**（原型污染与继承链上的特殊名）。 */
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * 基线条目名的形状校验 —— 必须是**纯文件名**。
 *
 * ⚠️ 为什么校验（B98 盲审发现）：条目名会被拼进「集合层」报错文本，也会参与集合比对 ⇒
 *   若允许 `../` 或路径分隔符 ⇒ 报错文本可能指向**基线目录之外**的路径 ⇒
 *   排查时会被带偏（不是注入漏洞，但**语义混乱**）。
 *
 * @param {string} name 条目名。
 */
function assertPlainFileName(name) {
  if (name === '' || name === '.' || name === '..') {
    throw new Error('基线条目名不是合法文件名：' + JSON.stringify(name));
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new Error('基线条目名不得含路径分隔符（须是纯文件名）：' + JSON.stringify(name));
  }
  if (FORBIDDEN_KEYS.includes(name)) {
    throw new Error('基线条目名不得是原型相关键：' + JSON.stringify(name));
  }
}

/**
 * 算内容的 SHA256（十六进制，小写）。
 *
 * @param {Buffer|Uint8Array} buf 内容字节。
 * @returns {string} 十六进制摘要。
 */
export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * 枚举一个目录下的**文件**并算出各自的 SHA256 与字节数。
 *
 * ⚠️ **为什么抽成共用函数**（E92「同一口径只能有一处实现」）：门 ⑯ 的执行器与基线刷新脚本
 *   都要做「枚举产物 + 算摘要」⇒ 两处各写一遍 ⇒ 迟早漂移（其中一个改了另一个没改 ⇒ 基线里
 *   记的字节数算法与门禁算的不一致 ⇒ 假红或假绿）。
 *   ⇒ 唯一出处在这里，两个调用方共用。
 *
 * ⚠️ 目录（子目录）**不计入**产物集合 —— 只收**文件**。
 *
 * @param {string} dir 产物目录。
 * @returns {Record<string, { sha256: string, bytes: number }>} 按文件名升序的产物摘要。
 */
export function collectArtifacts(dir) {
  const out = Object.create(null);
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (!statSync(p).isFile()) { continue; }
    const buf = readFileSync(p);
    out[name] = { sha256: sha256Hex(buf), bytes: buf.length };
  }
  return out;
}

/**
 * 解析入库基线文本。
 *
 * ⚠️ **失败关闭**：形状不合法（不是对象 / 缺 `artifacts` / 条目缺 `sha256` 或 `bytes` /
 *   `sha256` 不是 64 位十六进制 / `bytes` 不是非负整数 / 条目名不是纯文件名 /
 *   条目名是原型相关键 / `artifacts` 为空）⇒ **抛错**，
 *   由调用方判红 —— 绝不「解析不了就当空基线」（那会让门禁**恒绿**）。
 *
 * ⚠️ 用 `Object.create(null)` 承接：普通对象上写 `out['__proto__'] = x` 会走**原型 setter**
 *   ⇒ 该条目被**静默丢弃**（B98 盲审实测：`{"__proto__":…,"b.html":…}` 解析成功且只剩 `b.html`）
 *   ⇒ 而「少了一个产物」本应被判红（集合层）⇒ 反而成了**静默放过**。null 原型杜绝这一类。
 *
 * @param {string} text 基线文件全文。
 * @returns {Baseline} 解析后的基线。
 */
export function parseBaseline(text) {
  let obj;
  try {
    obj = JSON.parse(String(text ?? ''));
  } catch (e) {
    throw new Error('基线不是合法 JSON：' + String(e instanceof Error ? e.message : e));
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('基线顶层必须是对象');
  }
  const arts = obj.artifacts;
  if (arts === null || typeof arts !== 'object' || Array.isArray(arts)) {
    throw new Error('基线缺 artifacts 字段（或不是对象）');
  }
  const out = Object.create(null);
  for (const [name, e] of Object.entries(arts)) {
    assertPlainFileName(name);
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      throw new Error('基线条目不是对象：' + name);
    }
    if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) {
      throw new Error('基线条目缺合法 sha256（须 64 位小写十六进制）：' + name);
    }
    if (!Number.isInteger(e.bytes) || e.bytes < 0) {
      throw new Error('基线条目缺合法 bytes（须非负整数）：' + name);
    }
    out[name] = { sha256: e.sha256, bytes: e.bytes };
  }
  if (Object.keys(out).length === 0) {
    throw new Error('基线的 artifacts 为空 ⇒ 无任何产物被守 ⇒ 判红（不得当成「无漂移」）');
  }
  return { artifacts: out };
}

/**
 * 比对「入库基线」与「本次构建产出」。
 *
 * ⚠️ **集合层先判**（E93 式的「顺序层最先判」同款：若先判字节层，缺项会被误报成「字节漂移」
 *   ⇒ 报错指向错误的原因）。集合层判完再逐个比字节层。
 *
 * @param {Record<string, BaselineEntry>} baseline 基线登记的产物。
 * @param {Record<string, BaselineEntry>} actual 本次构建产出的产物。
 * @param {string} [actualSource] 实测侧的来源说明（用于报错文本，便于定位）。
 * @returns {{ ok: boolean, issues: string[] }} `issues` 为空数组即逐字节一致。
 */
export function compareArtifacts(baseline, actual, actualSource = '本次构建产出') {
  const issues = [];
  const bNames = Object.keys(baseline).sort();
  const aNames = Object.keys(actual).sort();
  const missing = bNames.filter((n) => !aNames.includes(n));
  const extra = aNames.filter((n) => !bNames.includes(n));

  if (missing.length > 0 || extra.length > 0) {
    issues.push(
      '产物集合不一致｜期望（基线登记）：' + (bNames.join('、') || '（空）')
      + '｜实测（' + actualSource + '）：' + (aNames.join('、') || '（空）')
      + (missing.length > 0 ? '｜缺失：' + missing.join('、') : '')
      + (extra.length > 0 ? '｜多出：' + extra.join('、') : ''),
    );
  }

  for (const n of bNames) {
    if (missing.includes(n)) { continue; }
    const b = baseline[n];
    const a = actual[n];
    if (a.sha256 !== b.sha256 || a.bytes !== b.bytes) {
      issues.push(
        '产物字节漂移｜' + n
        + '｜期望 SHA256：' + b.sha256 + '（' + String(b.bytes) + ' bytes）'
        + '｜实测 SHA256：' + a.sha256 + '（' + String(a.bytes) + ' bytes）',
      );
    }
  }

  return { ok: issues.length === 0, issues };
}
