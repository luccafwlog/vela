// Recuperação de chunk ausente/corrompido no navegador (incidente 2026-10-07).
// Script clássico, fora do bundle: precisa rodar mesmo quando o próprio entry
// module não carrega. Rebusca o arquivo ignorando o cache HTTP (sobrescreve
// uma cópia ruim guardada como immutable) e recarrega UMA vez por arquivo na
// sessão, para não entrar em loop se o arquivo realmente não existir.
;(function (w) {
  function recover(url) {
    var key = 'chunk-reload:' + url
    try {
      if (w.sessionStorage.getItem(key)) return false
      w.sessionStorage.setItem(key, '1')
    } catch (e) {
      return false
    }
    var reload = function () { w.location.reload() }
    w.fetch(url, { cache: 'reload' }).then(reload, reload)
    return true
  }
  w.__velaRecoverChunk = recover
  // Falha do grafo do entry module (ex.: dependência estática servida como HTML).
  w.document.addEventListener('error', function (event) {
    var el = event.target
    if (el && el.tagName === 'SCRIPT' && el.type === 'module' && el.src.indexOf('/assets/') !== -1) recover(el.src)
    if (el && el.tagName === 'LINK' && el.rel === 'modulepreload' && el.href.indexOf('/assets/') !== -1) recover(el.href)
  }, true)
  // Falha de preload de import dinâmico emitida pelo Vite.
  w.addEventListener('vite:preloadError', function (event) {
    var match = /https?:\/\/\S+?\/assets\/\S+?\.(?:js|css)/.exec(String(event.payload && event.payload.message))
    if (match && recover(match[0])) event.preventDefault()
  })
})(window)
