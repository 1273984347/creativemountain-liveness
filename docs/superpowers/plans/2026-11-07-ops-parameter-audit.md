# 《创界山·活人认证》ops 参数需求表

> 用途：B2 开工前的**参数盘点**（实施计划 §3 开工前动作）。
> 目标：把规格 §6.4 的算子表从「名字清单」变成「可直接写类型签名的参数契约」，
> 同时暴露「规格写了规则但 ops 表没有对应算子」的缺口。
> 对应规格：`docs/superpowers/specs/2026-11-07-creative-mountain-liveness-design.md` **v1.4**
> 盘点日期：2026-11-07
>
> **状态：11 项裁定已全部落地（v1.4，2026-11-07）。** 裁定摘要见文末 §15。B2 可直接按本文档 §13 的签名草案开工。

---

## 0. 结论摘要

| 项 | 数量 |
|---|---|
| 规格 §6.4 已登记算子 | **52** |
| 规格 §6.4 已登记谓词 | **13** |
| 终局目标 kind | **8** |
| **盘点中发现的规格缺口** | **7** |
| 需要新增算子（补缺口） | **5** |
| 需要新增谓词 | **2** |
| 需补算子参数或语义澄清 | **9** |

**最重要的一条**：§6.4 的算子表**不覆盖**规格中若干已写死的规则——包括「指令骰第 5 条按骰子点数移动」「对峙」「放置封路印」「改判」「造物/装备」「复活」「凭证」。B2 若照表实现，B4 写主题包时必然卡住。

---

## 1. 参数标记约定

| 标记 | 含义 |
|---|---|
| `T` | 需要 **target**（目标玩家）参数 |
| `T?` | target **可选**（缺省为效果使用者自己） |
| `T*` | target **必填且不能是自己** |
| `A` | 需要 **amount**（数量）参数 |
| `C` | 需要 **count**（次数/张数）参数 |
| `—` | 无参数 |

**作用域约定（全部算子默认遵守）**：

- 算子作用于**效果使用者自己**，除非显式给出 target。
- `target` 指向的玩家必须**存活**；指向已出局玩家视为无效操作（不生效，记日志）。
- `amount` / `count` 缺省为 **1**；传 0 视为无效操作；传负数**非法**（引擎抛错，主题包校验器拦截）。
- 每个算子返回 `{ ok, state, note? }`——效果因条件不满足而未生效时 `ok=false`，**状态不变**（与 §5.3.4 灵枢不足的语义一致）。

---

## 2. 资源类算子（4）

| 算子 | 参数 | 语义 | 规格依据 | 需澄清 |
|---|---|---|---|---|
| `gain_resource` | `A` | 自己灵枢 +amount，不超上限 10 | §4.3 | 触顶后溢出**丢弃**（不得超上限） |
| `spend_resource` | `A` | 自己灵枢 −amount；不足则 `ok=false` 状态不变 | §4.3、§5.3.4 | — |
| `transfer_resource` | `A` `T*` | 自己灵枢转给 target；自己不足则失败 | §4.1 窃火者 | 目标灵枢**也受上限 10 约束** |
| `set_resource` | `A` `T?` | 把某玩家灵枢**设为** amount（不叠加） | §6.4 | **不绕过上限**（clamp 到 0–10） |

---

## 3. 牌类算子（9）

| 算子 | 参数 | 语义 | 规格依据 | 需澄清 |
|---|---|---|---|---|
| `draw_cards` | `C` `T?` | target（缺省自己）抽 count 张；牌库空则洗回弃牌堆 | §3.1 步骤 6 | 两堆皆空 → `ok=false` |
| `gain_card` | `T?` `C?` + `filter` | 「获得指定类型手牌」（指令 13） | §3.2 第 13 条 | **缺 `filter` 语义**：需支持 `type`/`color`/`suit` 筛选 |
| `discard_self` | `C` `mode?` | 自己弃 count 张 | §3.2 第 8 条 | 弃哪些牌？需 `mode: 'any'｜'chosen'` |
| `discard_opponent` | `C` `T*` | target 弃 count 张 | §3.2 第 11 条 | — |
| `exhaust_card` | `cardId` `T?` | 移出游戏（不进弃牌堆） | §6.4 | State 需区分「弃牌堆」与「已耗尽」 |
| `peek_deck` | `C` | 看牌堆顶 count 张（不移出） | §4.1 观星者 | **定为顶 count 张** |
| `add_to_deck` | `cardIds` `T?` | 把指定牌加入牌库 | §6.4 | **定为加入牌库顶** |
| `remove_from_deck` | `cardIds` `T?` | 从牌库移除指定牌 | §6.4 | 牌不在库中 → `ok=false` |
| `swap_deck_top` | `C` | 牌库顶 count 张与弃牌堆交换 | §6.4 | — |

