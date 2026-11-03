/* =========================================================
   Tradução do site. O pt-BR é o original e não tem arquivo.
   - A chave é o próprio texto em pt-BR: i18n.t('Salvar'), i18n.t('Olá, {{nome}}', { nome: n }).
     Sem tradução, aparece o próprio texto.
   - No HTML:
       data-i18n          traduz o conteúdo do elemento (a frase inteira, com <strong>, <span> etc. no meio).
                          <svg>, campos de formulário, botões, elementos vazios e filhos com data-i18n próprio
                          ficam onde estão e não entram na chave.
       data-i18n-attr     traduz atributos: data-i18n-attr="aria-label placeholder".
       data-i18n-num      formata o número no padrão do idioma (5,0 → 5.0).
       data-i18n-words    remonta o título palavra a palavra a partir do aria-label traduzido.
   - Texto em constante: tx('texto') só marca a chave; traduza ao mostrar, com i18n.t(constante.campo).
   - Traduções em assets/i18n/<idioma>.js, no formato { "texto original": "tradução" }.
   - O idioma escolhido fica no localStorage (cnx-idioma). Sem storage, vai no endereço (?lang=en-US).
     Trocar de idioma recarrega a página.
   ========================================================= */
(function(){
  var ORIGINAL = 'pt-BR';
  var IDIOMAS = ['pt-BR', 'pt-PT', 'en-US', 'es-ES'];
  var CHAVE = 'cnx-idioma';
  var html = document.documentElement;
  var script = document.currentScript;
  var base = script.src.split('?')[0].replace(/[^\/]*$/, '');
  var versao = (script.src.match(/\?[^#]*/) || [''])[0];

  var store = {
    ler: function(){ try { return localStorage.getItem(CHAVE); } catch (e) { return null; } },
    gravar: function(v){ try { localStorage.setItem(CHAVE, v); return localStorage.getItem(CHAVE) === v; } catch (e) { return false; } }
  };
  function valido(l){ return IDIOMAS.indexOf(l) >= 0 ? l : null; }
  function doEndereco(){ var m = /[?&]lang=([^&#]*)/.exec(location.search); return m ? valido(decodeURIComponent(m[1])) : null; }
  function doNavegador(){
    var ls = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < ls.length; i++) {
      var l = String(ls[i]).toLowerCase();
      if (l === 'pt' || l === 'pt-br') return 'pt-BR';
      if (l.indexOf('pt-') === 0) return 'pt-PT';
      if (l === 'en' || l.indexOf('en-') === 0) return 'en-US';
      if (l === 'es' || l.indexOf('es-') === 0) return 'es-ES';
    }
    return ORIGINAL;
  }

  var pedido = doEndereco();
  if (pedido) store.gravar(pedido);
  var lang = pedido || valido(store.ler()) || doNavegador();
  var dic = null, carregado = lang === ORIGINAL, domPronto = false, aplicado = false, desistiu = false, fila = [], faltando = [], limite = null;

  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function limpa(s){ return String(s).replace(/\s+/g, ' ').trim(); }

  function t(chave, vars){
    var s = chave;
    if (dic) {
      if (Object.prototype.hasOwnProperty.call(dic, chave)) s = dic[chave];
      else if (faltando.indexOf(chave) < 0) faltando.push(chave);
    }
    if (vars && typeof vars === 'object') s = s.replace(/\{\{\s*(\w+)\s*\}\}/g, function(m, k){ return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m; });
    return s;
  }
  function num(v, casas){
    try { return v.toLocaleString(lang, { minimumFractionDigits: casas, maximumFractionDigits: casas }); } catch (e) { return String(v); }
  }

  /* ---- aplicar no HTML ---- */
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
    html.lang = lang;
    if (lang === ORIGINAL) return;
    var els = document.querySelectorAll('[data-i18n],[data-i18n-attr],[data-i18n-num],[data-i18n-words]');
    for (var i = 0; i < els.length; i++) traduzEl(els[i]);
  }
  function mostrar(){
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

  /* ---- carregar o idioma ---- */
  function desistir(){
    if (carregado) return;
    desistiu = true; clearTimeout(limite);
    lang = ORIGINAL; dic = null; carregado = true;
    api.lang = lang;
    seguir();
  }
  if (!carregado) {
    html.style.visibility = 'hidden';
    var s = document.createElement('script');
    s.src = base + lang + '.js' + versao;
    s.onerror = desistir;
    (document.head || html).appendChild(s);
    limite = setTimeout(desistir, 3000);
  }
  document.addEventListener('DOMContentLoaded', function(){ domPronto = true; seguir(); });

  function escolher(l){
    l = valido(l); if (!l) return;
    var guardou = store.gravar(l);
    var busca = location.search.replace(/([?&])lang=[^&#]*&?/, '$1').replace(/[?&]$/, '');
    if (!guardou) busca += (busca ? '&' : '?') + 'lang=' + encodeURIComponent(l);
    if (busca === location.search) location.reload();
    else location.replace(location.pathname + busca + location.hash);
  }

  var api = window.i18n = {
    original: ORIGINAL,
    idiomas: IDIOMAS,
    lang: lang,
    faltando: faltando,
    t: t,
    num: num,
    escolher: escolher,
    /* roda fn depois da tradução aplicada; chame no fim do <body> */
    pronto: function(fn){ fila.push(fn); domPronto = true; seguir(); },
    /* chamado pelos arquivos de idioma */
    adicionar: function(l, d){ if (l !== lang || carregado || desistiu) return; dic = d; carregado = true; clearTimeout(limite); seguir(); }
  };
  window.tx = function(s){ return s; };
})();
