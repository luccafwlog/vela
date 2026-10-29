# 0112 — Repaginação da Demurrage: o que cada aba mostra e regras de cobrança

Status: aceito — 2026-10-29 (decisões do dono, D1 a D21, em rodadas de perguntas
sobre a [revisão de Demurrage de 2026-10-29](../archive/audits/2026-10-29-revisao-demurrage-telas-elegibilidade-relatorios.md),
as complementares D22 a D27 e as de tipos de container e tarifas D28 a D34 no
mesmo dia).
A implementar pelo [plano da repaginação](../plans/2026-10-29-repaginacao-da-demurrage.md);
até lá vale o comportamento descrito em [Demurrage](../modules/demurrage.md).

Estende a cobrança por caixa da [ADR 0080](./0080-decisoes-da-revisao-final-da-pr-929.md)
(D19, D22 e D23, rateio entre Clientes), a regra de datas alteradas depois da
emissão da [ADR 0079](./0079-decisoes-pendentes-da-revisao-da-pr-929.md) (D20,
container que vira SOC) e a matriz de permissões da
[ADR 0085](./0085-modelo-de-permissoes-por-perfil.md) (D24, dispensar a
cobrança de uma caixa). Mantém a [ADR 0014](./0014-demurrage-recalculo-diario-substitui-roe-congelado.md)
(Invoice de Demurrage não vence; BRL pela PTAX até o pagamento) e a
[ADR 0088](./0088-portal-so-mostra-fatura-emitida.md) (o Portal só mostra valor
de fatura emitida).

## Contexto

A revisão de 2026-10-29 mostrou que a central de Demurrage calcula e cobra
certo, mas não diz com segurança quem aparece, com que rótulo e por quanto
tempo:

- a aba Containers mistura o container correndo, o que falta emitir, o que
  espera outra caixa voltar e o que já foi cobrado, e diz "A faturar" com
  **Gerar Invoice** para B/L sem CE Mercante, sem Cliente ou cancelado, que o
  banco recusa;
- o container de tipo sem tarifa nunca entra em atraso, e o que muda de free
  time (B/L, acordo, tarifa, Cliente do B/L) só entra no job da madrugada;
- Por Cliente, os cartões e os relatórios só leem Invoices: a sobreestadia ainda
  não faturada não aparece em total nenhum;
- o B/L cancelado depois da devolução perde a cobrança sem aviso;
- a Disputa de Invoice cancelada fica aberta para sempre;
- o mesmo container em B/Ls de Clientes diferentes é cobrado cheio de cada um;
- o tipo do container vem do arquivo do B/L sem conferência e só acha tarifa se
  estiver numa lista fixa de 26 códigos. Em 2026-10-29, produção (e staging,
  com os mesmos dados) tinha 534 de 867 containers com tipo sem tarifa (48FR,
  40FM e 40FP), que nunca entrariam em atraso. A tela de tarifas mostra 12
  linhas, mas o cálculo e o Portal usam uma por grupo (6), e editar uma linha
  ignorada (40HC, 20GP, 40FR…) não muda nada.

O dono decidiu por aba, sem detalhar cada coluna, a partir de perguntas com
alternativas.

## Decisão

### Aba Containers

1. **Divisões por situação (D1).** A aba se divide em **Correndo**, **A
   emitir**, **Esperando** e **Travado**, cada uma com o número de caixas e o
   US$ previsto. Cada caixa aparece num lugar só. Não há divisão de caixas já
   cobradas.
2. **Entrada (D2).** O container entra quando passa do free time (no dia
   seguinte ao último dia livre, pelo dia de Brasília) e também na hora em que
   o free time muda: condição do B/L, acordo do Cliente, tarifa ou Cliente do
   B/L. O devolvido dentro do free time não entra.
3. **Saída (D3).** A caixa sai da aba quando a Invoice que a cobra é emitida;
   dali em diante aparece nas abas de Fatura, no detalhe da Invoice e na ficha
   do B/L. Volta para **A emitir** se essa Invoice for cancelada sem outra que
   a cubra (D10).
4. **Travado (D4).** A caixa com sobreestadia que o sistema não consegue cobrar
   (B/L sem CE Mercante, Gate de faturamento do Portal fechado, B/L sem
   Cliente, B/L cancelado, tipo de container sem tarifa) fica em **Travado**,
   com o motivo e a ação que destrava (**Cadastrar CE**, **Vincular Cliente**,
   **Cadastrar tarifa**). Abre Alerta se ficar parada.
