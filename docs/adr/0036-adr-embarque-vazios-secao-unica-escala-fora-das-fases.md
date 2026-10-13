# 0036 — Embarque de Vazios volta a ser uma seção só, e a Escala sai das fases do ciclo

> **Situação atual (2026-10-13).** Permanecem as seis seções, o Embarque de vazios como seção única (subseções Containers embarcados e Operação de pátio), o rótulo "Carga carregada" e a Observação sob demanda em modal.
> Não valem mais: Documentação com 3 seções e Equipamentos com 2 (Carga carregada passou a Equipamentos na migration arquivada `258`, preservada pela [spec arquivada do Bloco 524](../archive/specs/2026-08-17-bloco-524-adr-alertas-design.md)); as duas fases com a Escala fora delas
> (a aba agrupa as seções por departamento desde o redesenho de `/viagens`, [plano arquivado](../archive/plans/2026-08-26-redesenho-da-pagina-viagens.md)); e o terminal editável no ADR por terminal (vem do Cadastro de Terminais). Nenhuma ADR registra essas mudanças.
> As migrations `222`, `225` e `253` citadas abaixo são da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062.
> Regra vigente: [Viagens](../modules/viagens.md), regras do Agency Departure Report.

Status: supersedida parcialmente — 2026-08-04

## Contexto

Uma revisão de UI/UX da aba ADR (`/viagens/:voyageId?tab=adr`) em 04 ago 2026
comparou o que a aba mostra com o que o `CONTEXT.md` define. Três desencontros
não são de estilo — são de modelo, e cada um deles produz um pedido errado à
pessoa que assina.

**1. O agregado Embarque de Vazios estava partido em duas assinaturas.** O
`CONTEXT.md` define **Embarque de Vazios (EXP)** como *um por escala*, com a
identidade da escala, reunindo **duas partes**: a Lista de Unidades Embarcadas
(o fato — quais containers embarcaram) e as Linhas de Serviço do Embarque (o
custo — quais serviços foram performados sobre eles). A ADR 0029 promoveu a
segunda parte a **seção assinável própria** (`operacao_patio`, migration 222)
para dar-lhe evidência, porque estava "escondida" dentro da outra. O efeito
colateral: Equipamentos passou a dar **duas resoluções para um fato só**, e o
banco passou a exigir as duas para liberar uma única assinatura departamental.
Evidência era um problema de apresentação; resolveu-se com um corte no modelo.

**2. Vazios embarcados estava agrupado fora da sua fase.** A faixa visual
"Operação de pátio" continha a seção "Vazios embarcados", enquanto o
`CONTEXT.md` e o `AGENCY_REPORT_SECTION_ORDER` classificam vazios embarcados
como **exportação**. A faixa também repetia o nome da seção que continha — um
`h2` "OPERAÇÃO DE PÁTIO" seguido de um `h3` "Operação de pátio".

**3. A Escala era tratada como fase do ciclo.** A faixa "Escala" continha uma
seção única, também chamada "Escala" — o mesmo `h2`/`h3` homônimos. A escala não
é uma etapa do ciclo entre outras: é o **assunto** do relatório inteiro.

Dois problemas menores de cópia vinham junto: a seção `carga_carregada`
aparecia como "Granito (carga carregada)", nomeando a carga que hoje existe em
vez do que a seção é; e o impresso listava as observações prefixadas pela
**chave crua** da seção (`carga_descarregada:`) em vez do rótulo pt-BR.

## Decisão

**Embarque de Vazios é uma seção assinável só.** `operacao_patio` é aposentada
como seção; suas resoluções são fundidas em `vazios_embarcados`, rotulada
**"Embarque de vazios"**. As duas partes do agregado passam a ser **subseções de
conteúdo** dentro dela — "Containers embarcados" (as unidades) e "Operação de
pátio" (storage, embarque direto, locais, linhas de serviço e total em R$) —
com **uma resolução e uma observação** para a seção inteira. A evidência que a
0029 buscava é preservada pela subseção com título próprio; o que se desfaz é o
segundo sign-off, não a visibilidade.

**A armazenagem fica inteira na subseção de pátio.** O `CONTEXT.md` observa que
a armazenagem é o único ponto onde as duas partes se tocam (os dias derivam das
datas de gate das unidades; o custo vem das linhas de serviço). Dias e custo são
exibidos juntos, como serviço performado — não repartidos entre as subseções.

