// Confere a publicação no EasyPanel (Dockerfile + nginx.conf + .dockerignore) contra o .htaccess e as páginas:
// os mesmos cabeçalhos de segurança (inclusive a CSP do Pixel da Meta), as mesmas versões de idioma com URL
// limpa, e um .dockerignore que leva tudo o que as páginas usam e nada das ferramentas de desenvolvimento.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ, ler, lerConfig } from '../tools/i18n-comum.mjs';

const htaccess = ler('.htaccess');
const nginx = ler('nginx.conf');

test('nginx.conf manda os mesmos cabeçalhos de segurança do .htaccess', () => {
  const doApache = Object.fromEntries([...htaccess.matchAll(/^\s*Header always set ([\w-]+) "([^"]*)"/gm)].map((m) => [m[1], m[2]]));
  const doNginx = Object.fromEntries([...nginx.matchAll(/^\s*add_header ([\w-]+) "([^"]*)" always;/gm)].map((m) => [m[1], m[2]]));
  assert.ok(doApache['Content-Security-Policy'], 'CSP não encontrada no .htaccess');
  assert.deepEqual(doNginx, doApache);
});

test('as versões de idioma têm URL limpa, e /xx/ volta para /xx, no Apache e no nginx', () => {
  const caminhos = Object.values(lerConfig().paginas).filter(Boolean).sort();
  const lista = (re, txt) => { const m = re.exec(txt); assert.ok(m, `regra não encontrada: ${re}`); return m[1].split('|').sort(); };
  assert.deepEqual(lista(/RewriteRule \^\(([^)]+)\)\/\$ /, htaccess), caminhos);
  assert.deepEqual(lista(/location ~ \^\/\(([^)]+)\)\/\$ /, nginx), caminhos);
  assert.match(nginx, /try_files \$uri \$uri\.html \$uri\/ =404;/);
  for (const c of caminhos) assert.ok(fs.existsSync(path.join(RAIZ, c + '.html')), `${c}.html não existe`);
});

test('.dockerignore leva tudo o que as páginas usam e nada de desenvolvimento', () => {
  const regras = ler('.dockerignore').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const casa = (padrao, nome) => new RegExp('^' + padrao.replace(/\/$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$').test(nome);
  // Como no Docker, vale a última regra que casar com o nome (as regras daqui são todas da raiz).
  const entra = (nome) => regras.reduce((dentro, r) => (r.startsWith('!') ? (casa(r.slice(1), nome) || dentro) : (casa(r, nome) ? false : dentro)), true);

  // Primeira parte do caminho de tudo o que as páginas da raiz carregam ou linkam no próprio site.
  const paginas = fs.readdirSync(RAIZ).filter((f) => f.endsWith('.html'));
  const usados = new Set(['robots.txt', 'sitemap.xml', '.well-known', 'nginx.conf', ...paginas]);
  for (const p of paginas) {
    const html = ler(p).replace(/<script\b[\s\S]*?<\/script>/gi, '');
    for (const m of html.matchAll(/\b(?:src|href|srcset)="([^"#?\s]+)/g)) {
      if (/^([a-z]+:|\/\/)/i.test(m[1])) continue;
      const primeiro = m[1].replace(/^\.?\//, '').split('/')[0];
      if (!primeiro) continue;
      const arquivo = fs.existsSync(path.join(RAIZ, primeiro)) ? primeiro : primeiro + '.html';
      assert.ok(fs.existsSync(path.join(RAIZ, arquivo)), `${p} aponta para "${m[1]}", que não existe`);
      usados.add(arquivo);
    }
  }
  for (const u of usados) assert.ok(entra(u), `.dockerignore deixa de fora "${u}", que o site usa`);

  const fora = ['node_modules', 'tests', 'tools', 'fotos', 'package.json', 'package-lock.json', '.git', '.gitignore', '.htaccess', '.vscode', 'logos-conexao-site', 'logos-conexao-site.zip'];
  for (const f of fora) assert.ok(!entra(f), `.dockerignore deixa entrar "${f}"`);
});
