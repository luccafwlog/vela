# Validação do Vela e do Portal Fwlog

Roteiro executável para o estado atual do repositório, revisado em 2026-08-26.

O objetivo não é apenas provar que a tela abre. Cada fluxo deve registrar o
ambiente, a identidade usada, os dados de entrada, o resultado e uma evidência
reproduzível.

## 1. Gates técnicos

### Preparação reproduzível

```powershell
npm ci --legacy-peer-deps
```

### Gate padrão

```powershell
npm run docs:check
npm run lint
npm test
npm run build
```

Registre exit code e resumo. Não copie contagens antigas de testes para
documentos vivos.

### Integração Supabase

```powershell
$env:SUPABASE_RUN_INTEGRATION = '1'
npm run test:integration
```

Use somente projeto ou branch de banco controlado. A suíte requer as variáveis
`SUPABASE_*` descritas em `.env.example`.

### Migrations e automações da remediação

Para validar o bloco `022`–`026` em PostgreSQL local descartável, depois de
`scripts/setup-local-pg.sh`, execute:

```bash
LOCAL_PG_INTEGRATION=1 npm test -- --run \
  src/integration/emailInbox.local-pg.test.ts \
  src/integration/demurrageAuthority.local-pg.test.ts \
  src/integration/exchangeRateIntegrity.local-pg.test.ts \
  src/integration/importEffects.local-pg.test.ts
```

Esse roteiro comprova contratos e invariantes no banco local, inclusive
permissões negativas, snapshots, alertas e leases. Não comprova a branch
Supabase do Preview, grants do Postgres gerenciado, Vault preenchido,
`pg_cron`/`pg_net` executando, publicação das Edge Functions, Resend ou BCB
reais; esses pontos exigem a validação controlada das seções seguintes.

Para Demurrage, a evidência mínima do novo contrato é emitir por IDs de B/L e
containers no RPC autoritativo, conferir o snapshot append-only e confirmar que
o browser não grava PIX, total ou PTAX. Para PTAX, provoque falha controlada da
fonte e confirme o alerta persistente; não marque o job como operacional sem
uma execução autenticada em Preview.

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
dry-run por padrão e não pode remover tabelas protegidas.

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
4. Tente abrir `/admin` com usuário não administrativo.
5. Desative um usuário de QA e confirme bloqueio de sessão ou novo login.
6. Espere ou simule expiração quando o fluxo de sessão for alterado.

**Esperado:** navegação respeita perfil e o banco não retorna dados proibidos
mesmo quando a API é chamada diretamente.

## 5. Viagens e master-detail

**Ambiente:** Supabase controlado.

1. Crie uma viagem de QA em `/viagens`.
2. Confirme seleção no rail e URL `/viagens/:voyageId`.
3. Recarregue o deep link e confirme a mesma viagem.
4. Abra um ID inexistente e valide estado recuperável.
5. Edite agendas POL/POD, Número de Escala e vínculo de manifestos.
6. Confira CE Master, cards de módulo e linha do tempo.
7. Valide filtros, painel recolhido e viewport estreita.

**Esperado:** rota e seleção permanecem sincronizadas; erro de ID não derruba o
shell; eventos aparecem em ordem coerente.

## 6. Importações

### Ordem integrada recomendada

1. criar viagem;
2. importar B/L;
3. importar Baplie;
4. resolver divergências Baplie × B/L;
5. importar veículos;
6. importar CE Mercante e datas quando aplicável;
7. revisar B/Ls;
8. calcular e faturar.

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
- `Laden on Board` alimenta o ATD do POL e datas diferentes na mesma Viagem e
  POL resultam automaticamente na mais antiga, conforme a ADR 0025;
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

- planilha COSCO gera manifesto, B/Ls e cobranças;
- revisão combina Granito com a fila comum sem perder origem;
- invoice e Portal exibem vínculo correto.

### Vazios

- Vazios de Importação aceitam Baplie e planilha;
- Vazios de Exportação importam bookings;
- rotas e viagens corretas são preservadas;
- reimportações não cruzam manifestos.

## 7. Revisão e auto-faturamento

**Ambiente:** Supabase controlado.

Prepare novos B/Ls de QA com:

- cliente ausente;
- cliente vinculado sem e-mail;
- conta de portal ativa sem `auth_user_id`;
- carga solta sem `bb_weight_ton`;
- CE ausente, como controle que **não** deve bloquear este gate;
- B/L elegível completo.

Passos:

1. abra `/revisao`;
2. use filtros e contagens;
3. corrija apenas uma de várias pendências e confirme que o B/L permanece na fila;
4. adicione e-mail e provisione o portal; confirme que a conta só fica ativa depois de receber `auth_user_id`;
5. salve com e sem justificativa;
6. confirme que a auditoria registra o `review_status` efetivamente calculado pelo banco;
7. confirme tentativa automática de cálculo/emissão somente depois de zerar as pendências;
8. recarregue a fila e confira o estado;
9. repita com Granito, que mantém o comportamento próprio.

**Esperado:** nenhum B/L avança silenciosamente com dados incertos; B/L comum
com todos os gates satisfeitos pode emitir automaticamente. Notas humanas são
preservadas e a linha `Pendencias de importacao:` continua legível pela UI.
Não altere nem reabra B/Ls históricos já faturados para executar este roteiro.

