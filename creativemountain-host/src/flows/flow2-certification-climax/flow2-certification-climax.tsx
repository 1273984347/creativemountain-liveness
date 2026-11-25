// =============================================
// FLOW: Certification Climax — 认证高潮聚焦（主屏）
// Scenario: Data Analytics/BI（View/Focus 模式分离类比）
// Covers: story-4（名场面核心）· story-5（全桌密度）· story-3（证人参与）
// sitemap 页: /#cert · /#cert/progress · /#cert/witness · /#cert/appeal · /#board(峰顶标记)
// 诚实边界：出题/签印/复议的「动作」在手机端；主屏只显示公开「公示」侧。
// =============================================

import { useEffect, useState } from 'react'
import {
  Alert, AlertDescription, AlertTitle,
  Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Empty, EmptyDescription, EmptyHeader, EmptyTitle,
  Progress, ScrollArea, Separator, Tabs, TabsContent, TabsList, TabsTrigger, Tag,
} from 'sparkdesign'
import { BadgeCheck, Flag, Gavel, Sparkles, Timer, Vote, X } from 'lucide-react'
import { mockCertState } from '../shared/mock-data'
import type { GameState, Witness } from '../shared/types'

const ROLE_LABEL: Record<Witness['role'], string> = {
  signer: '签印者', challenger: '质疑者', witness: '证人', abstain: '弃权',
}
const ROLE_COLOR: Record<Witness['role'], 'success' | 'error' | 'info' | 'slate'> = {
  signer: 'success', challenger: 'error', witness: 'info', abstain: 'slate',
}

function WitnessRow({ list }: { list: Witness[] }) {
  if (list.length === 0) return <p className="text-sm text-text-secondary">暂无人选择此项</p>
  return (
    <ul className="flex flex-col gap-2">
      {list.map((w) => (
        <li key={w.seat} className="flex items-center justify-between">
          <span className="text-text">座{w.seat} · {w.identityName}</span>
          <Tag color={ROLE_COLOR[w.role]}>{ROLE_LABEL[w.role]}</Tag>
        </li>
      ))}
    </ul>
  )
}

/* ================================================
   FLOW: Certification Climax
   SCREEN 1 of 4: Cert Prompt (待认证触发)
   ------------------------------------------------
   ENTRY:  引擎 needsCertificationAction → pending 非空
   EXIT:   "进入认证聚焦" → SCREEN 2
   BRANCH: pending 为空 → Empty（当前无待认证者）
   ================================================ */
function Screen1_CertPrompt({ state, onEnter }: { state: GameState; onEnter: () => void }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {state.certTargets.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle className="flex items-center gap-2"><Flag size={16} /> 当前无待认证者</EmptyTitle>
            <EmptyDescription>有人登顶后，此处将触发全桌认证聚焦。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="bg-bg-container border-border-secondary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles size={16} /> 登顶触发认证</CardTitle>
            <CardDescription>登顶≠胜利：需被全桌当场验明「是活人」才坐上活人席</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Alert variant="warning">
              <AlertTitle>座{state.certTargets[0].seat} · {state.certTargets[0].identityName} 已在峰顶，进入待认证</AlertTitle>
              <AlertDescription>
                {state.certTargets.length >= 2 ? '双人互验：双方互相出题认证，门槛为 1 枚签印。' : `集齐 ${state.certTargets[0].need} 枚签印即可通过；也可被质疑出 3 题。`}
              </AlertDescription>
            </Alert>
            <p className="text-sm text-text-secondary">主屏将切入「认证聚焦」，全桌视线集中到答题者。出题/签印在手机私密进行。</p>
          </CardContent>
          <CardFooter><Button data-testid="flow2-enter" variant="primary" prefixIcon={<BadgeCheck size={14} />} onClick={onEnter}>进入认证聚焦</Button></CardFooter>
        </Card>
      )}
    </div>
  )
}

/* ================================================
   FLOW: Certification Climax
   SCREEN 2 of 4: Cert Focus (认证聚焦主舞台)
   ------------------------------------------------
   ENTRY:  Screen 1「进入认证聚焦」
   EXIT:   "查看质疑题目" → SCREEN 3 ｜ "看判定/复议" → SCREEN 4
   BRANCH: 三方视角 Tabs 切换（签印/质疑/弃权）
   ================================================ */