5. **Colunas (D5).** A linha do B/L mostra B/L, Cliente, Navio / Viagem,
   Containers (fora, devolvidos e total do grupo, contando todas as caixas),
   US$ previsto hoje e **Próximo passo / motivo**. As colunas de maior atraso,
   free time, grupo, CE e datas atualizadas não entram na linha (continuam na
   linha aberta e nas fichas).
6. **Cartões do topo (D6).** **Correndo** (US$), **A emitir** (US$), **Travado**
   (US$), **Aguardando pagamento** (R$ hoje) e **Disputas aguardando resposta**,
   cada um levando à divisão ou aba dele.
7. **B/L cancelado (D7).** Cancelar o B/L é recusado enquanto houver caixa
   devolvida com sobreestadia e sem Invoice, até a Demurrage ser faturada ou a
   cobrança ser dispensada com justificativa. É a mesma lógica que já recusa o
   cancelamento com Invoice de Demurrage em aberto.

### Abas Faturas, Pagas e Canceladas

8. **Faturas (D8).** Ganham as colunas **Desconto** e **Em aberto há** (dias
   desde a emissão) e os filtros rápidos **Em disputa**, **Fora da Régua** e
   **Com desconto**, além de **Cliente** e **Navio / Viagem**.
9. **Pagas (D9).** Ganham **Meio de pagamento** (Pix Itaú, extrato, registro
   manual ou isenção por desconto integral), **ROE do pagamento** e **Dias até
   pagar**.
10. **Canceladas (D10).** As caixas da Invoice cancelada à mão voltam para **A
    emitir** e esperam, sem Invoice nova automática. A aba mostra o motivo, quem
    cancelou e o destino das caixas: reemitida na DEM-…, cobrada na DEM-…,
    aguardando nova Invoice ou dispensada. A reemissão automática por datas
    alteradas continua como está ([ADR 0079](./0079-decisoes-pendentes-da-revisao-da-pr-929.md)).

### Por Cliente e relatórios

11. **Por Cliente (D11).** Aparece todo Cliente com algo correndo, a emitir,
    travado ou faturado em aberto, com as colunas Correndo, A emitir e Travado
    (US$), Invoices em aberto e Faturado em aberto (US$ e R$ hoje).
12. **Extrato do Cliente (D12).** **Imprimir relatório** vira o extrato de um
    Cliente: as Invoices em aberto e as caixas ainda sem Invoice, com dias, free
    time e US$ previsto. É a forma de a equipe informar o Cliente do que está
    correndo; o Portal continua sem mostrar (D21).
13. **Relatórios (D13).** Três relatórios de Demurrage:
    - **Exposição** (novo): caixas sem Invoice, nas quatro divisões da aba
      Containers, com dias, free time e US$ previsto;
    - **Invoices** (o de hoje, corrigido): USD líquido do desconto, R$ em
      aberto separado do R$ pago, emissão pelo dia de Brasília, sem o filtro
      **Vencidas** e sem a situação **Rascunho**;
    - **Itens por container** (novo): cada caixa cobrada, com a Invoice, as
      datas, os dias, o free time, o 1º e o 2º período e o US$.

    O relatório de recebimentos não entra.
14. **Onde ficam (D14).** Cada aba da central ganha **Exportar** (o que está na
    tela), e a visão completa, com filtros, fica em `/relatorios`.

### Disputas

15. **Tabela (D15).** Uma linha por Disputa: Invoice, situação da Invoice,
    Cliente, valor em disputa, aberta há e de quem é a vez, com a conversa
    aberta embaixo da linha. As que aguardam a nossa resposta vêm primeiro.
    Filtros **Abertas**, **Resolvidas**, **Canceladas** e **Todas**.
    **Responder** só aparece quando a vez é nossa.
16. **Invoice cancelada (D16).** Cancelar a Invoice cancela a Disputa aberta
    junto, com aviso ao Cliente no Portal citando o motivo.
17. **Uma conversa por Invoice (D17).** Depois de resolvida, o Cliente contesta
    de novo só por **Solicitar reabertura**, que Equipamentos decide; o Portal
    não abre Disputa nova para a mesma Invoice.
18. **Prazo de resposta (D18).** 1 dia útil, pelo calendário de dias úteis do
    Vela, aguardando a nossa resposta: passado o prazo, abre Alerta para
    Equipamentos e a linha fica em âmbar.

### Regras de cobrança

19. **Caixa dividida entre Clientes (D19).** Quando o mesmo container está em
    B/Ls de Clientes diferentes na mesma Viagem, a Demurrage dele é rateada em
    partes iguais entre esses Clientes (dois Clientes, metade cada). Antes, cada
    Cliente recebia o valor cheio.
