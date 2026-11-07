// 主屏原型 mock 数据。字段完全对齐 types.ts 的 GameState（Phase D 自检 4.4）。
// 引擎真实 State 更复杂；此处仅取主屏显示所需子集，供 4 个 flow 离线可交互。
import type { BoardTile, GameState, PlayerState } from './types'

function buildTiles(peakIndex: number, positions: Record<number, number[]>): BoardTile[] {
  const kindAt = (i: number): BoardTile['kind'] => {
    if (i === peakIndex) return 'peak'
    if (i === 0) return 'junction'
    if (i % 5 === 0) return 'gate'
    if (i % 7 === 0) return 'rift'
    if (i % 3 === 0) return 'boon'
    if (i % 4 === 0) return 'hazard'
    return 'plain'
  }
  const nameAt: Record<string, string> = {
    plain: '山径', boon: '灵泉', hazard: '险径', rift: '裂隙', gate: '关隘', junction: '岔口', peak: '峰顶',
  }
  return Array.from({ length: peakIndex + 1 }, (_, i) => {
    const kind = kindAt(i)
    return {
      index: i,
      kind,
      name: nameAt[kind],
      occupants: positions[i] ?? [],
      barrier: kind === 'gate' && i === 15,
    }
  })
}

const players: PlayerState[] = [
  { seat: 0, identityName: '观星者', factionName: '天机阁', hp: 8, hpMax: 10, resource: 4, position: 8, liveSeats: 2, alive: true, pendingCert: false, hasMark: true, inDuel: false, statuses: ['护体1'] },
  { seat: 1, identityName: '窃火者', factionName: '离火盟', hp: 6, hpMax: 10, resource: 2, position: 12, liveSeats: 1, alive: false, pendingCert: false, hasMark: false, inDuel: false, statuses: [] },
  { seat: 2, identityName: '游侠', factionName: '游侠行', hp: 9, hpMax: 10, resource: 5, position: 20, liveSeats: 3, alive: true, pendingCert: true, hasMark: false, inDuel: false, statuses: [] },
  { seat: 3, identityName: '织梦者', factionName: '幻梦楼', hp: 7, hpMax: 10, resource: 3, position: 6, liveSeats: 1, alive: true, pendingCert: false, hasMark: false, inDuel: true, statuses: ['迷障2'] },
]

const positions: Record<number, number[]> = { 8: [0], 12: [1], 20: [2], 6: [3] }

export const baseGameState: GameState = {
  round: 12,
  roundLimit: 40,
  thresholdN: 3,
  currentPlayer: 2,
  turnOrder: [2, 0, 3, 1],
  peakIndex: 20,
  publicCards: [{ name: '火折子', color: 'red' }],
  boardTiles: buildTiles(20, positions),
  players,
  log: [
    { round: 11, turnIndex: 2, seat: 2, kind: 'move', message: '座2 行棋抵达峰顶，进入待认证' },
    { round: 11, turnIndex: 1, seat: 0, kind: 'ask', message: '座0 问天：天机牌生效，全场灵力 +1' },
    { round: 10, turnIndex: 3, seat: 1, kind: 'council', message: '山议放逐 座1' },
    { round: 10, turnIndex: 0, seat: 3, kind: 'duel', message: '座3 与 座0 对峙，公开牌：火折子' },
    { round: 9, turnIndex: 2, seat: 0, kind: 'certify', message: '座0 对 座2 签印 1 枚' },
  ],
  certStage: 'pending',
  certTargets: [{ seat: 2, identityName: '游侠', signed: 1, need: 3 }],
  certQuestions: [
    { index: 1, text: '用一句话证明你此刻在场（当场可验证）', answered: true, passed: true },
    { index: 2, text: '复述上一轮你打出的牌名', answered: true, passed: false },
    { index: 3, text: '指认场上公开牌的颜色', answered: false, passed: false },
  ],
  witnesses: [
    { seat: 0, identityName: '观星者', role: 'signer' },
    { seat: 3, identityName: '织梦者', role: 'challenger' },
    { seat: 1, identityName: '窃火者', role: 'witness' },
  ],
  appealVotes: [],
  councilActive: false,
  councilTally: [
    { targetSeat: 1, votes: 3 },
    { targetSeat: 0, votes: 1 },
  ],
  exiledSeat: null,
  finished: false,
  finishReason: 'seats',
  ranks: [
    { seat: 2, identityName: '游侠', liveSeats: 3, distToPeak: 0, composite: 21, isWinner: true, isHighlightMoment: true },
    { seat: 0, identityName: '观星者', liveSeats: 2, distToPeak: 12, composite: 14, isWinner: false, isHighlightMoment: false },
    { seat: 3, identityName: '织梦者', liveSeats: 1, distToPeak: 14, composite: 9, isWinner: false, isHighlightMoment: false },
    { seat: 1, identityName: '窃火者', liveSeats: 1, distToPeak: 8, composite: 7, isWinner: false, isHighlightMoment: true },
  ],
  roomCode: 'CM-2026',
  seatJoins: [
    { seat: 0, device: '手机 A', joined: true },
    { seat: 1, device: '手机 B', joined: true },
    { seat: 2, device: '手机 C', joined: true },
    { seat: 3, device: '手机 D', joined: false },
  ],
}

// —— 按 flow 覆盖的场景快照 ——

export const mockDashboardState: GameState = {
  ...baseGameState,
  councilActive: true,
  exiledSeat: 1,
  certStage: 'none',
  certTargets: [],
}

export const mockCertState: GameState = {
  ...baseGameState,
  certStage: 'pending',
  appealVotes: [
    { seat: 0, verdict: 'uphold' },
    { seat: 3, verdict: 'overturn' },
  ],
}

export const mockSettleState: GameState = {
  ...baseGameState,
  finished: true,
  finishReason: 'seats',
  certStage: 'resolved',
}

export const mockSetupState: GameState = {
  ...baseGameState,
  round: 0,
  certStage: 'none',
  certTargets: [],
  councilActive: false,
  exiledSeat: null,
}
