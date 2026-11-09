// P0 环境自检（sidecar 预研 · 阶段 B）。
//
// 目的：回答「本地 Laya sidecar 能不能在这个机器上跑起来」——三段，**顺序不可换**：
//   ① 权重对拍（字节数 + sha256 前缀）—— 不符 ⇒ 写结论、退出码 1，**不做后续任何探测**；
//   ② 候选解释器逐个探测（laya / serve.create_app / Router / load / torch / CUDA）；
//   ③ 判定 launch 路线（A：官方 app 指向本地权重；B：只能自建推理）。
//
// ⚠️ **探测命令不得带 `-I`**：`python -I` 会排除 user site ⇒ 排除 `_torch_drive.pth`
//   ⇒ torch 根本找不到 ⇒ 探测会给出假阴性（「没装 torch」）。
//
// 用法：`node tools/laya-sidecar/env-check.mjs`（退出码 0 = 对拍通过且至少一个候选可用）
// 产物：`docs/预研/data/p0-env.md`

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ---------- 固定口径（与计划一致，勿改）----------
//
// ⚠️ 期望值与对拍实现**不在本文件** ⇒ 与 `serve.mjs`（反代）共用 `weights.mjs`
//   ⇒ 同一份口径、只有一处（B55）。
import {
  EXPECT_WEIGHT_BYTES as EXPECT_BYTES,
  EXPECT_WEIGHT_SHA_PREFIX as EXPECT_SHA_PREFIX,
  WEIGHT_PATH as WEIGHT,
  verifyWeight,
} from './weights.mjs';
/** 判定「候选②可用」的 torch 来源特征。 */
const TORCH_SOURCE_MARK = 'pylibs\\torch-cu124';

/** 候选解释器（依序探测；① = 环境变量指定，② = 本仓自建 venv，③ = 邻居仓 venv）。 */
const CANDIDATES = [
  { tag: '①', label: '环境变量 LAYA_PY', exe: process.env.LAYA_PY ?? '', source: 'env' },
  { tag: '②', label: '本仓自建 venv', exe: 'D:/<repo>/.laya-venv/Scripts/python.exe', source: 'local-venv' },
  { tag: '③', label: '邻居仓 venv（跨项目耦合）', exe: 'D:/<other-repo>/experiments/venv/Scripts/python.exe', source: 'neighbor-venv' },
].filter((c) => c.exe !== '');

/** 探测用的 Python 片段（输出 JSON，避免解析人类可读文本）。 */
const PROBE = [
  'import inspect, json, sys',
  'out = {"executable": sys.executable, "python": sys.version.split()[0]}',
  'try:',
  '    import laya',
  '    out["laya_version"] = getattr(laya, "__version__", "N/A")',
  'except Exception as e:',
  '    out["laya_error"] = repr(e)',
  'try:',
  '    from laya import serve',
  '    out["create_app"] = str(inspect.signature(serve.create_app))',
  'except Exception as e:',
  '    out["serve_error"] = repr(e)',
  'try:',
  '    out["router_init"] = str(inspect.signature(laya.Router.__init__))',
  'except Exception as e:',
  '    out["router_error"] = repr(e)',
  'try:',
  '    out["load"] = str(inspect.signature(laya.load))',
  'except Exception as e:',
  '    out["load_error"] = repr(e)',
  'try:',
  '    import torch',
  '    out["torch_version"] = torch.__version__',
  '    out["torch_file"] = torch.__file__',
  '    out["cuda"] = bool(torch.cuda.is_available())',
  'except Exception as e:',
  '    out["torch_error"] = repr(e)',
  'print(json.dumps(out, ensure_ascii=False))',
].join('\n');

/** 产出的报告路径。 */
const REPORT = resolve('docs/预研/data/p0-env.md');


