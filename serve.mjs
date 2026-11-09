// Local preview: node serve.mjs → http://127.0.0.1:5350
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wav': 'audio/wav', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };

createServer(async (req, res) => {
  // capture helper: POST /capture/<file> stores the body under capture/ (used to record frame-locked video)
  if (req.method === 'POST' && req.url.startsWith('/capture/')) {
    const name = req.url.slice(9).replace(/[^\w.\-\/]/g, ''), chunks = [];
    for await (const c of req) chunks.push(c);
    try { await writeFile(join(root, 'capture', name), Buffer.concat(chunks)); res.writeHead(200).end('ok'); } catch (e) { res.writeHead(500).end(String(e)); }
    return;
  }
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^[\\/]+/, '') || 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5350, '127.0.0.1');