## 8. Guard de faturabilidade

Valide diretamente a RPC e pela UI:

1. tente marcar pronto um B/L sem linha BRL positiva;
2. tente com linhas zeradas, negativas ou inelegíveis;
3. tente com linha positiva elegível;
4. confirme status, motivo de bloqueio e ausência/presença de invoice.

**Esperado:** `ready_for_billing` só é alcançado com valor faturável real.

## 9. Taxas locais e invoices

### Tabelas e overrides

- crie tabela de QA com vigência e POD definidos;
- adicione itens BRL e, quando aplicável, USD;
- valide override de cliente;
- confirme que vigências e prioridades selecionam a tabela esperada.

### Validação financeira

- recalcule B/L selecionado;
- confirme atualização imediata de linhas, subtotal e bloqueio;
- marque cobranças revisadas;
- marque pronto e emita invoice individual;
- emita consolidada com múltiplos recebíveis;
- confira breakdown e vínculo de B/Ls.

### Documento

- abra invoice local com um item;
- abra invoice com itens suficientes para múltiplas páginas;
- confira empresa, cliente, referência operacional, itens, total, vencimento e
  QR PIX;
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
permanecem coerentes.

## 11. Demurrage

Prepare containers:

- dentro do free time;
- vencido e ainda não devolvido;
- devolvido com valor;
- devolução anterior à descarga.

Valide:

1. cálculo por equipamento e faixa;
2. rejeição da ordem de datas inválida;
3. desconto e edição controlada;
4. emissão, impressão, cancelamento e pagamento;
5. aparição em `/taxas-locais` e no Portal; `/faturamento` é apenas o redirect legado.

## 12. Conciliação PIX

Use extrato de QA com:

- TXID e valor exatos;
- valor divergente;
- TXID repetido;
- invoice já paga;
- cobrança local e Demurrage.

Passos:

1. importe em `/reconciliacao`;
2. confira matches e motivos;
3. confirme somente linhas seguras;
4. valide resultado por item;
5. confira propagação em invoice, recebível, B/L e Demurrage;
6. teste reversão quando aplicável.

**Esperado:** ambiguidade não é confirmada automaticamente e falha parcial não
é apresentada como sucesso total.

## 13. Portal do Cliente

### Provisionamento e login

1. provisione conta pela ficha do cliente;
2. simule falha da Edge Function e confirme que a conta permanece inativa;
3. conclua o provisionamento e confirme `active = true` + `auth_user_id`;
4. entre por CNPJ normalizado;
5. saia e entre novamente usando CNPJ com e sem máscara;
6. use CNPJ ou senha inválidos;
7. ultrapasse o limite apenas em ambiente descartável;
8. confirme mensagem genérica e rate limit;
9. valide coexistência com uma sessão interna no mesmo navegador;
10. após revogar a credencial (`credentials_revoked_at`), confirme que o overview
    nega com `28000` e não atualiza `last_login_at` — coberto de forma
    automatizada por `src/integration/auditSecurityBoundaries.local-pg.test.ts`
    (`iat` anterior/posterior com corte estrito, ausência e formato inválido).

### Recuperação de senha

1. abra `/portal/esqueci-senha`;
2. solicite por email e documento;
3. confirme resposta que não enumera conta;
4. abra `/portal/recuperar-senha` pelo link;
5. defina nova senha e entre novamente.

### Dashboard

- saldos e contadores batem com o cliente;
- vencimentos próximos usam dia de calendário;
- alertas e programação de navios carregam;
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

Em `/chegadas-saidas`:

1. adicione navio de QA;
2. edite datas e ordem;
3. baixe o modelo;
4. atualize por planilha;
5. confira o widget no Portal;
6. encerre o navio e exporte o histórico;
7. valide exclusão permanente somente com dado de QA.

**Esperado:** ordem e datas persistem e o Portal reflete a programação.

## 15. Admin, alertas, relatórios e Line Up

- `/admin/usuarios` (aba Usuários): alterar role/active de usuário de QA e revalidar acesso;
- `/alertas`: reconhecer e fechar alerta sem perder vínculo;
- `/relatorios`: testar abas e arquivos exportados;
- `/line-up-tv`: validar administração;
- `/line-up-tv/display`: validar legibilidade e atualização;
- confirmar ausência de dados técnicos crus em labels.

## 16. Redirecionamentos

Confirme:

- `/vazios` → `/embarquevazios`;
- `/demurrage/invoices` → `/demurrage`;
- `/demurrage/reconciliacao` → `/reconciliacao`;
- rota desconhecida → `/painel`.

## 17. Limpeza

O reset amplo está suspenso. Para fixtures:

- use prefixos de QA;
- registre IDs criados;
- remova pelo produto ou por SQL revisado para a fixture;
- confira dependências financeiras antes de excluir;
- nunca execute `supabase/scripts/reset_operational_data.sql`.

Consulte [`reset-ambiente.md`](./reset-ambiente.md).

## 18. Critério de pronto

Uma mudança está pronta quando:

- o teste focado reproduziu e protege o comportamento;
- gates técnicos aplicáveis passaram;
- fluxo com Supabase real foi validado quando necessário;
- evidência e limpeza foram registradas;
- documentação viva e ADRs foram atualizados;
- riscos residuais foram explicitados.

## Evidência da cartografia — 2026-06-20

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
