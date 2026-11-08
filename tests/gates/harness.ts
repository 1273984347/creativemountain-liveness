// 负样本框架：让每道门禁都留下「违例必红、恢复必绿」的常驻证据。
//
// 来源：GateKeeper《E1铁律》规则 2 —— 「新逻辑先跑负样本自测，再上全量；
// 负样本要求『违例必红、恢复必绿』」；绿洲 _gate.py 门⑥「体检器自测（负样本常驻化）」。
//
// 为什么需要它：把「人为制造一处漂移 → 必须判红」从验收清单里的一句话
// 变成**每次跑测试都在验的常驻用例**——否则门禁交付后没人会再验它。

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** 一次门禁执行的结果。 */
export interface GateRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout + stderr 合并文本，便于断言错误信息 */
  readonly output: string;
}

/**
 * 执行一个进程，**不经 shell、不经管道**。
 *
 * 三条纪律（均来自实测踩坑，不是理论）：
 *
 * 1. **管道会吞退出码** —— `cmd | head` / `2>&1 | tee` 会让退出码变成管道最后一个命令的，
 *    门禁会静默失效。这里直接 spawn，退出码直取。
 * 2. **Windows 上不能用 `shell:false` spawn `.cmd`** —— Node 24 对 `npm.cmd` 直接 spawn
 *    报 `EINVAL`（批处理文件必须经 cmd.exe）。因此门禁**直接跑底层工具**
 *    （node / tsc），不走 npm 包装层：既避开 EINVAL，也保证退出码是工具自己的。
 * 3. **在 test runner 内再 spawn 一个 test runner，必须清 `NODE_TEST_CONTEXT`** ——
 *    Node 用该环境变量向被驱动的子测试进程传递上下文；内层 `node --test` 继承后
 *    会误以为自己是「被指定文件」的子进程，于是**不扫 glob**。
 *    实测：注入一个必失败的测试文件后，内层仍返回 0 ⇒ 负样本**假绿**。
 */
export function runNode(args: readonly string[], opts: { readonly cwd?: string } = {}): GateRun {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(process.execPath, [...args], {
    encoding: 'utf8',
    shell: false,
    // ⚠️ B17：支持指定 cwd —— 负样本要在**隔离副本**里跑（就地改共享工作树会污染并行测试）。
    cwd: opts.cwd ?? process.cwd(),
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  return {
    code: res.status ?? -1,
    stdout,
    stderr,
    output: `${stdout}\n${stderr}`,
  };
}

/** 类型门禁：tsc --noEmit（直接跑 tsc，不经 npm）。 */
export function runTsc(): GateRun {
  return runNode([resolve('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit']);
}

/**
 * 类型门禁（指定 tsconfig）：用于**自包含**负样本——
 * 用独立 tsconfig + 独立目录，避免在工程目录里放探针文件
 * （并发跑的 tsc 会扫到它 ⇒ 负样本假红）。
 */
export function runTscIn(tsconfigPath: string): GateRun {
  return runNode([resolve('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '--project', tsconfigPath]);
}

/**
 * 测试门禁：node --test <glob...>（glob 交由 node 自己展开，不经 shell）。
 *
 * ⚠️ 支持**多个**位置参数：负样本有时需要「既有目录 + 一个显式探针文件」一起跑
 *   （探针不在 glob 覆盖范围内时，只能显式点名）。
 */
export function runNodeTest(glob: string | readonly string[]): GateRun {
  const globs = typeof glob === 'string' ? [glob] : glob;
  return runNode(['--test', ...globs]);
}
