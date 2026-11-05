// Confere se todo texto marcado para tradução tem tradução certa em todos os idiomas,
// se as páginas geradas (en.html etc.) estão atualizadas e se o index.html aponta para todas (hreflang).
//
//   npm test                     roda junto com os outros testes
//   npm run i18n -- --listar     imprime cada chave e onde ela aparece
//
// Chaves reunidas:
//   - HTML: elementos com data-i18n (o conteúdo, sem <svg>, campos, botões, elementos vazios e filhos com data-i18n)
//           e atributos listados em data-i18n-attr. A regra é a mesma de assets/i18n/i18n.js.
//   - JavaScript (lido pela árvore do TypeScript, então comentários não contam): t('…'), tx('…'), i18n.t('…'), i18n.tx('…').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse } from 'parse5';
import { RAIZ, PASTA_I18N, RUNTIME, HREFLANG, ler, limpa, attr, ehElemento, trechos, chaveDoTrecho, temMarcaDentro, andar, nomeChamada, lerConfig, lerTraducoes } from '../tools/i18n-comum.mjs';
import { gerar } from '../tools/gerar-idiomas.mjs';

const PAGINAS_FONTE = ['index.html', '404.html'];
const FUNCOES = new Set(['t', 'tx', 'i18n.t', 'i18n.tx']);
// Marcas e nomes próprios: se aparecem no original, precisam continuar na tradução.
const MARCAS = [
  'Conexão', 'AlicIA', 'NEX', 'NEX Intelligence', 'Sirify', 'SiriFY', 'Super Estrutura Conexão', '#SuperEstruturasCNX',
  'Cnx Marketing e Tecnologia', 'M. Leite Empreendimento em Marketing Ltda', 'Galeria Manhattan', 'Petrolina', 'Marcos Leite',
  'WhatsApp', 'Google', 'Google Maps', 'Meta', 'Instagram', 'Itaú', 'Fiolaser', 'Itaipava', 'Bellife', 'Auto Vale',
  'crm.nexintelligence.com.br',
];

/* ---------- HTML ---------- */
function chavesDoHtml(arquivo, add, erro) {
  const doc = parse(ler(arquivo), { sourceCodeLocationInfo: true });
  const scripts = [];
  andar(doc, (n) => {
    const onde = `${arquivo}:${n.sourceCodeLocation ? n.sourceCodeLocation.startLine : 0}`;
    if (attr(n, 'data-i18n')) {
      const trs = trechos(n);
      if (trs.length !== 1) erro(`${onde}: <${n.tagName} data-i18n> precisa de exatamente um trecho de texto (achou ${trs.length})`);
      if (trs.length) {
        if (trs[0].some((c) => ehElemento(c) && ((c.attrs || []).some((a) => a.name.startsWith('data-i18n')) || temMarcaDentro(c)))) erro(`${onde}: há outra marcação data-i18n dentro do texto de <${n.tagName} data-i18n>`);
        add(chaveDoTrecho(trs[0]), onde, 'HTML');
      }
    }
    const at = attr(n, 'data-i18n-attr');
    if (at) {
      for (const nome of at.value.split(/[\s,]+/).filter(Boolean)) {
        const a = attr(n, nome);
        if (!a) erro(`${onde}: data-i18n-attr pede "${nome}", mas o elemento não tem esse atributo`);
        else add(limpa(a.value), onde, `atributo ${nome}`);
      }
    }
    if (attr(n, 'data-i18n-words') && !(at && /\baria-label\b/.test(at.value))) erro(`${onde}: data-i18n-words precisa de data-i18n-attr="aria-label"`);
    if (n.tagName === 'script' && !attr(n, 'src')) {
      const tipo = attr(n, 'type');
      const txt = n.childNodes[0];
      if ((!tipo || /javascript|module/.test(tipo.value)) && txt) scripts.push({ codigo: txt.value, linha: txt.sourceCodeLocation.startLine });
    }
  });
  for (const s of scripts) chavesDoScript(s.codigo, arquivo, s.linha, add, erro);
}

/* ---------- JavaScript ---------- */
function chavesDoScript(codigo, arquivo, linhaBase, add, erro) {
  const sf = ts.createSourceFile(arquivo, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  (function visitar(no) {
    if (ts.isCallExpression(no)) {
      const nome = nomeChamada(no.expression);
      if (nome && FUNCOES.has(nome) && no.arguments.length) {
        const a = no.arguments[0];
        const onde = `${arquivo}:${linhaBase + sf.getLineAndCharacterOfPosition(a.getStart(sf)).line}`;
        if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) add(a.text, onde, nome + '()');
        else if (ts.isTemplateExpression(a)) erro(`${onde}: ${nome}() com \${…}; use {{variavel}} na chave`);
        else if (nome.endsWith('tx')) erro(`${onde}: ${nome}() precisa de um texto literal`);
        // t(constante.campo) é permitido: a chave vem de um tx('…') na constante.
      }
    }
    ts.forEachChild(no, visitar);
  })(sf);
}

