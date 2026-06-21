// ═══════════════════════════════════════
// INTERLIGA — Interfood
// food.js — lógica isolada do módulo de comida
// ═══════════════════════════════════════

import { go, showToast, attachAddressAutocomplete } from './app.js';

// ─────────────────────────────────────
// ⚠️ DADOS DE EXEMPLO — remover/editar pelo painel admin quando estiver pronto
// Para remover um restaurante: delete o objeto correspondente do array RESTAURANTES_EXEMPLO
// ─────────────────────────────────────
const RESTAURANTES_EXEMPLO = [
  {
    id: 'rest-1',
    nome: 'Sabor da Ilha',
    categoria: 'Brasileira',
    avaliacao: 4.8,
    tempoEntrega: '25-35 min',
    taxaEntrega: 5.00,
    tipoEntrega: 'interliga', // 'interliga' ou 'propria'
    emoji: '🍛',
    cardapio: {
      'Pratos principais': [
        { id: 'item-1', nome: 'Moqueca de peixe', desc: 'Peixe fresco, leite de coco, dendê', preco: 38.00, emoji: '🐟' },
        { id: 'item-2', nome: 'Bobó de camarão', desc: 'Camarão, mandioca, dendê', preco: 42.00, emoji: '🍤' },
        { id: 'item-3', nome: 'Feijoada completa', desc: 'Acompanha arroz, farofa e couve', preco: 32.00, emoji: '🍲' },
      ],
      'Bebidas': [
        { id: 'item-4', nome: 'Suco de cajá 500ml', desc: 'Natural, gelado', preco: 8.00, emoji: '🥤' },
        { id: 'item-5', nome: 'Refrigerante lata', desc: 'Coca-Cola, Guaraná ou Sprite', preco: 6.00, emoji: '🥤' },
      ],
    },
  },
  {
    id: 'rest-2',
    nome: 'Burger House MD',
    categoria: 'Hambúrgueres',
    avaliacao: 4.6,
    tempoEntrega: '20-30 min',
    taxaEntrega: 4.50,
    tipoEntrega: 'propria',
    emoji: '🍔',
    cardapio: {
      'Lanches': [
        { id: 'item-6', nome: 'X-Burgão Especial', desc: 'Pão brioche, smash 180g, cheddar, bacon', preco: 28.90, emoji: '🍔' },
        { id: 'item-7', nome: 'Combo Família', desc: '2 burgers + 2 batatas + 2 refrigerantes', preco: 54.90, emoji: '🍟' },
      ],
      'Acompanhamentos': [
        { id: 'item-8', nome: 'Batata frita grande', desc: 'Crocante, porção 400g', preco: 14.00, emoji: '🍟' },
        { id: 'item-9', nome: 'Onion rings', desc: 'Porção com molho especial', preco: 16.00, emoji: '🧅' },
      ],
    },
  },
  {
    id: 'rest-3',
    nome: 'Pizzaria Bella Madre',
    categoria: 'Pizza',
    avaliacao: 4.7,
    tempoEntrega: '30-45 min',
    taxaEntrega: 6.00,
    tipoEntrega: 'interliga',
    emoji: '🍕',
    cardapio: {
      'Pizzas salgadas': [
        { id: 'item-10', nome: 'Margherita', desc: 'Molho de tomate, mussarela, manjericão', preco: 45.00, emoji: '🍕' },
        { id: 'item-11', nome: 'Pepperoni', desc: 'Mussarela e pepperoni generoso', preco: 48.00, emoji: '🍕' },
        { id: 'item-12', nome: 'Quatro queijos', desc: 'Mussarela, provolone, parmesão, gorgonzola', preco: 52.00, emoji: '🍕' },
      ],
      'Pizzas doces': [
        { id: 'item-13', nome: 'Chocolate com morango', desc: 'Chocolate ao leite e morangos frescos', preco: 38.00, emoji: '🍓' },
      ],
    },
  },
];
// ─────────────────────────────────────
// FIM DOS DADOS DE EXEMPLO
// ─────────────────────────────────────

const foodState = {
  restauranteAtual: null,
  carrinho: [], // { itemId, nome, preco, qtd }
  enderecoEntrega: null,
};

