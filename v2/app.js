// ═══════════════════════════════════════
// INTERLIGA — Passageiro
// app.js — única fonte de verdade, sem duplicação
// ═══════════════════════════════════════

// ─────────────────────────────────────
// FIREBASE — carregado dinamicamente, nunca bloqueia o app se falhar
// ─────────────────────────────────────
let db = null;
let firebaseReady = false;
let fbAppInstancia = null;

// ─────────────────────────────────────
// LOCALSTORAGE SEGURO — nunca deixa um dado corrompido quebrar a tela
// ─────────────────────────────────────
export function getStorageJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`[storage] dado corrompido em "${key}", usando valor padrão:`, e);
    return fallback;
  }
}

export function setStorageJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[storage] falha ao salvar "${key}" (storage cheio?):`, e);
    return false;
  }
}
let fb = {}; // funções do firestore, preenchidas após carregar
let meuPassageiroId = null;
let authPassageiro = null;
let authModRef = null;

// Espera o Firebase terminar de conectar (até ~8s), em vez de desistir na hora.
// Cobre o caso de alguém preencher o cadastro rápido demais, antes da conexão terminar.
function esperarFirebasePronto(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (firebaseReady && db && authPassageiro) return resolve(true);
    const inicio = Date.now();
    const intervalo = setInterval(() => {
      if (firebaseReady && db && authPassageiro) {
        clearInterval(intervalo);
        resolve(true);
      } else if (Date.now() - inicio > timeoutMs) {
        clearInterval(intervalo);
        resolve(false);
      }
    }, 300);
  });
}

async function initFirebase() {
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const firestoreMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    fb = firestoreMod;
    authModRef = authMod;

    const firebaseConfig = {
      apiKey: "AIzaSyAAwR-TwQlWIgR4hBRjWtjfm_qFSkultUY",
      authDomain: "interliga-app.firebaseapp.com",
      projectId: "interliga-app",
      storageBucket: "interliga-app.firebasestorage.app",
      messagingSenderId: "913895237568",
      appId: "1:913895237568:web:faad95e8af089150e54a25",
    };

    const fbApp = initializeApp(firebaseConfig);
    fbAppInstancia = fbApp;
    db = fb.getFirestore(fbApp);
    authPassageiro = authMod.getAuth(fbApp);

    firebaseReady = true;
    console.log('✅ Firebase conectado');

    // Expõe pro food.js usar — são módulos separados (sem import circular entre eles)
    window.db = db;
    window.fb = fb;
    window.firebaseReady = true;

    // Login real (e-mail/senha) — quando já tem sessão salva, entra direto sem pedir senha de novo.
    // Quando não tem (ou deslogou), mostra a tela de login pra quem já escolheu ser passageiro.
    authMod.onAuthStateChanged(authPassageiro, (user) => {
      if (user) {
        meuPassageiroId = user.uid;
        window.meuPassageiroId = user.uid;
        verificarCadastroPassageiro();
      } else {
        meuPassageiroId = null;
        window.meuPassageiroId = null;
        if (localStorage.getItem('interliga_papel') === 'passageiro') {
          const telaAtual = state.currentScreen;
          if (telaAtual !== 'screen-cadastro-passageiro' && telaAtual !== 'screen-role-choice') {
            go('screen-login-passageiro');
          }
        }
      }
    });
  } catch (e) {
    console.warn('Firebase não disponível — app funciona em modo local:', e);
    firebaseReady = false;
    alert('⚠️ Erro ao conectar no Firebase:\n\n' + (e.message || e) + '\n\nManda esse texto pro suporte.');
  }
}

// ─────────────────────────────────────
// ESTADO GLOBAL DA APLICAÇÃO
// ─────────────────────────────────────
const state = {
  currentScreen: 'screen-splash',
  origem: null,        // { texto, lat, lon }
  destino: null,        // { texto, lat, lon }
  categoriaEscolhida: 'x',
  formaPagamento: 'pix',
  precos: { x: null, plus: null, van: null },
  corridaId: null,
  corridaLocalId: null, // ID fixo do registro no localStorage — nunca muda, mesmo após corridaId virar o ID do Firebase
  corridaListenerUnsub: null,
  chatListenerUnsub: null,
};
let timestampAceite = null; // marcado quando motorista aceita; usado p/ calcular multa de cancelamento

// ─────────────────────────────────────
// NAVEGAÇÃO — função única, sem duplicação
// ─────────────────────────────────────
// Telas que NÃO entram no histórico (não faz sentido "voltar" pra elas)
const TELAS_SEM_HISTORICO_PAX = new Set([
  'screen-splash','screen-role-choice','screen-login-passageiro',
  'screen-cadastro-passageiro','screen-aguardando-aprovacao',
  'screen-rejeitado','screen-bloqueado',
]);
const historicoNavPassageiro = [];

export function go(screenId) {
  const next = document.getElementById(screenId);
  if (!next) {
    console.warn('[go] Tela não encontrada:', screenId);
    return;
  }
  const current = document.querySelector('.screen[data-active="true"]');
  if (current === next) return;

  // Guarda a tela atual no histórico antes de navegar
  const telaAtual = state.currentScreen;
  if (telaAtual && !TELAS_SEM_HISTORICO_PAX.has(telaAtual) && !TELAS_SEM_HISTORICO_PAX.has(screenId)) {
    historicoNavPassageiro.push(telaAtual);
    history.pushState({ tela: screenId }, '', '');
  }

  if (current) current.removeAttribute('data-active');
  next.setAttribute('data-active', 'true');
  state.currentScreen = screenId;

  // Efeitos colaterais por tela — todos centralizados aqui, sem espalhar
  const onEnterHandlers = {
    'screen-home': onEnterHome,
    'screen-ride': onEnterRide,
    'screen-schedule': onEnterSchedule,
    'screen-food-list': () => { if (typeof window.renderRestaurantList === 'function') window.renderRestaurantList(); },
    'screen-trips': renderTripsScreen,
  };
  if (onEnterHandlers[screenId]) onEnterHandlers[screenId]();
}

// Delegação de clique central — todo elemento com data-go navega
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-go]');
  if (target) go(target.dataset.go);
});

// ─────────────────────────────────────
// TOAST
// ─────────────────────────────────────
let toastTimer = null;
export function showToast(msg, duration = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), duration);
}

// ─────────────────────────────────────
// SAUDAÇÃO DINÂMICA
// ─────────────────────────────────────
function saudacaoPorHorario() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// ─────────────────────────────────────
// MAPA (Leaflet) — home
// ─────────────────────────────────────
let homeMapInstance = null;
let homeMapInitTries = 0;

function onEnterHome() {
  const greetEl = document.getElementById('home-greeting');
  if (greetEl) greetEl.textContent = saudacaoPorHorario();
  initHomeMap();
  renderLastRide();
  if (typeof window.atualizarBannerPedidoAtivo === 'function') window.atualizarBannerPedidoAtivo();
  carregarBannersHome();
}

async function carregarBannersHome() {
  const el = document.getElementById('home-banners');
  if (!el || !firebaseReady || !db) return;
  try {
    const snap = await fb.getDocs(fb.query(
      fb.collection(db, 'anuncios'),
      fb.where('ativo', '==', true)
    ));
    if (snap.empty) { el.innerHTML = ''; return; }
    el.innerHTML = snap.docs.map(d => {
      const a = d.data();
      if (a.imagem) {
        return `<div style="border-radius:12px;overflow:hidden;"><img src="${a.imagem}" style="width:100%;display:block;"></div>`;
      }
      return `<div style="background:${a.cor||'#1270C2'};border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:28px;">${a.icone||'🎉'}</span>
        <div><div style="font-weight:700;color:white;font-size:14px;">${a.titulo}</div>
        ${a.descricao ? `<div style="font-size:12px;color:rgba(255,255,255,.8);margin-top:2px;">${a.descricao}</div>` : ''}</div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '';
  }
}

function initHomeMap() {
  if (homeMapInstance) {
    setTimeout(() => homeMapInstance && homeMapInstance.invalidateSize(), 100);
    return;
  }
  const el = document.getElementById('map-home');
  if (!el) return;

  const tryInit = () => {
    if (typeof L === 'undefined') {
      homeMapInitTries++;
      if (homeMapInitTries < 40) { setTimeout(tryInit, 150); return; }
      console.warn('Leaflet não carregou a tempo.');
      return;
    }
    if (el.offsetWidth < 10 || el.offsetHeight < 10) { setTimeout(tryInit, 150); return; }

    homeMapInstance = L.map('map-home', { zoomControl: false, attributionControl: false })
      .setView([-12.7375, -38.6285], 14); // Madre de Deus, BA

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(homeMapInstance);
    L.marker([-12.7375, -38.6285]).addTo(homeMapInstance);

    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        homeMapInstance.setView([latitude, longitude], 15);
        L.circleMarker([latitude, longitude], { radius: 8, color: '#FF6B00', fillColor: '#FF6B00', fillOpacity: 0.8 }).addTo(homeMapInstance);
      },
      () => {}, // silenciosamente ignora se negar permissão
      { timeout: 5000 }
    );
  };
  tryInit();
}

// ─────────────────────────────────────
// GEOCODING REAL — Nominatim (OpenStreetMap)
// ─────────────────────────────────────
let estabelecimentosCache = [];
let estabelecimentosCarregados = false;

async function carregarEstabelecimentos() {
  if (!firebaseReady || !db) return;
  try {
    const snap = await fb.getDocs(fb.collection(db, 'estabelecimentos'));
    estabelecimentosCache = [];
    snap.forEach(d => estabelecimentosCache.push({ id: d.id, ...d.data() }));
    estabelecimentosCarregados = true;
  } catch (e) {
    console.warn('[passageiro] erro ao carregar estabelecimentos:', e);
  }
}

