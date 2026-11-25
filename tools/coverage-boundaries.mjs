// 门禁覆盖边界（机器可读）——A5 的落点。
//
// 来源：绿洲共享田园《发布检查表》末尾的「门禁覆盖边界（如实登记）」一节。
// 原文要点：明确写出「哪些漂移**检测不到**」，避免「绿灯掩盖损坏」的同型盲区。
//
// 为什么必须是**机器可读**而不是只写在文档里：
//   只写在规格里 ⇒ 门禁不知道自己看不见什么 ⇒ 新增盲区时没人会被提醒；
//   写成机器可读清单 ⇒ ① 文档与实现可机器比对 ② 新增检查项时可强制登记边界
//   ③ 边界本身可被测试覆盖（如「parity-check 不比对 PDF 文本层」可写成断言）。

/**
 * V1 的全部覆盖边界。
 *
 * **新增检查项时必须同步登记边界**——否则机器无法知道新检查漏了什么。
 * 边界的增删由 `tools/doc-sync.mjs` 的 C8 检查把关：
 * 规格 §9.3 的覆盖边界表与本清单必须**逐条一一对应**（B52 升级：
 * 由「条数一致」升级为「每行 id 与机器清单同序 id 一一对应」）。
 */
export const COVERAGE_BOUNDARIES = [
  {
    id: 'pdf-text-layer',
    notCovered: '实体 PDF 的文本层不参与比对',
    reason: '中文 PDF 在换行、字距、字体嵌入下文本提取极不稳定，逐项比对会大量误报，门禁会退化成「每次都红、然后被手动豁免」',
    fallback: '改比对 SVG 文本节点（XML 可精确解析）+ PDF 仅做可打开/页数/字体嵌入粗检',
  },
  {
    id: 'pdf-raw-bytes',
    notCovered: '实体 PDF 的原始字节不直接比对',
    reason: 'PDF 头部含 CreationDate/ModDate 构建时刻，同一内容两次生成的字节必不同（实测：长度相同、哈希不同）',
    fallback: 'tools/pdf-normalize.mjs 归一化时间戳（等长占位符）后再比对',
  },
  {
    id: 'prose-numbers',
    notCovered: '规则书手写叙述段落里的数值不受溯源约束',
    reason: '溯源机制依赖可寻址的字段路径；散落在叙述中的数字没有稳定锚点',
    fallback: '仅规模适配表等**结构化表格**受 data-src 溯源约束（§6.7.2）',
  },
  {
    id: 'theme-content-quality',
    notCovered: '主题包的内容质量（文案是否通顺、平衡是否合理）',
    reason: '属人工判断与 B9 模拟范畴，非静态可校验',
    fallback: 'theme-validate 只查结构与引用完整性；平衡性由 B9 的 1000 局模拟统计（§9.2）',
  },
  {
    id: 'equipment-effects',
    notCovered: '装备的被动效果',
    reason: 'V1 装备是纯计数目标（§4.1 匠师「累计装备 3 件」），规格从未定义装备效果系统',
    fallback: null,
  },
  {
    id: 'two-player-mode',
    notCovered: '2 人局',
    reason: 'V1 不支持（§8）——活人认证至少需 3 人在场（放逐下限恒为 3）',
    fallback: null,
  },
  {
    id: 'live-multiplayer',
    notCovered: '多端联机对局',
    reason: 'V1 仅交付 LocalHotseatTransport + BroadcastChannelTransport 占位（§13.3 延后项）',
    fallback: null,
  },
  {
    id: 'theme-differentiation-semantics',
    notCovered: '主题差异化是否达到「换场景」而非「换措辞」的**语义深度**',
    reason: '第 ⑧ 道门用专属名词表（domainWords）做机械近似——「命中至少一个本主题名词」能挡住通用题，但判不出「名词对了、场景还是同一出戏」的伪主题化',
    fallback: '认证题文案由人工撰写并在评审中逐条核对；B9 模拟与 B10 规则书定稿时复看',
  },
  {
    id: 'rules-book-vs-engine',
    notCovered: '规则书**地形叙述**与数字轨引擎实际行为的语义一致性',
    reason: '关隘与裂隙的「到达即结算」在引擎侧尚未接线（payGate/drawTrial 全仓零引用；place_barrier 无卡牌入口）⇒ 规则书按规格写全即与引擎存在可预见的暂时差距（施工方案见规格 §3.4 / §3.5 的 B17 条款）',
    fallback: 'C10 只做**章节与要点关键词**的结构性覆盖校验；双轨行为一致性待 B18 接线后由 parity-check 增补比对。险径黑牌的「失去本回合剩余行动」已由 B17 裁定删除（无执行语义），不属本边界。',
  },
  {
    id: 'ci-config-absent',
    notCovered: 'CI 配置里的自检入口标识（仓库当前**没有任何** CI 配置）',
    reason: 'CI 路径清单（.github / .gitlab-ci.yml / .circleci / azure-pipelines.yml / Jenkinsfile）在真实仓库上全部不存在 ⇒ 该类断言恒为空集；空集无法区分「检查有效」与「断言写错了」',
    fallback: '负样本 tests/gates/repo-selftest-scope-negative.test.ts 在**隔离临时目录**造出含标识的 CI 配置 ⇒ 断言 CI 检查确实会红（B51）',
  },
  {
    id: 'scan-skip-dirs',
    notCovered: '扫描器跳过的目录**内部**（node_modules / .git / dist / print / coverage / .tmp / .vscode / .idea）',
    reason: '这些目录体量大且多为生成物与依赖，逐一读取会拖慢门禁且无意义；实测已有一个**已入库的源文件**（print/ 下的规则书叙述模板）落在其中；另：隔离副本无 git 元数据时，「已入库」判定不执行（该守卫在副本里显式 skipped，非静默通过）',
    fallback: '跳过目录内的**已入库**文件由例外白名单 SCAN_EXCEPTIONS 登记并单独扫描；「实际集合 == 登记集合」的断言保证盲区不会静默扩大（B51）',
  },
  {
    id: 'scan-binary-and-large',
    notCovered: '**二进制**文件与**大于 2MB** 的文件内容（按体积与字节标记判定跳过）',
    reason: '二进制/大文件的字节流里做标识匹配无意义，且会拖慢门禁',
    fallback: '断言「无已入库文件超过体积上限」⇒ 跳过集合不随时间静默扩大（B51）',
  },
  {
    id: 'host-walkthrough-outside-root-gate',
    notCovered: '**React host 的真浏览器走查**不在根仓门禁的执行路径内（根仓门禁只跑数字轨走查 + host 走查脚本的静态契约守卫）',
    reason: 'host 依赖（node_modules）不入库 ⇒ 根仓门禁在干净副本里起不了 vite；把它硬塞进根仓门禁会让干净副本必然判红，违反「门禁必须可跑」的纪律（B45–B52）',
    fallback: 'host 走查脚本入库并在 host 子项目内跑（npm run test:walkthrough）；根仓用 tests/gates/host-walkthrough-contract.test.ts 静态守卫防脚本被删/被掏空/少走路由（B86）',
  },
  {
    id: 'host-narrow-columns',
    notCovered: 'host **窄屏**（<768px）下排名公示不把「名次」「活人席」作为独立列呈现',
    reason: '窄屏列裁剪是响应式取舍：列数与容器宽度冲突时优先保留可操作列（座 / 身份 / 明细）⇒ 「名次」可由行序读出、「活人席」在窄屏属次要信息 ⇒ 机器判定「这两列在窄屏缺席」不属于数据漂移（B88）',
    fallback: '**综合分与距峰顶并未丢失** —— 窄屏下内联显示在身份列内；宽屏仍是七列齐全',
  },
  {
    id: 'host-secondary-screens',
    notCovered: 'host 各 flow 的**次级屏**（flow2 屏 2/3、flow3 屏 3、flow4 屏 2/3）未被走查覆盖',
    reason: '走查逐页只访问每个 flow 的**首屏**；更深屏需交互进入，已单独走查的只有 flow1 屏 2（钻取席位）与 flow3 屏 2（排名公示）（B88）',
    fallback: 'flow1 屏 2 与 flow3 屏 2 已单独走查并有断言（屏号属性口径 + 表格无横向滚动宿主 + 页面级溢出）；其余次级屏留待后续批次',
  },
];

