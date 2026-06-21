// ═══════════════════════════════════════
// INTERLIGA — Motorista
// motorista.js — única fonte de verdade, isolado do passageiro
// ═══════════════════════════════════════

let db = null;
let firebaseReady = false;
let fb = {};

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
    console.log('Firebase conectado (motorista)');
  } catch (e) {
    console.warn('Firebase nao disponivel:', e);
    firebaseReady = false;
  }
}

// ─────────────────────────────────────
// IDENTIDADE DO MOTORISTA — fixa por dispositivo, usada na fila de prioridade
// ─────────────────────────────────────
function obterMotoristaId() {
  let id = localStorage.getItem('interliga_motorista_id');
  if (!id) {
    id = 'mot-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('interliga_motorista_id', id);
  }
  return id;
}
const meuMotoristaId = obterMotoristaId();

// ─────────────────────────────────────
// ESTADO
// ─────────────────────────────────────
const state = {
  online: false,
  corridaAtualId: null,
  corridaAtual: null,
  countdownInterval: null,
  countdownSegundos: 15,
  corridasListenerUnsub: null,
  chatListenerUnsub: null,
  motorista: { nome: 'Motorista', avaliacao: '4.8', veiculo: 'Honda Civic', placa: 'ABC-1234' },
  historico: [],
};

// ─────────────────────────────────────
// NAVEGAÇÃO — função única, isolada deste arquivo
// ─────────────────────────────────────
function go(screenId) {
  const next = document.getElementById(screenId);
  if (!next) { console.warn('[go-motorista] Tela nao encontrada:', screenId); return; }
  const current = document.querySelector('.screen[data-active="true"]');
  if (current === next) return;
  if (current) current.removeAttribute('data-active');
  next.setAttribute('data-active', 'true');

  const onEnterHandlers = {
    'screen-home': onEnterHome,
    'screen-ongoing': onEnterOngoing,
  };
  if (onEnterHandlers[screenId]) onEnterHandlers[screenId]();
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-go]');
  if (target) go(target.dataset.go);
});

// ─────────────────────────────────────
// TOAST
// ─────────────────────────────────────
let toastTimer = null;
function showToast(msg, duration = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), duration);
}

// ─────────────────────────────────────
// SOM DE NOVA CORRIDA
// ─────────────────────────────────────
function tocarSomNovaCorrida() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notas = [880, 1100, 880, 1100, 880];
    let t = ctx.currentTime;
    notas.forEach(freq => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.05);
      g.gain.linearRampToValueAtTime(0, t + 0.18);
      o.start(t); o.stop(t + 0.2);
      t += 0.22;
    });
  } catch (e) {}
}

// ─────────────────────────────────────
// HOME — toggle online/offline
// ─────────────────────────────────────
function onEnterHome() {
  atualizarStatsHome();
  initHomeMapDriver();
}

document.getElementById('online-toggle')?.addEventListener('click', () => {
  state.online = !state.online;
  const btn = document.getElementById('online-toggle');
  btn.dataset.online = state.online ? 'true' : 'false';
  btn.querySelector('.online-label').textContent = state.online ? 'Online' : 'Offline';

  if (state.online) {
    showToast('🟢 Você está online — buscando corridas...');
    iniciarEscutaCorridas();
    iniciarDisponibilidade();
  } else {
    showToast('🔴 Você está offline');
    pararEscutaCorridas();
    pararDisponibilidade();
  }
});

function atualizarStatsHome() {
  const historico = JSON.parse(localStorage.getItem('interliga_motorista_historico') || '[]');
  document.getElementById('stat-corridas').textContent = historico.length;
  const totalKm = historico.reduce((acc, c) => acc + (c.km || 0), 0);
  document.getElementById('stat-km').textContent = totalKm.toFixed(0);
  document.getElementById('stat-avaliacao').textContent = state.motorista.avaliacao;

  const hoje = new Date().toDateString();
  const ganhosHoje = historico
    .filter(c => new Date(c.data).toDateString() === hoje)
    .reduce((acc, c) => acc + (c.valor || 0), 0);
  document.getElementById('earnings-today').textContent = 'R$ ' + ganhosHoje.toFixed(2).replace('.', ',');
}

// ─────────────────────────────────────
// DISPONIBILIDADE — publica localização do motorista livre pro Firebase,
// pra que o passageiro consiga montar a fila por proximidade/avaliação.
// Só roda enquanto o motorista está Online E sem corrida ativa.
// ─────────────────────────────────────
let intervalDisponibilidade = null;

