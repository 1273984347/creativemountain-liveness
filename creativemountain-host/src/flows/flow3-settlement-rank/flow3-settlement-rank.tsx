// =============================================
// FLOW: Settlement & Rank — 终局结算 + 排名公示（主屏）
// Scenario: Data Analytics/BI（数据表 + 钻取/明细）
// Covers: story-6（名场面即胜利·最大 gap：现仅状态栏 badge）
// sitemap 页: /#settle · /#settle/rank
// =============================================

import { useEffect, useState } from 'react'
import {
  Alert, AlertDescription, AlertTitle,
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
  Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle,
  DataTable, Progress, Separator, Skeleton, Tag,
} from 'sparkdesign'
import { Award, BadgeCheck, ChevronRight, Sparkles, Trophy } from 'lucide-react'
import { mockSettleState } from '../shared/mock-data'
import type { GameState, RankRow } from '../shared/types'

/* ================================================
   FLOW: Settlement & Rank
   SCREEN 1 of 3: Settle Enter (结算揭示)
   ------------------------------------------------
   ENTRY:  引擎 outcome.finished=true → 主屏切结算
   EXIT:   "查看排名公示" → SCREEN 2
   BRANCH: 无胜者（活人缺席）→ 说明 Alert
   ================================================ */
function Screen1_SettleEnter({ state, onRank }: { state: GameState; onRank: () => void }) {
  const winner = state.ranks.find((r) => r.isWinner) ?? state.ranks[0]
  const reasonLabel = state.finishReason === 'seats' ? '席位结算' : state.finishReason === 'fallback' ? '无人封顶兜底' : '活人缺席'
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="bg-bg-spotlight border-border-secondary">
        <CardHeader>
          <CardDescription className="flex items-center gap-2"><Trophy size={14} /> 本局结束 · {reasonLabel}</CardDescription>
          <CardTitle className="text-3xl">座{winner.seat} · {winner.identityName}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Tag color="primary" className="flex items-center gap-1"><Award size={12} /> 胜者</Tag>
          {winner.isHighlightMoment && <Tag color="warning" className="flex items-center gap-1"><Sparkles size={12} /> 名场面贡献</Tag>}
          <Tag color="slate">{winner.liveSeats} 活人席</Tag>
          <Tag color="info">综合分 {winner.composite}</Tag>
        </CardContent>
        {/* 窄屏（<768px）：页脚纵向堆叠且按钮不压扁；桌面（≥768px）保持横向布局 */}
        <CardFooter className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-text-secondary">贡献最精彩名场面的人站上赢家位置——「名场面即胜利」。</p>
          <Button data-testid="flow3-rank" className="shrink-0 whitespace-nowrap" variant="primary" suffixIcon={<ChevronRight size={14} />} onClick={onRank}>查看排名公示</Button>
        </CardFooter>
      </Card>

      {!winner && (
        <Alert variant="info"><AlertTitle>无胜者</AlertTitle><AlertDescription>活人席空缺，本局以「活人缺席」结束。</AlertDescription></Alert>
      )}
    </div>
  )
}

/* ================================================
   FLOW: Settlement & Rank
   SCREEN 2 of 3: Rank Board (排名公示)
   ------------------------------------------------
   ENTRY:  Screen 1「查看排名公示」
   EXIT:   行「明细」→ SCREEN 3
   BRANCH: ranks 为空 → 空态
   ================================================ */
