// =============================================
// FLOW: Host Realtime Dashboard — 实时状态看板（主屏）
// Scenario: Data Analytics / BI（山道+席位+日志+山议）
// Covers: story-2（铺垫熬得住）· story-3（出局参与）
// sitemap 页: /#board · /#seats · /#log · /#council · /#council/exile
// =============================================

import { useEffect, useState } from 'react'
import {
  Alert, AlertDescription, AlertTitle,
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
  Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  DataTable, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle,
  Progress, ScrollArea, Separator, Skeleton, Tag,
} from 'sparkdesign'
import { Eye, Gavel, Map as MapIcon, Users, Vote } from 'lucide-react'
import { mockDashboardState } from '../shared/mock-data'
import type { BoardTile, GameState, PlayerState } from '../shared/types'

// 山道格子地图：Spark 无棋盘组件，手写 token div（DS Notes 记录为 Missing）
const TILE_STYLE: Record<BoardTile['kind'], string> = {
  plain: 'bg-bg-elevated border-border-tertiary text-text-secondary',
  boon: 'bg-success-bg border-success-border text-success',
  hazard: 'bg-warning-bg border-warning-border text-warning',
  rift: 'bg-error-bg border-error-border text-error',
  gate: 'bg-info-bg border-info-border text-info',
  junction: 'bg-bg-container border-border-secondary text-text',
  peak: 'bg-primary border-primary text-text-on-primary',
}