function publicarDisponibilidade() {
  if (!firebaseReady || !db || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      fb.setDoc(fb.doc(db, 'motoristas_disponiveis', meuMotoristaId), {
        nome: state.motorista.nome,
        avaliacao: state.motorista.avaliacao,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        atualizadoEm: fb.serverTimestamp(),
      }).catch((e) => console.warn('[motorista] erro ao publicar disponibilidade:', e));
    },
    () => {},
    { timeout: 5000 }
  );
}

function iniciarDisponibilidade() {
  publicarDisponibilidade();
  clearInterval(intervalDisponibilidade);
  intervalDisponibilidade = setInterval(publicarDisponibilidade, 20000); // atualiza a cada 20s
}

function pararDisponibilidade() {
  clearInterval(intervalDisponibilidade);
  intervalDisponibilidade = null;
  if (firebaseReady && db) {
    fb.deleteDoc(fb.doc(db, 'motoristas_disponiveis', meuMotoristaId)).catch(() => {});
  }
}

// ─────────────────────────────────────
// MAPA HOME
// ─────────────────────────────────────
let homeMapDriver = null;
let homeMapDriverTentativas = 0;

function initHomeMapDriver() {
  console.log('[mapa-motorista] initHomeMapDriver chamada. homeMapDriver atual:', homeMapDriver);

  if (homeMapDriver) {
    setTimeout(() => homeMapDriver.invalidateSize(), 100);
    return;
  }
  const el = document.getElementById('map-home-driver');
  if (!el) { console.warn('[mapa-motorista] elemento #map-home-driver não encontrado'); return; }

  const tryInit = () => {
    homeMapDriverTentativas++;
    if (typeof L === 'undefined') {
      if (homeMapDriverTentativas < 50) { setTimeout(tryInit, 150); return; }
      console.warn('[mapa-motorista] Leaflet (L) nunca carregou após várias tentativas');
      return;
    }
    if (el.offsetWidth < 10 || el.offsetHeight < 10) {
      if (homeMapDriverTentativas < 50) { setTimeout(tryInit, 150); return; }
      console.warn('[mapa-motorista] elemento sem dimensões visíveis após várias tentativas. width:', el.offsetWidth, 'height:', el.offsetHeight);
      return;
    }

    console.log('[mapa-motorista] criando mapa Leaflet agora');
    homeMapDriver = L.map('map-home-driver', { zoomControl: false, attributionControl: false })
      .setView([-12.7375, -38.6285], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(homeMapDriver);

    navigator.geolocation?.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      homeMapDriver.setView([latitude, longitude], 15);
      L.circleMarker([latitude, longitude], { radius: 8, color: '#1251B5', fillColor: '#1251B5', fillOpacity: 0.8 }).addTo(homeMapDriver);
    }, () => {}, { timeout: 5000 });
  };
  tryInit();
}

// ─────────────────────────────────────
// ESCUTAR NOVAS CORRIDAS (Firestore)
// ─────────────────────────────────────
function iniciarEscutaCorridas() {
  if (state.corridasListenerUnsub) return;

  if (firebaseReady && db) {
    try {
      // Query simplificada (sem orderBy) para não exigir índice composto no Firestore
      const q = fb.query(
        fb.collection(db, 'corridas'),
        fb.where('status', '==', 'aguardando')
      );
      state.corridasListenerUnsub = fb.onSnapshot(q, (snap) => {
        console.log('[motorista] snapshot de corridas recebido. docs:', snap.docs.length);
        snap.docChanges().forEach(change => {
          if (change.type === 'added' || change.type === 'modified') {
            const corrida = { id: change.doc.id, ...change.doc.data() };
            if (corrida.status !== 'aguardando') return;

            // Ignorar corridas muito antigas (lixo de testes anteriores)
            const criadoEmMs = corrida.criadoEm?.toMillis ? corrida.criadoEm.toMillis() : null;
            if (criadoEmMs && (Date.now() - criadoEmMs) > 10 * 60 * 1000) {
              console.log('[motorista] ignorando corrida antiga:', corrida.id);
              return;
            }

            // Fila de prioridade: só notifica quem é a vez (motoristaAlvoAtual).
            // Sem fila definida (corrida antiga ou sem motoristas disponíveis cadastrados) = modo aberto, notifica todo mundo.
            const souAlvo = !corrida.motoristaAlvoAtual || corrida.motoristaAlvoAtual === meuMotoristaId;
            if (!souAlvo) return;

            // Evita notificar de novo pela mesma "rodada" da fila (mas notifica de novo se a fila voltou pra mim)
            const chaveOferta = corrida.id + ':' + (corrida.motoristaAlvoAtual || 'todos') + ':' + (corrida.filaIndiceAtual ?? 0);
            if (state._ultimaOfertaProcessada === chaveOferta) return;
            state._ultimaOfertaProcessada = chaveOferta;

            console.log('[motorista] corrida nova/oferta detectada:', corrida);
            notificarNovaCorrida(corrida);
          }
        });
      }, (erro) => {
        console.error('[motorista] erro no listener de corridas:', erro);
      });
      return;
    } catch (e) {
      console.warn('Erro ao escutar corridas:', e);
    }
  }
  // Fallback local: olha localStorage periodicamente (útil para teste no mesmo dispositivo)
  state.corridasListenerUnsub = setInterval(() => {
    const lst = JSON.parse(localStorage.getItem('interliga_corridas') || '[]');
    const pendente = lst.find(c => c.status === 'aguardando');
    if (pendente && pendente.id !== state._ultimaNotificada) {
      state._ultimaNotificada = pendente.id;
      notificarNovaCorrida(pendente);
    }
  }, 3000);
}

