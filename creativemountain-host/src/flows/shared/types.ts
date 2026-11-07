// 主屏原型共享数据模型（对齐 sitemap 主屏页面 + stories 认证/结算/席位触点）。
// 引擎真实 State 结构更复杂；此处只取主屏显示所需字段子集（mock 层）。

export type TileKind = 'plain' | 'boon' | 'hazard' | 'rift' | 'gate' | 'junction' | 'peak'
export type CardColor = 'red' | 'black'
export type CertStage = 'none' | 'pending' | 'revealed' | 'verdict' | 'appeal' | 'resolved'
export type FinishReason = 'seats' | 'fallback' | 'absent'

export interface PlayerState {
  seat: number
  identityName: string
  factionName: string
  hp: number
  hpMax: number
  resource: number
  position: number
  liveSeats: number
  alive: boolean
  pendingCert: boolean
  hasMark: boolean
  inDuel: boolean
  statuses: string[]
}

export interface BoardTile {
  index: number
  kind: TileKind
  name: string
  occupants: number[]
  barrier: boolean
}

export interface PublicCard {
  name: string
  color: CardColor
}

// —— 认证 ——
export interface CertTarget {
  seat: number
  identityName: string
  signed: number
  need: number
}

export interface CertQuestion {
  index: number
  text: string
  answered: boolean
  passed: boolean
}

export interface Witness {
  seat: number
  identityName: string
  role: 'signer' | 'challenger' | 'witness' | 'abstain'
}

export interface AppealVote {
  seat: number
  verdict: 'uphold' | 'overturn'
}

// —— 山议 / 放逐 ——
export interface CouncilTally {
  targetSeat: number
  votes: number
}

// —— 结算排名 ——
export interface RankRow {
  seat: number
  identityName: string
  liveSeats: number
  distToPeak: number
  composite: number
  isWinner: boolean
  isHighlightMoment: boolean
}

// —— 日志 ——
export interface LogEntry {
  round: number
  turnIndex: number
  seat: number
  kind: string
  message: string
}

// —— 加入会话（多端 mock）——
export interface SeatJoin {
  seat: number
  device: string
  joined: boolean
}

export interface GameState {
  round: number
  roundLimit: number
  thresholdN: number
  currentPlayer: number
  turnOrder: number[]
  peakIndex: number
  publicCards: PublicCard[]
  boardTiles: BoardTile[]
  players: PlayerState[]
  log: LogEntry[]
  // 认证
  certStage: CertStage
  certTargets: CertTarget[]
  certQuestions: CertQuestion[]
  witnesses: Witness[]
  appealVotes: AppealVote[]
  // 山议
  councilActive: boolean
  councilTally: CouncilTally[]
  exiledSeat: number | null
  // 结算
  finished: boolean
  finishReason: FinishReason
  ranks: RankRow[]
  // 加入会话
  roomCode: string
  seatJoins: SeatJoin[]
}
