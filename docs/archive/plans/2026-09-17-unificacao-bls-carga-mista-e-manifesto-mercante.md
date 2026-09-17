# Unificação de B/Ls, Carga Mista e Manifesto Mercante — Plano de Implementação Unificado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar o tratamento documental de conhecimentos de embarque sob a rota canônica `/bls` com suporte nativo a carga mista (`cargo_mode = 'misto'`), remodelar a fatura de taxas locais em blocos adaptativos, e implementar o modelo de domínio de Manifesto Mercante como entidade de lançamento (`manifestos_mercante`) eliminando o conceito confuso de "CE Master".

**Architecture:** A arquitetura desacopla a modalidade de carga do manifesto aduaneiro. O Manifesto Mercante vira entidade própria (`manifestos_mercante`) com chave por par de portos e número único global, enquanto o B/L (`bls`) aponta para seu manifesto via FK (`manifesto_mercante_id`) e deriva sua modalidade automaticamente (`container`, `carga_solta`, `misto`) a partir de contêineres físicos e itens de carga solta via trigger de banco. O motor financeiro (ADR 0069) utiliza uma função compartilhada que resolve duas tabelas de preço do POD para B/Ls mistos (aplicando 1x a taxa documental, THD por contêiner e taxa por tonelada sobre o peso solto), e a fatura (`InvoiceDocumentLocal.tsx`) renderiza três blocos transparentes com subtotais dedicados.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, TanStack React Query, Supabase (PostgreSQL 15+ com RLS, RPCs, triggers e constraints), Vitest.

---

## Mapa de Arquivos Afetados

### Banco de Dados & Migrations (Supabase)
- Criar: `supabase/migrations/053_manifestos_mercante_dominio.sql` (Entidade `manifestos_mercante`, FK `bls.manifesto_mercante_id`, par de portos em `vazios_bookings`)
- Criar: `supabase/migrations/054_bl_cargo_mode_misto_trigger.sql` (Constraint `cargo_mode IN ('container','carga_solta','misto')`, trigger de derivação automática, remoção de bloqueio em `validate_bl_breakbulk_item_parent`)
- Criar: `supabase/migrations/055_terminal_bl_heranca_excecao.sql` (ADR 0068: FK composta `(terminal_id, port_id)` em `bls`, verificação de conflito de terminal misto)
- Criar: `supabase/migrations/056_resolucao_taxas_duas_tabelas.sql` (ADR 0069: função `resolve_bl_local_charge_table_ids`, cálculo híbrido, gates de faturamento)
- Testes SQL: `src/test/migrations/053ManifestosMercante.test.ts`, `src/test/migrations/054CargoModeMisto.test.ts`, `src/test/migrations/055TerminalBl.test.ts`, `src/test/migrations/056TaxasDuasTabelas.test.ts`

### Serviços & Ingestão
- Modificar: `src/services/breakbulkImport.ts` (remover bloqueio cruzado de B/L existente como contêiner, parar de carimbar `cargo_mode`)
- Modificar: `src/services/blFreightImport.ts` (permitir enriquecimento de contêineres em B/L existente)
- Modificar: `src/services/chargeRateService.ts` (consumir resolução compartilhada de tabelas de preços)
- Modificar: `src/services/chargeOperationsService.ts` (ajuste do rateio `1/n` e filtros para não zerar misto)
- Modificar: `src/services/reviewBillingAutomation.ts` (permitir faturamento automático de B/L misto ao vincular CE)
- Modificar: `src/services/vaziosExportOperations.ts` (capturar POL e POD para embarque de vazios)
- Modificar: `src/services/manifestosMercanteService.ts` (novo serviço para CRUD e consulta de lançamentos do Mercante)

