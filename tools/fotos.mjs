// Abre o site num Chrome sem janela e tira fotos de cada idioma.
//
//   node tools/fotos.mjs --antes --saida <pasta>   guarda a versão atual em pt-BR (antes de mudar algo)
//   node tools/fotos.mjs --saida <pasta>           fotografa todos os idiomas, confere o seletor e a
//                                                   detecção de idioma e compara o pt-BR com o "antes"
//
// O Chrome é procurado nos caminhos padrão; para usar outro, defina CHROME_PATH.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IDIOMAS = ['pt-BR', 'pt-PT', 'en-US', 'es-ES'];
const CHAVE_STORE = 'cnx-idioma';
const TELAS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
};
// Congela animações e esconde o que é aleatório (rede do hero e cursor), para as fotos serem comparáveis.
const CSS_CONGELA = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}#net,#cursor{visibility:hidden!important}';

const args = process.argv.slice(2);
const ANTES = args.includes('--antes');
const iSaida = args.indexOf('--saida');
const SAIDA = path.resolve(iSaida >= 0 ? args[iSaida + 1] : path.join(RAIZ, 'fotos'));
fs.mkdirSync(SAIDA, { recursive: true });

function acharChrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const achado = candidatos.find((c) => fs.existsSync(c));
  if (!achado) throw new Error('Chrome não encontrado. Defina CHROME_PATH.');
  return achado;
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml' };

function servidor() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const arq = path.join(RAIZ, p);
      const dentro = arq.startsWith(RAIZ + path.sep);
      if (dentro && fs.existsSync(arq) && fs.statSync(arq).isFile()) {
        res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
        fs.createReadStream(arq).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': TIPOS['.html'] });
        fs.createReadStream(path.join(RAIZ, '404.html')).pipe(res);
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// HTML da página sem scripts, sem o seletor de idioma e sem os atributos de marcação da tradução.
function domNormalizado() {
  const doc = document.documentElement.cloneNode(true);
  doc.querySelectorAll('script, #lang').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((a) => { if (a.name.startsWith('data-i18n')) el.removeAttribute(a.name); });
  });
  return doc.outerHTML;
}

async function abrir(browser, url, { tela, idioma, linguas, prepara }) {
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  await page.setViewport(TELAS[tela]);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((chave, idioma, linguas) => {
    try { if (idioma) localStorage.setItem(chave, idioma); else localStorage.removeItem(chave); } catch (e) {}
    if (linguas) Object.defineProperty(navigator, 'languages', { get: () => linguas });
  }, CHAVE_STORE, idioma || null, linguas || null);
  if (prepara) await page.evaluateOnNewDocument(prepara);
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.addStyleTag({ content: CSS_CONGELA });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));
  return { page, erros };
}

async function fotografar(browser, base, nome, opts) {
  const { page, erros } = await abrir(browser, base + (opts.caminho || '/'), opts);
  const arq = path.join(SAIDA, `${nome}.png`);
  await page.screenshot({ path: arq, fullPage: true });
  const info = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    titulo: document.title,
    faltando: window.i18n ? window.i18n.faltando.slice() : [],
  }));
  const dom = await page.evaluate(domNormalizado);
  await page.close();
  return { arq, info, dom, erros };
}