function Screen2_CertFocus({ state, onQuestions, onVerdict }: { state: GameState; onQuestions: () => void; onVerdict: () => void }) {
  const [submitting, setSubmitting] = useState(false)
  const t = state.certTargets[0]
  const pct = Math.min(100, Math.round((t.signed / t.need) * 100))
  const byRole = (role: Witness['role']) => state.witnesses.filter((w) => w.role === role)
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 聚焦舞台 */}
      <Card className="bg-bg-spotlight border-border-secondary">
        <CardHeader>
          <CardTitle className="text-2xl">待认证者 · 座{t.seat} {t.identityName}</CardTitle>
          <CardDescription>全桌注意力焦点 · 三方判定：出题 / 作证 / 复议</CardDescription>
          <CardAction><Tag color="warning">答题中</Tag></CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm"><span className="text-text-secondary">签印进度</span><span className="text-text">{t.signed} / {t.need}</span></div>
          <Progress value={pct} />
          <p className="text-xs text-text-secondary">集齐 {t.need} 枚签印 → 通过认证，坐上活人席</p>
        </CardContent>
      </Card>

      <Separator />

      {/* 三方视角 */}
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader><CardTitle>参与情况（全桌）</CardTitle><CardDescription>每人本轮「签印 / 质疑 / 弃权」三选一，降门槛后更多人参与</CardDescription></CardHeader>
        <CardContent>
          <Tabs defaultValue="sign">
            <TabsList>
              <TabsTrigger value="sign">签印（{byRole('signer').length}）</TabsTrigger>
              <TabsTrigger value="challenge">质疑（{byRole('challenger').length}）</TabsTrigger>
              <TabsTrigger value="witness">证人（{byRole('witness').length}）</TabsTrigger>
              <TabsTrigger value="abstain">弃权（{byRole('abstain').length}）</TabsTrigger>
            </TabsList>
            <TabsContent value="sign"><WitnessRow list={byRole('signer')} /></TabsContent>
            <TabsContent value="challenge"><WitnessRow list={byRole('challenger')} /></TabsContent>
            <TabsContent value="witness"><WitnessRow list={byRole('witness')} /></TabsContent>
            <TabsContent value="abstain"><WitnessRow list={byRole('abstain')} /></TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="justify-between">
          <Button variant="secondary" onClick={onQuestions}>查看质疑题目</Button>
          <Button variant="primary" loading={submitting} onClick={() => { setSubmitting(true); setTimeout(onVerdict, 600) }}>看判定 / 复议</Button>
        </CardFooter>
      </Card>
    </div>
  )
}

/* ================================================
   FLOW: Certification Climax
   SCREEN 3 of 4: Challenge Reveal (质疑题目公示)
   ------------------------------------------------
   ENTRY:  Screen 2「查看质疑题目」（质疑者在手机出题后，题目公开到主屏）
   EXIT:   "看判定/复议" → SCREEN 4
   BRANCH: 答题倒计时结束 → 自动进入判定
   ================================================ */
function Screen3_Questions({ state, onVerdict }: { state: GameState; onVerdict: () => void }) {
  const [secs, setSecs] = useState(45)
  const [syncErr, setSyncErr] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const passed = state.certQuestions.filter((q) => q.passed).length
  useEffect(() => {
    if (secs <= 0) { return }
    const id = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [secs])
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gavel size={16} /> 质疑出题 · 当场可验证</CardTitle>
          <CardDescription>题目由质疑者在手机私密提交，此刻对全桌公开。答对 2 问即通过。</CardDescription>
          <CardAction>
            <Tag color={secs > 10 ? 'info' : 'error'} className="flex items-center gap-1"><Timer size={12} /> 剩余 {secs}s</Tag>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {syncErr ? (
            <Alert variant="destructive">
              <AlertTitle>质疑题目同步失败</AlertTitle>
              <AlertDescription>手机已提交的题目未送达主屏，或已超时。请让质疑者重发，或在此重试拉取。</AlertDescription>
              <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => setSyncErr(false)}>重试同步</Button></div>
            </Alert>
          ) : (
          <ScrollArea className="h-64">
            <ul className="flex flex-col gap-3">
              {state.certQuestions.map((q) => (
                <li key={q.index} className="rounded-md border border-border-tertiary bg-bg-elevated p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-text">第 {q.index} 问</span>
                    {q.answered && <Tag color={q.passed ? 'success' : 'error'}>{q.passed ? '答对' : '答错'}</Tag>}
                  </div>
                  <p className="text-sm leading-relaxed text-text-secondary line-clamp-2" title={q.text}>{q.text}</p>
                </li>
              ))}
            </ul>
          </ScrollArea>
          )}
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">已答对 {passed} 问（需 ≥ 2）</span>
            {import.meta.env.DEV && (<Button variant="ghost" size="sm" onClick={() => setSyncErr(true)}>模拟题目丢失</Button>)}
          </div>
          <Button variant="primary" loading={submitting} onClick={() => { setSubmitting(true); setTimeout(onVerdict, 500) }}>看判定 / 复议</Button>
        </CardFooter>
      </Card>
    </div>
  )
}

