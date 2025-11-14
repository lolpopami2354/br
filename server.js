// server.js
const express = require('express');
const httpProxy = require('http-proxy');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const http = require('http');
const net = require('net');
const url = require('url');

const app = express();
const proxy = httpProxy.createProxyServer({ changeOrigin: true, secure: true });

// Basic logging & CORS for your UI origin
app.use(morgan('dev'));
app.use(cors({
  origin: true,
  credentials: true,
  exposedHeaders: ['Content-Type', 'Content-Length', 'Set-Cookie']
}));
app.use(bodyParser.raw({ type: '*/*', limit: '10mb' }));

// Helper: sanitize and parse target URL from query
function getTarget(req) {
  const targetParam = req.query.url || '';
  try {
    const parsed = new URL(targetParam);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Bad protocol');
    return parsed.toString();
  } catch (e) {
    return null;
  }
}

// Forward GET/POST/etc to target
app.all('/proxy', (req, res) => {
  const target = getTarget(req);
  if (!target) return res.status(400).send('Invalid or missing ?url= parameter');

  // Adjust headers: set Host of target; remove compression if you want easier rewriting later
  const parsed = new URL(target);
  req.headers.host = parsed.host;
  // Optional: disable compression for easier content manipulation
  // delete req.headers['accept-encoding'];

  proxy.web(req, res, { target, selfHandleResponse: false }, (err) => {
    console.error('Proxy error:', err?.message);
    res.status(502).send('Bad gateway (proxy failed)');
  });
});

// HTTPS CONNECT tunneling (so HTTPS works)
const server = http.createServer(app);

server.on('connect', (req, clientSocket, head) => {
  // req.url is "host:port"
  const [host, portStr] = req.url.split(':');
  const port = parseInt(portStr, 10) || 443;

  const serverSocket = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    console.error('Tunnel error:', err?.message);
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
});

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
});
