// =============================================
// FLOW: Setup & Tutorial — 开局配置 + 首局教学（主屏）
// Scenario: Data Analytics/BI（Connect source 引导 + 配置）
// Covers: story-1（首局不劝退·规则渐进披露）
// sitemap 页: /#setup · /#tutorial ·（/m/join 手机入口的 host 侧镜像）
// =============================================

import { useState } from 'react'
import {
  Alert, AlertDescription, AlertTitle,
  Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Tag,
} from 'sparkdesign'
import { BadgeCheck, CircleUserRound, Flag, Play, Settings, Sparkles, Users } from 'lucide-react'
import { mockSetupState } from '../shared/mock-data'
import type { GameState } from '../shared/types'

const THEMES = [
  { value: 'xianxia2026', label: '仙侠 · 2026' },
  { value: 'scifi', label: '科幻 · 星轨' },
  { value: 'ipartment', label: '爱情公寓 · 原版情怀' },
]

const TUTORIAL_STEPS = [
  { title: '开局', detail: '每人发一手牌；山道共 21 格，峰顶在第 20 格。「登顶即胜」在这里被改写——登顶只是拿到认证入场券。' },
  { title: '天机', detail: '每回合翻开一张天机牌，对全场生效，制造不可预测的转折。' },
  { title: '行动', detail: '行棋（必须走满）或问天（掷指令骰）。资源与手牌驱动竞速。' },
  { title: '关隘试炼', detail: '落到关隘触发试炼，顺便预热「认证」概念——首道关隘就让新手看到登顶之后还有重头戏。' },
  { title: '活人认证', detail: '抵达峰顶进入待认证，需集齐签印或被质疑出 3 题、答对 2 问。这才决定谁真正赢。' },
]

/* ================================================
   FLOW: Setup & Tutorial
   SCREEN 1 of 3: Setup (牌局配置)
   ------------------------------------------------
   ENTRY:  新开一局 → /#setup
   EXIT:   "生成会话并等待加入" → SCREEN 2
   ================================================ */
