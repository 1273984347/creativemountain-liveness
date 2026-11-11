# B75 · 装备与仲裁者否决：两个不可达目标的机制补齐 · 设计

> 批次：B75（推荐顺序第 1 项：机制 → 主题 → 模型）· 日期：2026-11-11
> 前置：B74 已出包；本批**只做机制**，不接模型（B78）、不新增主题（B77）、不做死亡/复活（B76）。

## 1. 立项证据（全部为实测）

| # | 事实 | 证据 |
|---|---|---|
| 1 | `equip_card` 算子**已实现**，把牌从手牌移入 `Player.equipment`（不占手牌上限、公开可见、无被动） | `engine/ops/registry.ts:762-775`；规格 §4.1 / §6.2 |
| 2 | 但**四套主题里零张牌使用 `equip_card`** ⇒ 装备在内容层永不发生 | `grep -rl equip_card themes/` 无命中 |
| 3 | `equipsTotal` 计数器**无任何写入方** ⇒ `equip_count` 目标恒不可达 | `grep -rn equipsTotal engine/` 只命中 `goals/registry.ts` 的判定 |
| 4 | `council.vetoUsed` 字段、`useCouncilVeto` 入口、`vetoCount` 写入方**全都不存在**；`resolveCouncil` 只有注释提到否决 | `engine/core/council.ts:104-160`（注释有、代码无）；`vetoUsed` 仅出现在 `flow.ts:52` / `setup.ts:205` / `state.ts:312` 的初始值 |
| 5 | `vetoCount` 无写入方 ⇒ `veto_success` 目标恒不可达 | `grep -rn vetoCount engine/` 只命中判定 |
| 6 | `settleImmediateGoals` **已存在**且已在「质疑判不通过」处接线（B61） | `engine/goals/settle.ts:106`；`certification.ts` 的 `certifyAnswer` |
| 7 | 山议的结算由 UI 显式按钮 / 模拟器显式调用驱动 ⇒ 存在「结算前」的窗口 | `web/ui/council.ts:82`（`结算山议`）；`tests/sim/policy.mjs` 的 `councilTurn` |

⇒ 结论：这两条不是「新玩法设计」，是**已登记机制缺失的接线**（B61 的 equip/veto 两项）；本批把入口、计数与目标判定链补齐。

## 2. 目标与非目标

**目标**

1. 新增动作 `EQUIP_CARD`：把一张手牌移入装备区，写 `equipsTotal`。
2. 新增动作 `COUNCIL_VETO`：持权者每局一次否决「本次放逐」，写 `vetoCount` 并触发即时目标结算。
3. 否决权**数据驱动**：身份字段 `rights` → 开局 `flags.canVeto`，不硬编码身份 id。
4. 枚举 / UI 门禁 / 探针 / 模拟器 AI 四层同步；漂移守卫全绿。
5. 两个目标从「恒不可达」变为**有实证可达**（定向测试 + 24000 局报告计数 > 0）。
6. 行为变更后的基线重标定（balance-report、门 ⑪/⑫/⑬、发布基线 B75）。

**非目标（明确不做）**

- 装备的被动效果 / 属性加成（规格写明 V1 无被动）。
- 否决的目标选择（只否决「本次放逐」的全部）；3 人局的扣灵枢裁定不受否决影响。
- `successful_challenge` 的其余接线（B61 已接，本批只顺带修正 `settle.ts` 顶部过时注释）。
- 死亡/复活（B76）、第 5 套主题（B77）、certify 模型接入（B78）。

## 3. 数据模型与契约

### 3.1 动作类型与 key 文法

`ActionType` 增加两个成员（17 → **19**），`Action` 联合同步：

```ts
| { readonly type: 'EQUIP_CARD'; readonly actor: number; readonly cardId: string }
| { readonly type: 'COUNCIL_VETO'; readonly actor: number }
```

`actionKey` 规范形（`engine/core/action-key.ts`）：

