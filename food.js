// ═══════════════════════════════════════
// INTERLIGA — Interfood
// food.js — lógica isolada do módulo de comida, integrado ao Firebase
// ═══════════════════════════════════════

import { go, showToast, attachAddressAutocomplete } from './app.js';

const foodState = {
  restauranteAtual: null,
  cardapioAtual: null,
  carrinho: [],
  enderecoEntrega: null,
  enderecoSelecionado: null,
};

let restaurantesCache = [];
let restaurantesCarregados = false;
let pedidoAtivoListenerUnsub = null;

// ─────────────────────────────────────
// LISTA DE RESTAURANTES — carregada do Firebase (cadastrados pelo admin)
// ─────────────────────────────────────
async function carregarRestaurantes() {
  if (!window.firebaseReady || !window.db) return;
  const listEl = document.getElementById('restaurant-list');
  if (listEl) listEl.innerHTML = '<div style="text-align:center;color:var(--text-soft);padding:20px;">Carregando restaurantes...</div>';
  try {
    const fb = window.fb;
    const snap = await fb.getDocs(fb.query(fb.collection(window.db, 'restaurantes_food'), fb.where('ativo', '==', true)));
    restaurantesCache = [];
    snap.forEach(d => restaurantesCache.push({ id: d.id, ...d.data() }));
    restaurantesCarregados = true;
    renderRestaurantList();
  } catch (e) {
    console.warn('[food] erro ao carregar restaurantes:', e);
    if (listEl) listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🍽️</div><div class="empty-title">Erro ao carregar</div><div class="empty-sub">Verifique sua internet e tente de novo</div></div>';
  }
}

function renderRestaurantList() {
  const listEl = document.getElementById('restaurant-list');
  if (!listEl) return;

  if (restaurantesCache.length === 0) {
    listEl.innerHTML = restaurantesCarregados
      ? '<div class="empty-state"><div class="empty-icon">🍽️</div><div class="empty-title">Nenhum restaurante disponível</div><div class="empty-sub">Ainda não há comerciantes cadastrados na sua região</div></div>'
      : '<div style="text-align:center;color:var(--text-soft);padding:20px;">Carregando restaurantes...</div>';
    return;
  }

  listEl.innerHTML = restaurantesCache.map(r => `
    <button class="restaurant-card" data-restaurant-id="${r.id}">
      <div class="restaurant-card-emoji">${r.emoji || '🍽️'}</div>
      <div class="restaurant-card-info">
        <div class="restaurant-card-name">${r.nome}</div>
        <div class="restaurant-card-meta">⭐ ${r.avaliacao || '5.0'} · ${r.categoria || ''} · ${r.tempoEntrega || ''}</div>
        <div class="restaurant-card-fee">Entrega R$ ${Number(r.taxaEntrega || 0).toFixed(2).replace('.', ',')}</div>
      </div>
    </button>
  `).join('');
}

document.getElementById('restaurant-list')?.addEventListener('click', (e) => {
  const card = e.target.closest('[data-restaurant-id]');
  if (!card) return;
  abrirRestaurante(card.dataset.restaurantId);
});

// ─────────────────────────────────────
// CARDÁPIO DO RESTAURANTE — carregado do Firebase (subcoleção 'cardapio')
// ─────────────────────────────────────
async function abrirRestaurante(restauranteId) {
  const restaurante = restaurantesCache.find(r => r.id === restauranteId);
  if (!restaurante) return;

  foodState.restauranteAtual = restaurante;
  if (foodState.carrinho.length && foodState.carrinho[0]?._restauranteId !== restauranteId) {
    foodState.carrinho = [];
  }

  document.getElementById('menu-restaurant-name').textContent = restaurante.nome;
  document.getElementById('menu-restaurant-meta').textContent =
    `⭐ ${restaurante.avaliacao || '5.0'} · ${restaurante.tempoEntrega || ''} · Entrega R$ ${Number(restaurante.taxaEntrega || 0).toFixed(2).replace('.', ',')}`;

  const container = document.getElementById('menu-items');
  if (container) container.innerHTML = '<div style="text-align:center;color:var(--text-soft);padding:20px;">Carregando cardápio...</div>';
  go('screen-food-menu');
  atualizarCartBar();

  try {
    const fb = window.fb;
    const snap = await fb.getDocs(fb.collection(window.db, 'restaurantes_food', restauranteId, 'cardapio'));
    const itens = [];
    snap.forEach(d => itens.push({ id: d.id, ...d.data() }));
    foodState.cardapioAtual = itens;
    renderMenuItems(itens);
  } catch (e) {
    console.warn('[food] erro ao carregar cardápio:', e);
    if (container) container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Erro ao carregar cardápio</div></div>';
  }
}

