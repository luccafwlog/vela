# Revisão final da PR 929 (importações e CE Mercante) — 2026-10-12

## Escopo

Revisão rigorosa da PR 929 (`claude/correcao-importacoes-ce-mercante`, head
`6fe0790`, base `main` em `b5785db`) depois das rodadas de 2026-10-11
([revisão da PR](2026-10-11-revisao-pr-929-importacoes.md),
[ADR 0079](../../adr/0079-decisoes-pendentes-da-revisao-da-pr-929.md) e a
revisão automática das migrations `207`–`210`). Na entrada: 265 arquivos,
migrations `174`–`210`, as 33 threads de revisão da PR resolvidas e o CI verde.

Seis revisores independentes, um por área: CE Mercante e Manifesto; B/L de
container, carga solta, COD e Part Lot; Demurrage e datas; segurança, fila de
efeitos e Viagem Cancelada; Baplie, Veículos, Base de Clientes, Granito, Vazios
e Programação; leitor de planilhas e datas. Cada achado foi reproduzido no
PostgreSQL 16 local com o replay das migrations (transação desfeita) ou por
teste de unidade. A primeira pergunta de cada área foi se uma migration
posterior redefiniu função ou gatilho a partir de uma definição antiga e
perdeu correção anterior: nenhuma perdeu.

## Achados e destino

### Programação por planilha

1. **POD removido refazia a recusa para sempre (médio).** A prévia lia os PODs
   sem os removidos e mandava `old_value` vazio; a conferência da `209` compara
   com o Histórico, que ainda tem a ETA de antes da remoção. O arquivo com esse
   porto era recusado a cada tentativa. A leitura para gravar (planilha e tela)
   passou a incluir o POD removido, que volta ao planejamento com
   `deleted=false`, como `docs/modules/viagens.md` já descrevia
   (`voyageRouteSchedules.ts`, `voyageFromSchedule.ts`).
2. **IMO conflitante entre viagens diferentes passava na prévia (baixo).** Navio
   achado pelo nome recebe o IMO da primeira linha (`202`); outra linha com outro
   IMO era recusada só na gravação, desfazendo o arquivo. A prévia recusa as
   linhas.
3. **Deadlock entre dois arquivos com as mesmas Viagens (baixo).** As Viagens
   cadastradas do arquivo são travadas em ordem de id antes do laço (`213`).

### Demurrage e datas de container

4. **Grupo que muda depois da Invoice: caixa cobrada duas vezes ou nunca
   (alto).** O "já faturado" era decidido pelo B/L do grupo do momento. Decisão
   do dono ([ADR 0080](../../adr/0080-decisoes-da-revisao-final-da-pr-929.md)):
   cobrança por caixa e Invoice complementar só com as caixas novas (`214`).
5. **Reconciliação de datas cancelava Invoice paga ao mesmo tempo (médio).** A
   Invoice é travada antes da decisão, e só a emitida sem pagamento é
   cancelada (`211`).
6. **Atraso contado pela data UTC (baixo).** Das 21h à meia-noite o container
   entrava em atraso um dia antes; o status e o free time contam pela data de
   São Paulo, a mesma da Invoice (`211`).
7. **Datas gravadas por fora da porta (baixo, defesa em profundidade).** UPDATE
   direto de descarga ou devolução pelo PostgREST é recusado e a RPC legada
   `update_container_demurrage_dates` deixou a API (`211`).
8. **Deadlock entre duas gravações de datas num container compartilhado
   (baixo).** O conjunto inteiro de containers de mesmo número é travado em
   ordem de id antes de qualquer linha (`211`).
9. **Emissão enfileirada do âncora cancelado se perdia (baixo).** Enfileira a
   emissão do âncora que restou no grupo (`211`).
10. **Histórico mostrava o JSON cru da edição das datas.** O evento
    `container_dates` (com o motivo da remoção) aparece como "Container X ·
    datas: Devolução: 20/10/2026 → -"; o desvínculo de Manifesto ganhou rótulo
    (`blTimelinePresentation.ts`).

### Viagem Cancelada, fila de efeitos e segurança

11. **A `181` abortava o deploy com Viagem Cancelada de número fora do formato
    (médio).** A reescrita para a forma canônica pula essas linhas; a `181` foi
    editada antes do primeiro deploy com autorização do dono (ADR 0080), e o
    diagnóstico de pré-deploy ganhou a consulta 4c.
12. **Invoice de Demurrage em B/L de Viagem Cancelada (médio).** Gatilho de
    Viagem Cancelada em `demurrage_invoices` (`211`).
13. **Reativar a Viagem não devolvia os efeitos encerrados pelo cancelamento
    (baixo).** Voltam à fila, salvo os já substituídos (`211`).
14. **Linha saía da Viagem Cancelada trocando de pai (baixo).** Container e B/L
    de Granito (`211`) e as tabelas com `voyage_id` direto, inclusive `bls`
    (`216`), conferem também a linha antiga.

### CE Mercante e Manifesto Mercante

15. **Manifesto Mercante sem guarda no banco (médio).** A API só lê o
    cadastro, e o vínculo `bls.manifesto_mercante_id` só muda pelas RPCs
    (`guard_bl_manifesto_port`, `212`).