---

## 4. 位移类算子（6 + 1 新增）

| 算子 | 参数 | 语义 | 规格依据 | 需澄清 |
|---|---|---|---|---|
| `move_forward` | `A` `T?` | 前进 amount 格 | §3.2 第 6/9/17 条 | **越过峰顶** → clamp 在峰顶，不浪费剩余步数 |
| `move_backward` | `A` `T*` | 后退 amount 格 | §3.2 第 12 条 | 后退到 0 格以下 → **clamp 到 1** |
| `move_to_tile` | `tileIndex` `T?` | 移动到指定格 | §6.4 | tileIndex 为绝对格号 |
| `move_relative_to` | `A` `T*` | 相对某玩家移动 | §6.4 | 「远离」= **沿山道往后** |
| `swap_position` | `T*` | 与 target 交换位置 | §3.3 对峙 | — |
| `teleport` | `tileIndex` `T?` | 传送到指定格（跳过中间格） | §6.4 | **触发落格效果** |
| **`move_by_dice`（新增）** | `faces: 6` `T?` | 掷 faces 面骰并前进该点数 | §3.2 第 5 条 | **见缺口 G1** |

> `move_by_dice` 不是 `move_forward` 的别名——第 5 条的步数来自**运行时骰子结果**，而所有算子的参数都是 JSON 字面量。

---

## 5. 骰子类算子（5）

| 算子 | 参数 | 语义 | 规格依据 | 需澄清 |
|---|---|---|---|---|
| `extra_roll` | `C` | 额外获得 count 次掷骰机会 | §6.4 | **当回合内有效** |
| `reroll` | `C` | 重掷 count 次（覆盖原结果） | §6.4 | 与「改判」（§4.1 织梦者）是两回事 |
| `keep_die` | `C` | 保留 count 个骰子结果 | §6.4 | **保留 1 个回合** |
| `set_die_result` | `value` | 直接指定骰子点数 | §6.4 | **不需要 target**（不能改对手骰） |
| `roll_opponent` | `T*` | 让 target 掷骰并按结果结算 | §6.4 | **定为触发 target 的指令骰** |

---

## 6. 状态类算子（11）

| 算子 | 参数 | 语义 | 规格依据 | 需澄清 |
|---|---|---|---|---|
| `shield` | `A` `T?` | 获得 amount 点护盾（吸收伤害） | §4.1 守夜人 | **可叠加**，上限不限 |
| `poison` | `A` `T?` | 中 amount 层毒，每回合末扣体力 | §6.4 | 毒伤**不被护盾吸收** |
| `slow` | `A` `T?` | 减速：每回合少走 amount 格 | §6.4 | 与 `skip_turn` **可叠加** |
| `silence` | `A` `T?` | **封口**：amount 回合内不能使用牌/能力 | §2.2、§5.6 | 封口期间**能移动** |
| `skip_turn` | `A` `T?` | 跳过 amount 个回合 | §3.5 关隘失败 | — |
| `immunity` | `status` `A` `T?` | 免疫某类状态 amount 回合 | §3.2 第 15 条 | `status` 枚举**需定义** |
| `double_next_vote` | `T?` | 下一次投票票数翻倍 | §6.4 | — |
| `extra_signatures_required` | `A` `T?` | 待认证者所需签印 +amount | §6.4 | **临时加成，不改 §5.2 门槛公式** |
| `set_phase` | `value` | 设置全局阶段（`night`/`day`） | §3.2 天机牌 | — |
| `set_flag` | `flag` `value?` `T?` | 设置玩家标记 | §6.5 例（`passed_gate`） | flag 命名空间需统一 |
| `clear_flag` | `flag` `T?` | 清除玩家标记 | §6.4 | — |

---

## 7. 战斗类算子（4）

| 算子 | 参数 | 语义 | 规格依据 | 需澄清 |
|---|---|---|---|---|
| `damage` | `A` `T*` | 对 target 造成 amount 点伤害 | §3.4 险径 | **先扣护盾再扣体力** |
| `heal` | `A` `T?` | 恢复 amount 点体力 | §6.4 | 不超体力上限 |
| `compare_cards` | `cardId` `T*` | **对峙**：双方亮牌比颜色/点数 | §3.3 | 比较规则**内建在实现里**（红>黑 → A>2 → 全同平局）；两张牌公开留在场上至 round 末 |
| `disarm` | `T*` | 弃置 target 的装备/法宝 | §6.4 | — |

