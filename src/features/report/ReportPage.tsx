import { useMemo, useState } from 'react'
import type {
  AppSettings,
  EnvironmentRow,
  EvaluatedRow,
  EnvironmentType,
  Thresholds,
} from '../../domain/types'
import { ALL_ENVIRONMENT_TYPES, isPoolImpacting } from '../../domain/types'
import { cellClass } from '../../domain/evaluate'
import { downloadCsv, rowsToCsv } from './exportCsv'
import type { StorageRepository } from '../../repositories/StorageRepository'
import { TableStorageDrawer } from '../tables/TableStorageDrawer'

type SortKey =
  | 'name' | 'type' | 'region' | 'owner' | 'billing' | 'paygo'
  | 'dbPct' | 'filePct' | 'logPct' | 'overage' | 'status'

type Props = {
  rows: EvaluatedRow[]
  settings: AppSettings
  loading: boolean
  repo: StorageRepository | null
}

function fmtNum(n: number, digits = 1) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function statusRank(s: EvaluatedRow['status']) {
  return s === 'over' ? 0 : s === 'warn' ? 1 : 2
}

export function ReportPage({ rows, settings, loading, repo }: Props) {
  const [query, setQuery] = useState('')
  const [types, setTypes] = useState<Set<EnvironmentType>>(
    () => new Set(settings.defaultEnvironmentTypes),
  )
  const [onlyTriggered, setOnlyTriggered] = useState(false)
  const [onlyPayGo, setOnlyPayGo] = useState(false)
  const [onlyPoolImpacting, setOnlyPoolImpacting] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  // Env whose per-table drill-in drawer is currently open. null = closed.
  const [drilledEnv, setDrilledEnv] = useState<EnvironmentRow | null>(null)

  const thresholds: Thresholds = {
    warnPercent: settings.warnPercent,
    criticalPercent: settings.criticalPercent,
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (!types.has(r.environment.type)) return false
      if (onlyTriggered && r.status === 'ok') return false
      if (onlyPayGo && !r.payGoFlag) return false
      if (onlyPoolImpacting && !isPoolImpacting(r.environment.type)) return false
      if (!q) return true
      const dn = (r.environment.displayName ?? '').toLowerCase()
      const oe = (r.environment.ownerEmail ?? '').toLowerCase()
      const on = (r.environment.ownerName ?? '').toLowerCase()
      const rg = (r.environment.region ?? '').toLowerCase()
      return dn.includes(q) || oe.includes(q) || on.includes(q) || rg.includes(q)
    })
  }, [rows, query, types, onlyTriggered, onlyPayGo, onlyPoolImpacting])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      const va = sortVal(a, sortKey)
      const vb = sortVal(b, sortKey)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
    return arr
  }, [filtered, sortKey, sortDir])

  function toggleType(t: EnvironmentType) {
    const next = new Set(types)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    setTypes(next)
  }

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  function exportNow() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadCsv(`dataverse-storage-${stamp}.csv`, rowsToCsv(sorted))
  }

  const lastUpdated = useMemo(() => {
    let max = 0
    for (const r of rows) {
      const t = r.snapshot ? Date.parse(r.snapshot.capturedAt) : NaN
      if (!Number.isNaN(t) && t > max) max = t
    }
    return max > 0 ? new Date(max) : null
  }, [rows])

  const lastUpdatedLabel = loading
    ? 'Loading…'
    : lastUpdated
      ? `Last updated ${lastUpdated.toLocaleString()}`
      : 'No snapshot data yet'

  return (
    <div className="report-card" style={{ background: 'white', borderRadius: 12, boxShadow: 'var(--shadow)' }}>
      <div className="toolbar">
        <div style={{ flex: 1, minWidth: 220 }}>
          <input
            placeholder="Search environment, owner, region"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted-line" style={{ fontSize: 12 }}>Types:</span>
          {ALL_ENVIRONMENT_TYPES.map((t) => (
            <label key={t} style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={types.has(t)} onChange={() => toggleType(t)} /> {t}
            </label>
          ))}
        </div>

        <label style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyTriggered} onChange={(e) => setOnlyTriggered(e.target.checked)} />
          Only triggered
        </label>
        <label style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyPayGo} onChange={(e) => setOnlyPayGo(e.target.checked)} />
          Only PayGo
        </label>
        <label
          style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}
          title="Hide environments with their own per-user storage (Developer, Teams, Trial) that don't count against the tenant pool"
        >
          <input type="checkbox" checked={onlyPoolImpacting} onChange={(e) => setOnlyPoolImpacting(e.target.checked)} />
          Only pool-impacting
        </label>

        <button onClick={exportNow} style={btn}>Export CSV</button>
        <span
          className="muted-line"
          style={{ fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }}
          title="Storage data is refreshed daily by the ingest flow"
        >
          {lastUpdatedLabel}
        </span>
      </div>

      <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
        <table className="report-table">
          <thead>
            <tr>
              <Th onClick={() => sortBy('name')}    sort={sortKey === 'name'    ? sortDir : null}>Environment</Th>
              <Th onClick={() => sortBy('type')}    sort={sortKey === 'type'    ? sortDir : null}>Type</Th>
              <Th onClick={() => sortBy('region')}  sort={sortKey === 'region'  ? sortDir : null}>Region</Th>
              <Th onClick={() => sortBy('owner')}   sort={sortKey === 'owner'   ? sortDir : null}>Owner</Th>
              <Th onClick={() => sortBy('billing')} sort={sortKey === 'billing' ? sortDir : null}>Billing</Th>
              <Th onClick={() => sortBy('paygo')}   sort={sortKey === 'paygo'   ? sortDir : null}>PayGo</Th>
              <Th onClick={() => sortBy('dbPct')}   sort={sortKey === 'dbPct'   ? sortDir : null} className="num">Database</Th>
              <Th onClick={() => sortBy('filePct')} sort={sortKey === 'filePct' ? sortDir : null} className="num">File</Th>
              <Th onClick={() => sortBy('logPct')}  sort={sortKey === 'logPct'  ? sortDir : null} className="num">Log</Th>
              <Th onClick={() => sortBy('overage')} sort={sortKey === 'overage' ? sortDir : null} className="num">Overage GB</Th>
              <Th onClick={() => sortBy('status')}  sort={sortKey === 'status'  ? sortDir : null}>Status</Th>
              <th>Triggered by</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                {loading ? 'Loading…' : 'No environments match the current filters.'}
              </td></tr>
            )}
            {sorted.map((r) => {
              const s = r.snapshot
              const drillable = Boolean(repo)
              return (
                <tr
                  key={r.environment.id}
                  onClick={drillable ? () => setDrilledEnv(r.environment) : undefined}
                  style={drillable ? { cursor: 'pointer' } : undefined}
                  title={drillable ? 'Open per-table storage breakdown' : undefined}
                >
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.environment.displayName}</div>
                    {r.environment.url && (
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.environment.url}</div>
                    )}
                  </td>
                  <td>
                    <div>{r.environment.type}</div>
                    {!isPoolImpacting(r.environment.type) && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Standalone
                      </div>
                    )}
                  </td>
                  <td>{r.environment.region}</td>
                  <td>
                    <div>{r.environment.ownerName}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.environment.ownerEmail}</div>
                  </td>
                  <td>
                    {r.environment.billingModel}
                    {r.environment.billingModel === 'PayAsYouGo' && (
                      <div><span className="paygo-badge">PayGo</span></div>
                    )}
                  </td>
                  <td>
                    {r.payGoFlag ? (
                      <span className="paygo-badge" style={{ background: 'var(--over)', color: 'white' }}>
                        Yes{s && s.payGoConsumptionGb > 0 ? ` · ${fmtNum(s.payGoConsumptionGb)} GB` : ''}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>No</span>
                    )}
                  </td>
                  {(['database', 'file', 'log'] as const).map((kind) => {
                    const dim = s ? s[kind] : null
                    if (!dim) return <td key={kind} className="num">—</td>
                    if (dim.allocatedGb <= 0) {
                      const noQuotaLabel = dim.usedGb > 0
                        ? (isPoolImpacting(r.environment.type) ? 'tenant pool' : 'standalone')
                        : 'no usage'
                      return (
                        <td key={kind} className="num">
                          <div style={{ fontWeight: 600 }}>{fmtNum(dim.usedGb)} GB</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {noQuotaLabel}
                          </div>
                        </td>
                      )
                    }
                    return (
                      <td key={kind} className="num">
                        <div className={cellClass(dim.percent, thresholds)}>
                          {fmtNum(dim.percent, 1)}%
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {fmtNum(dim.usedGb)} / {fmtNum(dim.allocatedGb)} GB
                        </div>
                      </td>
                    )
                  })}
                  <td className="num">
                    {(() => {
                      if (!s) return '—'
                      // Compute overage only against actual manual quotas. The
                      // stored dsr_overagegb is derived from the licensing API's
                      // availableQuantity, which can swing negative for tenant-pool
                      // envs even when no manual quota has been exceeded — that's
                      // the noise users see ("0.5 GB over but Status=OK").
                      const dims = [s.database, s.file, s.log]
                      const realOver = dims.reduce(
                        (sum, d) => sum + (d.allocatedGb > 0 && d.usedGb > d.allocatedGb ? d.usedGb - d.allocatedGb : 0),
                        0,
                      )
                      if (realOver <= 0) return fmtNum(0)
                      return <span className="cell-over">{fmtNum(realOver)}</span>
                    })()}
                  </td>
                  <td><StatusPill status={r.status} /></td>
                  <td>
                    <div className="triggers">
                      {r.triggers.map((t) => (
                        <span key={`${t.kind}-${t.status}`} className={`trigger-chip${t.status === 'warn' ? ' warn' : ''}`}>
                          {t.kind} {fmtNum(t.percent, 0)}%
                        </span>
                      ))}
                      {r.payGoFlag && (
                        <span className="trigger-chip paygo">PayGo +{fmtNum(s?.payGoConsumptionGb ?? 0)} GB</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {repo && (
        <TableStorageDrawer
          env={drilledEnv}
          onClose={() => setDrilledEnv(null)}
          repo={repo}
        />
      )}
    </div>
  )
}