function pararEscutaCorridas() {
  if (typeof state.corridasListenerUnsub === 'function') state.corridasListenerUnsub();
  else if (state.corridasListenerUnsub) clearInterval(state.corridasListenerUnsub);
  state.corridasListenerUnsub = null;
}

// ─────────────────────────────────────
// VOZ — avisos falados em voz alta, pro motorista não precisar ficar olhando a tela
// ─────────────────────────────────────
function falarEmVoz(texto) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // não deixa acumular falas em fila
    const utter = new SpeechSynthesisUtterance(texto);
    utter.lang = 'pt-BR';
    utter.rate = 1;
    window.speechSynthesis.speak(utter);
  } catch (e) { console.warn('[motorista] erro ao falar em voz:', e); }
}

function notificarNovaCorrida(corrida) {
  console.log('[motorista] Nova corrida recebida:', corrida);
  state.corridaAtual = corrida;
  state.corridaAtualId = corrida.id;

  tocarSomNovaCorrida();
  falarEmVoz('Nova corrida disponível!');

  // Banner na home
  const banner = document.getElementById('new-ride-banner');
  const detail = document.getElementById('new-ride-detail');
  if (banner) {
    banner.hidden = false;
    if (detail) detail.textContent = `${corrida.origem} → ${corrida.destino}`;
  }

  showToast('🔔 Nova corrida disponível!');
}

// ─────────────────────────────────────
// TELA: CORRIDA RECEBIDA (aceitar/recusar)
// ─────────────────────────────────────
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-go="screen-request"]') && state.corridaAtual) {
    exibirCorridaRecebida(state.corridaAtual);
  }
});