/* ---------- reunir tudo ---------- */
function reunir() {
  const chaves = new Map();
  const erros = [];
  const add = (chave, onde, como) => {
    if (!chave) { erros.push(`${onde}: chave vazia (${como})`); return; }
    if (!chaves.has(chave)) chaves.set(chave, []);
    chaves.get(chave).push(`${onde} (${como})`);
  };
  const erro = (m) => erros.push(m);
  for (const p of PAGINAS_FONTE) chavesDoHtml(p, add, erro);
  chavesDoScript(ler(RUNTIME), RUNTIME, 1, add, erro);
  const config = lerConfig();
  const traducoes = {};
  for (const arq of fs.readdirSync(path.join(RAIZ, PASTA_I18N)).filter((f) => f.endsWith('.js') && f !== 'i18n.js').sort()) {
    const rel = `${PASTA_I18N}/${arq}`;
    const r = lerTraducoes(rel, erro);
    if (r.idioma && r.idioma + '.js' !== arq) erro(`${rel}: o arquivo diz ser ${r.idioma}`);
    traducoes[arq.replace(/\.js$/, '')] = { arquivo: rel, dic: r.dic };
  }
  return { chaves, erros, traducoes, ...config };
}

const variaveis = (s) => (s.match(/\{\{\s*\w+\s*\}\}/g) || []).map((v) => v.replace(/\s/g, '')).sort();
const tags = (s) => (s.match(/<\/?[a-zA-Z][^>]*>/g) || []).sort();
const temMarca = (s, m) => new RegExp(`(?<![\\p{L}\\p{N}])${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(s);

function problemasDoIdioma(idioma, chaves, traducoes) {
  const p = [];
  const t = traducoes[idioma];
  if (!t) return [`falta o arquivo ${PASTA_I18N}/${idioma}.js`];
  for (const [chave, locais] of chaves) {
    const item = t.dic.get(chave);
    if (!item) { p.push(`sem tradução: ${JSON.stringify(chave)} (${locais[0]})`); continue; }
    const v = item.valor, onde = `${t.arquivo}:${item.linha}`;
    if (!v.trim()) p.push(`${onde}: tradução vazia de ${JSON.stringify(chave)}`);
    if (JSON.stringify(variaveis(chave)) !== JSON.stringify(variaveis(v))) p.push(`${onde}: variáveis {{…}} diferentes do original em ${JSON.stringify(chave)}`);
    if (JSON.stringify(tags(chave)) !== JSON.stringify(tags(v))) p.push(`${onde}: marcações <…> diferentes do original em ${JSON.stringify(chave)}`);
    for (const m of MARCAS) if (temMarca(chave, m) && !temMarca(v, m)) p.push(`${onde}: a marca "${m}" sumiu da tradução de ${JSON.stringify(chave)}`);
  }
  for (const [chave, item] of t.dic) if (!chaves.has(chave)) p.push(`${t.arquivo}:${item.linha}: tradução que o código não usa mais: ${JSON.stringify(chave)}`);
  return p;
}

/* ---------- --listar ---------- */
if (process.argv.includes('--listar')) {
  const { chaves, erros, original, idiomas, traducoes } = reunir();
  for (const [chave, locais] of chaves) {
    const faltam = idiomas.filter((l) => l !== original && !(traducoes[l] && traducoes[l].dic.has(chave)));
    console.log(JSON.stringify(chave) + (faltam.length ? `   [falta: ${faltam.join(', ')}]` : ''));
    for (const l of locais) console.log('    ' + l);
  }
  console.log(`\n${chaves.size} chaves.`);
  if (erros.length) console.log('\nProblemas na marcação:\n- ' + erros.join('\n- '));
} else {
  const { chaves, erros, original, idiomas, paginas, traducoes } = reunir();

  test('a marcação dos textos é válida', () => {
    assert.deepEqual(erros, []);
    assert.ok(chaves.size > 0, 'nenhuma chave encontrada');
  });

  test('há um arquivo de tradução para cada idioma e nenhum a mais', () => {
    assert.equal(original, 'pt-BR');
    const esperados = idiomas.filter((l) => l !== original).sort();
    assert.deepEqual(Object.keys(traducoes).sort(), esperados);
    assert.deepEqual(Object.keys(paginas).sort(), [...idiomas].sort(), 'PAGINAS precisa ter um endereço para cada idioma');
  });

  for (const idioma of idiomas.filter((l) => l !== original)) {
    test(`tradução completa e coerente: ${idioma}`, () => {
      assert.deepEqual(problemasDoIdioma(idioma, chaves, traducoes), []);
    });
  }

  test('as páginas dos outros idiomas estão atualizadas (npm run idiomas)', () => {
    const desatualizadas = Object.entries(gerar()).filter(([nome, conteudo]) => {
      const caminho = path.join(RAIZ, nome);
      return !fs.existsSync(caminho) || fs.readFileSync(caminho, 'utf8') !== conteudo;
    }).map(([nome]) => nome);
    assert.deepEqual(desatualizadas, []);
  });

  test('o index.html aponta para a versão de cada idioma (hreflang)', () => {
    const links = {};
    let canonico = null;
    andar(parse(ler('index.html')), (el) => {
      if (el.tagName !== 'link') return;
      const rel = attr(el, 'rel')?.value;
      if (rel === 'canonical') canonico = attr(el, 'href').value;
      if (rel === 'alternate' && attr(el, 'hreflang')) links[attr(el, 'hreflang').value] = attr(el, 'href').value;
    });
    assert.ok(canonico, 'falta <link rel="canonical">');
    const base = canonico.replace(/\/?$/, '/');
    const esperado = Object.fromEntries(idiomas.map((l) => [HREFLANG[l], base + paginas[l]]));
    esperado['x-default'] = base + paginas[original];
    assert.deepEqual(links, esperado);
  });
}
