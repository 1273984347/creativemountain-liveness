// B75：否决权必须由主题数据授予（不得硬编码 identityId === 'arbiter'）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialState } from '../../engine/core/state.ts';
import { installTheme } from '../../engine/core/setup.ts';

const THEMES = ['xianxia2026', 'scifi-ai', 'hybrid', 'urban-psych'];

// ⚠️ 身份是**开局随机分配**的（8 个身份里只发出 4 个）⇒ 仲裁者可能不在场。
//   因此不能断言「每局都有人持权」，要按「在场才授予、且最多一人」判，并保证样本里至少出现一局仲裁者。
test('B75：四套主题的仲裁者声明 rights；开局只在仲裁者在场时授予 canVeto', () => {
  for (const id of THEMES) {
    const theme = JSON.parse(readFileSync(`themes/${id}/theme.json`, 'utf8'));
    const withRight = theme.identities.filter((i: { rights?: string[] }) => (i.rights ?? []).includes('council_veto'));
    assert.equal(withRight.length, 1, `${id}：必须恰好一个身份持有否决权`);
    assert.equal(withRight[0].id, 'arbiter', `${id}：否决权属于仲裁者`);

    let seenArbiter = false;
    for (let seed = 7; seed <= 30; seed += 1) {
      const s = installTheme(
        createInitialState({ players: 4, seed, deckSize: theme.counts.deckTotal }), theme);
      const holders = s.players.filter((p) => p.flags.canVeto === true);
      const arbiters = s.players.filter((p) => p.identityId === 'arbiter');
      if (arbiters.length === 0) {
        assert.equal(holders.length, 0, `${id}@${seed}：仲裁者不在场 ⇒ 无人持权`);
      } else {
        seenArbiter = true;
        assert.equal(holders.length, 1, `${id}@${seed}：恰一人持权`);
        assert.equal(holders[0]?.seat, arbiters[0]?.seat, `${id}@${seed}：持权者必须是仲裁者`);
      }
    }
    assert.equal(seenArbiter, true, `${id}：种子 7–30 内必须至少出现一局仲裁者`);
  }
});