function renderMenuItems(itens) {
  const container = document.getElementById('menu-items');
  if (!container) return;

  if (itens.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🍽️</div><div class="empty-title">Cardápio ainda vazio</div></div>';
    return;
  }

  const secoes = new Map();
  itens.forEach(item => {
    const secao = item.secao || 'Cardápio';
    if (!secoes.has(secao)) secoes.set(secao, []);
    secoes.get(secao).push(item);
  });

  let html = '';
  secoes.forEach((itensDaSecao, secao) => {
    html += `<div class="section-label">${secao.toUpperCase()}</div>`;
    html += itensDaSecao.map(item => `
      <div class="menu-item">
        <div class="menu-item-emoji">${item.emoji || '🍴'}</div>
        <div class="menu-item-info">
          <div class="menu-item-name">${item.nome}</div>
          <div class="menu-item-desc">${item.desc || ''}</div>
          <div class="menu-item-price">R$ ${Number(item.preco).toFixed(2).replace('.', ',')}</div>
        </div>
        <button class="menu-item-add" data-add-item="${item.id}">+</button>
      </div>
    `).join('');
  });
  container.innerHTML = html;
}

document.getElementById('menu-items')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add-item]');
  if (!btn) return;
  adicionarAoCarrinho(btn.dataset.addItem);
});

function adicionarAoCarrinho(itemId) {
  const restaurante = foodState.restauranteAtual;
  if (!restaurante || !foodState.cardapioAtual) return;

  const itemEncontrado = foodState.cardapioAtual.find(i => i.id === itemId);
  if (!itemEncontrado) return;

  const existente = foodState.carrinho.find(c => c.itemId === itemId);
  if (existente) {
    existente.qtd++;
  } else {
    foodState.carrinho.push({
      itemId, nome: itemEncontrado.nome, preco: itemEncontrado.preco, qtd: 1,
      _restauranteId: restaurante.id,
    });
  }

  showToast('🛒 ' + itemEncontrado.nome + ' adicionado!');
  atualizarCartBar();
}

function atualizarCartBar() {
  const bar = document.getElementById('food-cart-bar');
  if (!bar) return;
  const totalItens = foodState.carrinho.reduce((acc, c) => acc + c.qtd, 0);
  const totalValor = foodState.carrinho.reduce((acc, c) => acc + c.preco * c.qtd, 0);

  if (totalItens === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  document.getElementById('cart-count').textContent = totalItens;
  document.getElementById('cart-total').textContent = 'R$ ' + totalValor.toFixed(2).replace('.', ',');
}

document.getElementById('food-cart-bar')?.addEventListener('click', () => {
  renderCartScreen();
  go('screen-food-cart');
});

// ─────────────────────────────────────
// CARRINHO / CHECKOUT
// ─────────────────────────────────────
function renderCartScreen() {
  const container = document.getElementById('cart-items-list');
  if (!container) return;

  if (foodState.carrinho.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🛒</div><div class="empty-title">Carrinho vazio</div></div>';
  } else {
    container.innerHTML = foodState.carrinho.map(c => `
      <div class="cart-line-item">
        <div class="cart-line-qty">${c.qtd}x</div>
        <div class="cart-line-name">${c.nome}</div>
        <div class="cart-line-price">R$ ${(c.preco * c.qtd).toFixed(2).replace('.', ',')}</div>
        <button class="cart-line-remove" data-remove-item="${c.itemId}">✕</button>
      </div>
    `).join('');
  }

  const enderecoInput = document.getElementById('food-endereco');
  if (enderecoInput && !enderecoInput._wired) {
    attachAddressAutocomplete(enderecoInput, (r) => { foodState.enderecoSelecionado = r; });
    enderecoInput._wired = true;
  }

  atualizarResumoCarrinho();
}

document.getElementById('cart-items-list')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-item]');
  if (!btn) return;
  foodState.carrinho = foodState.carrinho.filter(c => c.itemId !== btn.dataset.removeItem);
  renderCartScreen();
  atualizarCartBar();
});

function atualizarResumoCarrinho() {
  const subtotal = foodState.carrinho.reduce((acc, c) => acc + c.preco * c.qtd, 0);
  const taxaEntrega = foodState.restauranteAtual?.taxaEntrega || 0;
  const total = subtotal + taxaEntrega;

  document.getElementById('cart-subtotal').textContent = 'R$ ' + subtotal.toFixed(2).replace('.', ',');
  document.getElementById('cart-delivery-fee').textContent = 'R$ ' + taxaEntrega.toFixed(2).replace('.', ',');
  document.getElementById('cart-grand-total').textContent = 'R$ ' + total.toFixed(2).replace('.', ',');
}

