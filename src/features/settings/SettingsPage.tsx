import { useState } from 'react'
import type { AppSettings, EnvironmentType } from '../../domain/types'
import { ALL_ENVIRONMENT_TYPES } from '../../domain/types'

type Props = {
  settings: AppSettings
  onSave: (next: AppSettings) => void
}

export function SettingsPage({ settings, onSave }: Props) {
  const [warn, setWarn] = useState(settings.warnPercent)
  const [critical, setCritical] = useState(settings.criticalPercent)
  const [types, setTypes] = useState<Set<EnvironmentType>>(new Set(settings.defaultEnvironmentTypes))
  const [flowUrl, setFlowUrl] = useState(settings.tableStorageFlowUrl ?? '')
  const [saved, setSaved] = useState(false)

  function toggle(t: EnvironmentType) {
    const next = new Set(types)
    if (next.has(t)) next.delete(t); else next.add(t)
    setTypes(next)
  }

  function save() {
    onSave({
      warnPercent: warn,
      criticalPercent: critical,
      defaultEnvironmentTypes: Array.from(types),
      tableStorageFlowUrl: flowUrl.trim(),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="report-card" style={{ background: 'white', borderRadius: 12, boxShadow: 'var(--shadow)', display: 'grid', gap: 16 }}>
      <div>
        <h3 style={{ margin: '0 0 8px 0' }}>Thresholds</h3>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'auto 100px' }}>
          <label>Warning at (%)</label>
          <input type="number" min={0} max={1000} value={warn} onChange={(e) => setWarn(Number(e.target.value))} />
          <label>Over capacity at (%)</label>
          <input type="number" min={0} max={1000} value={critical} onChange={(e) => setCritical(Number(e.target.value))} />
        </div>
        <p className="muted-line" style={{ fontSize: 12, marginTop: 8 }}>
          Cells render green below the warning threshold, yellow at the warning threshold, and red at the
          over-capacity threshold. PayGo environments with any non-zero PayGo consumption are always flagged red.
        </p>
      </div>

      <div>
        <h3 style={{ margin: '0 0 8px 0' }}>Default visible environment types</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ALL_ENVIRONMENT_TYPES.map((t) => (
            <label key={t} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={types.has(t)} onChange={() => toggle(t)} /> {t}
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{ margin: '0 0 8px 0' }}>Per-table drill-in</h3>
        <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
          dsr-gettablestorage flow — HTTP trigger URL
        </label>
        <input
          type="url"
          value={flowUrl}
          onChange={(e) => setFlowUrl(e.target.value)}
          placeholder="https://prod-XX.westus.logic.azure.com:443/workflows/…"
          style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
        />
        <p className="muted-line" style={{ fontSize: 12, marginTop: 6 }}>
          Clicking an environment in the report opens a per-table storage drawer.
          The drawer fetches live per-resource consumption from Microsoft's licensing
          service through this passthrough flow — nothing is written to Dataverse.
          Paste the flow's <em>&ldquo;When an HTTP request is received&rdquo;</em> URL
          here (Maker portal → your flow → trigger → Copy). Leave blank to disable the drill-in.
        </p>
      </div>

      <div>
        <button onClick={save} style={{ padding: '8px 16px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Save settings
        </button>
        {saved && <span style={{ marginLeft: 12, color: 'var(--ok)' }}>Saved.</span>}
      </div>
    </div>
  )
}