| 动作 | key | 反解校验 |
|---|---|---|
| `EQUIP_CARD` | `equip:<cardId>` | `cardId` 非空；多余尾段 / 空段抛错（复用 `need`） |
| `COUNCIL_VETO` | `council_veto` | 单段；带任何尾段抛错 |

> ⚠️ `council_veto` 用下划线单段，与既有的 `cert:...`/`gate:...` 冒号族不冲突；反解侧必须**逐字**只认这一形（B69 的教训：字符串头段判别式不受 tsc 穷尽检查保护）。
> ⚠️ 常驻守卫「每个 `ActionType` 成员都要有往返样本」必须同步：`SAMPLES` 21 → **23**。

### 3.2 否决权（数据驱动）

```ts
// engine/types/theme.ts
export type IdentityRight = 'council_veto';
export interface Identity { /* 既有字段 */ readonly rights?: readonly IdentityRight[]; }
```

- `setup.ts` 分配身份时：`rights.includes('council_veto')` ⇒ `flags.canVeto = true`（与 `extra_vote` 的授予同层；**不**按 `identityId` 硬编码——B10 的教训）。
- `tools/theme-validate.mjs`：`rights` 必须是数组、成员 ∈ `{'council_veto'}`；非法值报错。
  **软警告（不阻断）**：`passiveText` 含「否决」但 `rights` 不含 `council_veto`（或反之）⇒ 输出 warning，提示两处可能不同步。
- 四套主题的仲裁者身份：`rights: ['council_veto']`；`passiveText` 追加「每局可否决 1 次放逐」（规则书/IR 印这一句）。
- 权限**整局有效**；是否已用由 `council.vetoUsed` 记录（每局一次，跨回合共享）。

### 3.3 山议状态

`CouncilState` 增加一个字段：

```ts
/** 本局使用否决的座位（未使用为 null）。 */
readonly vetoBy: number | null;
```

初始值（`createInitialState`、`setup.ts`）与 `setup` 的 council 初始化同步；`loadGame` 读到旧存档缺该字段时按 `null` 处理（读取侧容错一处，不写迁移）。

### 3.4 计数器

- 装备成功：`bumpCounterOf(state, seat, 'equipsTotal', 1)`。
- **成功否决**：在「否决实际阻止了一次放逐」的结算点 `bumpCounterOf(state, vetoBy, 'vetoCount', 1)`。
- 两者都只经 `engine/core/counters.ts`，不手写加法。

## 4. 引擎行为

### 4.1 装备动作

**不新增第二入口**：装备走 `performAction` 的新分支 `'equip'`（与 `PLAY_CARD` 走 `'act'` 同款），实现逻辑直接写在 `engine/core/turn-runner.ts` 的 `case 'equip'` 里。

1. `player` 存在且存活；2. `cardId` 在该玩家手牌中；3. 关隘 / 裂隙阻塞时**拒绝**——理由**不是**「装备含位移」，而是规格 §3.5 / §3.4：到达未通过的关隘 / 可放印裂隙时**该手番已暂停**（通道选择属**结算阶段**，不是行动阶段）⇒ 本回合的行动已在「到达」时用掉，不能再装备。
   ⚠️ 因此 `equip` 分支必须位于 `performAction` 开头那两条早退（`pendingGate` / `pendingBarrier`）**之后**，与 `move` / `ask` / `act` 同层；**不得**把它提前到早退之前（那会变成同一手番的第二次行动，绕过关隘暂停）。
4. 效果：`hand` 去掉该牌、`equipment` 追加该牌；`equipsTotal +1`；日志 `kind: 'equip'`（`LogEntry.kind` 是 `string`，不是封闭联合）。
5. 装备**不占用**手牌上限（`equipment` 不在 `discardDownToLimit` 的计数范围）。
6. **待认证锁定下允许**（装备不是位移；`act` 分支只拦含位移的牌，`equip` 分支不查 `pendingCert`）。

`performAction` 的 action 参数联合由 `'move' | 'ask' | 'act'` 扩为 `'move' | 'ask' | 'act' | 'equip'`；`'equip'` 只接受 `{ cardId }`，缺失即引用相等拒绝（与 `'act'` 缺 `cardId` 同款，探针语义不变）。