function exibirCorridaRecebida(corrida) {
  document.getElementById('request-empty').hidden = true;
  document.getElementById('request-card').hidden = false;

  document.getElementById('request-origem').textContent = corrida.origem;
  document.getElementById('request-destino').textContent = corrida.destino;
  document.getElementById('request-valor').textContent = 'R$ ' + Number(corrida.preco || 18).toFixed(2).replace('.', ',');

  if (corrida.origemLat && corrida.destinoLat) {
    const km = haversineKm(corrida.origemLat, corrida.origemLon, corrida.destinoLat, corrida.destinoLon);
    document.getElementById('request-distancia').textContent = km.toFixed(1) + ' km';
  } else {
    document.getElementById('request-distancia').textContent = '-- km';
  }

  iniciarCountdown();
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function iniciarCountdown() {
  state.countdownSegundos = 15;
  const numEl = document.getElementById('countdown-num');
  const fgEl = document.getElementById('countdown-fg');
  if (numEl) numEl.textContent = state.countdownSegundos;
  if (fgEl) fgEl.style.strokeDashoffset = 0;

  // Toca o som de chamada repetidamente enquanto aguarda resposta (como uma campainha)
  tocarSomNovaCorrida();
  clearInterval(state.somRepeticaoInterval);
  state.somRepeticaoInterval = setInterval(() => tocarSomNovaCorrida(), 2000);

  clearInterval(state.countdownInterval);
  state.countdownInterval = setInterval(() => {
    state.countdownSegundos--;
    if (numEl) numEl.textContent = state.countdownSegundos;
    if (fgEl) fgEl.style.strokeDashoffset = (15 - state.countdownSegundos) * (100.5 / 15);
    if (state.countdownSegundos <= 0) {
      clearInterval(state.countdownInterval);
      clearInterval(state.somRepeticaoInterval);
      recusarCorrida();
      showToast('⏰ Tempo esgotado — corrida expirou');
    }
  }, 1000);
}

document.getElementById('btn-recusar')?.addEventListener('click', recusarCorrida);
// Avança a corrida pro próximo motorista da fila de prioridade. Se já passou
// por todo mundo, volta pro primeiro da lista (reoferece pra todo mundo de novo),
// em vez de matar a corrida — segue tentando até alguém aceitar.
async function avancarFilaOuReabrir(corridaId, corrida) {
  const fila = corrida.filaMotoristas || [];
  if (fila.length === 0) return; // modo aberto (sem fila) — nada a avançar, segue 'aguardando' pra todo mundo

  let indiceAtual = typeof corrida.filaIndiceAtual === 'number' ? corrida.filaIndiceAtual : 0;
  let proximoIndice = indiceAtual + 1;
  if (proximoIndice >= fila.length) proximoIndice = 0; // deu a volta — avisa todo mundo de novo

  const recusantes = Array.isArray(corrida.recusantes) ? [...corrida.recusantes] : [];
  if (!recusantes.includes(meuMotoristaId)) recusantes.push(meuMotoristaId);

  await fb.updateDoc(fb.doc(db, 'corridas', corridaId), {
    filaIndiceAtual: proximoIndice,
    motoristaAlvoAtual: fila[proximoIndice],
    ofertaExpiraEm: Date.now() + 15000,
    recusantes,
  });
}

function recusarCorrida() {
  clearInterval(state.countdownInterval);
  clearInterval(state.somRepeticaoInterval);

  const corridaId = state.corridaAtualId;
  const corrida = state.corridaAtual;
  if (firebaseReady && db && corridaId && !String(corridaId).startsWith('local-') && corrida) {
    avancarFilaOuReabrir(corridaId, corrida).catch((e) =>
      console.error('[motorista] erro ao avançar fila na recusa:', e)
    );
  }

  document.getElementById('request-card').hidden = true;
  document.getElementById('request-empty').hidden = false;
  document.getElementById('new-ride-banner').hidden = true;
  state.corridaAtual = null;
  state.corridaAtualId = null;
  go('screen-home');
}

document.getElementById('btn-aceitar')?.addEventListener('click', aceitarCorrida);
async function aceitarCorrida() {
  clearInterval(state.countdownInterval);
  clearInterval(state.somRepeticaoInterval);
  const corrida = state.corridaAtual;
  if (!corrida) {
    showToast('⚠️ Esta corrida já não está disponível');
    document.getElementById('request-card').hidden = true;
    document.getElementById('request-empty').hidden = false;
    document.getElementById('new-ride-banner').hidden = true;
    go('screen-home');
    return;
  }

  // Atualizar status no Firebase — usando transação, pra garantir que só o
  // primeiro motorista a clicar "aceitar" consiga, mesmo se dois clicarem juntos
  if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
    try {
      const conseguiu = await fb.runTransaction(db, async (tx) => {
        const ref = fb.doc(db, 'corridas', state.corridaAtualId);
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!data || data.status !== 'aguardando') return false; // outro motorista já pegou, ou foi cancelada
        tx.update(ref, {
          status: 'aceita',
          motoristaId: meuMotoristaId,
          motoristaNome: state.motorista.nome,
          motoristaVeiculo: state.motorista.veiculo,
          motoristaPlaca: state.motorista.placa,
          motoristaAvaliacao: state.motorista.avaliacao,
        });
        return true;
      });
      if (!conseguiu) {
        showToast('⚠️ Essa corrida já foi aceita por outro motorista');
        document.getElementById('request-card').hidden = true;
        document.getElementById('request-empty').hidden = false;
        document.getElementById('new-ride-banner').hidden = true;
        state.corridaAtual = null;
        state.corridaAtualId = null;
        go('screen-home');
        return;
      }
    } catch (e) {
      console.error('[motorista] Falha ao atualizar Firebase:', e);
    }
  }

  pararDisponibilidade(); // fico fora da fila de novas ofertas enquanto rodo essa corrida

  // Também atualizar localStorage (mesmo dispositivo / fallback)
  try {
    const lst = JSON.parse(localStorage.getItem('interliga_corridas') || '[]');
    const idx = lst.findIndex(c => c.id === corrida.id);
    if (idx >= 0) lst[idx].status = 'aceita';
    localStorage.setItem('interliga_corridas', JSON.stringify(lst));
  } catch (e) {}

  document.getElementById('new-ride-banner').hidden = true;
  showToast('✓ Corrida aceita! Indo ao passageiro.');

  try {
    go('screen-ongoing');
  } catch (e) {
    console.error('[motorista] ERRO CRÍTICO ao navegar para screen-ongoing:', e);
  }
}

