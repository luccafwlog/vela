# Convenções da documentação

## Formato e estilo

- Arquivos em `kebab-case.md`, prosa em **português técnico**, termos de domínio em inglês (BL, invoice, manifest, demurrage, ledger, PIX).
- Diagramas em **Mermaid**.
- Caminhos de código em crases são referências literais; para navegação clicável, use links Markdown relativos.
- Links internos **relativos**.
- Datas em planos/specs e registros históricos; documentos canônicos de módulo mantêm nomes estáveis.

## Estrutura dos módulos

Cada doc de módulo usa estes sete blocos nesta ordem:

1. `## Propósito e escopo`
2. `## Anatomia das telas`
3. `## Catálogo de ações`
4. `## Estado e dados`
5. `## Fluxos e invariantes`
6. `## Testes e validação`
7. `## Notas e divergências`

## Labels de evidência

Afirmações técnicas são calibradas por tipo de prova; as categorias não formam uma ordem de força:

| Label | Quando usar |
|---|---|
| **Código** | A afirmação é verificável por leitura estática do código-fonte |
| **Teste** | Existe um teste automatizado que cobre a afirmação |
| **Runtime** | A afirmação foi verificada em ambiente real (produção ou staging) |
| **Suspeita** | A afirmação não foi verificada — é uma hipótese ou risco conhecido |

Inspeções textuais de migrations devem ser nomeadas **Teste de contrato SQL**, não `Teste`.

## Catálogo de ações

Toda ação catalogada num módulo deve expor esta estrutura de tabela:

```
| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
```

## Histórico vs arquivo

- Arquivos em `docs/` são **documentação viva** — devem refletir o estado atual do sistema.
- Arquivos em `docs/archive/` são **registros históricos** — não devem ser alterados, apenas consultados. Links internos do archive podem apontar para caminhos da época; isso é intencional e o `docs:check` não os verifica.

## Ciclo de vida de planos e specs

Existem exatamente dois destinos para cada tipo de documento, definidos pelo estado de execução:

| Documento | Vivo (pendente) | Concluído |
|---|---|---|
| Plano de implementação | `docs/plans/` | `docs/archive/plans/` |
| Spec / design doc | `docs/spec/` | `docs/archive/specs/` |

- Um **plano é vivo** enquanto não foi totalmente executado. Ao concluir a execução (última task mergeada), mover o arquivo para `docs/archive/plans/` **no mesmo change** e atualizar `docs/plans/README.md`.
- Uma **spec é viva** enquanto nenhum plano foi derivado dela (ou o plano derivado ainda não foi executado e a spec segue sendo consultada). Quando o plano derivado é concluído, a spec acompanha: mover para `docs/archive/specs/`.
- Nomenclatura: `YYYY-MM-DD-<tema>.md` (planos) e `YYYY-MM-DD-<tema>-design.md` (specs). Skills e agentes gravam **diretamente** em `docs/plans/` e `docs/spec/` — nunca em subpastas por ferramenta (ex.: `docs/superpowers/` foi aposentado em 2026-07-18).
- Auditorias, reviews e relatórios de execução datados nascem históricos: gravar direto em `docs/archive/audits/` (auditorias/reviews) ou `docs/archive/reports/` (relatórios de execução).

As regras de agentes e a salvaguarda **Data status** vivem em
[AGENTS.md](../AGENTS.md). Uma checagem documental verde prova links, estrutura
e cobertura de rotas, não execução dos fluxos nem rollout remoto.