function Screen1_Setup({ state, onJoin }: { state: GameState; onJoin: () => void }) {
  const [theme, setTheme] = useState(THEMES[0].value)
  const [count, setCount] = useState(String(state.players.length))
  const [mode, setMode] = useState('newbie')
  const [submitting, setSubmitting] = useState(false)
  const [cfgErr, setCfgErr] = useState<string | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const generate = () => {
    if (Number(count) < 3) { setCfgErr('至少 3 人才能开局'); return }
    setSubmitting(true)
    setTimeout(() => { setSubmitting(false); onJoin() }, 700)
  }
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Settings size={16} /> 牌局配置</CardTitle>
          <CardDescription>主机操作者设置本局；多端下手机凭房间码各自绑定座位</CardDescription>
          <CardAction><Button className="shrink-0 whitespace-nowrap" variant={readOnly ? 'secondary' : 'ghost'} onClick={() => setReadOnly((r) => !r)}>{readOnly ? '切回主持人' : '以观众预览（只读）'}</Button></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {readOnly && (
            <Alert variant="info"><AlertTitle>只读预览</AlertTitle><AlertDescription>仅主机操作者可调整本局配置；观众只能查看房间码与就绪情况。</AlertDescription></Alert>
          )}
          {cfgErr && (
            <Alert variant="destructive"><AlertTitle>配置无法生成会话</AlertTitle><AlertDescription>{cfgErr}</AlertDescription></Alert>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-secondary">主题</span>
              <Select value={theme} onValueChange={setTheme} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="选择主题" /></SelectTrigger>
                <SelectContent>
                  {THEMES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-secondary">人数</span>
              <Select value={count} onValueChange={setCount} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="选择人数" /></SelectTrigger>
                <SelectContent>
                  {['3', '4', '5', '6', '7', '8'].map((n) => <SelectItem key={n} value={n}>{n} 人</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-secondary">模式</span>
              <Select value={mode} onValueChange={setMode} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="选择模式" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newbie">新手（推荐首局）</SelectItem>
                  <SelectItem value="standard">标准</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        {/* 窄屏（<768px）：页脚纵向堆叠且按钮不压扁；桌面（≥768px）保持横向布局 */}
        <CardFooter className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="whitespace-nowrap text-sm text-text-secondary">房间码</span>
              <Tag color={cfgErr ? 'error' : 'primary'}>{state.roomCode}</Tag>
              {mode === 'newbie' && <Tag color="info">新手模式：推迟放逐</Tag>}
            </div>
            {import.meta.env.DEV && (<Button className="shrink-0 whitespace-nowrap" variant="ghost" size="sm" disabled={readOnly} onClick={() => setCfgErr('房间码已被占用，请重新生成或稍后再试')}>模拟房间码冲突</Button>)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {cfgErr && <Button className="shrink-0 whitespace-nowrap" variant="secondary" onClick={() => setCfgErr(null)}>清除</Button>}
            <Button data-testid="flow4-generate" className="shrink-0 whitespace-nowrap" variant="primary" prefixIcon={<Users size={14} />} loading={submitting} disabled={readOnly || cfgErr !== null} onClick={generate}>生成会话并等待加入</Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

/* ================================================
   FLOW: Setup & Tutorial
   SCREEN 2 of 3: Join Status (加入会话)
   ------------------------------------------------
   ENTRY:  Screen 1「生成会话」
   EXIT:   全员就位 → "查看首局教学" → SCREEN 3
   BRANCH: 有座位未加入 → 提醒 Alert
   ================================================ */
function Screen2_Join({ state, onTutorial, onBack }: { state: GameState; onTutorial: () => void; onBack: () => void }) {
  const [roomErr, setRoomErr] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const allJoined = state.seatJoins.every((s) => s.joined)
  const joinedCount = state.seatJoins.filter((s) => s.joined).length
  const refresh = () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 700) }
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CircleUserRound size={16} /> 座位加入状态</CardTitle>
          <CardDescription>房间码 {state.roomCode} · 各玩家在手机上扫码加入并绑定座位</CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <Button variant="ghost" loading={refreshing} onClick={refresh}>刷新</Button>
              <Button variant="ghost" onClick={onBack}>返回配置</Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {roomErr && (
            <Alert variant="destructive">
              <AlertTitle>房间码已失效</AlertTitle>
              <AlertDescription>会话建立失败或房间码过期，手机无法加入。请重新生成会话后再邀请。</AlertDescription>
              <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => setRoomErr(false)}>重新生成房间码</Button></div>
            </Alert>
          )}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-secondary">加入进度 {joinedCount}/{state.seatJoins.length}</span>
            <div className="flex-1"><Progress value={Math.round((joinedCount / state.seatJoins.length) * 100)} /></div>
            {refreshing && <Tag color="info">刷新中…</Tag>}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {state.seatJoins.map((s) => (
              <Card key={s.seat} className="bg-bg-elevated border-border-tertiary">
                <CardContent className="flex flex-col items-center gap-1 py-3">
                  <span className="text-sm font-medium text-text">座{s.seat}</span>
                  <span className="text-xs text-text-secondary">{s.device}</span>
                  <Tag color={s.joined ? 'success' : 'slate'}>{s.joined ? '已加入' : '待加入'}</Tag>
                </CardContent>
              </Card>
            ))}
          </div>
          {!allJoined && (
            <Alert variant="info"><AlertTitle>仍有座位未加入</AlertTitle><AlertDescription>新手可先加入后由他人代管，或开启热座兜底。</AlertDescription></Alert>
          )}
          {allJoined && (
            <Alert variant="success"><AlertTitle>全员就位</AlertTitle><AlertDescription>可以开始首局教学或直接进入对局。</AlertDescription></Alert>
          )}
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          {import.meta.env.DEV && (<Button variant="ghost" onClick={() => setRoomErr(true)}>模拟房间码失效</Button>)}
          <Button variant="primary" prefixIcon={<Play size={14} />} onClick={onTutorial}>查看首局教学</Button>
        </CardFooter>
      </Card>
    </div>
  )
}

/* ================================================
   FLOW: Setup & Tutorial
   SCREEN 3 of 3: Tutorial (首局教学演示)
   ------------------------------------------------
   ENTRY:  Screen 2「查看首局教学」
   EXIT:   "进入对局" → 退出 flow（终态，交棒 Flow 1 状态看板）
   ================================================ */
function Screen3_Tutorial({ current, onStep, onFinish }: { current: number; onStep: (n: number) => void; onFinish: () => void }) {
  const [engineErr, setEngineErr] = useState(false)
  const [loading, setLoading] = useState(false)
  const pct = Math.round(((current + 1) / TUTORIAL_STEPS.length) * 100)
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles size={16} /> 首局教学 · {TUTORIAL_STEPS.length} 回合迷你流程</CardTitle>
          <CardDescription>走真实引擎，3 分钟看懂一局长什么样 · 价值前置，不先啃规则书</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-64 w-full rounded-md" />
            </div>
          ) : engineErr ? (
            <Alert variant="destructive">
              <AlertTitle>教学引擎暂不可用</AlertTitle>
              <AlertDescription>迷你演示跑算异常。可直接进入对局边玩边学，或重试教学。</AlertDescription>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEngineErr(false)}>重试教学</Button>
                <Button variant="primary" size="sm" onClick={onFinish}>跳过，直接开局</Button>
              </div>
            </Alert>
          ) : (<>
          <Progress value={pct} />
          <p className="text-sm text-text-secondary">第 {current + 1} / {TUTORIAL_STEPS.length} 步</p>
          {TUTORIAL_STEPS.map((s, i) => (
            <div key={i} className={`rounded-md border p-3 transition-colors ${i === current ? 'border-primary bg-bg-spotlight' : 'border-border-tertiary bg-bg-elevated'}`}>
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                  <Flag size={12} /> {i + 1}. {s.title}
                </span>
                {i < current && <Tag color="success" className="flex items-center gap-1"><BadgeCheck size={12} /> 已演示</Tag>}
              </div>
              {i === current && <p className="text-sm text-text-secondary">{s.detail}</p>}
            </div>
          ))}
          </>)}
        </CardContent>
        <CardFooter className="justify-between">
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={current === 0} onClick={() => onStep(Math.max(0, current - 1))}>← 上一步</Button>
            {import.meta.env.DEV && (<Button variant="ghost" onClick={() => setEngineErr(true)}>模拟引擎异常</Button>)}
            {import.meta.env.DEV && (<Button variant="ghost" onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 800) }}>模拟演算加载</Button>)}
          </div>
          {current < TUTORIAL_STEPS.length - 1
            ? <Button variant="primary" onClick={() => onStep(current + 1)}>下一步 →</Button>
            : <Button variant="primary" prefixIcon={<Play size={14} />} onClick={onFinish}>进入对局</Button>}
        </CardFooter>
      </Card>
    </div>
  )
}

