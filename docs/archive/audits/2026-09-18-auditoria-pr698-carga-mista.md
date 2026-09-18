# Auditoria adversarial — PR 698 (Unificação de B/Ls, carga mista e Manifesto Mercante)

- **Data:** 2026-09-18
- **Alvo:** `feat/unificacao-bls-carga-mista-manifesto` @ `a7697d4` (PR 698), 150 arquivos, +9.394/−1.077
- **Modo:** COMPLETO (8 frentes)
- **Método:** replay das 60 migrations em PostgreSQL 16 descartável (`scripts/setup-local-pg.sh --reset`)
  e execução de contraprovas contra o catálogo real. Nenhum achado abaixo é inferido apenas por leitura.
- **Contraprovas executáveis:** `src/integration/pr698Auditoria.local-pg.test.ts` — 4 testes, 4 falham
  contra este head.

Documento histórico. Não é fonte de verdade sobre o comportamento atual.

## Nota de método

A suíte da PR (`src/integration/pr698ClaudeReview.local-pg.test.ts`, 6 testes) foi executada no MESMO
banco em que as contraprovas falham: **6/6 passaram**. Os achados P0/P1 abaixo não são regressões que a
CI deixou passar por descuido — são eixos que a suíte nunca interroga.

---

## P0 — CÓDIGO COM DEFEITO: taxa por tonelada de carga solta cobrada sobre o peso dos contêineres

- **Frente:** 3 — Motor Financeiro (ADR 0069)
- **Arquivo:** `supabase/migrations/056_resolucao_taxas_duas_tabelas.sql:366-371`
  (definição viva confirmada em `pg_proc.resolve_bl_local_charge_items`, linhas 162-167 do corpo)

### Mecanismo

O item de base `weight_ton` resolve o peso assim:

```sql
v_weight_ton := COALESCE(
  v_bl.bb_weight_ton,
  CASE WHEN v_bl.total_weight_kg IS NULL THEN NULL ELSE v_bl.total_weight_kg / 1000 END,
  0
);
```

Este é exatamente o fallback que o design da PR declara **proibido**
(`docs/archive/specs/2026-09-16-unificacao-bls-carga-mista-design.md:412`) e que a migration 061 diz ter
eliminado. A 061 mudou a semântica das colunas e corrigiu `operational_list_bl_summary`; **não tocou no
motor de taxas**. Depois da 061 o fallback ficou pior do que antes: `total_weight_kg` agora significa
*somente carga conteinerizada*, então o desempate passa a cobrar a tarifa de carga solta sobre tonelagem
de contêiner.

O estado que dispara isso é comum, não exótico: um B/L misto com itens em `bl_breakbulk_items` mas
`bls.bb_weight_ton` ainda nulo. É o estado que a própria PR nomeia com a pendência "Peso BB ausente"
(`059:243-247`). A derivação de modalidade usa a *existência* de filhos (`059:80-86`), então o B/L já é
`misto` antes de o peso do cabeçalho existir.

### Cenário de estresse

B/L misto, 40 contêineres de 25 t (`total_weight_kg = 1.000.000`), uma máquina solta de 3 t ainda sem
peso no cabeçalho. Tabela de carga solta com handling de R$ 50/t.

### Contraprova (executada)

```
ESTADO: mode=misto | total_weight_kg=1000000.000 | bb_weight_ton=<<NULL>> | carga solta real = 3.000 kg
DOC FEE CNTR   | qty=1.000000    | R$ 500.00
THD            | qty=40.000000   | R$ 32000.00
HANDLING/TON   | qty=1000.000000 | R$ 50000.00   <-- 1.000 t de contêiner tarifadas como carga solta
TOTAL FATURAVEL: R$ 82500.00      ESPERADO: R$ 32650.00
```

`status = 'calculated'`, **não** `review_required`: a linha atravessa os gates 5 e 7 de
`mark_bl_ready_for_billing` e chega à fatura sem pedir revisão humana.

### Impacto