---

## 8. 投票类算子（4）

| 算子 | 参数 | 语义 | 规格依据 | 需澄清 |
|---|---|---|---|---|
| `vote_modifier` | `A` `T?` | 某玩家票数 ±amount | §4.1 仲裁者 | — |
| `extra_vote` | `A` `T?` | 额外获得 amount 票 | §4.1 仲裁者 | — |
| `cancel_vote` | `T*` | 取消 target 的一次投票（仲裁者否决） | §5.6 | — |
| `exempt_from_vote` | `T?` | 本次山议免于被放逐（**凭证**） | §5.6、§4.3 | 凭证为**公开信息**，使用后全场可见；耗 3 灵枢 |

---

## 9. 认证类算子（4）

| 算子 | 参数 | 语义 | 规格依据 | 需澄清 |
|---|---|---|---|---|
| `certify_extra_signer` | `A` | 本次认证所需签印 +amount | §6.4 | 只能作用于待认证者 |
| `certify_free_pass` | `T?` | 该玩家本次认证免于被质疑（**山主特权**） | §4.1 | **只在第一轮生效** |
| `certify_extra_round` | `A` | 本次认证额外增加 amount 轮 | §6.4 | 与 §5.2「最多 2 轮」的关系 → **不可超过 2 轮** |
| `certify_forbid_challenge` | `T?` | 该玩家本次认证**不可被质疑** | §6.4 | — |

---

## 10. 阵营与组合算子（5）

| 算子 | 参数 | 语义 | 规格依据 | 需澄清 |
|---|---|---|---|---|
| `spirit_wheel` | `source?` `T?` | 掷阵营轮，执行所属阵营的 `wheel` 效果 | §4.2、§3.2 第 20 条 | **见缺口 G7**：需区分主动掷轮与指令 20 触发 |
| `sequence` | `effects[]` | 顺序执行多个算子 | §6.4 | 遇 `ok=false` **继续执行并记录** |
| `conditional` | `pred` `then` `else?` | 条件成立执行 then，否则执行 else | §6.4 | — |
| `count` | `C` + `effect` | 重复执行 effect count 次 | §6.4 | — |
| `random_from_deck` | `C` `T?` + `filter?` | 随机取 count 张 | §6.4 | — |


---

## 11. 谓词参数需求表（13 + 2 建议新增）

| 谓词 | 参数 | 语义 | 备注 |
|---|---|---|---|
| `tile_kind` | `kind` `tileIndex?` | 当前所在格地形 == kind | 缺 tileIndex 时用当前位置 |
| `has_card` | `filter` | 拥有符合条件的牌 | filter 复用 `gain_card` 的 filter 结构 |
| `resource_at_least` | `A` | 灵枢 ≥ amount | — |
| `hand_count` | `C` `op` | 手牌数比较（≥/≤/==） | `op` 枚举需定义 |
| `is_pending_cert` | — | 该玩家是否处于待认证状态 | — |
| `phase_is` | `value` | 当前阶段 == value | — |
| `players_alive` | `C` `op` | 存活人数比较 | — |
| `card_type_is` | `type` | 存在指定类型的牌 | **作用域不明 → 见缺口 G6** |
| `identity_is` | `identityId` | 玩家身份 == id | — |
| `faction_is` | `factionId` | 玩家阵营 == id | — |
| `hp_at_least` | `A` | 体力 ≥ amount | — |
| `flag_set` | `flag` | 玩家持有某标记 | 配合 `set_flag`/`clear_flag` |
| `last_dice_even` | — | 上次掷骰为偶数 | 险径判定用 |
| **`dice_is_at_least`（新增）** | `A` `faces` | 掷骰结果 ≥ amount | **关隘试炼「掷指令骰 ≥ 15」必需 → G2** |
| **`card_color_is`（新增）** | `color` `source` | 指定牌颜色 == color | **险径颜色判定必需 → G3** |

---

## 12. ⚠ 盘点发现的 7 处规格缺口

这些是**规格已写死的规则，但 §6.4 的 ops 表没有对应算子/谓词**。B2 若照表实现，B4 写主题包时必然卡住。

