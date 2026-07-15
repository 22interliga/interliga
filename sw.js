// Sobe este número toda vez que você fizer uma mudança relevante no app
// (index.html, app.js, food.js, style.css). Isso força o navegador de
// TODOS os usuários a jogar fora o cache antigo automaticamente.
const CACHE_VERSION = 'v3';
const CACHE = 'interliga-' + CACHE_VERSION;
const BASE = '/interliga/';

// Arquivos essenciais pra funcionar offline (fallback), não pra servir
// como primeira opção — ver estratégia "network-first" abaixo.
const APP_SHELL = [
  BASE,
  BASE + 'manifest.json',
  BASE + 'app.js',
  BASE + 'food.js',
  BASE + 'style.css',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      // Apaga QUALQUER cache de versão anterior (v1, v2, etc.) — antes só
      // apagava se o nome fosse diferente, mas como o nome nunca mudava,
      // essa limpeza nunca era acionada de fato.
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Só cuida de requisições GET (evita interceptar POST/PUT do Firebase etc.)
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const ehArquivoDoApp = url.origin === self.location.origin;

  if (!ehArquivoDoApp) {
    // Recursos de fora (Firebase, fontes, mapas) — deixa passar direto,
    // sem interceptar nem cachear.
    return;
  }

  // NETWORK-FIRST: tenta buscar a versão mais nova da rede primeiro.
  // Só usa o cache se a rede falhar (offline) — antes era o contrário
  // (cache-first), por isso a versão nova nunca chegava no usuário.
  e.respondWith(
    fetch(e.request)
      .then(respostaRede => {
        // Atualiza o cache com a versão fresca, pro fallback offline
        // ficar sempre o mais recente possível.
        const copia = respostaRede.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
        return respostaRede;
      })
      .catch(() => caches.match(e.request))
