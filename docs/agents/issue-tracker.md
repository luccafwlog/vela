# Issue tracker para agentes

Convenções de rastreamento de trabalho para agentes neste repositório.

## Wayfinding operations

A skill **wayfinder** (`/wayfinder`) cartografa um trabalho grande como um **mapa**
de tickets no rastreador. Neste repositório o rastreador é o **GitHub Issues**
(`luccafwlog/vela`), acessado pelas ferramentas `mcp__github__*`.
Uma sessão de wayfinder que abrir aqui **usa GitHub Issues** — não o fallback de
markdown local.

Este arquivo é o contrato específico do Vela para a skill genérica
`wayfinder`: quando houver diferença, estas operações têm precedência.

### Onde cada coisa vive

- **Mapa:** uma issue com o label **`wayfinder:map`**. Corpo com as seções
  `## Destination`, `## Notes`, `## Decisions so far`, `## Not yet specified` e
  `## Out of scope` (ver a skill). O mapa é índice, não armazém: cada decisão
  vive no seu ticket; o mapa só a resume e linka.
- **Tickets:** **sub-issues** do mapa (via `sub_issue_write`), uma por pergunta.
  Corpo com `## Question`. A ordem das sub-issues reflete prioridade.
- **Tipo do ticket:** um label da família **`wayfinder:<type>`** —
  `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` ou
  `wayfinder:task`.
- **Reivindicação:** ao começar a trabalhar um ticket, aplique o label
  **`wayfinder:claimed`** _antes_ de qualquer trabalho, para sessões concorrentes
  o pularem.
- **Bloqueio:** o GitHub não tem aresta nativa de "blocked by". Expressamos no
  corpo do ticket bloqueado uma linha **`Blocked by:`** listando cada ticket que o
  bloqueia pelo **nome** (com link) + `#número`. Um ticket está **desbloqueado**
  quando toda issue listada em `Blocked by:` está fechada.

### Frontier (o que trabalhar em seguida)

O **frontier** são as sub-issues do mapa que estão **abertas**, **não
reivindicadas** (`wayfinder:claimed` ausente) e **desbloqueadas** (nenhum
`Blocked by:` ainda aberto). Como consultar:

1. Liste as sub-issues abertas do mapa (`sub_issue` / `list_issues` filtrando pelo
   mapa) na ordem em que aparecem.
2. Descarte as que têm `wayfinder:claimed`.
3. Descarte as que ainda têm algum `Blocked by:` apontando para issue aberta.
4. A primeira que sobrar é a próxima, salvo se o humano apontar outra.

### Ao resolver um ticket

1. Poste a resposta como **comentário de resolução** na issue.
2. **Feche** a issue (`state: closed`, `state_reason: completed`).
3. **Anexe um ponteiro** à seção `## Decisions so far` do mapa: uma linha no
   formato abaixo.

   ```
   - [<título do ticket>](<url>) — <gist da resposta>
   ```

4. Crie os tickets recém-surgidos (create → depois wire como sub-issue/bloqueio) e
   gradue a névoa que a resposta tornou especificável, removendo-a do
   `## Not yet specified`.

**Nunca resolva mais de um ticket por sessão.** Cartografar o mapa também é uma
sessão à parte: crie mapa + tickets + arestas e pare, sem resolver tickets.

### Labels usados

| Label | Papel |
|---|---|
| `wayfinder:map` | Marca a issue-mapa. |
| `wayfinder:research` | Ticket de pesquisa (lê código/docs/APIs, entrega resumo). |
| `wayfinder:prototype` | Ticket de protótipo (artefato concreto para reagir). |
| `wayfinder:grilling` | Ticket de conversa/decisão de domínio. |
| `wayfinder:task` | Ticket de trabalho manual (mover dados, provisionar acesso). |
| `wayfinder:claimed` | Sessão reivindicou o ticket; outras pulam. |

Labels são criados automaticamente pelo GitHub ao serem aplicados a uma issue.