### 4.2 否决动作

新增 `useCouncilVeto(state, seat)`（`engine/core/council.ts`）：

1. 校验：`council.resolved === false`；`seat` 存活；`flags.canVeto === true`；`council.vetoUsed === false`；**所有存活玩家都已投票**（判据：`state.players.filter(p => p.alive).every(p => council.votes[p.seat] !== undefined)`；**不要**用「票数 ≥ 存活数」——死亡玩家的旧票会残留在 `votes` 里，那个判据会提前放行）。
   ⚠️ 「投完票之后」是**硬前置**：否决的语义是「否决**本次**放逐」，必须先看到本次投票结果；这同时消除了「投票未结束但结果已定」的中间态。
2. 效果：`{ ...council, vetoUsed: true, vetoBy: seat }`；日志「仲裁者否决（每局 1 次）」。
3. **此时不写 `vetoCount`**（见 4.3）：否决是「使用」，是否「成功」要到结算才知道。
4. **不自动结算**：山议仍由既有入口关闭（UI「结算山议」按钮 / 模拟器 `resolveCouncil`）。此时状态是明确的「投票已完、否决已用、尚未结算」，不存在歧义。

### 4.3 山议结算

`resolveCouncil` 在 4 人及以上分支、计算完 `tops` 与下限/凭证后：

- 若 `council.vetoUsed` 且 `tops.length > 0`（**本会有人被放逐**）：
  - 清空 `exiled`；`vetoCount +1`（给 `vetoBy`）；随后 `state = settleImmediateGoals(state)`
    （⚠️ **全局结算**：检查**所有玩家**的即时目标，不只否决者）；
  - 返回消息「山议裁定：仲裁者否决，本次无人被放逐」。
- 若 `council.vetoUsed` 但本来就不会放逐（`tops` 为空 / 触下限 / 全员凭证）：
  - 照常结算；**不加计数**；消息注明「（否决已耗尽，本次未阻止放逐）」。
- 3 人局分支（扣灵枢）**不受否决影响**。

> **实现顺序（必须照此，否则即时目标会判在错误的状态上）**：
> ① 计算 `tops` 与 `exiled`（含下限/凭证）；② 若否决生效 ⇒ 清空 `exiled`；③ **更新 `players`**（放逐、清 `hasMark` 等既有逻辑不变）；
> ④ 写 `vetoCount`（否决实际阻止放逐时）；⑤ 在**更新后的最终状态**上调用 `settleImmediateGoals`。
> ⚠️ 不要把 ⑤ 提前到 ③ 之前：`settleGoals` 会跳过已出局者；顺序反了会让「本应被放逐、但因否决留下」的人拿不到印记，或让「被放逐者」先拿印记再被清掉（日志/计数噪声）。

### 4.4 探针分派

`engine/core/probe.ts` 的 switch 增加：

```ts
case 'EQUIP_CARD': return byRef(performAction(s, action.actor, 'equip', { cardId: action.cardId }), s);
case 'COUNCIL_VETO': { const r = useCouncilVeto(s, action.actor); return byFlag(r.ok, r.note, r.state, s); }
```

装备用 `byRef`（与 `PLAY_CARD` 同款：引用相等 = 拒绝）；否决用 `byFlag`（`useCouncilVeto` 返回 `{ ok, note, state }`，与 `castVote` 同款）。

## 5. 枚举与 UI 门禁

### 5.1 引擎枚举 `engine/core/legal.ts`

- `actionPhaseCandidates` 正常窗口：每张手牌追加一条 `EQUIP_CARD`（紧邻 `PLAY_CARD` 之后）。
- 待认证锁定分支：每张手牌追加一条 `EQUIP_CARD`（**不限位移**——装备不产生移动）。
- `councilCandidates`：当 `council.resolved === false`、`flags.canVeto === true`、`!vetoUsed`、且**所有存活玩家都已投票**（同 4.2 的 `every` 判据）时追加一条 `COUNCIL_VETO`。
- 候选上限 `LEGAL_ACTION_CAP=64` 不变；`wideHandScene` 的「正好撞上限」用例若因新增候选改变行为，按新形状更新该用例（只允许改断言数据，**不得**放宽上限）。