### G1 · 指令骰第 5 条「掷 6 面骰并按点数前进」——缺「骰子点数作为参数来源」的机制

**规格原文**：§3.2 第 5 条「掷 6 面移动骰并按点数前进」。

**问题**：现有 `move_forward` 的 `amount` 是**静态常量**。第 5 条的步数由**运行时骰子结果**决定。所有算子的参数都是 JSON 字面量，无法表达「先掷骰、再把点数喂给另一个算子」。

**建议方案（择一）**：

- **方案 A（推荐）**：新增算子 `move_by_dice { faces: 6 }`，语义 = 掷 faces 面骰并前进该点数。**纯声明式，无需表达式**。
- 方案 B：引入参数引用语法 `{ amount: { $dice: 6 } }`——需要参数求值器，复杂度上升，且违反「不提供任意表达式求值」原则。

**推荐 A**：保持「参数是字面量」的纯数据约束，只加 1 个算子。

### G2 · 关隘试炼「掷指令骰 ≥ 15」——缺骰值比较谓词

**规格原文**：§3.5「掷指令骰 ≥ 15——失败则退 1 格并被封口」。

**问题**：现有谓词无法表达「本次掷骰结果 ≥ 15」。`last_dice_even` 只能判奇偶。

**建议方案**：新增谓词 `dice_is_at_least { amount, faces }`。失败分支用 `conditional` + `else` 表达「退 1 格并被封口」= `sequence([move_backward(1), silence(1)])`。

### G3 · 对峙与险径的颜色判定——缺颜色比较能力

**规格原文**：§3.3 对峙「先比颜色：红 > 黑；同色比点数：A 最大、2 最小」；§3.4 险径「翻开牌堆顶 1 张判定颜色」。

**问题**：`compare_cards` 是**动作算子**（两人对峙），但险径需要的是**单张牌的颜色判定**（读牌堆顶 → 判红/黑 → 分支）。现有算子无法表达这个。

**建议方案**：

- 新增谓词 `card_color_is { color, source: 'deckTop' | 'cardId' }`；
- 险径判定用 `conditional` 表达：红 → 安全；黑 → `sequence([damage(1), skip_turn(1)])`（体力 −1 且失去本回合剩余行动）；
- 对峙的**比较规则内建在 `compare_cards` 实现里**（红>黑 → A>2 → 全同平局），不需要额外谓词。

### G4 · 「放置封路印」——缺棋盘标记算子

**规格原文**：§3.4 裂隙「对手可花 2 灵枢在此放置「封路印」，持有者经过时需判定，失败则停 1 回合」；§4.3 支出「放置封路印 2」。

**问题**：现有算子全部作用于**玩家**，没有作用于**棋盘格位**的。`set_flag` 是玩家标记。

**建议方案**：新增算子 `place_barrier { tileIndex }`。经过判定逻辑属引擎内建（地形效果），不由 op 表达。

### G5 · 「改判」「造物/装备」「复活」「凭证」——4 个规格机制无对应算子

| 规格机制 | 出处 | 现状 | 建议 |
|---|---|---|---|
| **改判**（改一次判定结果，耗 2 灵枢） | §4.1 织梦者、§4.3 | `reroll` 是「重掷骰子」，语义不同 | 新增 `modify_judgement { target? }` |
| **造物 / 装备法宝** | §4.1 匠师、§4.1 装备目标 | 无装备系统 | 新增 `create_card` / `equip_card { cardId }`；State 加 `equipment` 字段 |
| **复活队友**（耗 4 灵枢） | §4.3 | 无 | 新增 `revive { target }` |
| **凭证**（耗 3 灵枢免疫放逐） | §5.6、§4.3 | `exempt_from_vote` 语义接近但未定义消耗与公开性 | **复用 `exempt_from_vote`**，补上「消耗 3 灵枢 + 公开可见」语义即可，不必新增 |

### G6 · `card_type_is` 谓词的作用域不明

**问题**：§6.4 列出 `card_type_is`，但未说明它检查**谁的什么牌**——自己手牌？对手手牌？牌堆顶？

**建议方案**：定义为「**效果使用者手牌**中是否存在指定类型的牌」，与 `has_card` 区分：`has_card` 支持完整 filter，`card_type_is` 是其简写。

### G7 · `spirit_wheel` 与「每局限 1 次」的归属

**问题**：§4.2 说阵营轮「每局限 1 次」，§3.2 第 20 条说指令 20 **不受此限制**。若 `spirit_wheel` 是唯一入口，引擎无法区分「主动掷轮」与「指令 20 触发」。

