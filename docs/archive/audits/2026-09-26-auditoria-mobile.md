# Auditoria de uso no celular — Vela e Portal (2026-09-26)

- **Data:** 2026-09-26
- **Commit base:** `8b568c2e`
- **Método:** app real contra o stack local de auditoria (Postgres 16 +
  `scripts/design-audit/bootstrap.sql` + migrations da cadeia ativa +
  `supabase/seeds/validation_seed.sql` + `scripts/design-audit/seed_audit.sql` +
  `sb-shim.cjs`), build de produção servido localmente, navegado por Playwright
  em **390×844 com toque emulado** (`isMobile`, `hasTouch`) e conferido em
  1440×900. Login `auditor@local.test` (Administrativo). Portal verificado pelas
  telas públicas (`/portal/login`, `/portal/esqueci-senha`) e pela Inspeção do
  Portal (`/clientes/portal/inspecao/102`, Painel, Faturas, BLs e Containers,
  Perfil).
- **Escopo:** todas as rotas internas com `AppLayout` e o Portal, com foco em
  menus, abas, modais, campos e alvos de toque.

Artefatos do ambiente, não do produto: o login do Portal passa por Turnstile e
Edge Function, que o shim não emula — o Portal autenticado foi visto pela
Inspeção, que usa o mesmo `PortalLayout` e as mesmas páginas; o shim precisou
de um proxy local de CORS; câmbio PTAX bloqueado.

## Medição antes × depois

Medições em todas as 27 rotas internas visitadas (**Runtime**):

| Medida | Antes | Depois |
|---|---|---|
| Rolagem horizontal da página | nenhuma rota | nenhuma rota |
| Altura do topo (faixa + cabeçalho + barra do menu) | ~160px | ~109px, dos quais a faixa de avisos sai ao rolar |
| Campos com fonte < 16px (zoom automático no iPhone) | até 17 por tela (Containers) | 0 |
| Faixas de abas | 2–3 linhas de botões (Demurrage, Admin, Relatórios) | 1 linha de 46px com rolagem lateral |
| Checkboxes de seleção | 13×13px | 20×20px |

## Corrigido

| # | Problema | Eixo | Correção |
|---|---|---|---|
| 1 | O botão **Menu** ocupava uma barra própria abaixo do cabeçalho, somando ~60px fixos no topo de toda tela. | Conversão | Menu no cabeçalho (Vela e Portal), via `useMobileNav`. |
| 2 | No menu aberto, **Painel, Viagens, Clientes, Alertas e Relatórios** apareciam alinhados à direita e os grupos (Importação, Exportação, Financeiro) à esquerda. | Entendimento | Rótulos à esquerda; contagem e seta à direita. |
| 3 | Menu aberto não rolava por conta própria nem fechava com Escape; a página rolava por baixo. | Conversão | Lista com rolagem interna, trava da página, Escape em duas etapas (grupo, depois menu) com foco de volta no botão. |
| 4 | Cartões do **Demurrage** em três colunas fixas cortavam o valor: `Total USD` mostrava "US$ 1.20" em vez de "US$ 1.200,00". | Confiança | Uma coluna no celular (`sm:grid-cols-3`); o mesmo no formulário de **Tarifas de Demurrage**. |
| 5 | O painel do **sino de notificações** abria 124px para fora da tela, pela esquerda. | Conversão | No celular o painel ocupa a largura do cabeçalho. |
| 6 | A faixa **"demurrages vencidos"** ficava nítida por cima do fundo desfocado de qualquer modal (z-index 400 contra 300). | Entendimento | Faixa abaixo da camada de modal. |
| 7 | O diálogo **Dispensar alerta temporariamente** (Alertas) usava `z-50` e abria atrás do cabeçalho fixo. | Conversão | Mesma camada e fundo dos demais modais. |
| 8 | Modais passavam da altura visível (`100vh` ignora a barra do navegador móvel) e o **rodapé de botões** parava 18–24px acima do fundo, com o conteúdo rolando visível por baixo de "Voltar"/"Confirmar" — também no desktop. | Conversão | `dvh`, modal como folha no rodapé abaixo de 640px e rodapé que desconta o recuo do corpo (`--app-modal-pad`). |
| 9 | Campos com 13–14px faziam o iPhone dar zoom na página ao focar e não desfazer. | Conversão | 16px com ponteiro de toque. |
| 10 | Abas quebravam em várias linhas e empurravam o conteúdo. | Entendimento | Uma linha com rolagem; a aba ativa é trazida para a vista. |
| 11 | Alvos de toque pequenos: seletor **Modalidade** dos BLs (24px), checkboxes (13px), botões só com ícone (22px), "Linha do tempo" da viagem (20px), "Abrir tela de resolução" em Regras de alerta (16px), aviso de demurrage na faixa (17px). | Conversão | 40–44px no toque. |
| 12 | Ações do cabeçalho da página ora à direita, ora à esquerda (Clientes, Containers). | Entendimento | Sempre à esquerda no celular, junto do título. |
| 13 | Login do Portal: a nota "Acesso provisionado…" não tinha estilo (`app-auth__meta` sem regra) e saía maior que o formulário, colada em "Esqueci minha senha". | Entendimento | Nota em 12px, centralizada, espaçada; links com área de toque. |

Efeito colateral verificado: abaixo de 480px a regra genérica de recuo do
modal sobrescrevia o recuo próprio do **modal de escala** (a sobreposição de
2px registrada na auditoria de 2026-08-25). Com o recuo em variável, o modal de
escala mantém 16px e fundo 0, e o rodapé encosta nas bordas em 390px e 1440px.

Regressão evitada durante o trabalho: o Portal compartilha as classes do shell;
ao remover a barra do menu no Vela, o botão do Portal ficou colado na borda
esquerda até receber o mesmo tratamento (item 1).

## Evidência

- **Runtime:** medições acima e capturas das rotas, do menu aberto, do sino,
  dos modais Nova Viagem e Importar B/L, do Demurrage e do Portal, em
  390×844 com toque; conferência em 1440×900 de que o desktop mantém menu
  horizontal, abas com quebra e sino ancorado.
- **Teste:** `src/components/layout/__tests__/AppLayout.behavior.test.tsx`
  (Menu no cabeçalho, trava de rolagem, Escape em duas etapas e foco);
  `src/lib/__tests__/tabStrip.test.ts` (aba ativa trazida para a vista).

## Não verificado

- Safari real em iPhone e Chrome real em Android: o toque foi emulado no
  Chromium do Playwright; o zoom automático do Safari é conhecido, não
  observado aqui (**Suspeita** de comportamento idêntico, baseada no limite
  de 16px amplamente conhecido do Safari móvel).
- Portal autenticado pelo login real (Turnstile/Edge Function).
- Tabelas largas continuam com rolagem lateral dentro do cartão
  (`.app-table-scroll`); não foram convertidas em cartões nesta rodada.