### Frontend & Telas
- Modificar: `src/routes/appLayoutNav.ts` (menu: remover `/manifestos` e `/carga-solta`, adicionar `/bls`)
- Modificar: `src/AppInterno.tsx` (roteamento: `/bls`, `/bls/:blId`)
- Criar: `src/pages/Bls.tsx` (listagem unificada com filtros de modalidade e badges compostos)
- Modificar: `src/pages/BlDetalhe.tsx` e `src/components/bl/blDetalheHelpers.ts` (exibição harmônica de contêineres + carga solta e badge anti-conflito de terminal)
- Modificar: `src/components/billing/InvoiceDocumentLocal.tsx` (remodelagem modular da fatura com 3 blocos e subtotais)
- Modificar: `src/components/voyages/VoyageManifestosTab.tsx` e `VoyageScheduleModals.tsx` (renomeação de "CE Master" para "Nº de Manifesto Mercante", N manifestos por rota e vazios)
- Modificar: `src/components/ce-mercante/CeMercanteImportModal.tsx` (captura do manifesto no vínculo do CE, remoção do rótulo falso `manifestRef`)
- Modificar: `src/pages/Viagens.tsx`, `src/components/voyages/voyageSummaries.ts`, `src/services/agencyDepartureReport.ts` (agregadores sem duplicidade)
- Modificar: `src/pages/portal/PortalOperacao.tsx` e `src/pages/portal/PortalBilling.tsx` (visão única no Portal)

### Documentação Viva
- Modificar: `docs/ARCHITECTURE.md` (rotas e entidades)
- Modificar: `docs/RASTREABILIDADE.md` (rastreabilidade da rota `/bls`)
- Modificar: `CONTEXT.md` (verbetes: Manifesto Mercante, Modalidade de Carga, Terminal do B/L)
- Modificar: `docs/plans/README.md` (registro deste plano)

---

## Fase 1: Fundação do Banco de Dados & Domínio

### Task 1: Modelagem da Entidade `manifestos_mercante` e Vínculo de B/Ls
**Files:**
- Create: `supabase/migrations/053_manifestos_mercante_dominio.sql`
- Test: `src/test/migrations/053ManifestosMercante.test.ts`

- [ ] **Step 1: Escrever teste de contrato para `manifestos_mercante`**
Criar `src/test/migrations/053ManifestosMercante.test.ts` verificando:
- Existência da tabela `manifestos_mercante` com colunas `id`, `voyage_id`, `pol`, `pod`, `numero`, `natureza`, `created_at`, `updated_at`.
- Constraint `CHECK (natureza IN ('carga', 'vazio'))`.
- Unicidade `UNIQUE (numero)` global.
- Coluna `bls.manifesto_mercante_id` referenciando `manifestos_mercante(id) ON DELETE SET NULL`.
- Colunas `pol text`, `pod text` adicionadas a `vazios_bookings`.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/migrations/053ManifestosMercante.test.ts`
Expected: FAIL com tabela/colunas não encontradas.

- [ ] **Step 3: Criar migration `053_manifestos_mercante_dominio.sql`**
Implementar o DDL:
```sql
CREATE TABLE public.manifestos_mercante (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    voyage_id bigint NOT NULL REFERENCES public.voyages(id) ON DELETE CASCADE,
    pol text NOT NULL,
    pod text NOT NULL,
    numero text NOT NULL,
    natureza text NOT NULL CHECK (natureza IN ('carga', 'vazio')),
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT manifestos_mercante_numero_uniq UNIQUE (numero)
);

CREATE INDEX idx_manifestos_mercante_voyage_rota ON public.manifestos_mercante(voyage_id, pol, pod);

ALTER TABLE public.bls 
ADD COLUMN IF NOT EXISTS manifesto_mercante_id uuid REFERENCES public.manifestos_mercante(id) ON DELETE SET NULL;

CREATE INDEX idx_bls_manifesto_mercante ON public.bls(manifesto_mercante_id);

ALTER TABLE public.vazios_bookings
ADD COLUMN IF NOT EXISTS pol text,
ADD COLUMN IF NOT EXISTS pod text;
```

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/migrations/053ManifestosMercante.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/053_manifestos_mercante_dominio.sql src/test/migrations/053ManifestosMercante.test.ts
git commit -m "feat(db): criar entidade manifestos_mercante e vinculo em bls"
```

---

### Task 2: Modalidade `'misto'`, Trigger de Derivação Automática e Remoção de Bloqueio
**Files:**
- Create: `supabase/migrations/054_bl_cargo_mode_misto_trigger.sql`
- Test: `src/test/migrations/054CargoModeMisto.test.ts`

