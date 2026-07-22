#!/usr/bin/env node
/**
 * Local development reverse proxy — mirrors the ALB routing rules in alb-routing.tf.
 * Listens on :8080 and forwards to service ports 3001-3011.
 * Supports HTTP and WebSocket (socket.io) upgrades.
 *
 * Usage: node scripts/dev-proxy.js
 */

const http = require('http');
const net = require('net');

const LOCAL_IP = process.env.LOCAL_IP || '0.0.0.0';
const PORT = parseInt(process.env.PROXY_PORT || '8080', 10);

// Mirrors alb-routing.tf routing_rules (priority order)
const ROUTES = [
  { prefixes: ['/ws'],                          port: 3001 }, // auth WebSocket
  { prefixes: ['/auth/'],                       port: 3001 }, // auth REST
  { prefixes: ['/trips/', '/bids/'],            port: 3002 }, // trip service
  { prefixes: ['/pricing/'],                    port: 3005 }, // pricing service
  { prefixes: ['/drivers/', '/driver/'],        port: 3003 }, // driver service
  { prefixes: ['/vehicles/'],                   port: 3003 }, // driver service — vehicles (also add to alb-routing.tf)
  { prefixes: ['/geocode/'],                    port: 3004 }, // geocoding (rider service)
  { prefixes: ['/riders/'],                     port: 3004 }, // rider service
  { prefixes: ['/safety/'],                     port: 3006 }, // safety service
  { prefixes: ['/payments/'],                   port: 3007 }, // payment service
  { prefixes: ['/internal/notifications/'],     port: 3008 }, // notification service
  { prefixes: ['/internal/trust/'],             port: 3009 }, // trust service
  { prefixes: ['/airport/'],                    port: 3010 }, // airport service
  { prefixes: ['/admin/'],                      port: 3011 }, // admin service
  { prefixes: ['/health'],                      port: 3001 }, // health fallback
];

function getPort(url) {
  const path = url.split('?')[0];
  const normalized = path.endsWith('/') ? path : path + '/';
  for (const route of ROUTES) {
    for (const prefix of route.prefixes) {
      if (normalized.startsWith(prefix) || path === prefix.replace(/\/$/, '')) {
        return route.port;
      }
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const targetPort = getPort(req.url);
  if (!targetPort) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No route matched', path: req.url }));
    return;
  }

  const options = {
    hostname: 'localhost',
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${targetPort}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Forward CORS headers for local dev
    const headers = {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    const code = err.code === 'ECONNREFUSED' ? 503 : 502;
    if (!res.headersSent) {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service unavailable', detail: err.message, port: targetPort }));
    }
  });

  req.pipe(proxyReq, { end: true });
});

// WebSocket upgrade proxy (socket.io uses /ws)
server.on('upgrade', (req, socket, head) => {
  const targetPort = getPort(req.url) ?? 3001;

  const conn = net.connect(targetPort, 'localhost', () => {
    const headers = [
      `${req.method} ${req.url} HTTP/1.1`,
      ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`),
      '',
      '',
    ].join('\r\n');

    conn.write(headers);
    if (head && head.length) conn.write(head);

    conn.pipe(socket, { end: true });
    socket.pipe(conn, { end: true });
  });

  conn.on('error', () => socket.destroy());
  socket.on('error', () => conn.destroy());
});

server.listen(PORT, LOCAL_IP, () => {
  console.log(`\nBidiRide dev proxy listening on ${LOCAL_IP}:${PORT}`);
  console.log('Route table:');
  ROUTES.forEach(r => console.log(`  ${r.prefixes.join(', ')} → :${r.port}`));
  console.log('\nSet EXPO_PUBLIC_API_URL=http://<your-mac-ip>:8080 in app .env files\n');
});

server.on('error', (err) => {
  console.error('Proxy error:', err.message);
  process.exit(1);
});
