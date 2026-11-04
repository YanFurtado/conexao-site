// Regras de tradução usadas pelo teste (tests/i18n.test.mjs) e pelo gerador das páginas (tools/gerar-idiomas.mjs).
// As regras de qual parte do HTML vira chave são as mesmas de assets/i18n/i18n.js; se mudar lá, mude aqui.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { serialize } from 'parse5';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PASTA_I18N = 'assets/i18n';
export const RUNTIME = `${PASTA_I18N}/i18n.js`;
// Código usado no hreflang de cada idioma: inglês e espanhol valem para quem fala a língua em qualquer país.
export const HREFLANG = { 'pt-BR': 'pt-BR', 'pt-PT': 'pt-PT', 'en-US': 'en', 'es-ES': 'es' };

export const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
export const limpa = (s) => String(s).replace(/\s+/g, ' ').trim();

/* ---------- HTML (árvore do parse5) ---------- */
export const attr = (el, nome) => (el.attrs || []).find((a) => a.name === nome);
export const ehElemento = (n) => typeof n.tagName === 'string';
export const ehTexto = (n) => n.nodeName === '#text';
export function textoDe(n) {
  if (ehTexto(n)) return n.value;
  return (n.childNodes || []).map(textoDe).join('');
}
// Filhos que ficam onde estão e não entram na chave.
export function fixo(n) {
  if (!ehElemento(n)) return !ehTexto(n);
  if (attr(n, 'data-i18n')) return true;
  if (/^(svg|img|input|select|textarea|canvas|button)$/i.test(n.tagName)) return true;
  return n.tagName !== 'br' && !/\S/.test(textoDe(n));
}
// Trechos traduzíveis de um elemento com data-i18n (deve haver exatamente um).
export function trechos(el) {
  const lista = [];
  let atual = [];
  for (const n of el.childNodes) {
    if (fixo(n)) { if (atual.length) lista.push(atual); atual = []; } else atual.push(n);
  }
  if (atual.length) lista.push(atual);
  return lista.filter((tr) => tr.some((n) => ehElemento(n) || /\S/.test(n.value)));
}
export const chaveDoTrecho = (tr) => limpa(serialize({ nodeName: '#document-fragment', childNodes: tr }));
export function temMarcaDentro(n) {
  return (n.childNodes || []).some((c) => ehElemento(c) && ((c.attrs || []).some((a) => a.name.startsWith('data-i18n')) || temMarcaDentro(c)));
}
export function andar(n, fn) {
  if (ehElemento(n)) fn(n);
  for (const c of [...(n.childNodes || [])]) andar(c, fn);
  if (n.content) andar(n.content, fn);
}

/* ---------- JavaScript (árvore do TypeScript) ---------- */
export function nomeChamada(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) return `${expr.expression.text}.${expr.name.text}`;
  return null;
}
const arvore = (rel, codigo) => ts.createSourceFile(rel, codigo ?? ler(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

// ORIGINAL, IDIOMAS e PAGINAS, lidos de assets/i18n/i18n.js.
export function lerConfig() {
  let original = null, idiomas = null, paginas = null;
  (function visitar(no) {
    if (ts.isVariableDeclaration(no) && ts.isIdentifier(no.name) && no.initializer) {
      const v = no.initializer;
      if (no.name.text === 'ORIGINAL' && ts.isStringLiteral(v)) original = v.text;
      if (no.name.text === 'IDIOMAS' && ts.isArrayLiteralExpression(v)) idiomas = v.elements.map((e) => e.text);
      if (no.name.text === 'PAGINAS' && ts.isObjectLiteralExpression(v)) paginas = Object.fromEntries(v.properties.map((p) => [p.name.text, p.initializer.text]));
    }
    ts.forEachChild(no, visitar);
  })(arvore(RUNTIME));
  return { original, idiomas, paginas };
}

// Lê assets/i18n/<idioma>.js: i18n.adicionar('idioma', { "original": "tradução" }).
export function lerTraducoes(arquivo, erro = () => {}) {
  const sf = arvore(arquivo);
  let idioma = null;
  const dic = new Map();
  (function visitar(no) {
    if (ts.isCallExpression(no) && nomeChamada(no.expression) === 'i18n.adicionar') {
      const [l, obj] = no.arguments;
      if (!l || !ts.isStringLiteral(l) || !obj || !ts.isObjectLiteralExpression(obj)) { erro(`${arquivo}: use i18n.adicionar('idioma', { "original": "tradução" })`); return; }
      idioma = l.text;
      for (const p of obj.properties) {
        const linha = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
        if (!ts.isPropertyAssignment(p) || !ts.isStringLiteral(p.name) || !(ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer))) { erro(`${arquivo}:${linha}: cada item precisa ser "texto": "tradução"`); continue; }
        if (dic.has(p.name.text)) erro(`${arquivo}:${linha}: chave repetida: ${JSON.stringify(p.name.text)}`);
        dic.set(p.name.text, { valor: p.initializer.text, linha });
      }
    }
    ts.forEachChild(no, visitar);
  })(sf);
  if (!idioma) erro(`${arquivo}: não achei i18n.adicionar(...)`);
  return { idioma, dic };
}
