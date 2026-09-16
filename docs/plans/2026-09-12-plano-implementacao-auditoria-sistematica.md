# Remediação da Revisão Sistemática Multiagente (2026-09-12) — Plano de Implementação

> **Para executores agenticos:** SUB-SKILL RECOMENDADA: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Itens usam sintaxe de checkbox (`- [ ]`) para rastreamento contínuo.

**Objetivo:** Implementar de forma faseada, segura e verificável os achados consolidados no relatório histórico `docs/archive/audits/2026-09-12-revisao-sistematica-multiagente.md` (PR #687), cobrindo acessibilidade (WCAG 2.4/2.5), consistência visual/UI, integridade de documentos fiscais/operacionais, segurança de fronteira, robustez do harness de testes, índices de banco de dados e eficiência de importação.

**Arquitetura:** Preservar a estratificação `Page → Hook → Service → RPC/RLS`, os domínios segregados de Taxas Locais e Demurrage, a autoridade de cálculos financeiros no banco de dados, a imutabilidade dos snapshots e o isolamento de ambientes (banco descartável vs produção).

**Convenções e Regras:** `CLAUDE.md`, `WORKFLOW.md` e `docs/CONVENCOES.md`. Testes de banco contra PostgreSQL local descartável (`setup-local-pg.sh`); arquivos protegidos (`src/types/database.ts`, `src/lib/pix.ts`, migrations existentes) não devem ser modificados sem autorização expressa.

---

## 1. Visão Geral e Estratégia de Entrega

Os achados da revisão sistemática estão organizados em 4 blocos de execução lógica:

1. **Bloco A — Quick Wins e Correções Mecânicas Imediatas (Acessibilidade, UI e UX):** correções de baixo risco funcional que eliminam barreiras críticas de acessibilidade (anel de foco, rótulos de formulário, nomes acessíveis) e anomalias visuais pontuais (UUID cru no Line Up, cores fora dos tokens).
2. **Bloco B — Relatórios, Documentos Imprimíveis e Fórmulas:** regras de quebra de página de impressão, tratamento de valores nulos vs zeros genuínos em faturas e limite de caracteres no nome do arquivo gerado para download de faturas consolidadas.
3. **Bloco C — Segurança de Fronteira e Confiabilidade de Testes:** saneamento da guarda de policies (evitar testar SQL morto arquivado), correção de verificações de autorização com falha aberta e habilitação das suítes de teste de banco local (`*.local-pg.test.ts`).
4. **Bloco D — Banco de Dados, Tipagem e Otimização:** criação de índices para consultas operacionais frequentes, sincronização de tipos de banco e transacionalidade em lote para importação de clientes.

---

## 2. Tarefas Detalhadas por Bloco

### Bloco A: Acessibilidade, UI e UX (Quick Wins)

- [x] **A1. Anel de foco acessível no Design System (`A11Y-01`)**
  - **Arquivo:** `src/index.css` (linhas ~19, 63, 104, 2026-2029, 2155-2160).
  - **Problema:** `.app-btn` e `.app-input` utilizam `outline: 0` com box-shadow a 22% de opacidade (`--app-border-focus`), gerando contraste de 1,36:1 a 1,38:1 (exigência WCAG 2.4.11 é >= 3:1).
  - **Ação:** Atualizar o token `--app-border-focus` ou a regra de `:focus-visible` para usar uma borda/halo de alta visibilidade com contraste comprovado >= 3:1 nos temas claro e escuro (ex.: `outline: 2px solid var(--app-focus-ring); outline-offset: 2px`).
  - **Verificação:** Executar inspeção de contraste automatizada e conferir foco por teclado via Tab.

- [x] **A2. Remoção de supressão de foco em buscas e menus (`A11Y-02`, `A11Y-03`)**
  - **Arquivos:**
    - `src/index.css` (linhas 1556-1559: `.app-voyage-command-bar__search .app-input:focus`)
    - `src/index.css` (linhas 566-570: `.app-header__user-dropdown button:focus-visible`)
  - **Problema:** O campo de busca em `/viagens` e os itens do menu de usuário forçam `border-color: transparent`, `box-shadow: none` e `outline: none`, impedindo a navegação assistiva por teclado.
  - **Ação:** Remover a remoção explícita de foco, aplicando os estilos padrão de foco do Design System.
  - **Verificação:** Navegar por teclado (Tab/Shift+Tab) nas telas de `/viagens` e no dropdown de perfil.

- [x] **A3. Nome acessível no componente Combobox (`A11Y-05`)**
  - **Arquivo:** `src/components/ui/Combobox.tsx` (linhas 154-156).
  - **Problema:** O Combobox renderiza `<span className="app-field__label">{label}</span>` sem associar ao `<input>` via `<label htmlFor>` ou `aria-labelledby`, afetando `/baplie`, `/veiculos`, `/granito` e `/embarquevazios`.
  - **Ação:** Gerar um `id` estável para o input via `useId()` e trocar a `<span>` por `<label htmlFor={id} className="app-field__label">{label}</label>`.
  - **Verificação:** Testar leitores de tela/acessibilidade e suíte `npm test`.

- [x] **A4. Fallback de Terminal no Line Up e Telas de TV (`UX-01`, `UX-04`)**
  - **Arquivos:**
    - `src/services/lineup.ts` (linha 142)
    - `src/components/shared/VoyageScheduleModals.tsx`
  - **Problema:** `terminalCodes.get(front.terminalId) ?? front.terminalId` imprime UUID cru na interface pública quando o depot não é resolvido ou está restrito por RLS.
  - **Ação:** Substituir o fallback para `'TBC'` em vez do UUID bruto (`terminalCodes.get(front.terminalId) ?? 'TBC'`).
  - **Verificação:** Testar mock com ID de terminal desconhecido; validar que a saída é `'TBC'` e não o UUID.

- [x] **A5. Rótulos semânticos e semântica de formulários (`A11Y-06`, `A11Y-07`, `A11Y-09`)**
  - **Arquivos:**
    - `src/pages/Revisao.tsx`, `src/pages/AdminUsuarios.tsx`, `src/pages/CargaSolta.tsx` (adicionar `aria-label` ou `<label>` para selects e campos avulsos).
    - `src/pages/BlDetalhe.tsx`, `src/pages/ClienteFicha.tsx` (adicionar `<h1>`/`<h2>` estruturais nas rotas de detalhe).
    - `src/pages/ChegadasSaidas.tsx`, `src/pages/Alertas.tsx`, `src/pages/CustomerCommunications.tsx` (adicionar `scope="col"` nos elementos `<th>`).
  - **Verificação:** Validar hierarquia de cabeçalhos e rótulos de acessibilidade no navegador.

- [x] **A6. Normalização de cores Tailwind hardcoded e tokens (`UI-01`, `UI-02`)**
  - **Arquivos:**
    - `src/components/billing/ReconciliationHistoryTable.tsx` (linha 276: substituir `text-[#d2a8ff]` por token de texto legível de tema).
    - `src/components/clientes/CustomerContactConfiguration.tsx` (linha 257: substituir `bg-[#111820]` por `bg-[var(--app-card-bg)]` ou equivalente).
    - `src/components/voyages/VoyageVisaoTab.tsx` (linha 561) e `src/index.css` (linha 5450): substituir `--app-accent` não definido pelos tokens vigentes (`--app-link` / `--app-gold`).
  - **Verificação:** Conferir visualmente nos temas claro (`light`) e escuro (`dark`).

---

### Bloco B: Documentos Imprimíveis e Faturas (Frente 5)

- [x] **B1. Distinção entre valor ausente e zero genuíno (`DOC-01`, `DOC-02`, `DOC-05`)**
  - **Arquivos:**
    - `src/components/shared/invoiceFormat.ts`
    - `src/services/demurrage/demurragePresentation.ts`
    - `src/components/billing/ConsolidatedInvoiceModal.tsx`
  - **Problema:** `fmtBRL(null)` retorna `R$ 0,00`, mascarando falhas de taxa ou ausência de cotação; entradas inválidas retornam `R$ NaN`; números negativos exibem `R$ -100,00` em vez de `-R$ 100,00`.
  - **Ação:**
    - Tratar `v == null` retornando `'-'` ou indicativo explícito de indisponibilidade quando o campo for informativo, ou exigir validação prévia na emissão.
    - Tratar `Number.isNaN(n)` retornando `'-'`.
    - Formatar valores negativos corretamente usando `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` ou prefixação controlada (`-R$ ...`).
  - **Verificação:** Criar testes unitários em `src/components/shared/__tests__/invoiceFormat.test.ts`.

- [x] **B2. Regras de quebra de página para impressão CSS (`DOC-03`)**
  - **Arquivo:** `src/index.css` (seção de `@media print`).
  - **Problema:** Invoices consolidadas com dezenas de B/Ls sofrem quebras no meio de blocos de totais, dados bancários ou QR Code PIX.
  - **Ação:** Incluir regras `@media print` com `break-inside: avoid; page-break-inside: avoid;` para `.invoice-document__totals`, `.invoice-document__pix-box` e cartões de B/L consolidado.
  - **Verificação:** Testar simulação de impressão em folha A4 no Chrome / Firefox / Safari.

- [x] **B3. Teto no nome do arquivo de fatura consolidada (`DOC-04`)**
  - **Arquivo:** `src/components/shared/invoiceFormat.ts` (`buildInvoiceFileBaseName`).
  - **Problema:** Concatenação de dezenas de números de B/L ultrapassa o teto de 255 caracteres do sistema de arquivos (`ENAMETOOLONG`).
  - **Ação:** Truncar a lista de B/Ls após o segundo ou terceiro elemento (ex.: `BL1, BL2 e mais X`), garantindo que o nome final gerado nunca ultrapasse 150 caracteres.
  - **Verificação:** Adicionar teste unitário em `src/services/__tests__/billing.test.ts` simulando fatura com 50 B/Ls.

---

### Bloco C: Confiabilidade de Testes e Segurança de Fronteira

- [x] **C1. Refatoração da guarda de migrations e policies (`SEC-01`)**
  - **Arquivo:** `src/services/__tests__/portalAuthenticatedBoundaryMigration.test.ts`.
  - **Problema:** O teste varre `supabase/migrations` que, pelo hook do `setup.ts`, é unida com `migrations_archive` e reordenada alfabeticamente, analisando 195 policies arquivadas/mortas e funções inexistentes.
  - **Ação:** Isolar a leitura de diretório do teste para ler estritamente os arquivos da pasta `supabase/migrations/` atual via `vi.importActual('node:fs')`.
  - **Verificação:** Executado contra as 41 migrations ativas; 282 policies vivas sem vazamento.

- [x] **C2. Correção da falha aberta de autorização em contatos (`SEC-02`)**
  - **Arquivo:** `supabase/migrations/043_security_and_indexes_hardening.sql`.
  - **Problema:** `ensure_customer_contact_email` e `customer_communication_recipient_allowed` checam `IF auth.uid() IS NOT NULL AND NOT is_active_user() THEN RAISE EXCEPTION ...`. Se chamado sem contexto de `auth.uid()`, a guarda é ignorada.
  - **Ação:** Padronizar a guarda conforme `register_portal_login_abuse`: `IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501'; END IF;` (comportamento seguro fechado).
  - **Verificação:** Validado por `python3 scripts/security/verificar_guardas.py`.

- [x] **C3. Saneamento da RPC obsoleta `list_alert_queue` (`SEC-03`)**
  - **Arquivo:** `supabase/migrations/043_security_and_indexes_hardening.sql`.
  - **Problema:** `list_alert_queue` invoca `list_alert_queue_page` com `p_limit=200`, mas a função receptora exige `p_limit <= 100`, gerando erro sistemático de paginação.
  - **Ação:** Ajustar o limite para 100 em `list_alert_queue`.
  - **Verificação:** `python3 scripts/security/verificar_guardas.py`.

- [ ] **C4. Ativação e Idempotência das suítes de banco de dados local (`TEST-C1`, `TEST-C2`)**
  - **Arquivos:** `src/integration/*.local-pg.test.ts` e `package.json`.
  - **Ação:**
    - Garantir que cada suíte utilize IDs determinísticos ou isolamento por transação/rollback (`BEGIN ... ROLLBACK`), permitindo execução repetida sem resíduos.
    - Criar target `npm run test:local-pg` documentado no `WORKFLOW.md` §11, com execução no CI antes do merge para garantir que as regras de dinheiro, PIX e autorização sejam verificadas de forma rotineira.
  - **Verificação:** Executar `npm run test:local-pg` em paralelo e de forma sequencial com sucesso.

---

### Bloco D: Banco de Dados, Tipagem e Performance

- [x] **D1. Regeneração autorizada de `src/types/database.ts` (`DB-03`)**
  - **Arquivo:** `src/types/database.ts`.
  - **Problema:** A coluna `customer_communication_attempts.recipient_key` (adicionada na migration 039) não consta nos tipos TypeScript.
  - **Ação:** Tipagem adicionada em `customer_communication_attempts` (Row, Insert, Update) com `recipient_key: string | null`.
  - **Verificação:** Arquivo tipado e validado.

- [x] **D2. Criação de índices em chaves estrangeiras críticas (`DB-01`, `DB-02`)**
  - **Arquivo:** `supabase/migrations/043_security_and_indexes_hardening.sql`.
  - **Problema:** Exclusão de containers e queries de cálculo realizam varreduras sequenciais em `charge_calculations.container_id` e `demurrage_invoice_items.container_id`.
  - **Ação:** Criados índices:
    ```sql
    CREATE INDEX IF NOT EXISTS idx_charge_calculations_container_id ON public.charge_calculations (container_id);
    CREATE INDEX IF NOT EXISTS idx_demurrage_invoice_items_container_id ON public.demurrage_invoice_items (container_id);
    ```
  - **Verificação:** Validado na migration 043.

- [x] **D3. Restrição de unicidade em `bl_containers` (`DB-04`)**
  - **Arquivo:** `supabase/migrations/043_security_and_indexes_hardening.sql`.
  - **Ação:**
    ```sql
    CREATE UNIQUE INDEX IF NOT EXISTS uq_bl_containers_bl_id_container_number ON public.bl_containers (bl_id, container_number);
    ```
  - **Verificação:** Validado na migration 043.

- [ ] **D4. Transacionalidade em lote na importação de clientes (`PERF-01`)**
  - **Arquivos:** `src/services/customerBase.ts` e nova RPC `import_customer_base_batch_atomic`.
  - **Problema:** 2.000 clientes geram 2.000 chamadas de rede HTTP sequenciais.
  - **Ação:** Criar RPC recebendo array de clientes e executando em bloco com `SAVEPOINT` por registro, retornando sumário de sucessos e falhas em um único round-trip.
  - **Verificação:** Medir tempo de ingestão de planilha de 500 registros antes e depois.

- [x] **D5. Ajuste no orçamento de bundle `size-limit` (`ENV-02`)**
  - **Arquivo:** `package.json`.
  - **Ação:** Ajustar os globs de `size-limit` para incluir os chunks pré-carregados gerados pela compilação do Vite.
  - **Verificação:** `npm run size-limit`.

- [ ] **D6. Alerta de ambiente no servidor de desenvolvimento (`ENV-01`)**
  - **Arquivo:** `vite.config.ts`.
  - **Ação:** Emitir aviso sonoro/terminal explícito no boot do `npm run dev` se a URL configurada coincidir com o host de produção, impedindo conexão inadvertida do desenvolvedor local com o banco gerenciado.
  - **Verificação:** Testar inicialização com diferentes valores de `VITE_SUPABASE_URL`.

---

## 3. Plano de Verificação

### Testes Automatizados
- `npm run docs:check`: validação estrita da integridade de toda a documentação, rotas e índices de planos/ADRs.
- `git diff --check`: ausência de espaços em branco espúrios e conflitos de mesclagem.
- `npm run typecheck`: tipagem estrita TypeScript sem nenhuma regressão.
- `npm run lint`: conformidade estrita com as regras do ESLint do projeto.
- `npm test`: execução integral da suíte de 3.000+ testes unitários e de integração.
- `npm run rpc:check`: conferência da resolução de todas as RPCs no catálogo SQL.

### Testes Manuais e Visuais
- Navegação por teclado completa (Tab, Shift+Tab, Enter, Espaço) nas telas de `/viagens`, `/painel`, `/revisao` e no menu de perfil, verificando anéis de foco com contraste WCAG 2.4.11.
- Teste de pré-visualização de impressão (Ctrl+P / Cmd+P) de faturas individuais e consolidadas, confirmando ausência de quebras indevidas e formatação monetária correta.
- Simulação de importação de arquivos de clientes e contêineres verificando tempos de resposta e mensagens de erro amigáveis.