async function buscarEnderecos(termo) {
  if (!termo || termo.trim().length < 3) return [];
  const termoBusca = termo.trim().toLowerCase();

  // Estabelecimentos cadastrados pelo admin (mais confiável que o mapa público
  // pra cidade pequena) aparecem primeiro, se o nome combinar com o que foi digitado.
  const estabelecimentosEncontrados = estabelecimentosCache
    .filter(e => (e.nome || '').toLowerCase().includes(termoBusca))
    .map(e => ({ texto: `📍 ${e.nome}${e.endereco ? ' — ' + e.endereco : ''}`, lat: e.lat, lon: e.lon }));

  try {
    // viewbox + bounded=0 = prioriza resultados perto de Madre de Deus, mas sem excluir
    // endereços de outras cidades (diferente de forçar o nome da cidade na busca, que travava
    // buscas de qualquer lugar fora daqui).
    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(termo)}` +
      `&format=json&limit=5&countrycodes=br` +
      `&viewbox=-39.3,-13.3,-38.2,-12.2&bounded=0`;
    const resp = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    const data = await resp.json();
    const resultadosMapa = data.map(item => ({
      texto: item.display_name,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
    }));
    return [...estabelecimentosEncontrados, ...resultadosMapa].slice(0, 6);
  } catch (e) {
    console.warn('Erro no geocoding:', e);
    return estabelecimentosEncontrados;
  }
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

let suggestionsTargetInput = null; // qual input está recebendo a sugestão

export function attachAddressAutocomplete(inputEl, onSelect, suggestionsBoxParam) {
  const suggestionsBox = suggestionsBoxParam || inputEl.closest('.form-card')?.querySelector('.address-suggestions');
  if (!suggestionsBox) return;

  // Botão "✕" pra limpar o campo de uma vez, em vez de precisar selecionar o texto manualmente
  // (não duplica em campos que já têm um botão de remover ao lado, como parada extra)
  const jaTemBotaoProprio = inputEl.parentElement?.querySelector('.stop-remove');
  let btnLimpar = null;
  if (!jaTemBotaoProprio) {
    btnLimpar = document.createElement('span');
    btnLimpar.className = 'address-clear-btn';
    btnLimpar.textContent = '✕';
    inputEl.insertAdjacentElement('afterend', btnLimpar);
  }

  function atualizarVisibilidadeLimpar() {
    if (btnLimpar) btnLimpar.style.display = inputEl.value.trim() ? 'flex' : 'none';
  }
  atualizarVisibilidadeLimpar();

  if (btnLimpar) {
    btnLimpar.addEventListener('click', () => {
      inputEl.value = '';
      atualizarVisibilidadeLimpar();
      suggestionsBox.classList.remove('is-open');
      onSelect(null); // avisa quem está ouvindo que o campo foi limpo, pra resetar o ponto selecionado
      inputEl.focus();
    });
  }

  const search = debounce(async () => {
    const termo = inputEl.value;
    const results = await buscarEnderecos(termo);
    if (results.length === 0) {
      suggestionsBox.classList.remove('is-open');
      suggestionsBox.innerHTML = '';
      return;
    }
    suggestionsBox.innerHTML = results.map((r, i) =>
      `<div class="suggestion-item" data-idx="${i}">${r.texto}</div>`
    ).join('');
    suggestionsBox.classList.add('is-open');
    suggestionsBox._results = results;
    suggestionsBox._activeInput = inputEl; // marca qual input está usando essa caixa agora
  }, 400);

  inputEl.addEventListener('focus', () => { suggestionsBox._activeInput = inputEl; });
  inputEl.addEventListener('input', () => { search(); atualizarVisibilidadeLimpar(); });

  // Quando o passageiro sai do campo sem ter clicado em sugestão nenhuma,
  // aceita o texto digitado como endereço livre (sem coordenada) —
  // o motorista vê exatamente o que foi digitado e confirma com o passageiro pelo chat.
  inputEl.addEventListener('blur', () => {
    setTimeout(() => { // pequeno delay pra não conflitar com o clique na sugestão
      const textoAtual = inputEl.value.trim();
      if (textoAtual && textoAtual.length >= 3) {
        const resultAtual = suggestionsBox._results?.find(r => r.texto === textoAtual);
        if (!resultAtual) {
          // Não veio de uma sugestão — aceita como texto livre sem coordenada
          onSelect({ texto: textoAtual, lat: null, lon: null });
        }
      }
      suggestionsBox.classList.remove('is-open');
    }, 200);
  });

  suggestionsBox.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    // Só aplica se este input for o que está ativo na caixa de sugestões agora
    if (suggestionsBox._activeInput !== inputEl) return;
    const idx = parseInt(item.dataset.idx, 10);
    const result = suggestionsBox._results[idx];
    inputEl.value = result.texto;
    suggestionsBox.classList.remove('is-open');
    atualizarVisibilidadeLimpar();
    onSelect(result);
  });

  // Fechar sugestões ao clicar fora
  const containerPai = inputEl.closest('.form-card') || inputEl.closest('.address-field') || inputEl.parentElement;
  document.addEventListener('click', (e) => {
    if (containerPai && !containerPai.contains(e.target)) suggestionsBox.classList.remove('is-open');
  });
}

// ─────────────────────────────────────
// TELA: SOLICITAR CORRIDA
// ─────────────────────────────────────
function onEnterRide() {
  const inputOrigem = document.getElementById('input-origem');
  const inputDestino = document.getElementById('input-destino');

  if (!zonasRiscoCarregadas) carregarZonasRisco();
  if (!tabelaPrecosCarregada) carregarTabelaPrecos();
  if (!estabelecimentosCarregados) carregarEstabelecimentos();
  if (!regrasHorarioCarregadas) carregarRegrasHorario();
  carregarZonaDemanda(); // sempre recarrega — a demanda muda rápido, diferente dos outros (preço, risco, etc)
  clearInterval(intervalZonaDemanda);
  intervalZonaDemanda = setInterval(carregarZonaDemanda, 20000);

  if (!inputOrigem._wired) {
    attachAddressAutocomplete(inputOrigem, (r) => { state.origem = r; calcularPrecos(); });
    inputOrigem._wired = true;
  }
  if (!inputDestino._wired) {
    attachAddressAutocomplete(inputDestino, (r) => { state.destino = r; calcularPrecos(); });
    inputDestino._wired = true;
  }

  // Pré-preencher origem com localização atual, se disponível
  if (!inputOrigem.value) {
    navigator.geolocation?.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`);
        const data = await resp.json();
        if (data?.display_name) {
          inputOrigem.value = data.display_name;
          state.origem = { texto: data.display_name, lat: latitude, lon: longitude };
        }
      } catch (e) {}
    }, () => {}, { timeout: 5000 });
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─────────────────────────────────────
// CIDADES OPERADAS — usado pra marcar automaticamente em qual cidade cada
// corrida acontece (pelo ponto mais próximo), pra dar pros franqueados verem
// só o que é da cidade deles.
// ─────────────────────────────────────
const CIDADES_INTERLIGA = [
  { codigo: 'madre',    nome: 'Madre de Deus',          lat: -12.7440, lon: -38.6170 },
  { codigo: 'sfc',      nome: 'São Francisco do Conde',  lat: -12.6275, lon: -38.6800 },
  { codigo: 'candeias', nome: 'Candeias',                lat: -12.6678, lon: -38.5506 },
  { codigo: 'simoes',   nome: 'Simões Filho',            lat: -12.7870, lon: -38.3990 },
];

function detectarCidade(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return 'madre';
  let maisProxima = CIDADES_INTERLIGA[0];
  let menorDist = haversineKm(lat, lon, maisProxima.lat, maisProxima.lon);
  for (const c of CIDADES_INTERLIGA.slice(1)) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < menorDist) { menorDist = d; maisProxima = c; }
  }
  return maisProxima.codigo;
}

let regrasHorarioCache = [];
let regrasHorarioCarregadas = false;

async function carregarRegrasHorario() {
  if (!firebaseReady || !db) return;
  try {
    const snap = await fb.getDocs(fb.collection(db, 'regras_horario'));
    regrasHorarioCache = [];
    snap.forEach(d => regrasHorarioCache.push({ id: d.id, ...d.data() }));
    regrasHorarioCarregadas = true;
  } catch (e) {
    console.warn('[passageiro] erro ao carregar faixas de horário:', e);
  }
}

// Soma o percentual de todas as faixas de horário que batem com o momento atual
// (dia da semana + horário), considerando faixas que cruzam a meia-noite (ex: 22h-05h).
function calcularPercentualHorario() {
  const agora = new Date();
  const diaSemana = agora.getDay(); // 0=domingo ... 6=sábado
  const horaAtual = agora.getHours() + agora.getMinutes() / 60;
  let percentual = 0;

  for (const regra of regrasHorarioCache) {
    if (Array.isArray(regra.dias) && regra.dias.length > 0 && !regra.dias.includes(diaSemana)) continue;
    const inicio = Number(regra.horaInicio);
    const fim = Number(regra.horaFim);
    if (isNaN(inicio) || isNaN(fim)) continue;

    let bate;
    if (inicio <= fim) {
      bate = horaAtual >= inicio && horaAtual < fim;
    } else {
      // Faixa cruza a meia-noite (ex: 22h às 5h)
      bate = horaAtual >= inicio || horaAtual < fim;
    }
    if (bate) percentual += Number(regra.percentual || 0);
  }
  return percentual;
}

// ─────────────────────────────────────
// CARTEIRA — saldo calculado por extrato (cada crédito/débito é um registro
// separado, nunca um número editado direto — mais seguro e fácil de auditar)
// ─────────────────────────────────────
async function obterSaldoCarteira(uid) {
  if (!firebaseReady || !db || !uid) return 0;
  try {
    const snap = await fb.getDocs(fb.query(fb.collection(db, 'carteira_transacoes'), fb.where('uid', '==', uid)));
    let saldo = 0;
    snap.forEach(d => { saldo += Number(d.data().valor || 0); });
    return saldo;
  } catch (e) {
    console.warn('[passageiro] erro ao calcular saldo da carteira:', e);
    return 0;
  }
}

