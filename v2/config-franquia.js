/**
 * config-franquia.js
 *
 * "Veste a camisa" do app (passageiro OU motorista) com a marca da franquia,
 * sem tocar em nenhuma lógica de negócio (Firebase, corridas, etc.).
 * Só troca: título da aba, ícone/favicon, splash screen e cor do tema.
 *
 * COMO FUNCIONA (modelo por link, sem pastas separadas):
 * Como todos os arquivos moram juntos em /v2/, cada franquia recebe um
 * LINK diferente, com um parâmetro indicando a cidade dela:
 *
 *   interliga.app.br/v2/motorista.html?franquia=candeias
 *   interliga.app.br/v2/index.html?franquia=candeias
 *   interliga.app.br/v2/motorista.html?franquia=simoesfilho
 *
 * Esse script lê o parâmetro "franquia" da URL, procura os dados dela
 * na lista FRANQUIAS abaixo, e aplica a marca (nome, ícone, cor).
 *
 * COMO CADASTRAR UMA FRANQUIA NOVA:
 * Adiciona uma entrada nova no objeto FRANQUIAS logo abaixo, com a
 * mesma "chave" que você vai usar no link (ex: "candeias").
 *
 * COMO INTEGRAR (uma linha só em cada HTML):
 * No <head>, logo depois do <title>, adicione:
 *   <script src="config-franquia.js"></script>
 *
 * Isso não exige nenhuma mudança no motorista.js/app.js existentes.
 * Se o link não tiver "?franquia=", o app continua com a marca padrão
 * Interliga, sem nenhum erro.
 */

(function () {
  const FRANQUIAS = {
    candeias: {
      nome: "Interliga Candeias",
      corPrimaria: "#1F8CE6",
      logoUrl: "icon-512.png", // troque por um ícone próprio da franquia quando tiver
    },
    simoesfilho: {
      nome: "Interliga Simões Filho",
      corPrimaria: "#1F8CE6",
      logoUrl: "icon-512.png",
    },
    // Adicione novas franquias aqui, seguindo o mesmo padrão:
    // chaveDoLink: { nome: "...", corPrimaria: "#......", logoUrl: "..." },
  };

  const params = new URLSearchParams(window.location.search);
  const chave = params.get('franquia');
  if (!chave) return; // sem parâmetro na URL = marca padrão Interliga, não faz nada

  const cfg = FRANQUIAS[chave];
  if (!cfg) {
    console.warn('[config-franquia] franquia "' + chave + '" não encontrada — usando marca padrão.');
    return;
  }

  aplicarMarca(cfg);

  function aplicarMarca(cfg) {
    // Título da aba
    if (cfg.nome) {
      document.title = document.title.replace('Interliga', cfg.nome);
    }

    // Cor do tema (barra do navegador / status bar do celular)
    if (cfg.corPrimaria) {
      let metaTheme = document.querySelector('meta[name="theme-color"]');
      if (!metaTheme) {
        metaTheme = document.createElement('meta');
        metaTheme.name = 'theme-color';
        document.head.appendChild(metaTheme);
      }
      metaTheme.content = cfg.corPrimaria;
    }

    // Ícone / favicon / ícone da tela inicial (PWA)
    if (cfg.logoUrl) {
      document.querySelectorAll(
        'link[rel="icon"], link[rel="apple-touch-icon"]'
      ).forEach((link) => { link.href = cfg.logoUrl; });
    }

    // Splash screen: imagem grande + texto abaixo dela
    document.addEventListener('DOMContentLoaded', () => {
      if (cfg.logoUrl) {
        const splashImg = document.querySelector('.splash-icon');
        if (splashImg) splashImg.src = cfg.logoUrl;
      }
      if (cfg.nome) {
        const splashTag = document.querySelector('.splash-tag');
        if (splashTag && splashTag.textContent.includes('Interliga')) {
          splashTag.textContent = splashTag.textContent.replace('Interliga', cfg.nome);
        }
      }
    });

    // Deixa a config disponível globalmente, caso o app.js/motorista.js
    // queira usar depois (ex: mostrar nome da franquia em algum texto).
    window.CONFIG_FRANQUIA = cfg;

    console.log('✅ Marca da franquia aplicada:', cfg.nome);
  }
})();
