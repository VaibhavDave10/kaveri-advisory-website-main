// ──────────────────────────────────────────────────────────────────────
// API Gateway — Central entry point for the frontend
// Port: 4000
// Routes:
//   /api/weather/*      → Weather Service   (port 4001)
//   /api/advisory/*     → Advisory Service  (port 4002)
//   /api/notifications/* → Notification Service (port 4003)
//   /api/health         → Aggregated health check of all services
// ──────────────────────────────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ──── Service Registry ────
const SERVICES = {
  weather:       { url: process.env.WEATHER_URL      || 'http://localhost:4001', name: 'Weather Service' },
  advisory:      { url: process.env.ADVISORY_URL     || 'http://localhost:4002', name: 'Advisory Service' },
  notification:  { url: process.env.NOTIFICATION_URL || 'http://localhost:4003', name: 'Notification Service' },
};

// ──── Proxy middleware ────
app.use('/api/weather', createProxyMiddleware({
  target: SERVICES.weather.url,
  changeOrigin: true,
  pathRewrite: { '^/api/weather': '/weather' },
  on: {
    error: (err, req, res) => {
      res.status(503).json({ error: 'Weather Service unavailable', detail: err.message });
    },
  },
}));

app.use('/api/advisory', createProxyMiddleware({
  target: SERVICES.advisory.url,
  changeOrigin: true,
  pathRewrite: { '^/api/advisory': '/advisory' },
  on: {
    error: (err, req, res) => {
      res.status(503).json({ error: 'Advisory Service unavailable', detail: err.message });
    },
  },
}));

app.use('/api/notifications', createProxyMiddleware({
  target: SERVICES.notification.url,
  changeOrigin: true,
  pathRewrite: { '^/api/notifications': '/notifications' },
  on: {
    error: (err, req, res) => {
      res.status(503).json({ error: 'Notification Service unavailable', detail: err.message });
    },
  },
}));

// Forward /api/notify to notification service's /notify
app.use('/api/notify', createProxyMiddleware({
  target: SERVICES.notification.url,
  changeOrigin: true,
  pathRewrite: { '^/api/notify': '/notify' },
  on: {
    error: (err, req, res) => {
      res.status(503).json({ error: 'Notification Service unavailable', detail: err.message });
    },
  },
}));

// ──── Aggregated Health Check ────
app.get('/api/health', async (req, res) => {
  const http = require('http');
  const results = {};
  let allHealthy = true;

  const checkService = (key, url) => {
    return new Promise(resolve => {
      const start = Date.now();
      const request = http.get(`${url}/health`, { timeout: 3000 }, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try {
            const data = JSON.parse(body);
            results[key] = {
              name: SERVICES[key].name,
              url,
              status: 'healthy',
              latency_ms: Date.now() - start,
              details: data,
            };
          } catch (e) {
            results[key] = {
              name: SERVICES[key].name,
              url,
              status: 'unhealthy',
              latency_ms: Date.now() - start,
              error: 'Invalid response',
            };
            allHealthy = false;
          }
          resolve();
        });
      });
      request.on('error', (err) => {
        results[key] = {
          name: SERVICES[key].name,
          url,
          status: 'unreachable',
          latency_ms: Date.now() - start,
          error: err.message,
        };
        allHealthy = false;
        resolve();
      });
      request.on('timeout', () => {
        request.destroy();
        results[key] = {
          name: SERVICES[key].name,
          url,
          status: 'timeout',
          latency_ms: Date.now() - start,
          error: 'Health check timed out after 3s',
        };
        allHealthy = false;
        resolve();
      });
    });
  };

  await Promise.all(
    Object.entries(SERVICES).map(([key, svc]) => checkService(key, svc.url))
  );

  res.status(allHealthy ? 200 : 207).json({
    gateway: 'api-gateway',
    status: allHealthy ? 'all_healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: results,
  });
});

// ──── Gateway info ────
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Kaveri Advisory API Gateway',
    version: '1.0.0',
    routes: {
      '/api/weather/*':       `→ ${SERVICES.weather.name} (${SERVICES.weather.url})`,
      '/api/advisory/*':      `→ ${SERVICES.advisory.name} (${SERVICES.advisory.url})`,
      '/api/notifications/*': `→ ${SERVICES.notification.name} (${SERVICES.notification.url})`,
      '/api/notify':          `→ ${SERVICES.notification.name} (${SERVICES.notification.url})`,
      '/api/health':          'Aggregated health check',
      '/api/info':            'This info endpoint',
    },
  });
});

// ──── Start ────
app.listen(PORT, () => {
  console.log(`\n🚀  API Gateway running on http://localhost:${PORT}`);
  console.log(`   Routing to:`);
  Object.entries(SERVICES).forEach(([key, svc]) => {
    console.log(`     ${key.padEnd(14)} → ${svc.url}`);
  });
  console.log(`\n   GET  /api/health    — aggregated health`);
  console.log(`   GET  /api/info      — route map\n`);
});
