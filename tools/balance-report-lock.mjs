// 平衡报告**入库一致性**判据（门 ⑮）—— 让 `docs/balance-report.md` 进入门禁的比对面。
//
// ⚠️ 起因（B92 遗留 L-B92-4 · B93 的 R8 教训）：
//   `docs/balance-report.md` 是**入库生成物**，却**不被任何一道门读取**
//   ⇒ 它会随引擎演进而**悄悄过期**，而旁边引用它的文档会一起过期，
//      且**没有任何门会报**（E153）。本文件把报告接进门禁的比对面。
//
// ⚠️ 为什么单独成文件（而不是写进 tests/sim/run.mjs）：
//   正样本与负样本必须**共用同一份实现** —— 仓内纪律是「负样本测的是被测实现，
//   不是近似复刻」。本文件导出**纯函数**（不碰文件系统），
//   tools/gate.mjs（门 ⑮）与 tests/gates/balance-report-lock.test.ts 都用它。
//
// ⚠️ **口径与容差**（L-B92-4 要求先定，裁定如下）：
//   ① **比对对象**：`docs/balance-report.md`（入库版） ↔ **本机按固定 seed 重跑生成的新版**。
//      新版写到**临时文件**，**绝不覆盖入库版** —— 就地重生成会把漂移**抹掉**
//      （「重生成 ⇒ 必然相等」⇒ 门禁永绿 ⇒ 比对面形同虚设）。
//   ② **容差 = 0（逐字节相等）**。依据（实测）：`node tests/sim/run.mjs --out <新文件>`
//      重跑 24000 局后与入库版 **SHA256 全等**（F93087C8…），两次独立重跑之间也全等
//      ⇒ 引擎在固定 seed 下**逐字节可复现** ⇒ 任何差异都是**真漂移**，没有给容差的理由。
//   ③ **唯一的归一化**：行尾 LF 归一化（CRLF ⇒ LF）。理由：仓库 `core.autocrlf=true`
//      虽有 `.gitattributes`（`* text=auto eol=lf`）兜底，但**门禁也可能在 CRLF 工作树下运行**
//      ⇒ 归一化只消掉「环境歧义」，不放掉任何**内容**差异。
//   ④ **不做**数值容差、不做「允许 N 行差异」这类软化 —— 那会让「报告已过期」重新静默。
//
// ⚠️ 这层比对覆盖的是「**报告内容是否仍由当前引擎产生**」；
//   「报告里的数值是否**平衡合理**」是**人工判据**（15pp 记录线，`engine/core/balance.ts`
//   无身份常量 ⇒ 没有机器实现），已登记为覆盖边界（见 tools/coverage-boundaries.mjs）。

/**
 * 行尾归一化：CRLF / CR ⇒ LF。
 *
 * ⚠️ 只改行尾，**不**动其它任何字节（含 BOM、尾随空格、末尾换行）。
 *
 * @param {string} text 原文。
 * @returns {string} 行尾统一为 LF 的文本。
 */