/** 探测一个解释器 ⇒ 返回结果对象（不抛异常，失败也记下来）。 */
function probe(candidate) {
  if (!existsSync(candidate.exe)) {
    return { ...candidate, ok: false, error: '解释器不存在' };
  }
  try {
    // ⚠️ 不用 `-I`（见文件头）；不经 shell ⇒ 无引号问题
    const out = execFileSync(candidate.exe, ['-c', PROBE], {
      encoding: 'utf8',
      shell: false,
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = JSON.parse(out.trim().split(/\r?\n/).pop() ?? '{}');
    return { ...candidate, ok: true, info: parsed };
  } catch (e) {
    return { ...candidate, ok: false, error: String(e.stderr ?? e.message).slice(0, 400) };
  }
}

const linesOut = [];
const push = (s = '') => linesOut.push(s);

push('# P0 环境自检（sidecar 预研 · 阶段 B）');
push('');
push(`> 生成时间：${new Date().toISOString()}`);
push('> 生成器：`tools/laya-sidecar/env-check.mjs`（三段：权重对拍 → 解释器探测 → 路线判定）');
push('');

// ---------- ① 权重对拍 ----------
push('## ① 权重对拍');
push('');
const verdict = await verifyWeight(WEIGHT);
const weightOk = verdict.ok;
push(`- 路径：\`${WEIGHT}\``);
if (verdict.bytes < 0) {
  push(`- ❌ ${verdict.detail}`);
} else {
  push(`- 字节数：**${verdict.bytes}**（期望 ${EXPECT_BYTES}）⇒ ${verdict.bytes === EXPECT_BYTES ? '✅' : '❌'}`);
  push(`- sha256：\`${verdict.sha256.slice(0, 16)}…\`（期望前缀 \`${EXPECT_SHA_PREFIX}\`）⇒ ${verdict.sha256.startsWith(EXPECT_SHA_PREFIX) ? '✅' : '❌'}`);
}
push('');

if (!weightOk) {
  push('## 结论');
  push('');
  push('- **对拍失败** ⇒ 不做后续任何探测（权重不对，后面的 API 面探测没有意义）。');
  push('- 退出码 1。');
  push('');
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, linesOut.join('\n'), 'utf8');
  console.log(linesOut.join('\n'));
  process.exit(1);
}

push('**对拍通过** ⇒ 继续探测解释器。');
push('');

// ---------- ② 候选解释器探测 ----------
push('## ② 候选解释器探测');
push('');
const results = CANDIDATES.map((c) => {
  const r = probe(c);
  push(`### 候选${r.tag} · ${r.label}`);
  push('');
  push(`- 解释器：\`${r.exe}\``);
  if (!r.ok) {
    push(`- ❌ 不可用：${r.error}`);
    push('');
    return r;
  }
  const i = r.info;
  push(`- python：${i.python ?? '?'}`);
  push(`- laya：${i.laya_version ?? '❌ ' + (i.laya_error ?? '未装')}`);
  if (i.create_app !== undefined) { push(`- \`serve.create_app\` 签名：\`${i.create_app}\``); }
  else { push(`- \`serve.create_app\` 签名：❌ ${i.serve_error ?? '不可用'}`); }
  if (i.router_init !== undefined) { push(`- \`laya.Router.__init__\` 签名：\`${i.router_init}\``); }
  else { push(`- \`laya.Router.__init__\` 签名：❌ ${i.router_error ?? '不可用'}`); }
  if (i.load !== undefined) { push(`- \`laya.load\` 签名：\`${i.load}\``); }
  else { push(`- \`laya.load\` 签名：❌ ${i.load_error ?? '不可用'}`); }
  if (i.torch_version !== undefined) {
    push(`- torch：${i.torch_version}`);
    push(`- torch 来源：\`${i.torch_file}\``);
    push(`- CUDA 可用：\`${String(i.cuda)}\``);
  } else {
    push(`- torch：❌ ${i.torch_error ?? '未装'}`);
  }
  push('');
  return r;
});

// ---------- ③ 路线判定 ----------
push('## ③ 路线判定');
push('');
const usable = results.filter((r) => r.ok);
const c2 = results.find((r) => r.tag === '②');
const c2Good = c2 !== undefined && c2.ok
  && String(c2.info?.torch_file ?? '').toLowerCase().includes(TORCH_SOURCE_MARK)
  && c2.info?.cuda === true;

let chosen = null;
let routeLabel = '不支持';
let coupling = false;
if (c2Good) {
  chosen = c2;
  routeLabel = '待定（见下方 API 面判据）';
} else if (usable.length > 0) {
  chosen = usable[0];
  coupling = chosen.source === 'neighbor-venv' || chosen.source === 'env';
}
if (chosen === null) {
  push('- ❌ **没有任何候选解释器可用** ⇒ P0 判定「环境不支持」。');
} else {
  push(`- 采用环境：\`${chosen.exe}\`（候选${chosen.tag} · ${chosen.label}）`);
  if (coupling) {
    push(`- ⚠️ **跨项目耦合**：采用的不是本仓自建 venv ⇒ 该环境的升级/破坏会影响本项目 ⇒ 须登记。`);
  }
  const i = chosen.info ?? {};
  const createApp = String(i.create_app ?? '');
  const routerInit = String(i.router_init ?? '');
  const loadSig = String(i.load ?? '');
  const aCond = (createApp !== '' && /router|agent/i.test(createApp))
    && (routerInit !== '' && /dir|path|cache|model|weight/i.test(routerInit));
  const bCond = loadSig !== '' && loadSig !== '()';
  push(`- A 路判据（create_app 首参接受 router/agent **且** Router 签名含本地目录/缓存路径参数）：\`${String(aCond)}\``);
  push(`  - create_app：\`${createApp || '（不可用）'}\``);
  push(`  - Router.__init__：\`${routerInit || '（不可用）'}\``);
  push(`- B 路判据（\`laya.load\` 能返回可用推理对象）：\`${String(bCond)}\``);
  push(`  - load：\`${loadSig || '（不可用）'}\``);
  if (aCond) { routeLabel = 'A'; push('- **launch 路线 = A**（官方 app 指向本地权重）'); }
  else if (bCond) { routeLabel = 'B'; push('- **launch 路线 = B**（官方 app 无法指向本地权重；只能自建推理层）'); }
  else { push('- **两者都不满足** ⇒ 结论「官方 app 无法指向本地权重」⇒ Task 12 不实现启动器；P1–P4 标「未跑：环境不支持」（**不得**改成自研推理层）。'); }
}
push('');
push('## 结论');
push('');
// Task 11 Step 3 要求的四行 —— **由脚本从实际探测值直接写出**（不手抄 ⇒ 无第二套口径）。
if (chosen === null) {
  push('采用环境=（无）');
  push('torch来源=（无）');
  push('CUDA可用=（无）');
  push('launch路线=不支持');
} else {
  const ci = chosen.info ?? {};
  push(`采用环境=\`${chosen.exe}\``);
  push(`torch来源=\`${String(ci.torch_file ?? '（未装 torch）')}\``);
  push(`CUDA可用=\`${String(ci.cuda ?? false)}\``);
  push(`launch路线=\`${routeLabel}\``);
}
push('');

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, linesOut.join('\n'), 'utf8');
console.log(linesOut.join('\n'));
console.log('');
console.log(`报告已写入 ${REPORT}`);
process.exit(usable.length > 0 ? 0 : 1);