**建议方案**：`spirit_wheel` 增加参数 `{ source: 'manual' | 'command' }`：

- `source: 'manual'`（默认）→ 消耗「每局限 1 次」名额；名额已用尽则 `ok=false`；
- `source: 'command'`（指令 20）→ **不消耗名额，照常执行**。


---

## 13. 算子签名草案（`engine/ops/registry.ts` 的类型依据）

```ts
// 每个算子的参数类型 —— 参数一律为字面量，不含表达式求值
export interface OpRegistry {
  // 资源
  gain_resource:     { amount: number };
  spend_resource:    { amount: number };
  transfer_resource: { amount: number; target: number };
  set_resource:      { amount: number; target?: number };
  // 牌
  draw_cards:        { count: number; target?: number };
  gain_card:         { count?: number; target?: number; filter: CardFilter };
  discard_self:      { count: number; mode?: 'any' | 'chosen' };
  discard_opponent:  { count: number; target: number };
  exhaust_card:      { cardId: string; target?: number };
  peek_deck:         { count: number };
  add_to_deck:       { cardIds: string[]; target?: number };
  remove_from_deck:  { cardIds: string[]; target?: number };
  swap_deck_top:     { count: number };
  // 位移
  move_forward:      { amount: number; target?: number };
  move_backward:     { amount: number; target: number };
  move_to_tile:      { tileIndex: number; target?: number };
  move_relative_to:  { amount: number; target: number };
  swap_position:     { target: number };
  teleport:          { tileIndex: number; target?: number };
  move_by_dice:      { faces: 6; target?: number };          // ← G1 新增
  // 骰子
  extra_roll:        { count: number };
  reroll:            { count: number };
  keep_die:          { count: number };
  set_die_result:    { value: number };
  roll_opponent:     { target: number };
  // 状态
  shield:            { amount: number; target?: number };
  poison:            { amount: number; target?: number };
  slow:              { amount: number; target?: number };
  silence:           { amount: number; target?: number };
  skip_turn:         { amount: number; target?: number };
  immunity:          { status: StatusKind; amount: number; target?: number };
  double_next_vote:  { target?: number };
  extra_signatures_required: { amount: number; target?: number };
  set_phase:         { value: 'night' | 'day' };
  set_flag:          { flag: string; value?: unknown; target?: number };
  clear_flag:        { flag: string; target?: number };
  // 战斗
  damage:            { amount: number; target: number };
  heal:              { amount: number; target?: number };
  compare_cards:     { cardId: string; target: number };
  disarm:            { target: number };
  // 投票
  vote_modifier:     { amount: number; target?: number };
  extra_vote:        { amount: number; target?: number };
  cancel_vote:       { target: number };
  exempt_from_vote:  { target?: number };
  // 认证
  certify_extra_signer:    { amount: number };
  certify_free_pass:      { target?: number };
  certify_extra_round:     { amount: number };
  certify_forbid_challenge:{ target?: number };
  // 阵营
  spirit_wheel:      { source?: 'manual' | 'command'; target?: number };   // ← G7
  // 组合
  sequence:          { effects: Effect[] };
  conditional:       { pred: Predicate; then: Effect; else?: Effect };
  count:             { count: number; effect: Effect };
  random_from_deck:  { count: number; target?: number; filter?: CardFilter };
  // 棋盘（G4 新增）
  place_barrier:     { tileIndex: number };
  // G5 新增
  modify_judgement:  { target?: number };
  create_card:       { cardId: string; target?: number };
  equip_card:        { cardId: string; target?: number };
  revive:            { target: number };
}
```

**统一返回类型**：

```ts
export interface OpResult {
  readonly ok: boolean;      // 效果是否实际生效
  readonly state: State;      // 不可变新状态（ok=false 时与入参等价）
  readonly note?: string;     // 失败原因（写入日志）
}
```

---

## 14. B2 开工前的落地检查表

### 14.1 必须先定的（阻塞实现）

- [ ] **G1 移动骰方案**：采用 `move_by_dice`（推荐）还是参数求值器
- [ ] **G5 造物/装备语义**：`create_card` 是「把牌加入手牌」还是「造一张新牌」？`equip_card` 的装备从哪来（牌库？专门牌堆？）
- [ ] **G5 复活语义**：`revive` 把已出局玩家拉回局内？位置回起点？
- [ ] **`StatusKind` 枚举**：`immunity.status` 的取值范围
- [ ] **`CardFilter` 结构**：`type` / `color` / `suit` / `cost` 的可选组合
- [ ] **牌面点数排序**：`suit` 字段是否承载点数（A/K/Q/J/10…2）？对峙比较需要它