/**
 * 规格 §9.3 覆盖边界表的**列名**（首列必须是 id —— B52 裁定）。
 *
 * ⚠️ 这几个字面量是「规格表结构」的**单一事实源**：解析与校验共用 ⇒
 *   改表结构只需改这一处，不会出现「解析认旧结构、校验认新结构」的漂移。
 */
export const SPEC_TABLE_ID_HEADER = 'id';
export const SPEC_TABLE_HEADER = ['id', '覆盖', '不覆盖'];

/**
 * 找出规格 §9.3「门禁覆盖边界」小节里的**那张表**（返回表格的全部行）。
 *
 * ⚠️ **为什么不用 `spec.indexOf('\n\n**')` 界定小节（B52 修复）：**
 *   仓库 `core.autocrlf=true` 且**无 `.gitattributes`** ⇒ 全新克隆后规格文件是 **CRLF**
 *   ⇒ `'\n\n**'` 在 CRLF 下**匹配不到**（实际是 `'\r\n\r\n**'`）⇒ 兜底走全文
 *   ⇒ 把**后续章节的表格行也吃进来**（实测：LF 下 12 条，CRLF 下 **140 条**）
 *   ⇒ C8 会误报「规格表有但机器清单没有」140 条 ⇒ **门禁假红**。
 *   ⇒ 改用**纯行级**定位：取小节标题之后**第一个连续表格块**，与换行符无关。
 *
 * @param {string} spec 规格全文。
 * @returns {string[] | null} 表格行；找不到返回 null。
 */