- [ ] **Step 1: Escrever teste de transição de modalidade e cascata de triggers**
Criar `src/test/migrations/054CargoModeMisto.test.ts` testando:
- Inserção de B/L apenas com contêiner -> `cargo_mode = 'container'`.
- Adição de item em `bl_breakbulk_items` ou `bb_weight_ton > 0` -> transição para `'misto'`.
- Remoção do contêiner -> transição automática para `'carga_solta'`.
- Remoção do item de carga solta -> retorno para `'container'`.
- Validação de que `validate_bl_breakbulk_item_parent` não proíbe pai `'misto'`.
- Invalidação de taxas: transição de modalidade redefine `charge_status = 'not_calculated'` e remove cálculos automáticos antigos (`source = 'auto'`).

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/migrations/054CargoModeMisto.test.ts`
Expected: FAIL.

- [ ] **Step 3: Criar migration `054_bl_cargo_mode_misto_trigger.sql`**
```sql
ALTER TABLE public.bls DROP CONSTRAINT IF EXISTS bls_cargo_mode_check;
ALTER TABLE public.bls ADD CONSTRAINT bls_cargo_mode_check 
  CHECK (cargo_mode IN ('container', 'carga_solta', 'misto'));

CREATE OR REPLACE FUNCTION public.validate_bl_breakbulk_item_parent()
RETURNS trigger AS $$
DECLARE
    v_mode text;
BEGIN
    SELECT cargo_mode INTO v_mode FROM public.bls WHERE id = NEW.bl_id;
    IF v_mode NOT IN ('container', 'carga_solta', 'misto') THEN
        RAISE EXCEPTION 'Modalidade de carga invalida para item de carga solta';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.recalculate_bl_cargo_mode(p_bl_id bigint)
RETURNS void AS $$
DECLARE
    v_has_cntr boolean;
    v_has_bb boolean;
    v_new_mode text;
    v_curr_mode text;
    v_charge_status text;
BEGIN
    SELECT (COUNT(*) > 0) INTO v_has_cntr FROM public.bl_containers WHERE bl_id = p_bl_id;
    
    SELECT (
        COUNT(*) > 0 
        OR EXISTS (SELECT 1 FROM public.bls WHERE id = p_bl_id AND (COALESCE(bb_weight_ton, 0) > 0 OR COALESCE(bb_packages_qty, 0) > 0))
    ) INTO v_has_bb 
    FROM public.bl_breakbulk_items WHERE bl_id = p_bl_id;

    IF v_has_cntr AND v_has_bb THEN
        v_new_mode := 'misto';
    ELSIF v_has_bb THEN
        v_new_mode := 'carga_solta';
    ELSE
        v_new_mode := 'container';
    END IF;

    SELECT cargo_mode, charge_status INTO v_curr_mode, v_charge_status FROM public.bls WHERE id = p_bl_id;

    IF v_curr_mode IS DISTINCT FROM v_new_mode THEN
        UPDATE public.bls 
        SET cargo_mode = v_new_mode,
            charge_status = CASE 
                WHEN charge_status = 'billed' THEN 'billed'
                ELSE 'not_calculated' 
            END,
            updated_at = now()
        WHERE id = p_bl_id;

        IF v_charge_status <> 'billed' THEN
            DELETE FROM public.charge_calculations WHERE bl_id = p_bl_id AND source = 'auto';
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.trg_sync_bl_cargo_mode()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recalculate_bl_cargo_mode(OLD.bl_id);
    ELSE
        PERFORM public.recalculate_bl_cargo_mode(NEW.bl_id);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bl_containers_cargo_mode ON public.bl_containers;
CREATE TRIGGER trg_bl_containers_cargo_mode
AFTER INSERT OR UPDATE OR DELETE ON public.bl_containers
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_cargo_mode();

DROP TRIGGER IF EXISTS trg_bl_breakbulk_cargo_mode ON public.bl_breakbulk_items;
CREATE TRIGGER trg_bl_breakbulk_cargo_mode
AFTER INSERT OR UPDATE OR DELETE ON public.bl_breakbulk_items
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_bl_cargo_mode();
```

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/migrations/054CargoModeMisto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/054_bl_cargo_mode_misto_trigger.sql src/test/migrations/054CargoModeMisto.test.ts
git commit -m "feat(db): adicionar cargo_mode misto com trigger derivador automatico"
```

