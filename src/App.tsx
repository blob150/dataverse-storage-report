import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { appConfig } from './config'
import { createAuthProvider } from './auth/createAuthProvider'
import type { AuthProvider } from './auth/AuthProvider'
import { createRepository } from './repositories/createRepository'
import type { StorageRepository } from './repositories/StorageRepository'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type AppUser,
  type EnvironmentRow,
  type EvaluatedRow,
  type StorageSnapshot,
  type TenantPool,
} from './domain/types'
import { evaluateRows } from './domain/evaluate'
import { ReportPage } from './features/report/ReportPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TenantPoolCard } from './features/tenantpool/TenantPoolCard'

type Tab = 'report' | 'settings'

export default function App() {
  const [auth] = useState<AuthProvider>(() => createAuthProvider())
  const [repo, setRepo] = useState<StorageRepository | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('report')

  const [environments, setEnvironments] = useState<EnvironmentRow[]>([])
  const [snapshots, setSnapshots] = useState<StorageSnapshot[]>([])
  const [pool, setPool] = useState<TenantPool | null>(null)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    void (async () => {
      try {
        const existing = await auth.getCurrentUser()
        setUser(existing)
        if (existing) {
          const r = createRepository(auth)
          setRepo(r)
        }
      } catch (e) {
        setError(formatError(e))
      }
    })()
  }, [auth])

  const reload = useCallback(async (r: StorageRepository) => {
    setLoading(true)
    setError(null)
    try {
      const [envs, snaps, p, s] = await Promise.all([
        r.listEnvironments(),
        r.listLatestSnapshots(),
        r.getTenantPool(),
        r.getSettings(),
      ])
      setEnvironments(envs)
      setSnapshots(snaps)
      setPool(p)
      setSettings(s)
    } catch (e) {
      setError(formatError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (repo) void reload(repo)
  }, [repo, reload])

  async function signIn() {
    setSigningIn(true)
    setError(null)
    try {
      const u = await auth.signIn()
      setUser(u)
      const r = createRepository(auth)
      setRepo(r)
    } catch (e) {
      setError(formatError(e))
    } finally {
      setSigningIn(false)
    }
  }

  async function refreshNow() {
    if (!repo) return
    if (appConfig.refreshFlowUrl) {
      try {
        const res = await fetch(appConfig.refreshFlowUrl, { method: 'POST' })
        if (!res.ok) throw new Error(`Refresh flow returned ${res.status}`)
      } catch (e) {
        setError(`Could not trigger ingest flow: ${formatError(e)}`)
      }
    }
    await reload(repo)
  }

  async function saveSettings(next: AppSettings) {
    if (!repo) return
    setSettings(next)
    try {
      await repo.saveSettings(next)
    } catch (e) {
      setError(formatError(e))
    }
  }

  const evaluated: EvaluatedRow[] = useMemo(
    () => evaluateRows(environments, snapshots, settings),
    [environments, snapshots, settings],
  )

  const summary = useMemo(() => {
    let over = 0, warn = 0, paygo = 0
    for (const r of evaluated) {
      if (r.status === 'over') over++
      else if (r.status === 'warn') warn++
      if (r.payGoFlag) paygo++
    }
    return { total: evaluated.length, over, warn, paygo }
  }, [evaluated])

  if (!user) {
    return (
      <div className="app-shell centered-shell">
        <div className="status-card" style={{ background: 'white', borderRadius: 12, boxShadow: 'var(--shadow)' }}>
          <h2 style={{ margin: 0 }}>Dataverse Storage Report</h2>
          <p className="muted-line">
            Sign in with a Power Platform admin account to see Dataverse storage allocation
            and PayGo usage across every environment in the tenant.
          </p>
          {error && <div className="inline-error">{error}</div>}
          <div>
            <button onClick={signIn} disabled={signingIn} style={{ padding: '8px 16px', borderRadius: 6, background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer' }}>
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
          <p className="muted-line" style={{ fontSize: 12 }}>
            Running in <strong>{appConfig.authMode}</strong> mode.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="admin-header">
        <div className="title-row">
          <div className="title-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="6" rx="8" ry="3" />
              <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
              <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
            </svg>
          </div>
          <div>
            <span className="eyebrow">Power Platform admin</span>
            <h1 className="app-title">Dataverse Storage Report</h1>
            <span className="subtitle">Signed in as {user.displayName}</span>
          </div>
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="summary-grid">
        <Metric label="Environments" value={summary.total} />
        <Metric label="Over capacity" value={summary.over} valueColor={summary.over > 0 ? 'var(--over)' : undefined} />
        <Metric label="Warning" value={summary.warn} valueColor={summary.warn > 0 ? 'var(--warn)' : undefined} />
        <Metric label="PayGo accruing" value={summary.paygo} valueColor={summary.paygo > 0 ? 'var(--over)' : undefined} />
      </div>

      <TenantPoolCard pool={pool} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <TabButton active={tab === 'report'} onClick={() => setTab('report')}>Report</TabButton>
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>Settings</TabButton>
      </div>

      {tab === 'report' && (
        <ReportPage
          rows={evaluated}
          settings={settings}
          loading={loading}
          onRefresh={refreshNow}
          canRefresh={appConfig.authMode !== 'mock' || true}
        />
      )}
      {tab === 'settings' && (
        <SettingsPage settings={settings} onSave={saveSettings} />
      )}
    </div>
  )
}

function Metric({ label, value, valueColor }: { label: string; value: number; valueColor?: string }) {
  return (
    <div className="metric-card" style={{ background: 'white', borderRadius: 10, boxShadow: 'var(--shadow)' }}>
      <span className="metric-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19V5M9 19v-7M14 19V9M19 19v-4" />
        </svg>
      </span>
      <span>
        <strong style={{ fontSize: 22, color: valueColor }}>{value}</strong>
        <span className="muted-line" style={{ fontSize: 12 }}>{label}</span>
      </span>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 999,
        border: '1px solid var(--border)',
        background: active ? 'var(--accent)' : 'white',
        color: active ? 'white' : 'inherit',
        cursor: 'pointer', fontSize: 13,
      }}
    >
      {children}
    </button>
  )
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
