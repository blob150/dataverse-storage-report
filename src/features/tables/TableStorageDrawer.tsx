import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  EnvironmentRow,
  TableStorageDimension,
  TableStorageResponse,
  TableStorageRow,
} from '../../domain/types'
import { TABLE_STORAGE_DIMENSIONS } from '../../domain/types'
import type { StorageRepository } from '../../repositories/StorageRepository'
import { downloadCsv } from '../report/exportCsv'

type Props = {
  env: EnvironmentRow | null  // null closes the drawer
  onClose: () => void
  repo: StorageRepository
}

type CacheKey = string  // `${envId}::${dimension}`
type CacheEntry = { response: TableStorageResponse; loadedAt: number }

// In-memory session cache. Real-time data still, but re-opening the same env
// or flipping tabs doesn't re-hit the flow. Refresh button bypasses.
const cache = new Map<CacheKey, CacheEntry>()
function cacheKey(envId: string, dim: TableStorageDimension): CacheKey {
  return `${envId}::${dim}`
}

const PAGE_SIZE = 50

function fmtMb(n: number): string {
  if (n >= 1024) return (n / 1024).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' GB'
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MB'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t).toLocaleString()
}

export function TableStorageDrawer({ env, onClose, repo }: Props) {
  const [dimension, setDimension] = useState<TableStorageDimension>('Database')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [data, setData] = useState<TableStorageResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const totalConsumedMb = useMemo(
    () => data?.rows.reduce((s, r) => s + r.consumedMb, 0) ?? null,
    [data],
  )

  // Reset local UI state when opening a different env.
  useEffect(() => {
    if (env) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDimension('Database')
      setSearch('')
      setDebouncedSearch('')
      setError(null)
    }
  }, [env?.id, env])

  // Debounce the search box so we don't hit the flow on every keystroke.
  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(h)
  }, [search])

  const load = useCallback(async (force: boolean) => {
    if (!env) return
    const key = cacheKey(env.environmentId, dimension)
    // Only serve from cache when NO search is applied — otherwise we always
    // round-trip so server-side filter/sort is fresh.
    if (!force && !debouncedSearch) {
      const hit = cache.get(key)
      if (hit) {
        setData(hit.response)
        return
      }
    }
    setLoading(true)
    setError(null)
    const seq = ++requestSeq.current
    try {
      const resp = await repo.getTableStorage(env.environmentId, dimension, {
        search: debouncedSearch || undefined,
        skip: 0,
        top: PAGE_SIZE,
      })
      if (seq !== requestSeq.current) return  // stale
      setData(resp)
      if (!debouncedSearch) cache.set(key, { response: resp, loadedAt: Date.now() })
    } catch (e) {
      if (seq !== requestSeq.current) return
      setError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [env, dimension, debouncedSearch, repo])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(false) }, [load])

  function exportCsv() {
    if (!env || !data) return
    const header = ['Resource ID', `Consumed (MB)`, 'Last refreshed']
    const rows = data.rows.map((r) => [r.resourceId, r.consumedMb.toString(), r.lastRefreshedDate])
    const csv = [header, ...rows]
      .map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\n')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadCsv(
      `table-storage-${env.displayName.replace(/[^\w-]+/g, '_')}-${dimension.toLowerCase()}-${stamp}.csv`,
      csv,
    )
  }

  if (!env) return null

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <div className="eyebrow">Per-table storage</div>
            <h2 style={{ margin: '2px 0 0 0', fontSize: 18 }}>{env.displayName}</h2>
            <div className="muted-line" style={{ fontSize: 12 }}>
              {env.type} · {env.region}
              {env.url ? ` · ${env.url}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close per-table storage drawer"
            className="drawer-close"
          >×</button>
        </header>

        <div className="drawer-tabs">
          {TABLE_STORAGE_DIMENSIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDimension(d)}
              className={`drawer-tab${dimension === d ? ' active' : ''}`}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="drawer-toolbar">
          <input
            placeholder="Search resource"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="drawer-search"
          />
          <button onClick={() => void load(true)} className="drawer-btn" disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={exportCsv} className="drawer-btn" disabled={!data || data.rows.length === 0}>
            Export CSV
          </button>
        </div>

        <div className="drawer-status">
          {data && (
            <>
              <span>
                {data.rows.length} table{data.rows.length === 1 ? '' : 's'}
                {totalConsumedMb != null && ` · ${fmtMb(totalConsumedMb)} on this page`}
              </span>
              <span style={{ color: 'var(--muted)' }}>
                Data as of {fmtDate(data.latestRefreshDate)}
                {data.hasMore && ' · more rows available'}
              </span>
            </>
          )}
          {loading && !data && <span>Loading…</span>}
        </div>

        {error && (
          <div className="inline-error" style={{ margin: '0 16px 12px' }}>
            {error}
          </div>
        )}

        <div className="drawer-body">
          <table className="drawer-table">
            <thead>
              <tr>
                <th>Resource</th>
                <th className="num">Consumed</th>
                <th className="num">% of page</th>
              </tr>
            </thead>
            <tbody>
              {(!data || data.rows.length === 0) && (
                <tr>
                  <td colSpan={3} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                    {loading ? 'Loading…' : debouncedSearch ? 'No matching resources.' : 'No data.'}
                  </td>
                </tr>
              )}
              {data && data.rows.map((r) => (
                <TableRow key={r.resourceId} row={r} total={totalConsumedMb ?? 0} />
              ))}
            </tbody>
          </table>
        </div>

        <footer className="drawer-footer">
          <span className="muted-line" style={{ fontSize: 11 }}>
            Live from Microsoft's licensing service via the dsr-gettablestorage flow.
            Not cataloged in Dataverse. Freshness is set by Microsoft (typically 4–24h).
          </span>
        </footer>
      </aside>
    </div>
  )
}

function TableRow({ row, total }: { row: TableStorageRow; total: number }) {
  const pct = total > 0 ? (row.consumedMb / total) * 100 : 0
  return (
    <tr>
      <td>
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>
          {row.resourceId}
        </span>
      </td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtMb(row.consumedMb)}</td>
      <td className="num" style={{ minWidth: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pct.toFixed(1)}%</span>
          <span style={{ display: 'inline-block', width: 50, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, pct)}%`, background: 'var(--accent)' }} />
          </span>
        </div>
      </td>
    </tr>
  )
}