---

### Task 3: Terminal de Descarga do B/L (ADR 0068) e Trava Anti-Conflito
**Files:**
- Create: `supabase/migrations/055_terminal_bl_heranca_excecao.sql`
- Test: `src/test/migrations/055TerminalBl.test.ts`

- [ ] **Step 1: Escrever teste de herança e trava de terminal**
Testar:
- `bls.terminal_id` como exceção individual auditada (FK composta com validação de porto).
- Se `terminal_id` for NULL, herda da frente da escala.
- Em B/L misto, se frentes apontarem para terminais distintos e B/L não tiver exceção -> gera pendência `review:mixed_bl_terminal_conflict` bloqueando `ready_for_billing`.
- Se tiver exceção individual -> validação passa e toda a carga direciona para o mesmo terminal.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/migrations/055TerminalBl.test.ts`
Expected: FAIL.

- [ ] **Step 3: Criar migration `055_terminal_bl_heranca_excecao.sql`**
Adicionar coluna `terminal_id` em `bls` e implementar função/trigger de conciliação de terminal anti-conflito para B/Ls mistos.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/migrations/055TerminalBl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/055_terminal_bl_heranca_excecao.sql src/test/migrations/055TerminalBl.test.ts
git commit -m "feat(db): implementar terminal do BL com heranca e trava anti-conflito misto (ADR 0068)"
```

---

## Fase 2: Motor de Taxas Locais & Faturamento (ADR 0069)

### Task 4: Função Única Compartilhada de Resolução de Tabelas de Preços
**Files:**
- Create: `supabase/migrations/056_resolucao_taxas_duas_tabelas.sql`
- Modify: `src/services/chargeRateService.ts`
- Test: `src/test/services/chargeResolution.test.ts`

- [ ] **Step 1: Escrever teste para resolução de 1 ou 2 tabelas**
Testar:
- B/L `container` puro -> retorna 1 tabela (`cargo_mode = 'container'`).
- B/L `carga_solta` puro -> retorna 1 tabela (`cargo_mode = 'carga_solta'`).
- B/L `misto` -> retorna 2 tabelas do mesmo POD (tabela de contêiner + tabela de carga solta).
- Se POD não possuir tabela de contêiner ou carga solta -> sinaliza ausência sem quebra silenciosa.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/services/chargeResolution.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar função SQL `resolve_bl_local_charge_table_ids` e atualizar `chargeRateService.ts`**
Criar a RPC no banco e o wrapper TypeScript correspondente.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/services/chargeResolution.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/056_resolucao_taxas_duas_tabelas.sql src/services/chargeRateService.ts src/test/services/chargeResolution.test.ts
git commit -m "feat(billing): implementar resolucao unica de tabelas de taxas (ADR 0069)"
```

---

### Task 5: Cálculo Híbrido de Taxas Locais e Sincronização do Ledger
**Files:**
- Modify: `supabase/migrations/056_resolucao_taxas_duas_tabelas.sql`
- Modify: `src/services/chargeOperationsService.ts`
- Test: `src/test/services/localChargeCalculation.test.ts`

- [ ] **Step 1: Escrever teste para cálculo completo de B/L Misto**
Verificar:
- Cobrança de exatamente 1 BL Fee (suprimindo a do breakbulk).
- Cobrança de THD para cada contêiner em `bl_containers`.
- Cobrança por tonelada/CBM sobre `bb_weight_ton`.
- Sincronização limpa em `charge_calculations` e `bl_receivables` com chave de cálculo determinística.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/services/localChargeCalculation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar cálculo SQL atualizado (`calculate_bl_local_charges` e `resolve_bl_local_charge_items`)**
Atualizar as funções no script de migration e refletir a lógica no frontend (`chargeOperationsService.ts`).

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/services/localChargeCalculation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/056_resolucao_taxas_duas_tabelas.sql src/services/chargeOperationsService.ts src/test/services/localChargeCalculation.test.ts
git commit -m "feat(billing): implementar motor de calculo hibrido de taxas para BL misto"
```

---