// Compara duas fotos pixel a pixel dentro do Chrome e devolve quantos pixels mudaram e em que faixa da página.
async function compararFotos(browser, a, b) {
  const page = await browser.newPage();
  const res = await page.evaluate(async (da, db) => {
    const carregar = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [ia, ib] = await Promise.all([carregar(da), carregar(db)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { tamanhoDiferente: true, a: [ia.width, ia.height], b: [ib.width, ib.height] };
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const pa = px(ia), pb = px(ib);
    let n = 0, y0 = -1, y1 = -1;
    for (let i = 0; i < pa.length; i += 4) {
      if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) { n++; const y = Math.floor(i / 4 / ia.width); if (y0 < 0) y0 = y; y1 = y; }
    }
    return { diferentes: n, faixa: n ? [y0, y1] : null, a: [ia.width, ia.height] };
  }, 'data:image/png;base64,' + fs.readFileSync(a).toString('base64'), 'data:image/png;base64,' + fs.readFileSync(b).toString('base64'));
  await page.close();
  return res;
}

async function main() {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await puppeteer.launch({ executablePath: acharChrome(), headless: true, args: ['--lang=pt-BR'] });
  const problemas = [];
  try {
    if (ANTES) {
      for (const tela of Object.keys(TELAS)) {
        const r = await fotografar(browser, base, `antes-pt-BR-${tela}`, { tela });
        fs.writeFileSync(path.join(SAIDA, `antes-dom-${tela}.html`), r.dom);
        console.log(`antes (${tela}): ${r.arq}`);
        if (r.erros.length) console.log('  erros no console:', r.erros);
      }
      return;
    }

    for (const idioma of IDIOMAS) {
      for (const tela of Object.keys(TELAS)) {
        const r = await fotografar(browser, base, `${idioma}-${tela}`, { tela, idioma });
        console.log(`${idioma} (${tela}): ${r.arq}`);
        if (r.info.lang !== idioma) problemas.push(`${idioma} ${tela}: <html lang> ficou "${r.info.lang}"`);
        if (r.info.faltando.length) problemas.push(`${idioma} ${tela}: textos sem tradução na página: ${JSON.stringify(r.info.faltando)}`);
        if (r.erros.length) problemas.push(`${idioma} ${tela}: erros no console: ${r.erros.join(' | ')}`);
        if (idioma === 'pt-BR') {
          const domAntes = path.join(SAIDA, `antes-dom-${tela}.html`);
          const fotoAntes = path.join(SAIDA, `antes-pt-BR-${tela}.png`);
          if (fs.existsSync(domAntes)) {
            const igual = fs.readFileSync(domAntes, 'utf8') === r.dom;
            console.log(`  pt-BR x antes, HTML da página (${tela}): ${igual ? 'idêntico' : 'DIFERENTE'}`);
            if (!igual) { fs.writeFileSync(path.join(SAIDA, `depois-dom-${tela}.html`), r.dom); problemas.push(`pt-BR ${tela}: o HTML da página mudou (veja depois-dom-${tela}.html)`); }
            const cmp = await compararFotos(browser, fotoAntes, r.arq);
            console.log(`  pt-BR x antes, foto (${tela}): ${JSON.stringify(cmp)}`);
          }
        }
      }
      const r404 = await fotografar(browser, base, `${idioma}-404`, { tela: 'mobile', idioma, caminho: '/nao-existe' });
      console.log(`${idioma} (404): ${r404.arq}`);
      if (r404.info.faltando.length) problemas.push(`${idioma} 404: textos sem tradução: ${JSON.stringify(r404.info.faltando)}`);
      if (r404.erros.length) problemas.push(`${idioma} 404: erros no console: ${r404.erros.join(' | ')}`);
    }

    // Primeira visita: o idioma vem do navegador.
    const casos = [[['pt-BR'], 'pt-BR'], [['pt'], 'pt-BR'], [['pt-PT'], 'pt-PT'], [['en-GB', 'en'], 'en-US'], [['es-MX'], 'es-ES'], [['fr-FR'], 'pt-BR'], [['de-DE', 'es-ES'], 'es-ES']];
    for (const [linguas, esperado] of casos) {
      const { page, erros } = await abrir(browser, base + '/', { tela: 'desktop', linguas });
      const lang = await page.evaluate(() => window.i18n.lang);
      await page.close();
      console.log(`detecção ${JSON.stringify(linguas)} → ${lang}`);
      if (lang !== esperado) problemas.push(`detecção ${JSON.stringify(linguas)}: esperado ${esperado}, veio ${lang}`);
      if (erros.length) problemas.push(`detecção ${JSON.stringify(linguas)}: erros: ${erros.join(' | ')}`);
    }

    // Storage bloqueado: a página precisa abrir normalmente e o seletor troca o idioma pelo endereço.
    {
      const bloqueia = () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado'); } }); };
      const { page, erros } = await abrir(browser, base + '/', { tela: 'desktop', linguas: ['pt-BR'], prepara: bloqueia });
      await page.click('#langBtn');
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#langMenu [data-lang="es-ES"]')]);
      const r = await page.evaluate(() => ({ lang: window.i18n.lang, url: location.search }));
      await page.close();
      console.log(`storage bloqueado → ${JSON.stringify(r)}`);
      if (r.lang !== 'es-ES') problemas.push(`storage bloqueado: o seletor não trocou o idioma (${JSON.stringify(r)})`);
      if (erros.length) problemas.push(`storage bloqueado: erros: ${erros.join(' | ')}`);
    }

    // Seletor: escolher English recarrega em inglês e guarda a escolha.
    {
      const { page, erros } = await abrir(browser, base + '/', { tela: 'mobile', idioma: 'pt-BR' });
      await page.click('#langBtn');
      await page.screenshot({ path: path.join(SAIDA, 'seletor-aberto-mobile.png') });
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#langMenu [data-lang="en-US"]')]);
      const r = await page.evaluate((chave) => ({ lang: window.i18n.lang, guardado: localStorage.getItem(chave), h1: document.querySelector('h1').getAttribute('aria-label') }), CHAVE_STORE);
      await page.close();
      console.log(`seletor → ${JSON.stringify(r)}`);
      if (r.lang !== 'en-US' || r.guardado !== 'en-US') problemas.push(`seletor: ${JSON.stringify(r)}`);
      if (erros.length) problemas.push(`seletor: erros: ${erros.join(' | ')}`);
    }
  } finally {
    await browser.close();
    srv.close();
  }
  if (problemas.length) {
    console.log('\nPROBLEMAS:\n- ' + problemas.join('\n- '));
    process.exitCode = 1;
  } else if (!ANTES) {
    console.log('\nTudo certo.');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
