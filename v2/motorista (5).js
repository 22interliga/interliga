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
  } else {
    showToast('🔴 Você está offline');
    pararEscutaCorridas();
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
          if (change.type === 'added') {
            const corrida = { id: change.doc.id, ...change.doc.data() };
            console.log('[motorista] corrida nova detectada:', corrida);
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

function notificarNovaCorrida(corrida) {
  console.log('[motorista] Nova corrida recebida:', corrida);
  state.corridaAtual = corrida;
  state.corridaAtualId = corrida.id;

  tocarSomNovaCorrida();

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

  clearInterval(state.countdownInterval);
  state.countdownInterval = setInterval(() => {
    state.countdownSegundos--;
    if (numEl) numEl.textContent = state.countdownSegundos;
    if (fgEl) fgEl.style.strokeDashoffset = (15 - state.countdownSegundos) * (100.5 / 15);
    if (state.countdownSegundos <= 0) {
      clearInterval(state.countdownInterval);
      recusarCorrida();
      showToast('⏰ Tempo esgotado — corrida expirou');
    }
  }, 1000);
}

document.getElementById('btn-recusar')?.addEventListener('click', recusarCorrida);
function recusarCorrida() {
  clearInterval(state.countdownInterval);
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
  const corrida = state.corridaAtual;
  if (!corrida) {
    showToast('⚠️ Esta corrida já não está disponível');
    document.getElementById('request-card').hidden = true;
    document.getElementById('request-empty').hidden = false;
    document.getElementById('new-ride-banner').hidden = true;
    go('screen-home');
    return;
  }

  // Atualizar status no Firebase
  if (firebaseReady && db && state.corridaAtualId && !String(state.corridaAtualId).startsWith('local-')) {
    try {
      await fb.updateDoc(fb.doc(db, 'corridas', state.corridaAtualId), {
        status: 'aceita',
        motoristaNome: state.motorista.nome,
        motoristaVeiculo: state.motorista.veiculo,
        motoristaPlaca: state.motorista.placa,
        motoristaAvaliacao: state.motorista.avaliacao,
      });
    } catch (e) { console.warn('Erro ao aceitar corrida:', e); }
  }

  // Também atualizar localStorage (mesmo dispositivo / fallback)
  try {
    const lst = JSON.parse(localStorage.getItem('interliga_corridas') || '[]');
    const idx = lst.findIndex(c => c.id === corrida.id);
    if (idx >= 0) lst[idx].status = 'aceita';
    localStorage.setItem('interliga_corridas', JSON.stringify(lst));
  } catch (e) {}

  document.getElementById('new-ride-banner').hidden = true;
  showToast('✓ Corrida aceita! Indo ao passageiro.');
  go('screen-ongoing');
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
  const btnCheguei = document.getElementById('btn-cheguei');
  const btnFinalizar = document.getElementById('btn-finalizar-corrida');
  if (btnCheguei) btnCheguei.hidden = false;
  if (btnFinalizar) btnFinalizar.hidden = true;

  initMapOngoing(corrida);
  iniciarChatMotorista();
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
  chegouAoCliente = true;
  document.getElementById('btn-cheguei').hidden = true;
  document.getElementById('btn-finalizar-corrida').hidden = false;
  document.getElementById('ongoing-eta-badge').textContent = '🟢 Você chegou!';
  showToast('🔔 Passageiro avisado que você chegou');
  enviarMsgChatMotorista('🚗 Motorista chegou ao seu local!', true);
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

  showToast('✅ Corrida finalizada! +R$ ' + Number(corrida.preco || 18).toFixed(2).replace('.', ','));
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
          renderChatMessageMotorista(msg.texto, 'them');
        }
      }
    });
  });
}

function pararEscutaChat() {
  if (state.chatListenerUnsub) { state.chatListenerUnsub(); state.chatListenerUnsub = null; }
}

function renderChatMessageMotorista(texto, tipo) {
  const container = document.getElementById('chat-messages-driver');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${tipo}`;
  div.textContent = texto;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
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

document.getElementById('btn-call-passenger')?.addEventListener('click', () => {
  showToast('📞 Solicitação de ligação enviada ao passageiro');
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