### Task 6: Correção de Gates de Faturamento e Automação de Ingestão
**Files:**
- Modify: `supabase/migrations/056_resolucao_taxas_duas_tabelas.sql`
- Modify: `src/services/reviewBillingAutomation.ts`
- Modify: `src/services/breakbulkImport.ts`
- Modify: `src/services/blFreightImport.ts`
- Test: `src/test/services/billingAutomationMixedBl.test.ts`

- [ ] **Step 1: Escrever teste para liberação de prontidão e auto-faturamento**
Verificar:
- `mark_bl_ready_for_billing` aceita B/L misto e não lança exceção `P0004`.
- Worker `_run_import_effect_local_charges` calcula taxas para misto.
- `tryAutoIssueInvoice` em `reviewBillingAutomation.ts` não descarta B/L misto.
- Ingestão em `breakbulkImport.ts` e `blFreightImport.ts` unifica dados sem erro de sobrescrita.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/services/billingAutomationMixedBl.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar correções nos gates e importadores**
Remover filtros restritivos `= 'container'` e descarte de `'misto'`.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/services/billingAutomationMixedBl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/056_resolucao_taxas_duas_tabelas.sql src/services/reviewBillingAutomation.ts src/services/breakbulkImport.ts src/services/blFreightImport.ts src/test/services/billingAutomationMixedBl.test.ts
git commit -m "fix(billing): liberar prontidao de faturamento e automacao para BLs mistos"
```

---

## Fase 3: Rota Canônica `/bls`, Tela Unificada e Ficha do B/L

### Task 7: Roteamento Limpo e Adoção do Menu `/bls`
**Files:**
- Modify: `src/routes/appLayoutNav.ts`
- Modify: `src/AppInterno.tsx`
- Test: `src/routes/__tests__/appLayoutNav.test.ts`

- [ ] **Step 1: Escrever teste de rotas ativas e rotas mortas**
Verificar:
- Menu lateral contém item `BLs` apontando para `/bls`.
- Rotas `/manifestos` e `/carga-solta` não estão presentes no roteador.
- Teste de guarda: falha se `/manifestos` ou `/carga-solta` constar como rota ativa.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/routes/__tests__/appLayoutNav.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modificar `appLayoutNav.ts` e `AppInterno.tsx`**
Atualizar a navegação principal e mapear `/bls` e `/bls/:blId`.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/routes/__tests__/appLayoutNav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/routes/appLayoutNav.ts src/AppInterno.tsx src/routes/__tests__/appLayoutNav.test.ts
git commit -m "feat(routes): unificar navegacao sob rota canonica /bls"
```

---

### Task 8: Implementação da Página Consolidada `Bls.tsx`
**Files:**
- Create: `src/pages/Bls.tsx`
- Delete: `src/pages/Manifestos.tsx`, `src/pages/CargaSolta.tsx`
- Test: `src/pages/__tests__/Bls.test.tsx`

- [ ] **Step 1: Escrever teste para filtros e badges da listagem de BLs**
Verificar:
- Renderização dos filtros `[Todos]`, `[Contêiner]`, `[Carga Solta]`, `[Misto]`.
- Badges na tabela: `2 CNTR` para contêiner, `38 ton` para carga solta, `1 CNTR + 12 ton` para misto.
- Cards de KPI no topo: Total de BLs únicos, Contêineres, Carga Solta (ton) e Status Financeiro.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/pages/__tests__/Bls.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Criar `src/pages/Bls.tsx` consolidando o melhor das duas telas antigas**
Montar a interface com TanStack React Query, filtros de modalidade e remoção das páginas legadas.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/pages/__tests__/Bls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/pages/Bls.tsx src/pages/__tests__/Bls.test.tsx
git rm src/pages/Manifestos.tsx src/pages/CargaSolta.tsx
git commit -m "feat(ui): implementar pagina unificada Bls.tsx e remover telas legadas"
```

---

### Task 9: Adaptação da Ficha `BlDetalhe.tsx` e Helpers de Exibição
**Files:**
- Modify: `src/pages/BlDetalhe.tsx`
- Modify: `src/components/bl/blDetalheHelpers.ts`
- Test: `src/pages/__tests__/BlDetalhe.test.tsx`

- [ ] **Step 1: Escrever teste para B/L misto na ficha de detalhe**
Verificar:
- Exibição de badge `Misto (CNTR + Carga Solta)`.
- Renderização conjunta do painel de contêineres e do painel de carga solta na aba Carga.
- Indicação clara do terminal de descarga unificado.
- Botão "Voltar" apontando para `/bls`.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/pages/__tests__/BlDetalhe.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Ajustar `BlDetalhe.tsx` e `blDetalheHelpers.ts`**
Atualizar os painéis e garantir que nenhuma carga seja ocultada por bifurcação binária.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/pages/__tests__/BlDetalhe.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/pages/BlDetalhe.tsx src/components/bl/blDetalheHelpers.ts src/pages/__tests__/BlDetalhe.test.tsx
git commit -m "feat(ui): adaptar ficha BlDetalhe para apresentacao de carga mista"
```

