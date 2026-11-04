/* =========================================================
   Tradução do site. O pt-BR é o original e não tem arquivo.
   - A chave é o próprio texto em pt-BR: i18n.t('Salvar'), i18n.t('Olá, {{nome}}', { nome: n }).
     Sem tradução, aparece o próprio texto.
   - Cada idioma tem o seu endereço: / (pt-BR, index.html), /pt-pt, /en e /es. As páginas dos outros
     idiomas são geradas já traduzidas por tools/gerar-idiomas.mjs (npm run idiomas), para o Google
     indexar cada uma; aqui elas só carregam o arquivo do idioma para os textos montados pelo JavaScript.
   - Páginas com <html data-i18n-auto> (a 404) escolhem o idioma do visitante e se traduzem aqui:
       data-i18n          traduz o conteúdo do elemento (a frase inteira, com <strong>, <span> etc. no meio).
                          <svg>, campos de formulário, botões, elementos vazios e filhos com data-i18n próprio
                          ficam onde estão e não entram na chave.
       data-i18n-attr     traduz atributos: data-i18n-attr="aria-label placeholder".
       data-i18n-num      formata o número no padrão do idioma (5,0 → 5.0).
       data-i18n-words    remonta o título palavra a palavra a partir do aria-label traduzido.
   - Texto em constante: tx('texto') só marca a chave; traduza ao mostrar, com i18n.t(constante.campo).
   - Traduções em assets/i18n/<idioma>.js, no formato { "texto original": "tradução" }.
   - O idioma escolhido fica no localStorage (cnx-idioma). Quem já escolheu e abre a página principal
     vai direto para o seu idioma.
   ========================================================= */
