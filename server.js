import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, 'data');
const runtimeDbDir = process.env.VERCEL ? '/tmp/beltcare' : dbDir;
const dbPath = path.join(runtimeDbDir, 'beltcare.sqlite');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const SQL = await initSqlJs();
let db = null;

function persistDatabase() {
  if (!db) return;
  fs.mkdirSync(runtimeDbDir, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) {
    stmt.bind(params);
  }
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) {
    stmt.bind(params);
  }
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function seededNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function toISO(ts) {
  return new Date(ts).toISOString();
}

function getLatestJointReadings() {
  const rows = queryAll(
    `SELECT r.joint_id, r.timestamp, r.vibration, r.acoustic, r.current, r.thermal
     FROM readings r
     INNER JOIN (
       SELECT joint_id, MAX(timestamp) as max_ts
       FROM readings
       GROUP BY joint_id
     ) latest ON r.joint_id = latest.joint_id AND r.timestamp = latest.max_ts
     ORDER BY r.joint_id ASC`
  );
  const result = {};
  rows.forEach((row) => {
    result[row.joint_id] = row;
  });
  return result;
}

function getSimulatedLiveReading(reading, jointId) {
  if (!reading) return null;

  const cycle = Date.now() / 1000 / 60;
  const phase = cycle / 3.8 + jointId;
  const loadFactor = 1 + Math.sin(phase) * 0.025;

  return {
    ...reading,
    timestamp: new Date().toISOString(),
    vibration: Number((Number(reading.vibration) * loadFactor + Math.sin(phase * 1.7) * 0.04).toFixed(2)),
    acoustic: Number((Number(reading.acoustic) * loadFactor + Math.sin(phase * 1.3) * 0.3).toFixed(1)),
    current: Number((Number(reading.current) * loadFactor + Math.cos(phase) * 0.8).toFixed(1)),
    thermal: Number((Number(reading.thermal) + Math.sin(phase / 2) * 0.15).toFixed(1)),
  };
}

function readProjectData() {
  return queryAll(`SELECT * FROM joints ORDER BY id ASC`);
}

function computeStatus(reading) {
  if (!reading) return 'healthy';
  const vibration = Number(reading.vibration || 0);
  const acoustic = Number(reading.acoustic || 0);
  const current = Number(reading.current || 0);
  const thermal = Number(reading.thermal || 0);

  if (vibration > 5.7 || acoustic > 102 || current > 255 || thermal > 88) {
    return 'critical';
  }
  if (vibration > 4.3 || acoustic > 90 || current > 220 || thermal > 74) {
    return 'warning';
  }
  return 'healthy';
}

function insertFeedback(alertId, action, note) {
  db.run(
    `INSERT INTO feedback_log (alert_id, action, note, created_at)
     VALUES (?, ?, ?, ?)`,
    [alertId, action, note, new Date().toISOString()]
  );
  persistDatabase();
}

function createTrendSeries(jointId, limit = 32) {
  const rows = queryAll(
    `SELECT timestamp, vibration, acoustic, current, thermal
     FROM readings
     WHERE joint_id = ?
     ORDER BY timestamp DESC
     LIMIT ${limit}`,
    [jointId]
  ).reverse();

  return rows.map((row) => ({
    time: row.timestamp,
    vibration: Number(row.vibration),
    acoustic: Number(row.acoustic),
    current: Number(row.current),
    thermal: Number(row.thermal),
  }));
}