function Th({
  children, onClick, sort, className,
}: { children: React.ReactNode; onClick: () => void; sort: 'asc' | 'desc' | null; className?: string }) {
  return (
    <th onClick={onClick} className={className}>
      {children}{sort ? (sort === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
}

function StatusPill({ status }: { status: EvaluatedRow['status'] }) {
  const label = status === 'over' ? 'Over capacity' : status === 'warn' ? 'Warning' : 'OK'
  return <span className={`status-pill ${status}`}>{label}</span>
}

function sortVal(r: EvaluatedRow, key: SortKey): string | number {
  const s = r.snapshot
  switch (key) {
    case 'name': return r.environment.displayName.toLowerCase()
    case 'type': return r.environment.type
    case 'region': return r.environment.region
    case 'owner': return r.environment.ownerName.toLowerCase()
    case 'billing': return r.environment.billingModel
    case 'paygo': return r.payGoFlag ? (s?.payGoConsumptionGb ?? 0.001) * -1 : 1
    case 'dbPct': return s?.database.percent ?? -1
    case 'filePct': return s?.file.percent ?? -1
    case 'logPct': return s?.log.percent ?? -1
    case 'overage': return s?.overageGb ?? -1
    case 'status': return statusRank(r.status)
  }
}

const btn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'white', cursor: 'pointer', fontSize: 13,
}