// ─────────────────────────────────────
// TELA: CORRIDA EM ANDAMENTO
// ─────────────────────────────────────
let mapOngoing = null;
let chegouAoCliente = false;

function onEnterOngoing() {
  const corrida = state.corridaAtual;
  if (!corrida) { console.warn('[onEnterOngoing] sem corrida atual'); return; }

  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setText('ongoing-origem', corrida.origem);
  setText('ongoing-destino', corrida.destino);
  setText('passenger-name', 'Passageiro');
  setText('passenger-avatar', 'PS');
  setText('passenger-rating', '⭐ 4.9');

  chegouAoCliente = false;
  sequenciaRotaMotorista = [];
  indiceRotaAtualMotorista = 0;
  const btnCheguei = document.getElementById('btn-cheguei');
  const btnFinalizar = document.getElementById('btn-finalizar-corrida');
  const btnSeguir = document.getElementById('btn-seguir-viagem');
  if (btnCheguei) btnCheguei.hidden = false;
  if (btnFinalizar) btnFinalizar.hidden = true;
  if (btnSeguir) btnSeguir.hidden = true;

  try { initMapOngoing(corrida); } catch (e) { console.error('[motorista] erro ao iniciar mapa ongoing:', e); }
  try { iniciarChatMotorista(); } catch (e) { console.error('[motorista] erro ao iniciar chat:', e); }
  try { escutarCancelamentoCorrida(); } catch (e) { console.error('[motorista] erro ao escutar cancelamento:', e); }
  try { escutarMudancasRota(); } catch (e) { console.error('[motorista] erro ao escutar rota:', e); }

  // Atrasa o pedido de geolocalização para depois da tela já estar renderizada,
  // evitando que o prompt de permissão pareça travar a navegação
  setTimeout(() => {
    try { iniciarBroadcastPosicao(); } catch (e) { console.error('[motorista] erro ao iniciar broadcast posição:', e); }
  }, 500);
}

// ─────────────────────────────────────
// ESCUTAR MUDANÇAS NA ROTA (paradas adicionadas pelo passageiro)
// ─────────────────────────────────────
let rotaListenerUnsub = null;
let sequenciaRotaMotorista = [];
let indiceRotaAtualMotorista = 0;

function escutarMudancasRota() {
  if (!firebaseReady || !db || !state.corridaAtualId || rotaListenerUnsub) return;
  if (String(state.corridaAtualId).startsWith('local-')) return;

  rotaListenerUnsub = fb.onSnapshot(fb.doc(db, 'corridas', state.corridaAtualId), (snap) => {
    const data = snap.data();
    if (!data || !data.sequenciaRota) return;
    sequenciaRotaMotorista = data.sequenciaRota;
    indiceRotaAtualMotorista = data.indiceRotaAtual || 0;
    renderRotaMotorista();
  }, (erro) => console.error('[motorista] erro no listener de rota:', erro));
}

function pararEscutaRota() {
  if (rotaListenerUnsub) { rotaListenerUnsub(); rotaListenerUnsub = null; }
}

function renderRotaMotorista() {
  if (sequenciaRotaMotorista.length === 0) return;
  const pontoAtual = sequenciaRotaMotorista[indiceRotaAtualMotorista];
  const proximoPonto = sequenciaRotaMotorista[indiceRotaAtualMotorista + 1];

  const origemEl = document.getElementById('ongoing-origem');
  const destinoEl = document.getElementById('ongoing-destino');
  if (origemEl) origemEl.textContent = pontoAtual?.texto || '—';
  if (destinoEl) destinoEl.textContent = proximoPonto?.texto || '—';
}

// ─────────────────────────────────────
// ESCUTAR CANCELAMENTO — se o passageiro cancelar, motorista é avisado
// ─────────────────────────────────────
let cancelamentoListenerUnsub = null;

function escutarCancelamentoCorrida() {
  if (!firebaseReady || !db || !state.corridaAtualId || cancelamentoListenerUnsub) return;
  if (String(state.corridaAtualId).startsWith('local-')) return;

  cancelamentoListenerUnsub = fb.onSnapshot(fb.doc(db, 'corridas', state.corridaAtualId), (snap) => {
    const data = snap.data();
    if (!data) return;
    if (data.status === 'cancelada') {
      pararEscutaCancelamento();
      pararEscutaChat();
      pararEscutaRota();
      pararBroadcastPosicao();
      marcadorMotoristaMap = null;
      sequenciaRotaMotorista = [];
      indiceRotaAtualMotorista = 0;
      state.corridaAtual = null;
      state.corridaAtualId = null;
      falarEmVoz('Atenção! O passageiro cancelou a corrida.');
      showToast('❌ Passageiro cancelou a corrida');
      if (state.online) iniciarDisponibilidade(); // volta a ficar disponível pra novas ofertas
      go('screen-home');
    }
  }, (erro) => console.error('[motorista] erro no listener de cancelamento:', erro));
}

