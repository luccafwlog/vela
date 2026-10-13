# Identidade visual — migração tela a tela

Data: 2026-10-13. Decisão: [ADR 0081](../adr/0081-identidade-visual-unica.md).
Regras e peças: [identidade visual](../identidade-visual.md).

## Estado

- **Base entregue em 2026-10-13** (branch `claude/trusting-cerf-bkwctp`):
  tokens (fundo neutro liso, neutros frios, títulos em DM Sans, Syne só no
  nome "Vela"), tema FWLOG do Portal, botão `ghost` com borda, peças comuns
  (`Block`, `LeadValue`, `FactList`, `IdentityBand`, `NextAction`, `NoValue`,
  grupos de colunas), `npm run design:check` com linha de base e
  `a11y:contrast` no CI. Nenhuma tela foi reorganizada.
- **Ficha do B/L entregue em 2026-10-13** (tela 1), a partir do exemplo
  aprovado na página da identidade. Ver o registro abaixo.
- **Próximo:** lote 1 (BLs, ficha da Viagem, ficha do Cliente, Taxas Locais
  e Faturas do Portal). As cinco propostas
  foram apresentadas em 2026-10-13 numa página só ("Lote 1 da identidade",
  republicada na conta do responsável e atualizada com as decisões abaixo) e
  aguardam a resposta do responsável, tela a tela: aprovado, ajustar ou
  recusado. Decisões pedidas:
  - **Lista de BLs** (em revisão com o responsável; decidido em 2026-10-13):
    tabela sem faixa de grupos, com as colunas B/L, Cliente, Navio, Viagem,
    Trecho, Carga, CE Mercante e Taxas locais (só a situação; a coluna Fatura
    sai). Saem os cartões "Pendentes de revisão", "Prontos para faturar" e
    "Sem faturamento"; o resumo do recorte vira seis cartões de total (B/Ls,
    Contêineres, Volume, Carga solta, Taxas pendentes e Isentos), que
    acompanham os filtros. Carga solta aparece mesmo zerado. Taxas pendentes
    e Isentos filtram a lista ao toque; os outros só mostram o total. Ao implementar, a regra 3 passa a dizer
    que os cartões aparecem quando a tela precisa deles. Falta decidir quais
    filtros ficam sempre abertos (proposta: Busca, Viagem, POL e POD).
  - **Ficha da Viagem:** qual é a próxima ação da viagem (proposta: Manifestos
    Mercante a informar; alternativa: escala sem ETA) e qual vem primeiro
    quando houver mais de uma? Manter por ora o texto técnico do evento
    "Dados da viagem alterados"?
  - **Ficha do Cliente:** com mais de uma pendência, a mais urgente vai para a
    próxima ação e as outras para um bloco Pendências?
  - **Taxas Locais:** "Aguardando envio automático" e fatura cancelada em
    cinza?
  - **Faturas do Portal:** o que escrever no lugar do vencimento, que a taxa
    local não tem (ADR 0055)? Botão "Copiar código Pix" (ação nova)? O cartão
    Saldo pendente mostra R$ 0,00 com a FAT-2026-0018 em aberto: conferir se é
    a retenção pela Conta de Portal não ativa ou defeito (regra de dado, à
    parte).

## Como cada tela passa

