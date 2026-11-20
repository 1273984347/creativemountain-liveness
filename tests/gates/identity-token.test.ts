// B80 R9：`{identity:N}` 的**座位可解析性**常驻判据（规格 §3 R9）。
//
// R1/R1'' 只证明源码没写死人名，R3 只证明别套名字没串进来。这条管的是第三种失效：
// 占位符里的座位号 N 在**当前这局**到底解不解得出来——解不出来时必须抛，不许把
// `{identity:3}` 印给玩家（B78 页脚假话的同族：静默降级比当场炸危险）。
//
// ⚠️ 为什么光靠真局采样不够：24 局未必触发全部 8 个句子（越界与查无此人更是真局里
//   不该发生的形状），所以另加两条**单元级反向钉**（R9②③）。反过来，光有单测也不够——
//   那只能证明函数会抛，不能证明真局的座位号落在有效区间内。两类各有对方看不见的盲区。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { installTheme } from '../../engine/core/setup.ts';
import { mk } from '../engine/fixtures.ts';
import { logLineText } from '../../web/ui/log.ts';
import { identityName, termExpander } from '../../web/ui/terms.ts';
import { stateFromJson } from '../../engine/core/serialize.ts';
import { playOne, setRecorder, type DecisionRecord } from '../sim/policy.mjs';
import type { LogEntry, State } from '../../engine/core/state.ts';
import type { ThemePack } from '../../engine/types/theme.ts';

const IDS = ['xianxia2026', 'hybrid', 'scifi-ai', 'urban-psych'];
const themeOf = (id: string): ThemePack =>
  JSON.parse(readFileSync(resolve('themes', id, 'theme.json'), 'utf8')) as ThemePack;

/** 采样与 R3 同一路子（验收 9 的口径）：四套 × 人数档 {3,4,5} × 每档 2 局 = 24 局。 */
const PLAYER_COUNTS = [3, 4, 5];
const GAMES_PER_ARM = 2;
const seedOf = (g: number, players: number): number => 20260 + g * 31 + players * 7;

