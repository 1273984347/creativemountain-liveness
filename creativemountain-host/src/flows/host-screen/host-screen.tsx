// =============================================
// 创界山·活人认证 — 主屏 App Shell
// Integrates 4 flows · Scenario: Data Analytics/BI · platform host(主屏)
// Focus Rail = 主机/操作者的视图聚焦（非玩家路由）
// =============================================

import { Component, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Separator, SidebarMenu, ThemeStyleProvider, Toaster } from 'sparkdesign'
import { BadgeCheck, Settings, Trophy, Users } from 'lucide-react'
import Flow1HostDashboard from '../flow1-host-dashboard/flow1-host-dashboard'
import Flow2CertificationClimax from '../flow2-certification-climax/flow2-certification-climax'
import Flow3SettlementRank from '../flow3-settlement-rank/flow3-settlement-rank'
import Flow4SetupTutorial from '../flow4-setup-tutorial/flow4-setup-tutorial'

const NAV_ROUTES: Record<string, string> = {
  flow1: '/flow1',
  flow2: '/flow2',
  flow3: '/flow3',
  flow4: '/flow4',
}

const NAV_ITEMS = [
  { id: 'flow1', label: '实时状态看板', icon: <Users size={16} /> },
  { id: 'flow2', label: '认证高潮聚焦', icon: <BadgeCheck size={16} /> },
  { id: 'flow3', label: '终局结算 · 排名', icon: <Trophy size={16} /> },
  { id: 'flow4', label: '开局配置 · 教学', icon: <Settings size={16} /> },
]

class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 rounded-md bg-error-bg p-8 text-error">
          <p className="mb-2 font-semibold">页面发生错误</p>
          <pre className="text-sm whitespace-pre-wrap">{String(this.state.error)}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

export function CreativemountainHostApp() {
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light')
  const navigate = useNavigate()
  const location = useLocation()
  const activeId = Object.entries(NAV_ROUTES).find(([, p]) => location.pathname.startsWith(p))?.[0] ?? 'flow1'

  return (
    <ThemeStyleProvider appearance={appearance} theme="parchment" style="compact">
      <ErrorBoundary>
        <Toaster />
        <div className="flex h-screen bg-bg-base">
          {/* Focus Rail（主机视图聚焦） */}
          <aside className="flex w-56 shrink-0 flex-col border-r border-border-tertiary bg-bg-layout">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold text-text">创界山 · 主屏</span>
              <button
                type="button"
                aria-label={appearance === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
                className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                onClick={() => setAppearance((a) => (a === 'light' ? 'dark' : 'light'))}
              >
                {appearance === 'light' ? '暗色' : '亮色'}
              </button>
            </div>
            <Separator />
            <div className="p-2">
              <SidebarMenu items={NAV_ITEMS} selectedId={activeId} onItemClick={(item) => navigate(NAV_ROUTES[item.id])} />
            </div>
            <div className="mt-auto hidden p-4 text-xs text-text-secondary md:block">
              多端主屏原型 · host 显示公开状态<br />私密操作在手机端（flow-mobile）
            </div>
          </aside>

          {/* 主内容区 */}
          <main className="min-w-0 flex-1 overflow-auto">
            <div className="mx-auto h-full max-w-7xl">
              <Routes>
                <Route path="/" element={<Navigate to="/flow1" replace />} />
                <Route path="/flow1" element={<Flow1HostDashboard />} />
                <Route path="/flow2" element={<Flow2CertificationClimax />} />
                <Route path="/flow3" element={<Flow3SettlementRank />} />
                <Route path="/flow4" element={<Flow4SetupTutorial />} />
              </Routes>
            </div>
          </main>
        </div>
      </ErrorBoundary>
    </ThemeStyleProvider>
  )
}