1. Capturar a tela de hoje no ambiente local com dados sintéticos
   (procedimento em [setup/development.md](../setup/development.md) e no
   [registro da campanha anterior](../archive/plans/2026-10-07-revisao-visual-ux-prompts.md#ambiente-local-para-evidência-macos)).
2. Montar a proposta com as peças comuns, sobre os mesmos dados, e listar o
   que muda na organização e o que não muda (dados, abas, ações).
3. O responsável aprova ou ajusta. Só então implementar.
4. Implementar no dono da tela, sem CSS novo de página; apagar o CSS da família
   da tela que deixou de ser usado; rodar `npm run design:check -- --update` e
   conferir que a linha de base caiu.
5. Validar com os gates do [AGENTS.md](../../AGENTS.md), capturas depois em
   1440, 768 e 360 px e registrar abaixo.

Desde 2026-10-13 (nota na ADR 0081), identificador que abre o registro não é
sublinhado em repouso. Ao migrar cada tela, tirar o sublinhado das famílias que
ainda o têm: `.app-invoices__number`, `.app-invoices__bl`,
`.app-invoice-detail__link`, `.app-invoice-comm__link`, `.app-fin-link`,
`.app-fin-alerts__link`, `.app-dem-link`, `.app-pix-link`,
`.app-voyage-shortcut`, `.app-schedule-vessel-link`, `.billing-demurrage-notice a`,
`.app-import-templates a` e o pontilhado do Line-Up.

Decisão de negócio encontrada no caminho (cálculo, regra, RPC) é registrada à
parte e não entra na mudança visual. As pendências não visuais anotadas no
plano arquivado continuam válidas e são conferidas quando a tela dona entrar.

## Telas

| Ordem | Tela | Rotas | Pontos já conhecidos | Estado |
|---|---|---|---|---|
| 1 | Ficha do B/L | `/bls/:blId` | Visão geral numa caixa só com filetes; "Resolver na Revisão", "Definir exceção" e "Ver itens da carga" como texto (regra 9) | Entregue em 2026-10-13 (aba Visão geral, faixa, próxima ação e trilhos; as demais abas herdam a base) |
| 2 | Lista de BLs | `/bls` | Cartões que filtram, faixa de resumo, linha com duas ações | Proposta no lote 1, aguardando resposta |
| 3 | Ficha da Viagem e Viagens | `/viagens`, `/viagens/:voyageId` | Ficha restaurada em 2026-10-08 com faixa azul-marinho; conferir contra as regras | Proposta da ficha no lote 1, aguardando resposta |
| 4 | Chegadas e Saídas e programação do Portal | `/chegadas-saidas`, Painel do Portal | "X" em toda célula, grupos ETD/ETA sem separação. Decidir: Chegada no Brasil antes da Saída; esconder porto sem data; previsão de saída já passada em cinza | Pendente |
| 5 | Ficha do Cliente e Clientes | `/clientes`, `/clientes/:cnpj` | `.app-customer-*` é a maior família de CSS de página | Proposta da ficha no lote 1, aguardando resposta |
| 6 | Revisão | `/revisao` | `review-link-button` como ação em texto (regra 9) | Pendente |
| 7 | Taxas Locais e detalhe da fatura | `/taxas-locais`, `/taxas-locais/tabelas` | `app-invoice-comm__link`, `app-fin-alerts__link` | Proposta da lista de Faturas no lote 1, aguardando resposta |
| 8 | Demurrage | `/demurrage`, `/demurrage/taxas` | `app-dem-link` (número da Invoice é identificador; conferir as ações) | Pendente |
| 9 | Conciliação PIX | `/reconciliacao` | `app-pix-link` | Pendente |
| 10 | Portal: Faturas, PIX, consolidada e disputa | `/portal/billing` e inspeção | Pix abaixo dos itens no detalhe; saldo pendente diverge entre telas (regra de dado, à parte) | Proposta de Faturas no lote 1, aguardando resposta |
| 11 | Portal: B/Ls e Containers | `/portal/operacao` e inspeção | | Pendente |
| 12 | Portal: Painel, Central de Informações, Desbloqueio de CE, Perfil | `/portal`, `/portal/informacoes`, `/portal/desbloqueio-ce`, `/portal/perfil` | | Pendente |
| 13 | Painel, Alertas | `/painel`, `/alertas`, `/alertas/regras` | | Pendente |
| 14 | Containers, Veículos, Baplie | `/containers`, `/veiculos`, `/baplie` | | Pendente |
| 15 | Desbloqueio de CE interno | `/desbloqueio-ce` | | Pendente |
| 16 | Provisionamento, Comunicação, Modo Inspeção | `/clientes/portal`, `/clientes/comunicacao`, faixa de inspeção | | Pendente |
| 17 | Granito, Vazios, depots | `/granito`, `/vazios-importacao`, `/embarquevazios` | `VaziosImportacaoPreview` com cores fixas do tema escuro | Pendente |
| 18 | Relatórios e Administração | `/relatorios`, `/admin/:tab` | | Pendente |
| 19 | Importações (modais comuns) | modais de importação | | Pendente |
| 20 | Documentos impressos | faturas, recibos, ADR | Marca Transhipping; só regras de impressão | Pendente |
| 21 | Login, acesso e perfil | `/login`, `/portal/login` e telas públicas | | Pendente |

O plano é concluído quando todas as linhas estiverem entregues e a linha de
base de `design:check` não tiver mais famílias de CSS de página nem violações
em TSX, ou quando o responsável encerrar formalmente o que restar.

## Registro

| Data | Tela | Base / branch | Resumo, checks e evidência |
|---|---|---|---|
| 2026-10-13 | Base da identidade | `2f06add`; `claude/trusting-cerf-bkwctp` | Ver "Estado". **Teste:** `docs:check`, `typecheck`, `lint`, `npm test` (747 arquivos, 4.622 testes; 81 arquivos de integração pulados sem banco), `build`, `size-limit` (Vela 248,95 KiB, igual à base; Portal 208,17 KiB), `a11y:contrast` (63 pares, incluindo o tema do Portal) e `design:check`. **Runtime:** capturas antes e depois em ambiente local com dados sintéticos (12 telas a 1440 px e BLs a 360 px), sem erro de console; nenhuma tela reorganizada. **Não verificado:** tema escuro e Portal fora do Modo Inspeção. |
| 2026-10-13 | Ficha do B/L | `9e55f1c`; `claude/trusting-cerf-bkwctp` | `IdentityBand`, `NextAction` com "Resolver na Revisão" como botão, trilhos em `Block`, Visão geral em cinco blocos (Embarque, Documento Mercante, Cliente; Carga com tabela de contêineres em grupos Devolução e No terminal; Portal); botões em "Definir exceção", "Ver na aba Carga", "Abrir conciliação" e "Enviar convite do Portal"; aba ativa em azul-marinho em todo o sistema; família `app-bl` de 138 para 108 regras. Refeita a partir do exemplo aprovado, porque a implementação da sessão anterior não chegou a ser enviada. Junto: `design:check` passa a contar `#RGBA` e cada parte de seletor agrupado (linha de base remedida sobre o mesmo CSS), e `LeadValue`/`Fact` mantêm detalhe 0. **Teste:** `docs:check`, `typecheck`, `lint`, `npm test` (748 arquivos, 4.627 testes; 81 de integração pulados sem banco), `build`, `size-limit` (Vela 248,93 KiB; Portal 208,16 KiB), `a11y:contrast`, `design:check`. **Runtime:** Postgres 16 local com `validation_seed` e `seed_audit`, `sb-shim` e Vite; B/Ls COSU6401234501 (normal), COSU6401234505 (sem Cliente, cadastro na largura toda) e COSU6401234509 (carga solta) a 1440, 768 e 360 px, sem rolagem lateral nem erro de console. **Não verificado:** tema escuro, B/L misto e cancelado em runtime, e as demais telas com a aba ativa nova. |
| 2026-10-13 | Regra 6 (todas as tabelas com grupos) | `ac6c354`; `claude/trusting-cerf-bkwctp` | O responsável achou pesada a faixa de 3 px entre grupos de colunas na ficha do B/L; passa a linha de 1 px clara (`--app-border-soft`). Nota na ADR 0081 e regra 6 atualizada. **Teste:** `design:check`, `docs:check`, `a11y:contrast`, testes de `src/components/ui`. **Runtime:** ficha do B/L COSU6401234501 a 1440, 768 e 360 px, sem erro de console. |
| 2026-10-13 | Tabela padrão (regra 6) | `1ba43e9`; `claude/trusting-cerf-bkwctp` | Entre quatro formatos comparados lado a lado, o responsável escolheu o centralizado (C), com texto longo à esquerda. `app-table--padrao` aplicado à tabela de contêineres da ficha do B/L; a linha vertical entre grupos saiu. As demais tabelas passam ao padrão quando a tela for migrada. |
| 2026-10-13 | Regra 9 (identificador sem sublinhado) | `2adc40c`; `claude/trusting-cerf-bkwctp` | Pedido do responsável: número do B/L, nome do Cliente e navio só na cor de link, com sublinhado ao passar o mouse ou com foco. `.app-identity a` ajustado (azul claro sobre o azul-marinho); as demais famílias ficam listadas acima para a migração de cada tela. |