export default function Flow4SetupTutorial() {
  const [screen, setScreen] = useState(1)
  const [tutStep, setTutStep] = useState(0)
  const state = mockSetupState
  const go = (n: number) => setScreen(n)
  return (
    <div data-testid="flow4-root" className="flex h-full flex-col">
      {/* 窄屏（<768px）页头纵向堆叠：标题一行 / 按钮一行（按钮 wrap + shrink-0 不被压扁）；桌面（≥768px）保持横向布局 */}
      <div className="flex flex-col gap-2 border-b border-border-tertiary bg-bg-layout px-4 py-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap font-medium text-text">Flow 4 · 开局配置 + 首局教学</span>
          <span data-testid="flow4-screen-indicator" data-screen={String(screen)} className="whitespace-nowrap text-sm text-text-secondary">屏 {screen}/3</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="flow4-prev" className="shrink-0 whitespace-nowrap" variant="secondary" size="sm" disabled={screen === 1} onClick={() => go(Math.max(1, screen - 1))}>← 上一步</Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {screen === 1 && <Screen1_Setup state={state} onJoin={() => go(2)} />}
        {screen === 2 && <Screen2_Join state={state} onTutorial={() => { setTutStep(0); go(3) }} onBack={() => go(1)} />}
        {screen === 3 && <Screen3_Tutorial current={tutStep} onStep={setTutStep} onFinish={() => go(1)} />}
      </div>
    </div>
  )
}