---

### Task 10: Varredura e Ajuste dos 57 Links Internos
**Files:**
- Modify: arquivos com rotas antigas (`/manifestos`, `/carga-solta`)
- Test: `src/test/navigationLinks.test.ts`

- [ ] **Step 1: Escrever teste que varre o repositório contra links mortos**
Testar que não existem links literais para `/manifestos` ou `/carga-solta` em nenhum componente de `src/`.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/navigationLinks.test.ts`
Expected: FAIL listando os links antigos.

- [ ] **Step 3: Atualizar todos os links para `/bls`**
Substituir as referências de navegação.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/navigationLinks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/ src/test/navigationLinks.test.ts
git commit -m "refactor(nav): redirecionar todos os links internos para /bls"
```

---

## Fase 4: Remodelagem da Fatura Adaptativa (`InvoiceDocumentLocal.tsx`)

### Task 11: Remodelagem da Fatura em Blocos e Subtotais
**Files:**
- Modify: `src/components/billing/InvoiceDocumentLocal.tsx`
- Modify: `src/components/shared/invoiceFormat.ts`
- Test: `src/components/billing/__tests__/InvoiceDocumentLocal.behavior.test.tsx`

- [ ] **Step 1: Escrever testes comportamentais para os três cenários de fatura**
Verificar:
1. B/L Misto: Cabeçalho exibe contêineres + peso solto; grade exibe bloco 1 (Carga Conteinerizada), bloco 2 (Carga Solta) e bloco 3 (Taxas Documentais), cada um com seu subtotal e total geral.
2. B/L só Contêiner: O bloco 2 de carga solta não é renderizado.
3. B/L só Carga Solta: O bloco 1 de contêineres não é renderizado.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/components/billing/__tests__/InvoiceDocumentLocal.behavior.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Reformular `InvoiceDocumentLocal.tsx`**
Implementar o layout modular com subtotais destacados e cabeçalho enriquecido.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/components/billing/__tests__/InvoiceDocumentLocal.behavior.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/billing/InvoiceDocumentLocal.tsx src/components/shared/invoiceFormat.ts src/components/billing/__tests__/InvoiceDocumentLocal.behavior.test.tsx
git commit -m "feat(billing): remodelar fatura InvoiceDocumentLocal em blocos modulares adaptativos"
```

---

### Task 12: Visualização no Portal do Cliente
**Files:**
- Modify: `src/pages/portal/PortalOperacao.tsx`
- Modify: `src/pages/portal/PortalBilling.tsx`
- Test: `src/pages/portal/__tests__/PortalOperacao.test.tsx`

- [ ] **Step 1: Escrever teste de exibição no portal**
Verificar:
- Cliente com B/L misto enxerga o documento uma única vez.
- Rastreamento exibe contêineres com prazos de devolução + sumário de peso/volumes soltos.
- Download da fatura emite o modelo remodelado.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/pages/portal/__tests__/PortalOperacao.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Ajustar as telas do portal**
Atualizar os componentes do portal para consumir a visualização unificada.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/pages/portal/__tests__/PortalOperacao.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/pages/portal/PortalOperacao.tsx src/pages/portal/PortalBilling.tsx src/pages/portal/__tests__/PortalOperacao.test.tsx
git commit -m "feat(portal): apresentar BL misto como documento unico e fatura transparente"
```

---

## Fase 5: Manifesto Mercante na Operação e Rotinas Aduaneiras