function findSpecCoverageTable(spec) {
  const marker = '门禁覆盖边界';
  const idx = spec.indexOf(marker);
  if (idx < 0) {
    return null;
  }
  // 行级切分（`\r?\n` 同时兼容 LF 与 CRLF）
  const lines = spec.slice(idx).split(/\r?\n/);
  // 找到第一个以 | 开头的行（表头）
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith('|')) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return null;
  }
  // 收集**连续**的表格行
  const table = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || !line.trim().startsWith('|')) {
      break;
    }
    table.push(line);
  }
  return table;
}
/**
 * 解析规格 §9.3 的覆盖边界表 ⇒ 逐行取出 id 与各单元格。
 *
 * 为什么抽成共享函数（B52）：**同一口径只能有一处实现**（E92）。
 *   此前 C8 在 `doc-sync-lib.mjs` 里数行数、`discipline.test.ts` 里又自写了一套
 *   表格解析 ⇒ 两份实现会各自漂移（改表结构时必有一处漏改）。
 *   现在解析只有这一份，C8 与测试共用。
 *
 * @param {string} spec 规格全文。
 * @returns {{ found: boolean, ids: string[], rows: string[][], detail: string }}
 *   `found=false` 表示规格里找不到该小节；`rows` 为逐行单元格（已切分、去空）。
 */
export function parseSpecCoverageRows(spec) {
  const table = findSpecCoverageTable(spec);
  if (table === null) {
    return { found: false, ids: [], rows: [], detail: '规格 §9.3 缺少「门禁覆盖边界」小节或其中的表格' };
  }
  const rows = [];
  for (const line of table) {
    const cells = line.trim().split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length === 0) {
      continue;
    }
    // 分隔行（|---|---|---|）与表头行（首列是「id」）不计入数据行。
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) {
      continue;
    }
    if (cells[0] === SPEC_TABLE_ID_HEADER) {
      continue;
    }
    rows.push(cells);
  }
  // id 单元格在规格里按惯例用反引号包裹（如 `pdf-text-layer`）⇒ 解析时剥掉。
  const ids = rows.map((c) => c[0].replace(/^`|`$/g, ''));
  return {
    found: true,
    ids,
    rows,
    detail: `规格表 ${ids.length} 条`,
  };
}

/**
 * 校验规格 §9.3 的覆盖边界表**结构**（是否有 id 列、列数是否为 3）。
 *
 * 为什么要单独校验结构（B52）：`parseSpecCoverageRows` 只取首列 ⇒
 *   若规格表被改成 2 列（漏了 id 列），解析仍会「成功」但取到的是
 *   「覆盖」列的文本当 id ⇒ 变成一条莫名其妙的 id ⇒ 报「机器清单有但规格表没有」，
 *   报错会指向错误的原因。⇒ 结构层单独判，错误直接点名「缺少 id 列」。
 *
 * @param {string} spec 规格全文。
 * @returns {{ ok: boolean, detail: string }}
 */
export function checkSpecCoverageTableStructure(spec) {
  const table = findSpecCoverageTable(spec);
  if (table === null) {
    return { ok: false, detail: '规格 §9.3 缺少「门禁覆盖边界」小节或其中的表格' };
  }
  if (table.length === 0) {
    return { ok: false, detail: '规格 §9.3 的覆盖边界表为空或格式损坏' };
  }
  const header = table[0].trim().split('|').slice(1, -1).map((s) => s.trim());
  if (header[0] !== SPEC_TABLE_ID_HEADER) {
    return {
      ok: false,
      detail: `规格 §9.3 覆盖边界表首列必须是 id（实际「${header[0]}」）——B52 起该列是逐条配对的依据`,
    };
  }
  if (header.length !== SPEC_TABLE_HEADER.length) {
    return {
      ok: false,
      detail: `规格 §9.3 覆盖边界表应是 ${SPEC_TABLE_HEADER.length} 列（${SPEC_TABLE_HEADER.join(' / ')}），实际 ${header.length} 列`,
    };
  }
  return { ok: true, detail: '' };
}