async function lancarCarteira(uid, valor, motivo, corridaId = null) {
  if (!firebaseReady || !db || !uid || !valor) return;
  try {
    await fb.addDoc(fb.collection(db, 'carteira_transacoes'), {
      uid, valor, motivo, corridaId,
      criadoEm: fb.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[passageiro] erro ao lançar na carteira:', e);
  }
}

// Procura quem é o dono de um código de indicação (passageiro ou motorista)
async function resolverCodigoIndicacao(codigo) {
  if (!firebaseReady || !db || !codigo) return null;
  try {
    const [snapPax, snapMot] = await Promise.all([
      fb.getDocs(fb.query(fb.collection(db, 'passageiros'), fb.where('codigoIndicacao', '==', codigo))),
      fb.getDocs(fb.query(fb.collection(db, 'motoristas'), fb.where('codigoIndicacao', '==', codigo))),
    ]);
    if (!snapPax.empty) return { uid: snapPax.docs[0].id, tipo: 'passageiro' };
    if (!snapMot.empty) return { uid: snapMot.docs[0].id, tipo: 'motorista' };
    return null;
  } catch (e) {
    console.warn('[passageiro] erro ao resolver código de indicação:', e);
    return null;
  }
}
let tabelaPrecosCarregada = false;
const TABELA_PRECOS_PADRAO = {
  x:    { bandeirada: 5,  tarifaKm: 2.40, minimo: 8,  kmFixo: 0, valorFixo: 0, multiplicador: 1.0, ativo: true },
  plus: { bandeirada: 7,  tarifaKm: 3.36, minimo: 12, kmFixo: 0, valorFixo: 0, multiplicador: 1.4, ativo: true },
  van:  { bandeirada: 10, tarifaKm: 4.80, minimo: 18, kmFixo: 0, valorFixo: 0, multiplicador: 2.0, ativo: true },
};

async function carregarTabelaPrecos() {
  if (!firebaseReady || !db) return;
  try {
    await Promise.all(CIDADES_INTERLIGA.map(async (c) => {
      const snap = await fb.getDoc(fb.doc(db, 'precos', c.codigo));
      if (snap.exists()) tabelaPrecosCachePorCidade[c.codigo] = snap.data();
    }));
    tabelaPrecosCarregada = true;
    calcularPrecos(); // recalcula com os preços certos, se já tinha origem/destino escolhidos
  } catch (e) {
    console.warn('[passageiro] erro ao carregar tabela de preços, usando padrão:', e);
  }
}

// ─────────────────────────────────────
// ÁREAS DE RISCO — acréscimo de preço definido pelo admin (por raio no mapa
// ou por nome de rua/bairro). Vale se a ORIGEM OU O DESTINO cair na área.
// ─────────────────────────────────────
let zonasRiscoCache = [];
let zonasRiscoCarregadas = false;

async function carregarZonasRisco() {
  if (!firebaseReady || !db) return;
  try {
    const snap = await fb.getDocs(fb.collection(db, 'zonas_risco'));
    zonasRiscoCache = [];
    snap.forEach(d => zonasRiscoCache.push({ id: d.id, ...d.data() }));
    zonasRiscoCarregadas = true;
  } catch (e) {
    console.warn('[passageiro] erro ao carregar áreas de risco:', e);
  }
}

function pontoNaZonaRisco(ponto, zona) {
  if (!ponto) return false;
  if (zona.tipo === 'raio') {
    if (typeof ponto.lat !== 'number' || typeof zona.lat !== 'number') return false;
    const distKm = haversineKm(ponto.lat, ponto.lon, zona.lat, zona.lon);
    return distKm * 1000 <= Number(zona.raioMetros || 0);
  }
  if (zona.tipo === 'nome') {
    const termo = (zona.termoBusca || '').trim().toLowerCase();
    if (!termo) return false;
    return (ponto.texto || '').toLowerCase().includes(termo);
  }
  return false;
}

// Soma o acréscimo (R$) e o percentual de todas as zonas de risco que a origem OU o destino tocam
function calcularAcrescimoRisco(origem, destino) {
  let acrescimo = 0, percentual = 0;
  const zonasAtingidas = [];
  const cidadeCorrida = detectarCidade(origem?.lat, origem?.lon);
  for (const zona of zonasRiscoCache) {
    if (zona.cidade && zona.cidade !== cidadeCorrida) continue; // zona é de outra cidade (franqueado diferente)
    const bateOrigem = pontoNaZonaRisco(origem, zona);
    const bateDestino = pontoNaZonaRisco(destino, zona);
    if (bateOrigem || bateDestino) {
      acrescimo += Number(zona.acrescimo || 0);
      percentual += Number(zona.percentual || 0);
      zonasAtingidas.push(zona.nome || 'Área de risco');
    }
  }
  return { acrescimo, percentual, zonasAtingidas };
}

// Calcula o valor base da corrida — se a categoria tiver "tarifa fixa até X km" configurada,
// usa esse valor fixo dentro da faixa e só volta a cobrar por km depois que passar dela.
function calcularPrecoBase(km, t) {
  if (t.kmFixo > 0 && t.valorFixo > 0) {
    if (km <= t.kmFixo) return t.valorFixo;
    return t.valorFixo + (km - t.kmFixo) * t.tarifaKm;
  }
  return t.bandeirada + km * t.tarifaKm;
}

// ─────────────────────────────────────
// GRID DE DEMANDA (hexágonos) — mesmo grid que o motorista vê no mapa dele,
// usado aqui só pra saber o multiplicador da zona de origem da corrida.
// ─────────────────────────────────────
const HEX_TAMANHO_METROS = 400;
const HEX_METROS_POR_GRAU_LAT = 111320;
function hexMetrosPorGrauLon(latRef) { return 111320 * Math.cos(latRef * Math.PI / 180); }
function hexLatLonParaXY(lat, lon, latRef, lonRef) {
  return { x: (lon - lonRef) * hexMetrosPorGrauLon(latRef), y: (lat - latRef) * HEX_METROS_POR_GRAU_LAT };
}
function hexArredondar(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
  return { q: rx, r: rz };
}
function hexObterCelula(lat, lon, latRef, lonRef) {
  const { x, y } = hexLatLonParaXY(lat, lon, latRef, lonRef);
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / HEX_TAMANHO_METROS;
  const r = (2 / 3 * y) / HEX_TAMANHO_METROS;
  return hexArredondar(q, r);
}
function calcularMultiplicadorZona(demanda, oferta) {
  if (demanda <= 0) return 1.0;
  if (oferta <= 0) return Math.min(2.0, 1.0 + demanda * 0.25);
  const proporcao = demanda / oferta;
  if (proporcao <= 1) return 1.0;
  return Math.min(2.0, 1.0 + (proporcao - 1) * 0.4);
}

let zonaDemandaCache = new Map(); // chave "cidade_q_r" -> { demanda, oferta }
let zonaDemandaCarregada = false;
let intervalZonaDemanda = null;

async function carregarZonaDemanda() {
  if (!firebaseReady || !db) return;
  try {
    const novoCache = new Map();
    const [snapCorridas, snapMotoristas] = await Promise.all([
      fb.getDocs(fb.query(fb.collection(db, 'corridas'), fb.where('status', '==', 'aguardando'))),
      fb.getDocs(fb.collection(db, 'motoristas_disponiveis')),
    ]);
    function celula(cidade, q, r) {
      const chave = cidade + '_' + q + '_' + r;
      if (!novoCache.has(chave)) novoCache.set(chave, { demanda: 0, oferta: 0 });
      return novoCache.get(chave);
    }
    snapCorridas.forEach(d => {
      const c = d.data();
      if (typeof c.origemLat !== 'number') return;
      const centro = CIDADES_INTERLIGA.find(ci => ci.codigo === (c.cidade || 'madre')) || CIDADES_INTERLIGA[0];
      const { q, r } = hexObterCelula(c.origemLat, c.origemLon, centro.lat, centro.lon);
      celula(centro.codigo, q, r).demanda++;
    });
    snapMotoristas.forEach(d => {
      const m = d.data();
      if (typeof m.lat !== 'number') return;
      const centro = CIDADES_INTERLIGA.find(ci => ci.codigo === (m.cidade || 'madre')) || CIDADES_INTERLIGA[0];
      const { q, r } = hexObterCelula(m.lat, m.lon, centro.lat, centro.lon);
      celula(centro.codigo, q, r).oferta++;
    });
    zonaDemandaCache = novoCache;
    zonaDemandaCarregada = true;
    calcularPrecos(); // recalcula com a demanda atualizada, se já tinha origem/destino escolhidos
  } catch (e) {
    console.warn('[passageiro] erro ao carregar demanda por zona:', e);
  }
}

function obterMultiplicadorZona(lat, lon, cidade) {
  const centro = CIDADES_INTERLIGA.find(ci => ci.codigo === cidade) || CIDADES_INTERLIGA[0];
  const { q, r } = hexObterCelula(lat, lon, centro.lat, centro.lon);
  const chave = cidade + '_' + q + '_' + r;
  const dados = zonaDemandaCache.get(chave);
  if (!dados) return 1.0;
  return calcularMultiplicadorZona(dados.demanda, dados.oferta);
}

function calcularPrecos() {
  if (!state.origem || !state.destino) return;

  // Sem coordenada (endereço texto livre) — mostra o preço mínimo como estimativa
  const semCoordenada = !state.origem.lat || !state.destino.lat;
  const km = semCoordenada ? 0 : haversineKm(state.origem.lat, state.origem.lon, state.destino.lat, state.destino.lon);
  const risco = semCoordenada ? { acrescimo: 0, percentual: 0, zonasAtingidas: [] } : calcularAcrescimoRisco(state.origem, state.destino);
  const percentualHorario = calcularPercentualHorario();
  const cidade = semCoordenada ? 'madre' : detectarCidade(state.origem.lat, state.origem.lon);
  const tabela = tabelaPrecosCachePorCidade[cidade] || TABELA_PRECOS_PADRAO;
  const multiplicadorZona = semCoordenada ? 1.0 : obterMultiplicadorZona(state.origem.lat, state.origem.lon, cidade);

  for (const cat of ['x', 'plus', 'van']) {
    const t = tabela[cat] || TABELA_PRECOS_PADRAO[cat];
    const priceEl = document.getElementById(`price-${cat}`);
    const etaEl = document.getElementById(`eta-${cat}`);
    const itemEl = document.querySelector(`.category-item[data-cat="${cat}"]`);

    if (t.ativo === false) {
      if (itemEl) itemEl.style.display = 'none';
      continue;
    }
    if (itemEl) itemEl.style.display = '';

    let preco;
    if (semCoordenada) {
      // Sem coordenada — mostra "A partir de R$ X" (o mínimo da categoria)
      preco = t.minimo;
      if (priceEl) priceEl.textContent = 'A partir de R$ ' + preco.toFixed(2).replace('.', ',');
      if (etaEl) etaEl.textContent = '— min';
    } else {
      preco = Math.max(t.minimo, calcularPrecoBase(km, t)) * Number(t.multiplicador || 1) * multiplicadorZona;
      preco = preco + risco.acrescimo;
      preco = preco * (1 + risco.percentual / 100);
      preco = preco * (1 + percentualHorario / 100);
      if (priceEl) priceEl.textContent = 'R$ ' + preco.toFixed(2).replace('.', ',');
      if (etaEl) etaEl.textContent = Math.max(3, Math.round(km * 1.8)) + ' min';
    }
    state.precos[cat] = preco;
  }
}

document.getElementById('category-list')?.addEventListener('click', (e) => {
  const item = e.target.closest('.category-item');
  if (!item) return;
  document.querySelectorAll('.category-item').forEach(c => c.classList.remove('is-selected'));
  item.classList.add('is-selected');
  state.categoriaEscolhida = item.dataset.cat;
});

document.getElementById('btn-confirmar-corrida')?.addEventListener('click', async () => {
  const inputOrigem = document.getElementById('input-origem');
  const inputDestino = document.getElementById('input-destino');

  if (!inputOrigem.value.trim()) { showToast('⚠️ Informe o endereço de embarque'); inputOrigem.focus(); return; }
  if (!inputDestino.value.trim()) { showToast('⚠️ Informe o destino'); inputDestino.focus(); return; }

  // Se não geocodificou via autocomplete, usa o texto puro mesmo (sem coordenadas)
  if (!state.origem) state.origem = { texto: inputOrigem.value.trim(), lat: null, lon: null };
  if (!state.destino) state.destino = { texto: inputDestino.value.trim(), lat: null, lon: null };

  const preco = state.precos[state.categoriaEscolhida] || 18;

  // Ir IMEDIATAMENTE para tracking — nunca bloquear a UI esperando rede
  go('screen-tracking');
  montarSequenciaInicial();
  document.getElementById('block-searching').hidden = false;
  document.getElementById('block-driver').hidden = true;
  document.getElementById('chat-panel').hidden = true; // garante chat escondido até motorista aceitar
  document.getElementById('tracking-title').textContent = 'Buscando motorista...';
  document.getElementById('tracking-sub').textContent = 'Aguarde um instante';

  // Salvar corrida em background (não bloqueia a navegação)
  criarCorrida(state.origem, state.destino, preco, state.categoriaEscolhida);
});

// ─────────────────────────────────────
// CRIAR CORRIDA NO FIRESTORE + OUVIR ACEITE
// ─────────────────────────────────────
async function criarCorrida(origem, destino, preco, categoria) {
  const cidade = (origem.lat && origem.lon)
    ? detectarCidade(origem.lat, origem.lon)
    : (state.passageiroDados?.cidade || 'madre'); // usa cidade do cadastro do passageiro quando sem coordenada
  const corridaLocal = {
    origem: origem.texto, destino: destino.texto,
    origemLat: origem.lat, origemLon: origem.lon,
    destinoLat: destino.lat, destinoLon: destino.lon,
    preco, categoria, cidade,
    formaPagamento: state.formaPagamento || 'pix',
    passageiroId: meuPassageiroId || null,
    passageiroNome: localStorage.getItem('interliga_pax_nome') || 'Passageiro',
    status: 'aguardando',
    criadoEm: new Date().toISOString(),
  };

  // Sempre salvar local primeiro (garante histórico mesmo offline)
  const historico = getStorageJSON('interliga_corridas', []);
  const localId = 'local-' + Date.now();
  historico.unshift({ ...corridaLocal, id: localId });
  setStorageJSON('interliga_corridas', historico.slice(0, 50));
  state.corridaId = localId;
  state.corridaLocalId = localId; // fixo — usado pra sempre achar esse registro no histórico, mesmo depois do corridaId virar o ID do Firebase

  if (firebaseReady && db) {
    try {
      const docRef = await fb.addDoc(fb.collection(db, 'corridas'), {
        ...corridaLocal,
        criadoEm: fb.serverTimestamp(),
      });
      state.corridaId = docRef.id;

      // Monta a fila de prioridade: motorista mais próximo primeiro (empate decide pela melhor avaliação).
      // Se ainda não houver motoristas disponíveis cadastrados, fica em modo aberto (oferece pra todo mundo).
      try {
        const fila = await montarFilaPrioridade(origem, cidade, categoria);
        if (fila.length > 0) {
          await fb.updateDoc(docRef, {
            filaMotoristas: fila,
            filaIndiceAtual: 0,
            motoristaAlvoAtual: fila[0],
            ofertaExpiraEm: Date.now() + 15000,
          });
        }
      } catch (e) {
        console.warn('[passageiro] erro ao montar fila de prioridade, seguindo em modo aberto:', e);
      }

      ouvirAceiteCorrida(docRef.id);
      iniciarFilaWatchdog(docRef.id);
      sincronizarRotaNoFirebase(); // garante que paradas pré-definidas já apareçam pro motorista
    } catch (e) {
      console.warn('Erro ao salvar corrida no Firebase, seguindo apenas local:', e);
      simularBuscaLocal();
    }
  } else {
    simularBuscaLocal();
  }
}

// ─────────────────────────────────────
// FILA DE PRIORIDADE — monta a ordem de oferta por proximidade (e avaliação em caso de empate)
// ─────────────────────────────────────
async function montarFilaPrioridade(origem, cidade, categoria) {
  if (!firebaseReady || !db) return [];
  try {
    const snap = await fb.getDocs(fb.collection(db, 'motoristas_disponiveis'));
    const agora = Date.now();
    const candidatos = [];
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const atualizadoMs = d.atualizadoEm?.toMillis ? d.atualizadoEm.toMillis() : null;
      // Ignora motorista com localização desatualizada há mais de 2 min (provavelmente fechou o app)
      if (atualizadoMs && (agora - atualizadoMs) > 2 * 60 * 1000) return;
      if (typeof d.lat !== 'number' || typeof d.lon !== 'number') return;
      // Motorista é fixo na cidade dele — não entra na fila de corrida de outra cidade
      if (cidade && d.cidade && d.cidade !== cidade) return;
      // Só entra na fila se o veículo dele for da categoria pedida (X / Plus / Van)
      // Só entra na fila se o veículo dele atender a categoria pedida (suporta motorista com mais de uma categoria)
      const categoriasMotorista = Array.isArray(d.categorias) ? d.categorias : (d.categoria ? [d.categoria] : null);
      if (categoria && categoriasMotorista && !categoriasMotorista.includes(categoria)) return;
      const distanciaKm = (origem?.lat && origem?.lon)
        ? haversineKm(origem.lat, origem.lon, d.lat, d.lon)
        : 999;
      candidatos.push({ id: docSnap.id, distanciaKm, avaliacao: Number(d.avaliacao) || 0 });
    });
    // Mais próximo primeiro; diferenças pequenas de distância (<300m) são decididas pela melhor avaliação
    candidatos.sort((a, b) => {
      if (Math.abs(a.distanciaKm - b.distanciaKm) > 0.3) return a.distanciaKm - b.distanciaKm;
      return b.avaliacao - a.avaliacao;
    });
    return candidatos.map(c => c.id);
  } catch (e) {
    console.warn('[passageiro] erro ao consultar motoristas disponíveis:', e);
    return [];
  }
}

