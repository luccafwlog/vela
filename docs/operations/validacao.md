# Validação do Vela e do Portal Fwlog

Roteiro executável para o estado atual do repositório. Os roteiros por módulo
foram conferidos contra os documentos de módulo e o código em 2026-10-14; não
foram executados nessa revisão.

O objetivo não é apenas provar que a tela abre. Cada fluxo deve registrar o
ambiente, a identidade usada, os dados de entrada, o resultado e uma evidência
reproduzível. Este documento diz **o que exercitar**; a regra que define o
resultado esperado mora no módulo indicado em cada seção.

## 1. Gates técnicos

### Gate local

Os comandos do gate local, escolhidos pelo impacto da mudança, estão em
[WORKFLOW.md § 11](../../WORKFLOW.md#11-testes-e-validação), e os jobs do CI em
[WORKFLOW.md § 12](../../WORKFLOW.md#12-ci-e-deploy). Registre exit code e
resumo. Não copie contagens antigas de testes para documentos vivos.

### Integração Supabase

```powershell
$env:SUPABASE_RUN_INTEGRATION = '1'
npm run test:integration
```

Use somente projeto ou branch de banco controlado. A suíte requer as variáveis
`SUPABASE_*` descritas em `.env.example`.

### Suítes em PostgreSQL local

As suítes `*.local-pg.test.ts` compartilham o banco `vela_test` e precisam
rodar em série. Depois de `scripts/setup-local-pg.sh`, rode as suítes do
assunto, por exemplo as do bloco `022`–`026`:

```bash
LOCAL_PG_INTEGRATION=1 npx vitest run --no-file-parallelism \
  src/integration/emailInbox.local-pg.test.ts \
  src/integration/demurrageAuthority.local-pg.test.ts \
  src/integration/exchangeRateIntegrity.local-pg.test.ts \
  src/integration/importEffects.local-pg.test.ts
```

Para o gate completo, use `npm run test:local-pg`
([WORKFLOW.md § 11](../../WORKFLOW.md#11-testes-e-validação)).

Esse roteiro comprova contratos e invariantes no banco local, inclusive
permissões negativas, snapshots, alertas e leases. Não comprova a branch
Supabase de Preview, grants do Postgres gerenciado, Vault preenchido,
`pg_cron`/`pg_net` executando, publicação das Edge Functions, provedor de e-mail (MillionSend) ou BCB
reais; esses pontos exigem a validação controlada das seções seguintes.

Para Demurrage, a evidência mínima do contrato é emitir por IDs de B/L e
containers no RPC autoritativo, conferir o snapshot append-only e confirmar que
o browser não grava PIX, total ou PTAX. Para PTAX, provoque falha controlada da
fonte e confirme o alerta persistente. O job `recalc-demurrage-ptax` está
agendado em produção desde 2026-10-07; em ambiente novo, só agende depois de
validar segredo, Edge e gateway
([segredos-cron.md](segredos-cron.md#agendar-o-recálculo-de-ptax)).

## 2. Níveis de ambiente

### Local sem Supabase real

Adequado para:

- documentação, lint, TypeScript e bundle;
- testes unitários e de componentes;
- parsers e fixtures;
- revisão estática de migrations;
- navegação sem validar persistência.

Não prova Auth, RLS, grants, RPCs, Edge Functions ou email.

### Supabase controlado

Obrigatório para:

- autenticação interna e do Portal;
- RLS e roles;
- migrations e funções;
- imports persistidos;
- faturamento, ledger, PIX e Demurrage;
- notificações, disputas e perfil;
- Edge Functions;
- qualquer teste destrutivo.

Prefira projeto descartável ou branch de banco. Identifique fixtures por prefixo
de QA e não misture com produção.

### Produção

Use apenas para smoke não destrutivo e validação operacional autorizada. Registre
data, usuário e entidades consultadas. Não execute reset, exclusão ampla, seed
ou mudança exploratória.

## 3. Modelo de evidência

### Fixture QA de exibição

Os scripts em `scripts/qa-display-production/` usam o prefixo
`QA-DISPLAY-2026`/`QAD26`. A fixture é composta por etapas independentes:
ADR e exceções, cenários financeiros, Portal/PIX e validação/limpeza seletiva.
Nenhuma etapa deve ser executada contra produção sem inventário, usuário,
catálogo de IDs e autorização explícita. `cleanup-fixture.mjs` permanece em
dry-run por padrão e não pode remover tabelas protegidas. O modo destrutivo
recusa antes de apagar: nenhuma tabela da fixture aceita DELETE pela API
(exclusão só pelas RPCs, [ADR 0085](../adr/0085-modelo-de-permissoes-por-perfil.md));
o dry-run serve de inventário e a remoção segue [Reset do ambiente](reset-ambiente.md).

Para cada fluxo:

```text
Ambiente:
Commit/build:
Data e hora:
Usuário e perfil:
Dados/fixture:
Passos executados:
Resultado esperado:
Resultado observado:
Evidência:
Limpeza:
```

### Ordem da fixture QA de exibição

Quando houver ambiente Supabase controlado e autorização explícita, a ordem é
obrigatória:

1. `create-operational.mjs` — cria ou reutiliza os dados operacionais e grava o
   catálogo completo, incluindo `invoices`, `receivables` e `created`;
2. `create-adr-scenarios.mjs` — exige duas B/Ls com o POD omitido antes de
   chamar omissão, transbordo ou COD;
3. `create-financial-scenarios.mjs` — usa cinco B/Ls distintas (BL-002 a
   BL-006), prepara cliente e estado financeiro antes de cada emissão, exige
   receivables e monta itens de Demurrage;
4. `create-portal-scenarios.mjs` — lê quatro invoices do catálogo antes de
   qualquer upsert e preserva email/CNPJ existentes;
5. `validate-fixture.mjs`;
6. `cleanup-fixture.mjs --dry-run`.

Todos os scripts falham antes da primeira mutação quando uma pré-condição não
está satisfeita. PIX com `pix_extract` usa exatamente o saldo aberto; valores
parciais ou excedentes usam `manual`. Uma conta Portal só pode ser marcada como
ativa quando possui `auth_user_id`; a fixture técnica, por si só, não cria Auth,
convite ou email.

O cleanup destrutivo exige uma execução separada em banco descartável. Ele usa
somente entradas `created: true`, valida IDs por tabela e aborta na primeira
resposta de erro do Supabase. Nunca executar essa etapa em produção.

Falha encontrada deve incluir rota, entidade, mensagem visível, console/rede
quando relevante e condição para reprodução.

## 4. Login interno e permissões

**Ambiente:** Supabase controlado.

1. Entre em `/login` com usuário ativo.
2. Confirme redirecionamento para `/painel`.
3. Valide menu e rotas para cada perfil disponível.
4. Tente abrir `/admin` com usuário não administrativo e confirme a tela "Acesso restrito" com o caminho de volta ao Painel.
5. Desative um usuário de QA em `/admin/usuarios` e confirme que a sessão aberta dele é encerrada e que o novo login é recusado.
6. Espere ou simule expiração quando o fluxo de sessão for alterado.

**Esperado:** navegação respeita perfil e o banco não retorna dados proibidos
mesmo quando a API é chamada diretamente. Setores e permissões:
[Segurança § Modelo de permissões por perfil](seguranca.md#modelo-de-permissões-por-perfil).

## 5. Viagens

**Ambiente:** Supabase controlado. Regras em [Viagens](../modules/viagens.md#fluxos-e-invariantes).

1. Crie uma viagem de QA em `/viagens` (**Nova Viagem**).
2. Confirme seleção na faixa de viagens e URL `/viagens/:voyageId`.
3. Recarregue o deep link e confirme a mesma viagem.
4. Abra um ID inexistente e confirme "Viagem não encontrada", sem redirect.
5. Edite as escalas (ETA/ATA, atracações, Número de Escala) e o Nº de
   Manifesto Mercante de uma rota (botão **Informar** da rota, em Rotas e Manifestos).
6. Confira os KPIs (inclusive **Manifestos Mercante**), as abas e a linha do
   tempo.
7. Valide filtros e viewport estreita.
8. Com o Administrativo, cancele a viagem (**Cancelar viagem**, com motivo):
   confirme que ela fica somente leitura e sai do Line-Up do Painel e da TV;
   reative (**Reativar viagem**) e confira que volta.
9. Tente **Excluir** uma viagem com trava (por exemplo, B/L com CE Mercante) e
   confirme a recusa; exclua uma viagem de QA sem trava e confira a prévia do
   que sai junto.
10. Registre uma omissão (**Omitir escala**), complemente o transbordo, marque
    **COD** num B/L afetado e reverta (**Reverter para transbordo**); confira a
    Linha do Tempo e o `OMIT` na Programação.

**Esperado:** rota e seleção permanecem sincronizadas; erro de ID não derruba o
shell; eventos aparecem em ordem coerente; cancelamento, exclusão e omissão
seguem [Status da Viagem e Viagem Cancelada](../modules/viagens.md#status-da-viagem-e-viagem-cancelada)
e [Omissão de Escala, Transbordo e COD](../modules/viagens.md#omissão-de-escala-transbordo-e-cod).

## 6. Importações

### Ordem integrada recomendada

1. criar viagem;
2. importar B/L (o cálculo inicial das Taxas Locais sai na importação);
3. importar Baplie;
4. resolver divergências Baplie × B/L;
5. importar veículos;
6. revisar B/Ls;
7. importar a planilha de CE Mercante (grava o CE e emite em lotes) e as datas
   quando aplicável;
8. conferir o resultado por B/L (faturado, retido, "Aguardando Revisão do
   B/L", "Nada a faturar") e emitir pela Validação o que ficou retido ou
   bloqueado.

Regras da importação de CE e da emissão em lote:
[Manifestos & EDI § CE Mercante](../modules/manifesto-edi.md#ce-mercante) e
[Faturamento](../modules/faturamento.md#validação). O Desbloqueio de CE tem
roteiro próprio em [Desbloqueio de CE](../modules/desbloqueio-ce.md#testes-e-validação).
Fixtures relacionadas: [`test-fixtures/README.md`](../../test-fixtures/README.md).

### Baplie

- arquivo válido cria staging da viagem;
- reimportação substitui somente o staging da mesma viagem;
- IMO/OOG/posição e POL/POD são preservados;
- vazios de importação são criados quando aplicável;
- arquivo vazio, inválido ou grande demais falha antes de persistir.

### B/L CNTR

- preview informa B/Ls, containers, alterações e erros;
- importação transacional não deixa lote parcial;
- reimportação do mesmo número de B/L é reconhecida como atualização (`existing`
  + diff), não como duplicidade bloqueante;
- cliente incerto entra em reconciliação;
- bloqueio de cliente não é sobrescrito por “sem tabela”;
- `Laden on Board` alimenta o ATD do POL ([regra](../modules/viagens.md#etd-e-atd-do-pol-manifesto-mercante-da-rota));
- reconciliação com Baplie expõe divergências.

### Carga solta

- itens, peso, volume e B/L são importados;
- cabeçalhos alternativos cobertos por fixture continuam reconhecidos;
- faturamento usa `cargo_mode` correto.

### Veículos

- preview valida chassi, B/L e container;
- importação transacional não deixa linhas parciais;
- reenvio não duplica veículos;
- resultado pós-persistência é visível.

### Granito

Regras em [Granito](../modules/granito.md#fluxos-e-invariantes).

- planilha COSCO gera manifesto e B/Ls;
- reimportação com B/L em comum atualiza pelo número e pede confirmação antes
  de tirar B/L ausente; planilha sem B/L em comum cria outro manifesto;
- a importação grava o B/L sem Cliente nem sugestão e sem efeito de cálculo;
- `/granito` mostra os totais do recorte e a Carga por viagem, com o peso real
  ou, sem ele, o declarado;
- o Granito não aparece na Revisão nem na Validação, e `/granito/taxas` leva a
  `/granito`.

### Vazios

Regras em [Manifestos & EDI](../modules/manifesto-edi.md#vazios-importacao) e
[Embarque de Vazios](../modules/manifesto-edi.md#embarquevazios).

- Vazios de Importação aceitam Baplie e planilha, com um Nº de Manifesto
  Mercante por rota;
- reimportar a planilha substitui só as rotas que ela traz e preserva a
  natureza digitada (cama/cover plate);
- no Embarque de Vazios, a Lista de Unidades Embarcadas aceita unidade de Depot
  com entrada e saída e unidade de Terminal Portuário sem datas; planilha com
  qualquer linha inválida é recusada inteira;
- reimportar a Lista preserva as unidades incluídas à mão;
- Linhas de Serviço são lançadas à mão; **Armazenagem a lançar** oferece o
  ícone **Lançar armazenagem** com a quantidade calculada e não mostra
  combinação com 0 dia;
- local ou serviço inativo não aparece nos seletores do Embarque, e o banco
  recusa lançamento novo com eles (migration `326`).

## 7. Revisão e auto-faturamento

**Ambiente:** Supabase controlado. Regras em
[Operação e suporte § Gate canônico de revisão](../modules/operacao-suporte.md#gate-canônico-de-revisão).

Prepare novos B/Ls de QA com:

- cliente ausente;
- Cliente sem Portal ativo, com e sem Liberação de faturamento sem Portal
  vigente;
- carga solta sem `bb_weight_ton`;
- cliente vinculado sem e-mail de contato, como controle que **não** deve
  bloquear este gate;
- CE ausente, como controle que **não** deve bloquear este gate;
- B/L elegível completo.

Passos:

1. abra `/revisao`;
2. use filtros e contagens;
3. corrija apenas uma de várias pendências e confirme que o B/L permanece na fila;
4. ative o Portal do Cliente pelo convite (ou conceda a Liberação) e confirme
   que os B/Ls que só esperavam o Portal saem da fila sem salvar;
5. salve com e sem justificativa;
6. confirme que a auditoria registra o `review_status` efetivamente calculado pelo banco;
7. confirme tentativa automática de cálculo/emissão somente depois de zerar as pendências;
8. recarregue a fila e confira o estado;

**Esperado:** nenhum B/L avança silenciosamente com dados incertos; B/L comum
com todos os gates satisfeitos pode emitir automaticamente. Notas humanas são
preservadas e a linha `Pendencias de importacao:` continua legível pela UI.
Não altere nem reabra B/Ls históricos já faturados para executar este roteiro.

## 8. Guard de faturabilidade

A tela não tem ação de marcar pronto; valide diretamente a RPC
`mark_bl_ready_for_billing`:

1. tente com B/L sem linha faturável (BRL ou USD maior que zero);
2. tente com linhas zeradas, negativas ou inelegíveis;
3. tente com linha positiva elegível, em BRL e em USD;
4. confirme status, motivo de bloqueio e ausência/presença de invoice.

**Esperado:** `ready_for_billing` só é alcançado com valor faturável real.

## 9. Taxas locais e invoices

Regras em [Taxas Locais](../modules/taxas-locais.md#tabela-aplicável-item-de-taxa-e-condição-de-cliente)
e [Faturamento](../modules/faturamento.md#fluxos-e-invariantes).

### Tabelas e overrides

- crie tabela de QA com vigência e POD definidos;
- adicione itens BRL e, quando aplicável, USD;
- valide override de cliente;
- crie duas tabelas ativas no mesmo escopo e confirme que vence a de vigência
  inicial mais recente, com a outra marcada **Ativa, mas não usada**;
- confirme que tabela ativa com vigência vencida continua em uso no cálculo (a vigência
  é informativa).

### Validação financeira

- recalcule B/L selecionado;
- confirme atualização imediata de linhas, subtotal e bloqueio;
- emita pela planilha de CE Mercante e por **Emitir fatura** na ficha do B/L;
- emita pela Validação (**Emitir**, por linha) um B/L pronto
  (`ready_for_billing`) ainda não faturado;
- emita consolidada com múltiplos recebíveis;
- confira breakdown e vínculo de B/Ls.

### Documento

- abra invoice local com um item;
- abra invoice com itens suficientes para múltiplas páginas;
- confira empresa, cliente, referência operacional, itens, total e QR PIX
  (fatura local não tem vencimento);
- use “Imprimir” e valide o preview;
- teste o QR com payload de QA, sem efetuar pagamento real.

## 10. Ledger, pagamentos e reversões

Valide:

- pagamento integral;
- pagamento parcial;
- novo pagamento que liquida saldo;
- valor acima do saldo e tratamento de reembolso;
- reversão com justificativa;
- invoice consolidada obsoleta sem pagamento;
- bloqueio de obsolescência com pagamento;
- reemissão e links antigos marcados corretamente.

Confira `invoices`, `bl_receivables`, `invoice_receivable_links`,
`ledger_settlements`, `payments` e `invoice_lifecycle_events`.

**Esperado:** saldo é reconstituível e estados de B/L, invoice e recebível
permanecem coerentes ([Faturamento](../modules/faturamento.md#pagamento-saldo-e-restituição)).

## 11. Demurrage

Regras em [Demurrage](../modules/demurrage.md#fluxos-e-invariantes).

Prepare containers:

- dentro do free time;
- vencido e ainda não devolvido;
- devolvido com valor;
- devolução anterior à descarga;
- compartilhado entre B/Ls do mesmo Cliente na Viagem.

Valide:

1. cálculo por equipamento e faixa;
2. rejeição da ordem de datas inválida;
3. desconto;
4. emissão, impressão, cancelamento e pagamento;
5. container compartilhado: uma Invoice para o grupo e, com caixa nova
   descoberta, a Invoice complementar ([regra](../modules/demurrage.md#grupo-de-demurrage-e-cobrança-por-caixa));
6. datas alteradas depois da emissão: sem pagamento (cancela e reemite), paga
   e com desconto ou disputa (suspensa, com Alerta) ([regra](../modules/demurrage.md#datas-alteradas-depois-da-emissão));
7. **Cancelar baixa…** de uma Invoice paga;
8. aparição em `/demurrage`, `/reconciliacao` e no Portal; Demurrage não
   aparece em `/taxas-locais`, e `/faturamento?tab=demurrage` só redireciona
   para `/demurrage`.

## 12. Conciliação PIX

Regras em [Reconciliação PIX](../modules/reconciliacao-pix.md#fluxos-e-invariantes).

### Cobrança Itaú e baixa automática (caminho principal)

1. emita uma fatura com `pix_provider = 'itau'` e confirme que ela mostra "QR
   em preparação" até a cobrança ficar ativa, e depois o QR;
2. pague e confirme a baixa em segundos, sem ação manual;
3. provoque uma recusa (TXID sem fatura, fatura cancelada) e confirme o item em
   **Pix em análise** e o Alerta `pix_unreconciled`;
4. confira o aviso da aba Pendências quando a consulta de recebimentos parar;
5. faça um Pix digitando a chave, sem o QR, e confirme que ele aparece na aba
   **Pix recebidos** como "Sem identificador", sem Alerta, com a mensagem que
   você escreveu no Pix, e que **Baixar nesta fatura** dá a baixa.

No banco, a suíte `src/integration/itauPixCharges.local-pg.test.ts`
(PostgreSQL local, sem o Itaú) cobre a fila, a virada e a baixa. O caminho com
o Itaú real só se valida pelo teste de centavos em produção, com autorização do
dono, conforme o roteiro do
[plano arquivado](../archive/plans/2026-10-06-integracao-itau-pix.md#roteiro-de-ativação-depois-do-merge-do-código);
o sandbox do Itaú só devolve exemplos fixos.

### Extrato (plano B)

Use extrato de QA com:

- TXID e valor exatos;
- valor divergente;
- TXID repetido;
- invoice já paga;
- cobrança local e Demurrage.

Passos:

1. importe em `/reconciliacao` (aba de extrato);
2. confira matches e motivos;
3. confirme somente linhas seguras;
4. valide resultado por item;
5. confira propagação em invoice, recebível, B/L e Demurrage;
6. teste o cancelamento da baixa quando aplicável.

**Esperado:** ambiguidade não é confirmada automaticamente e falha parcial não
é apresentada como sucesso total.

## 13. Portal do Cliente

Regras em [Portal do Cliente](../modules/portal-cliente.md#identidade-convite-e-recuperação).

### Provisionamento e login

1. em `/clientes/portal` (ou na ficha do Cliente), envie o convite
   (**Enviar convite**) a um Email de Recuperação de QA;
2. simule falha de envio e confirme a situação **Falha no envio**, com a conta
   ainda inativa;
3. ative pelo link em `/portal/ativar` e confirme `active = true` +
   `auth_user_id`;
4. entre por CNPJ normalizado;
5. saia e entre novamente usando CNPJ com e sem máscara;
6. use CNPJ ou senha inválidos;
7. ultrapasse o limite apenas em ambiente descartável;
8. confirme mensagem genérica e rate limit;
9. com a Site Key configurada, confirme o desafio do Turnstile;
10. valide coexistência com uma sessão interna no mesmo navegador;
11. após revogar a credencial (`credentials_revoked_at`), confirme que o overview
    nega com `28000` e não atualiza `last_login_at` — coberto de forma
    automatizada por `src/integration/auditSecurityBoundaries.local-pg.test.ts`
    (`iat` anterior/posterior com corte estrito, ausência e formato inválido).

### Recuperação de senha

1. abra `/portal/esqueci-senha`;
2. solicite pelo CNPJ, com e sem máscara (e-mail não é aceito);
3. confirme resposta que não enumera conta e o desafio do Turnstile;
4. abra `/portal/recuperar-senha` pelo link;
5. defina nova senha e entre novamente.

### Painel

- os quatro indicadores (Taxas locais em aberto, Demurrage em aberto,
  Containers sem devolução, Containers em demurrage) batem com o cliente e
  levam à aba filtrada;
- o cartão da Central de Informações e a programação de navios carregam;
- cliente não vê dados de outro cliente.

### Faturas

- filtros alteram lista e exportação;
- abas local e Demurrage exportam o conjunto visível;
- detalhe, PIX e consolidada funcionam;
- consolidada sem CEs completos permanece oculta;
- obsolescência respeita propriedade, estado e pagamentos.

### B/Ls e containers

- `/portal/operacao` exibe somente dados do cliente;
- filtro “Todos devolvidos” exige todos os containers devolvidos;
- B/L sem CE Mercante permanece oculto;
- exportações respeitam filtros.

### Notificações, disputas e perfil

- nova invoice gera notificação;
- sino marca leitura e permite fechar quando previsto;
- disputa de Demurrage cria registro e alerta interno;
- resposta aparece ao cliente;
- edição de perfil atualiza somente campos permitidos.

## 14. Programação de navios

Em `/chegadas-saidas` (regras em
[Chegadas e Saídas](../modules/chegadas-saidas.md#fluxos-e-invariantes)):

1. adicione navio de QA e anexe a uma viagem existente pelo mesmo VOY + IMO;
2. edite datas; confira que a ordem do quadro segue a menor ETA;
3. marque "não escala" num porto de descarga com data, uma vez como
   Administrativo e outra como outro Departamento, e confira onde a escala
   continua;
4. em **Importar programação**, baixe o modelo, escolha o arquivo, confira a
   prévia e grave (**Importar N viagens**); uma linha com erro bloqueia a
   planilha inteira e uma falha na gravação não grava nada;
5. confira o widget no Portal, inclusive a marca `OMIT` de escala omitida;
6. registre o último ATD da viagem e confira que ela sai de Chegadas e Saídas e
   do Portal.

**Esperado:** datas persistem, o Portal reflete a programação, e a saída da
viagem segue [Saída da Programação](../modules/chegadas-saidas.md#saída-da-programação).

## 15. Admin, alertas, relatórios e Line Up

- `/admin/usuarios`: crie um usuário de QA (**Novo usuário**), troque e-mail e
  senha (**Editar acesso**), troque o setor (**Alterar setor**) e confirme que
  **Desativar** derruba a sessão aberta dele ([regras](../modules/operacao-suporte.md#admin));
- `/alertas`: dispense um alerta com motivo e data futura de revisão e confira
  que volta à fila nessa data; corrija a origem de outro e confira que ele
  fecha sozinho ([regras](../modules/operacao-suporte.md#ciclo-de-vida-do-alerta));
- `/relatorios`: testar abas e arquivos exportados;
- `/line-up-tv/display`: validar legibilidade e atualização; `/line-up-tv`
  mostra "Página não encontrada";
- confirmar ausência de dados técnicos crus em labels.

## 16. Comunicados e automações do canal

Regras em [Clientes § Comunicados ao Cliente](../modules/clientes.md#comunicados-ao-cliente),
[Régua automática de Comunicados](../modules/clientes.md#régua-automática-de-comunicados)
e [Demurrage § Régua de Cobrança](../modules/demurrage.md#régua-de-cobrança).
Valide com a chave de envio desligada (modo de simulação), que registra o
Comunicado como `simulado` sem chamar o provedor de e-mail
([Chave de envio](../modules/clientes.md#chave-de-envio-de-comunicados)):

1. em `/clientes/comunicacao`, monte um disparo manual por carga (NOA, NOR,
   NOB ou livre) e um institucional, passe pela conferência e confirme um
   registro por Cliente e destinatário no histórico;
2. confirme que filtro sem navio/viagem, POL ou POD não libera a conferência;
3. reenvie um modelo ancorado em carga e confira o novo discriminador;
4. deixe a régua automática rodar (NOA, NOR, NOB e CE e Taxas) e confira que
   um Comunicado `simulado` barra o automático da mesma âncora;
5. com uma Invoice de Demurrage emitida, confira a Cobrança de Demurrage da
   Régua de Cobrança às caixas Financeiro e Demurrage;
6. simule um bounce permanente e confira a supressão e o aviso em cascata
   ([regra](../modules/clientes.md#tratamento-de-bounce-em-cascata)).

**Evidência a registrar:** linhas de `customer_communications` e das
tentativas, com status e origem, e o retorno da Edge Function. Envio real só
com a chave ligada, autorização e destinatário controlado.

## 17. Redirecionamentos

Confirme:

- `/` → `/painel`;
- `/vazios` → `/embarquevazios`;
- `/demurrage/invoices` → `/demurrage`;
- `/demurrage/reconciliacao` → `/reconciliacao`;
- `/faturamento` → `/taxas-locais` (e `?tab=demurrage` → `/demurrage`);
- `/carga-solta` e `/manifestos` → `/bls`;
- rota desconhecida → "Página não encontrada", sem trocar a URL.

## 18. Limpeza

Limpeza ampla só com `supabase/scripts/limpar_dados_teste.sql`, enquanto a
afirmação "Data status" do `AGENTS.md` valer. Para fixtures pontuais:

- use prefixos de QA;
- registre IDs criados;
- remova pelo produto ou por SQL revisado para a fixture;
- confira dependências financeiras antes de excluir;

Consulte [`reset-ambiente.md`](./reset-ambiente.md).

## 19. Critério de pronto

Uma mudança está pronta quando:

- o teste focado reproduziu e protege o comportamento;
- gates técnicos aplicáveis passaram;
- fluxo com Supabase real foi validado quando necessário;
- evidência e limpeza foram registradas;
- documentação viva e ADRs foram atualizados;
- riscos residuais foram explicitados.

## Evidência da cartografia — 2026-06-20

> Registro histórico da execução de 2026-06-20, preservado como foi observado;
> não descreve o estado atual nem os roteiros acima.

**Ambiente classificado:** `unavailable`.

O checkout não possui `.env`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `SUPABASE_RUN_INTEGRATION`, Supabase CLI vinculada ou
credenciais/sessões autorizadas. Nenhuma escrita externa foi tentada.

O Vite foi iniciado em `http://127.0.0.1:4176`. O navegador alcançou as rotas
públicas, porém o bootstrap exibiu **Erro de configuração** e registrou no
console que as duas variáveis `VITE_SUPABASE_*` são obrigatórias. Portanto, essa
execução não prova renderização funcional, Auth, RLS, RPCs, banco ou Edge
Functions.

| Fluxo | Ambiente | Status | Resultado | Evidência / limitação |
|---|---|---|---|---|
| Bootstrap local e `/login` | Local sem Supabase | parcial | Vite respondeu HTTP 200, mas a aplicação interrompeu o bootstrap no erro de configuração esperado | Browser em `127.0.0.1:4176/login`; console e heading “Erro de configuração” |
| `/portal/login` | Local sem Supabase | parcial | URL alcançada; formulário não renderizou porque o bootstrap exige configuração Supabase | Browser, heading “Erro de configuração” |
| `/portal/esqueci-senha` | Local sem Supabase | parcial | URL alcançada; fluxo de recovery não pôde iniciar | Browser, heading “Erro de configuração” |
| `/portal/recuperar-senha` sem tokens | Local sem Supabase | parcial | URL alcançada; tratamento da ausência de tokens ficou bloqueado antes da montagem da página | Browser, heading “Erro de configuração” |
| Rota desconhecida | Local sem Supabase | parcial | URL foi servida, mas o redirecionamento por estado de Auth não pôde ser observado | Browser em `/rota-inexistente-cartografia`; bootstrap bloqueado |
| Login interno, perfil, logout e `/admin` | Sem credenciais/Supabase | não executado | Requer sessão interna e projeto controlado | Nenhuma credencial foi solicitada ou inferida |
| Login Portal por CNPJ, logout, coexistência e recovery | Sem credenciais/Supabase | não executado | Requer Auth, Edge Function `portal-login` e ambiente controlado | Login, rate limit e recovery não foram exercitados |
| Histórico remoto de migrations, incluindo `20260619190144` | Sem CLI vinculada | não executado | Não foi possível comparar histórico local e remoto | Supabase CLI e `.temp/project-ref` ausentes |
| Viagem → Baplie → manifesto → reconciliação → veículos | Sem Supabase controlado | não executado | Fixtures existem, mas nenhuma entidade foi persistida | `test-fixtures/README.md`; writes bloqueadas pelo gate de ambiente |
| Revisão, gate canônico e auto-faturamento | Sem Supabase controlado | não executado | Não houve criação/correção de B/L nem emissão | Cobertura estática e automatizada registrada nos módulos |
| Detalhe do B/L: três abas, NCM, Notify e Histórico | Sem Supabase controlado | não executado | Não houve B/L de QA navegável | Testes focados cobrem tabs, NCM, parser e apresentação; não são Runtime |
| Dashboard, Line-Up, alertas, relatórios e drawer de revisão | Bootstrap bloqueado | bloqueado | Superfícies protegidas não montaram | Configuração Supabase obrigatória ausente |
| Taxas locais, invoice individual/consolidada e impressão | Sem Supabase controlado | não executado | Nenhuma mutação financeira ou preview com dados reais | Testes focados e contratos SQL não provam persistência/runtime |
| Conciliação PIX | Sem Supabase controlado | não executado | Workbook de QA não foi gerado nem submetido | Nenhuma transação/invoice de QA disponível |
| Demurrage, overrides, devolução auditada e invoice | Sem Supabase controlado | não executado | Nenhum container ou invoice de QA foi alterado | Cálculo e auditoria têm teste automatizado, sem prova Runtime |
| Granite | Sem Supabase controlado/fixture compatível | não executado | Nenhuma planilha foi fabricada para obter cobertura artificial | Ausência de fixture Granite registrada no módulo |
| Portal: escopo de cliente, CE gate e self-service | Sem conta Portal de QA | não executado | Não houve acesso a dados autenticados nem mutação | Requer conta e entidades descartáveis |
| Programação de navios e widget Portal | Sem Supabase controlado | não executado | CRUD/import/archive/realtime não exercitados | Cobertura runtime continua necessária |
| Integração Supabase | Sem configuração | não executado | `npm run test:integration` não foi habilitado | `SUPABASE_RUN_INTEGRATION` ausente |

Integração Supabase não executada: ambiente controlado não configurado.