### 5.2 UI 门禁 `web/legal-gate.ts`（独立实现，不 import 枚举）

- `uiCandidates`：与 5.1 逐条同形（正常面 / 锁定面 / 山议面）。
- `uiBlockNotice`：
  - `EQUIP_CARD`：窗口拒因（行动阶段/存活/非关隘/非裂隙/本轮未完）；牌不在手 →「手牌里没有这张牌」；**不查费用**（装备免费）。
  - `COUNCIL_VETO`：非进行中 →「山议未在进行中」；无 `canVeto` →「你没有否决特权」；已用 →「本局否决已使用」；已出局 →「你已出局」；**未投完票** →「等待所有玩家投票后才能使用否决」。
- 三层漂移守卫（枚举层 / 候选层 / 判定形状层）必须全绿；新增动作在 `driftScenes` 的山议/锁定/行动场景里**有对象**（否则守卫是空集）。

## 6. UI 交互

- 行动面板：当 `uiCandidates` 含任一 `EQUIP_CARD` 时，显示「装备手牌」切换按钮；开启后手牌点击走装备（`performAction(s, seat, 'equip', { cardId })` + `advanceTurn`）。模式在提交后 / 局面变化 / 取消时复位。
- 山议面板：当 `uiAllows(COUNCIL_VETO)` 为真时（**所有存活玩家投完票之后**），显示「使用否决（每局 1 次）」按钮；点击调用 `useCouncilVeto` 并重渲染（**不**自动结算）。已用后按钮消失，显示「本局否决已使用」；投票未完成时不显示（或置灰并给 5.2 的拒因）。
- 待认证锁定下：装备切换按钮**降级**到「其他操作」一行，并附提示「等待认证时仍可装备手牌」，不与签印/质疑/复议面板抢主视觉。
- 拒因一律走 `uiBlockNotice`（拒绝不沉默，R-2）。

## 7. AI / 模拟器（`tests/sim/policy.mjs`）

- **装备**：在 `roll >= 0.85`（本来要出牌）分支里，若 `goalOf` 的 `kind === 'equip_count'`、`equipsTotal < count`、**手牌数 ≥ 2**，且 `roll < 0.925`（把 0.85–1.0 的出牌带**二分**）⇒ 改走 `equip`（否则照常出牌）。
  - ⚠️ **不额外调用 `s.rng.next()`**：`Rng.next()` 是**可变**的（`engine/core/dice.ts:21`），多抽一次会改变整条随机流；用同一个 `roll` 二分 ⇒ 随机流零扰动。
  - **装备哪张**：取「按 `pickPlayableCard` 的排序**最不需要打出**的一张」——即先用同款排序取最小优先级者，避免把关键牌（唯一位移/唯一能打的牌）装备掉；手牌只有 1 张时不装备。
  - ⚠️ 多消耗一次 `rng.next()` ⇒ 随机流改变，属**有意的行为变更**（重标定）。
- **否决**：`councilTurn` 先让所有存活玩家投票，然后（`resolveCouncil` 之前）：若存在存活、`canVeto`、`!vetoUsed` 的玩家，且 `topVoted(s)` 含该玩家 ⇒ 调用 `useCouncilVeto`（自保语义；确定性，保证 `veto_success` 可达），再 `resolveCouncil`。
- 其它身份/其它时机不使用否决（不浪费每局一次的特权）。

## 8. 平衡与重标定

行为变更点：① `equip_count` 身份的出牌分布改变；② 仲裁者被最高票时改为「无人被放逐」。⇒ 按 B72/B74 的流程：