16. **"Informar Nº" registrava troca que não acontecia (médio-baixo).** Decisão
    do dono (ADR 0080): com B/L vinculado, recusa e orienta Mover ou
    Desvincular; sem B/L, o número antigo sai do cadastro (`215`).
17. **Fechar a importação de CE durante a emissão perdia o "Retomar"
    (médio-baixo).** A tela não fecha enquanto grava ou emite, e a mesma
    planilha de novo devolve à emissão o B/L que ficou sem fatura (`212`).
18. **B/L "Nada a faturar" ficava no alerta de tabela faltando (baixo).** Sai do
    alerta e fecha a falha anterior (`212`).
19. **Ver B/Ls truncava em 1.000 B/Ls; cache da ficha e do Histórico não
    atualizava depois de Mover (baixo).** Paginação e invalidação; a recusa por
    estado antigo recarrega a tela.
20. **CE do Granito apagável pela API (baixo, anterior à PR).** A função interna
    deixou a API e valida 15 dígitos (`212`).

### Importação de B/L

21. **Troca de Consignatário recusada gravava o consignatário novo no B/L de
    container (médio).** Sem aceite, consignatário, CNPJ, razão social e e-mail
    gravados ficam, e a troca volta no resultado (`213` e
    `blFreightImport.ts`).
22. **Carga solta com CNPJ não cadastrado trocava o consignatário sem Troca
    (médio).** Vira Troca de Consignatário com aceite (`213` e prévia).
23. **Manifesto BB do armador sem CBM zerava a cubagem (baixo-médio).** Vai
    vazio.
24. **B/L avulso PDF/DOCX zerava os itens que o documento não trazia
    (baixo-médio).** O item gravado mantém o valor (`213`).
25. **POD corrigido no B/L de container mantinha o terminal do POD antigo
    (baixo).** Limpa a exceção de terminal (`213`).
26. **Correção de POD da carga solta desvinculava o Manifesto sem Histórico
    legível (baixo).** O desvínculo é do gatilho da `207` (`213`).

### Leitor de planilhas

27. **Vazios de Importação apagavam containers de linhas ocultas sem aviso
    específico (médio).** Confirmação antes de gravar, como no Embarque; a
    confirmação do Granito avisa das ocultas.
28. **Veículos: aba anterior com coluna repetida ou dado oculto interrompia a
    procura da aba de veículos (baixo-médio, regressão).** A procura segue.
29. **Célula só de hora virava vazio em silêncio (baixo).** Chega ao parser como
    texto e a coluna de data a recusa com motivo.
30. **Avisos de linhas ocultas que diziam mais do que era verdade (baixo).**
    Linha oculta acima do cabeçalho, abas que o B/L COSCO não lê, PIX com aviso
    de outra aba e ZPT com o aviso de encoding entre o que "ficou fora".
31. **Modelos de planilha (baixo, anterior à PR).** CNPJs de exemplo com dígito
    verificador inválido na Base de Clientes; modelo de vazios sem a coluna que
    o parser pede.

### Revisão automática sobre as correções (Codex, commit `b155f15`)

32. **Dois arquivos com o mesmo navio novo em viagens diferentes criavam dois
    cadastros do navio.** As travas da `213` incluíam o número da Viagem; entram
    as travas do navio (nome e IMO), na mesma ordem fixa (`217`).
33. **Dois "Informar Nº" simultâneos numa rota nova deixavam um Manifesto
    sobrando.** A rota é travada antes de ler o número antigo (`217`).
34. **Divergência de perfil do Baplie já resolvida podia voltar (commit
    `bcefae1`).** A tabela guarda uma resolução "Vale o B/L" por valor do
    Baplie, mas a conferência guardava uma só por container; com o Baplie
    alternando entre IMO e OOG, a outra reaparecia. A conferência considera
    todas (`baplieReconciliation.ts`).
35. **Resoluções do Baplie além de 1.000 linhas eram ignoradas (commit
    `d23b057`).** A leitura não paginava, e o PostgREST corta a resposta em
    1.000 linhas; passa a paginar em ordem estável, como o staging e os
    containers.

### Mantidos como estão

- O alerta `demurrage_invoice_dates_changed` aberto pela reemissão automática
  não fecha sozinho: é a escolha documentada no cabeçalho da `208`.
- A confirmação de faturamento do B/L de container é dada na prévia e não é
  conferida de novo na gravação, como antes da PR; a janela é a da tela aberta.
- As reemissões de fatura (`invoice_reissues`) que a importação de B/L provoca
  não aparecem na tela de resultado da importação (só no Baplie); a fatura
  reemitida aparece no Faturamento e no Histórico do B/L. Comportamento anterior
  à PR.

## Evidência

PostgreSQL 16 local, replay limpo das migrations `001`–`217`, checagens de
invariantes do CI, todas as suítes `local-pg` na ordem do CI, testes de
unidade, `typecheck`, `lint`, `build`, `docs:check`, `migrations:check`,
`rpc:check` e `localpg:check`. Cada correção tem caso de regressão que falha
sem ela. A `181` editada foi aplicada sobre um banco com Viagem Cancelada de
número fora do formato (a original abortava) e seguida pela cadeia até a `213`.
Nada foi verificado em navegador nem em Supabase real.