function pararEscutaCancelamento() {
  if (cancelamentoListenerUnsub) { cancelamentoListenerUnsub(); cancelamentoListenerUnsub = null; }
}

// ─────────────────────────────────────
// BROADCAST DE POSIÇÃO EM TEMPO REAL (motorista → Firebase → passageiro)
// ─────────────────────────────────────
let watchPositionId = null;
let marcadorMotoristaMap = null;

function iniciarBroadcastPosicao() {
  pararBroadcastPosicao();
  const badge = document.getElementById('ongoing-eta-badge');

  if (!navigator.geolocation) {
    if (badge) badge.textContent = '⚠️ Geolocalização não suportada';
    return;
  }

  if (badge) badge.textContent = '📡 Obtendo localização...';

  watchPositionId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      if (badge) badge.textContent = '🟢 Localização ativa';
      atualizarPosicaoNoMapa(latitude, longitude);

      if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
        fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
          motoristaLat: latitude,
          motoristaLon: longitude,
          motoristaAtualizadoEm: Date.now(),
        }).catch((e) => console.error('[motorista] erro ao salvar posição no Firebase:', e));
      }
    },
    (erro) => {
      console.warn('[motorista] erro ao obter posição:', erro);
      if (badge) {
        const motivos = { 1: 'Permissão negada', 2: 'Posição indisponível', 3: 'Tempo esgotado' };
        badge.textContent = '⚠️ ' + (motivos[erro.code] || 'Erro de localização');
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

function pararBroadcastPosicao() {
  if (watchPositionId !== null) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
}

function atualizarPosicaoNoMapa(lat, lon) {
  if (!mapOngoing) return;
  if (!marcadorMotoristaMap) {
    marcadorMotoristaMap = L.marker([lat, lon], {
      icon: L.divIcon({ className: '', html: '<div style="font-size:24px;">🚗</div>', iconSize: [30,30] })
    }).addTo(mapOngoing);
  } else {
    marcadorMotoristaMap.setLatLng([lat, lon]);
  }
  mapOngoing.panTo([lat, lon]);
}

function initMapOngoing(corrida) {
  const el = document.getElementById('map-ongoing');
  if (!el) return;

  const tryInit = () => {
    if (typeof L === 'undefined') { setTimeout(tryInit, 150); return; }
    if (el.offsetWidth < 10 || el.offsetHeight < 10) { setTimeout(tryInit, 150); return; }

    if (mapOngoing) { mapOngoing.remove(); mapOngoing = null; }

    const lat = corrida.origemLat || -12.7375;
    const lon = corrida.origemLon || -38.6285;
    mapOngoing = L.map('map-ongoing', { zoomControl: false, attributionControl: false }).setView([lat, lon], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapOngoing);
    L.marker([lat, lon]).addTo(mapOngoing);
  };
  tryInit();
}

document.getElementById('btn-cheguei')?.addEventListener('click', () => {
  console.log('[motorista] btn-cheguei clicado. sequenciaRotaMotorista:', sequenciaRotaMotorista, 'indiceRotaAtualMotorista:', indiceRotaAtualMotorista);

  const totalPontos = sequenciaRotaMotorista.length;
  const temParadaPendente = totalPontos > 2 && indiceRotaAtualMotorista < totalPontos - 2;

  console.log('[motorista] totalPontos:', totalPontos, 'temParadaPendente:', temParadaPendente);

  if (temParadaPendente) {
    // Chegou numa parada intermediária — mostra botão para seguir viagem
    document.getElementById('btn-cheguei').hidden = true;
    document.getElementById('btn-seguir-viagem').hidden = false;
    document.getElementById('ongoing-eta-badge').textContent = '🟢 Chegou na parada ' + (indiceRotaAtualMotorista + 1);
    showToast('🔔 Parada registrada');
    enviarMsgChatMotorista('🚗 Motorista chegou na parada! Aguardando para seguir viagem.', true);
  } else {
    // Chegou no destino final — libera finalizar corrida
    chegouAoCliente = true;
    document.getElementById('btn-cheguei').hidden = true;
    document.getElementById('btn-finalizar-corrida').hidden = false;
    document.getElementById('ongoing-eta-badge').textContent = '🟢 Você chegou!';
    showToast('🔔 Passageiro avisado que você chegou');
    enviarMsgChatMotorista('🚗 Motorista chegou ao seu local!', true);
  }
});

document.getElementById('btn-seguir-viagem')?.addEventListener('click', () => {
  indiceRotaAtualMotorista++;
  renderRotaMotorista();

  // Sincroniza com o Firebase para o passageiro também ver a rota atualizada
  if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
    fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
      indiceRotaAtual: indiceRotaAtualMotorista,
    }).catch((e) => console.error('[motorista] erro ao sincronizar avanço de rota:', e));
  }

  document.getElementById('btn-seguir-viagem').hidden = true;
  document.getElementById('btn-cheguei').hidden = false;
  document.getElementById('ongoing-eta-badge').textContent = '🕒 -- até o próximo destino';
  showToast('▶ Seguindo para: ' + (sequenciaRotaMotorista[indiceRotaAtualMotorista + 1]?.texto || 'destino'));
  enviarMsgChatMotorista('🚗 Motorista seguiu viagem!', true);
});

