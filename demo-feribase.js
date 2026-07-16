// ═══════════════════════════════════════════════════════════════
// INTERLIGA — DEMO FIREBASE MOCK
// Implementa a MESMA API do Firebase (Firestore + Auth) usada pelo
// app.js e motorista.js reais, mas guardando tudo no localStorage
// do navegador em vez de um servidor de verdade.
//
// Sincronização entre abas/dispositivos: usa o evento nativo
// "storage" do navegador — quando uma aba escreve no localStorage,
// as OUTRAS abas do mesmo navegador recebem esse evento automaticamente.
// (Entre dois DISPOSITIVOS diferentes, cada um tem seu próprio
// localStorage, então a demo funciona sozinha em cada aparelho —
// pra ver os dois lados reagindo um ao outro em tempo real, abra as
// duas páginas no MESMO navegador, em abas diferentes.)
// ═══════════════════════════════════════════════════════════════

const PREFIXO = 'interliga_demo_col_';

// ───────── armazenamento ─────────
function lerColecao(nome) {
  try {
    const raw = localStorage.getItem(PREFIXO + nome);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function escreverColecao(nome, lista) {
  localStorage.setItem(PREFIXO + nome, JSON.stringify(lista));
  notificarOuvintes(nome);
}

// ───────── timestamps e increment (marcadores especiais) ─────────
function ehMarcadorTimestamp(v) { return v && typeof v === 'object' && v.__ts !== undefined; }
function ehMarcadorIncrement(v) { return v && typeof v === 'object' && v.__increment !== undefined; }

function envolverTimestamps(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copia = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const k in copia) {
    if (ehMarcadorTimestamp(copia[k])) {
      const ms = copia[k].__ts;
      copia[k] = { toMillis: () => ms, toDate: () => new Date(ms), seconds: Math.floor(ms / 1000) };
    } else if (copia[k] && typeof copia[k] === 'object') {
      copia[k] = envolverTimestamps(copia[k]);
    }
  }
  return copia;
}

function aplicarIncrementos(docAtual, dadosNovos) {
  const resultado = { ...docAtual };
  for (const k in dadosNovos) {
    if (ehMarcadorIncrement(dadosNovos[k])) {
      resultado[k] = Number(docAtual?.[k] || 0) + dadosNovos[k].__increment;
    } else {
      resultado[k] = dadosNovos[k];
    }
  }
  return resultado;
}

// ───────── pub/sub de listeners (onSnapshot) ─────────
const ouvintesPorColecao = {}; // nome -> [{alvo, cb}]

function notificarOuvintes(nome) {
  (ouvintesPorColecao[nome] || []).forEach(({ alvo, cb }) => dispararSnapshot(alvo, cb));
}

// Reage a mudanças feitas em OUTRAS abas (evento nativo do navegador)
window.addEventListener('storage', (e) => {
  if (!e.key || !e.key.startsWith(PREFIXO)) return;
  const nome = e.key.slice(PREFIXO.length);
  notificarOuvintes(nome);
});

function dispararSnapshot(alvo, cb) {
  if (alvo.__doc) {
    const lista = lerColecao(alvo.nome);
    const doc = lista.find(d => d.id === alvo.id) || null;
    cb({
      exists: () => !!doc,
      data: () => (doc ? envolverTimestamps(doc) : undefined),
      id: alvo.id,
    });
  } else {
    const docs = executarQuery(alvo);
    const snap = {
      docs: docs.map(d => ({ id: d.id, data: () => envolverTimestamps(d) })),
      empty: docs.length === 0,
      size: docs.length,
      forEach: (fn) => docs.forEach(d => fn({ id: d.id, data: () => envolverTimestamps(d) })),
      docChanges: () => docs.map(d => ({ type: 'added', doc: { id: d.id, data: () => envolverTimestamps(d) } })),
    };
    cb(snap);
  }
}

function executarQuery(alvo) {
  let docs = lerColecao(alvo.nome);
  (alvo.wheres || []).forEach(w => {
    docs = docs.filter(d => {
      const valor = d[w.campo];
      if (w.op === '==') return valor === w.valor;
      if (w.op === '!=') return valor !== w.valor;
      if (w.op === '>') return valor > w.valor;
      if (w.op === '<') return valor < w.valor;
      if (w.op === '>=') return valor >= w.valor;
      if (w.op === '<=') return valor <= w.valor;
      return true;
    });
  });
  if (alvo.ordenarPor) {
    const { campo, direcao } = alvo.ordenarPor;
    docs = [...docs].sort((a, b) => {
      const av = a[campo], bv = b[campo];
      const am = av && av.__ts !== undefined ? av.__ts : av;
      const bm = bv && bv.__ts !== undefined ? bv.__ts : bv;
      return direcao === 'desc' ? (bm > am ? 1 : -1) : (am > bm ? 1 : -1);
    });
  }
  if (alvo.limite) docs = docs.slice(0, alvo.limite);
  return docs;
}

// ═══════════════════════════════════════════════
// API PÚBLICA — mesmos nomes usados no app.js/motorista.js reais
// ═══════════════════════════════════════════════

export function initializeApp(config, nome) { return { __app: true, nome }; }
export function getFirestore(app) { return { __db: true }; }

export function collection(db, nome) { return { __col: true, nome, wheres: [] }; }
export function doc(db, nome, id) {
  if (id === undefined) {
    // doc(db, 'colecao') sem id — usado às vezes só pra referenciar a coleção com auto-id (raro no código real, mas cobre o caso)
    id = 'demo-' + Math.random().toString(36).slice(2, 10);
  }
  return { __doc: true, nome, id };
}

export function query(colRef, ...clausulas) {
  const alvo = { __col: true, nome: colRef.nome, wheres: [], limite: null, ordenarPor: null };
  clausulas.forEach(c => {
    if (c.__where) alvo.wheres.push({ campo: c.campo, op: c.op, valor: c.valor });
    if (c.__limit) alvo.limite = c.valor;
    if (c.__orderBy) alvo.ordenarPor = { campo: c.campo, direcao: c.direcao };
  });
  return alvo;
}
export function where(campo, op, valor) { return { __where: true, campo, op, valor }; }
export function limit(n) { return { __limit: true, valor: n }; }
export function orderBy(campo, direcao = 'asc') { return { __orderBy: true, campo, direcao }; }

export function serverTimestamp() { return { __ts: Date.now() }; }
export function increment(n) { return { __increment: n }; }

export async function getDoc(ref) {
  const lista = lerColecao(ref.nome);
  const d = lista.find(x => x.id === ref.id);
  return {
    exists: () => !!d,
    data: () => (d ? envolverTimestamps(d) : undefined),
    id: ref.id,
  };
}

export async function getDocs(alvo) {
  const docs = executarQuery(alvo.__col ? alvo : { nome: alvo.nome, wheres: [] });
  return {
    docs: docs.map(d => ({ id: d.id, data: () => envolverTimestamps(d) })),
    empty: docs.length === 0,
    size: docs.length,
    forEach: (fn) => docs.forEach(d => fn({ id: d.id, data: () => envolverTimestamps(d) })),
  };
}

export async function addDoc(colRef, dados) {
  const lista = lerColecao(colRef.nome);
  const id = 'demo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const limpo = {};
  for (const k in dados) limpo[k] = dados[k]; // marcadores de timestamp já vêm prontos de serverTimestamp()
  lista.push({ id, ...limpo });
  escreverColecao(colRef.nome, lista);
  return { id };
}

export async function setDoc(ref, dados, opcoes = {}) {
  const lista = lerColecao(ref.nome);
  const idx = lista.findIndex(d => d.id === ref.id);
  if (idx >= 0) {
    lista[idx] = opcoes.merge ? { ...lista[idx], ...dados } : { id: ref.id, ...dados };
  } else {
    lista.push({ id: ref.id, ...dados });
  }
  escreverColecao(ref.nome, lista);
}

export async function updateDoc(ref, dados) {
  const lista = lerColecao(ref.nome);
  const idx = lista.findIndex(d => d.id === ref.id);
  if (idx >= 0) {
    lista[idx] = aplicarIncrementos(lista[idx], dados);
  } else {
    lista.push(aplicarIncrementos({ id: ref.id }, dados));
  }
  escreverColecao(ref.nome, lista);
}

export async function deleteDoc(ref) {
  const lista = lerColecao(ref.nome).filter(d => d.id !== ref.id);
  escreverColecao(ref.nome, lista);
}

export function onSnapshot(alvo, cbOuOk, cbErro) {
  const nome = alvo.nome;
  if (!ouvintesPorColecao[nome]) ouvintesPorColecao[nome] = [];
  const entrada = { alvo, cb: cbOuOk };
  ouvintesPorColecao[nome].push(entrada);
  dispararSnapshot(alvo, cbOuOk); // primeira chamada imediata, como o Firestore real faz
  return () => {
    ouvintesPorColecao[nome] = (ouvintesPorColecao[nome] || []).filter(e => e !== entrada);
  };
}

export async function runTransaction(db, fn) {
  const tx = {
    get: async (ref) => getDoc(ref),
    update: (ref, dados) => updateDoc(ref, dados),
    set: (ref, dados, opts) => setDoc(ref, dados, opts),
  };
  return fn(tx);
}

// ───────── Auth (simplificado: sempre "logado" com um usuário demo fixo) ─────────
let _callbackAuth = null;
let _usuarioAtual = null;

export function getAuth(app) { return { __auth: true }; }

function obterOuCriarUsuarioDemo() {
  if (window.__DEMO_UID_FIXO) return { uid: window.__DEMO_UID_FIXO };
  const uidSalvo = localStorage.getItem('interliga_demo_uid');
  const uid = uidSalvo || ('demo-' + Math.random().toString(36).slice(2, 10));
  localStorage.setItem('interliga_demo_uid', uid);
  return { uid };
}

export function onAuthStateChanged(auth, cb) {
  _callbackAuth = cb;
  if (!_usuarioAtual) _usuarioAtual = obterOuCriarUsuarioDemo();
  setTimeout(() => cb(_usuarioAtual), 50);
  return () => { _callbackAuth = null; };
}

export async function signInWithEmailAndPassword(auth, email, senha) {
  if (!_usuarioAtual) _usuarioAtual = obterOuCriarUsuarioDemo();
  if (_callbackAuth) setTimeout(() => _callbackAuth(_usuarioAtual), 100);
  return { user: _usuarioAtual };
}

export async function signInAnonymously(auth) {
  return signInWithEmailAndPassword(auth, null, null);
}

export async function signOut(auth) {
  _usuarioAtual = null;
  if (!window.__DEMO_UID_FIXO) localStorage.removeItem('interliga_demo_uid');
  if (_callbackAuth) setTimeout(() => _callbackAuth(null), 50);
}