function MountainBoard({ state }: { state: GameState }) {
  const playerBySeat = (seat: number) => state.players.find((p) => p.seat === seat)
  return (
    <Card data-testid="flow1-board" className="bg-bg-container border-border-secondary">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapIcon size={16} /> 山道版图</CardTitle>
        <CardDescription>峰顶在第 {state.peakIndex} 格 · 登顶只是拿到认证入场券</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {state.boardTiles.map((tile) => (
            <div
              key={tile.index}
              title={`${tile.name}（第 ${tile.index} 格）`}
              className={`relative flex h-12 w-12 flex-col items-center justify-center rounded-md border text-xs ${TILE_STYLE[tile.kind]}`}
            >
              <span className="opacity-70">{tile.index}</span>
              {tile.barrier && <span className="text-xs leading-none">封</span>}
              {tile.occupants.length > 0 && (
                <span className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                  {tile.occupants.map((seat) => {
                    const p = playerBySeat(seat)
                    return (
                      <span
                        key={seat}
                        aria-label={'座' + seat + (p?.pendingCert ? ' · 待认证' : '')}
                        className="flex h-4 min-w-4 items-center justify-center rounded-full bg-bg-container px-1 text-xs font-semibold text-text ring-1 ring-border"
                      >
                        {seat}
                        {p?.pendingCert ? '★' : ''}
                      </span>
                    )
                  })}
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* ================================================
   FLOW: Host Realtime Dashboard
   SCREEN 1 of 4: Overview (对局总览)
   ------------------------------------------------
   ENTRY:  对局进行中，主机默认落此视图
   EXIT:   "钻取席位" → SCREEN 2 ｜ "查看山议" → SCREEN 3
   BRANCH: 模拟同步滞后 → loading(Skeleton) ｜ 无席位数据 → Empty
   ================================================ */
// STATE: default — 展示 mockDashboardState
// STATE: loading — Skeleton 占位（防 Layout Shift）
// STATE: error — 同步滞后 Alert + 重试
// STATE: empty — 席位/日志为空 → Empty
function Screen1_Overview({
  state, loading, error, onDrilldown, onOpenCouncil, onRetry,
}: {
  state: GameState
  loading: boolean
  error: boolean
  onDrilldown: (seat: number) => void
  onOpenCouncil: () => void
  onRetry: () => void
}) {
  const leader = state.players.reduce((a, b) => (b.liveSeats > a.liveSeats ? b : a), state.players[0])
  const distToPeak = (p: PlayerState) => state.peakIndex - p.position

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-md" />)}
        </div>
        <Skeleton className="h-40 w-full rounded-md" />
        <Skeleton className="h-56 w-full rounded-md" />
      </div>
    )
  }

  const seatCols = [
    { key: 'seat', header: '座', cell: (r: PlayerState) => <span className="text-text-secondary">{r.seat}</span> },
    { key: 'identity', header: '身份', cell: (r: PlayerState) => <span className="block max-w-28 truncate font-medium text-text" title={r.identityName}>{r.identityName}</span> },
    { key: 'faction', header: '阵营', cell: (r: PlayerState) => <span className="block max-w-24 truncate text-text-secondary" title={r.factionName}>{r.factionName}</span> },
    { key: 'hp', header: '体力', cell: (r: PlayerState) => <span>{r.hp}/{r.hpMax}</span> },
    { key: 'resource', header: '灵力', cell: (r: PlayerState) => <span>{r.resource}</span> },
    { key: 'position', header: '位置', cell: (r: PlayerState) => <span>{r.position}<span className="text-text-tertiary"> (距峰 {distToPeak(r)})</span></span> },
    { key: 'liveSeats', header: '活人席', cell: (r: PlayerState) => <Tag color={r.liveSeats >= 3 ? 'primary' : 'slate'}>{r.liveSeats}</Tag> },
    {
      key: 'status',
      header: '状态',
      cell: (r: PlayerState) => (
        <span className="flex flex-wrap gap-1">
          {r.pendingCert && <Tag color="warning">待认证</Tag>}
          {r.hasMark && <Tag color="info">印记</Tag>}
          {r.inDuel && <Tag color="error">对峙</Tag>}
          {!r.alive && <Tag color="slate">出局</Tag>}
          {r.statuses.map((s) => <Tag key={s} appearance="outline" color="sage">{s}</Tag>)}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* STATE: error — host↔phone 同步失败，显示陈旧快照 + 重试 */}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>host↔phone 同步失败</AlertTitle>
          <AlertDescription>主屏状态可能与引擎不一致（下方为上一次快照 R{state.round}）。请重试同步；持续失败请检查房间会话连接。</AlertDescription>
          <div className="mt-2 flex items-center gap-2">
            <Tag color="warning">状态陈旧</Tag>
            <Button variant="secondary" size="sm" onClick={onRetry}>重试同步</Button>
          </div>
        </Alert>
      )}
      {/* KPI Bento Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="bg-bg-container border-border-secondary">
          <CardHeader>
            <CardDescription>回合进度</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{state.round}<span className="text-lg text-text-secondary"> / {state.roundLimit}</span></CardTitle>
          </CardHeader>
          <CardContent><Progress value={Math.round((state.round / state.roundLimit) * 100)} /></CardContent>
        </Card>
        <Card className="bg-bg-container border-border-secondary">
          <CardHeader>
            <CardDescription>签印门槛</CardDescription>
            <CardTitle className="text-3xl">N = {state.thresholdN}</CardTitle>
          </CardHeader>
          <CardContent><p className="text-sm text-text-secondary">集齐 N 枚签印方可坐上活人席</p></CardContent>
        </Card>
        <Card className="bg-bg-container border-border-secondary">
          <CardHeader>
            <CardDescription>活人席领跑</CardDescription>
            <CardTitle className="text-xl">座{leader.seat} · {leader.identityName}</CardTitle>
          </CardHeader>
          <CardContent><Tag color="primary">{leader.liveSeats} 席</Tag></CardContent>
        </Card>
        <Card className="bg-bg-container border-border-secondary">
          <CardHeader>
            <CardDescription>场上公开牌</CardDescription>
            <CardTitle className="text-xl">{state.publicCards.length > 0 ? '对峙留场' : '无'}</CardTitle>
          </CardHeader>
          <CardContent>
            {state.publicCards.map((c) => <Tag key={c.name} color={c.color === 'red' ? 'error' : 'slate'}>{c.name}（{c.color === 'red' ? '红' : '黑'}）</Tag>)}
          </CardContent>
        </Card>
      </div>

      <MountainBoard state={state} />

      <Separator />

      {/* 席位计分表 */}
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users size={16} /> 席位计分</CardTitle>
          <CardDescription>身份 / 阵营 / 体力 / 灵力 / 位置 / 活人席 · 点席位进入钻取</CardDescription>
          <CardAction>
            <Button data-testid="flow1-drill" variant="primary" prefixIcon={<Eye size={14} />} onClick={() => onDrilldown(state.currentPlayer)}>钻取席位</Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {state.players.length === 0
            ? <Empty><EmptyHeader><EmptyTitle>暂无席位数据</EmptyTitle><EmptyDescription>等待玩家加入会话</EmptyDescription></EmptyHeader></Empty>
            : <DataTable columns={seatCols} data={state.players} />}
        </CardContent>
      </Card>

      {/* 事件日志 */}
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Vote size={16} /> 事件日志</CardTitle>
          <CardAction><Button variant="ghost" onClick={onOpenCouncil}>查看山议</Button></CardAction>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-40">
            <ul className="flex flex-col gap-1.5">
              {state.log.map((e, i) => (
                <li key={i} className="text-sm text-text-secondary">
                  <span className="text-text-tertiary">R{e.round}·T{e.turnIndex} 座{e.seat}</span> {e.message}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}

/* ================================================
   FLOW: Host Realtime Dashboard
   SCREEN 2 of 4: Player Drill (席位钻取)
   ------------------------------------------------
   ENTRY:  Screen 1 点击「钻取席位」
   EXIT:   "返回总览" → SCREEN 1 ｜ "查看山议" → SCREEN 3
   BRANCH: "Back" → SCREEN 1
   ================================================ */
function Screen2_PlayerDrill({ state, seat, onBack }: { state: GameState; seat: number; onBack: () => void }) {
  const [loading, setLoading] = useState(false)
  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="h-40 w-full rounded-md" />
        <Skeleton className="h-56 w-full rounded-md" />
      </div>
    )
  }
  const p = state.players.find((x) => x.seat === seat) ?? state.players[0]
  const dist = state.peakIndex - p.position
  const history = state.log.filter((e) => e.seat === p.seat)
  return (
    <div data-testid="flow1-drill-screen" className="flex flex-col gap-4 p-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="#/flow1" onClick={(e) => { e.preventDefault(); onBack() }}>对局总览</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>座{p.seat} · {p.identityName}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="bg-bg-container border-border-secondary">
          <CardHeader><CardTitle>{p.identityName}</CardTitle><CardDescription>{p.factionName}{!p.alive ? ' · 已出局' : ''}</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {p.pendingCert && <Tag color="warning">待认证</Tag>}
            {p.hasMark && <Tag color="info">印记</Tag>}
            {p.inDuel && <Tag color="error">对峙</Tag>}
            {p.statuses.map((s) => <Tag key={s} appearance="outline" color="sage">{s}</Tag>)}
            {!p.alive && <Tag color="slate">出局</Tag>}
          </CardContent>
        </Card>
        <Card className="bg-bg-container border-border-secondary">
          <CardHeader><CardDescription>资源</CardDescription><CardTitle className="text-2xl">{p.hp}/{p.hpMax} 体力</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-text-secondary">灵力 {p.resource} · 活人席 {p.liveSeats}</p></CardContent>
        </Card>
        <Card className="bg-bg-container border-border-secondary">
          <CardHeader><CardDescription>距峰顶</CardDescription><CardTitle className="text-2xl">{dist} 格</CardTitle></CardHeader>
          <CardContent><Progress value={Math.round((p.position / state.peakIndex) * 100)} /></CardContent>
        </Card>
      </div>

      <Card className="bg-bg-container border-border-secondary">
        <CardHeader><CardTitle>该玩家行动轨迹</CardTitle><CardDescription>从公开日志过滤座{p.seat}的动作</CardDescription></CardHeader>
        <CardContent>
          {history.length === 0
            ? <Empty><EmptyHeader><EmptyTitle>本座暂无记录</EmptyTitle><EmptyDescription>尚无可回放的公开事件</EmptyDescription></EmptyHeader></Empty>
            : (
              <ul className="flex flex-col gap-1.5">
                {history.map((e, i) => (
                  <li key={i} className="text-sm"><span className="text-text-tertiary">R{e.round}·T{e.turnIndex}</span> <span className="text-text">{e.message}</span></li>
                ))}
              </ul>
            )}
        </CardContent>
        <CardFooter className="justify-between">
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onBack}>返回总览</Button>
            {import.meta.env.DEV && (<Button variant="ghost" onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 800) }}>模拟加载</Button>)}
          </div>
          <span className="text-sm text-text-secondary">出局者仍可在此被选为证人（见认证 flow）</span>
        </CardFooter>
      </Card>
    </div>
  )
}

/* ================================================
   FLOW: Host Realtime Dashboard
   SCREEN 3 of 4: Council Tally (山议票数公示)
   ------------------------------------------------
   ENTRY:  Screen 1 「查看山议」/ 引擎触发 needsCouncilVote
   EXIT:   "结算山议" → SCREEN 4（放逐）
   BRANCH: 无票数 → Empty ｜ 3人局 → 不淘汰仅扣分 Alert
   ================================================ */
function Screen3_Council({ state, onResolve, onBack }: { state: GameState; onResolve: () => void; onBack: () => void }) {
  const [serverErr, setServerErr] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const alive = state.players.filter((p) => p.alive).length
  const resolve = () => { setSubmitting(true); setTimeout(() => { setSubmitting(false); onResolve() }, 600) }
  const tallyCols = [
    { key: 'target', header: '目标', cell: (r: GameState['councilTally'][number]) => <span className="font-medium text-text">座{r.targetSeat}</span> },
    { key: 'votes', header: '票数', cell: (r: GameState['councilTally'][number]) => <Tag color={r.votes >= 3 ? 'error' : 'slate'}>{r.votes} 票</Tag> },
  ]
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gavel size={16} /> 山议（匿名投票）</CardTitle>
          <CardDescription>主屏仅汇总票数，不显示谁投谁 · 每人一票在手机上私密完成</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {serverErr && (
            <Alert variant="destructive">
              <AlertTitle>计票服务异常</AlertTitle>
              <AlertDescription>结算失败，已投出的票数保留在原处，请重试结算（重试不会重复计票，也不会误放逐）。</AlertDescription>
              <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => setServerErr(false)}>重试结算</Button></div>
            </Alert>
          )}
          <Alert variant="info">
            <AlertTitle>投票进行中</AlertTitle>
            <AlertDescription>当前存活 {alive} 人{alive === 3 ? '：3 人局山议不淘汰人，得票最高者扣 2 灵力（并列各扣 1）。' : '：得票最高者将被放逐。'}</AlertDescription>
          </Alert>
          {state.councilTally.length === 0
            ? <Empty><EmptyHeader><EmptyTitle>暂无投票</EmptyTitle><EmptyDescription>等待玩家在山议面板完成投票</EmptyDescription></EmptyHeader><EmptyContent><Button variant="secondary" onClick={onBack}>返回总览</Button></EmptyContent></Empty>
            : <DataTable columns={tallyCols} data={state.councilTally} />}
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onBack}>返回总览</Button>
            {import.meta.env.DEV && (<Button variant="ghost" onClick={() => setServerErr(true)}>模拟计票异常</Button>)}
          </div>
          <Button variant="primary" loading={submitting} onClick={resolve}>结算山议</Button>
        </CardFooter>
      </Card>
    </div>
  )
}

