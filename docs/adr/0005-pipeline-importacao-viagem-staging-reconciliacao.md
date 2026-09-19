# 0005 — Pipeline de importação por viagem, staging e reconciliação

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Manifesto CNTR deixou de ser a entrada documental; cálculo provisório e efeitos recuperáveis substituem a descrição original de billing no import. Contatos usam caixas.
> Rastreabilidade: [ADR 0025](./0025-bl-fonte-documental-unica-container-atd-pol.md), [ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md), [ADR 0064](./0064-caixas-de-comunicacao-e-auditoria-de-contatos.md), [ADR 0065](./0065-inbox-efeitos-e-autoridade-financeira.md); [migration ativa 031](../../supabase/migrations/031_import_effect_consumers.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-09

## Contexto

O sistema recebe dados de fontes heterogêneas: manifestos CNTR, manifestos breakbulk, Baplie EDI, planilhas COSCO/Granito, veículos RoRo, vazios de importação, vazios de exportação, CE Mercante e bases auxiliares de clientes.

Essas fontes não têm o mesmo nível de autoridade. O Baplie descreve containers físicos e flags operacionais; o manifesto descreve dados comerciais e financeiros do B/L; o Granito tem parser e tabelas próprias; veículos não são derivados automaticamente do manifesto CNTR.

## Decisão

Usar a viagem como eixo operacional e manter parsers/importadores especializados por fonte, com staging quando a fonte precisa ser conciliada antes de alterar dados canônicos.

- Manifestos CNTR e BB alimentam `bls`, `bl_containers`, `bl_breakbulk_items`, lotes de importação e erros por linha.
- Baplie EDI entra primeiro em `baplie_containers` como staging por viagem. A conciliação Baplie x Manifesto usa `container_number + voyage_id`; divergências de existência são aviso e divergências de atributo podem ser aceitas pelo operador.
- Baplie pode atualizar flags operacionais como IMO/OOG/status, mas não deve sobrescrever dados financeiros do manifesto.
- Vazios de importação podem vir do Baplie ou de planilha avulsa; vazios de exportação usam fluxo próprio por bookings.
- Granito/COSCO permanece em tabelas próprias (`granite_manifests`, `granite_bls`, `granite_bl_charges`, `granite_rates`), mas é integrado downstream em revisão, taxas e faturamento.
- Veículos RoRo são importados por planilha própria e vinculados a B/L/container quando aplicável.
- Todo parser de arquivo de entrada não confiável deve validar tamanho antes de ler buffer ou chamar `XLSX.read`.

## Consequências

- **Positivas**: novas variações de armador podem ser tratadas em parsers isolados; fixtures de regressão protegem formatos reais; staging evita que uma fonte física destrua dado comercial.
- **Negativas / custos**: downstream precisa combinar `bls` e `granite_bls`; a reconciliação manual permanece necessária para ambiguidades de cliente, peso, CE Mercante e flags divergentes.
- **Alternativa descartada**: forçar todas as fontes em uma única tabela de importação genérica. Isso reduziria arquivos, mas perderia semântica de domínio e aumentaria risco de sobrescrever dados de autoridade diferente.