function Screen2_RankBoard({ state, onDetail, onBack }: { state: GameState; onDetail: (seat: number) => void; onBack: () => void }) {
  const [loading, setLoading] = useState(false)
  // ⚠️ 窄屏（<768px）下排名表**只保留「座 / 身份 / 明细」三列**。
  //   起因（B88 · L-B87-2）：七列全显时表格约 470px、容器仅约 306px ⇒ 只能靠**表格内横向滚动**承载
  //   ⇒ 窄屏下「排名公示」几乎读不了。窄屏改用精简列 ⇒ 不再需要横向滚动（明细入口保留）。
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const apply = () => setNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-8 w-48 rounded-md" />
        <Skeleton className="h-64 w-full rounded-md" />
      </div>
    )
  }
  const cols = [
    { key: 'rank', header: '#', cell: (_r: RankRow, i: number) => <span className="font-semibold text-text">{i + 1}</span> },
    { key: 'seat', header: '座', cell: (r: RankRow) => <span className="text-text-secondary">{r.seat}</span> },
    {
      key: 'identity',
      header: '身份',
      cell: (r: RankRow) => (
        <span className="flex items-center gap-1 font-medium text-text">
          <span className="block max-w-28 truncate" title={r.identityName}>{r.identityName}</span>
          {r.isWinner && <Tag color="primary">胜者</Tag>}
          {r.isHighlightMoment && <Tag color="warning">名场面</Tag>}
        </span>
      ),
    },
    { key: 'liveSeats', header: '活人席', cell: (r: RankRow) => <Tag color={r.liveSeats >= 3 ? 'primary' : 'slate'}>{r.liveSeats}</Tag> },
    { key: 'dist', header: '距峰顶', cell: (r: RankRow) => <span className="text-text-secondary tabular-nums">{r.distToPeak} 格</span> },
    { key: 'composite', header: '综合分', cell: (r: RankRow) => <span className="font-semibold text-text tabular-nums">{r.composite}</span> },
    { key: 'detail', header: '', cell: (r: RankRow) => <Button variant="ghost" size="sm" onClick={() => onDetail(r.seat)}>明细</Button> },
  ]
  const top = state.ranks[0]
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle>排名公示</CardTitle>
          <CardDescription>席位权重 + 距峰顶格数 → 综合分。公示「为什么他赢」，让高潮意义不被终局消解。</CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              {import.meta.env.DEV && (<Button variant="ghost" onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 900) }}>模拟加载</Button>)}
              <Button variant="ghost" onClick={onBack}>返回结算</Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-secondary">最高综合分</span>
            <Progress value={Math.round((top.composite / Math.max(...state.ranks.map((r) => r.composite))) * 100)} />
          </div>
          {state.ranks.length === 0 ? (
            <Empty>
              <EmptyHeader><EmptyTitle>本局尚未结算</EmptyTitle><EmptyDescription>对局结束后，这里显示席位权重与距峰顶的综合排名。</EmptyDescription></EmptyHeader>
              <EmptyContent><Button variant="secondary" onClick={onBack}>返回结算</Button></EmptyContent>
            </Empty>
          ) : (
            <div data-testid="flow3-rank-table" className="min-w-0">
              <DataTable
                columns={narrow
                  ? cols.filter((c) => c.key === 'seat' || c.key === 'identity' || c.key === 'detail')
                  : cols}
                data={state.ranks}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ================================================
   FLOW: Settlement & Rank
   SCREEN 3 of 3: Score Detail (得分明细)
   ------------------------------------------------
   ENTRY:  Screen 2 某行「明细」
   EXIT:   "返回排名" → SCREEN 2
   ================================================ */
function Screen3_ScoreDetail({ state, seat, onBack, onHome }: { state: GameState; seat: number; onBack: () => void; onHome: () => void }) {
  const r = state.ranks.find((x) => x.seat === seat) ?? state.ranks[0]
  const seatPts = r.liveSeats * 5
  const distPts = Math.max(0, 10 - r.distToPeak)
  const highlightPts = r.isHighlightMoment ? 6 : 0
  return (
    <div className="flex flex-col gap-4 p-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem><BreadcrumbLink href="#/flow3" onClick={(e) => { e.preventDefault(); onHome() }}>结算</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbLink href="#/flow3" onClick={(e) => { e.preventDefault(); onBack() }}>排名公示</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>座{r.seat} 得分明细</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BadgeCheck size={16} /> 座{r.seat} · {r.identityName}</CardTitle>
          <CardDescription>综合分 = 席位分 + 距峰顶分 + 名场面加成</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Row label={`活人席 ${r.liveSeats} × 5`} value={seatPts} />
          <Separator />
          <Row label={`距峰顶 ${r.distToPeak} 格（越近越高）`} value={distPts} />
          <Separator />
          <Row label={r.isHighlightMoment ? '名场面贡献加成' : '无名场面加成'} value={highlightPts} />
          <Separator />
          <div className="flex items-center justify-between">
            <span className="font-semibold text-text">综合分</span>
            <span className="text-2xl font-bold text-text">{r.composite}</span>
          </div>
          {r.isWinner && <Tag color="primary">本局胜者</Tag>}
        </CardContent>
        <CardFooter><Button variant="secondary" onClick={onBack}>返回排名</Button></CardFooter>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text">{value} 分</span>
    </div>
  )
}

export default function Flow3SettlementRank() {
  const [screen, setScreen] = useState(1)
  const [detailSeat, setDetailSeat] = useState(0)
  const state = mockSettleState
  const go = (n: number) => setScreen(n)
  return (
    <div data-testid="flow3-root" className="flex h-full flex-col">
      {/* 窄屏（<768px）页头纵向堆叠：标题一行 / 按钮一行（按钮 wrap + shrink-0 不被压扁）；桌面（≥768px）保持横向布局 */}
      <div className="flex flex-col gap-2 border-b border-border-tertiary bg-bg-layout px-4 py-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap font-medium text-text">Flow 3 · 终局结算 + 排名公示</span>
          <span data-testid="flow3-screen-indicator" data-screen={String(screen)} className="whitespace-nowrap text-sm text-text-secondary">屏 {screen}/3</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="flow3-prev" className="shrink-0 whitespace-nowrap" variant="secondary" size="sm" disabled={screen === 1} onClick={() => go(Math.max(1, screen - 1))}>← 上一步</Button>
          <Button data-testid="flow3-next" className="shrink-0 whitespace-nowrap" variant="primary" size="sm" disabled={screen === 3} onClick={() => go(Math.min(3, screen + 1))}>下一步 →</Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {screen === 1 && <Screen1_SettleEnter state={state} onRank={() => go(2)} />}
        {screen === 2 && <Screen2_RankBoard state={state} onDetail={(seat) => { setDetailSeat(seat); go(3) }} onBack={() => go(1)} />}
        {screen === 3 && <Screen3_ScoreDetail state={state} seat={detailSeat} onBack={() => go(2)} onHome={() => go(1)} />}
      </div>
    </div>
  )
}
