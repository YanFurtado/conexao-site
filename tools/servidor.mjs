// Servidor local que imita o .htaccess: /en serve en.html, /en/ volta para /en, o que não existe recebe
// a 404.html e as ferramentas de desenvolvimento ficam bloqueadas.
//
//   npm run servidor                abre em http://localhost:8080
//   PORTA=3000 npm run servidor     em outra porta
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const BLOQUEADO = /^\/(node_modules|tests|tools|fotos)(\/|$)|(^|\/)\.(?!well-known\/)|\.(bak|old|orig|log|sql|sh|py|ini|env|md|zip|mjs)$|^\/package(-lock)?\.json$/;

export function criarServidor(raiz) {
  return http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
    const barra = /^\/(en|es|pt-pt)\/$/.exec(p);
    if (barra) { res.writeHead(301, { Location: '/' + barra[1] }); res.end(); return; }
    if (BLOQUEADO.test(p)) { res.writeHead(403, { 'Content-Type': TIPOS['.txt'] }); res.end('Proibido'); return; }
    let arq = path.join(raiz, p.endsWith('/') ? p + 'index.html' : p);
    if (!path.extname(arq) && fs.existsSync(arq + '.html')) arq += '.html';
    if (arq.startsWith(raiz + path.sep) && fs.existsSync(arq) && fs.statSync(arq).isFile()) {
      const tipo = path.extname(arq);
      res.writeHead(200, { 'Content-Type': TIPOS[tipo] || 'application/octet-stream', 'Cache-Control': tipo === '.html' || tipo === '.js' ? 'no-cache' : 'public, max-age=300' });
      fs.createReadStream(arq).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': TIPOS['.html'] });
      fs.createReadStream(path.join(raiz, '404.html')).pipe(res);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const srv = criarServidor(raiz);
  let porta = Number(process.env.PORTA) || 8080;
  srv.on('error', (e) => {
    if (e.code !== 'EADDRINUSE' || porta > 8090) throw e;
    srv.listen(++porta, 'localhost');
  });
  srv.on('listening', () => {
    const u = `http://localhost:${porta}`;
    console.log(`Site rodando em ${u}\n  pt-BR  ${u}/\n  pt-PT  ${u}/pt-pt\n  en     ${u}/en\n  es     ${u}/es\nCtrl+C para parar.`);
  });
  srv.listen(porta, 'localhost');
}
