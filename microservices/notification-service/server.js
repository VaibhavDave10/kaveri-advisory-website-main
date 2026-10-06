// ──────────────────────────────────────────────────────────────────────
// Microservice 3: Notification Service (Node.js + Express)
// Port: 4003
// Responsibilities:
//   • Accept advisory results and generate farmer notifications
//   • Queue SMS/WhatsApp-style alerts (simulated, no real SMS gateway)
//   • Maintain a notification log with delivery status
//   • Provide notification history per plot / farmer
// ──────────────────────────────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 4003;

app.use(cors());
app.use(express.json());

// ──── In-memory notification store ────
// In production: Redis / PostgreSQL / MongoDB
const notifications = [];
let notifIdCounter = 1;

// ──── Simulated delivery channels ────
const CHANNELS = {
  sms:       { label: 'SMS',       delay_ms: 800,  success_rate: 0.95 },
  whatsapp:  { label: 'WhatsApp',  delay_ms: 500,  success_rate: 0.98 },
  push:      { label: 'Push Notification', delay_ms: 300, success_rate: 0.99 },
  dashboard: { label: 'Dashboard', delay_ms: 100,  success_rate: 1.00 },
};

function simulateDelivery(channel) {
  const ch = CHANNELS[channel] || CHANNELS.dashboard;
  const success = Math.random() < ch.success_rate;
  return {
    channel: ch.label,
    delivered: success,
    status: success ? 'delivered' : 'failed',
    latency_ms: Math.floor(ch.delay_ms + Math.random() * 200),
  };
}

// ──── Routes ────

// Health check
app.get('/health', (req, res) => {
  res.json({
    service: 'notification-service',
    status: 'healthy',
    port: PORT,
    total_notifications: notifications.length,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// POST /notify — send a notification based on an advisory
app.post('/notify', (req, res) => {
  const {
    plot_id,
    farmer_name,
    farmer_phone,
    advisory_text,
    advisory_kannada,
    advisory_hindi,
    urgency = 'medium',
    channels = ['dashboard', 'sms'],
    language = 'en',
  } = req.body || {};

  if (!plot_id || !advisory_text) {
    return res.status(400).json({
      error: 'plot_id and advisory_text are required.',
    });
  }

  // Determine which text to send based on language
  let messageText = advisory_text;
  if (language === 'kn' && advisory_kannada) messageText = advisory_kannada;
  if (language === 'hi' && advisory_hindi)   messageText = advisory_hindi;

  // Simulate delivery to each channel
  const deliveryResults = channels.map(ch => simulateDelivery(ch));
  const allDelivered    = deliveryResults.every(d => d.delivered);

  const notification = {
    id: `NOTIF-${String(notifIdCounter++).padStart(4, '0')}`,
    plot_id,
    farmer_name: farmer_name || 'Unknown',
    farmer_phone: farmer_phone || 'N/A',
    message: messageText,
    language,
    urgency,
    delivery: deliveryResults,
    overall_status: allDelivered ? 'delivered' : 'partial_failure',
    created_at: new Date().toISOString(),
  };

  notifications.push(notification);
  console.log(`📱 Notification ${notification.id} → ${notification.overall_status}`);

  res.status(201).json({
    ok: true,
    notification,
  });
});

// POST /notify/batch — send notifications for multiple plots
app.post('/notify/batch', (req, res) => {
  const { alerts = [] } = req.body || {};

  if (!alerts.length) {
    return res.status(400).json({ error: 'Provide an "alerts" array.' });
  }

  const results = alerts.map(alert => {
    const {
      plot_id,
      farmer_name,
      advisory_text,
      urgency = 'medium',
      channels = ['dashboard'],
      language = 'en',
    } = alert;

    const deliveryResults = (channels || ['dashboard']).map(ch => simulateDelivery(ch));
    const allDelivered    = deliveryResults.every(d => d.delivered);

    const notification = {
      id: `NOTIF-${String(notifIdCounter++).padStart(4, '0')}`,
      plot_id: plot_id || 'UNKNOWN',
      farmer_name: farmer_name || 'Unknown',
      message: advisory_text || 'No advisory text provided.',
      language,
      urgency,
      delivery: deliveryResults,
      overall_status: allDelivered ? 'delivered' : 'partial_failure',
      created_at: new Date().toISOString(),
    };

    notifications.push(notification);
    return notification;
  });

  console.log(`📱 Batch: ${results.length} notifications sent`);

  res.status(201).json({
    ok: true,
    count: results.length,
    notifications: results,
  });
});

// GET /notifications — list all notifications (with optional filters)
app.get('/notifications', (req, res) => {
  let result = [...notifications];
  const { plot_id, urgency, status, limit } = req.query;

  if (plot_id)  result = result.filter(n => n.plot_id === plot_id);
  if (urgency)  result = result.filter(n => n.urgency === urgency);
  if (status)   result = result.filter(n => n.overall_status === status);

  // Most recent first
  result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (limit) result = result.slice(0, parseInt(limit, 10));

  res.json({
    count: result.length,
    notifications: result,
  });
});

// GET /notifications/:id — single notification detail
app.get('/notifications/:id', (req, res) => {
  const notif = notifications.find(n => n.id === req.params.id);
  if (!notif) {
    return res.status(404).json({ error: `Notification ${req.params.id} not found.` });
  }
  res.json(notif);
});

// GET /notifications/stats/summary — delivery statistics
app.get('/notifications/stats/summary', (req, res) => {
  const total     = notifications.length;
  const delivered = notifications.filter(n => n.overall_status === 'delivered').length;
  const failed    = notifications.filter(n => n.overall_status === 'partial_failure').length;

  const byUrgency = {};
  notifications.forEach(n => {
    byUrgency[n.urgency] = (byUrgency[n.urgency] || 0) + 1;
  });

  res.json({
    total,
    delivered,
    failed,
    delivery_rate_pct: total > 0 ? parseFloat(((delivered / total) * 100).toFixed(1)) : 0,
    by_urgency: byUrgency,
  });
});

// ──── Start ────
app.listen(PORT, () => {
  console.log(`\n📱  Notification Service running on http://localhost:${PORT}`);
  console.log(`   POST /notify`);
  console.log(`   POST /notify/batch`);
  console.log(`   GET  /notifications`);
  console.log(`   GET  /notifications/:id`);
  console.log(`   GET  /notifications/stats/summary`);
  console.log(`   GET  /health\n`);
});