Sobrefaturamento de R$ 49.850 em um único B/L, proporcional ao peso conteinerizado. Escala com o
tamanho do B/L: quanto mais contêineres, maior o erro. O cliente recebe uma fatura com uma linha de
handling de carga solta 333x maior que a carga solta real.

### Correção recomendada

Remover o fallback. Sem peso solto declarado em B/L `carga_solta`/`misto`, a linha tem de ir para
revisão, como já acontece nos demais casos ausentes:

```sql
ELSIF item.application_basis = 'weight_ton' THEN
  v_weight_ton := CASE
    WHEN v_bl.cargo_mode IN ('carga_solta', 'misto') THEN v_bl.bb_weight_ton
    ELSE COALESCE(v_bl.bb_weight_ton, v_bl.total_weight_kg / 1000)
  END;
  IF COALESCE(v_weight_ton, 0) <= 0 THEN
    calculation_key := CONCAT('review:weight_missing:', item.id);
    review_reason := 'Peso de carga solta ausente; o peso conteinerizado nao substitui o peso solto';
    RETURN NEXT; CONTINUE;
  END IF;
```

---

## P1 — LACUNA DE DESIGN: o bloqueio pós-faturamento protege a modalidade, não o conteúdo

- **Frente:** 1 — Banco de dados e invariantes
- **Arquivos:** `supabase/migrations/060_pr698_claude_review_followup.sql:105-131` (`_recalculate_bl_cargo_mode`)
  e `060:291-302` (`trg_sync_bl_weight_cargo_mode`)

### Mecanismo

Ambos os guardas comparam **postos de modalidade**, não conteúdo:

```sql
v_old_rank := CASE v_curr_mode WHEN 'misto' THEN 2 WHEN 'carga_solta' THEN 1 ELSE 0 END;
...
IF v_curr_mode IS NOT DISTINCT FROM v_new_mode THEN RETURN; END IF;   -- saída antecipada
IF v_locked AND v_old_rank > v_new_rank AND NOT v_replacement THEN RAISE EXCEPTION ...
```

A saída antecipada acontece **antes** de qualquer avaliação financeira. Toda mudança de conteúdo que não
cruza a fronteira de modalidade — que é a maioria das mudanças reais — é invisível: sem exceção, sem
`billing_hold_reason`, sem `review_status = 'pending_review'`.

O corpo da PR afirma: *"somente remoções de B/L `invoiced`/`paid` são bloqueadas"* e *"Adições
pós-faturamento (…) criam billing hold para refaturamento"*. Ambas valem apenas no subconjunto que muda
a modalidade.

### Contraprova (executada, B/L misto faturado)

| Ação sobre B/L `invoiced` | modalidade | resultado |
| --- | --- | --- |
| remover 2 de 3 contêineres | misto → misto | **silêncio** (review=ok, hold=NULL) |
| remover 1 de 2 itens soltos | misto → misto | **silêncio** |
| **adicionar 20 contêineres** | misto → misto | **silêncio, sem billing hold** |
| `bb_weight_ton` 20 t → 0,5 t | misto → misto | **silêncio** |
| remover TODOS os contêineres | misto → carga_solta | bloqueado (P0003) ✔ |

Só a última linha dispara o guarda.

### Impacto

Perda de receita direta: um B/L faturado por 1 contêiner que recebe mais 20 nunca é refaturado, porque
nada sinaliza a mudança. E o inverso: 19,5 t faturadas que desapareceram do B/L não geram estorno. O
caminho é alcançável pela importação sancionada — `import_breakbulk_manifest_transactional` (`060:485-524`)
faz `DELETE FROM bl_breakbulk_items WHERE bl_id = ANY(...)` seguido de re-INSERT, e o preflight
(`060:400-406`) só barra quando o payload **não traz nenhuma** carga BB para aquele B/L. Um payload com
um único item de 0,001 t passa o preflight e apaga 50 t faturadas.

### Correção recomendada

