import type { TenantPool } from '../../domain/types'

type Props = { pool: TenantPool | null }

function fmt(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 1 }) }

export function TenantPoolCard({ pool }: Props) {
  if (!pool) {
    return (
      <div className="pool-card" style={{ background: 'white', borderRadius: 12, boxShadow: 'var(--shadow)' }}>
        <div className="pool-stat">
          <span className="muted-line">Tenant pool</span>
          <strong>—</strong>
          <span className="muted-line">No snapshot yet</span>
        </div>
      </div>
    )
  }
  const usedPct = pool.totalAllocatedGb > 0
    ? Math.round((pool.totalUsedGb / pool.totalAllocatedGb) * 100)
    : 0
  return (
    <div className="pool-card" style={{ background: 'white', borderRadius: 12, boxShadow: 'var(--shadow)' }}>
      <div className="pool-stat">
        <span className="muted-line">Tenant allocated</span>
        <strong>{fmt(pool.totalAllocatedGb)} GB</strong>
        <span className="muted-line">{fmt(pool.totalUsedGb)} GB used · {usedPct}%</span>
      </div>
      <div className="pool-stat">
        <span className="muted-line">Available to allocate</span>
        <strong style={{ color: pool.availableGb <= 0 ? 'var(--over)' : 'inherit' }}>
          {fmt(pool.availableGb)} GB
        </strong>
        <span className="muted-line">From tenant pool</span>
      </div>
      <div className="pool-stat">
        <span className="muted-line">PayGo accruing now</span>
        <strong style={{ color: pool.payGoAccrualGb > 0 ? 'var(--over)' : 'inherit' }}>
          {fmt(pool.payGoAccrualGb)} GB
        </strong>
        <span className="muted-line">Across all PayGo environments</span>
      </div>
    </div>
  )
}