// Rede de segurança: se o motorista da vez não responder (app fechado, sem internet etc.),
// avança a fila mesmo sem depender do aparelho dele — assim a corrida nunca fica travada esperando alguém que não vai responder.
let filaWatchdogInterval = null;

function iniciarFilaWatchdog(corridaId) {
  clearInterval(filaWatchdogInterval);
  filaWatchdogInterval = setInterval(async () => {
    if (!db || !corridaId) { clearInterval(filaWatchdogInterval); return; }
    try {
      const snap = await fb.getDoc(fb.doc(db, 'corridas', corridaId));
      const data = snap.data();
      if (!data || data.status !== 'aguardando') { clearInterval(filaWatchdogInterval); return; }
      const fila = data.filaMotoristas || [];
      if (fila.length === 0) return; // modo aberto — nada a avançar
      const expirou = data.ofertaExpiraEm && Date.now() > data.ofertaExpiraEm + 5000; // 5s de margem
      if (!expirou) return;
      let indiceAtual = typeof data.filaIndiceAtual === 'number' ? data.filaIndiceAtual : 0;
      let proximoIndice = indiceAtual + 1;
      if (proximoIndice >= fila.length) proximoIndice = 0; // deu a volta — avisa todo mundo de novo
      await fb.updateDoc(fb.doc(db, 'corridas', corridaId), {
        filaIndiceAtual: proximoIndice,
        motoristaAlvoAtual: fila[proximoIndice],
        ofertaExpiraEm: Date.now() + 15000,
      });
    } catch (e) { console.warn('[passageiro] erro no watchdog da fila:', e); }
  }, 5000);
}

function pararFilaWatchdog() {
  clearInterval(filaWatchdogInterval);
  filaWatchdogInterval = null;
}

// Atualiza o status de uma corrida no histórico local (localStorage), sempre pelo ID fixo
// (state.corridaLocalId), que nunca muda — diferente de state.corridaId, que é sobrescrito
// pelo ID do Firebase assim que a corrida é sincronizada.
function atualizarStatusHistoricoLocal(novoStatus, extra = {}) {
  if (!state.corridaLocalId) return;
  try {
    const historico = getStorageJSON('interliga_corridas', []);
    const idx = historico.findIndex(c => c.id === state.corridaLocalId);
    if (idx >= 0) {
      historico[idx].status = novoStatus;
      Object.assign(historico[idx], extra);
      setStorageJSON('interliga_corridas', historico);
    }
  } catch (e) { console.warn('[historico local] erro ao atualizar status:', e); }
}

// Fallback sem Firebase: simula encontrar motorista para não travar a demo
function simularBuscaLocal() {
  setTimeout(() => {
    exibirMotoristaEncontrado({
      nome: 'Motorista',
      veiculo: 'Aguardando conexão',
      placa: '—',
      avaliacao: '—',
    });
  }, 4000);
}

function ouvirAceiteCorrida(corridaId) {
  console.log('[passageiro] iniciando listener de aceite para corrida:', corridaId);
  if (!db) { console.warn('[passageiro] db não disponível'); return; }
  if (state.corridaListenerUnsub) state.corridaListenerUnsub();

  let jaExibiuMotoristaEncontrado = false;

  state.corridaListenerUnsub = fb.onSnapshot(fb.doc(db, 'corridas', corridaId), (snap) => {
    const data = snap.data();
    console.log('[passageiro] snapshot recebido. status:', data?.status);
    if (!data) return;
    if (data.status === 'aceita' && !jaExibiuMotoristaEncontrado) {
      jaExibiuMotoristaEncontrado = true;
      console.log('[passageiro] motorista aceitou! Exibindo tela de motorista encontrado.');
      pararFilaWatchdog();
      exibirMotoristaEncontrado({
        nome: data.motoristaNome || 'Motorista',
        veiculo: data.motoristaVeiculo || '',
        placa: data.motoristaPlaca || '',
        avaliacao: data.motoristaAvaliacao || '4.8',
      });
      // Guarda o nome do motorista no histórico local assim que aceita (não precisa esperar finalizar)
      atualizarStatusHistoricoLocal('aceita', { motoristaNome: data.motoristaNome || 'Motorista', motoristaVeiculo: data.motoristaVeiculo, motoristaPlaca: data.motoristaPlaca });
    }
    if (data.status === 'finalizada') {
      console.log('[passageiro] corrida finalizada pelo motorista.');
      if (state.corridaListenerUnsub) { state.corridaListenerUnsub(); state.corridaListenerUnsub = null; }
      if (state.chatListenerUnsub) { state.chatListenerUnsub(); state.chatListenerUnsub = null; }
      pararEscutaPosicaoMotorista();

      // Atualizar status no histórico local (para aparecer corretamente em Minhas Viagens),
      // incluindo o preço final real (pode ter mudado por parada extra) e o motorista que atendeu
      atualizarStatusHistoricoLocal('finalizada', {
        preco: data.preco,
        motoristaNome: data.motoristaNome || 'Motorista',
        motoristaVeiculo: data.motoristaVeiculo,
        motoristaPlaca: data.motoristaPlaca,
      });

      showToast('✅ Corrida finalizada! Obrigado por viajar com a Interliga.');
      abrirTelaAvaliarMotorista(data.motoristaId, data.motoristaNome);
    }
  }, (erro) => {
    console.error('[passageiro] erro no listener de aceite:', erro);
  });
}

// ─────────────────────────────────────
// AVALIAÇÃO MÚTUA — passageiro avalia motorista depois da corrida
// ─────────────────────────────────────
let notaSelecionadaMotorista = 0;
let avaliarMotoristaId = null;
let avaliarCorridaIdAtual = null;

function abrirTelaAvaliarMotorista(motoristaId, motoristaNome) {
  avaliarMotoristaId = motoristaId || null;
  avaliarCorridaIdAtual = state.corridaId || null;
  notaSelecionadaMotorista = 0;
  renderEstrelasMotorista();
  document.getElementById('avaliar-mot-nome').textContent = motoristaNome || 'o motorista';
  document.getElementById('avaliar-mot-comentario').value = '';
  if (!avaliarMotoristaId) { go('screen-home'); return; } // corrida antiga sem motoristaId — não tem quem avaliar
  go('screen-avaliar-motorista');
}

function renderEstrelasMotorista() {
  document.querySelectorAll('#avaliar-mot-estrelas span').forEach(el => {
    const n = Number(el.dataset.nota);
    el.textContent = n <= notaSelecionadaMotorista ? '★' : '☆';
    el.style.color = n <= notaSelecionadaMotorista ? 'var(--orange)' : 'var(--text-soft)';
  });
}

document.querySelectorAll('#avaliar-mot-estrelas span').forEach(el => {
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => {
    notaSelecionadaMotorista = Number(el.dataset.nota);
    renderEstrelasMotorista();
  });
});

document.getElementById('btn-enviar-avaliacao-motorista')?.addEventListener('click', async () => {
  if (notaSelecionadaMotorista === 0) { showToast('⚠️ Toca numa estrela pra dar a nota'); return; }
  const comentario = document.getElementById('avaliar-mot-comentario').value.trim();
  await enviarAvaliacao('motorista', avaliarMotoristaId, notaSelecionadaMotorista, comentario, avaliarCorridaIdAtual);
  showToast('✅ Avaliação enviada, obrigado!');
  go('screen-home');
});

document.getElementById('link-pular-avaliacao-motorista')?.addEventListener('click', () => go('screen-home'));

// Atualiza a média de avaliação de um motorista ou passageiro, de forma segura mesmo
// com várias avaliações chegando ao mesmo tempo (usa transação do Firebase).
async function enviarAvaliacao(tipo, paraId, nota, comentario, corridaId) {
  if (!firebaseReady || !db || !paraId) return;
  const colecao = tipo === 'motorista' ? 'motoristas' : 'passageiros';
  try {
    await fb.addDoc(fb.collection(db, 'avaliacoes'), {
      tipo, paraId, nota, comentario, corridaId,
      criadoEm: fb.serverTimestamp(),
    });
    await fb.runTransaction(db, async (tx) => {
      const ref = fb.doc(db, colecao, paraId);
      const snap = await tx.get(ref);
      const dados = snap.data() || {};
      const totalAtual = Number(dados.totalAvaliacoes || 0);
      const somaAtual = Number(dados.somaAvaliacoes || 0);
      const novoTotal = totalAtual + 1;
      const novaSoma = somaAtual + nota;
      tx.update(ref, {
        totalAvaliacoes: novoTotal,
        somaAvaliacoes: novaSoma,
        avaliacao: (novaSoma / novoTotal).toFixed(1),
      });
    });
  } catch (e) {
    console.warn('[passageiro] erro ao enviar avaliação:', e);
  }
}

function exibirMotoristaEncontrado({ nome, veiculo, placa, avaliacao }) {
  timestampAceite = Date.now(); // marca o momento do aceite para calcular multa de cancelamento
  document.getElementById('block-searching').hidden = true;
  const blockDriver = document.getElementById('block-driver');
  blockDriver.hidden = false;

  document.getElementById('tracking-title').textContent = 'Motorista encontrado!';
  document.getElementById('tracking-sub').textContent = 'A caminho do seu local';
  document.getElementById('tracking-eta').textContent = '4 min';

  document.getElementById('driver-avatar').textContent = nome.slice(0, 2).toUpperCase();
  document.getElementById('driver-name').textContent = nome;
  document.getElementById('driver-detail').textContent = `⭐ ${avaliacao} · ${veiculo} · ${placa}`;
  document.getElementById('driver-status').textContent = '🟢 A caminho';
  document.getElementById('driver-price').textContent = 'R$ ' + (state.precos[state.categoriaEscolhida] || 18).toFixed(2).replace('.', ',');

  showToast(`✅ ${nome} aceitou sua corrida!`);

  try { iniciarChatCorrida(); } catch (e) { console.error('[passageiro] erro ao iniciar chat:', e); }
  try { iniciarMapaTrackingPassageiro(); } catch (e) { console.error('[passageiro] erro ao iniciar mapa tracking:', e); }
  try { escutarPosicaoMotorista(); } catch (e) { console.error('[passageiro] erro ao escutar posição motorista:', e); }
}

// ─────────────────────────────────────
// MAPA EM TEMPO REAL — passageiro vê o motorista se movendo
// ─────────────────────────────────────
let mapTrackingPassageiro = null;
let marcadorMotoristaTracking = null;
let posicaoMotoristaListenerUnsub = null;