document.getElementById('btn-finalizar-corrida')?.addEventListener('click', finalizarCorrida);
function finalizarCorrida() {
  const corrida = state.corridaAtual;
  if (!corrida) { go('screen-home'); return; }

  const km = (corrida.origemLat && corrida.destinoLat)
    ? haversineKm(corrida.origemLat, corrida.origemLon, corrida.destinoLat, corrida.destinoLon)
    : 0;

  const historico = JSON.parse(localStorage.getItem('interliga_motorista_historico') || '[]');
  historico.unshift({
    origem: corrida.origem, destino: corrida.destino,
    valor: Number(corrida.preco || 18), km,
    data: new Date().toISOString(),
  });
  localStorage.setItem('interliga_motorista_historico', JSON.stringify(historico.slice(0, 100)));

  if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
    fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), { status: 'finalizada' }).catch(() => {});
  }

  state.corridaAtual = null;
  state.corridaAtualId = null;
  pararEscutaChat();
  pararEscutaCancelamento();
  pararEscutaRota();
  pararBroadcastPosicao();
  marcadorMotoristaMap = null;
  sequenciaRotaMotorista = [];
  indiceRotaAtualMotorista = 0;

  showToast('✅ Corrida finalizada! +R$ ' + Number(corrida.preco || 18).toFixed(2).replace('.', ','));
  if (state.online) iniciarDisponibilidade(); // volta a ficar disponível pra novas ofertas
  go('screen-home');
  atualizarStatsHome();
}

// ─────────────────────────────────────
// CHAT — motorista ↔ passageiro
// ─────────────────────────────────────
function iniciarChatMotorista() {
  document.getElementById('chat-panel-driver').hidden = false;
  if (!firebaseReady || !db || !state.corridaAtualId) return;
  if (state.chatListenerUnsub) return;

  const q = fb.query(
    fb.collection(db, 'corridas', state.corridaAtualId, 'mensagens'),
    fb.orderBy('ts', 'asc'), fb.limit(50)
  );
  state.chatListenerUnsub = fb.onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const msg = change.doc.data();
        if (msg.de !== 'motorista') {
          if (msg.tipo === 'audio') {
            renderChatMessageMotorista(null, 'them', msg.audioData);
          } else {
            renderChatMessageMotorista(msg.texto, 'them');
          }
        }
      }
    });
  });
}

function pararEscutaChat() {
  if (state.chatListenerUnsub) { state.chatListenerUnsub(); state.chatListenerUnsub = null; }
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

function renderChatMessageMotorista(texto, tipo, audioDataUrl = null) {
  const container = document.getElementById('chat-messages-driver');
  if (!container) return;
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
  if (tipo === 'them') tocarSomNotificacaoChat();
}

async function enviarMsgChatMotorista(texto, isSystem = false) {
  if (!texto.trim()) return;
  renderChatMessageMotorista(texto, isSystem ? 'sys' : 'me');
  if (firebaseReady && db && state.corridaAtualId) {
    try {
      await fb.addDoc(fb.collection(db, 'corridas', state.corridaAtualId, 'mensagens'), {
        texto, de: isSystem ? 'sistema' : 'motorista', ts: fb.serverTimestamp(),
      });
    } catch (e) { console.warn('Erro ao enviar mensagem:', e); }
  }
}

async function enviarAudioChatMotorista(audioDataUrl) {
  renderChatMessageMotorista(null, 'me', audioDataUrl);
  if (firebaseReady && db && state.corridaAtualId) {
    try {
      await fb.addDoc(fb.collection(db, 'corridas', state.corridaAtualId, 'mensagens'), {
        tipo: 'audio', audioData: audioDataUrl, de: 'motorista', ts: fb.serverTimestamp(),
      });
    } catch (e) { console.warn('Erro ao enviar áudio:', e); }
  }
}

document.getElementById('btn-send-chat-driver')?.addEventListener('click', () => {
  const input = document.getElementById('chat-input-driver');
  enviarMsgChatMotorista(input.value);
  input.value = '';
});
document.getElementById('chat-input-driver')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-send-chat-driver').click();
});