20. **Container que vira SOC depois de faturado (D20).** Segue a regra das datas
    alteradas depois da emissão: Invoice sem pagamento, desconto ou disputa é
    cancelada e reemitida sem a caixa; paga, com desconto ou em disputa fica
    fora da Régua, com Alerta para tratar à mão (restituição ou ajuste).
21. **Portal sem Demurrage antes da Invoice (D21).** O Cliente continua sem ver
    container correndo antes da Invoice ser emitida.

### Decisões complementares

22. **Caixa que passa a ser dividida depois da emissão (D22).** Quando chega o
    B/L de outro Cliente com a mesma caixa, ou o B/L de um dos Clientes é
    cancelado, a Invoice que já saiu segue a regra das datas alteradas: sem
    pagamento, desconto ou disputa, é cancelada e reemitida com a parte nova;
    paga, com desconto ou em disputa, fica fora da Régua com Alerta para
    restituir ou cobrar a diferença.
23. **Cada Cliente pela própria condição (D23).** Na caixa dividida, cada
    Cliente calcula a caixa pelo próprio free time e diárias (condição do B/L,
    acordo do Cliente ou tabela) e paga a parte igual desse valor (metade, com
    dois Clientes).
24. **Dispensar a cobrança (D24).** Qualquer Departamento dispensa a cobrança
    de Demurrage de uma caixa, com justificativa, como já aplica desconto.
25. **Alerta de Travado na hora (D25).** A caixa que entra em **Travado** abre
    Alerta na hora.
26. **Cancelar B/L com container ainda fora e em atraso (D26).** Também é
    recusado, até a devolução e a Invoice, ou a cobrança dispensada.
27. **Tipo sem tarifa entra em Travado na descarga (D27).** Sem tarifa, e sem
    free time do B/L ou do acordo, o container entra em **Travado** desde a
    descarga, com o motivo "tipo sem tarifa" e **Cadastrar tarifa**, para a
    tarifa existir antes de o free time vencer.

### Tipos de container e tarifas