1. 重生成 `docs/balance-report.md`（默认参数，24000 局）。
2. 复核门 ⑪（关隘试炼通过率）、门 ⑫（位次极差回归锁，阈值不变，实测值更新）、门 ⑬（离线数据，不动）。
3. 按 B35 流程更新发布基线：`docs/baselines/trial-reserve-scan-B75.json` + `release-check` / `compare-scan-baseline` 默认路径 + 批次记录留痕；B74 快照保留。
4. 报告「目标达成」表里 `equip_count` / `veto_success` 的达成次数**必须 > 0**（旧报告为 0）；否则本批不算完成（机制虽接线但不可达）。
5. 报告生成器 `tests/sim/run.mjs` 里「equip_count 与 veto_success 恒为 0 —— 不是漏写计数器，而是机制缺失」的**静态注记**必须改掉（B75 起机制已补齐）；旧数字保留在批次记录里。

## 9. 测试清单（全部进 `npm test`）

| 文件 | 用例 |
|---|---|
| `tests/engine/action-key.test.ts` | `SAMPLES` 加 2 条（`equip:c_x`、`council_veto`）。**注释写死**：23 是当前样本总数，**不等于** ActionType 成员数；根因守卫按「每个成员都有样本」覆盖，不按总数 |
| `tests/engine/action-contract.test.ts` | ActionType 成员数/清单更新；`EQUIP_CARD` / `COUNCIL_VETO` 形状与 `performAction`/`useCouncilVeto` 对齐 |
| `tests/engine/equip.test.ts`（新） | 手牌→装备、`equipsTotal+1`、不占手牌上限、牌不在手拒绝、锁定下允许、关隘/裂隙拒绝 |
| `tests/engine/council-veto.test.ts`（新） | 无资格拒绝、每局一次、否决后无人被放逐、`vetoCount+1`、3 人局不受影响、提前使用但无放逐 ⇒ 不加计数、否决后即时目标发印记 |
| `tests/engine/goals-reachability.test.ts`（新） | `equip_count` / `veto_success` 定向场景达成并发**印记**（`hasMark` = 玩家持有【印记】标记，规格 §4.1；持印记者签印门槛减半） |
| `tests/engine/legal-probe.test.ts` | 枚举发 `EQUIP_CARD` / `COUNCIL_VETO`；非持权者不发；锁定态发装备；三层漂移守卫全绿；正向一致性（枚举的每条都被引擎接受） |
| `tests/engine/state-contract.test.ts` | `council.vetoBy` 默认 null；旧存档缺字段读取为 null |
| `tests/gates/sim-record.test.ts` | 记录器写出的新动作 key 可严格往返（既有守卫自动覆盖） |
| `tests/gates/parity-*.test.ts` / `ir-validate` 相关 | `rights` 进入 IR 后，theme↔IR 的 `rights` 一旦不同步 ⇒ 门⑥ 红（本批新增字段的负样本：删掉 theme 的 `rights` 但 IR 保留 ⇒ 必红） |

## 10. 门禁影响

| 门 | 影响 |
|---|---|
| ① 语法与类型 | `ActionType`/`Action`/`Identity`/`CouncilState` 改动必须 0 错 |
| ② 单元与门禁自检 | 上表用例 + 漂移守卫 |
| ⑤ 主题包校验 | `rights` 白名单；四套主题的仲裁者加字段 |
| ⑥ IR 契约 | `passiveText` 变更随主题包派生，需重生成 IR/规则书。**`rights` 必须进入 IR**：`build-ir.mjs` 的 identities 增加 `rights`（透传 `theme.json`），`parity-check.mjs` 的主比对增加 `rights` 逐项比较，`ir-validate.mjs` 增加 theme↔IR 的 `rights` 一致性检查 ⇒ 特权变更若忘改 IR，门⑥ 直接红（不再靠人工纪律） |
| ⑪ / ⑫ | 行为变更后重跑，阈值不动；⑫ 实测值更新到注释 |
| ⑬ | 离线数据与 B34 快照不动，应保持 PASS |
| 发布检查 | 基线更新为 B75（按 B35 流程），逐组比对 100/100 |

## 11. 交付物

