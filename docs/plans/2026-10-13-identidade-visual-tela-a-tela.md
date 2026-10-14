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
- **Passada única em 2026-10-13** (ver a seção própria): tabela padrão,
  identificador sem sublinhado, vazio discreto, copiar identificador e ação
  como botão em todas as telas. Os lotes seguem só para a organização.
- **Próximo:** lote 1 (BLs, ficha da Viagem, ficha do Cliente, Taxas Locais
  e Faturas do Portal). As cinco propostas
  foram apresentadas em 2026-10-13 numa página só ("Lote 1 da identidade",
  republicada na conta do responsável e atualizada com as decisões abaixo) e
  aguardam a resposta do responsável, tela a tela: aprovado, ajustar ou
  recusado. Decisões pedidas:
  - **Lista de BLs** (aprovada em 2026-10-13, com as decisões abaixo):
    tabela sem faixa de grupos, com as colunas B/L, Cliente, Navio, Viagem,
    Trecho, Carga, CE Mercante e Taxas locais (só a situação; a coluna Fatura
    sai). Saem os cartões "Pendentes de revisão", "Prontos para faturar" e
    "Sem faturamento"; o resumo do recorte vira seis cartões de total (B/Ls,
    Contêineres, Volume, Carga solta, Taxas pendentes e Isentos), que
    acompanham os filtros. Carga solta aparece mesmo zerado. Taxas pendentes
    e Isentos filtram a lista ao toque; os outros só mostram o total.
    Cada pendência aparece uma vez só, na coluna em que se resolve: sai o
    "Revisão pendente" sob o número do B/L; B/L sem Cliente mostra, na coluna
    Cliente, o nome declarado no manifesto em cinza e "Sem cliente vinculado"
    (regra 5; "falta vincular" foi recusado por sugerir Cliente já cadastrado).
    A coluna Taxas locais mostra só três estados: **Pendente** (qualquer
    impeditivo à emissão da fatura de Taxas Locais ao Cliente; o motivo se
    trata na Revisão manual), **Emitida** (a fatura foi emitida) e
    **Isenta** (em cinza; o B/L nunca terá essa fatura). Os
    estados técnicos do cálculo (não calculado, revisão, calculado, pronto
    para faturar) não aparecem na lista; o cartão volta a "Taxas pendentes"
    e conta os Pendentes. Sai a coluna de botões no fim da linha: "Ver
    carga" passa à coluna Carga (o próprio "2 CNTR" abre a carga embaixo da
    linha); o menu ⋮ sai, Excluir fica só na seleção em lote e "Copiar
    número do B/L" vira um ícone ao lado do número, visível ao passar o
    mouse na linha ou ao receber o foco do teclado. O mesmo ícone vale para
    o CE Mercante e o CNPJ, em todas as telas: vira peça compartilhada
    (`CopyValue` em `src/components/ui`), que substitui as cópias feitas à
    mão em `Bls.tsx`, `BlDetalhe.tsx`, `ClienteFicha.tsx` e `Clientes.tsx`;
    na ficha do Cliente, "Copiar CNPJ" sai do menu. A carga aberta na linha
    ganha resumo (contêineres, COC/SOC, peso, CBM, devolvidos) e o atalho
    "Abrir na ficha do B/L"; a tabela de dentro usa cabeçalho claro (exceção
    à regra do cabeçalho azul-marinho, só para tabela dentro de tabela) e as
    colunas Contêiner (com copiar), Tipo, COC/SOC, Perfil, Lacre, Tara, Peso
    bruto, CBM, Descarga, Devolução e Demurrage. A RPC `operational_list_bls`
    já devolve a linha inteira de `bl_containers`; o tipo `BLListItem` é que
    precisa incluir `ownership`, `return_date` e `demurrage_status` (fora de
    `src/types/database.ts`, que é protegido). Carga solta mostra Máquinas,
    Packages, Peso e CBM como dados soltos, a tabela de itens quando houver e
    uma frase só quando não houver dado. Filtros sempre abertos: Busca, Viagem, POL e POD; Revisão,
    Faturamento, Taxas locais e Perfil de carga em "Mais filtros". Ao
    implementar, a regra 3 passa a dizer que os cartões aparecem quando a
    tela precisa deles.
  - **Regra de negócio, fora da mudança visual** (achado de 2026-10-13, por
    leitura do código): o cálculo das Taxas Locais roda sozinho e não depende
    do Cliente. Um B/L só fica "não calculado" se o cálculo falhar na
    importação e a nova tentativa também falhar, ou se a tabela encontrada
    não tiver cobrança que se aplique a ele; nesse segundo caso o resultado
    é zero cobranças sem aviso, e o bloqueio da fatura diz "Nenhuma tabela",
    o que está errado. Os B/Ls de teste COSU6401234505, 509 e 510 estão
    "não calculado" só porque `scripts/design-audit/seed_audit.sql` os cria
    assim.
  - **Ficha da Viagem** (aprovada em 2026-10-13): a tabela de atracações, dentro do Planejamento por
    escala, passa ao cabeçalho claro (regra de tabela dentro de tabela,
    decidida na lista de BLs). O bloco Contêineres inclui os vazios a
    descarregar, com os tipos (manifesto de Vazios de Importação, via
    `useVaziosImportacaoStats`). O Planejamento por escala, recusado na
    primeira proposta por confuso, fica na forma A: tabela com uma linha de
    cabeçalho e sem grupos; cada escala e cada atracação tem o seu botão
    Editar, com Omitir e Excluir dentro da edição;  uma seta no começo da linha,
    antes do porto, abre as atracações (escolhida entre seta, linhas sempre
    à mostra e atracações só dentro de Editar); as atracações abrem embaixo, em tabela de
    cabeçalho claro. Sem faixa de próxima ação (recusada pelo responsável);
    os Manifestos Mercante a informar seguem em âmbar no bloco Conciliação.
    Nenhum texto técnico na Linha do tempo: o evento de
    `pod_schedule_snapshot` (cópia interna da situação das escalas, que
    repete o "CE atualizado" do mesmo instante) sai, e campo da viagem sem
    rótulo em `TIMELINE_VOYAGE_FIELD_LABELS` (`src/services/voyageSummaries.ts`)
    nunca mostra o nome técnico nem o valor bruto. A ficha do B/L mantém a sua.
  - **Ficha do Cliente:** sem faixa de próxima ação, como na Viagem; a
    pendência fica no bloco do assunto (Portal sem conta no bloco Portal, com
    o motivo e os dois caminhos como botões). Na Atividade recente, só o
    identificador é link, sem sublinhado. Com mais de uma pendência, cada
    uma fica no bloco do seu assunto (Portal no bloco Portal, Demurrage no
    bloco Saldo pendente). A ficha do B/L mantém a faixa de próxima ação
    (`NextAction`); a recusa vale só para a Viagem e o Cliente.
  - **Taxas Locais:** "Aguardando envio automático" e fatura cancelada em
    cinza?
  - **Faturas do Portal:** o que escrever no lugar do vencimento, que a taxa
    local não tem (ADR 0055)? Botão "Copiar código Pix" (ação nova)? O cartão
    Saldo pendente mostra R$ 0,00 com a FAT-2026-0018 em aberto: conferir se é
    a retenção pela Conta de Portal não ativa ou defeito (regra de dado, à
    parte).

