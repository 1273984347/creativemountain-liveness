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
 * 规格 §9.3 的覆盖边界表与本清单必须**条数一一对应**。
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
];
