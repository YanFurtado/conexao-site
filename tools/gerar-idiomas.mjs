// Gera as páginas dos outros idiomas (pt-pt.html, en.html, es.html) já traduzidas, a partir do index.html
// e de assets/i18n/<idioma>.js, para o Google indexar cada idioma no seu endereço (/pt-pt, /en, /es).
// Rode de novo sempre que mudar o index.html ou uma tradução; o npm test avisa se esquecer.
//
//   npm run idiomas                    grava as páginas
//   npm run idiomas -- --conferir      só confere se estão atualizadas
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseFragment, serialize } from 'parse5';
import { RAIZ, PASTA_I18N, ler, limpa, attr, trechos, chaveDoTrecho, andar, lerConfig, lerTraducoes } from './i18n-comum.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function trocarFilhos(el, inicio, quantos, html) {
  const novos = parseFragment(el, html).childNodes;
  for (const n of novos) n.parentNode = el;
  el.childNodes.splice(inicio, quantos, ...novos);
}
function definir(el, nome, valor) {
  const a = attr(el, nome);
  if (a) a.value = valor; else el.attrs.push({ name: nome, value: valor });
}

// Aplica a tradução no documento, com as mesmas regras de assets/i18n/i18n.js.
function traduzir(doc, idioma, dic) {
  const t = (chave) => (dic.has(chave) ? dic.get(chave).valor : chave);
  andar(doc, (el) => {
    if (attr(el, 'data-i18n')) {
      const tr = trechos(el)[0];
      if (tr) {
        const chave = chaveDoTrecho(tr), novo = t(chave);
        if (novo !== chave) {
          const primeiro = tr[0], ultimo = tr[tr.length - 1];
          const antes = primeiro.nodeName === '#text' && /^\s/.test(primeiro.value) ? ' ' : '';
          const depois = ultimo.nodeName === '#text' && /\s$/.test(ultimo.value) ? ' ' : '';
          trocarFilhos(el, el.childNodes.indexOf(primeiro), tr.length, antes + novo + depois);
        }
      }
    }
    const at = attr(el, 'data-i18n-attr');
    if (at) {
      for (const nome of at.value.split(/[\s,]+/).filter(Boolean)) {
        const a = attr(el, nome);
        if (a) a.value = t(limpa(a.value));
      }
    }
    if (attr(el, 'data-i18n-words')) {
      const palavras = attr(el, 'aria-label').value.split(' ');
      trocarFilhos(el, 0, el.childNodes.length, palavras.map((w, i) => `<span class="w${w.charAt(0) === '#' ? ' mark tag' : ''}" style="--i:${i}">${esc(w)}</span>`).join(' '));
    }
    if (attr(el, 'data-i18n-num')) {
      const txt = limpa(el.childNodes.map((n) => n.value || '').join('')), casas = (txt.split(',')[1] || '').length;
      const v = parseFloat(txt.replace(/\./g, '').replace(',', '.'));
      trocarFilhos(el, 0, el.childNodes.length, esc(v.toLocaleString(idioma, { minimumFractionDigits: casas, maximumFractionDigits: casas })));
    }
  });
}

// Devolve { 'en.html': conteúdo, ... } sem gravar nada.
export function gerar() {
  const { original, idiomas, paginas } = lerConfig();
  const fonte = ler('index.html');
  const saida = {};
  for (const idioma of idiomas.filter((l) => l !== original)) {
    const { dic } = lerTraducoes(`${PASTA_I18N}/${idioma}.js`);
    const doc = parse(fonte);
    traduzir(doc, idioma, dic);
    let base = null;
    andar(doc, (el) => {
      if (el.tagName === 'html') definir(el, 'lang', idioma);
      if (el.tagName === 'link' && attr(el, 'rel')?.value === 'canonical') {
        base = attr(el, 'href').value.replace(/\/?$/, '/');
        definir(el, 'href', base + paginas[idioma]);
      }
    });
    andar(doc, (el) => {
      const prop = attr(el, 'property')?.value;
      if (el.tagName === 'meta' && prop === 'og:url') definir(el, 'content', base + paginas[idioma]);
      if (el.tagName === 'meta' && prop === 'og:locale') definir(el, 'content', idioma.replace('-', '_'));
    });
    const aviso = `<!-- Página gerada por tools/gerar-idiomas.mjs a partir do index.html e de ${PASTA_I18N}/${idioma}.js. Não edite aqui: edite o index.html ou a tradução e rode "npm run idiomas". -->`;
    saida[`${paginas[idioma]}.html`] = serialize(doc).replace(/^<!DOCTYPE html>/i, (m) => `${m}\n${aviso}`).replace(/\r?\n/g, '\r\n') + '\r\n';
  }
  return saida;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const conferir = process.argv.includes('--conferir');
  const desatualizados = [];
  for (const [nome, conteudo] of Object.entries(gerar())) {
    const caminho = path.join(RAIZ, nome);
    if (fs.existsSync(caminho) && fs.readFileSync(caminho, 'utf8') === conteudo) { console.log(`${nome}: já atualizado`); continue; }
    if (conferir) desatualizados.push(nome);
    else { fs.writeFileSync(caminho, conteudo); console.log(`${nome}: gravado`); }
  }
  if (desatualizados.length) { console.log(`Desatualizados: ${desatualizados.join(', ')}. Rode "npm run idiomas".`); process.exitCode = 1; }
}