### Task 13: Renomeação de "CE Master" para "Nº de Manifesto Mercante"
**Files:**
- Modify: `src/components/voyages/VoyageManifestosTab.tsx`
- Modify: `src/components/voyages/VoyageScheduleModals.tsx`
- Modify: `src/components/voyages/VoyageCard.tsx`
- Modify: `src/services/voyageSummaries.ts`
- Test: `src/test/naming/manifestoMercanteNaming.test.ts`

- [ ] **Step 1: Escrever teste de nomenclatura**
Verificar ausência de "CE Master" em labels de UI e presença de "Nº de Manifesto Mercante".

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/naming/manifestoMercanteNaming.test.ts`
Expected: FAIL.

- [ ] **Step 3: Substituir os termos em labels, modais e cards**
Atualizar os textos e títulos de eventos.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/naming/manifestoMercanteNaming.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/voyages/ src/services/voyageSummaries.ts src/test/naming/manifestoMercanteNaming.test.ts
git commit -m "refactor(domain): renomear CE Master para Numero de Manifesto Mercante"
```

---

### Task 14: Suporte a N Manifestos por Rota e Manifestos de Vazios
**Files:**
- Modify: `src/components/voyages/VoyageManifestosTab.tsx`
- Create: `src/services/manifestosMercanteService.ts`
- Test: `src/test/services/manifestosMercanteService.test.ts`

- [ ] **Step 1: Escrever teste para listagem e cadastro de manifestos**
Verificar:
- Capacidade de listar N manifestos para o mesmo par de portos.
- Diferenciação entre natureza `'carga'` e natureza `'vazio'`.
- Associação de contêineres vazios ao seu respectivo manifesto Mercante.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/services/manifestosMercanteService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Criar `manifestosMercanteService.ts` e atualizar `VoyageManifestosTab.tsx`**
Implementar o grid permitindo adicionar múltiplos lançamentos por perna de viagem.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/services/manifestosMercanteService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/services/manifestosMercanteService.ts src/components/voyages/VoyageManifestosTab.tsx src/test/services/manifestosMercanteService.test.ts
git commit -m "feat(manifesto): permitir N manifestos por rota e suporte nativo a vazios"
```

---

### Task 15: Captura no Vínculo do CE e Limpeza do Parser EDI
**Files:**
- Modify: `src/components/ce-mercante/CeMercanteImportModal.tsx`
- Modify: `src/services/blParser.ts`
- Test: `src/components/ce-mercante/__tests__/CeMercanteImportModal.test.tsx`

- [ ] **Step 1: Escrever teste de captura do manifesto**
Verificar:
- Modal de vinculação do CE Mercante oferece campo para informar o Nº de Manifesto Mercante do lote.
- Rótulo equivocado "Manifesto detectado:" oriundo de `tokens[1]` do registro `M` é removido.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/components/ce-mercante/__tests__/CeMercanteImportModal.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Atualizar `CeMercanteImportModal.tsx` e parser**
Implementar a captura oficial e higienizar a leitura de EDI.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/components/ce-mercante/__tests__/CeMercanteImportModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/ce-mercante/CeMercanteImportModal.tsx src/services/blParser.ts src/components/ce-mercante/__tests__/CeMercanteImportModal.test.tsx
git commit -m "feat(ce-mercante): capturar Numero de Manifesto no vinculo de CEs e corrigir parser EDI"
```

---

### Task 16: Tratamento de Change of Destination (COD)
**Files:**
- Modify: `src/services/blChangeOfDestinationService.ts`
- Test: `src/test/services/codManifestoHandling.test.ts`

- [ ] **Step 1: Escrever teste para alteração de destino**
Verificar:
- Ao alterar o POD do B/L: `bls.ce_mercante` permanece inalterado.
- `bls.manifesto_mercante_id` é limpo (`NULL`), gerando pendência operacional de vinculação ao manifesto do novo destino.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/services/codManifestoHandling.test.ts`
Expected: FAIL.

- [ ] **Step 3: Atualizar serviço de COD**
Implementar o desvínculo e criação da pendência.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/services/codManifestoHandling.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/services/ src/test/services/codManifestoHandling.test.ts
git commit -m "feat(cod): desvincular manifesto e gerar pendencia em mudanca de destino"
```

