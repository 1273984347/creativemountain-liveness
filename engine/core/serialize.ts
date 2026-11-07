// 存档编解码（规格 §6.6：存档导出/导入）。
//
// State 含 `Rng` **类实例**（有内部私有状态），不能直接 JSON 序列化。
// 编码时把 Rng 拆成 `{ initialSeed, snapshot }`，解码时还原。

import { Rng } from './dice.ts';
import type { State } from './state.ts';

/** 存档信封版本（未来结构变化时可迁移）。 */
export const SAVE_VERSION = 1;

/** 编码后的 State（可 JSON 序列化）。 */
export interface SerializedState {
  readonly version: number;
  readonly seed: number;
  readonly rng: { readonly initialSeed: number; readonly snapshot: number };
  readonly state: Omit<State, 'rng'>;
}

/** 编码：State → 可 JSON 序列化的对象。 */
export function serializeState(state: State): SerializedState {
  const { rng, ...rest } = state;
  return {
    version: SAVE_VERSION,
    seed: state.seed,
    rng: { initialSeed: rng.initialSeed, snapshot: rng.snapshot() },
    state: rest,
  };
}

/** 解码：对象 → State（含 Rng 还原）。 */
export function deserializeState(data: unknown): State {
  if (data === null || typeof data !== 'object') {
    throw new Error('存档数据不是对象');
  }
  const obj = data as { version?: unknown; rng?: unknown; state?: unknown };
  if (obj.version !== SAVE_VERSION) {
    throw new Error(`存档版本不匹配：期望 ${SAVE_VERSION}，实际 ${String(obj.version)}`);
  }
  const rngRaw = obj.rng as { initialSeed?: unknown; snapshot?: unknown } | undefined;
  if (rngRaw === undefined || typeof rngRaw.initialSeed !== 'number' || typeof rngRaw.snapshot !== 'number') {
    throw new Error('存档缺少随机源信息');
  }
  if (obj.state === null || typeof obj.state !== 'object') {
    throw new Error('存档缺少状态数据');
  }
  const { rng: _ignored, ...rest } = obj.state as State;
  // 兼容旧档（B10 之前无 turnOrder）⇒ 按座位序补
  const turnOrder = Array.isArray(rest.turnOrder) && rest.turnOrder.length > 0
    ? rest.turnOrder
    : rest.players.map((p) => p.seat);
  // 兼容旧档（B11 之前无 liveSeats）⇒ 补空表（席位制下等同于「一席未得」）
  const liveSeats = rest.liveSeats ?? {};
  return { ...rest, turnOrder, liveSeats, rng: Rng.fromSnapshot(rngRaw.initialSeed, rngRaw.snapshot) };
}

/** 序列化为 JSON 文本。 */
export function stateToJson(state: State): string {
  return JSON.stringify(serializeState(state), null, 2);
}

/** 从 JSON 文本还原。 */
export function stateFromJson(text: string): State {
  return deserializeState(JSON.parse(text) as unknown);
}
