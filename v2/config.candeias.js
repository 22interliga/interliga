// ============================================================
// CONFIG.JS — Interliga Mobilidade
// ------------------------------------------------------------
// Este é o ÚNICO arquivo que muda de cidade para cidade.
// index.html, motorista.html e admin.html (franquia) devem
// importar este arquivo e usar as variáveis abaixo em vez de
// valores fixos no código.
//
// Como implantar uma nova franquia:
// 1. Duplique este arquivo e renomeie para config.<cidade>.js
// 2. Preencha os campos abaixo com os dados da cidade/franqueado
// 3. No <head> do index.html e motorista.html dessa pasta,
//    aponte para o config.<cidade>.js correspondente
// 4. Publique a pasta (ex: interligaapp.com.br/candeias/)
// ============================================================

const CIDADE = {

  // ---------- Identidade da franquia ----------
  nome: "Interliga Candeias",          // nome que aparece no app e no PWA instalado
  sigla: "CD",                          // 2 letras usadas em ícones/avatares simples
  cidade: "Candeias · BA",
  franqueado: "Nome do franqueado",
  logoUrl: "logo-candeias.png",         // logo em PNG, fundo transparente, mínimo 512x512
  corPrimaria: "#1F8CE6",               // pode variar por cidade; mantém azul da marca-mãe por padrão
  corSecundaria: "#0A0A0A",

  // ---------- Contato ----------
  whatsappOficial: "5571981899571",     // número que o passageiro usa pra falar com o bot dessa franquia
                                          // formato: código do país + DDD + número, só dígitos

  // ---------- Firestore ----------
  // Todas as collections dessa franquia usam este prefixo,
  // isolando os dados de cada cidade dentro do mesmo projeto Firebase.
  firestorePrefix: "candeias_",
  // Exemplos de collections resultantes:
  //   candeias_corridas
  //   candeias_motoristas
  //   candeias_passageiros
  //   candeias_repasses

  // ---------- Precificação ----------
  // Definida pelo Admin Master. O franqueado só pode ajustar
  // dentro do intervalo indicado em ajusteMaximoFranqueado.
  precificacao: {
    tarifaBase: 6.00,
    valorKm: 1.80,
    valorMinutoParado: 0.25,
    ajusteMaximoFranqueado: 0.15,       // ±15% de margem de ajuste local
    multiplicadorZona: {
      centro: 1.0,
      periferia: 1.15,
      rural: 1.30
    }
  },

  // ---------- Modelo de franquia ----------
  taxaOnboarding: 500,
  mensalidade: 150,
  percentualRepasseMaster: 0.10,        // 10% repassado ao Admin Master sobre o faturamento

  // ---------- Módulos ativos ----------
  // Liga/desliga funcionalidades por franquia sem duplicar código
  modulos: {
    corridas: true,
    food: false,     // Interifood ainda não ativo nessa cidade
    frete: false      // Frete ainda não ativo nessa cidade
  }
};

// ============================================================
// Não editar abaixo — uso interno do sistema
// ============================================================
export default CIDADE;

// Helper para montar nomes de collection já com o prefixo certo
export function colecao(nomeBase) {
  return `${CIDADE.firestorePrefix}${nomeBase}`;
}

// Helper para aplicar a identidade visual da franquia no PWA
export function aplicarIdentidadeVisual() {
  document.documentElement.style.setProperty('--azul', CIDADE.corPrimaria);
  document.documentElement.style.setProperty('--preto', CIDADE.corSecundaria);
  const tituloEls = document.querySelectorAll('[data-cidade-nome]');
  tituloEls.forEach(el => el.textContent = CIDADE.nome);
  const logoEls = document.querySelectorAll('[data-cidade-logo]');
  logoEls.forEach(el => el.src = CIDADE.logoUrl);
}