// ─────────────────────────────────────
// LISTA DE RESTAURANTES
// ─────────────────────────────────────
function renderRestaurantList() {
  const listEl = document.getElementById('restaurant-list');
  if (!listEl) return;

  listEl.innerHTML = RESTAURANTES_EXEMPLO.map(r => `
    <button class="restaurant-card" data-restaurant-id="${r.id}">
      <div class="restaurant-card-emoji">${r.emoji}</div>
      <div class="restaurant-card-info">
        <div class="restaurant-card-name">${r.nome}</div>
        <div class="restaurant-card-meta">⭐ ${r.avaliacao} · ${r.categoria} · ${r.tempoEntrega}</div>
        <div class="restaurant-card-fee">Entrega R$ ${r.taxaEntrega.toFixed(2).replace('.', ',')}</div>
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
// CARDÁPIO DO RESTAURANTE
// ─────────────────────────────────────
function abrirRestaurante(restauranteId) {
  const restaurante = RESTAURANTES_EXEMPLO.find(r => r.id === restauranteId);
  if (!restaurante) return;

  foodState.restauranteAtual = restaurante;
  // Trocar de restaurante limpa o carrinho anterior
  if (foodState.carrinho.length && foodState.carrinho[0]?._restauranteId !== restauranteId) {
    foodState.carrinho = [];
  }

  document.getElementById('menu-restaurant-name').textContent = restaurante.nome;
  document.getElementById('menu-restaurant-meta').textContent =
    `⭐ ${restaurante.avaliacao} · ${restaurante.tempoEntrega} · Entrega R$ ${restaurante.taxaEntrega.toFixed(2).replace('.', ',')}`;

  renderMenuItems(restaurante);
  atualizarCartBar();
  go('screen-food-menu');
}

function renderMenuItems(restaurante) {
  const container = document.getElementById('menu-items');
  if (!container) return;

  let html = '';
  for (const [categoria, itens] of Object.entries(restaurante.cardapio)) {
    html += `<div class="section-label">${categoria.toUpperCase()}</div>`;
    html += itens.map(item => `
      <div class="menu-item">
        <div class="menu-item-emoji">${item.emoji}</div>
        <div class="menu-item-info">
          <div class="menu-item-name">${item.nome}</div>
          <div class="menu-item-desc">${item.desc}</div>
          <div class="menu-item-price">R$ ${item.preco.toFixed(2).replace('.', ',')}</div>
        </div>
        <button class="menu-item-add" data-add-item="${item.id}">+</button>
      </div>
    `).join('');
  }
  container.innerHTML = html;
}

document.getElementById('menu-items')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add-item]');
  if (!btn) return;
  adicionarAoCarrinho(btn.dataset.addItem);
});

function adicionarAoCarrinho(itemId) {
  const restaurante = foodState.restauranteAtual;
  if (!restaurante) return;

  let itemEncontrado = null;
  for (const itens of Object.values(restaurante.cardapio)) {
    const found = itens.find(i => i.id === itemId);
    if (found) { itemEncontrado = found; break; }
  }
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

  // Conectar autocomplete de endereço (só uma vez)
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

function confirmarPedidoFood() {
  const restaurante = foodState.restauranteAtual;
  const pedidoId = 'PED-' + Date.now().toString().slice(-6);

  const subtotal = foodState.carrinho.reduce((acc, c) => acc + c.preco * c.qtd, 0);
  const total = subtotal + (restaurante?.taxaEntrega || 0);

  // Salvar histórico local
  const historico = JSON.parse(localStorage.getItem('interliga_pedidos_food') || '[]');
  historico.unshift({
    id: pedidoId,
    restaurante: restaurante?.nome,
    itens: [...foodState.carrinho],
    total,
    endereco: foodState.enderecoEntrega,
    tipoEntrega: restaurante?.tipoEntrega,
    data: new Date().toISOString(),
  });
  localStorage.setItem('interliga_pedidos_food', JSON.stringify(historico.slice(0, 50)));

  // Marcar como pedido ativo (pra mostrar banner na home)
  localStorage.setItem('interliga_pedido_ativo', JSON.stringify({
    id: pedidoId, restaurante: restaurante?.nome, status: 'confirmado',
  }));
  atualizarBannerPedidoAtivo();

  // Renderizar tela de acompanhamento
  document.getElementById('food-tracking-title').textContent = 'Pedido confirmado!';
  document.getElementById('food-tracking-sub').textContent = restaurante?.nome || '';

  const itemsContainer = document.getElementById('food-order-items');
  itemsContainer.innerHTML = foodState.carrinho.map(c => `
    <div class="cart-summary-row"><span>${c.qtd}x ${c.nome}</span><span>R$ ${(c.preco*c.qtd).toFixed(2).replace('.', ',')}</span></div>
  `).join('');
  document.getElementById('food-order-total').textContent = 'R$ ' + total.toFixed(2).replace('.', ',');

  // Resetar progresso visual
  document.querySelectorAll('.food-progress-step').forEach(s => s.classList.remove('is-active', 'is-done'));
  document.querySelector('[data-step="confirmado"]').classList.add('is-active');
  document.getElementById('food-delivery-card').hidden = true;

  showToast('✅ Pedido ' + pedidoId + ' confirmado!');
  go('screen-food-tracking');

  // Limpar carrinho
  foodState.carrinho = [];
  atualizarCartBar();

  simularProgressoPedido(restaurante, pedidoId);
}

// ─────────────────────────────────────
// SIMULAÇÃO DE PROGRESSO DO PEDIDO (demo — sem backend real ainda)
// ─────────────────────────────────────
function simularProgressoPedido(restaurante, pedidoId) {
  const etapas = [
    { step: 'preparando', titulo: '👨‍🍳 Preparando seu pedido', tempo: 8000 },
    { step: 'entrega', titulo: '🛵 Saiu para entrega', tempo: 16000 },
    { step: 'entregue', titulo: '🏠 Pedido entregue!', tempo: 26000 },
  ];

  etapas.forEach(etapa => {
    setTimeout(() => {
      const stepEl = document.querySelector(`[data-step="${etapa.step}"]`);
      if (!stepEl) return;
      document.querySelectorAll('.food-progress-step').forEach(s => {
        if (s === stepEl) { s.classList.add('is-active'); }
        else if (s.dataset.step !== 'confirmado') { /* mantém estado */ }
      });
      // Marcar anteriores como concluídos
      let marking = true;
      document.querySelectorAll('.food-progress-step').forEach(s => {
        if (marking) s.classList.add('is-done');
        if (s === stepEl) marking = false;
      });
      stepEl.classList.add('is-active');

      document.getElementById('food-tracking-title').textContent = etapa.titulo;

      // Atualizar status no localStorage (e remover banner quando entregue)
      // — só se o pedido ativo agora ainda for este mesmo pedido (evita timer antigo
      // sobrescrever um pedido mais novo, se o usuário fizer outro pedido rapidamente)
      const pedidoAtivo = JSON.parse(localStorage.getItem('interliga_pedido_ativo') || 'null');
      if (pedidoAtivo && pedidoAtivo.id === pedidoId) {
        if (etapa.step === 'entregue') {
          localStorage.removeItem('interliga_pedido_ativo');
        } else {
          pedidoAtivo.status = etapa.step;
          localStorage.setItem('interliga_pedido_ativo', JSON.stringify(pedidoAtivo));
        }
        atualizarBannerPedidoAtivo();
      }

      if (etapa.step === 'entrega') {
        const card = document.getElementById('food-delivery-card');
        card.hidden = false;
        const nomeEntregador = restaurante?.tipoEntrega === 'interliga' ? 'Marcos R. (Interliga)' : 'Entregador da loja';
        document.getElementById('food-delivery-avatar').textContent = nomeEntregador.slice(0,2).toUpperCase();
        document.getElementById('food-delivery-name').textContent = nomeEntregador;
        document.getElementById('food-delivery-detail').textContent = '🛵 A caminho';
      }
      if (etapa.step === 'entregue') {
        showToast('🏠 Seu pedido foi entregue!');
      }
    }, etapa.tempo);
  });
}

document.getElementById('btn-call-delivery')?.addEventListener('click', () => {
  showToast('📞 Solicitação de ligação enviada ao entregador');
});

// ─────────────────────────────────────
// BANNER DE PEDIDO ATIVO NA HOME
// ─────────────────────────────────────
const STATUS_LABELS = {
  confirmado: 'Pedido confirmado',
  preparando: 'Preparando seu pedido',
  entrega: 'Saiu para entrega',
};

function atualizarBannerPedidoAtivo() {
  const banner = document.getElementById('active-order-banner');
  if (!banner) return;
  const pedidoAtivo = JSON.parse(localStorage.getItem('interliga_pedido_ativo') || 'null');

  if (!pedidoAtivo) { banner.hidden = true; return; }

  banner.hidden = false;
  const subEl = document.getElementById('active-order-sub');
  if (subEl) subEl.textContent = `${pedidoAtivo.restaurante} · ${STATUS_LABELS[pedidoAtivo.status] || ''}`;
}

// Expor para app.js chamar dentro de onEnterHome (mesma técnica usada para renderRestaurantList)
window.atualizarBannerPedidoAtivo = atualizarBannerPedidoAtivo;

// ─────────────────────────────────────
// Nota: renderRestaurantList é exposta no window porque app.js precisa
// chamá-la ao entrar em screen-food-list, sem criar import circular entre os módulos
// ─────────────────────────────────────
window.renderRestaurantList = renderRestaurantList;
