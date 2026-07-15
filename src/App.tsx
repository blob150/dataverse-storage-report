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
} from './domain/types'
import { evaluateRows } from './domain/evaluate'
import { ReportPage } from './features/report/ReportPage'
import { SettingsPage } from './features/settings/SettingsPage'

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
      const [envs, snaps, s] = await Promise.all([
        r.listEnvironments(),
        r.listLatestSnapshots(),
        r.getSettings(),
      ])
      setEnvironments(envs)
      setSnapshots(snaps)
      setSettings(s)
    } catch (e) {
      setError(formatError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

      <TenantSummary rows={evaluated} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <TabButton active={tab === 'report'} onClick={() => setTab('report')}>Report</TabButton>
        <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>Settings</TabButton>
      </div>

      {tab === 'report' && (
        <ReportPage
          rows={evaluated}
          settings={settings}
          loading={loading}
          repo={repo}
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {  return (
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

function TenantSummary({ rows }: { rows: EvaluatedRow[] }) {
  const totals = rows.reduce(
    (acc, r) => {
      const s = r.snapshot
      if (!s) return acc
      acc.dbUsed += s.database.usedGb
      acc.dbAlloc += s.database.allocatedGb
      acc.fileUsed += s.file.usedGb
      acc.fileAlloc += s.file.allocatedGb
      acc.logUsed += s.log.usedGb
      acc.logAlloc += s.log.allocatedGb
      acc.payGo += s.payGoConsumptionGb
      if (r.payGoFlag) acc.payGoEnvs += 1
      return acc
    },
    { dbUsed: 0, dbAlloc: 0, fileUsed: 0, fileAlloc: 0, logUsed: 0, logAlloc: 0, payGo: 0, payGoEnvs: 0 },
  )

  const totalUsed = totals.dbUsed + totals.fileUsed + totals.logUsed
  const totalAlloc = totals.dbAlloc + totals.fileAlloc + totals.logAlloc
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const dim = (label: string, used: number, alloc: number, color: string) => {
    const denom = Math.max(used, alloc, 1)
    const allocPct = alloc > 0 ? Math.min(100, (Math.min(used, alloc) / denom) * 100) : 0
    const overPct = alloc > 0 && used > alloc ? Math.min(100 - allocPct, ((used - alloc) / denom) * 100) : 0
    const noQuotaPct = alloc <= 0 ? Math.min(100, (used / denom) * 100) : 0
    const quotaMarkerLeft = alloc > 0 && used > alloc ? `${(alloc / denom) * 100}%` : null
    return (
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, gap: 8 }}>
          <strong>{label}</strong>
          <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fmt(used)} GB{alloc > 0 ? ` / ${fmt(alloc)} GB` : ''}
          </span>
        </div>
        <div style={{ background: 'var(--border)', height: 10, borderRadius: 5, overflow: 'hidden', position: 'relative', display: 'flex' }}>
          {alloc > 0 ? (
            <>
              <div style={{ background: color, height: '100%', width: `${allocPct}%` }} />
              {overPct > 0 && (
                <div style={{ background: 'var(--over)', height: '100%', width: `${overPct}%` }} />
              )}
              {quotaMarkerLeft && (
                <div style={{ position: 'absolute', left: quotaMarkerLeft, top: 0, bottom: 0, width: 1, background: 'rgba(0,0,0,0.55)' }} />
              )}
            </>
          ) : (
            <div style={{ background: color, height: '100%', width: `${noQuotaPct}%`, opacity: 0.7 }} />
          )}
        </div>
        {alloc <= 0 && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>tenant pool (no manual quota)</div>
        )}
        {alloc > 0 && used > alloc && (
          <div style={{ fontSize: 11, color: 'var(--over)', marginTop: 2 }}>
            +{fmt(used - alloc)} GB over quota
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="status-card" style={{ background: 'white', borderRadius: 10, boxShadow: 'var(--shadow)', padding: 14, marginBottom: 12, width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15 }}>Tenant totals</h3>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Aggregated across {rows.length} environments. Manual quota = sum of per-env allocations from the licensing API; tenant-pool grant is not yet ingested.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <span><strong>{fmt(totalUsed)} GB</strong> total used</span>
          {totalAlloc > 0 && <span><strong>{fmt(totalAlloc)} GB</strong> manual quota</span>}
          {totals.payGo > 0 && <span style={{ color: 'var(--over)' }}><strong>+{fmt(totals.payGo)} GB</strong> PayGo</span>}
          {totals.payGoEnvs > 0 && <span>{totals.payGoEnvs} env{totals.payGoEnvs === 1 ? '' : 's'} on PayGo</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'nowrap' }}>
        {dim('Database', totals.dbUsed, totals.dbAlloc, 'var(--accent)')}
        {dim('File', totals.fileUsed, totals.fileAlloc, '#0ea5a4')}
        {dim('Log', totals.logUsed, totals.logAlloc, '#a855f7')}
      </div>
    </div>
  )
}