document.getElementById('btn-chat-driver')?.addEventListener('click', () => {
  document.getElementById('chat-panel-driver').hidden = false;
  document.getElementById('chat-input-driver')?.focus();
});

// ─────────────────────────────────────
// MENSAGEM DE VOZ NO CHAT (gravação pelo microfone)
// ─────────────────────────────────────
function blobParaBase64Motorista(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

let gravadorAudioChatMotorista = null;
let pedacosAudioChatMotorista = [];
let gravandoAudioChatMotorista = false;
let timeoutGravacaoChatMotorista = null;

async function alternarGravacaoAudioChatMotorista() {
  const btnMic = document.getElementById('btn-mic-chat-driver');
  if (gravandoAudioChatMotorista) {
    gravadorAudioChatMotorista?.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    gravadorAudioChatMotorista = new MediaRecorder(stream);
    pedacosAudioChatMotorista = [];
    gravadorAudioChatMotorista.ondataavailable = (e) => pedacosAudioChatMotorista.push(e.data);
    gravadorAudioChatMotorista.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearTimeout(timeoutGravacaoChatMotorista);
      gravandoAudioChatMotorista = false;
      btnMic?.classList.remove('is-recording');
      const blob = new Blob(pedacosAudioChatMotorista, { type: 'audio/webm' });
      if (blob.size > 0) {
        const base64 = await blobParaBase64Motorista(blob);
        enviarAudioChatMotorista(base64);
      }
    };
    gravadorAudioChatMotorista.start();
    gravandoAudioChatMotorista = true;
    btnMic?.classList.add('is-recording');
    showToast('🎙️ Gravando... toque de novo para enviar');
    clearTimeout(timeoutGravacaoChatMotorista);
    timeoutGravacaoChatMotorista = setTimeout(() => { if (gravandoAudioChatMotorista) gravadorAudioChatMotorista?.stop(); }, 30000);
  } catch (e) {
    showToast('⚠️ Não foi possível acessar o microfone');
  }
}

document.getElementById('btn-mic-chat-driver')?.addEventListener('click', alternarGravacaoAudioChatMotorista);

// Número do bot Interliga (Railway/Baileys) — faz a ponte anônima entre motorista e passageiro
const BOT_NUMERO = '5571981899571';

document.getElementById('btn-call-passenger')?.addEventListener('click', () => {
  const corridaInfo = state.corridaAtualId || 'atual';
  const msg = encodeURIComponent(
    `📞 [Interliga] Motorista solicita ligação · Corrida #${corridaInfo}\nPor favor ligue para o motorista via bot.`
  );
  window.open('https://wa.me/' + BOT_NUMERO + '?text=' + msg, '_blank');
  showToast('📞 Solicitação enviada — passageiro vai ligar via bot');
});

// ─────────────────────────────────────
// GANHOS — histórico
// ─────────────────────────────────────
function renderHistoricoGanhos() {
  const historico = JSON.parse(localStorage.getItem('interliga_motorista_historico') || '[]');
  const total = historico.reduce((acc, c) => acc + c.valor, 0);
  document.getElementById('earnings-total').textContent = 'R$ ' + total.toFixed(2).replace('.', ',');

  const listEl = document.getElementById('earnings-list');
  if (!listEl) return;
  if (historico.length === 0) return; // mantém o empty-state do HTML

  listEl.innerHTML = historico.map(c => `
    <div class="trip-card">
      <div class="trip-card-top">
        <span>${new Date(c.data).toLocaleDateString('pt-BR')}</span>
        <span class="trip-card-price">R$ ${c.valor.toFixed(2).replace('.', ',')}</span>
      </div>
      <div class="trip-card-route">${c.origem} → ${c.destino}</div>
    </div>
  `).join('');
}

document.querySelector('[data-go="screen-earnings"]')?.addEventListener('click', renderHistoricoGanhos);

// ─────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────
function boot() {
  initFirebase();
  setTimeout(() => {
    go('screen-home');
  }, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
