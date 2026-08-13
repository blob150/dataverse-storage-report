import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  EnvironmentRow,
  TableRowCountResponse,
  TableRowCountRow,
} from '../../domain/types'
import type { StorageRepository } from '../../repositories/StorageRepository'
import { downloadCsv } from '../report/exportCsv'

type Props = {
  env: EnvironmentRow | null  // null closes the drawer
  onClose: () => void
  repo: StorageRepository
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

function fmtDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t).toLocaleString()
}

export function TableStorageDrawer({ env, onClose, repo }: Props) {
  const [search, setSearch] = useState('')
  const [data, setData] = useState<TableRowCountResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const totalRows = useMemo(
    () => data?.rows.reduce((s, r) => s + r.rowCount, 0) ?? 0,
    [data],
  )

  const filteredRows = useMemo(() => {
    if (!data) return [] as TableRowCountRow[]
    const q = search.trim().toLowerCase()
    if (!q) return data.rows
    return data.rows.filter(
      (r) => r.logicalName.toLowerCase().includes(q) || r.displayName.toLowerCase().includes(q),
    )
  }, [data, search])

  // Reset local UI state when opening a different env.
  useEffect(() => {
    if (env) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearch('')
      setError(null)
    }
  }, [env?.id, env])

  const load = useCallback(async (force: boolean) => {
    if (!env) return
    setLoading(true)
    setError(null)
    const seq = ++requestSeq.current
    try {
      const resp = await repo.getTableRowCounts(env, { force })
      if (seq !== requestSeq.current) return  // stale
      setData(resp)
    } catch (e) {
      if (seq !== requestSeq.current) return
      setError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [env, repo])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(false) }, [load])

  function exportCsv() {
    if (!env || !data) return
    const header = ['Display Name', 'Logical Name', 'Row Count', 'Custom']
    const rows = filteredRows.map((r) => [r.displayName, r.logicalName, r.rowCount.toString(), r.isCustom ? 'yes' : 'no'])
    const csv = [header, ...rows]
      .map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
      .join('\n')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    downloadCsv(
      `row-counts-${env.displayName.replace(/[^\w-]+/g, '_')}-${stamp}.csv`,
      csv,
    )
  }

  if (!env) return null

  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <div className="eyebrow">Per-table row counts</div>
            <h2 style={{ margin: '2px 0 0 0', fontSize: 18 }}>{env.displayName}</h2>
            <div className="muted-line" style={{ fontSize: 12 }}>
              {env.type} · {env.region}
              {env.url ? ` · ${env.url}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close per-table row-count drawer"
            className="drawer-close"
          >×</button>
        </header>

        <div className="drawer-toolbar">
          <input
            placeholder="Search table (display or logical name)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="drawer-search"
          />
          <button onClick={() => void load(true)} className="drawer-btn" disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={exportCsv} className="drawer-btn" disabled={!data || filteredRows.length === 0}>
            Export CSV
          </button>
        </div>

        <div className="drawer-status">
          {data && (
            <>
              <span>
                {filteredRows.length} of {data.rows.length} tables
                {totalRows > 0 && ` · ${fmtNum(totalRows)} total rows`}
              </span>
              <span style={{ color: 'var(--muted)' }}>
                Fetched {fmtDate(data.fetchedAt)}
              </span>
            </>
          )}
          {loading && !data && <span>Loading table row counts…</span>}
        </div>

        {error && (
          <div className="inline-error" style={{ margin: '0 16px 12px' }}>
            {error}
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Row counts are fetched by the DSR service principal via a Power Automate flow.
              The SP needs Application User + Read privilege on entities in the target environment.
            </div>
          </div>
        )}
        <div style={{ padding: '0 16px 8px', fontSize: 12, color: 'var(--muted)' }}>
          Showing your unmanaged custom tables plus a curated set of standard tables. Tables from installed managed solutions are omitted for performance.
        </div>

        <div className="drawer-body">
          <table className="drawer-table">
            <thead>
              <tr>
                <th>Table</th>
                <th className="num">Rows</th>
                <th className="num">% of total</th>
              </tr>
            </thead>
            <tbody>
              {(!data || filteredRows.length === 0) && (
                <tr>
                  <td colSpan={3} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                    {loading ? 'Loading…' : search ? 'No matching tables.' : 'No data.'}
                  </td>
                </tr>
              )}
              {data && filteredRows.map((r) => (
                <TableRow key={r.logicalName} row={r} total={totalRows} />
              ))}
            </tbody>
          </table>
        </div>

        <footer className="drawer-footer">
          <span className="muted-line" style={{ fontSize: 11 }}>
            Live row counts from Dataverse Web API (<code>RetrieveTotalRecordCount</code>).
            Bytes-per-table are not currently exposed by any Microsoft API to non-preauthorized apps.
          </span>
        </footer>
      </aside>
    </div>
  )
}

function TableRow({ row, total }: { row: TableRowCountRow; total: number }) {
  const pct = total > 0 ? (row.rowCount / total) * 100 : 0
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 500 }}>{row.displayName}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {row.logicalName}{row.isCustom ? ' · custom' : ''}
        </div>
      </td>
      <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtNum(row.rowCount)}</td>
      <td className="num" style={{ minWidth: 110 }}>
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