**Duas fases, com a Escala fora delas.** O ciclo fica **Importação** (carga
descarregada, vazios descarregados, veículos) → **Exportação** (carga carregada,
embarque de vazios). A seção **Escala** abre a aba sem faixa acima: ela carrega a
identidade do ADR (armador, navio/viagem, porto, terminal editável) além das
datas confirmadas, e por isso passa a se chamar **"Escala"**, não "Datas" — quem
assina confirma a escala, não só as datas. Não há mais faixa "Operação de
pátio": seus números são exportação, dentro do Embarque de Vazios.

**O ADR tem seis seções.** `datas`, `carga_descarregada`, `vazios_descarregados`,
`veiculos`, `carga_carregada`, `vazios_embarcados` — Operações com 1,
Documentação com 3, Equipamentos com 2. O gate de fechamento permanece 3/3
departamentos (0029) e a resolução por seção permanece pré-requisito da
assinatura departamental.

**A observação por seção só ocupa espaço quando existe.** Quando há texto
escrito, ele é exibido como conteúdo do relatório para qualquer leitor. Quando
não há, apenas o dono da seção vê o convite "Adicionar observação"; quem não
pode assinar não vê mais um campo vazio nem um "—" anunciando uma nota que
ninguém deixou. Ao acionar o convite, a edição acontece em um modal pop-up,
com os comandos "Cancelar" e "Salvar observação" (ou "Salvar alterações"),
sem expandir um campo dentro da seção. Isso preserva a natureza da 0030
(edição livre do dono, sem justificativa nem histórico) e muda só a superfície.

**A seção `carga_carregada` chama-se "Carga carregada"**, com o granito como seu
conteúdo — não como seu nome. Se outra carga de exportação entrar, nada precisa
ser renomeado.

## Consequências

- **Registro histórico preservado.** `audit_logs`, alertas fechados e snapshots
  já congelados continuam guardando a chave `operacao_patio`; a função SQL
  `agency_report_section_label` e o `agencyReportSectionLabel` do cliente
  continuam resolvendo essa chave (e `ocorrencias`, aposentada pela 0030) para
  leitura. Nenhum registro fechado é reescrito.
- **A fusão dos sign-offs é conservadora.** Se qualquer das duas resoluções
  estava pendente, a seção fundida fica pendente — a migration não assina por
  ninguém. Entre duas resolvidas, "Confirmado" vence "Nada a declarar", e as
  observações das duas são concatenadas.
- **Um impresso de ADR fechado antes desta decisão** mostra a resolução de
  `operacao_patio` num bloco próprio, identificado como registro do fechamento,
  em vez de atribuir a assinatura de uma parte à outra.
- **A migration 253 é o ponto de corte.** Um cliente desatualizado que tente
  resolver `operacao_patio` recebe erro: a chave sai do CHECK e de
  `agency_report_section_owner`. Aplicar a migration antes de publicar o SPA.
- **Correção de cópia junto:** o alerta de departamento pendente passa a nomear
  o departamento em pt-BR ("Equipamentos"), como a 0029 pretendia via
  `agency_report_department_label` e a 225 deixara cru.

## Alternativas consideradas

- **Manter as duas seções e só reagrupá-las visualmente** (mover "Vazios
  embarcados" para a fase Exportação, junto com "Operação de pátio"). Corrige a
  fase, mas mantém duas assinaturas para um agregado que o domínio define como
  um — o desencontro de fundo continua.
- **Manter as duas resoluções dentro de um bloco visualmente único.** Evita a
  migration de dados, mas o cabeçalho da seção precisaria exibir um estado
  agregado ambíguo ("uma parte confirmada, outra pendente") sem que esse estado
  exista no modelo.
- **Renomear `carga_carregada` para "Granito".** Fala a língua do porto hoje,
  mas exige migration e vira mentira na primeira carga de exportação que não for
  granito.
- **Agrupar as faixas por departamento dono** (Operações / Documentação /
  Equipamentos) em vez de por ciclo. Casaria com os três sign-offs, mas quebra a
  leitura cronológica que a 0029 estabeleceu e que o Financeiro usa para situar
  cada número.

## Implementação

Migration `253`; `src/services/agencyDepartureReport.ts` (união de seções,
rótulos, ordem e `agencyReportSectionLabel` compartilhado com
`src/services/alerts.ts`); `src/components/voyages/VoyageAgencyReportTab.tsx`
(fases, subseções, observação sob demanda);
`src/components/voyages/AgencyReportDocument.tsx` (blocos de pátio sob
`vazios_embarcados`, resolução legada, rótulo nas observações).