document.getElementById('btn-confirmar-pedido-food')?.addEventListener('click', () => {
  const enderecoInput = document.getElementById('food-endereco');
  if (!enderecoInput.value.trim()) {
    showToast('⚠️ Informe o endereço de entrega');
    enderecoInput.focus();
    return;
  }
  if (foodState.carrinho.length === 0) {
    showToast('⚠️ Seu carrinho está vazio');
    return;
  }

  foodState.enderecoEntrega = enderecoInput.value.trim();
  confirmarPedidoFood();
});

// ─────────────────────────────────────
// CONFIRMAR PEDIDO — grava de verdade no Firebase
// ─────────────────────────────────────
async function confirmarPedidoFood() {
  const restaurante = foodState.restauranteAtual;
  const subtotal = foodState.carrinho.reduce((acc, c) => acc + c.preco * c.qtd, 0);
  const total = subtotal + (restaurante?.taxaEntrega || 0);

  const btn = document.getElementById('btn-confirmar-pedido-food');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando pedido...'; }

  if (!window.firebaseReady || !window.db) {
    showToast('⚠️ Sem conexão com o servidor — tenta de novo em alguns segundos');
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar pedido'; }
    return;
  }

  try {
    const fb = window.fb;
    const novoPedidoRef = await fb.addDoc(fb.collection(window.db, 'pedidos_food'), {
      passageiroId: window.meuPassageiroId || null,
      passageiroNome: localStorage.getItem('interliga_pax_nome') || 'Cliente',
      restauranteId: restaurante.id,
      restauranteNome: restaurante.nome,
      tipoEntrega: restaurante.tipoEntrega || 'interliga',
      itens: foodState.carrinho.map(c => ({ itemId: c.itemId, nome: c.nome, preco: c.preco, qtd: c.qtd })),
      subtotal, taxaEntrega: restaurante.taxaEntrega || 0, total,
      endereco: foodState.enderecoEntrega,
      enderecoLat: foodState.enderecoSelecionado?.lat || null,
      enderecoLon: foodState.enderecoSelecionado?.lon || null,
      cidade: restaurante.cidade || 'madre',
      status: 'confirmado',
      criadoEm: fb.serverTimestamp(),
    });

    const pedidoId = novoPedidoRef.id;
    localStorage.setItem('interliga_pedido_ativo_id', pedidoId);

    document.getElementById('food-tracking-title').textContent = 'Pedido confirmado!';
    document.getElementById('food-tracking-sub').textContent = restaurante?.nome || '';

    const itemsContainer = document.getElementById('food-order-items');
    itemsContainer.innerHTML = foodState.carrinho.map(c => `
      <div class="cart-summary-row"><span>${c.qtd}x ${c.nome}</span><span>R$ ${(c.preco*c.qtd).toFixed(2).replace('.', ',')}</span></div>
    `).join('');
    document.getElementById('food-order-total').textContent = 'R$ ' + total.toFixed(2).replace('.', ',');

    document.querySelectorAll('.food-progress-step').forEach(s => s.classList.remove('is-active', 'is-done'));
    document.querySelector('[data-step="confirmado"]').classList.add('is-active');
    document.getElementById('food-delivery-card').hidden = true;

    showToast('✅ Pedido enviado pro restaurante!');
    go('screen-food-tracking');

    foodState.carrinho = [];
    atualizarCartBar();

    escutarPedidoAtivo(pedidoId);
  } catch (e) {
    console.error('[food] erro ao confirmar pedido:', e);
    showToast('⚠️ Erro ao enviar pedido — tenta de novo');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar pedido'; }
  }
}

// ─────────────────────────────────────
// ACOMPANHAMENTO EM TEMPO REAL — escuta o status real que o restaurante/admin atualiza
// ─────────────────────────────────────
const ETAPAS_ORDEM = ['confirmado', 'preparando', 'entrega', 'entregue'];

function escutarPedidoAtivo(pedidoId) {
  if (!window.firebaseReady || !window.db) return;
  if (pedidoAtivoListenerUnsub) { pedidoAtivoListenerUnsub(); pedidoAtivoListenerUnsub = null; }

  const fb = window.fb;
  pedidoAtivoListenerUnsub = fb.onSnapshot(fb.doc(window.db, 'pedidos_food', pedidoId), (snap) => {
    if (!snap.exists()) return;
    const pedido = snap.data();
    aplicarStatusPedido(pedido);
    atualizarBannerPedidoAtivo();
  }, (erro) => {
    console.warn('[food] erro no listener do pedido:', erro);
  });
}

