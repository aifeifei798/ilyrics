const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 4100;
const UPSTREAM = 'http://127.0.0.1:8080/v1/chat/completions';
const UPSTREAM_MODELS = 'http://127.0.0.1:8080/v1/models';
const MODEL = 'qwen3.8-flash-next-gyro-gyro-s';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(pathname, res) {
  const file = pathname === '/' ? '/index.html' : pathname;
  const full = path.normalize(path.join(__dirname, file));
  if (!full.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

async function handleGenerate(req, res) {
  let body = '';
  for await (const chunk of req) body += chunk;

  let input;
  try {
    input = JSON.parse(body);
  } catch {
    sendJSON(res, 400, { error: 'invalid json body' });
    return;
  }
  if (!Array.isArray(input.messages)) {
    sendJSON(res, 400, { error: 'messages required' });
    return;
  }

  const payload = {
    model: input.model || MODEL,
    messages: input.messages,
    stream: true,
    temperature: input.temperature ?? 0.9,
    top_p: input.top_p ?? 0.9,
    max_tokens: input.max_tokens ?? 2400,
    reasoning_effort: input.reasoning_effort ?? 'none',
  };

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      sendJSON(res, upstream.status, { error: text.slice(0, 500) });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    });
    res.on('close', () => upstream.body.cancel().catch(() => {}));
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (e) {
    if (!res.headersSent) sendJSON(res, 502, { error: String(e) });
    else res.end();
  }
}

async function handleModels(req, res) {
  try {
    const upstream = await fetch(UPSTREAM_MODELS);
    if (!upstream.ok) {
      sendJSON(res, upstream.status, { error: (await upstream.text()).slice(0, 300) });
      return;
    }
    sendJSON(res, 200, await upstream.json());
  } catch (e) {
    sendJSON(res, 502, { error: String(e) });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    handleGenerate(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/models') {
    handleModels(req, res);
    return;
  }
  if (req.method === 'GET') {
    serveStatic(url.pathname, res);
    return;
  }
  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`ilyrics running at http://localhost:${PORT}`);
});