/* ================================================
   FLOW: Certification Climax
   SCREEN 4 of 4: Verdict & Appeal (判定/复议公示)
   ------------------------------------------------
   ENTRY:  Screen 2/3「看判定 / 复议」
   EXIT:   终态 reveal → "返回" 退出 flow
   BRANCH: 待认证者付费申请复议 → 第三方投票
   ================================================ */
function Screen4_Verdict({ state, onBack }: { state: GameState; onBack: () => void }) {
  const [revealed, setRevealed] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const t = state.certTargets[0]
  const passed = state.certQuestions.filter((q) => q.passed).length >= 2
  const overturn = state.appealVotes.filter((a) => a.verdict === 'overturn').length
  const uphold = state.appealVotes.length - overturn
  const finalPass = state.appealVotes.length > 0 ? overturn > uphold : passed
  return (
    <div className="flex flex-col gap-4 p-4">
      <Card className="bg-bg-container border-border-secondary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BadgeCheck size={16} /> 认证判定</CardTitle>
          <CardDescription>质疑者判定，或经复议后第三方裁定 · 名场面在此揭晓</CardDescription>
          {!revealed && <CardAction><Button variant="primary" prefixIcon={<Sparkles size={14} />} loading={revealing} onClick={() => { setRevealing(true); setTimeout(() => { setRevealing(false); setRevealed(true) }, 600) }}>揭晓判定</Button></CardAction>}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!revealed ? (
            <Alert variant="info"><AlertTitle>等待揭晓</AlertTitle><AlertDescription>全桌屏息中——点击「揭晓判定」公布结果。</AlertDescription></Alert>
          ) : finalPass ? (
            <Alert variant="success"><AlertTitle>判定通过 · 座{t.seat} 是活人！</AlertTitle><AlertDescription>集齐 {t.need} 枚签印 / 答对达标 → 坐上活人席。</AlertDescription></Alert>
          ) : (
            <Alert variant="destructive"><AlertTitle>判定不通过</AlertTitle><AlertDescription>签印不足且答题未达标 → 从峰顶退回，需重新登顶。</AlertDescription></Alert>
          )}
          <Separator />
          <div>
            <p className="mb-2 text-sm font-medium text-text">证人席（含出局者参与）</p>
            <ul className="flex flex-col gap-1.5">
              {state.witnesses.map((w) => (
                <li key={w.seat} className="flex items-center justify-between text-sm">
                  <span className="text-text">座{w.seat} · {w.identityName}</span>
                  <Tag color={ROLE_COLOR[w.role]}>{ROLE_LABEL[w.role]}</Tag>
                </li>
              ))}
            </ul>
          </div>
          {state.appealVotes.length > 0 && (
            <>
              <Separator />
              <div className="flex items-center gap-2 text-sm">
                <Vote size={16} />
                <span className="text-text-secondary">复议投票：</span>
                <Tag color="error">推翻 {overturn}</Tag>
                <Tag color="success">维持 {uphold}</Tag>
              </div>
            </>
          )}
        </CardContent>
        <CardFooter>
          <Button variant="secondary" prefixIcon={<X size={14} />} onClick={onBack}>退出认证聚焦</Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export default function Flow2CertificationClimax() {
  const [screen, setScreen] = useState(1)
  const state = mockCertState
  const go = (n: number) => setScreen(n)
  return (
    <div data-testid="flow2-root" className="flex h-full flex-col">
      {/* 窄屏（<768px）页头纵向堆叠：标题一行 / 按钮一行（按钮 wrap + shrink-0 不被压扁）；桌面（≥768px）保持横向布局 */}
      <div className="flex flex-col gap-2 border-b border-border-tertiary bg-bg-layout px-4 py-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap font-medium text-text">Flow 2 · 认证高潮聚焦</span>
          <span data-testid="flow2-screen-indicator" data-screen={String(screen)} className="whitespace-nowrap text-sm text-text-secondary">屏 {screen}/4</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="flow2-prev" className="shrink-0 whitespace-nowrap" variant="secondary" size="sm" disabled={screen === 1} onClick={() => go(Math.max(1, screen - 1))}>← 上一步</Button>
          <Button data-testid="flow2-next" className="shrink-0 whitespace-nowrap" variant="primary" size="sm" disabled={screen === 4} onClick={() => go(Math.min(4, screen + 1))}>下一步 →</Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {screen === 1 && <Screen1_CertPrompt state={state} onEnter={() => go(2)} />}
        {screen === 2 && <Screen2_CertFocus state={state} onQuestions={() => go(3)} onVerdict={() => go(4)} />}
        {screen === 3 && <Screen3_Questions state={state} onVerdict={() => go(4)} />}
        {screen === 4 && <Screen4_Verdict state={state} onBack={() => go(1)} />}
      </div>
    </div>
  )
}