function aplicarStatusPedido(pedido) {
  const status = pedido.status;
  const indiceAtual = ETAPAS_ORDEM.indexOf(status);

  if (status === 'cancelado') {
    document.getElementById('food-tracking-title').textContent = '🚫 Pedido cancelado';
    document.getElementById('food-tracking-sub').textContent = pedido.restauranteNome || '';
    localStorage.removeItem('interliga_pedido_ativo_id');
    if (pedidoAtivoListenerUnsub) { pedidoAtivoListenerUnsub(); pedidoAtivoListenerUnsub = null; }
    showToast('🚫 Seu pedido foi cancelado');
    return;
  }

  const titulos = {
    confirmado: '✅ Pedido confirmado',
    preparando: '👨‍🍳 Preparando seu pedido',
    entrega: '🛵 Saiu para entrega',
    entregue: '🏠 Pedido entregue!',
  };
  document.getElementById('food-tracking-title').textContent = titulos[status] || '';
  document.getElementById('food-tracking-sub').textContent = pedido.restauranteNome || '';

  document.querySelectorAll('.food-progress-step').forEach((stepEl, i) => {
    stepEl.classList.toggle('is-done', i < indiceAtual);
    stepEl.classList.toggle('is-active', i === indiceAtual);
  });

  if (status === 'entrega') {
    const card = document.getElementById('food-delivery-card');
    card.hidden = false;
    const nomeEntregador = pedido.tipoEntrega === 'interliga' ? 'Entregador Interliga' : 'Entregador da loja';
    document.getElementById('food-delivery-avatar').textContent = nomeEntregador.slice(0, 2).toUpperCase();
    document.getElementById('food-delivery-name').textContent = nomeEntregador;
    document.getElementById('food-delivery-detail').textContent = '🛵 A caminho';
  }

  if (status === 'entregue') {
    localStorage.removeItem('interliga_pedido_ativo_id');
    if (pedidoAtivoListenerUnsub) { pedidoAtivoListenerUnsub(); pedidoAtivoListenerUnsub = null; }
    showToast('🏠 Seu pedido foi entregue!');
  }
}

document.getElementById('btn-call-delivery')?.addEventListener('click', () => {
  showToast('📞 Solicitação de ligação enviada ao entregador');
});

// ─────────────────────────────────────
// BANNER DE PEDIDO ATIVO NA HOME — checa se tem pedido em andamento salvo
// ─────────────────────────────────────
const STATUS_LABELS = {
  confirmado: 'Pedido confirmado',
  preparando: 'Preparando seu pedido',
  entrega: 'Saiu para entrega',
};

let bannerPedidoCache = null;

async function atualizarBannerPedidoAtivo() {
  const banner = document.getElementById('active-order-banner');
  if (!banner) return;

  const pedidoId = localStorage.getItem('interliga_pedido_ativo_id');
  if (!pedidoId) { banner.hidden = true; return; }

  if (bannerPedidoCache && bannerPedidoCache.id === pedidoId) {
    aplicarBannerComDados(banner, bannerPedidoCache.dados);
    return;
  }

  if (!window.firebaseReady || !window.db) { banner.hidden = true; return; }
  try {
    const fb = window.fb;
    const snap = await fb.getDoc(fb.doc(window.db, 'pedidos_food', pedidoId));
    if (!snap.exists() || ['entregue', 'cancelado'].includes(snap.data().status)) {
      localStorage.removeItem('interliga_pedido_ativo_id');
      banner.hidden = true;
      return;
    }
    bannerPedidoCache = { id: pedidoId, dados: snap.data() };
    aplicarBannerComDados(banner, snap.data());
    escutarPedidoAtivo(pedidoId);
  } catch (e) {
    banner.hidden = true;
  }
}

function aplicarBannerComDados(banner, pedido) {
  banner.hidden = false;
  const subEl = document.getElementById('active-order-sub');
  if (subEl) subEl.textContent = `${pedido.restauranteNome} · ${STATUS_LABELS[pedido.status] || ''}`;
}

window.atualizarBannerPedidoAtivo = atualizarBannerPedidoAtivo;

window.renderRestaurantList = () => {
  if (!restaurantesCarregados) carregarRestaurantes();
  else renderRestaurantList();
};
