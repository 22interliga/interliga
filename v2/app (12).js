// ═══════════════════════════════════════
// INTERLIGA — Passageiro
// app.js — única fonte de verdade, sem duplicação
// ═══════════════════════════════════════

// ─────────────────────────────────────
// FIREBASE — carregado dinamicamente, nunca bloqueia o app se falhar
// ─────────────────────────────────────
let db = null;
let firebaseReady = false;
let fb = {}; // funções do firestore, preenchidas após carregar

async function initFirebase() {
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const firestoreMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
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
  const containerPai = inputEl.closest('.form-card');
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

function calcularPrecos() {
  if (!state.origem || !state.destino) return;
  const km = haversineKm(state.origem.lat, state.origem.lon, state.destino.lat, state.destino.lon);

  const tabela = {
    x:    { base: 5,  porKm: 2.40, min: 8 },
    plus: { base: 7,  porKm: 3.36, min: 12 },
    van:  { base: 10, porKm: 4.80, min: 18 },
  };

  for (const cat of ['x', 'plus', 'van']) {
    const t = tabela[cat];
    const preco = Math.max(t.min, t.base + km * t.porKm);
    state.precos[cat] = preco;
    const priceEl = document.getElementById(`price-${cat}`);
    const etaEl = document.getElementById(`eta-${cat}`);
    if (priceEl) priceEl.textContent = 'R$ ' + preco.toFixed(2).replace('.', ',');
    if (etaEl) etaEl.textContent = Math.max(3, Math.round(km * 1.8)) + ' min';
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
  document.getElementById('tracking-origem').textContent = state.origem.texto;
  document.getElementById('tracking-destino').textContent = state.destino.texto;
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
  const historico = JSON.parse(localStorage.getItem('interliga_corridas') || '[]');
  const localId = 'local-' + Date.now();
  historico.unshift({ ...corridaLocal, id: localId });
  localStorage.setItem('interliga_corridas', JSON.stringify(historico.slice(0, 50)));
  state.corridaId = localId;

  if (firebaseReady && db) {
    try {
      const docRef = await fb.addDoc(fb.collection(db, 'corridas'), {
        ...corridaLocal,
        criadoEm: fb.serverTimestamp(),
      });
      state.corridaId = docRef.id;
      ouvirAceiteCorrida(docRef.id);
    } catch (e) {
      console.warn('Erro ao salvar corrida no Firebase, seguindo apenas local:', e);
      simularBuscaLocal();
    }
  } else {
    simularBuscaLocal();
  }
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

  state.corridaListenerUnsub = fb.onSnapshot(fb.doc(db, 'corridas', corridaId), (snap) => {
    const data = snap.data();
    console.log('[passageiro] snapshot recebido. status:', data?.status, 'dados completos:', data);
    if (!data) return;
    if (data.status === 'aceita') {
      console.log('[passageiro] motorista aceitou! Exibindo tela de motorista encontrado.');
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
      try {
        const historico = JSON.parse(localStorage.getItem('interliga_corridas') || '[]');
        const idx = historico.findIndex(c => c.id === state.corridaId);
        if (idx >= 0) historico[idx].status = 'finalizada';
        localStorage.setItem('interliga_corridas', JSON.stringify(historico));
      } catch (e) {}

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
  }, (erro) => console.error('[passageiro] erro no listener de posição:', erro));
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
        renderChatMessage(msg.texto, msg.de === 'passageiro' ? 'me' : 'them');
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

function renderChatMessage(texto, tipo) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${tipo}`;
  div.textContent = texto;
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

function confirmarCancelamento() {
  document.getElementById('cancel-modal').hidden = true;

  const temMulta = timestampAceite && (Date.now() - timestampAceite) >= TEMPO_GRACA_CANCEL_MS;

  if (state.corridaListenerUnsub) state.corridaListenerUnsub();
  if (state.chatListenerUnsub) state.chatListenerUnsub();
  if (firebaseReady && db && state.corridaId && !state.corridaId.startsWith('local-')) {
    fb.updateDoc(fb.doc(db, 'corridas', state.corridaId), {
      status: 'cancelada',
      motivoCancelamento: motivoCancelamentoSelecionado,
      multaCobrada: temMulta,
    }).catch(() => {});
  }

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

document.getElementById('btn-add-stop')?.addEventListener('click', () => {
  const idx = paradasExtras.length;
  paradasExtras.push({ texto: '' });
  renderParadas();
});

function renderParadas() {
  const container = document.getElementById('stops-list');
  if (!container) return;
  container.innerHTML = paradasExtras.map((p, i) => `
    <div class="address-field" style="padding:8px 16px;">
      <span class="address-dot" style="background:#9098A8;"></span>
      <input type="text" class="stop-input" data-stop-idx="${i}" placeholder="Endereço da parada ${i+1}" value="${p.texto}">
      <button class="stop-remove" data-remove-stop="${i}">✕</button>
    </div>
  `).join('');
}

document.getElementById('stops-list')?.addEventListener('input', (e) => {
  const input = e.target.closest('.stop-input');
  if (!input) return;
  const idx = parseInt(input.dataset.stopIdx, 10);
  paradasExtras[idx].texto = input.value;
});

document.getElementById('stops-list')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-stop]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.removeStop, 10);
  paradasExtras.splice(idx, 1);
  renderParadas();
});

document.getElementById('btn-add-stop-ongoing')?.addEventListener('click', () => {
  const endereco = prompt('Endereço da parada adicional:');
  if (!endereco || !endereco.trim()) return;
  showToast('📍 Parada adicionada: ' + endereco + ' (+R$ 5,00)');
  // Avisa o motorista via chat
  enviarMensagemChat('📍 Parada adicional solicitada: ' + endereco);
});

// ─────────────────────────────────────
// ÚLTIMA CORRIDA (Home)
// ─────────────────────────────────────
function renderLastRide() {
  const historico = JSON.parse(localStorage.getItem('interliga_corridas') || '[]');
  if (historico.length === 0) return;
  const ultima = historico[0];
  document.getElementById('last-ride-title').textContent = ultima.destino;
  document.getElementById('last-ride-sub').textContent = new Date(ultima.criadoEm).toLocaleDateString('pt-BR');
  document.getElementById('last-ride-price').textContent = 'R$ ' + Number(ultima.preco).toFixed(2).replace('.', ',');
}

function renderTripsScreen() {
  const historico = JSON.parse(localStorage.getItem('interliga_corridas') || '[]');
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
  if (inputOrigem && !inputOrigem._wired) {
    attachAddressAutocomplete(inputOrigem, (r) => { schedOrigemSelecionada = r; });
    inputOrigem._wired = true;
  }
  if (inputDestino && !inputDestino._wired) {
    attachAddressAutocomplete(inputDestino, (r) => { schedDestinoSelecionada = r; });
    inputDestino._wired = true;
  }
}

function renderAgendamentos() {
  const agendamentos = JSON.parse(localStorage.getItem('interliga_agendamentos') || '[]');
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
  const agendamentos = JSON.parse(localStorage.getItem('interliga_agendamentos') || '[]');
  agendamentos.splice(idx, 1);
  localStorage.setItem('interliga_agendamentos', JSON.stringify(agendamentos));
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

  const agendamentos = JSON.parse(localStorage.getItem('interliga_agendamentos') || '[]');
  agendamentos.unshift({
    origem, destino,
    origemLat: schedOrigemSelecionada?.lat || null,
    origemLon: schedOrigemSelecionada?.lon || null,
    destinoLat: schedDestinoSelecionada?.lat || null,
    destinoLon: schedDestinoSelecionada?.lon || null,
    data: `${selectedDay} de ${MESES[calMonth]}`,
    hora: selectedSlot,
    criadoEm: new Date().toISOString(),
  });
  localStorage.setItem('interliga_agendamentos', JSON.stringify(agendamentos.slice(0, 20)));

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
function boot() {
  initFirebase(); // assíncrono, não bloqueia a UI
  setTimeout(() => go('screen-home'), 1500); // splash por 1.5s
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
