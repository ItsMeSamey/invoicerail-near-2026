import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const routes = new Map([
  ['/', ['web/index.html','text/html']], ['/style.css',['web/style.css','text/css']], ['/app.mjs',['web/app.mjs','text/javascript']],
  ['/src/ledger.mjs',['src/ledger.mjs','text/javascript']], ['/artifacts/sandbox-report.json',['artifacts/sandbox-report.json','application/json']]
]);
const port = Number(process.env.PORT ?? 4173);
const server = http.createServer(async (req,res) => {
  const route = routes.get(new URL(req.url, 'http://localhost').pathname);
  if (!route || !['GET','HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(new URL(route[0], root));
    res.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8`, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Missing artifact. Run npm run test:sandbox first.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`InvoiceRail demo: http://127.0.0.1:${port}\nRoot: ${fileURLToPath(root)}`));