test('R9①：四套 × 24 局的每条 {identity:N} 日志都能解析成本套身份名（出口级，不留花括号）', async () => {
  let sampledGames = 0, identityLines = 0, seatsSeen = new Set<string>();
  for (const id of IDS) {
    const theme = themeOf(id);
    const names = new Set(theme.identities.map((i) => i.name));
    for (const players of PLAYER_COUNTS) {
      for (let g = 0; g < GAMES_PER_ARM; g += 1) {
        // ⚠️ `playOne` 返回的不是终局 State（它是仿真驱动）⇒ 照 B79 T14 的既有做法：
        //   setRecorder 收决策记录，取其中**日志最长**的那份状态当样本。
        const bag: DecisionRecord[] = [];
        setRecorder(bag);
        try { await playOne(theme, players, seedOf(g, players)); } finally { setRecorder(null); }
        assert.ok(bag.length > 0, `${id}/${String(players)} 人：一个决策点都没记录 ⇒ 真局没跑，前提不成立`);
        sampledGames += 1;
        let state: State | null = null;
        for (const r of bag) {
          const s = stateFromJson(r.state);
          if (state === null || s.log.length > state.log.length) { state = s; }
        }
        const sRef = state as State;
        for (const entry of sRef.log) {
          if (!entry.message.includes('{identity:')) { continue; }
          // 走**出口**而不是只过 `expandIdentityNames`：样本行里常同时含 `{hazard}` 一类词表占位符
          //（`turn-runner.ts:67` 就是 `{identity:N}改写了{hazard}判定`），只过一类展开必然还剩花括号。
          const shown = logLineText(entry, theme.terms, (seat) => identityName(sRef, theme, seat));
          assert.equal(/\{/.test(shown), false, `${id}：展开后残留占位符 ⇒ ${shown}`);
          for (const m of entry.message.matchAll(/\{identity:(\d+)\}/g)) {
            const seat = Number(m[1]);
            const name = identityName(sRef, theme, seat);
            seatsSeen.add(`${id}:${String(seat)}`);
            assert.ok(names.has(name), `${id}：座${String(seat)} 解析出「${name}」不在本套身份表 ⇒ 词表与身份表漂移`);
            assert.ok(shown.includes(name), `${id}：座${String(seat)} 的名字没进最终句子 ⇒ ${shown}`);
            identityLines += 1;
          }
        }
      }
    }
  }
  assert.ok(sampledGames === IDS.length * PLAYER_COUNTS.length * GAMES_PER_ARM,
    `采样应写死 ${String(IDS.length * PLAYER_COUNTS.length * GAMES_PER_ARM)} 局，实际 ${String(sampledGames)} 局`);
  assert.ok(identityLines > 0, '防空转：24 局里一条 {identity:N} 都没有 ⇒ 接线没生效，本条判据是空的');
  // 覆盖面的一部分：越界之外的"每个座位都被解过"做不到（24 局未必触发 8 个句子），
  // 但至少要看见多个不同座位号，否则等于只测了一个人。
  // T6 实测现值 **12**（四套 × 平均 3 座），下限钉 8 = 允许采样波动但不许塌成一个座位。
  assert.ok(seatsSeen.size >= 8, `24 局只解出 ${String(seatsSeen.size)} 个「主题×座位」组合 ⇒ 覆盖面不足`);
  console.log(`      R9① 抽样 ${String(sampledGames)} 局 · ${String(identityLines)} 条称谓日志 · ${String(seatsSeen.size)} 个主题×座位组合`);
});

test('R9②：座位越界 ⇒ 抛错（不静默把 {identity:9} 印给玩家）', () => {
  const theme = themeOf('scifi-ai');
  const state = installTheme(mk(4, 20260), theme);
  const t = termExpander(theme.terms, (seat) => identityName(state, theme, seat));
  assert.throws(() => t('{identity:9} 发言'), /没有 9 号座位/);
  // 出口级同形：日志出口也必须把这道抛穿出来，而不是在中间某层被吞
  const entry = { kind: 'council', round: 1, turnIndex: 0, actor: 0, message: '{identity:9} 发言' };
  assert.throws(() => logLineText(entry, theme.terms, (seat) => identityName(state, theme, seat)),
    /没有 9 号座位/, '⇒ 出口吞掉错误 = 玩家看到裸占位符');
});

test('R9③：identityId 在主题身份表里查无此人 ⇒ 抛错（数据写坏不许退化成 id 字符串）', () => {
  const theme = themeOf('xianxia2026');
  const base = installTheme(mk(4, 20260), theme);
  const broken: State = {
    ...base,
    players: base.players.map((p, i) => (i === 0 ? { ...p, identityId: 'identity_ghost' } : p)),
  };
  assert.throws(() => identityName(broken, theme, 0), /查无此人/);
  const t = termExpander(theme.terms, (seat) => identityName(broken, theme, seat));
  assert.throws(() => t('山议裁定：{identity:0} 否决'), /查无此人/);
});

test('R9④：负样本自证——同一个出口拿到坏座位号必须打红（否则 ①②③ 都是空判据）', () => {
  const theme = themeOf('hybrid');
  const state = installTheme(mk(4, 20260), theme);
  const nameOf = (seat: number): string => identityName(state, theme, seat);
  // 逐条用同一个入口，只是把座位号换好/换坏：合法过、越界红、畸形红——三条只差一个实参，
  // 所以红不是因为环境坏了（`exactOptionalPropertyTypes` 下也别去 spread 真局条目，直接构造）。
  const entry = (message: string): LogEntry =>
    ({ kind: 'council', round: 1, turnIndex: 0, actor: 0, message });
  const okShown = logLineText(entry('{identity:0} 发言'), theme.terms, nameOf);
  assert.equal(/\{/.test(okShown), false, `合法句子反而没过出口：${okShown}`);
  assert.throws(() => logLineText(entry('{identity:77} 发言'), theme.terms, nameOf), /没有 77 号座位/);
  assert.throws(() => logLineText(entry('{identity:} 发言'), theme.terms, nameOf), /格式非法/,
    '⇒ 缺座位号报"格式非法"而不是"查无此人"：两种失败的定位信息不一样');
});