function iniciarMapaTrackingPassageiro() {
  const el = document.getElementById('map-tracking');
  if (!el) return;

  const tryInit = () => {
    if (typeof L === 'undefined') { setTimeout(tryInit, 150); return; }
    if (el.offsetWidth < 10 || el.offsetHeight < 10) { setTimeout(tryInit, 150); return; }
    if (mapTrackingPassageiro) { mapTrackingPassageiro.invalidateSize(); return; }

    const lat = state.origem?.lat || -12.7375;
    const lon = state.origem?.lon || -38.6285;
    mapTrackingPassageiro = L.map('map-tracking', { zoomControl: false, attributionControl: false }).setView([lat, lon], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapTrackingPassageiro);
    L.marker([lat, lon]).addTo(mapTrackingPassageiro); // ponto de embarque fixo
  };
  tryInit();
}

function escutarPosicaoMotorista() {
  if (!firebaseReady || !db || !state.corridaId || posicaoMotoristaListenerUnsub) return;

  posicaoMotoristaListenerUnsub = fb.onSnapshot(fb.doc(db, 'corridas', state.corridaId), (snap) => {
    const data = snap.data();
    console.log('[passageiro] verificando posição do motorista. motoristaLat:', data?.motoristaLat, 'motoristaLon:', data?.motoristaLon);
    if (!data || !data.motoristaLat || !data.motoristaLon) return;
    if (!mapTrackingPassageiro) { console.warn('[passageiro] mapTrackingPassageiro ainda não está pronto'); return; }

    const posicao = [data.motoristaLat, data.motoristaLon];
    if (!marcadorMotoristaTracking) {
      marcadorMotoristaTracking = L.marker(posicao, {
        icon: L.divIcon({ className: '', html: '<div style="font-size:24px;">🚗</div>', iconSize: [30, 30] })
      }).addTo(mapTrackingPassageiro);
    } else {
      marcadorMotoristaTracking.setLatLng(posicao);
    }
    mapTrackingPassageiro.panTo(posicao);

    // Calcular ETA ao vivo baseado na distância real até o ponto de embarque/destino atual
    atualizarEtaAoVivo(data.motoristaLat, data.motoristaLon);
  }, (erro) => console.error('[passageiro] erro no listener de posição:', erro));
}

function atualizarEtaAoVivo(motoristaLat, motoristaLon) {
  const pontoDestinoAtual = obterPontoAtualDaRota();
  if (!pontoDestinoAtual || !pontoDestinoAtual.lat) return;

  const km = haversineKm(motoristaLat, motoristaLon, pontoDestinoAtual.lat, pontoDestinoAtual.lon);
  const minutosEstimados = Math.max(1, Math.round(km * 2.5)); // ~2.5 min por km em trânsito urbano

  const etaEl = document.getElementById('tracking-eta');
  if (etaEl) etaEl.textContent = minutosEstimados + ' min';
}

function pararEscutaPosicaoMotorista() {
  if (posicaoMotoristaListenerUnsub) { posicaoMotoristaListenerUnsub(); posicaoMotoristaListenerUnsub = null; }
  marcadorMotoristaTracking = null;
}

// ─────────────────────────────────────
// CHAT — passageiro ↔ motorista via Firestore
// ─────────────────────────────────────
function iniciarChatCorrida() {
  document.getElementById('chat-panel').hidden = false;
  if (!firebaseReady || !db || !state.corridaId) return;
  if (state.chatListenerUnsub) return;

  const q = fb.query(
    fb.collection(db, 'corridas', state.corridaId, 'mensagens'),
    fb.orderBy('ts', 'asc'), fb.limit(50)
  );
  state.chatListenerUnsub = fb.onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const msg = change.doc.data();
        const tipo = msg.de === 'passageiro' ? 'me' : 'them';
        if (msg.tipo === 'audio') {
          renderChatMessage(null, tipo, msg.audioData);
        } else {
          renderChatMessage(msg.texto, tipo);
        }
      }
    });
  });
}

function tocarSomNotificacaoChat() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.value = 700;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.03);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

function renderChatMessage(texto, tipo, audioDataUrl = null) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${tipo}` + (audioDataUrl ? ' chat-msg--audio' : '');
  if (audioDataUrl) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = audioDataUrl;
    div.appendChild(audio);
  } else {
    div.textContent = texto;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  if (tipo === 'them' || tipo === 'sys') tocarSomNotificacaoChat();
}

async function enviarMensagemChat(texto) {
  if (!texto.trim()) return;
  renderChatMessage(texto, 'me');
  if (firebaseReady && db && state.corridaId) {
    try {
      await fb.addDoc(fb.collection(db, 'corridas', state.corridaId, 'mensagens'), {
        texto, de: 'passageiro', ts: fb.serverTimestamp(),
      });
    } catch (e) { console.warn('Erro ao enviar mensagem:', e); }
  }
}

async function enviarAudioChat(audioDataUrl) {
  renderChatMessage(null, 'me', audioDataUrl);
  if (firebaseReady && db && state.corridaId) {
    try {
      await fb.addDoc(fb.collection(db, 'corridas', state.corridaId, 'mensagens'), {
        tipo: 'audio', audioData: audioDataUrl, de: 'passageiro', ts: fb.serverTimestamp(),
      });
    } catch (e) {
      console.warn('Erro ao enviar áudio:', e);
      showToast('⚠️ Falha ao enviar o áudio — tente de novo');
    }
  } else {
    showToast('⚠️ Sem conexão — áudio não foi enviado ao motorista');
  }
}

document.getElementById('btn-send-chat')?.addEventListener('click', () => {
  const input = document.getElementById('chat-input');
  enviarMensagemChat(input.value);
  input.value = '';
});
document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-send-chat').click();
});
document.querySelectorAll('.chat-quick-btn').forEach(btn => {
  btn.addEventListener('click', () => enviarMensagemChat(btn.dataset.msg));
});

// ─────────────────────────────────────
// MENSAGEM DE VOZ NO CHAT (gravação pelo microfone)
// ─────────────────────────────────────
function blobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

let gravadorAudioChat = null;
let pedacosAudioChat = [];
let gravandoAudioChat = false;
let timeoutGravacaoChat = null;

async function alternarGravacaoAudioChat() {
  const btnMic = document.getElementById('btn-mic-chat');
  if (gravandoAudioChat) {
    gravadorAudioChat?.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const opcoes = { audioBitsPerSecond: 24000 };
    if (window.MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus')) {
      opcoes.mimeType = 'audio/webm;codecs=opus';
    }
    gravadorAudioChat = new MediaRecorder(stream, opcoes);
    pedacosAudioChat = [];
    gravadorAudioChat.ondataavailable = (e) => { if (e.data && e.data.size > 0) pedacosAudioChat.push(e.data); };
    gravadorAudioChat.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearTimeout(timeoutGravacaoChat);
      gravandoAudioChat = false;
      btnMic?.classList.remove('is-recording');
      if (pedacosAudioChat.length === 0) {
        showToast('⚠️ Gravação muito curta, nada foi enviado');
        return;
      }
      const blob = new Blob(pedacosAudioChat, { type: gravadorAudioChat.mimeType || 'audio/webm' });
      if (blob.size > 0) {
        const base64 = await blobParaBase64(blob);
        enviarAudioChat(base64);
      } else {
        showToast('⚠️ Gravação vazia, nada foi enviado');
      }
    };
    gravadorAudioChat.start();
    gravandoAudioChat = true;
    btnMic?.classList.add('is-recording');
    showToast('🎙️ Gravando... toque de novo para enviar');
    clearTimeout(timeoutGravacaoChat);
    timeoutGravacaoChat = setTimeout(() => { if (gravandoAudioChat) gravadorAudioChat?.stop(); }, 30000); // limite de 30s
  } catch (e) {
    console.error('[passageiro] erro ao gravar áudio:', e);
    showToast('⚠️ Não foi possível acessar o microfone');
  }
}

document.getElementById('btn-mic-chat')?.addEventListener('click', alternarGravacaoAudioChat);

// ─────────────────────────────────────
// ESCOLHA DE PAPEL (motorista / passageiro) — primeira tela que todo mundo vê
// ─────────────────────────────────────
document.getElementById('btn-sou-motorista')?.addEventListener('click', () => {
  localStorage.setItem('interliga_papel', 'motorista');
  window.location.href = 'motorista.html';
});
document.getElementById('btn-sou-passageiro')?.addEventListener('click', () => {
  localStorage.setItem('interliga_papel', 'passageiro');
  go('screen-login-passageiro');
});

// ─────────────────────────────────────
// VALIDAÇÃO DE CPF — algoritmo padrão dos 2 dígitos verificadores (sem precisar de API)
// ─────────────────────────────────────
function validarCPF(cpf) {
  cpf = (cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === parseInt(cpf[10]);
}

document.getElementById('cad-pax-cpf')?.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 11);
  if (v.length > 9) v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
  else if (v.length > 6) v = v.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
  else if (v.length > 3) v = v.replace(/(\d{3})(\d{0,3})/, '$1.$2');
  e.target.value = v;
});

// ─────────────────────────────────────
// SELFIE — captura via câmera do celular e compressão antes de salvar
// (uma foto direto da câmera pode ter vários MB; comprimida fica bem menor)
// ─────────────────────────────────────
function comprimirImagemArquivo(file, maxLado = 600, qualidade = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxLado) { height *= maxLado / width; width = maxLado; }
        else if (height > maxLado) { width *= maxLado / height; height = maxLado; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let selfiePassageiroBase64 = null;
document.getElementById('cad-pax-selfie-input')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    selfiePassageiroBase64 = await comprimirImagemArquivo(file);
    const preview = document.getElementById('cad-pax-selfie-preview');
    preview.innerHTML = `<img src="${selfiePassageiroBase64}">`;
  } catch (err) {
    showToast('⚠️ Não foi possível processar a foto, tenta de novo');
  }
});

// ─────────────────────────────────────
// ENVIO DO CADASTRO
// ─────────────────────────────────────
document.getElementById('btn-enviar-cadastro-passageiro')?.addEventListener('click', async () => {
  const erroEl = document.getElementById('cad-pax-erro');
  erroEl.hidden = true;

  const nome = document.getElementById('cad-pax-nome').value.trim();
  const celular = document.getElementById('cad-pax-celular').value.trim();
  const email = document.getElementById('cad-pax-email').value.trim();
  const cpf = document.getElementById('cad-pax-cpf').value.replace(/\D/g, '');
  const confirma = document.getElementById('cad-pax-cpf-confirma').value.trim();
  const senha = document.getElementById('cad-pax-senha').value;
  const senhaConfirma = document.getElementById('cad-pax-senha-confirma').value;

  function mostrarErro(msg) { erroEl.textContent = '⚠️ ' + msg; erroEl.hidden = false; }

  if (!nome || nome.split(' ').length < 2) return mostrarErro('Informe seu nome completo');
  if (celular.replace(/\D/g, '').length < 10) return mostrarErro('Informe um celular válido com DDD');
  if (!email.includes('@') || !email.includes('.')) return mostrarErro('Informe um e-mail válido');
  if (!validarCPF(cpf)) return mostrarErro('CPF inválido — confira os números digitados');
  if (confirma !== cpf.slice(-2)) return mostrarErro('Os 2 últimos dígitos não confirmam o CPF informado');
  if (senha.length < 6) return mostrarErro('A senha precisa ter pelo menos 6 caracteres');
  if (senha !== senhaConfirma) return mostrarErro('As senhas não são iguais');
  if (!selfiePassageiroBase64) return mostrarErro('Tire uma selfie pra concluir o cadastro');

  const btn = document.getElementById('btn-enviar-cadastro-passageiro');
  btn.disabled = true;
  btn.textContent = 'Conectando...';

  const pronto = await esperarFirebasePronto();
  if (!pronto) {
    btn.disabled = false;
    btn.textContent = 'Enviar cadastro';
    return mostrarErro('Sem conexão com o servidor — confira sua internet e tenta de novo');
  }

  btn.textContent = 'Enviando...';

  try {
    if (!meuPassageiroId) {
      const cred = await authModRef.createUserWithEmailAndPassword(authPassageiro, email, senha);
      meuPassageiroId = cred.user.uid;
    }

    const codigoDigitado = document.getElementById('cad-pax-codigo-indicacao').value.trim().toUpperCase();
    const indicadoPor = codigoDigitado ? await resolverCodigoIndicacao(codigoDigitado) : null;

    await fb.setDoc(fb.doc(db, 'passageiros', meuPassageiroId), {
      nome, celular, email, cpf,
      cidade: document.getElementById('cad-pax-cidade').value,
      selfie: selfiePassageiroBase64,
      verificacao: 'aprovado', // passageiro não passa por aprovação manual — só fica sujeito a bloqueio se necessário
      codigoIndicacao: meuPassageiroId.slice(-7).toUpperCase(),
      indicadoPor: indicadoPor || null,
      bonusIndicacaoPago: false,
      criadoEm: fb.serverTimestamp(),
    });
    localStorage.setItem('interliga_pax_nome', nome);
    aplicarStatusCadastro({ verificacao: 'aprovado' });
  } catch (e) {
    console.error('[passageiro] erro ao enviar cadastro:', e);
    if (e.code === 'auth/email-already-in-use') mostrarErro('Esse e-mail já tem cadastro — tenta Entrar em vez de cadastrar');
    else mostrarErro('Erro ao enviar — confira sua internet e tente de novo');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar cadastro';
  }
});

// ─────────────────────────────────────
// LOGIN (passageiro que já tem cadastro)
// ─────────────────────────────────────
document.getElementById('btn-fazer-login-passageiro')?.addEventListener('click', async () => {
  const erroEl = document.getElementById('login-pax-erro');
  erroEl.hidden = true;
  const email = document.getElementById('login-pax-email').value.trim();
  const senha = document.getElementById('login-pax-senha').value;
  if (!email || !senha) { erroEl.textContent = '⚠️ Preencha e-mail e senha'; erroEl.hidden = false; return; }

  const btn = document.getElementById('btn-fazer-login-passageiro');
  btn.disabled = true;
  btn.textContent = 'Conectando...';
  const pronto = await esperarFirebasePronto();
  if (!pronto) {
    btn.disabled = false;
    btn.textContent = 'Entrar';
    erroEl.textContent = '⚠️ Sem conexão com o servidor — confira sua internet e tenta de novo';
    erroEl.hidden = false;
    return;
  }
  btn.textContent = 'Entrando...';
  try {
    await authModRef.signInWithEmailAndPassword(authPassageiro, email, senha);
    // onAuthStateChanged cuida do resto (verificarCadastroPassageiro)
  } catch (e) {
    console.warn('[passageiro] erro no login:', e.code);
    erroEl.textContent = '❌ E-mail ou senha incorretos';
    erroEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

document.getElementById('link-ir-pro-cadastro')?.addEventListener('click', () => go('screen-cadastro-passageiro'));
document.getElementById('link-ir-pro-login')?.addEventListener('click', () => go('screen-login-passageiro'));
document.getElementById('link-esqueci-senha-pax')?.addEventListener('click', async () => {
  const email = document.getElementById('login-pax-email').value.trim();
  if (!email) { showToast('⚠️ Digite seu e-mail no campo acima primeiro'); return; }
  if (!authPassageiro) return;
  try {
    await authModRef.sendPasswordResetEmail(authPassageiro, email);
    showToast('📧 Enviamos um link pra redefinir sua senha');
  } catch (e) {
    showToast('⚠️ Não foi possível enviar — confira o e-mail digitado');
  }
});

// ─────────────────────────────────────
// VERIFICAÇÃO DO STATUS DO CADASTRO — decide qual tela mostrar, e fica
// escutando em tempo real enquanto está pendente (libera sozinho quando aprovar)
// ─────────────────────────────────────
let cadastroPassageiroListenerUnsub = null;

async function verificarCadastroPassageiro() {
  if (localStorage.getItem('interliga_papel') !== 'passageiro') return;
  if (!firebaseReady || !db || !meuPassageiroId) return;
  try {
    const snap = await fb.getDoc(fb.doc(db, 'passageiros', meuPassageiroId));
    if (!snap.exists()) {
      go('screen-cadastro-passageiro');
      return;
    }
    aplicarStatusCadastro(snap.data());
    if (snap.data().verificacao === 'pendente') {
      escutarStatusCadastro();
    }
  } catch (e) {
    console.warn('[passageiro] erro ao verificar cadastro, liberando o app pra não travar o usuário:', e);
    go('screen-home');
  }
}

function aplicarStatusCadastro(dados) {
  state.passageiroDados = dados; // guarda pra usar cidade como fallback quando sem coordenada
  if (dados.bloqueado === true) {
    document.getElementById('bloqueio-motivo-texto').textContent = dados.motivoBloqueio || 'Sua conta foi bloqueada. Entre em contato com o suporte.';
    go('screen-bloqueado');
    return;
  }
  if (dados.verificacao === 'aprovado') {
    if (dados.nome) {
      const elNome = document.getElementById('profile-name');
      if (elNome) elNome.textContent = dados.nome;
      const elAvatar = document.querySelector('.profile-avatar');
      if (elAvatar) elAvatar.textContent = dados.nome.trim().charAt(0).toUpperCase();
      const elHomeAvatar = document.getElementById('home-avatar');
      if (elHomeAvatar) elHomeAvatar.textContent = dados.nome.trim().charAt(0).toUpperCase();
    }
    if (dados.celular) {
      const elTelefone = document.getElementById('profile-phone');
      if (elTelefone) elTelefone.textContent = dados.celular;
    }
    state.passageiro = dados;
    const elCpf = document.getElementById('perfil-pax-cpf');
    if (elCpf && dados.cpf) elCpf.textContent = dados.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    const elEmail = document.getElementById('perfil-pax-email');
    if (elEmail) elEmail.textContent = dados.email || '—';
    const elCodigo = document.getElementById('perfil-pax-codigo');
    if (elCodigo) elCodigo.textContent = dados.codigoIndicacao || (meuPassageiroId ? meuPassageiroId.slice(-7).toUpperCase() : '—');
    obterSaldoCarteira(meuPassageiroId).then((saldo) => {
      const elSaldo = document.getElementById('saldo-carteira-passageiro');
      if (elSaldo) elSaldo.textContent = 'R$ ' + saldo.toFixed(2).replace('.', ',');
    });
    go('screen-home');
    configurarNotificacoesPush();
  } else if (dados.verificacao === 'rejeitado') {
    document.getElementById('rejeicao-motivo-texto').textContent = dados.motivoRejeicao || 'Houve um problema com seus dados. Tente cadastrar de novo, com calma.';
    go('screen-rejeitado');
  } else {
    go('screen-aguardando-aprovacao');
  }
  // Mantém o listener vivo mesmo depois de aprovado, pra detectar um bloqueio que aconteça depois
  escutarStatusCadastro();
}

function mostrarTelaAguardandoAprovacao() {
  go('screen-aguardando-aprovacao');
  escutarStatusCadastro();
}

function escutarStatusCadastro() {
  if (cadastroPassageiroListenerUnsub || !firebaseReady || !db || !meuPassageiroId) return;
  cadastroPassageiroListenerUnsub = fb.onSnapshot(fb.doc(db, 'passageiros', meuPassageiroId), (snap) => {
    if (!snap.exists()) return;
    aplicarStatusCadastro(snap.data());
  });
}

document.getElementById('btn-tentar-cadastro-novamente')?.addEventListener('click', () => {
  go('screen-cadastro-passageiro');
});

document.getElementById('btn-open-chat')?.addEventListener('click', () => {
  document.getElementById('chat-panel').hidden = false;
  document.getElementById('chat-input')?.focus();
});

// Número do bot Interliga (Railway/Baileys) — faz a ponte anônima entre passageiro e motorista
const BOT_NUMERO = '5571981899571';

document.getElementById('btn-call-driver')?.addEventListener('click', () => {
  const corridaInfo = state.corridaId || 'atual';
  const msg = encodeURIComponent(
    `📞 [Interliga] Passageiro solicita ligação · Corrida #${corridaInfo}\nPor favor ligue para o passageiro via bot.`
  );
  window.open('https://wa.me/' + BOT_NUMERO + '?text=' + msg, '_blank');
  showToast('📞 Solicitação enviada — motorista vai ligar via bot');
});