Substituir a comparação de posto por uma comparação de **conteúdo faturável**: contagem distinta de
contêineres e peso solto. Em B/L `invoiced`/`paid`, qualquer delta não nulo abre
`review_status='pending_review'` + `billing_hold_reason`; deltas negativos exigem estorno explícito.
Isso cobre também o caso `container`→`container`, hoje sem guarda nenhum.

---

## P1 — CÓDIGO COM DEFEITO: a supressão anti-bitributação apaga a taxa documental quando não há substituta

- **Frente:** 3 — Motor Financeiro
- **Arquivo:** `supabase/migrations/056_resolucao_taxas_duas_tabelas.sql:340-343`

```sql
IF v_bl.cargo_mode = 'misto' AND v_tbl.cargo_mode = 'carga_solta' AND item.application_basis = 'bl' THEN
  CONTINUE;
END IF;
```

A regra protege corretamente contra cobrar a taxa documental duas vezes quando **as duas** tabelas a
definem — verificado: em B/L misto com DOC nas duas tabelas, só a do contêiner é cobrada. Mas a supressão
é **incondicional**: não verifica se a tabela de contêiner oferece substituta.

### Contraprova (executada)

Armador que cadastra a taxa documental apenas na tabela de carga solta; B/L misto:

```
THD          | qty=1.000000 | R$ 800.00 | calculated
HANDLING/TON | qty=2.000000 | R$ 100.00 | calculated
TAXA DOCUMENTAL COBRADA? NAO -- PERDA SILENCIOSA DE R$ 450, SEM PENDENCIA
```

O gate 8 de `mark_bl_ready_for_billing` (`056:150-158`) exige duas tabelas para B/L misto, mas não exige
que a taxa documental sobreviva à supressão. A fatura sai sem ela e sem pendência.

### Correção recomendada

Suprimir o item `bl` da tabela de carga solta **apenas quando** a tabela de contêiner já produziu um item
de base `bl`; caso contrário, promover o item da tabela de carga solta (ou emitir
`review:missing_doc_fee`).

---

## P1 — LACUNA DE DESIGN: `/carga-solta` e `/manifestos` caem em 404, sem redirecionamento

- **Frente:** 7 — Frontend e rotas
- **Arquivos:** `src/AppInterno.tsx:128-163`; teste `src/services/__tests__/navigationLinks.test.ts:37`

`src/pages/CargaSolta.tsx` foi removido e nenhuma rota substituta foi criada. `/carga-solta`,
`/carga-solta/:id` e `/manifestos` caem no catch-all `<Route path="*" element={<NaoEncontrado />} />`
(`AppInterno.tsx:163`).

O padrão de redirecionamento existe e foi aplicado a outras rotas legadas no mesmo arquivo —
`/demurrage/invoices`, `/demurrage/reconciliacao`, `/vazios` (`AppInterno.tsx:150-158`). Só não foi
aplicado às rotas que esta PR removeu.

### O que fecha a porta para a correção

O guarda `navigationLinks.test.ts:37` rejeita **qualquer** linha de código em `src/` que contenha
`/carga-solta` ou `/manifestos` seguido de `/`, `'`, `"`, `` ` ``, `?` ou `#`. Um
`<Route path="/carga-solta" element={<Navigate to="/bls" replace />} />` casa com esse regex e **quebra a
CI**. O teste que protege contra links mortos também impede o redirecionamento que consertaria os
favoritos mortos.

### Impacto

Todo favorito salvo, todo link em e-mail já enviado ao cliente e todo histórico de navegação apontando
para a tela antiga leva a uma tela vazia. Para uma rota que era a tela principal de carga solta, isso
atinge o uso diário.

### Correção recomendada

Adicionar em `AppInterno.tsx`, junto dos demais redirects:

```tsx
<Route path="/carga-solta" element={<Navigate to="/bls" replace />} />
<Route path="/carga-solta/:blId" element={<LegacyCargaSoltaRedirect />} />
<Route path="/manifestos" element={<Navigate to="/bls" replace />} />
```