(function(){
  var ORIGINAL = 'pt-BR';
  var IDIOMAS = ['pt-BR', 'pt-PT', 'en-US', 'es-ES'];
  /* Página de cada idioma, a partir da raiz do site */
  var PAGINAS = { 'pt-BR': '', 'pt-PT': 'pt-pt', 'en-US': 'en', 'es-ES': 'es' };
  var CHAVE = 'cnx-idioma';
  var html = document.documentElement;
  var script = document.currentScript;
  var base = script.src.split('?')[0].replace(/[^\/]*$/, '');
  var raiz = base.replace(/assets\/i18n\/$/, '');
  var versao = (script.src.match(/\?[^#]*/) || [''])[0];

  var store = {
    ler: function(){ try { return localStorage.getItem(CHAVE); } catch (e) { return null; } },
    gravar: function(v){ try { localStorage.setItem(CHAVE, v); return localStorage.getItem(CHAVE) === v; } catch (e) { return false; } }
  };
  function valido(l){ return IDIOMAS.indexOf(l) >= 0 ? l : null; }
  function doNavegador(){
    var ls = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < ls.length; i++) {
      var l = String(ls[i]).toLowerCase();
      if (l === 'pt' || l === 'pt-br') return 'pt-BR';
      if (l.indexOf('pt-') === 0) return 'pt-PT';
      if (l === 'en' || l.indexOf('en-') === 0) return 'en-US';
      if (l === 'es' || l.indexOf('es-') === 0) return 'es-ES';
    }
    return null;
  }
  /* Abrindo os arquivos direto (index.html, en.html), os links usam o nome do arquivo */
  function endereco(l){
    var p = PAGINAS[l];
    if (/\.html$/.test(location.pathname)) p = (p || 'index') + '.html';
    return raiz + p;
  }

  var auto = html.hasAttribute('data-i18n-auto');
  var escolhido = valido(store.ler()), detectado = doNavegador();
  var lang = auto ? (escolhido || detectado || ORIGINAL) : (valido(html.lang) || ORIGINAL);
  var saindo = !auto && lang === ORIGINAL && escolhido && escolhido !== ORIGINAL;
  if (saindo) {
    html.style.visibility = 'hidden';
    location.replace(endereco(escolhido));
  }

  var dics = {}, esperando = {}, carregado = lang === ORIGINAL, domPronto = false, aplicado = false, desistiu = false, fila = [], faltando = [], limite = null;

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function limpa(s){ return String(s).replace(/\s+/g, ' ').trim(); }

  function traduz(l, chave, vars, anota){
    var d = dics[l], s = chave;
    if (d) {
      if (Object.prototype.hasOwnProperty.call(d, chave)) s = d[chave];
      else if (anota && faltando.indexOf(chave) < 0) faltando.push(chave);
    }
    if (vars && typeof vars === 'object') s = s.replace(/\{\{\s*(\w+)\s*\}\}/g, function(m, k){ return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m; });
    return s;
  }
  function t(chave, vars){ return traduz(lang, chave, vars, true); }
  function num(v, casas){
    try { return v.toLocaleString(lang, { minimumFractionDigits: casas, maximumFractionDigits: casas }); } catch (e) { return String(v); }
  }

  /* Carrega o arquivo de um idioma; fn(true) quando ele chegar, fn(false) se falhar */
  function carregar(l, fn){
    fn = fn || function(){};
    if (l === ORIGINAL || dics[l]) { fn(true); return; }
    if (esperando[l]) { esperando[l].push(fn); return; }
    esperando[l] = [fn];
    var s = document.createElement('script');
    s.src = base + l + '.js' + versao;
    s.onerror = function(){ var fs = esperando[l] || []; delete esperando[l]; fs.forEach(function(f){ f(false); }); };
    (document.head || html).appendChild(s);
  }

  /* ---- aplicar no HTML (só nas páginas data-i18n-auto) ---- */
  function fixo(n){
    if (n.nodeType !== 1) return n.nodeType !== 3;
    if (n.hasAttribute('data-i18n')) return true;
    if (/^(svg|img|input|select|textarea|canvas|button)$/i.test(n.nodeName)) return true;
    return !/^br$/i.test(n.nodeName) && !/\S/.test(n.textContent);
  }
  function trecho(el){
    var trechos = [], atual = [];
    Array.prototype.forEach.call(el.childNodes, function(n){
      if (fixo(n)) { if (atual.length) trechos.push(atual); atual = []; } else atual.push(n);
    });
    if (atual.length) trechos.push(atual);
    return trechos.filter(function(tr){ return tr.some(function(n){ return n.nodeType === 1 || /\S/.test(n.nodeValue); }); })[0];
  }
  function traduzConteudo(el){
    var tr = trecho(el); if (!tr) return;
    var caixa = document.createElement('div');
    tr.forEach(function(n){ caixa.appendChild(n.cloneNode(true)); });
    var chave = limpa(caixa.innerHTML), novo = t(chave);
    if (novo === chave) return;
    var primeiro = tr[0], ultimo = tr[tr.length - 1];
    var antes = primeiro.nodeType === 3 && /^\s/.test(primeiro.nodeValue) ? ' ' : '';
    var depois = ultimo.nodeType === 3 && /\s$/.test(ultimo.nodeValue) ? ' ' : '';
    var tpl = document.createElement('template');
    tpl.innerHTML = antes + novo + depois;
    el.insertBefore(tpl.content, primeiro);
    tr.forEach(function(n){ el.removeChild(n); });
  }
  function traduzEl(el){
    if (el.hasAttribute('data-i18n')) traduzConteudo(el);
    var at = el.getAttribute('data-i18n-attr');
    if (at) at.split(/[\s,]+/).forEach(function(a){ if (a && el.hasAttribute(a)) el.setAttribute(a, t(limpa(el.getAttribute(a)))); });
    if (el.hasAttribute('data-i18n-words')) {
      el.innerHTML = el.getAttribute('aria-label').split(' ').map(function(w, i){
        return '<span class="w' + (w.charAt(0) === '#' ? ' mark tag' : '') + '" style="--i:' + i + '">' + esc(w) + '</span>';
      }).join(' ');
    }
    if (el.hasAttribute('data-i18n-num')) {
      var txt = limpa(el.textContent), casas = (txt.split(',')[1] || '').length;
      el.textContent = num(parseFloat(txt.replace(/\./g, '').replace(',', '.')), casas);
    }
  }
  function aplicar(){
    if (aplicado) return;
    aplicado = true;
    if (!auto || lang === ORIGINAL) return;
    html.lang = lang;
    var els = document.querySelectorAll('[data-i18n],[data-i18n-attr],[data-i18n-num],[data-i18n-words]');
    for (var i = 0; i < els.length; i++) traduzEl(els[i]);
  }
  function mostrar(){
    if (saindo) return;
    html.style.removeProperty('visibility');
    if (!html.getAttribute('style')) html.removeAttribute('style');
  }
  function seguir(){
    if (!carregado || !domPronto) return;
    aplicar();
    while (fila.length) {
      var f = fila.shift();
      try { f(); } catch (e) { setTimeout(function(){ throw e; }); }
    }
    mostrar();
  }

  /* ---- carregar o idioma da página ---- */
  function desistir(){
    if (carregado) return;
    desistiu = true; clearTimeout(limite);
    if (auto) { lang = ORIGINAL; api.lang = lang; }
    carregado = true;
    seguir();
  }
  if (!carregado) {
    html.style.visibility = 'hidden';
    limite = setTimeout(desistir, 3000);
    carregar(lang, function(ok){
      if (desistiu) return;
      if (!ok) { desistir(); return; }
      clearTimeout(limite); carregado = true; seguir();
    });
  }
  document.addEventListener('DOMContentLoaded', function(){ domPronto = true; seguir(); });

  var api = window.i18n = {
    original: ORIGINAL,
    idiomas: IDIOMAS,
    lang: lang,
    faltando: faltando,
    /* Idioma do navegador, quando é diferente do da página e o visitante ainda não escolheu nenhum */
    sugerido: !auto && !escolhido && detectado && detectado !== lang ? detectado : null,
    t: t,
    /* Traduz para outro idioma já carregado com i18n.carregar (usado no aviso de idioma) */
    tEm: function(l, chave, vars){ return traduz(l, chave, vars, false); },
    num: num,
    endereco: endereco,
    carregar: carregar,
    lembrar: function(l){ return valido(l) ? store.gravar(l) : false; },
    escolher: function(l){ if (!valido(l)) return; store.gravar(l); location.assign(endereco(l)); },
    /* roda fn depois da tradução aplicada; chame no fim do <body> */
    pronto: function(fn){ fila.push(fn); domPronto = true; seguir(); },
    /* chamado pelos arquivos de idioma */
    adicionar: function(l, d){
      if (!valido(l) || dics[l]) return;
      dics[l] = d;
      var fs = esperando[l] || []; delete esperando[l];
      fs.forEach(function(f){ f(true); });
    }
  };
  window.tx = function(s){ return s; };
})();