// ─────────────────────────────────────
// CANCELAMENTO — com motivo + multa após 3 min do aceite
// ─────────────────────────────────────
const TEMPO_GRACA_CANCEL_MS = 3 * 60 * 1000; // 3 minutos
let motivoCancelamentoSelecionado = null;

document.getElementById('btn-cancelar-corrida')?.addEventListener('click', () => {
  const modal = document.getElementById('cancel-modal');
  const warning = document.getElementById('cancel-warning');
  const temMulta = timestampAceite && (Date.now() - timestampAceite) >= TEMPO_GRACA_CANCEL_MS;
  if (warning) warning.hidden = !temMulta;
  if (modal) modal.hidden = false;
});

document.getElementById('cancel-modal-close')?.addEventListener('click', () => {
  document.getElementById('cancel-modal').hidden = true;
});

document.querySelectorAll('.cancel-reason').forEach(btn => {
  btn.addEventListener('click', () => {
    motivoCancelamentoSelecionado = btn.dataset.reason;
    confirmarCancelamento();
  });
});

// ─────────────────────────────────────
// CANCELAR DURANTE A BUSCA (antes de motorista aceitar — sem multa, sem motivo)
// ─────────────────────────────────────
function cancelarBuscaCorrida() {
  if (state.corridaListenerUnsub) { state.corridaListenerUnsub(); state.corridaListenerUnsub = null; }
  pararFilaWatchdog();
  if (firebaseReady && db && state.corridaId && !String(state.corridaId).startsWith('local-')) {
    fb.updateDoc(fb.doc(db, 'corridas', state.corridaId), { status: 'cancelada' }).catch(() => {});
  }
  atualizarStatusHistoricoLocal('cancelada');
  showToast('Solicitação cancelada');
  go('screen-home');
}

document.getElementById('btn-cancelar-busca')?.addEventListener('click', cancelarBuscaCorrida);

// Se o usuário voltar para a Home enquanto ainda procurava motorista (sem motorista aceito),
// cancela automaticamente a solicitação para não deixá-la "pendurada" no Firebase
document.querySelector('#screen-tracking .back-btn')?.addEventListener('click', () => {
  const aindaBuscando = !document.getElementById('block-searching').hidden;
  if (aindaBuscando && state.corridaId) {
    cancelarBuscaCorrida();
  }
});

function confirmarCancelamento() {
  document.getElementById('cancel-modal').hidden = true;

  const temMulta = timestampAceite && (Date.now() - timestampAceite) >= TEMPO_GRACA_CANCEL_MS;

  if (state.corridaListenerUnsub) { state.corridaListenerUnsub(); state.corridaListenerUnsub = null; }
  if (state.chatListenerUnsub) { state.chatListenerUnsub(); state.chatListenerUnsub = null; }
  pararEscutaPosicaoMotorista(); // essencial: sem isso, o rastreio ao vivo trava na próxima corrida
  if (firebaseReady && db && state.corridaId && !state.corridaId.startsWith('local-')) {
    fb.updateDoc(fb.doc(db, 'corridas', state.corridaId), {
      status: 'cancelada',
      motivoCancelamento: motivoCancelamentoSelecionado,
      multaCobrada: temMulta,
    }).catch(() => {});
  }
  atualizarStatusHistoricoLocal('cancelada', { multaCobrada: temMulta });

  if (temMulta) {
    showToast('❌ Corrida cancelada · Multa de R$ 5,00 cobrada');
  } else {
    showToast('Corrida cancelada · Sem multa');
  }

  timestampAceite = null;
  motivoCancelamentoSelecionado = null;
  go('screen-home');
}