e ajustar `navigationLinks.test.ts` para permitir o atributo `path=` (que é destino de redirect) e
continuar proibindo `to=`/`href=` (que são links vivos).

---

## P1 — LACUNA DE DESIGN: "CE Master" não foi descontinuado; agora há duas fontes de verdade

- **Frente:** 5 — Manifesto Mercante
- **Arquivos:** `src/services/voyageRouteSchedules.ts:701-726`; `src/services/manifestImport.ts:10-12`;
  `src/services/voyageSummaries.ts:749`; `src/components/voyages/VoyageCard.tsx:277-279`;
  `src/services/manifestosMercanteService.ts:48-56`

`CONTEXT.md:742-745` afirma: *"A nomenclatura 'CE Master' foi descontinuada do sistema em favor de 'Nº de
Manifesto Mercante'"*. O código executável desmente:

- a tabela `voyage_route_ce_master` continua sendo lida e escrita (`voyageRouteSchedules.ts:701-726`);
- `import_batches.ce_master` continua sendo gravado via `set_import_batch_ce_master` (`manifestImport.ts:10`);
- `VoyageCard.tsx:277` calcula o KPI "rota tem CE Master" a partir da fonte **antiga**.

A entidade `manifestos_mercante` foi adicionada **ao lado** da mecânica antiga, não no lugar dela. Nada
reconcilia as duas. Consequência operacional concreta: um operador que cadastra o manifesto em
`manifestos_mercante` continua vendo a rota marcada como sem manifesto no cartão da viagem, porque o KPI
lê `voyage_route_ce_master`.

### Correção recomendada

Decidir qual é a fonte de verdade e migrar a leitura do KPI. Se `manifestos_mercante` é a fonte, portar
`VoyageCard`/`voyageRouteSchedules` para ela e marcar `voyage_route_ce_master` como inerte (com
`COMMENT`, como foi feito em M11). Se a convivência é intencional, `CONTEXT.md:742-745` precisa dizer
isso em vez de afirmar descontinuação.

---

## P2 — LACUNA DE DESIGN: a "pendência operacional" gerada pelo COD não existe

- **Frente:** 4/5 — Terminal e Manifesto
- **Arquivos:** `supabase/migrations/057_cod_manifesto_pendency.sql:52-56`; `CONTEXT.md:134-137`;
  `supabase/migrations/060_pr698_claude_review_followup.sql:713-721`

O comentário da migration diz *"limpa manifesto_mercante_id (gerando pendencia)"* e `CONTEXT.md:136-137`
repete a afirmação. Inspeção do corpo vivo de `set_bl_cod` em `pg_proc`: a única referência a manifesto é
`manifesto_mercante_id = NULL`. Não há `upsert_alert_item`, não há mudança de `review_status`, não há
linha em `charge_calculations`. O nome do arquivo (`..._manifesto_pendency.sql`) promete o que o corpo
não entrega.

O mesmo vale para o `ON DELETE SET NULL` de `bls.manifesto_mercante_id` (`053:24`): excluir um manifesto
desvincula silenciosamente todos os B/Ls dele.

A única superfície que mostra o estado é um **filtro** manual no lineup
(`src/components/lineup/LineUpFilters.tsx:86`, "Sem manifesto") — que depende de alguém lembrar de
aplicá-lo.

### Correção recomendada

Emitir `upsert_alert_item('bl_sem_manifesto_mercante', 'bl', p_bl_id, ...)` em `set_bl_cod` e um trigger
`AFTER DELETE` em `manifestos_mercante` que faça o mesmo para os B/Ls órfãos; ou corrigir 057 e
`CONTEXT.md` para não prometer uma pendência que não existe.

---

## P2 — LACUNA DE DESIGN: manifesto aduaneiro sem trilha de auditoria e com DELETE aberto

- **Frente:** 5/8 — Manifesto e segurança
- **Arquivo:** `supabase/migrations/053_manifestos_mercante_dominio.sql:35-55`