/* ================================================
   FLOW: Host Realtime Dashboard
   SCREEN 4 of 4: Exile Reveal (放逐公示)
   ------------------------------------------------
   ENTRY:  Screen 3 「结算山议」
   EXIT:   "返回总览" → SCREEN 1（终态）
   BRANCH: 无人被放逐 → info Alert
   ================================================ */
function Screen4_Exile({ state, onBack }: { state: GameState; onBack: () => void }) {
  const exiled = state.exiledSeat != null ? state.players.find((p) => p.seat === state.exiledSeat) : null
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader><CardTitle className="flex items-center gap-2"><Gavel size={16} /> 放逐公示</CardTitle></CardHeader>
        <CardContent>
          {exiled ? (
            <div className="flex flex-col gap-3">
              <Alert variant="warning">
                <AlertTitle>座{exiled.seat} · {exiled.identityName} 已被放逐</AlertTitle>
                <AlertDescription>山议票数最高者出局，本轮退出竞速。</AlertDescription>
              </Alert>
              <div className="flex items-center gap-2">
                <Tag color="info">转为旁观/证人</Tag>
                <span className="text-sm text-text-secondary">出局后可在认证环节作证、参与复议，不干坐冷场（story-3）</span>
              </div>
            </div>
          ) : (
            <Alert variant="info"><AlertTitle>本轮无人被放逐</AlertTitle><AlertDescription>3 人局或票数未达放逐阈值。</AlertDescription></Alert>
          )}
        </CardContent>
        <CardFooter><Button variant="primary" onClick={onBack}>返回总览</Button></CardFooter>
      </Card>
    </div>
  )
}