// ─────────────────────────────────────
// PAGAMENTO — seleção de forma
// ─────────────────────────────────────
document.getElementById('payment-select')?.addEventListener('click', () => {
  document.getElementById('payment-modal').hidden = false;
});
document.getElementById('payment-modal-close')?.addEventListener('click', () => {
  document.getElementById('payment-modal').hidden = true;
});
document.querySelectorAll('.payment-option').forEach(btn => {
  btn.addEventListener('click', async () => {
    const metodo = btn.dataset.payment;
    if (metodo === 'carteira') {
      const saldo = await obterSaldoCarteira(meuPassageiroId);
      const precoEstimado = Math.max(...Object.values(state.precos || {}).filter(v => typeof v === 'number'), 0);
      if (saldo < precoEstimado) {
        showToast('⚠️ Saldo insuficiente na carteira (R$ ' + saldo.toFixed(2).replace('.', ',') + ')');
        return;
      }
    }
    document.querySelectorAll('.payment-option').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    document.getElementById('payment-select-label').textContent = btn.dataset.label;
    state.formaPagamento = metodo;
    document.getElementById('payment-modal').hidden = true;
  });
});

// ─────────────────────────────────────
// PARADAS EXTRAS
// ─────────────────────────────────────
let paradasExtras = [];

document.getElementById('btn-add-stop-pre')?.addEventListener('click', () => {
  const idx = paradasExtras.length;
  paradasExtras.push({ texto: '', lat: null, lon: null });
  renderParadas();
});

function renderParadas() {
  const container = document.getElementById('stops-list-pre');
  if (!container) return;
  container.innerHTML = paradasExtras.map((p, i) => `
    <div class="address-field" style="padding:8px 16px;position:relative;">
      <span class="address-dot" style="background:#9098A8;"></span>
      <input type="text" class="stop-input" data-stop-idx="${i}" placeholder="Endereço da parada ${i+1}" value="${p.texto}" autocomplete="off">
      <button class="stop-remove" data-remove-stop="${i}">✕</button>
      <div class="address-suggestions stop-suggestions" data-suggestions-idx="${i}"></div>
    </div>
  `).join('');

  // Conectar autocomplete real em cada input de parada recém-criado
  container.querySelectorAll('.stop-input').forEach((input) => {
    if (input._wired) return;
    const idx = parseInt(input.dataset.stopIdx, 10);
    const suggestionsBox = container.querySelector(`.stop-suggestions[data-suggestions-idx="${idx}"]`);
    attachAddressAutocomplete(input, (r) => {
      paradasExtras[idx].texto = r ? r.texto : '';
      paradasExtras[idx].lat = r ? r.lat : null;
      paradasExtras[idx].lon = r ? r.lon : null;
    }, suggestionsBox);
    input._wired = true;
  });
}

document.getElementById('stops-list-pre')?.addEventListener('input', (e) => {
  const input = e.target.closest('.stop-input');
  if (!input) return;
  const idx = parseInt(input.dataset.stopIdx, 10);
  paradasExtras[idx].texto = input.value;
});

document.getElementById('stops-list-pre')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-stop]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.removeStop, 10);
  paradasExtras.splice(idx, 1);
  renderParadas();
});

// ─────────────────────────────────────
// SEQUÊNCIA DE ROTA (origem → paradas → destino final)
// ─────────────────────────────────────
let sequenciaRota = []; // [{ texto, lat, lon, tipo: 'origem'|'parada'|'destino' }]
let indiceRotaAtual = 0;

function montarSequenciaInicial() {
  sequenciaRota = [
    { texto: state.origem?.texto || 'Origem', lat: state.origem?.lat, lon: state.origem?.lon, tipo: 'origem' },
    // Paradas adicionadas antes de solicitar a corrida entram aqui, no meio da rota
    ...paradasExtras.filter(p => p.texto.trim()).map(p => ({ texto: p.texto, lat: p.lat, lon: p.lon, tipo: 'parada' })),
    { texto: state.destino?.texto || 'Destino', lat: state.destino?.lat, lon: state.destino?.lon, tipo: 'destino' },
  ];
  indiceRotaAtual = 0;
  renderRotaAtual();
}

function renderRotaAtual() {
  const origemEl = document.getElementById('tracking-origem');
  const destinoEl = document.getElementById('tracking-destino');
  if (!origemEl || !destinoEl) return;

  const pontoAtual = sequenciaRota[indiceRotaAtual];
  const proximoPonto = sequenciaRota[indiceRotaAtual + 1];

  origemEl.textContent = pontoAtual ? pontoAtual.texto : '—';
  destinoEl.textContent = proximoPonto ? proximoPonto.texto : '—';

  // Mostra o resto da fila (pontos depois do próximo), pra deixar claro que nada foi substituído —
  // só empurrado pra depois da nova parada
  const restantes = sequenciaRota.slice(indiceRotaAtual + 2);
  const elRestantes = document.getElementById('tracking-proximas-paradas');
  if (elRestantes) {
    elRestantes.innerHTML = restantes.length > 0
      ? 'Depois: ' + restantes.map(p => p.texto).join(' → ')
      : '';
  }

  // Mostrar botão de avançar só se houver uma parada intermediária pendente (não o destino final)
  const btnAvancar = document.getElementById('btn-avancar-parada');
  if (btnAvancar) {
    const temParadaPendente = indiceRotaAtual < sequenciaRota.length - 2;
    btnAvancar.hidden = !temParadaPendente;
  }
}

function obterPontoAtualDaRota() {
  // Ponto que o motorista está buscando agora (o próximo na sequência)
  return sequenciaRota[indiceRotaAtual + 1] || sequenciaRota[indiceRotaAtual] || null;
}

function avancarParaProximaParada() {
  if (indiceRotaAtual < sequenciaRota.length - 2) {
    indiceRotaAtual++;
    renderRotaAtual();
    sincronizarRotaNoFirebase();
    showToast('📍 A caminho de: ' + sequenciaRota[indiceRotaAtual + 1]?.texto);
  }
}

document.getElementById('btn-avancar-parada')?.addEventListener('click', avancarParaProximaParada);

let paradaSelecionadaModal = null;

document.getElementById('btn-add-stop-ongoing')?.addEventListener('click', () => {
  document.getElementById('add-stop-modal').hidden = false;
  const input = document.getElementById('add-stop-input');
  if (input && !input._wired) {
    attachAddressAutocomplete(input, (r) => { paradaSelecionadaModal = r; }, document.getElementById('add-stop-suggestions'));
    input._wired = true;
  }
  setTimeout(() => input?.focus(), 100);
});

document.getElementById('add-stop-modal-close')?.addEventListener('click', () => {
  document.getElementById('add-stop-modal').hidden = true;
});

document.getElementById('btn-confirmar-parada')?.addEventListener('click', () => {
  const input = document.getElementById('add-stop-input');
  const texto = input.value.trim();
  if (!texto) { showToast('⚠️ Informe o endereço da parada'); return; }

  const novaParada = {
    texto,
    lat: paradaSelecionadaModal?.lat || null,
    lon: paradaSelecionadaModal?.lon || null,
    tipo: 'parada',
  };

  // Insere a nova parada antes do destino final (penúltima posição)
  sequenciaRota.splice(sequenciaRota.length - 1, 0, novaParada);
  renderRotaAtual();

  // Sincroniza a rota completa no Firebase para o motorista também ver
  sincronizarRotaNoFirebase();

  showToast('📍 Parada adicionada: ' + texto + ' (+R$ 5,00)');
  enviarMensagemChat('📍 Parada adicional solicitada: ' + texto);

  input.value = '';
  paradaSelecionadaModal = null;
  document.getElementById('add-stop-modal').hidden = true;
});

function sincronizarRotaNoFirebase() {
  if (!firebaseReady || !db || !state.corridaId || String(state.corridaId).startsWith('local-')) return;
  fb.updateDoc(fb.doc(db, 'corridas', state.corridaId), {
    sequenciaRota: sequenciaRota,
    indiceRotaAtual: indiceRotaAtual,
  }).catch((e) => console.error('[passageiro] erro ao sincronizar rota:', e));
}

// ─────────────────────────────────────
// ÚLTIMA CORRIDA (Home)
// ─────────────────────────────────────
function renderLastRide() {
  const historico = getStorageJSON('interliga_corridas', []);
  if (historico.length === 0) return;
  const ultima = historico[0];
  document.getElementById('last-ride-title').textContent = ultima.destino;
  document.getElementById('last-ride-sub').textContent = new Date(ultima.criadoEm).toLocaleDateString('pt-BR');
  document.getElementById('last-ride-price').textContent = 'R$ ' + Number(ultima.preco).toFixed(2).replace('.', ',');
}

