import { useEffect, useMemo, useState } from 'react'
import './App.css'

const tabs = ['dashboard', 'historical', 'work-orders']

function formatTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatHours(hours) {
  if (hours === undefined || hours === null) return '—'
  return `${hours}h`
}

function statusTint(status) {
  if (status === 'critical') return 'critical'
  if (status === 'warning') return 'warning'
  return 'healthy'
}

function severityTint(value) {
  if (value === 'critical') return 'critical'
  if (value === 'warning') return 'warning'
  return 'info'
}

function numeric(value, digits = 1) {
  return Number(value ?? 0).toFixed(digits)
}

function getChartPath(values, width, height, padding = 8) {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1

  return values
    .map((value, index) => {
      const x = padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2)
      const y = height - padding - ((value - min) / range) * (height - padding * 2)
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}

function DashboardChart({ values }) {
  const width = 220
  const height = 70
  const path = getChartPath(values, width, height)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="trend-svg" aria-label="trend chart">
      <path d={path} />
    </svg>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [dashboard, setDashboard] = useState(null)
  const [history, setHistory] = useState(null)
  const [orders, setOrders] = useState([])
  const [selectedAlertId, setSelectedAlertId] = useState(1)
  const [selectedAlert, setSelectedAlert] = useState(null)

  const refreshDashboard = async () => {
    const response = await fetch('/api/dashboard')
    const payload = await response.json()
    setDashboard(payload)
    if (!selectedAlertId && payload.alerts?.[0]) {
      setSelectedAlertId(payload.alerts[0].id)
    }
  }

  const refreshHistory = async () => {
    const response = await fetch('/api/historical')
    const payload = await response.json()
    setHistory(payload)
  }

  const refreshOrders = async () => {
    const response = await fetch('/api/workorders')
    const payload = await response.json()
    setOrders(payload.workOrders || [])
  }

  const refreshSelectedAlert = async (alertId) => {
    if (!alertId) return
    const response = await fetch(`/api/alerts/${alertId}`)
    if (response.ok) {
      const payload = await response.json()
      setSelectedAlert(payload)
    }
  }

  useEffect(() => {
    refreshDashboard()
    refreshHistory()
    refreshOrders()
  }, [])

  useEffect(() => {
    if (!selectedAlertId) return
    refreshSelectedAlert(selectedAlertId)
  }, [selectedAlertId])

  useEffect(() => {
    const interval = setInterval(() => {
      refreshDashboard()
      refreshHistory()
      refreshOrders()
      if (selectedAlertId) refreshSelectedAlert(selectedAlertId)
    }, 15000)
    return () => clearInterval(interval)
  }, [selectedAlertId])

  const handleAlertAction = async (type, alertId, reason = '') => {
    const actionMap = {
      acknowledge: '/acknowledge',
      dismiss: '/dismiss',
      workorder: '/work-order',
    }
    const endpoint = `/api/alerts/${alertId}${actionMap[type]}`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, assignee: 'A. Patel' }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      window.alert(payload.error || 'The action could not be completed.')
      return
    }
    await refreshDashboard()
    await refreshHistory()
    await refreshOrders()
    if (type === 'dismiss') {
      setSelectedAlertId(null)
      setSelectedAlert(null)
      return
    }
    if (alertId) await refreshSelectedAlert(alertId)
  }

  const handleOrderUpdate = async (orderId, delta) => {
    const response = await fetch(`/api/workorders/${orderId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(delta),
    })
    if (!response.ok) {
      window.alert('The work order could not be updated.')
      return
    }
    await refreshOrders()
  }

  const handleOrderDelete = async (orderId) => {
    const response = await fetch(`/api/workorders/${orderId}`, { method: 'DELETE' })
    if (!response.ok) {
      window.alert('The work order could not be deleted.')
      return
    }
    await refreshOrders()
    await refreshDashboard()
    if (selectedAlertId) await refreshSelectedAlert(selectedAlertId)
  }

  const stats = dashboard?.stats || {
    uptime: 0,
    jointsMonitored: 0,
    openAlerts: 0,
    avgDetectionLeadTime: 0,
  }

  const alertRows = dashboard?.alerts || []
  const jointRows = dashboard?.joints || []

  const coverage = useMemo(() => {
    const total = jointRows.length || 1
    const healthyCount = jointRows.filter((joint) => joint.status === 'healthy').length
    return Math.round((healthyCount / total) * 100)
  }, [jointRows])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <img className="brand-logo" src="/logo.svg" alt="BeltCare" />
          <div>
            <h1>BeltCare</h1>
          </div>
        </div>

        <nav className="nav" aria-label="Main navigation">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'nav-item active' : 'nav-item'}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab === 'dashboard' ? 'Dashboard' : tab === 'historical' ? 'Historical Trends' : 'Work Orders'}
            </button>
          ))}
        </nav>

        <div className="side-panel mini-panel">
          <div className="panel-label">Plant health</div>
          <div className="big-number">{coverage}%</div>
          <div className="muted">Healthy belt joints</div>
        </div>
      </aside>

      <main className="main-panel">
        {activeTab === 'dashboard' && (
          <>
            <header className="top-bar">
              <div>
                <div className="panel-label">Live plant overview</div>
                <h2>Mine conveyor integrity</h2>
              </div>
              <div className="timestamp">Last refresh {dashboard ? formatTime(dashboard.generatedAt) : '—'}</div>
            </header>

            <section className="operating-strip" aria-label="Operating context">
              <div>
                <span className="strip-label">Operating area</span>
                <strong>{dashboard?.feed?.area || '—'}</strong>
                <small>{dashboard?.feed?.shift || '—'}</small>
              </div>
              <div>
                <span className="strip-label">Feed rate</span>
                <strong>{dashboard?.feed?.oreRate || '—'} {dashboard?.feed?.oreRateUnit || ''}</strong>
                <small>Current material flow</small>
              </div>
              <div>
                <span className="strip-label">Ambient</span>
                <strong>{dashboard?.feed?.ambient || '—'}{dashboard?.feed?.ambientUnit || ''}</strong>
                <small>Weather station W-02</small>
              </div>
            </section>

            <section className="stats-grid">
              <div className="stat-card"><span className="label">Uptime</span><strong>{numeric(stats.uptime, 2)}%</strong></div>
              <div className="stat-card"><span className="label">Joints monitored</span><strong>{stats.jointsMonitored}</strong></div>
              <div className="stat-card"><span className="label">Open alerts</span><strong>{stats.openAlerts}</strong></div>
              <div className="stat-card"><span className="label">Avg detection lead</span><strong>{numeric(stats.avgDetectionLeadTime, 1)}h</strong></div>
            </section>

            <section className="content-grid dashboard-grid">
              <div className="panel layout-panel">
                <div className="panel-header">
                  <h3>Plant layout</h3>
                  <span className="panel-tag">Schematic</span>
                </div>
                <div className="belt-layout">
                  <div className="belt-track" />
                  {jointRows.map((joint) => (
                    <button
                      key={joint.id}
                      type="button"
                      className={`joint-node ${statusTint(joint.status)}`}
                      style={{ left: `${(joint.id / (jointRows.length + 1)) * 100}%` }}
                      onClick={() => setSelectedAlertId(alertRows.find((alert) => alert.joint_id === joint.id)?.id || null)}
                    >
                      <span className="dot" />
                      <span>{joint.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel sensor-panel">
                <div className="panel-header">
                  <h3>Live sensor readout</h3>
                  <span className="panel-tag">Active joints</span>
                </div>
                <div className="sensor-list">
                  {jointRows.map((joint) => (
                    <div key={joint.id} className="sensor-row">
                      <div>
                        <strong>{joint.name}</strong>
                        <small>{joint.zone}</small>
                      </div>
                      <div className="sensor-values">
                        <span>V {numeric(joint.vibration, 2)} mm/s</span>
                        <span>A {numeric(joint.acoustic, 1)} dB</span>
                        <span>I {numeric(joint.current, 1)} A</span>
                        <span>T {numeric(joint.thermal, 1)}°C</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="content-grid lower-grid">
              <div className="panel alert-list-panel">
                <div className="panel-header">
                  <h3>Current alerts</h3>
                  <span className="panel-tag">{alertRows.length} active</span>
                </div>
                <div className="alert-list">
                  {alertRows.map((alert) => (
                    <button
                      key={alert.id}
                      className={selectedAlertId === alert.id ? 'alert-item selected' : 'alert-item'}
                      onClick={() => setSelectedAlertId(alert.id)}
                      type="button"
                    >
                      <div className="alert-meta">
                        <span className={`status-badge ${severityTint(alert.severity)}`}>{alert.severity}</span>
                        <span className="alert-mode">{alert.failure_mode}</span>
                      </div>
                      <strong>{alert.joint_name}</strong>
                      <div className="alert-bottom">
                        <span>RUL {formatHours(alert.remaining_life_hours)}</span>
                        <span>{alert.status}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel detail-panel">
                {selectedAlert ? (
                  <>
                    <div className="panel-header">
                      <h3>{selectedAlert.joint_name}</h3>
                      <span className={`status-badge ${severityTint(selectedAlert.severity)}`}>{selectedAlert.severity}</span>
                    </div>
                    <div className="detail-summary">
                      <div>
                        <div className="muted">Failure mode</div>
                        <strong>{selectedAlert.failure_mode}</strong>
                      </div>
                      <div>
                        <div className="muted">Remaining life</div>
                        <strong>{formatHours(selectedAlert.remaining_life_hours)}</strong>
                      </div>
                    </div>

                    <div className="trend-block">
                      <div className="label-row">
                        <span>Model-triggering trend</span>
                        <small>{selectedAlert.failure_mode.toUpperCase()}</small>
                      </div>
                      <DashboardChart values={selectedAlert.trend?.map((point) => point.vibration) || [3, 4, 5, 4, 5, 6, 5, 7]} />
                    </div>

                    <div className="explainability-box">
                      <h4>Explainability</h4>
                      <p>{selectedAlert.model_note}</p>
                    </div>

                    <div className="action-row">
                      <button type="button" className="primary" onClick={() => handleAlertAction('acknowledge', selectedAlert.id, 'Operator confirmed inspection request.')}>Acknowledge</button>
                      <button type="button" className="secondary" onClick={() => handleAlertAction('dismiss', selectedAlert.id, 'False alarm review completed.')}>Dismiss as false alarm</button>
                      <button type="button" className="secondary" onClick={() => handleAlertAction('workorder', selectedAlert.id, 'Create work order from model alert.')}>Create work order</button>
                    </div>

                    {selectedAlert.feedback?.length > 0 && (
                      <div className="feedback-log">
                        <h4>Feedback log</h4>
                        {selectedAlert.feedback.map((entry) => (
                          <div key={`${entry.action}-${entry.created_at}`} className="log-item">
                            <span>{entry.action}</span>
                            <small>{entry.note}</small>
                            <time>{formatTime(entry.created_at)}</time>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-state">Select an alert to inspect the defect trend and operator actions.</div>
                )}
              </div>
            </section>
          </>
        )}

        {activeTab === 'historical' && (
          <>
            <header className="top-bar">
              <div>
                <div className="panel-label">Degradation monitoring</div>
                <h2>Historical trends</h2>
              </div>
              <a className="download-btn" href="/api/report/dgms" target="_blank" rel="noreferrer">Export DGMS report</a>
            </header>

            <section className="historical-layout">
              <div className="panel trend-panel">
                <div className="panel-header">
                  <h3>Joint degradation trends</h3>
                  <span className="panel-tag">Last 36 hours</span>
                </div>
                <div className="trend-grid">
                  {history?.trendByJoint?.map((joint) => (
                    <div key={joint.jointId} className="trend-card">
                      <strong>{joint.jointName}</strong>
                      <DashboardChart values={joint.series.map((point) => point.vibration)} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel incidents-panel">
                <div className="panel-header">
                  <h3>Incident history</h3>
                  <span className="panel-tag">Incident log</span>
                </div>
                <table className="table-list">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Joint</th>
                      <th>Event</th>
                      <th>Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history?.incidents?.map((event) => (
                      <tr key={event.id}>
                        <td>{formatTime(event.timestamp)}</td>
                        <td>{history.joints.find((joint) => joint.id === event.joint_id)?.name || 'Unknown'}</td>
                        <td>{event.title}</td>
                        <td><span className={`status-badge ${severityTint(event.severity)}`}>{event.severity}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === 'work-orders' && (
          <>
            <header className="top-bar">
              <div>
                <div className="panel-label">Maintenance planning</div>
                <h2>Work orders</h2>
              </div>
            </header>

            <section className="panel work-orders-panel">
              <table className="table-list orders-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Assignee</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.title}</td>
                      <td>
                        <input
                          type="text"
                          defaultValue={order.assignee}
                          onBlur={(event) => handleOrderUpdate(order.id, { assignee: event.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          defaultValue={order.status}
                          onChange={(event) => handleOrderUpdate(order.id, { status: event.target.value })}
                        >
                          <option value="scheduled">Scheduled</option>
                          <option value="in_progress">In progress</option>
                          <option value="completed">Completed</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="datetime-local"
                          defaultValue={new Date(order.due_date).toISOString().slice(0, 16)}
                          onBlur={(event) => handleOrderUpdate(order.id, { due_date: new Date(event.target.value).toISOString() })}
                        />
                      </td>
                      <td className="order-actions">
                        <button type="button" className="secondary small" onClick={() => handleAlertAction('workorder', order.alert_id || 1)}>Remediate</button>
                        <button type="button" className="danger small" onClick={() => handleOrderDelete(order.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default App