Verificado no catálogo vivo:

- `pg_trigger` em `public.manifestos_mercante`: **nenhum**. `bl_containers` e `bl_breakbulk_items` têm
  `audit_row_changes` (`002:22953,22961`); a tabela que guarda o número oficial do manifesto aduaneiro
  não tem. Criar, renumerar ou excluir um manifesto não deixa registro.
- `manifestos_mercante_write_policy FOR ALL TO authenticated USING is_active_user()`: **qualquer usuário
  interno ativo pode DELETE**. As políticas equivalentes das tabelas de filhos de B/L exigem
  `is_admin()` (`002:24536`, `002:24575`).
- `updated_at` tem `DEFAULT now()` mas nenhum trigger o atualiza.

Combinado com o `ON DELETE SET NULL` acima: um usuário não-admin pode desvincular todos os B/Ls de um
manifesto com um único DELETE, sem deixar rastro.

### Correção recomendada

`CREATE TRIGGER audit_manifestos_mercante AFTER DELETE OR UPDATE ON public.manifestos_mercante FOR EACH
ROW EXECUTE FUNCTION public.audit_row_changes('id')` e separar a policy de DELETE exigindo `is_admin()`.

---

## P2 — LACUNA DE DESIGN: `UNIQUE (numero)` global no manifesto mercante

- **Frente:** 5 — Manifesto Mercante
- **Arquivo:** `supabase/migrations/053_manifestos_mercante_dominio.sql:17`

O índice de apoio é `(voyage_id, pol, pod)` — não único, o que suporta corretamente N manifestos por rota.
Mas a constraint de unicidade é **global por número**, sem escopo de viagem, armador ou exercício fiscal.
Números de manifesto se repetem entre armadores e entre anos; a primeira colisão legítima trava a
operação. `manifestosMercanteService.ts:56` traduz o 23505 numa mensagem amigável — a mensagem está certa,
a constraint é que é ampla demais.

### Correção recomendada

`UNIQUE (voyage_id, numero)` ou `UNIQUE (numero, pol, pod, voyage_id)`, conforme a regra aduaneira que o
domínio adotar. A decisão merece registro em ADR.

---

## P2 — CÓDIGO COM DEFEITO: proteções de quebra de página da fatura apontam para seletores órfãos

- **Frente:** 3 — Fatura de taxas locais
- **Arquivos:** `src/index.css:5311-5319`; `src/components/billing/InvoiceDocumentLocal.tsx:302-331`

O bloco `@media print` protege, com o comentário "(DOC-03)":

```css
.invoice-document__totals,
.invoice-document__pix-box,
.invoice-document__group-bar,
[data-testid='invoice-pix-box'],
[data-testid='invoice-totals'] { break-inside: avoid !important; }
```

Busca em todo `src/**/*.{ts,tsx}`: **nenhum** desses cinco seletores é emitido por componente algum. A
remodelagem da fatura em três blocos (commit `149bc48`) passou a marcação para estilos inline
(`InvoiceDocumentLocal.tsx:302-331`) e as proteções ficaram apontando para o vazio.

O que sobrevive é genérico e continua funcionando: `.invoice-print-content tr { break-inside: avoid }`,
`thead { display: table-header-group }`. O que se perdeu é específico do bloco PIX — hoje uma `<div>` sem
classe — que pode ser partido entre o QR Code e a linha digitável.

Agravante independente: a linha digitável é um `<span>` com
`whiteSpace: 'nowrap'` e `fontSize: '6.5px'` (`InvoiceDocumentLocal.tsx:327`). Em `@page size: A4` com
`max-width: 198mm` e `padding: 8mm`, cabem ~176 caracteres; um payload Pix EMV dinâmico passa de 180.
Em mídia paginada não há rolagem horizontal: o excedente é cortado.

`src/components/billing/__tests__/InvoicePrintCssContract.test.ts` passa porque só verifica que as
strings existem em `src/index.css`; nunca verifica que algum componente as emite.