---

## Fase 6: Agregadores de Viagem, Documentação Viva e Validação Final

### Task 17: Agregadores de `/viagens` e Relatório ADR
**Files:**
- Modify: `src/components/voyages/voyageSummaries.ts`
- Modify: `src/services/agencyDepartureReport.ts`
- Modify: `supabase/migrations/056_resolucao_taxas_duas_tabelas.sql`
- Test: `src/test/voyages/voyageAggregatorsMixedBl.test.ts`

- [ ] **Step 1: Escrever teste para indicadores de viagem com B/Ls mistos**
Verificar:
- Contagem de B/Ls únicos não duplica um B/L misto.
- Contêineres do B/L misto somam na contagem de contêineres da escala.
- Carga solta do B/L misto soma na tonelagem da escala.
- Relatório ADR computa a carga solta e contêineres sem omissão.

- [ ] **Step 2: Rodar teste para verificar falha**
Run: `npx vitest run src/test/voyages/voyageAggregatorsMixedBl.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar agregações corrigidas**
Ajustar tanto as funções TypeScript quanto a RPC SQL `operational_list_voyage_summaries`.

- [ ] **Step 4: Rodar teste para verificar aprovação**
Run: `npx vitest run src/test/voyages/voyageAggregatorsMixedBl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/voyages/voyageSummaries.ts src/services/agencyDepartureReport.ts src/test/voyages/voyageAggregatorsMixedBl.test.ts
git commit -m "fix(voyages): corrigir agregadores de escala e relatorio ADR para BLs mistos"
```

---

### Task 18: Atualização de Documentação Viva e Bateria de Verificação
**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/RASTREABILIDADE.md`
- Modify: `CONTEXT.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Atualizar contratos de rotas e entidades em `docs/ARCHITECTURE.md`**
Registrar a rota canônica `/bls`, remoção de `/manifestos` e `/carga-solta`, e a nova entidade `manifestos_mercante`.

- [ ] **Step 2: Atualizar `docs/RASTREABILIDADE.md`**
Substituir as referências de rotas antigas pelo mapeamento completo de `/bls` (componentes, hooks, RPCs e testes).

- [ ] **Step 3: Atualizar verbetes em `CONTEXT.md`**
Registrar a definição oficial de "Manifesto Mercante" (lançamento), a modalidade "Carga Mista" e o terminal do B/L com exceção individual.

- [ ] **Step 4: Indexar este plano em `docs/plans/README.md`**
Adicionar a entrada do plano na tabela de planos ativos.

- [ ] **Step 5: Executar suite completa de verificação**
Run: `npm run docs:check && git diff --check && npm run lint && npm test`
Expected: Todos os comandos devem passar com código 0 (verde).

- [ ] **Step 6: Commit**
```bash
git add docs/ docs/plans/README.md
git commit -m "docs: atualizar contratos vivos e indexar plano de carga mista e manifesto"
```

---

## Plano de Verificação Final

### Testes Automatizados
- `npm run docs:check` — verifica integridade de links, presença das 49 rotas canônicas e cobertura de ADRs.
- `npm test` — bateria completa de testes unitários e de integração de frontend e serviços.
- `npx vitest run src/test/migrations/` — bateria de contratos SQL e migrações.

### Verificação Manual Ponta a Ponta
1. **Ingestão Incremental:** Subir contêiner para o B/L `TESTE-MISTO-01`, depois subir arquivo de carga solta para o mesmo B/L. Verificar se transiciona para `misto` automaticamente.
2. **Cálculo de Taxas:** Abrir a aba de Faturamento do B/L e verificar: 1 BL Fee, THD por contêiner e taxa por tonelada sobre o peso solto.
3. **Emissão de Fatura:** Gerar a fatura em tela/PDF e conferir a divisão clara nos 3 blocos (Contêineres, Carga Solta e Taxas Documentais).
4. **Lançamento de Manifesto:** Na aba de Manifestos da Viagem, registrar dois manifestos para a mesma rota (um de carga e um de vazios) e vincular o B/L.
5. **Portal do Cliente:** Fazer login com o cliente consignatário e verificar se o B/L aparece unificado e se a fatura é idêntica à interna.