- 代码：`engine/core/action.ts`、`action-key.ts`、`turn-runner.ts`（`'equip'` 分支）、`council.ts`（`useCouncilVeto` + 结算否决）、`legal.ts`、`probe.ts`、`state.ts`/`flow.ts`/`setup.ts`（`vetoBy`）、`types/theme.ts`（`rights`）、`tools/theme-validate.mjs`、`engine/types/ir.ts`（IR 身份字段契约 + `rights`）、`build/build-ir.mjs`（`rights` 透传）、`tools/parity-check.mjs`（`rights` 比较）、`tools/ir-validate.mjs`（`rights` 一致性）、四套 `themes/*/theme.json`、`web/legal-gate.ts`、`web/main.ts`、`web/ui/council.ts`、`web/ui/hand.ts`、`tests/sim/policy.mjs`。
- 测试：第 9 节 8 个文件（含 3 个新建）。
- 文档：主规格 §4.1（仲裁者特权）/ §5.6（否决结算）/ §6.2（身份字段）/ §6.3（动作表）/ §6.4（目标与计数器）/ §6.7.1（IR 身份字段增加 `rights`）/ §9.3（parity 主比对字段白名单增加 `rights`）；README 的「动作契约」与身份说明；`docs/沉淀/经验教训索引.md` 追加一条（「机制缺失分三环：入口 → 写入 → 判定；本批把入口与写入补齐时才暴露 `settleImmediateGoals` 的接线点」）；批次记录 `docs/批次/B75-装备与否决机制补齐-执行记录.md`；批次导航 +1。
- 基线：`docs/balance-report.md`、`docs/baselines/trial-reserve-scan-B75.json`、`release-check` 默认路径。

## 12. 完成定义

- [ ] `node tools/gate.mjs` 末行 `== PASS：13 门全绿 ==`。
- [ ] `docs/balance-report.md` 的目标表里 `equip_count` 与 `veto_success` 达成次数 **均 > 0**；异常 0。
- [ ] `npm run release` 的逐组比对 **100/100**（B75 基线）。
- [ ] `npm test` 全绿；`npm run typecheck` 0 错；`doc-sync` 10/10。
- [ ] 三层漂移守卫、action-key 往返守卫、正向一致性守卫全绿。
- [ ] 工作树干净（除既有忽略项）。**`dist/` 判据更正**：`dist/` 被 `.gitignore:3` 忽略（`git check-ignore -v dist` 可证）⇒ `git status --short dist/` 恒为空、**不能**作为「发布包零增量」的证据；本批的等价判据是：① `esbuild.config.mjs` / `build/build-package.mjs` 对 `tools/**` 零命中；② `npm run release` 的发布包成功生成（`dist/发布包/` 数字轨 + 4 套实体件）。

## 13. 风险与登记

| # | 风险 | 处置 |
|---|---|---|
| R1 | 否决「白用」（全投完后仍无人可放逐） | 规则明确：使用即消耗，**成功阻止放逐才计数**；UI 文案说明「若本次无人可放逐，否决仍会耗尽」 |
| R2 | 装备分支改变出牌带的行为分布 | 用同一个 `roll` 二分（不额外抽随机数）⇒ 随机流零扰动；行为变更仍随本批重标定，报告注明 |
| R3 | 候选增多触及 `LEGAL_ACTION_CAP` | 上限不动；更新「撞上限」用例的断言数据 |
| R4 | 旧存档缺 `vetoBy` | 读取侧容错为 null；不写迁移 |
| R5 | `settle.ts` 顶部注释称即时目标「无生产调用点」已过时（B61 已接质疑侧） | 本批顺手更正注释，不改行为 |
| R6 | 仲裁者被动文本与 `rights` 两处描述可能漂移 | `passiveText` 是印刷文本、`rights` 是机器判据；**门禁保障**：`rights` 进 IR + parity-check 逐项比较 ⇒ 机器可抓；主题校验只做**软警告**（文本含「否决」而 rights 缺，或反之），不引入第二事实源 |