### Correção recomendada

Reintroduzir `data-testid="invoice-pix-box"` e `data-testid="invoice-totals"` na marcação, trocar
`whiteSpace: 'nowrap'` por `wordBreak: 'break-all'` na linha digitável, e estender o teste de contrato
para asserir a presença dos seletores no componente renderizado, não no CSS.

---

## P2 — LACUNA DE DESIGN: o gate de migration destrutiva é documental, não executável

- **Frente:** 1/8 — Migrations e governança
- **Arquivos:** `supabase/migrations/061_bl_weight_semantics_and_triggers.sql:44-58`;
  `scripts/check-destructive-migrations.mjs:18-35`; `CLAUDE.md:82-90`

A afirmação "Data status" em `CLAUDE.md:82-90` é boa prática: datada (2026-09-18), com dono declarado e
revogável. O gate de CI verifica que o cabeçalho da migration a cita. Mas ele verifica **texto**, não
comportamento: o `UPDATE public.bls SET total_weight_kg = NULL` da 061 roda em qualquer banco onde a
migration for aplicada — um backup de produção restaurado, um ambiente futuro, uma homologação com dados
reais — sem nada verificar se a afirmação ainda vale no momento da execução.

### Correção recomendada

Acrescentar uma asserção em tempo de execução na própria 061, que falha alto em vez de apagar em
silêncio:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bls WHERE financial_status IN ('invoiced','paid','partially_paid')) THEN
    RAISE EXCEPTION 'A 061 apaga total_weight_kg. Ha B/L faturado neste banco: a afirmacao "Data status" do CLAUDE.md nao se aplica aqui. Revise antes de aplicar.';
  END IF;