function generateSeedData() {
  const joints = [
    { id: 1, name: 'Conveyor CV-04, Joint 3', conveyor: 'CV-04', zone: 'Belt drive discharge', status: 'warning' },
    { id: 2, name: 'Conveyor CV-04, Joint 5', conveyor: 'CV-04', zone: 'Transfer tower', status: 'healthy' },
    { id: 3, name: 'Conveyor CV-06, Joint 1', conveyor: 'CV-06', zone: 'Ore loading chute', status: 'healthy' },
    { id: 4, name: 'Conveyor CV-07, Joint 2', conveyor: 'CV-07', zone: 'Primary crusher feed', status: 'warning' },
    { id: 5, name: 'Conveyor CV-09, Joint 4', conveyor: 'CV-09', zone: 'Sinter discharge', status: 'critical' },
    { id: 6, name: 'Conveyor CV-09, Joint 7', conveyor: 'CV-09', zone: 'Stacker transfer', status: 'healthy' },
    { id: 7, name: 'Conveyor CV-12, Joint 1', conveyor: 'CV-12', zone: 'Pellet plant feed', status: 'warning' },
    { id: 8, name: 'Conveyor CV-12, Joint 6', conveyor: 'CV-12', zone: 'Tail pulley return', status: 'healthy' },
  ];

  db.exec(`
    CREATE TABLE joints (
      id INTEGER PRIMARY KEY,
      name TEXT,
      conveyor TEXT,
      zone TEXT,
      status TEXT
    );

    CREATE TABLE readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      joint_id INTEGER,
      timestamp TEXT,
      vibration REAL,
      acoustic REAL,
      current REAL,
      thermal REAL,
      FOREIGN KEY (joint_id) REFERENCES joints(id)
    );

    CREATE TABLE alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      joint_id INTEGER,
      title TEXT,
      severity TEXT,
      failure_mode TEXT,
      failure_reason TEXT,
      status TEXT,
      lead_time_hours INTEGER,
      remaining_life_hours INTEGER,
      model_confidence REAL,
      created_at TEXT,
      updated_at TEXT,
      model_note TEXT,
      FOREIGN KEY (joint_id) REFERENCES joints(id)
    );

    CREATE TABLE feedback_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER,
      action TEXT,
      note TEXT,
      created_at TEXT,
      FOREIGN KEY (alert_id) REFERENCES alerts(id)
    );

    CREATE TABLE incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      joint_id INTEGER,
      title TEXT,
      timestamp TEXT,
      summary TEXT,
      severity TEXT,
      FOREIGN KEY (joint_id) REFERENCES joints(id)
    );

    CREATE TABLE work_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER,
      title TEXT,
      assignee TEXT,
      status TEXT,
      due_date TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (alert_id) REFERENCES alerts(id)
    );
  `);

  joints.forEach((joint) => {
    db.run(
      `INSERT INTO joints (id, name, conveyor, zone, status) VALUES (?, ?, ?, ?, ?)`,
      [joint.id, joint.name, joint.conveyor, joint.zone, joint.status]
    );
  });

  const baseNow = Date.now();
  joints.forEach((joint, index) => {
    const base = {
      1: { vibration: 5.1, acoustic: 96, current: 234, thermal: 79 },
      2: { vibration: 4.1, acoustic: 88, current: 214, thermal: 69 },
      3: { vibration: 3.6, acoustic: 82, current: 202, thermal: 67 },
      4: { vibration: 4.8, acoustic: 93, current: 228, thermal: 77 },
      5: { vibration: 6.8, acoustic: 108, current: 268, thermal: 90 },
      6: { vibration: 3.4, acoustic: 81, current: 194, thermal: 63 },
      7: { vibration: 5.2, acoustic: 94, current: 236, thermal: 81 },
      8: { vibration: 3.1, acoustic: 79, current: 188, thermal: 61 },
    }[joint.id] ?? { vibration: 3.8, acoustic: 85, current: 200, thermal: 64 };

    for (let hour = 0; hour < 40; hour += 1) {
      const timestamp = new Date(baseNow - (39 - hour) * 60 * 60 * 1000).toISOString();
      const shiftLoad = [0.92, 1.04, 0.98][Math.floor((hour + 6) / 8) % 3];
      const oreSurge = hour === 11 || hour === 28 ? 1.08 : 1;
      const localNoise = seededNoise(joint.id * 100 + hour);
      const vibrationNoise = seededNoise(joint.id * 1000 + hour * 7);
      const acousticNoise = seededNoise(joint.id * 2000 + hour * 11);
      const thermalNoise = seededNoise(joint.id * 3000 + hour * 13);
      const degradation = joint.status === 'critical' ? hour * 0.012 : joint.status === 'warning' ? hour * 0.006 : hour * 0.002;
      const load = shiftLoad * oreSurge;
      const vibration = clamp(base.vibration * load + degradation + vibrationNoise * 0.18 + localNoise * 0.08, 2.5, 8.4);
      const acoustic = clamp(base.acoustic * load + degradation * 3 + acousticNoise * 2.4, 70, 115);
      const current = clamp(base.current * load + localNoise * 5 + vibrationNoise * 3, 150, 290);
      const thermal = clamp(base.thermal + (load - 1) * 12 + degradation * 2 + thermalNoise * 1.2, 52, 96);

      db.run(
        `INSERT INTO readings (joint_id, timestamp, vibration, acoustic, current, thermal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [joint.id, timestamp, Number(vibration.toFixed(2)), Number(acoustic.toFixed(1)), Number(current.toFixed(1)), Number(thermal.toFixed(1))]
      );
    }
  });

  const alerts = [
    { id: 1, joint_id: 1, title: 'Conveyor CV-04, Joint 3 belt delamination', severity: 'critical', failure_mode: 'delamination', failure_reason: 'Cumulative fatigue and splice pocket looseness', status: 'open', lead_time_hours: 14, remaining_life_hours: 14, model_confidence: 0.94, created_at: toISO(baseNow - 2 * 60 * 60 * 1000), model_note: 'Thermal rise and vibration harmonics are increasing together. The model detected a rising amplitude at belt splice resonance.' },
    { id: 2, joint_id: 4, title: 'Conveyor CV-07, Joint 2 mistracking drift', severity: 'warning', failure_mode: 'mistracking', failure_reason: 'Lateral offset on return side exceeded threshold in dry ore zone', status: 'open', lead_time_hours: 27, remaining_life_hours: 27, model_confidence: 0.81, created_at: toISO(baseNow - 6 * 60 * 60 * 1000), model_note: 'Acoustic signature is stable but drift angle increased over four hours with a repeatable belt-edge signal.' },
    { id: 3, joint_id: 5, title: 'Conveyor CV-09, Joint 4 belt rip risk', severity: 'critical', failure_mode: 'rip', failure_reason: 'Tear propagation at lagging seam under heavy load', status: 'acknowledged', lead_time_hours: 9, remaining_life_hours: 9, model_confidence: 0.96, created_at: toISO(baseNow - 7 * 60 * 60 * 1000), model_note: 'Motor current and acoustic peaks align with an abrupt increase in edge vibration; the band pattern matches a rip initiation.' },
    { id: 4, joint_id: 7, title: 'Conveyor CV-12, Joint 1 adhesion break-down', severity: 'warning', failure_mode: 'delamination', failure_reason: 'Backing strip separation under high thermal cycling', status: 'open', lead_time_hours: 31, remaining_life_hours: 31, model_confidence: 0.79, created_at: toISO(baseNow - 12 * 60 * 60 * 1000), model_note: 'Observed progressive thermal drift plus rising vibration on the splice side indicates delamination in the carcass.' },
  ];

  alerts.forEach((alert) => {
    db.run(
      `INSERT INTO alerts (id, joint_id, title, severity, failure_mode, failure_reason, status, lead_time_hours, remaining_life_hours, model_confidence, created_at, updated_at, model_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        alert.id,
        alert.joint_id,
        alert.title,
        alert.severity,
        alert.failure_mode,
        alert.failure_reason,
        alert.status,
        alert.lead_time_hours,
        alert.remaining_life_hours,
        alert.model_confidence,
        alert.created_at,
        alert.created_at,
        alert.model_note,
      ]
    );
  });

  db.run(
    `INSERT INTO feedback_log (alert_id, action, note, created_at) VALUES (?, ?, ?, ?)`,
    [3, 'acknowledged', 'Shift supervisor accepted risk and requested inspection window. Model classification retained.', toISO(baseNow - 5 * 60 * 60 * 1000)]
  );
  db.run(
    `INSERT INTO feedback_log (alert_id, action, note, created_at) VALUES (?, ?, ?, ?)`,
    [1, 'model_training', 'Anomaly pattern correlated with observed splice damage from previous belt changeover.', toISO(baseNow - 2 * 60 * 60 * 1000)]
  );

  const incidents = [
    { id: 1, joint_id: 1, title: 'Splice vibration spike', timestamp: toISO(baseNow - 30 * 60 * 60 * 1000), summary: 'Vibration at 5.4 mm/s exceeded 95th percentile for 12 minutes.', severity: 'critical' },
    { id: 2, joint_id: 4, title: 'Edge tracking excursion', timestamp: toISO(baseNow - 22 * 60 * 60 * 1000), summary: 'Belt drift began trending to the return edge during wet ore transfer.', severity: 'warning' },
    { id: 3, joint_id: 5, title: 'Thermal rupture precursor', timestamp: toISO(baseNow - 42 * 60 * 60 * 1000), summary: 'Thermal profile increased 8°C above normal before the rip indicator triggered.', severity: 'critical' },
    { id: 4, joint_id: 7, title: 'Adhesion loss on lower cover', timestamp: toISO(baseNow - 58 * 60 * 60 * 1000), summary: 'Rise in acoustic energy matched delamination onset in the belt carcass.', severity: 'warning' },
  ];

  incidents.forEach((incident) => {
    db.run(
      `INSERT INTO incidents (id, joint_id, title, timestamp, summary, severity) VALUES (?, ?, ?, ?, ?, ?)`,
      [incident.id, incident.joint_id, incident.title, incident.timestamp, incident.summary, incident.severity]
    );
  });

  const workOrders = [
    { id: 1, alert_id: 1, title: 'Inspect splice and replace damaged belt segment', assignee: 'M. Singh', status: 'scheduled', due_date: toISO(baseNow + 12 * 60 * 60 * 1000), created_at: toISO(baseNow - 90 * 60 * 1000), updated_at: toISO(baseNow - 90 * 60 * 1000) },
    { id: 2, alert_id: 3, title: 'Field verify rip and install emergency belt clamp', assignee: 'D. Verma', status: 'in_progress', due_date: toISO(baseNow + 4 * 60 * 60 * 1000), created_at: toISO(baseNow - 210 * 60 * 1000), updated_at: toISO(baseNow - 140 * 60 * 1000) },
  ];

  workOrders.forEach((workOrder) => {
    db.run(
      `INSERT INTO work_orders (id, alert_id, title, assignee, status, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [workOrder.id, workOrder.alert_id, workOrder.title, workOrder.assignee, workOrder.status, workOrder.due_date, workOrder.created_at, workOrder.updated_at]
    );
  });

  persistDatabase();
}

function databaseLooksValid() {
  try {
    const joints = queryAll('SELECT COUNT(*) as count FROM joints WHERE name IS NOT NULL AND conveyor IS NOT NULL AND zone IS NOT NULL');
    const alerts = queryAll('SELECT COUNT(*) as count FROM alerts WHERE title IS NOT NULL AND severity IS NOT NULL');
    const readings = queryAll('SELECT COUNT(*) as count FROM readings WHERE vibration IS NOT NULL AND acoustic IS NOT NULL AND current IS NOT NULL AND thermal IS NOT NULL');

    return Number(joints[0]?.count || 0) >= 6 && Number(alerts[0]?.count || 0) >= 2 && Number(readings[0]?.count || 0) >= 20;
  } catch (_error) {
    return false;
  }
}

function initializeDatabase() {
  if (fs.existsSync(dbPath)) {
    const bytes = fs.readFileSync(dbPath);
    db = new SQL.Database(new Uint8Array(bytes));
    if (databaseLooksValid()) {
      return;
    }
    db = new SQL.Database();
    generateSeedData();
    return;
  }

  db = new SQL.Database();
  generateSeedData();
}

initializeDatabase();

function buildAlertSummary(alert) {
  const jointInfo = queryOne('SELECT * FROM joints WHERE id = ?', [alert.joint_id]);
  const latest = getLatestJointReadings()[alert.joint_id] || {};
  const feedback = queryAll('SELECT action, note, created_at FROM feedback_log WHERE alert_id = ? ORDER BY created_at DESC', [alert.id]);
  const trend = createTrendSeries(alert.joint_id, 24);

  return {
    ...alert,
    joint_name: jointInfo?.name || 'Unknown joint',
    conveyor: jointInfo?.conveyor || 'N/A',
    zone: jointInfo?.zone || 'N/A',
    status: computeStatus(latest),
    latest_sensors: latest,
    feedback,
    trend,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api/dashboard', (_req, res) => {
  const joints = readProjectData();
  const latestReadings = getLatestJointReadings();
  const alerts = queryAll(
    `SELECT * FROM alerts
     WHERE status IN ('open', 'acknowledged', 'work_order_created')
     ORDER BY CASE severity
       WHEN 'critical' THEN 1
       WHEN 'warning' THEN 2
       ELSE 3
     END, remaining_life_hours ASC`
  );

  const statRows = queryOne('SELECT AVG(lead_time_hours) as avg_lead_time FROM alerts WHERE status != ?', ['dismissed']);

  const dashboardJoints = joints.map((joint) => {
    const reading = getSimulatedLiveReading(latestReadings[joint.id], joint.id) || {};
    return {
      id: joint.id,
      name: joint.name,
      conveyor: joint.conveyor,
      zone: joint.zone,
      status: computeStatus(reading),
      vibration: Number(reading.vibration || 0),
      acoustic: Number(reading.acoustic || 0),
      current: Number(reading.current || 0),
      thermal: Number(reading.thermal || 0),
      readingAt: reading.timestamp || null,
    };
  });

  const alertList = alerts.map((alert) => ({
    ...alert,
    joint_name: joints.find((joint) => joint.id === alert.joint_id)?.name || 'Unknown joint',
    status: alert.status,
    remaining_life_hours: alert.remaining_life_hours,
    lead_time_hours: alert.lead_time_hours,
  }));

  res.json({
    generatedAt: new Date().toISOString(),
    feed: {
      area: 'Primary crushing and conveying',
      shift: 'B shift',
      oreRate: 4820,
      oreRateUnit: 't/h',
      ambient: 28.4,
      ambientUnit: '°C',
      nextCalibration: '2026-09-25T06:00:00.000Z',
    },
    joints: dashboardJoints,
    alerts: alertList,
    stats: {
      uptime: 99.91,
      jointsMonitored: joints.length || dashboardJoints.length,
      openAlerts: alertList.length,
      avgDetectionLeadTime: Number(statRows?.avg_lead_time || 0).toFixed(1),
    },
  });
});

app.get('/api/alerts/:id', (req, res) => {
  const alert = queryOne('SELECT * FROM alerts WHERE id = ?', [Number(req.params.id)]);
  if (!alert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  res.json(buildAlertSummary(alert));
});

app.post('/api/alerts/:id/acknowledge', (req, res) => {
  const alertId = Number(req.params.id);
  const alert = queryOne('SELECT * FROM alerts WHERE id = ?', [alertId]);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  db.run('UPDATE alerts SET status = ?, updated_at = ? WHERE id = ?', ['acknowledged', new Date().toISOString(), alertId]);
  insertFeedback(alertId, 'acknowledged', req.body?.reason || 'Operator acknowledged and scheduled inspection plan.');
  persistDatabase();
  res.json({ success: true, alertId });
});

app.post('/api/alerts/:id/dismiss', (req, res) => {
  const alertId = Number(req.params.id);
  const alert = queryOne('SELECT * FROM alerts WHERE id = ?', [alertId]);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  db.run('UPDATE alerts SET status = ?, updated_at = ? WHERE id = ?', ['dismissed', new Date().toISOString(), alertId]);
  insertFeedback(alertId, 'dismissed_false_alarm', req.body?.reason || 'Operator marked alert as false alarm after field checks. Model feedback logged.');
  persistDatabase();
  res.json({ success: true, alertId });
});

app.post('/api/alerts/:id/work-order', (req, res) => {
  const alertId = Number(req.params.id);
  const alert = queryOne('SELECT * FROM alerts WHERE id = ?', [alertId]);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  const dueDate = new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString();
  const title = `Inspect ${alert.title}`;
  const assignee = req.body?.assignee || 'A. Patel';
  const existingOrder = queryOne(
    `SELECT id FROM work_orders WHERE alert_id = ? AND status != 'completed'`,
    [alertId]
  );
  if (existingOrder) {
    return res.status(409).json({ error: 'An active work order already exists for this alert.', orderId: existingOrder.id });
  }

  db.run(
    `INSERT INTO work_orders (alert_id, title, assignee, status, due_date, created_at, updated_at)
     VALUES (?, ?, ?, 'scheduled', ?, ?, ?)`,
    [alertId, title, assignee, dueDate, new Date().toISOString(), new Date().toISOString()]
  );
  const orderId = queryOne('SELECT last_insert_rowid() as id')?.id;
  db.run('UPDATE alerts SET status = ?, updated_at = ? WHERE id = ?', ['work_order_created', new Date().toISOString(), alertId]);
  insertFeedback(alertId, 'work_order_created', `Work order created for ${assignee}. Inspection due ${dueDate}.`);
  persistDatabase();
  res.json({ success: true, alertId, orderId });
});

app.get('/api/historical', (_req, res) => {
  const joints = readProjectData();
  const incidents = queryAll('SELECT * FROM incidents ORDER BY timestamp DESC');

  const trendByJoint = joints.map((joint) => ({
    jointId: joint.id,
    jointName: joint.name,
    series: createTrendSeries(joint.id, 36),
  }));

  res.json({
    joints,
    trendByJoint,
    incidents,
  });
});

app.get('/api/workorders', (_req, res) => {
  const orders = queryAll(
    `SELECT w.*, a.title as alert_title
     FROM work_orders w
     LEFT JOIN alerts a ON a.id = w.alert_id
     ORDER BY w.due_date ASC`
  );
  res.json({ workOrders: orders });
});

app.put('/api/workorders/:id', (req, res) => {
  const orderId = Number(req.params.id);
  const { assignee, status, due_date } = req.body;
  const existing = queryOne('SELECT * FROM work_orders WHERE id = ?', [orderId]);
  if (!existing) return res.status(404).json({ error: 'Work order not found' });

  db.run(
    `UPDATE work_orders
     SET assignee = ?, status = ?, due_date = ?, updated_at = ?
     WHERE id = ?`,
    [assignee || existing.assignee, status || existing.status, due_date || existing.due_date, new Date().toISOString(), orderId]
  );

  persistDatabase();
  res.json({ success: true, orderId });
});

app.delete('/api/workorders/:id', (req, res) => {
  const orderId = Number(req.params.id);
  const existing = queryOne('SELECT * FROM work_orders WHERE id = ?', [orderId]);
  if (!existing) return res.status(404).json({ error: 'Work order not found' });

  db.run('DELETE FROM work_orders WHERE id = ?', [orderId]);
  const replacement = queryOne(
    `SELECT id FROM work_orders WHERE alert_id = ? AND status != 'completed' ORDER BY id DESC LIMIT 1`,
    [existing.alert_id]
  );
  if (!replacement) {
    db.run('UPDATE alerts SET status = ?, updated_at = ? WHERE id = ?', ['acknowledged', new Date().toISOString(), existing.alert_id]);
  }
  persistDatabase();
  res.json({ success: true, orderId });
});

app.post('/api/refresh-sensors', (_req, res) => {
  const joints = readProjectData();
  const now = new Date().toISOString();
  const insertReading = db.prepare(
    `INSERT INTO readings (joint_id, timestamp, vibration, acoustic, current, thermal)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  joints.forEach((joint, index) => {
    const currentReading = queryOne('SELECT * FROM readings WHERE joint_id = ? ORDER BY timestamp DESC LIMIT 1', [joint.id]);

    const nextVibration = Number(clamp((currentReading?.vibration || 3.4) + ((index % 2 === 0 ? 1 : -1) * 0.22) + Math.sin(Date.now() / 5000 + index), 2.6, 8.5).toFixed(2));
    const nextAcoustic = Number(clamp((currentReading?.acoustic || 82) + ((index % 2 === 0 ? 1 : -1) * 1.8), 72, 110).toFixed(1));
    const nextCurrent = Number(clamp((currentReading?.current || 200) + ((index % 3 === 0 ? 1 : -1) * 3.2), 150, 290).toFixed(1));
    const nextThermal = Number(clamp((currentReading?.thermal || 65) + ((index % 2 === 0 ? 1 : -1) * 0.6), 55, 95).toFixed(1));

    insertReading.run(joint.id, now, nextVibration, nextAcoustic, nextCurrent, nextThermal);
  });

  persistDatabase();
  res.json({ success: true, generatedAt: now });
});

app.get('/api/report/dgms', (_req, res) => {
  const joints = readProjectData();
  const alerts = queryAll('SELECT * FROM alerts ORDER BY created_at DESC');
  const incidents = queryAll('SELECT * FROM incidents ORDER BY timestamp DESC');

  const lines = [
    'DGMS Belt Integrity Compliance Report',
    'Plant: Iron Ore Transfer Circuit',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Joints Monitored,Status,Conveyor,Zone',
    ...joints.map((joint) => `${joint.name},${joint.status},${joint.conveyor},${joint.zone}`),
    '',
    'Alert ID,Joint,Severity,Failure Mode,Status,Lead Time Hours,Remaining Life Hours',
    ...alerts.map((alert) => `${alert.id},${alert.joint_id},${alert.severity},${alert.failure_mode},${alert.status},${alert.lead_time_hours},${alert.remaining_life_hours}`),
    '',
    'Incident ID,Joint,Title,Timestamp,Severity',
    ...incidents.map((incident) => `${incident.id},${incident.joint_id},${incident.title},${incident.timestamp},${incident.severity}`),
  ];

  const csv = `${lines.join('\n')}\n`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="beltcare_dgms_report.csv"');
  res.send(csv);
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`BeltCare API listening on http://localhost:${PORT}`);
  });
}

export default app;