### 14.2 实现顺序建议

1. **组合器先行**：`sequence` / `conditional` / `count` —— 它们是其他算子的组合表达，先实现可避免每个算子都要测嵌套。
2. **无副作用算子**：`set_flag` / `clear_flag` / `set_phase` / `set_die_result` —— 纯状态写入，最易测。
3. **资源类**：`gain_resource` / `spend_resource` / `transfer_resource` / `set_resource` —— 涉及上限与失败语义。
4. **牌类**：`draw_cards` / `discard_self` / `discard_opponent` / `exhaust_card` —— 涉及牌库循环。
5. **位移类**：`move_forward` / `move_backward` / `move_to_tile` / `move_by_dice` / `swap_position` —— 涉及峰顶 clamp 与对峙。
6. **战斗与投票**：`damage` / `heal` / `compare_cards` / 投票四算子。
7. **认证与阵营**：`certify_*` 四算子 + `spirit_wheel`（含 G7 的 source 语义）。
8. **新增算子**：`place_barrier` / `modify_judgement` / `create_card` / `equip_card` / `revive`。

### 14.3 验收口径（承接实施计划 §3.2）

- [ ] 全部算子（含 5 个新增）注册完毕，`OpRegistry` 类型与本表**逐字段一致**
- [ ] 每个算子至少 1 个单测；组合器与失败路径（`ok=false`）**必须有单测**
- [ ] 每个算子的 `ok=false` 场景验证「状态不变」（不可变语义）
- [ ] 13 + 2 个谓词全部注册，各有单测
- [ ] 用一份覆盖全部 op 的**临时测试主题**跑通 `theme-validate`
- [ ] `getLegalActions()` 返回的每种 Action 都有对应枚举逻辑


---

## 15. 裁定落地记录（v1.4，2026-11-07）

本文档提出的 **11 项裁定全部已落定并写入规格 v1.4**，B1 的 `State` 与 `Card` 类型已按此回改。

| 编号 | 裁定 | 回流位置 | B1 改动 |
|---|---|---|---|
| G1 | `move_by_dice { faces: 6; target? }`，**不引入参数求值器** | 规格 §6.4 | 无 |
| G5 造物 | `create_card` 取自**独立造物牌堆** `decks.creation`（不凭空生成）；`equip_card` 移入手牌→`Player.equipment`，**不占手牌上限、公开可见、V1 无被动效果** | §6.4 / §6.5 / §6.7.1 / §4.1 | **`State.decks.creation` + `Player.equipment`** |
| G5 复活 | **V1 删除**「复活队友 4 灵枢」与 `revive` 算子（本作无死亡机制） | §4.3 / §13.3 | 无 |
| StatusKind | `NegativeStatus = 'poison' \| 'slow' \| 'silence' \| 'skip_turn'` | §6.4 | `engine/types/card.ts` |
| CardFilter | 五字段 AND（`type`/`color`/`suit`/`cost`/`cardId`），空 filter 匹配任意；**四个算子共用同一结构** | §6.4 | `engine/types/card.ts` |
| CardType | V1 固定四值 `'motion' \| 'attack' \| 'defense' \| 'utility'`（新增类型 = 改引擎） | §6.4 | `engine/types/theme.ts` |
| 点数排序 | **新增 `rank: number`（2–14，A=14）+ `rankLabel?`**，比较只读 rank 不解析字符串；`suit` 与 rank 正交 | §3.3 / §6.5 / §6.7.1 | **`Card` 加两字段** |
| 位移结算 | **分段结算，到达峰顶即终止后续位移**（到达即停，不最后一起 clamp） | §3.1 | 无（引擎逻辑，B2/B3 实现） |
| 行棋走满 | **不得选择少走**，掷 6 就走 6 | §3.1 | 无 |
| 待认证锁定 | 峰顶**不能主动移动**，唯一离开方式是判罚后退 | §5.1 | 无 |
| 跳到位 | 移动为**跳到位，只结算终点格**；不逐格触发 | §3.3 / §3.4 | 无 |
| B9 观察项 | 精准登顶（点数恰等于距离）+1 灵枢，**作为 B9 观察项，不现在改规则** | §11 风险表 | 无 |