END $$;
```

---

## P3 — CÓDIGO COM DEFEITO: relatório operacional mostra peso por linha divergente do total

- **Frente:** 2 — Semântica de peso
- **Arquivos:** `src/pages/Relatorios.tsx:261`; `src/services/reports.ts:107,273`

A coluna "Peso (kg)" (`Relatorios.tsx:230`) renderiza `Number(row.total_weight_kg ?? 0)` — só o
componente conteinerizado. O agregado da mesma tela usa `blTotalWeightKg(row)` (`reports.ts:107,273`), que
soma os dois. Depois do backfill da 061, um B/L de carga solta puro tem `total_weight_kg = NULL`: a linha
exibe **0** e o total exibe as 20 t.

### Correção recomendada

`{Number(blTotalWeightKg(row)).toLocaleString('pt-BR')}` em `Relatorios.tsx:261`.

---

## P3 — LACUNA DE DESIGN: cliente sem contato ativo é suprimido do NOB em silêncio

- **Frente:** 6 — Comunicações e NOB
- **Arquivo:** `supabase/migrations/060_pr698_claude_review_followup.sql:1178-1196`

O agrupamento do NOB faz `LEFT JOIN public.customer_contacts cc` imediatamente seguido de
`JOIN public.customer_contact_box_links ccb ON ccb.contact_id = cc.id`. O INNER JOIN anula o LEFT JOIN:
cliente sem contato ativo desaparece da consulta inteira, sem alerta e sem fila de exceção.

O único alerta correlato, `review_customer_email_missing` (`060:836-844`), só dispara quando há B/L com
`review_status = 'pending_review'`. Um B/L já revisado cujo cliente teve os contatos desativados depois
não produz NOB **nem** alerta.

O padrão LEFT-JOIN-seguido-de-INNER-JOIN sugere que a intenção era preservar o cliente sem contato e ela
se perdeu.

### Correção recomendada

Trocar o INNER JOIN por `LEFT JOIN ... AND ccb.box_code = 'documentacao_operacao'`, mover os filtros de
contato para o `FILTER` da agregação e emitir `upsert_alert_item('nob_sem_destinatario', ...)` quando
`emails` vier vazio.

---

## P3 — Contrato vivo em desacordo com o schema executável

- **Frente:** 8 — Governança
- **Arquivos:** `CONTEXT.md:747`; `docs/RASTREABILIDADE.md:612`

Duas afirmações desmentidas pelo catálogo:

1. Ambos os documentos dizem que a segregação de vazios usa **`is_empty`**. As colunas reais de
   `manifestos_mercante` são `id, voyage_id, pol, pod, numero, natureza, created_at, updated_at` — o
   discriminador é `natureza CHECK (natureza IN ('carga','vazio'))`.
2. `RASTREABILIDADE.md:612` declara o controle de acesso como *"usuário autenticado ativo lê/escreve;
   **admin deleta**"*. A policy real é `FOR ALL TO authenticated USING is_active_user()` — não existe
   restrição de admin para DELETE. O documento afirma uma fronteira de segurança inexistente.

`npm run docs:check` passa (222 documentos, 49 rotas): ele não confronta afirmação com schema.

---

## Hipóteses investigadas e REFUTADAS

Registradas porque descartá-las sem evidência seria o mesmo erro que apontar defeito sem evidência.

| Hipótese | Veredito | Evidência |
| --- | --- | --- |
| Vazamento de GUC no pool (Supavisor) | **Refutada** | Os 7 `set_config` de 059/060 usam `is_local = true`. Medido: o GUC volta a vazio após COMMIT **e** após ROLLBACK; e é revertido pelo rollback de subtransação de um bloco `EXCEPTION`. |
| Bitributação da taxa documental em B/L misto | **Refutada** | Com DOC nas duas tabelas, só a do contêiner é cobrada (`056:340-343`). O defeito é o oposto — ver P1 acima. |
| Contadores fantasma / dupla contagem nos filtros | **Refutada** | Medido: sem filtro 3 B/Ls / 73 t; `container` 2 / 53 t; `carga_solta` 2 / 48 t; `misto` 1 / 28 t. Nenhum documento contado duas vezes. |
| Faturamento cego à pendência de terminal | **Refutada** | Gate 6 de `mark_bl_ready_for_billing` (`056:132-137`) levanta exceção com `check_bl_terminal_pendencies`. Ressalva: o gate roda no "marcar pronto", não no faturar — um conflito que surja depois não é reavaliado (TOCTOU, não medido). |
| Terminal incompatível com o POD via acesso direto | **Refutada** | `set_bl_terminal_override` valida `d.port_id = p_pod_port_id` **e** `normalize_port_code(p.locode) = normalize_port_code(v_bl.pod)` (`059:479-491`); `guard_bl_terminal_override` bloqueia UPDATE direto fora da RPC; FK composta com `ON DELETE RESTRICT`. |
| Contato desativado recebendo alerta (M1) | **Refutada** | `deactivated_at IS NULL` presente nas quatro consultas de contato de 060 (linhas 820, 1043, 1104, 1190). |
| Impressão da fatura em branco / sem cabeçalho repetido | **Refutada** | `.invoice-print-content` é aplicado pelo pai (`InvoiceDetailModal.tsx:582`, `PortalBilling.tsx:258`); `thead { display: table-header-group }` repete cabeçalho. Só as proteções específicas do PIX/totais se perderam — ver P2. |
| Isolamento de tenants em manifestos | **Não aplicável** | `is_active_read_user()` é `user_profiles.active`; não há coluna de agência/organização no modelo. O sistema é mono-tenant. |
| Imprecisão de ponto flutuante quebrando gates de peso | **Parcialmente confirmada, sem impacto** | `blTotalWeightKg` produz resíduo binário (8,13 t → 8130.000000000001 kg; 1,005 t → 1004.9999999999999 kg). Nenhum consumidor faz comparação de igualdade ou usa limiar exato sobre esse valor; os gates comparam `> 0`. Cosmético enquanto ninguém exibir sem arredondar. |
| Deadlock no recálculo concorrente | **Não reproduzido** | `_recalculate_bl_cargo_mode` faz `SELECT ... FOR UPDATE` no pai **antes** de ler os filhos (`060:78-82`), o que impõe ordem de aquisição consistente. Um teste de concorrência real sob volume não foi executado; a ordenação do lock é a defesa correta. |

Observação fora do escopo desta PR: `reconcile_voyage_operation_alerts_on_terminal_change`
(`002:15617-15625`) captura `WHEN OTHERS` e degrada para `RAISE WARNING`. Durante a execução da suíte da
PR o aviso aparece de fato ("Reconciliação de alertas de terminal ignorada … permission denied"): a
reconciliação de alertas de terminal falha em silêncio. É pré-existente, mas a PR 698 torna o caminho de
terminal central.

---

## Veredito

### Quantitativo

| Severidade | Bugs de implementação | Lacunas não previstas | Total |
| --- | --- | --- | --- |
| P0 | 1 | 0 | 1 |
| P1 | 2 | 2 | 4 |
| P2 | 1 | 4 | 5 |
| P3 | 1 | 2 | 3 |
| **Total** | **5** | **8** | **13** |

Hipóteses refutadas com evidência: 9.

### Parecer: **BLOQUEADO**

O bloqueio se apoia em um único achado, e ele é suficiente. O P0 do motor de taxas não é um caso de
borda: dispara no estado normal de um B/L misto cuja carga solta ainda não foi pesada, produz linha
`calculated` (não vai para revisão), atravessa todos os gates de `mark_bl_ready_for_billing` e chega à
fatura do cliente com erro proporcional ao peso conteinerizado — R$ 82.500 no lugar de R$ 32.650 no
cenário medido. É exatamente o fallback que o design da PR chama de "proibido" e que a migration 061 diz
ter eliminado: a 061 corrigiu o resumo operacional e esqueceu o motor financeiro, que é onde o fallback
custa dinheiro.

O P1 do guarda pós-faturamento é o segundo motivo. A PR afirma, no corpo e nos testes, uma proteção que
só existe para transições de modalidade; adicionar 20 contêineres a um B/L faturado não produz sinal
algum. Os dois achados compartilham a mesma causa estrutural: **a PR trocou a semântica das colunas de
peso e do gate de modalidade, mas não varreu todos os consumidores dessa semântica.**

Nada disso desmerece o trabalho. A separação das colunas disjuntas é a decisão certa e está bem
argumentada na 061; a supressão anti-bitributação, a resolução de duas tabelas, os triggers
statement-level com transition tables, a ordem de aquisição de lock e a afirmação "Data status" datada e
revogável são todos acima da média. O problema não é a direção — é o raio de varredura.

### Ações antes do merge

**Bloqueantes:**

1. Remover o fallback de `056:366-371` e fazer a linha de `weight_ton` ir para `review_required` quando o
   peso solto não estiver declarado em B/L `carga_solta`/`misto`.
2. Trocar a comparação de posto de modalidade por comparação de conteúdo faturável em
   `_recalculate_bl_cargo_mode` e `trg_sync_bl_weight_cargo_mode`, cobrindo também `container`→`container`.
3. Tornar a supressão do item `bl` da tabela de carga solta condicionada à existência de substituta na
   tabela de contêiner.
4. Fazer `src/integration/pr698Auditoria.local-pg.test.ts` passar e incluí-lo no gate de integração SQL
   da CI.

**Antes do deploy, não necessariamente antes do merge:**

5. Redirects de `/carga-solta`, `/carga-solta/:id` e `/manifestos`, com o ajuste correspondente em
   `navigationLinks.test.ts`.
6. Decidir a fonte de verdade entre `voyage_route_ce_master` e `manifestos_mercante`, e alinhar
   `CONTEXT.md:742-745`.
7. Trigger de auditoria e policy de DELETE restrita a admin em `manifestos_mercante`.
8. Corrigir `CONTEXT.md:747` (`is_empty` → `natureza`) e `RASTREABILIDADE.md:612` (o "admin deleta" que
   não existe).
9. Asserção de execução na 061 contra bancos com B/L faturado.