export function toLf(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 比对两份平衡报告文本，列出**全部差异行**（读数差异的可定位清单）。
 *
 * ⚠️ 为什么不只返回「相等/不等」：门禁红时必须**点名第几行、期望什么、实测什么**
 *   —— 否则只能靠人肉 diff 才能定位（E139 的教训：结论必带证据）。
 *
 * ⚠️ 差异行用**行号（1 起）**标注，格式统一为：
 *   `第 N 行｜期望：<入库版该行>｜实测：<重跑版该行>`
 *   末尾多出一行时用 `（无）` 占位；末尾少出一行时同理。
 *
 * @param {string} expected 入库版报告全文。
 * @param {string} actual 重跑生成的新版全文。
 * @returns {string[]} 差异行清单；**空数组 = 逐字节相等**。
 */
export function diffReportLines(expected, actual) {
  const e = toLf(expected).split('\n');
  const a = toLf(actual).split('\n');
  const out = [];
  const max = Math.max(e.length, a.length);
  for (let i = 0; i < max; i += 1) {
    const el = e[i];
    const al = a[i];
    if (el === al) { continue; }
    const line = '第 ' + String(i + 1) + ' 行｜期望：' + (el ?? '（无）')
      + '｜实测：' + (al ?? '（无）');
    out.push(line);
  }
  return out;
}

/**
 * 从报告里抽出「模拟口径」的关键读数（每档局数 / 总局数）。
 *
 * ⚠️ **为什么要单独抽**：逐字节相等**只**保证「两份文本一样」，
 *   但若有人改了 sim 的**默认参数**（如每档 1000 局 → 100 局）**并重生成**了入库报告
 *   ⇒ 逐字节照样相等 ⇒ **样本被静默缩小**（24000 局 → 2400 局）⇒ 平衡结论的精度悄悄下降。
 *   ⇒ 比对面必须**声明并核对口径**：口径不一致 ⇒ 判红。
 *
 * ⚠️ 口径行取自报告的**总览表**（由 `tests/sim/run.mjs` 写入）。
 *
 * @param {string} text 报告全文。
 * @returns {{ gamesPerCell: string | null, totalGames: string | null }}
 */
export function extractSampleScope(text) {
  const s = toLf(text);
  const g = s.match(/^\| 每档局数 \| ([^|]+) \|$/m);
  const t = s.match(/^\| 总局数 \| ([^|]+) \|$/m);
  return {
    gamesPerCell: g === null ? null : (g[1] ?? '').trim(),
    totalGames: t === null ? null : (t[1] ?? '').trim(),
  };
}

/**
 * **权威的**模拟口径期望值 —— 从**规格 §9.2** 派生（不手抄、不从报告自身提取）。
 *
 * ⚠️ **为什么期望值必须来自规格，而不是「重跑版 vs 入库版」互比**（B94 盲审发现）：
 *   若期望值取自「重跑版」，而有人改了 sim 默认参数**并重生成**了入库报告
 *   ⇒ 两边口径**一致**（都是 100 局）⇒ 口径检查**恒绿** ⇒ **同义反复，抓不到缩样本**。
 *   ⇒ 期望值必须**独立于被检查的两侧** ⇒ 取自规格 §9.2 的权威表述
 *   「**4 主题 × 6 档 × 1000 局 = 24000 局**」。
 *
 * ⚠️ **单一事实源**：主题数从 `themes/` 目录**实际存在的主题包**数派生；
 *   人数档数从 `engine/scales.ts` 的 `SCALES` 派生；每档局数从**规格文本**解析。
 *   ⇒ 任一环节变化 ⇒ 期望值随之变化 ⇒ **不手抄**。
 *
 * @param {string} specText 规格全文（§9.2）。
 * @param {number} themeCount 实际主题包数量。
 * @param {number} tierCount 人数档数量（SCALES 行数）。
 * @returns {{ gamesPerCell: number, totalGames: number, source: string }}
 *   `source` 为期望值的来源说明（写进报错，让人能判断该改哪一侧）。
 */
export function expectedSampleScope(specText, themeCount, tierCount, gamesPerCell = null) {
  const s = toLf(specText);
  // ⚠️ **锚定 §9.2 小节**（B94 第二轮复核发现）：直接对全文 `match()` 取**首个**匹配
  //   ⇒ 规格更早位置若出现同格式表述 ⇒ 期望值被**静默改写** ⇒ 口径检查失守。
  //   ⇒ 先裁出 §9.2 小节，再在小节内匹配。
  const secStart = s.indexOf('### 9.2 ');
  if (secStart < 0) { throw new Error('规格里找不到「### 9.2」小节 ⇒ 无法派生权威样本口径'); }
  const secEnd = s.indexOf('\n### ', secStart + 1);
  const section = secEnd < 0 ? s.slice(secStart) : s.slice(secStart, secEnd);
  // 规格 §9.2 的权威表述：「≥ 24000 局（4 主题 × 6 档 × 1000 局）」
  const m = section.match(/≥\s*(\d+)\s*局[^\n]*?(\d+)\s*主题\s*×\s*(\d+)\s*档\s*×\s*(\d+)\s*局/);
  if (m === null) {
    throw new Error('规格 §9.2 找不到「N 局（X 主题 × Y 档 × Z 局）」的权威口径表述 ⇒ 无法派生期望样本口径');
  }
  const total = Number(m[1]);
  const specThemes = Number(m[2]);
  const specTiers = Number(m[3]);
  const specGames = Number(m[4]);
  // ⚠️ 规格里的「主题数 / 档数」若与**代码真值**不一致 ⇒ 口径本身就漂了 ⇒ 当场抛错（不静默取其一）。
  if (specThemes !== themeCount || specTiers !== tierCount) {
    throw new Error('规格 §9.2 的口径与代码真值不一致｜规格：' + String(specThemes) + ' 主题 × '
      + String(specTiers) + ' 档｜实际：' + String(themeCount) + ' 主题 × ' + String(tierCount) + ' 档');
  }
  // ⚠️ 规格自身的**算术必须自洽**（B94 第二轮复核发现）：「≥ 2400 局（4 主题 × 6 档 × 1000 局）」
  //   内部矛盾（4×6×1000 = 24000 ≠ 2400）⇒ 会派生出互相矛盾的期望值且判绿。
  const computed = specThemes * specTiers * specGames;
  if (computed !== total) {
    throw new Error('规格 §9.2 的口径表述**内部算术不自洽**｜声明：≥ ' + String(total)
      + ' 局，但 ' + String(specThemes) + ' × ' + String(specTiers) + ' × ' + String(specGames)
      + ' = ' + String(computed) + ' 局');
  }
  // ⚠️ **自证口径按局数等比缩放**（不是「从报告取」）：期望值仍**派生自规格权威值**，
  //   只是当自证用小口径（--games N）时按比例缩放 ⇒ 既保住「独立锚点」性质，
  //   又让小口径自证不被「权威值 24000 局」误判。
  //   ⇒ 正式门禁**不传 --games** ⇒ 期望就是权威全量值 ⇒ 缩样本攻击仍必红。
  const scale = gamesPerCell === null ? null : gamesPerCell / specGames;
  const effGames = gamesPerCell === null ? specGames : gamesPerCell;
  const effTotal = gamesPerCell === null ? total : computed / specGames * gamesPerCell;
  return {
    gamesPerCell: effGames,
    totalGames: effTotal,
    source: '规格 §9.2（≥ ' + String(total) + ' 局 = ' + String(specThemes) + ' 主题 × '
      + String(specTiers) + ' 档 × ' + String(specGames) + ' 局）'
      + (scale === null ? '' : '｜自证缩放：每档 ' + String(specGames) + ' → ' + String(effGames) + ' 局'),
  };
}

/**
 * 从 **sim 进程的实际 stdout** 解析「实际跑了多少局」。
 *
 * ⚠️ **为什么必须用 stdout 而不是报告里的口径行**（B94 第二轮复核发现 · EXP-G）：
 *   报告里的「每档局数 / 总局数」两行是**报告生成器自己写的** ⇒ 可被人为改成与实际量脱钩
 *   （实测：把 sim 默认局数改成 100 并把报告口径行**硬写**成 1000/24000 ⇒ 门禁全绿）。
 *   ⇒ 口径核对必须锚在**不可由报告伪造**的量上：sim 的 stdout（进程实际跑出来的局数）。
 *
 * @param {string} stdout sim 的标准输出。
 * @returns {number | null} 实际总局数；解析不到时返回 null（⇒ 判红，不静默通过）。
 */
export function parseActualTotalGames(stdout) {
  const s = toLf(String(stdout ?? ''));
  const m = s.match(/合计\s*(\d+)\s*局/);
  return m === null ? null : Number(m[1]);
}

/**
 * 判两份平衡报告是否**逐字节一致**（行尾归一化后）。
 *
 * @param {string} expected 入库版报告全文。
 * @param {string} actual 重跑生成的新版全文。
 * @param {{ gamesPerCell: number, totalGames: number, source: string } | null} [expectedScope]
 *   **权威期望口径**（由 expectedSampleScope 从规格 §9.2 派生）⇒ 传了才防得住「缩样本」；
 *   不传则只做两侧互比（**抓不到**「改了默认参数并重生成」）。
 * @returns {{ ok: boolean, diffs: string[], scopeIssues: string[], expectedLines: number, actualLines: number }}
 *   `ok=true` ⇒ 逐字节一致（`diffs` 为空数组）。
 */
export function checkBalanceReport(expected, actual, expectedScope = null) {
  const diffs = diffReportLines(expected, actual);
  const scopeExpected = extractSampleScope(expected);
  const scopeActual = extractSampleScope(actual);
  const scopeIssues = [];
  // ⚠️ 口径判定必须拿**独立于被检查两侧**的期望值（规格 §9.2）⇒ 否则是同义反复。
  //   期望值缺失（如纯函数调用方没传）⇒ 只做**两侧互比**并标注它**不能**防缩样本。
  if (expectedScope === null) {
    if (scopeExpected.gamesPerCell !== scopeActual.gamesPerCell
      || scopeExpected.totalGames !== scopeActual.totalGames) {
      scopeIssues.push('模拟口径不一致｜入库版：每档 ' + String(scopeExpected.gamesPerCell)
        + ' 局 / 合计 ' + String(scopeExpected.totalGames)
        + ' 局｜重跑版：每档 ' + String(scopeActual.gamesPerCell)
        + ' 局 / 合计 ' + String(scopeActual.totalGames) + ' 局');
    }
  } else {
    for (const [label, scope] of [['入库版', scopeExpected], ['重跑版', scopeActual]]) {
      if (scope.gamesPerCell !== String(expectedScope.gamesPerCell)
        || scope.totalGames !== String(expectedScope.totalGames)) {
        scopeIssues.push(label + '的模拟口径与**权威期望**不符｜期望：每档 '
          + String(expectedScope.gamesPerCell) + ' 局 / 合计 ' + String(expectedScope.totalGames)
          + ' 局｜实测：每档 ' + String(scope.gamesPerCell) + ' 局 / 合计 '
          + String(scope.totalGames) + ' 局｜期望值来源：' + expectedScope.source);
      }
    }
  }
  return {
    ok: diffs.length === 0 && scopeIssues.length === 0,
    diffs,
    scopeIssues,
    scopeExpected,
    scopeActual,
    expectedLines: toLf(expected).split('\n').length,
    actualLines: toLf(actual).split('\n').length,
  };
}