28. **Uma linha por grupo de tarifa (D28).** A tela **Tarifas e acordos** mostra
    um grupo por linha (20' dry, 40' dry, 20' especial, 40' especial, 20'
    reefer, 40' reefer), com os códigos que cada um cobre, igual ao que o
    cálculo e o Portal usam. As linhas repetidas saem, e o banco recusa uma
    segunda tarifa ativa no mesmo grupo com vigência sobreposta.
29. **Os tipos são os códigos dos B/Ls (D29).** O Vela reconhece o tipo pelo
    código que vem no B/L, por um cadastro **Tipos de container** (código,
    descrição e grupo de tarifa) em **Tarifas e acordos**, no lugar da lista
    fixa no código do sistema. A importação de B/L confere o tipo contra esse
    cadastro.
30. **Os 13 códigos dos B/Ls (D30).** Grupos de partida do cadastro:
    - 20' dry: 20GP e 20HC;
    - 20' especial: 20OT;
    - 40' dry: 40HC;
    - 40' especial: 40FR, 40OT, 40FH, 40FM, 40FP, 40FW, 40EW, 48FR e 48FP.

    Os sete códigos que não tinham tarifa (40FH, 40FM, 40FP, 40FW, 40EW, 48FR
    e 48FP) cobram como 40FR e 40OT.
31. **45 pés e equipamentos especiais (D31).** Container de 45 pés, tanque,
    ventilado, granel e qualquer outro equipamento novo ganha grupo próprio, com
    tarifa cadastrada. Até lá, fica em **Travado** (D27).
32. **Código fora do cadastro (D32).** A prévia da importação do B/L avisa
    "tipo … sem tarifa de Demurrage", o B/L entra, e o container fica em
    **Travado** com Alerta (D25) até o código ser cadastrado.
33. **Reefer mantido (D33).** Os grupos 20' reefer e 40' reefer continuam
    cadastrados, para quando aparecer reefer nos B/Ls.
34. **Quem mantém o cadastro (D34).** Como as tarifas: qualquer Departamento
    inclui e edita; desativar e excluir, só o Administrativo.

## Alternativas rejeitadas

- **Aba Containers.** Manter a lista única com as lentes Todos / Em atraso /
  Devolvidos só corrigindo rótulos; mostrar só o que pede ação; manter uma
  divisão **Já cobradas** para consulta; fazer o container entrar alguns dias
  antes de vencer ou desde a descarga; tirar a caixa só no pagamento;
  manter o travado na mesma lista com aviso, ou só como Alerta.
- **B/L cancelado.** Cancelar e cobrar mesmo assim; cancelar e perder a
  cobrança só com registro.
- **Faturas.** Subdivisões fixas (Em cobrança, Em disputa, Fora da Régua) ou só
  a busca; Invoice nova automática ao cancelar; diálogo de cancelamento que
  pergunta o destino.
- **Por Cliente e relatórios.** Só faturado em aberto; faturado em aberto com
  pago no período; impressão igual à tela; relatório de recebimentos; relatórios
  só em `/relatorios` ou só dentro de `/demurrage`.
- **Disputas.** Blocos por conversa; conversa só no detalhe da Invoice; recusar
  o cancelamento da Invoice com Disputa aberta; levar a Disputa para a Invoice
  que substitui; abrir Disputa nova a cada contestação; sem prazo.
- **Cobrança.** Valor cheio para cada Cliente da caixa dividida; cobrar de um
  Cliente só; travar a caixa dividida para decidir caso a caso; rateio por peso,
  volume ou percentual informado na emissão; para o SOC faturado, só Alerta ou
  recusar a troca para SOC.
- **Portal.** Aviso sem valor ou com dias e free time dos containers correndo.
- **Complementares.** Manter cheia a Invoice que já saiu, ou travar a caixa para
  decidir à mão (D22); calcular a caixa dividida uma vez, pela tabela ou pela
  condição do B/L que emite (D23); dispensa só do Administrativo, ou do
  Financeiro e do Administrativo (D24); Alerta de Travado depois de 2 ou 5 dias
  úteis, ou sem Alerta (D25); aceitar o cancelamento do B/L com container fora,
  parando a cobrança, com ou sem aviso do valor perdido (D26); tipo sem tarifa
  entrar em Travado pelo menor free time da tabela ou só na devolução (D27).
- **Tipos e tarifas.** Manter uma linha por código cadastrado com aviso na linha
  ignorada, ou separar a tarifa por código (D28); lista fixa no código do
  sistema, ampliada ou lida pela regra ISO 6346 (D29); plataformas ou cada um
  dos sete códigos com tarifa própria (D30); 45 pés como 40 pés, ou especiais
  na tarifa de flat rack (D31); recusar o B/L com tipo fora do cadastro, ou só
  travar a cobrança sem avisar na importação (D32); tirar os grupos de reefer
  (D33); cadastro só do Administrativo, ou de Equipamentos e do Administrativo
  (D34).

## Consequências

- A aba Containers deixa de depender só do status gravado em
  `bl_containers.demurrage_status`: a classificação (divisão, motivo, grupo e
  cobertura por caixa) passa a vir do banco numa leitura própria, e o status
  passa a ser recalculado também quando muda o free time do B/L, o acordo, a
  tarifa ou o Cliente do B/L. Os cartões e o aviso do cabeçalho leem a mesma
  classificação.
- `cancel_bl` ganha um motivo de recusa para a sobreestadia sem Invoice,
  devolvida ou ainda correndo (D7, D26), e a Demurrage ganha a ação de
  dispensar a cobrança de uma caixa, com justificativa e registro (D24), que
  entra na [matriz de permissões](../operations/seguranca.md#demurrage-e-granito).
- O item da Invoice de Demurrage passa a guardar a fração da caixa cobrada do
  Cliente (D19, D23), mostrada no detalhe, no documento e no Portal, e a
  reconciliação das datas alteradas passa a tratar também a mudança do número de
  Clientes da caixa (D22).
- A troca SOC/COC de container numa Invoice viva passa pela mesma reconciliação
  das datas alteradas (D20).
- A Disputa ganha o estado **Cancelada** de fato (hoje existe e nunca é gravado)
  e um Alerta de prazo de resposta.
- O grupo de tarifa do container passa a vir do cadastro **Tipos de container**
  no banco e no navegador: saem a lista fixa `DEMURRAGE_ALIAS_GROUPS`
  (`demurrageRates.ts`) e o `CASE` de `_demurrage_canonical_type` (migration
  `138`), e `demurrage_rates` passa a ter uma tarifa por grupo e vigência. A
  limpeza das linhas repetidas depende da linha "Data status" do `AGENTS.md`.
- As regras passam a viver em [Demurrage](../modules/demurrage.md),
  [Portal do Cliente](../modules/portal-cliente.md) e
  [Operação e Suporte](../modules/operacao-suporte.md) (relatórios) à medida que
  cada lote do plano é entregue, com o
  [Manual do Operador](../manual/README.md) e a matriz de cobertura.
