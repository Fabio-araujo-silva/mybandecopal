// Servidor local que imita a Vercel: arquivos estáticos de public/ + funções de api/.
// Uso: node dev-server.mjs  (PORT opcional, padrão 3000)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// carrega .env (só local; na Vercel as variáveis vêm do painel do projeto)
try {
  for (const line of (await readFile(join(root, '.env'), 'utf8')).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* sem .env */ }
const publicDir = join(root, 'public');
const port = Number(process.env.PORT) || 3000;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

function vercelRes(res) {
  res.status = (code) => ((res.statusCode = code), res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  return res;
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      const name = pathname.slice(5).replace(/[^a-z0-9-]/gi, '');
      const mod = await import(pathToFileURL(join(root, 'api', `${name}.js`)).href);
      return await mod.default(req, vercelRes(res));
    }
    let file = normalize(join(publicDir, decodeURIComponent(pathname)));
    if (!file.startsWith(publicDir)) throw Object.assign(new Error('fora'), { code: 'ENOENT' });
    const st = await stat(file).catch(() => null);
    if (st?.isDirectory()) file = join(file, 'index.html');
    // clean URLs como na Vercel: /admin → admin.html
    else if (!st && !extname(file) && (await stat(`${file}.html`).catch(() => null))) file = `${file}.html`;
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (err) {
    res.statusCode = err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500;
    res.end(res.statusCode === 404 ? 'não encontrado' : String(err));
  }
}).listen(port, () => console.log(`mybandecopal em http://localhost:${port}`));