export default function Flow1HostDashboard() {
  const [screen, setScreen] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [drillSeat, setDrillSeat] = useState(0)
  const state = mockDashboardState

  useEffect(() => {
    if (!loading) { return }
    const t = setTimeout(() => setLoading(false), 1200)
    return () => clearTimeout(t)
  }, [loading])

  const go = (n: number) => setScreen(n)

  return (
    <div data-testid="flow1-root" className="flex h-full flex-col">
      {/* Flow 局部工具栏：屏幕步进 + 状态演示 */}
      {/* 窄屏（<768px）页头纵向堆叠：标题一行 / 按钮一行（按钮 wrap + shrink-0 不被压扁）；桌面（≥768px）保持横向布局 */}
      <div className="flex flex-col gap-2 border-b border-border-tertiary bg-bg-layout px-4 py-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap font-medium text-text">Flow 1 · 实时状态看板</span>
          <span className="whitespace-nowrap text-sm text-text-secondary">屏 {screen}/4</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {import.meta.env.DEV && (<Button className="shrink-0 whitespace-nowrap" variant="ghost" size="sm" onClick={() => setLoading(true)}>模拟同步滞后</Button>)}
          {import.meta.env.DEV && (<Button className="shrink-0 whitespace-nowrap" variant="ghost" size="sm" onClick={() => setError(true)}>模拟同步失败</Button>)}
          <Button data-testid="flow1-prev" className="shrink-0 whitespace-nowrap" variant="secondary" size="sm" disabled={screen === 1} onClick={() => go(Math.max(1, screen - 1))}>← 上一步</Button>
          <Button data-testid="flow1-next" className="shrink-0 whitespace-nowrap" variant="primary" size="sm" disabled={screen === 4} onClick={() => go(Math.min(4, screen + 1))}>下一步 →</Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {screen === 1 && (
          <Screen1_Overview
            state={state}
            loading={loading}
            error={error}
            onDrilldown={(seat) => { setDrillSeat(seat); go(2) }}
            onOpenCouncil={() => go(3)}
            onRetry={() => { setError(false); setLoading(true) }}
          />
        )}
        {screen === 2 && <Screen2_PlayerDrill state={state} seat={drillSeat} onBack={() => go(1)} />}
        {screen === 3 && <Screen3_Council state={state} onResolve={() => go(4)} onBack={() => go(1)} />}
        {screen === 4 && <Screen4_Exile state={state} onBack={() => go(1)} />}
      </div>
    </div>
  )
}