## Passada única (2026-10-13)

Decidida pelo responsável em 2026-10-13 (nota na ADR 0081): o que vale igual
em qualquer tela foi aplicado de uma vez, em todo o Vela e o Portal, na PR
[#940](https://github.com/luccafwlog/vela/pull/940), sem esperar os lotes:

1. Tabela padrão em toda `.app-table` (centralizada; texto longo à esquerda
   com `.app-table__text`/`.app-table__text-head`, ou quando a célula já usa
   `.app-table__truncate`/`.app-table__cell-stack`).
2. Identificador sem sublinhado em repouso, em todas as famílias; sublinha ao
   passar o mouse ou com o foco.
3. Cabeçalho claro em tabela dentro de tabela (`tr[data-row-detail]`, tabela
   dentro de `.app-table` e `app-table--nested`).
4. Dado vazio com `NoValue` no lugar de "-", "—" ou texto vazio.
5. `CopyValue` em número do B/L, CE Mercante, CNPJ e número do contêiner; as
   ações "Copiar …" de menu que ficaram redundantes saíram.
6. Ação escrita como texto sublinhado ou só-ícone em linha de tabela virou
   botão com nome (Editar, Omitir, Excluir…). Menus ⋮, setas de abrir linha,
   ordenação e paginação ficaram como estão.

Fora da passada: documentos impressos (faturas, recibos, ADR) e qualquer
reorganização de tela (faixa de identidade, blocos, dado principal, colunas,
cartões), que segue pelos lotes abaixo.

## Lotes

Cada lote passa pela página de aprovação (captura de hoje, proposta, o que
muda) e é implementado depois de aprovado. Com a passada única feita, os
lotes tratam só da organização de cada tela.

| Lote | Telas (ordem da tabela "Telas") | Estado |
|---|---|---|
| 1 | Lista de BLs (2), ficha da Viagem (3), ficha do Cliente (5, com as seis abas), Taxas Locais · Faturas (7), Portal · Faturas (10) | Em aprovação: BLs e Viagem aprovadas; Cliente com a Visão geral decidida e as outras cinco abas por propor; Taxas Locais e Portal · Faturas por discutir |
| 2 | Operação do dia a dia: Revisão (6), Chegadas e Saídas e programação do Portal (4), Demurrage (8), Containers, Veículos e Baplie (14); listas de Viagens e de Clientes | Proposto em 2026-10-13, a confirmar |
| 3 | Financeiro: detalhe da fatura de Taxas Locais e tabelas de taxas (7), Conciliação PIX (9), Desbloqueio de CE interno (15) | Proposto, a confirmar |
| 4 | Restante do Portal: PIX, consolidada e disputa (10), B/Ls e Containers (11), Painel, Central de Informações, Desbloqueio de CE e Perfil (12) | Proposto, a confirmar |
| 5 | Apoio e administração: Painel e Alertas (13), Provisionamento, Comunicação e Modo Inspeção (16), Granito, Vazios e depots (17), Relatórios e Administração (18) | Proposto, a confirmar |
| 6 | Peças comuns e entrada: modais de importação (19), documentos impressos (20), Login, acesso e perfil (21) | Proposto, a confirmar |

O lote 2 vem logo depois do 1 por ser onde a operação passa mais tempo; o 6
fica por último porque essas telas mudam pouco além da passada única.

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

Desde a passada única (abaixo), identificador que abre o registro não é
sublinhado em repouso em nenhuma família; link no meio de frase
(`.billing-demurrage-notice a`, `.app-import-templates a`, login) continua
sublinhado.

Decisão de negócio encontrada no caminho (cálculo, regra, RPC) é registrada à
parte e não entra na mudança visual. As pendências não visuais anotadas no
plano arquivado continuam válidas e são conferidas quando a tela dona entrar.

## Telas

| Ordem | Tela | Rotas | Pontos já conhecidos | Estado |
|---|---|---|---|---|
| 1 | Ficha do B/L | `/bls/:blId` | Visão geral numa caixa só com filetes; "Resolver na Revisão", "Definir exceção" e "Ver itens da carga" como texto (regra 9) | Entregue em 2026-10-13 (aba Visão geral, faixa, próxima ação e trilhos; as demais abas herdam a base) |
| 2 | Lista de BLs | `/bls` | Cartões que filtram, faixa de resumo, linha com duas ações | Aprovada em 2026-10-13 (lote 1), aguardando implementação |
| 3 | Ficha da Viagem e Viagens | `/viagens`, `/viagens/:voyageId` | Ficha restaurada em 2026-10-08 com faixa azul-marinho; conferir contra as regras | Ficha aprovada em 2026-10-13 (lote 1), aguardando implementação |
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
| 2026-10-13 | Passada única (todas as telas) | `53ba959`, `b52938c`, `a058389`, `d67a88e`, `cbe47ab` e o commit desta entrada; `claude/trusting-cerf-bkwctp` | Os seis itens da seção "Passada única" em cerca de 90 arquivos do Vela e do Portal; `MetricCard` passou a aceitar `NoValue`. **Teste:** `typecheck`, `lint`, `npm test` (749 arquivos, 4.634 testes; 82 de integração pulados sem banco), `build`, `size-limit` (Vela 249,51 KiB de 250; Portal 208,58 KiB), `a11y:contrast`, `design:check`, `docs:check`. **Runtime:** Postgres 16 local com `validation_seed` e `seed_audit`, a 1440 px: `/bls`, `/bls/COSU6401234501`, `/viagens/10`, `/clientes/12345678000190`, `/taxas-locais`, `/demurrage`, `/containers`, `/veiculos`, `/baplie`, `/revisao`, sem erro de console nem rolagem lateral; Containers, Veículos e Baplie corrigidos depois da captura (colunas empilhadas voltaram à esquerda). **Não verificado:** Portal em runtime, tema escuro, 768 e 360 px. **Ficou de fora:** traço "-" em texto montado (navio / viagem, POL → POD, datas de escala vindas de `voyageCardHelpers` e `ShipScheduleWidget`), copiar em prévias de importação e dentro de botões, colunas de lista de motivos (ficam centralizadas para não cortar). |
| 2026-10-13 | Regra 9 (identificador sem sublinhado) | `2adc40c`; `claude/trusting-cerf-bkwctp` | Pedido do responsável: número do B/L, nome do Cliente e navio só na cor de link, com sublinhado ao passar o mouse ou com foco. `.app-identity a` ajustado (azul claro sobre o azul-marinho); as demais famílias ficam listadas acima para a migração de cada tela. |
| 2026-10-13 | Revisão da PR 940 e exceção da regra 6 | `f550b14`; `claude/trusting-cerf-bkwctp` | Revisão independente em quatro áreas; achados corrigidos (ver CHANGELOG). Comparando lado a lado a Fila de Alertas com a mensagem cortada em "…" e com quebra de linha, o responsável escolheu manter a exceção: texto corrido que é o próprio conteúdo da linha e não aparece inteiro em outro lugar (mensagem do alerta, observação, descrição de item, nome da taxa, notas do acordo) quebra linha com `.app-table__text--wrap`; nomes seguem com "…" e `title`. **Teste:** `typecheck`, `lint`, `npm test` (4.635 testes), `build`, `size-limit` (Vela 249,51 KiB), `a11y:contrast`, `design:check`, `docs:check`; CI verde em `8bae617`. **Evidência:** alinhamento cabeçalho × célula medido no Chromium em 35 telas do Vela com banco local; Portal e larguras menores não observados. |
