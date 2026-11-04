// Abre o site num Chrome sem janela, tira fotos de cada idioma e confere o comportamento da tradução.
//
//   node tools/fotos.mjs --antes --saida <pasta>   guarda a versão atual em pt-BR (antes de mudar algo)
//   node tools/fotos.mjs --saida <pasta>           fotografa todos os idiomas, confere seletor, aviso de idioma
//                                                   e redirecionamento, e compara o pt-BR com o "antes"
//   --raiz <pasta>                                  serve outra cópia do site (ex.: uma versão antiga)
//
// O servidor (tools/servidor.mjs) imita o .htaccess: /en serve en.html e o que não existe recebe a 404.html.
// O Chrome é procurado nos caminhos padrão; para usar outro, defina CHROME_PATH.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { criarServidor } from './servidor.mjs';

const argsRaiz = process.argv.indexOf('--raiz');
const RAIZ = argsRaiz >= 0 ? path.resolve(process.argv[argsRaiz + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGINAS = { 'pt-BR': '/', 'pt-PT': '/pt-pt', 'en-US': '/en', 'es-ES': '/es' };
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

function servidor() {
  return new Promise((resolve) => {
    const srv = criarServidor(RAIZ);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// HTML da página sem scripts, CSS, comentários, seletor e aviso de idioma, links hreflang, atributos de
// marcação da tradução e espaços entre as tags: o que sobra é o conteúdo que o visitante vê.
function domNormalizado() {
  const doc = document.documentElement.cloneNode(true);
  doc.querySelectorAll('script, style, #lang, .lang-aviso, link[rel="alternate"]').forEach((n) => n.remove());
  const w = document.createTreeWalker(doc, NodeFilter.SHOW_COMMENT), comentarios = [];
  while (w.nextNode()) comentarios.push(w.currentNode);
  comentarios.forEach((c) => c.remove());
  doc.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((a) => { if (a.name.startsWith('data-i18n')) el.removeAttribute(a.name); });
  });
  return doc.outerHTML.replace(/>\s+</g, '><');
}

// idioma: o que fica gravado como escolha (null = nenhuma escolha). linguas: idiomas do navegador.
async function abrir(browser, url, { tela = 'desktop', idioma = null, linguas = null, prepara = null } = {}) {
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  // A própria página 404 responde com status 404; isso não é erro.
  page.on('console', (m) => { if (m.type() === 'error' && m.location().url !== page.url()) erros.push(m.text()); });
  await page.setViewport(TELAS[tela]);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  // A escolha é gravada só na primeira abertura da aba, para não desfazer o que o teste clicar depois.
  await page.evaluateOnNewDocument((chave, idioma, linguas) => {
    try {
      if (!sessionStorage.getItem('fotos-pronto')) {
        if (idioma) localStorage.setItem(chave, idioma); else localStorage.removeItem(chave);
        sessionStorage.setItem('fotos-pronto', '1');
      }
    } catch (e) {}
    if (linguas) Object.defineProperty(navigator, 'languages', { get: () => linguas });
  }, CHAVE_STORE, idioma, linguas);
  if (prepara) await page.evaluateOnNewDocument(prepara);
  await page.goto(url, { waitUntil: 'networkidle0' });
  return { page, erros };
}
async function congelar(page) {
  await page.addStyleTag({ content: CSS_CONGELA });
  // As bolinhas do diagrama do método são animação SVG (SMIL), que o CSS não para.
  await page.evaluate(() => document.querySelectorAll('svg').forEach((s) => { if (s.pauseAnimations) { s.pauseAnimations(); s.setCurrentTime(0); } }));
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));
}
const estado = (page) => page.evaluate((chave) => {
  const aviso = document.querySelector('.lang-aviso');
  let guardado = null; try { guardado = localStorage.getItem(chave); } catch (e) {}
  return {
    caminho: location.pathname,
    lang: document.documentElement.lang,
    h1: document.querySelector('h1') ? document.querySelector('h1').getAttribute('aria-label') : null,
    aviso: aviso ? { lang: aviso.getAttribute('lang'), texto: aviso.innerText.trim(), link: aviso.querySelector('a').getAttribute('href') } : null,
    guardado,
    faltando: window.i18n ? window.i18n.faltando.slice() : [],
  };
}, CHAVE_STORE);

async function fotografar(browser, base, nome, opts) {
  const { page, erros } = await abrir(browser, base + (opts.caminho || '/'), opts);
  await congelar(page);
  const arq = path.join(SAIDA, `${nome}.png`);
  await page.screenshot({ path: arq, fullPage: true });
  const info = await estado(page);
  const dom = await page.evaluate(domNormalizado);
  await page.close();
  return { arq, info, dom, erros };
}

// Compara duas fotos pixel a pixel dentro do Chrome e devolve as faixas da página que mudaram.
async function compararFotos(browser, a, b) {
  const page = await browser.newPage();
  const res = await page.evaluate(async (da, db) => {
    const carregar = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [ia, ib] = await Promise.all([carregar(da), carregar(db)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { tamanhoDiferente: true, a: [ia.width, ia.height], b: [ib.width, ib.height] };
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const pa = px(ia), pb = px(ib), w = ia.width, faixas = [];
    let n = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (pa[i] === pb[i] && pa[i + 1] === pb[i + 1] && pa[i + 2] === pb[i + 2]) continue;
      n++;
      const y = Math.floor(i / 4 / w), x = (i / 4) % w, f = faixas[faixas.length - 1];
      if (f && y - f.y[1] <= 8) { f.y[1] = y; f.x[0] = Math.min(f.x[0], x); f.x[1] = Math.max(f.x[1], x); }
      else faixas.push({ y: [y, y], x: [x, x] });
    }
    return { diferentes: n, faixas, tamanho: [ia.width, ia.height] };
  }, 'data:image/png;base64,' + fs.readFileSync(a).toString('base64'), 'data:image/png;base64,' + fs.readFileSync(b).toString('base64'));
  await page.close();
  return res;
}

async function main() {
  const srv = await servidor();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await puppeteer.launch({ executablePath: acharChrome(), headless: true, args: ['--lang=pt-BR'] });
  const problemas = [];
  const confere = (ok, msg) => { if (!ok) problemas.push(msg); };
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

    // Uma foto de cada idioma, no endereço dele (com a escolha já feita, para não aparecer o aviso).
    for (const [idioma, caminho] of Object.entries(PAGINAS)) {
      for (const tela of Object.keys(TELAS)) {
        const r = await fotografar(browser, base, `${idioma}-${tela}`, { tela, idioma, caminho });
        console.log(`${idioma} (${tela}): ${r.arq}`);
        confere(r.info.lang === idioma && r.info.caminho === caminho, `${idioma} ${tela}: abriu ${r.info.caminho} com <html lang="${r.info.lang}">`);
        confere(!r.info.faltando.length, `${idioma} ${tela}: textos sem tradução na página: ${JSON.stringify(r.info.faltando)}`);
        confere(!r.erros.length, `${idioma} ${tela}: erros no console: ${r.erros.join(' | ')}`);
        if (idioma === 'pt-BR') {
          const domAntes = path.join(SAIDA, `antes-dom-${tela}.html`);
          if (fs.existsSync(domAntes)) {
            const igual = fs.readFileSync(domAntes, 'utf8') === r.dom;
            console.log(`  pt-BR x antes, HTML da página (${tela}): ${igual ? 'idêntico' : 'DIFERENTE'}`);
            if (!igual) { fs.writeFileSync(path.join(SAIDA, `depois-dom-${tela}.html`), r.dom); problemas.push(`pt-BR ${tela}: o HTML da página mudou (veja depois-dom-${tela}.html)`); }
            console.log(`  pt-BR x antes, foto (${tela}): ${JSON.stringify(await compararFotos(browser, path.join(SAIDA, `antes-pt-BR-${tela}.png`), r.arq))}`);
          }
        }
      }
      const r404 = await fotografar(browser, base, `${idioma}-404`, { tela: 'mobile', idioma, caminho: '/nao-existe' });
      console.log(`${idioma} (404): ${r404.arq}`);
      confere(r404.info.lang === idioma, `${idioma} 404: <html lang="${r404.info.lang}">`);
      confere(!r404.info.faltando.length, `${idioma} 404: textos sem tradução: ${JSON.stringify(r404.info.faltando)}`);
      confere(!r404.erros.length, `${idioma} 404: erros no console: ${r404.erros.join(' | ')}`);
    }

    // Primeira visita: a página fica no idioma do endereço e, se o navegador for de outro idioma, aparece o aviso.
    const casos = [
      ['/', ['pt-BR'], null], ['/', ['pt'], null], ['/', ['fr-FR'], null],
      ['/', ['en-GB', 'en'], 'en-US'], ['/', ['es-MX'], 'es-ES'], ['/', ['pt-PT'], 'pt-PT'], ['/', ['de-DE', 'es-ES'], 'es-ES'],
      ['/en', ['pt-BR'], 'pt-BR'], ['/en', ['en-US'], null], ['/en', ['fr-FR'], null],
    ];
    for (const [caminho, linguas, sugerido] of casos) {
      const { page, erros } = await abrir(browser, base + caminho, { linguas });
      const e = await estado(page);
      await page.close();
      const idiomaDaPagina = Object.keys(PAGINAS).find((l) => PAGINAS[l] === caminho);
      console.log(`1ª visita ${caminho} com navegador ${JSON.stringify(linguas)} → página ${e.lang}, aviso: ${e.aviso ? `${e.aviso.lang} "${e.aviso.texto}" → ${e.aviso.link}` : 'nenhum'}`);
      confere(e.lang === idiomaDaPagina && e.caminho === caminho, `1ª visita ${caminho} ${JSON.stringify(linguas)}: a página mudou de idioma (${e.caminho}, ${e.lang})`);
      confere((e.aviso ? e.aviso.lang : null) === sugerido, `1ª visita ${caminho} ${JSON.stringify(linguas)}: aviso esperado ${sugerido}, veio ${e.aviso && e.aviso.lang}`);
      confere(!erros.length, `1ª visita ${caminho}: erros: ${erros.join(' | ')}`);
    }

    // Foto do aviso, e clicar nele leva para o idioma e guarda a escolha.
    {
      const { page, erros } = await abrir(browser, base + '/', { tela: 'mobile', linguas: ['en-US'] });
      await congelar(page);
      await page.screenshot({ path: path.join(SAIDA, 'aviso-idioma-mobile.png') });
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('.lang-aviso a')]);
      const e = await estado(page);
      await page.close();
      console.log(`clique no aviso → ${e.caminho} (${e.lang}), guardado: ${e.guardado}`);
      confere(e.caminho === '/en' && e.lang === 'en-US' && e.guardado === 'en-US', `clique no aviso: ${JSON.stringify(e)}`);
      confere(!erros.length, `clique no aviso: erros: ${erros.join(' | ')}`);
    }
    // Fechar o aviso guarda o idioma da página e ele não volta.
    {
      const { page, erros } = await abrir(browser, base + '/', { linguas: ['en-US'] });
      await page.click('.lang-aviso button');
      await page.reload({ waitUntil: 'networkidle0' });
      const e = await estado(page);
      await page.close();
      console.log(`fechar o aviso → aviso depois de recarregar: ${e.aviso ? 'sim' : 'não'}, guardado: ${e.guardado}`);
      confere(!e.aviso && e.guardado === 'pt-BR' && e.lang === 'pt-BR', `fechar o aviso: ${JSON.stringify(e)}`);
      confere(!erros.length, `fechar o aviso: erros: ${erros.join(' | ')}`);
    }
    // Quem já escolheu outro idioma e abre a página principal vai direto para ele.
    {
      const { page, erros } = await abrir(browser, base + '/', { idioma: 'es-ES' });
      const e = await estado(page);
      await page.close();
      console.log(`escolha guardada es-ES abrindo / → ${e.caminho} (${e.lang})`);
      confere(e.caminho === '/es' && e.lang === 'es-ES', `redirecionamento pela escolha: ${JSON.stringify(e)}`);
      confere(!erros.length, `redirecionamento: erros: ${erros.join(' | ')}`);
    }
    // Seletor: escolher English leva para /en e guarda a escolha.
    {
      const { page, erros } = await abrir(browser, base + '/', { tela: 'mobile', idioma: 'pt-BR' });
      await congelar(page);
      await page.click('#langBtn');
      await page.screenshot({ path: path.join(SAIDA, 'seletor-aberto-mobile.png') });
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#langMenu [data-lang="en-US"]')]);
      const e = await estado(page);
      await page.close();
      console.log(`seletor → ${e.caminho} (${e.lang}), guardado: ${e.guardado}`);
      confere(e.caminho === '/en' && e.lang === 'en-US' && e.guardado === 'en-US', `seletor: ${JSON.stringify(e)}`);
      confere(!erros.length, `seletor: erros: ${erros.join(' | ')}`);
    }
    // Storage bloqueado: a página abre normalmente e o seletor ainda troca de idioma.
    {
      const bloqueia = () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado'); } }); };
      const { page, erros } = await abrir(browser, base + '/', { linguas: ['pt-BR'], prepara: bloqueia });
      await page.click('#langBtn');
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#langMenu [data-lang="es-ES"]')]);
      const e = await estado(page);
      await page.close();
      console.log(`storage bloqueado → ${e.caminho} (${e.lang})`);
      confere(e.caminho === '/es' && e.lang === 'es-ES', `storage bloqueado: ${JSON.stringify(e)}`);
      confere(!erros.length, `storage bloqueado: erros: ${erros.join(' | ')}`);
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
