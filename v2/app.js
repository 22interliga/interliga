// ═══════════════════════════════════════
// INTERLIGA — Passageiro
// app.js — única fonte de verdade, sem duplicação
// ═══════════════════════════════════════

// ─────────────────────────────────────
// FIREBASE — carregado dinamicamente, nunca bloqueia o app se falhar
// ─────────────────────────────────────
let db = null;
let firebaseReady = false;

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

async function initFirebase() {
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const firestoreMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const authMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    fb = firestoreMod;

    const firebaseConfig = {
      apiKey: "AIzaSyAAwR-TwQlWIgR4hBRjWtjfm_qFSkultUY",
      authDomain: "interliga-app.firebaseapp.com",
      projectId: "interliga-app",
      storageBucket: "interliga-app.firebasestorage.app",
      messagingSenderId: "913895237568",
      appId: "1:913895237568:web:faad95e8af089150e54a25",
    };

    const fbApp = initializeApp(firebaseConfig);
    db = fb.getFirestore(fbApp);

    // Autenticação anônima — exige um login (mesmo sem senha) pra poder ler/escrever no banco.
    // Sem isso, qualquer pessoa na internet acessaria os dados direto, sem nem abrir o app.
    const auth = authMod.getAuth(fbApp);
    await authMod.signInAnonymously(auth);

    firebaseReady = true;
    console.log('✅ Firebase conectado');
  } catch (e) {
    console.warn('Firebase não disponível — app funciona em modo local:', e);
    firebaseReady = false;
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
export function go(screenId) {
  const next = document.getElementById(screenId);
  if (!next) {
    console.warn('[go] Tela não encontrada:', screenId);
    return;
  }
  const current = document.querySelector('.screen[data-active="true"]');
  if (current === next) return;

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
async function buscarEnderecos(termo) {
  if (!termo || termo.trim().length < 3) return [];
  try {
    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(termo + ', Madre de Deus, Bahia, Brasil')}` +
      `&format=json&limit=5&countrycodes=br`;
    const resp = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    const data = await resp.json();
    return data.map(item => ({
      texto: item.display_name,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
    }));
  } catch (e) {
    console.warn('Erro no geocoding:', e);
    return [];
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
  inputEl.addEventListener('input', search);

  suggestionsBox.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    // Só aplica se este input for o que está ativo na caixa de sugestões agora
    if (suggestionsBox._activeInput !== inputEl) return;
    const idx = parseInt(item.dataset.idx, 10);
    const result = suggestionsBox._results[idx];
    inputEl.value = result.texto;
    suggestionsBox.classList.remove('is-open');
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
  for (const zona of zonasRiscoCache) {
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

function calcularPrecos() {
  if (!state.origem || !state.destino) return;
  const km = haversineKm(state.origem.lat, state.origem.lon, state.destino.lat, state.destino.lon);
  const risco = calcularAcrescimoRisco(state.origem, state.destino);

  const tabela = {
    x:    { base: 5,  porKm: 2.40, min: 8 },
    plus: { base: 7,  porKm: 3.36, min: 12 },
    van:  { base: 10, porKm: 4.80, min: 18 },
  };

  for (const cat of ['x', 'plus', 'van']) {
    const t = tabela[cat];
    let preco = Math.max(t.min, t.base + km * t.porKm) + risco.acrescimo;
    preco = preco * (1 + risco.percentual / 100);
    state.precos[cat] = preco;
    const priceEl = document.getElementById(`price-${cat}`);
    const etaEl = document.getElementById(`eta-${cat}`);
    if (priceEl) priceEl.textContent = 'R$ ' + preco.toFixed(2).replace('.', ',');
    if (etaEl) etaEl.textContent = Math.max(3, Math.round(km * 1.8)) + ' min';
  }

  const notaRisco = document.getElementById('risk-note');
  if (notaRisco) {
    if (risco.zonasAtingidas.length > 0) {
      notaRisco.hidden = false;
      notaRisco.textContent = '📍 Inclui acréscimo de área de risco: ' + risco.zonasAtingidas.join(', ');
    } else {
      notaRisco.hidden = true;
    }
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
  const corridaLocal = {
    origem: origem.texto, destino: destino.texto,
    origemLat: origem.lat, origemLon: origem.lon,
    destinoLat: destino.lat, destinoLon: destino.lon,
    preco, categoria,
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
        const fila = await montarFilaPrioridade(origem);
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
async function montarFilaPrioridade(origem) {
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
    }
    if (data.status === 'finalizada') {
      console.log('[passageiro] corrida finalizada pelo motorista.');
      if (state.corridaListenerUnsub) { state.corridaListenerUnsub(); state.corridaListenerUnsub = null; }
      if (state.chatListenerUnsub) { state.chatListenerUnsub(); state.chatListenerUnsub = null; }
      pararEscutaPosicaoMotorista();

      // Atualizar status no histórico local (para aparecer corretamente em Minhas Viagens)
      atualizarStatusHistoricoLocal('finalizada');

      showToast('✅ Corrida finalizada! Obrigado por viajar com a Interliga.');
      go('screen-home');
    }
  }, (erro) => {
    console.error('[passageiro] erro no listener de aceite:', erro);
  });
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
  btn.addEventListener('click', () => {
    document.querySelectorAll('.payment-option').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    document.getElementById('payment-select-label').textContent = btn.dataset.label;
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
      paradasExtras[idx].texto = r.texto;
      paradasExtras[idx].lat = r.lat;
      paradasExtras[idx].lon = r.lon;
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
      <div class="trip-card-route">${c.origem} → ${c.destino}</div>
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

function boot() {
  initFirebase(); // assíncrono, não bloqueia a UI
  iniciarVerificacaoAgendamentos();
  setTimeout(() => go('screen-home'), 1500); // splash por 1.5s
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
