// Bootstrap: serve o cliente (HTTP), aceita conexões WebSocket e roda o loop de tick.
// Toda a regra de jogo está em src/game.js — este arquivo só liga os fios.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { PORT, TICK_RATE } from './src/config.js';
import { initMobs, handleConnection, step } from './src/game.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const path = join(PUBLIC, normalize(rel).replace(/^(\.\.[/\\])+/, '')); // evita path traversal
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => handleConnection(ws));
server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws)));

initMobs();
let last = process.hrtime.bigint();
setInterval(() => {
  const t = process.hrtime.bigint();
  const dt = Number(t - last) / 1e9;
  last = t;
  step(Math.min(dt, 0.1)); // clamp para evitar "salto" se o processo travar
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Servidor no ar: http://localhost:${PORT}`);
});