function renderTripsScreen() {
  const historico = getStorageJSON('interliga_corridas', []);
  const listEl = document.getElementById('trips-list');
  if (!listEl) return;

  if (historico.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🧳</div>
        <div class="empty-title">Nenhuma viagem ainda</div>
        <div class="empty-sub">Suas corridas vão aparecer aqui</div>
      </div>`;
    return;
  }

  listEl.innerHTML = historico.map(c => `
    <div class="trip-card">
      <div class="trip-card-top">
        <span>${new Date(c.criadoEm).toLocaleDateString('pt-BR')} · ${new Date(c.criadoEm).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</span>
        <span class="trip-card-price">R$ ${Number(c.preco).toFixed(2).replace('.', ',')}</span>
      </div>
      <div class="trip-card-route">📍 ${c.origem} → 🏁 ${c.destino}</div>
      ${c.motoristaNome ? `<div style="font-size:12px;color:var(--text-soft);margin-top:4px;">🚗 ${c.motoristaNome}${c.motoristaVeiculo ? ' · ' + c.motoristaVeiculo : ''}${c.motoristaPlaca ? ' · ' + c.motoristaPlaca : ''}</div>` : ''}
    </div>
  `).join('');
}

// ─────────────────────────────────────
// AGENDAMENTO — calendário
// ─────────────────────────────────────
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedDay = null;
let selectedSlot = null;
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const HORARIOS = ['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'];

let schedOrigemSelecionada = null;
let schedDestinoSelecionada = null;

function onEnterSchedule() {
  buildCalendar();
  buildSlots();
  renderAgendamentos();

  const inputOrigem = document.getElementById('sched-origem');
  const inputDestino = document.getElementById('sched-destino');
  const caixaSugestoesAgendamento = document.getElementById('sched-suggestions');
  if (inputOrigem && !inputOrigem._wired) {
    attachAddressAutocomplete(inputOrigem, (r) => { schedOrigemSelecionada = r; }, caixaSugestoesAgendamento);
    inputOrigem._wired = true;
  }
  if (inputDestino && !inputDestino._wired) {
    attachAddressAutocomplete(inputDestino, (r) => { schedDestinoSelecionada = r; }, caixaSugestoesAgendamento);
    inputDestino._wired = true;
  }
}

function renderAgendamentos() {
  const agendamentos = getStorageJSON('interliga_agendamentos', []);
  const listEl = document.getElementById('scheduled-list');
  const emptyEl = document.getElementById('scheduled-empty');
  if (!listEl) return;

  if (agendamentos.length === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = agendamentos.map((a, i) => `
    <div class="trip-card">
      <div class="trip-card-top">
        <span>📅 ${a.data} · ${a.hora}</span>
        <button class="cancel-link" style="margin:0;padding:0;font-size:12px;" data-cancel-sched="${i}">Cancelar</button>
      </div>
      <div class="trip-card-route">${a.origem} → ${a.destino}</div>
    </div>
  `).join('');
}

document.getElementById('scheduled-list')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cancel-sched]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.cancelSched, 10);
  const agendamentos = getStorageJSON('interliga_agendamentos', []);
  agendamentos.splice(idx, 1);
  setStorageJSON('interliga_agendamentos', agendamentos);
  showToast('Agendamento cancelado');
  renderAgendamentos();
});

function buildCalendar() {
  const grid = document.getElementById('calendar-grid');
  const label = document.getElementById('cal-month-label');
  if (!grid || !label) return;

  label.textContent = `${MESES[calMonth]} ${calYear}`;
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  grid.innerHTML = '';
  for (let i = 0; i < firstDay; i++) {
    grid.insertAdjacentHTML('beforeend', '<div class="cal-day is-other"></div>');
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const thisDate = new Date(calYear, calMonth, d);
    const isPast = thisDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const isToday = d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
    const classes = ['cal-day'];
    if (isPast) classes.push('is-past');
    if (isToday) classes.push('is-today');
    grid.insertAdjacentHTML('beforeend', `<div class="${classes.join(' ')}" data-day="${d}">${d}</div>`);
  }
}

document.getElementById('calendar-grid')?.addEventListener('click', (e) => {
  const el = e.target.closest('.cal-day');
  if (!el || el.classList.contains('is-past') || el.classList.contains('is-other')) return;
  document.querySelectorAll('.cal-day').forEach(d => d.classList.remove('is-selected'));
  el.classList.add('is-selected');
  selectedDay = el.dataset.day;
});

document.getElementById('cal-prev')?.addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  buildCalendar();
});
document.getElementById('cal-next')?.addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  buildCalendar();
});

function buildSlots() {
  const grid = document.getElementById('slots-grid');
  if (!grid) return;
  grid.innerHTML = HORARIOS.map(h => `<div class="slot-item" data-slot="${h}">${h}</div>`).join('');
}

document.getElementById('slots-grid')?.addEventListener('click', (e) => {
  const el = e.target.closest('.slot-item');
  if (!el) return;
  document.querySelectorAll('.slot-item').forEach(s => s.classList.remove('is-selected'));
  el.classList.add('is-selected');
  selectedSlot = el.dataset.slot;
});

document.getElementById('btn-confirmar-agendamento')?.addEventListener('click', () => {
  const inputOrigem = document.getElementById('sched-origem');
  const inputDestino = document.getElementById('sched-destino');
  const origem = inputOrigem.value.trim();
  const destino = inputDestino.value.trim();

  if (!selectedDay) { showToast('⚠️ Selecione uma data'); return; }
  if (!selectedSlot) { showToast('⚠️ Selecione um horário'); return; }
  if (!origem) { showToast('⚠️ Informe o endereço de embarque'); inputOrigem.focus(); return; }
  if (!destino) { showToast('⚠️ Informe o destino'); inputDestino.focus(); return; }

  const agendamentos = getStorageJSON('interliga_agendamentos', []);
  const dataDisparo = new Date(calYear, calMonth, parseInt(selectedDay, 10));
  const [horaSel, minutoSel] = selectedSlot.split(':').map(Number);
  dataDisparo.setHours(horaSel, minutoSel || 0, 0, 0);

  agendamentos.unshift({
    origem, destino,
    origemLat: schedOrigemSelecionada?.lat || null,
    origemLon: schedOrigemSelecionada?.lon || null,
    destinoLat: schedDestinoSelecionada?.lat || null,
    destinoLon: schedDestinoSelecionada?.lon || null,
    data: `${selectedDay} de ${MESES[calMonth]}`,
    hora: selectedSlot,
    disparoEm: dataDisparo.toISOString(),
    disparada: false,
    criadoEm: new Date().toISOString(),
  });
  setStorageJSON('interliga_agendamentos', agendamentos.slice(0, 20));

  showToast('✅ Corrida agendada com sucesso!');

  // Limpar formulário e atualizar lista, sem sair da tela
  inputOrigem.value = '';
  inputDestino.value = '';
  schedOrigemSelecionada = null;
  schedDestinoSelecionada = null;
  selectedDay = null;
  selectedSlot = null;
  document.querySelectorAll('.cal-day.is-selected, .slot-item.is-selected').forEach(el => el.classList.remove('is-selected'));
  renderAgendamentos();
});

// ─────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────
// ─────────────────────────────────────
// DISPARO DE AGENDAMENTOS — quando a hora marcada chega, cria a corrida de
// verdade e chama motorista, do mesmo jeito que uma corrida pedida na hora.
// IMPORTANTE: só funciona se o app estiver aberto (em primeiro ou segundo plano)
// perto do horário marcado — não existe um servidor disparando isso sozinho.
// ─────────────────────────────────────
let agendamentosWatchdogInterval = null;

function iniciarVerificacaoAgendamentos() {
  clearInterval(agendamentosWatchdogInterval);
  verificarAgendamentosPendentes();
  agendamentosWatchdogInterval = setInterval(verificarAgendamentosPendentes, 30000);
}

async function verificarAgendamentosPendentes() {
  try {
    const agendamentos = getStorageJSON('interliga_agendamentos', []);
    if (agendamentos.length === 0) return;
    const agora = Date.now();
    let mudou = false;

    for (const ag of agendamentos) {
      if (ag.disparada || !ag.disparoEm) continue;
      const momentoDisparo = new Date(ag.disparoEm).getTime();
      if (agora < momentoDisparo) continue; // ainda não chegou a hora

      ag.disparada = true;
      mudou = true;

      if (agora - momentoDisparo < 10 * 60 * 1000) {
        // Chegou a hora (com até 10 min de tolerância) — dispara a corrida de verdade
        disparaCorridaAgendada(ag);
      } else {
        // Passou muito tempo do horário (app ficou fechado) — não dispara tarde, só marca como expirado
        console.warn('[passageiro] agendamento expirado sem disparar (app estava fechado na hora):', ag);
      }
    }
    if (mudou) setStorageJSON('interliga_agendamentos', agendamentos);
  } catch (e) { console.warn('[passageiro] erro ao verificar agendamentos:', e); }
}

function disparaCorridaAgendada(ag) {
  if (state.corridaId) return; // já tem corrida em andamento, não sobrepõe

  state.origem = { texto: ag.origem, lat: ag.origemLat, lon: ag.origemLon };
  state.destino = { texto: ag.destino, lat: ag.destinoLat, lon: ag.destinoLon };

  const preco = (ag.origemLat && ag.destinoLat)
    ? Math.max(8, 5 + haversineKm(ag.origemLat, ag.origemLon, ag.destinoLat, ag.destinoLon) * 2.40)
    : 18;

  go('screen-tracking');
  montarSequenciaInicial();
  document.getElementById('block-searching').hidden = false;
  document.getElementById('block-driver').hidden = true;
  document.getElementById('chat-panel').hidden = true;
  document.getElementById('tracking-title').textContent = '🔔 Corrida agendada — buscando motorista...';
  document.getElementById('tracking-sub').textContent = 'Aguarde um instante';
  showToast('🔔 Hora da sua corrida agendada! Chamando motorista...');

  criarCorrida(state.origem, state.destino, preco, 'x');
}

document.getElementById('btn-editar-perfil-passageiro')?.addEventListener('click', () => {
  document.getElementById('ed-pax-nome').value = state.passageiro?.nome || '';
  document.getElementById('ed-pax-celular').value = state.passageiro?.celular || '';
  go('screen-editar-perfil-passageiro');
});

document.getElementById('btn-salvar-perfil-passageiro')?.addEventListener('click', async () => {
  const erroEl = document.getElementById('ed-pax-erro');
  erroEl.hidden = true;
  const nome = document.getElementById('ed-pax-nome').value.trim();
  const celular = document.getElementById('ed-pax-celular').value.trim();

  if (!nome || nome.split(' ').length < 2) { erroEl.textContent = '⚠️ Informe seu nome completo'; erroEl.hidden = false; return; }
  if (celular.replace(/\D/g, '').length < 10) { erroEl.textContent = '⚠️ Informe um celular válido com DDD'; erroEl.hidden = false; return; }
  if (!firebaseReady || !db || !meuPassageiroId) { erroEl.textContent = '⚠️ Sem conexão com o servidor'; erroEl.hidden = false; return; }

  const btn = document.getElementById('btn-salvar-perfil-passageiro');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    await fb.setDoc(fb.doc(db, 'passageiros', meuPassageiroId), { nome, celular }, { merge: true });
    if (state.passageiro) { state.passageiro.nome = nome; state.passageiro.celular = celular; }
    document.getElementById('profile-name').textContent = nome;
    document.getElementById('profile-phone').textContent = celular;
    const elAvatar = document.querySelector('.profile-avatar');
    if (elAvatar) elAvatar.textContent = nome.trim().charAt(0).toUpperCase();
    const elHomeAvatar = document.getElementById('home-avatar');
    if (elHomeAvatar) elHomeAvatar.textContent = nome.trim().charAt(0).toUpperCase();
    showToast('✅ Perfil atualizado!');
    go('screen-profile');
  } catch (e) {
    console.error('[passageiro] erro ao salvar perfil:', e);
    erroEl.textContent = '⚠️ Erro ao salvar — tenta de novo';
    erroEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar alterações';
  }
});

document.getElementById('btn-suporte-passageiro')?.addEventListener('click', () => {
  const msg = encodeURIComponent('Olá! Preciso de ajuda com o app Interliga.');
  window.open('https://wa.me/5571981899571?text=' + msg, '_blank');
});

document.getElementById('btn-sair-passageiro')?.addEventListener('click', async () => {
  if (!confirm('Sair da sua conta? Você vai precisar fazer login de novo pra voltar a usar o app.')) return;
  try {
    if (cadastroPassageiroListenerUnsub) { cadastroPassageiroListenerUnsub(); cadastroPassageiroListenerUnsub = null; }
    if (authPassageiro) await authModRef.signOut(authPassageiro);
    meuPassageiroId = null;
    go('screen-login-passageiro');
  } catch (e) {
    console.error('[passageiro] erro ao sair:', e);
    showToast('⚠️ Erro ao sair, tenta de novo');
  }
});

// ─────────────────────────────────────
// NOTIFICAÇÕES PUSH — recebe aviso (ex: "motorista aceitou") mesmo com o
// app fechado/em segundo plano (precisa da chave VAPID do Firebase Console)
// ─────────────────────────────────────
const VAPID_KEY = 'BNlkkjvYwHosBBv6UWCzKWCB58rNoEP1YrlGFsXetoPFLDMWUNdA2r4VqtD4sHwgdb_yyKbOBydT2dxKDXWrrY4'; // Firebase Console → Configurações do projeto → Cloud Messaging → Web Push certificates

let pushConfigurado = false;

async function configurarNotificacoesPush() {
  if (pushConfigurado) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[passageiro] notificações push não suportadas neste navegador');
    return;
  }
  if (!fbAppInstancia || !meuPassageiroId || !db) return;
  if (VAPID_KEY === 'BNlkkjvYwHosBBv6UWCzKWCB58rNoEP1YrlGFsXetoPFLDMWUNdA2r4VqtD4sHwgdb_yyKbOBydT2dxKDXWrrY4') {
    console.warn('[passageiro] VAPID_KEY ainda não configurada — pulando notificações push');
    return;
  }

  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      console.warn('[passageiro] permissão de notificação negada pelo usuário');
      return;
    }

    const messagingMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');
    const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    const messaging = messagingMod.getMessaging(fbAppInstancia);
    const token = await messagingMod.getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (token) {
      await fb.setDoc(fb.doc(db, 'passageiros', meuPassageiroId), { fcmToken: token }, { merge: true });
      pushConfigurado = true;
      console.log('[passageiro] notificações push configuradas');
    }
  } catch (e) {
    console.warn('[passageiro] erro ao configurar notificações push:', e);
  }
}

// Intercepta o botão "voltar" do Android (e o gesto de voltar no iOS).
// Em vez de fechar o app ou sair da página, volta pra tela anterior dentro do app.
window.addEventListener('popstate', () => {
  const anterior = historicoNavPassageiro.pop();
  if (anterior) {
    // Vai pra tela anterior SEM empurrar no histórico de novo (evita loop)
    const next = document.getElementById(anterior);
    if (!next) return;
    const current = document.querySelector('.screen[data-active="true"]');
    if (current) current.removeAttribute('data-active');
    next.setAttribute('data-active', 'true');
    state.currentScreen = anterior;
  } else {
    // Não tem mais histórico interno — empurra um estado vazio pra não fechar o app
    history.pushState(null, '', '');
  }
});

// Estado inicial no histórico — garante que o popstate funciona desde o primeiro "voltar"
history.pushState(null, '', '');

function boot() {
  initFirebase(); // assíncrono — quando conectar, chama verificarCadastroPassageiro() se já escolheu ser passageiro
  iniciarVerificacaoAgendamentos();
  setTimeout(() => {
    const papel = localStorage.getItem('interliga_papel');
    if (!papel) {
      go('screen-role-choice');
    } else if (papel === 'motorista') {
      window.location.href = 'motorista.html';
    } else {
      // já escolheu ser passageiro antes — fica no splash mais um instante
      // até o Firebase responder e verificarCadastroPassageiro() decidir a tela certa
      if (firebaseReady) verificarCadastroPassageiro();
    }
  }, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
