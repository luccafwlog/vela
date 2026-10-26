# Instruções comuns — mapeamento do Vela para o Manual do Operador (Etapa 1)

Você vai mapear **uma área** do Vela (sistema interno da agência marítima
Transhipping; o Cliente usa o Portal Fwlog) para o futuro Manual do Operador.
Leia o plano em `/home/user/vela/docs/plans/2026-10-26-manual-do-operador.md`,
em especial "Princípios", "Escopo completo", "Sumário proposto" e "Etapa 1".

Objetivo da área: **toda regra de negócio que o código implementa hoje** vira
uma linha, escrita como o operador a vê, com destino no manual. Nada pode
ficar de fora. A completude é conferida contra a lista de itens da sua área
(arquivo JSON indicado no seu pedido): **cada item tem de ser citado** no seu
arquivo de saída.

## Fonte de verdade

- O **código** decide: páginas e componentes em `src/`, serviços, hooks e
  `src/lib/`, funções de servidor em `supabase/functions/`, e o banco.
- O banco local `vela_test` tem as 461 migrations aplicadas: a definição que
  vale é a **última**, que está no banco, não a primeira migration que você
  achar. Leia definições assim (só leitura):

  ```bash
  PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d vela_test -At -c \
    "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='NOME'"
  ```

  Gatilho: o item `gatilho:FUNCAO` traz no `detail` as tabelas e os nomes dos
  gatilhos; leia a função. Restrição, único e política: o `detail` já traz a
  definição. Catálogo de alertas: `select * from alert_type_catalog`.
- **Só leitura no banco.** Nunca INSERT, UPDATE, DELETE, DDL, nem chamar
  função que grave. O banco é compartilhado com outras áreas.
- Documentação (`docs/modules/*.md`, `docs/operations/*.md`, `CONTEXT.md`) é
  **mapa** para achar o código, não prova. Onde ela discorda do código, registre
  em Divergências.
- Não edite nenhum arquivo além do seu arquivo de saída. Não faça commit.
  Não rode `npm` nem scripts que gravem.

## Arquivo de saída

`/home/user/vela/docs/manual/cobertura/<AREA>.md` (o `<AREA>` é o nome do seu
JSON, sem `.json`). Português do Brasil, com acentos. Estrutura obrigatória:

```markdown
# Cobertura — <nome da área>

Mapeamento da Etapa 1 do [plano do Manual do Operador](../../plans/2026-10-26-manual-do-operador.md),
lido no código da `staging` em `9839364` e no banco local com as 461
migrations, em 2026-10-26. Cada linha é uma regra como o operador a vê; a
coluna "Itens do código" liga a regra ao que a implementa.

## Regras

| Nº | Regra | Destino | Setores | Itens do código |
|---|---|---|---|---|
| XXX-001 | ... | Op 6 | Todos | `funcao:...`, `rota:/...`, `src/pages/....tsx` |

## Mensagens

| Mensagem | Quando aparece | Destino |
|---|---|---|
| `texto exato da mensagem` | ... | Ap. B |

## Itens sem efeito na operação

| Item | Motivo |
|---|---|
| `restricao:...` | ... |

## Divergências

| Nº | Caso prático | O que o código faz | O que diz a documentação | Classe | Recomendação |
|---|---|---|---|---|---|

## Capturas

| Nº | Tela e estado | Para as regras |
|---|---|---|
```

Seções extras só se o seu pedido mandar.

### Regras

- **Uma regra por linha**: condição → efeito → onde o operador vê. Inclua
  exceções e limites (prazos, quantidades, quem pode). 1 a 4 frases.
- **Linguagem de operação**: nome da página, aba, botão, coluna, filtro,
  status e mensagem **exatamente como na tela** (confira no JSX), em negrito.
  Use os termos de `CONTEXT.md` (Viagem, Escala, B/L, CE Mercante, Baplie,
  Demurrage, Cliente…). Nada de "RPC", "tabela", "trigger", "migration",
  "coluna do banco", "flag", "enum" no texto da regra; o técnico fica só na
  coluna "Itens do código".
- Cubra também regras que só existem na tela (validação de formulário, botão
  desabilitado, aviso, filtro padrão, ordenação, o que aparece vazio, rótulo de
  status, cor) e nas funções de servidor. Cite o arquivo (`src/...`).
- Regras automáticas (o que o sistema faz sozinho depois de uma ação ou de um
  horário) têm destino `Op 15` além do capítulo da ação.
- Prefixo do número: o do seu pedido, com três dígitos (`BLR-001`).

### Destinos (use só estes códigos, combinando com `;`)

| Código | Onde |
|---|---|
| `Op 1` | O Vela e o Portal Fwlog: entrar, perfil, menu, como o Vela fala, rotina diária e Painel, relatórios, quando o sistema falha |
| `Op 2` | Equipes, o que cada perfil pode e não pode, cancelar e excluir, a quem passar |
| `Op 3` | O caminho de uma Viagem do começo ao fim |
| `Op 4` | Viagens, Escalas, datas do navio, Chegadas e Saídas, Line-Up, cadastros de apoio |
| `Op 5` | Importação: arquivo de B/L, CE Mercante, Baplie e demais importações |
| `Op 6` | A ficha do B/L |
| `Op 7` | Revisão |
| `Op 8` | Equipamentos: containers, veículos, Vazios, Granito, Demurrage operacional |
| `Op 9` | ADR de Saída |
| `Op 10` | Desbloqueio de CE |
| `Op 11` | Cadastro do Cliente e Central de Informações |
| `Op 12` | Portal: conta do Cliente e o que ele vê |
| `Op 13` | E-mails que o Cliente recebe |
| `Op 14` | Suporte ao Cliente |
| `Op 15` | Gatilhos e rotinas por horário |
| `Op 16` | Alertas |
| `Op 17` | Financeiro visto pela operação |
| `Ap. A` / `Ap. B` / `Ap. C` / `Ap. D` | Glossário / Mensagens / Status e cores / "Quero fazer… → onde fica" |
| `Fin` | Volume do Financeiro (baixa, conciliação, restituição, cancelamento, tabelas) |
| `Adm` | Volume do Administrativo (usuários, cancelar e excluir, falhas, histórico) |
| `Fora` | Só com motivo na seção "Itens sem efeito na operação" |

Regra que só o Financeiro ou o Administrativo aplica vai para `Fin`/`Adm`; se
a operação depende dela, acrescente o capítulo do operador (`Op 17; Fin`).

### Setores

Quem **pode** fazer (pelo que o banco e a tela aplicam, não pelo que a doc
diz) e quem é **avisado**: `Todos`, `Adm`, `Fin`, `Ope`, `Doc`, `Equ` (combine
com `+`), `Sistema` (o sistema faz sozinho), `Cliente` (pelo Portal). Quando o
banco checa setor (`is_admin`, `is_financial_or_admin`, lista de setores…),
siga o banco.

### Citação dos itens (obrigatória)

- Cada item do seu JSON aparece **entre crases, exatamente como o campo `id`**
  (`funcao:save_bl_review`, `gatilho:guard_x`, `restricao:bls.bls_status_check`,
  `rota:/bls/:blId`…), em pelo menos uma linha de Regras ou de Itens sem efeito.
- **Mensagens**: cada item `mensagem:` aparece na seção Mensagens com o texto
  exato (o campo `name`, sem o prefixo) entre crases, copiado sem mudar nada
  (inclusive `%`, que o sistema troca por um valor). "Quando aparece" em
  linguagem de operação. Destino `Ap. B` quando o operador ou o Cliente pode
  ver; `Fora` só se nunca chega a uma pessoa (rotina interna), dizendo isso.
  Mensagem que é ela mesma uma regra ("só pode ser emitida após…") também vira
  linha em Regras.
- Item que pertence a outra área (a divisão foi automática): mapeie mesmo
  assim, com o destino certo.
- Item sem efeito para o operador (ex.: carimbo de data de atualização,
  limpeza técnica): seção "Itens sem efeito na operação", com o motivo. Use com
  parcimônia: rastro de autor, histórico e auditoria **têm** efeito (aparecem na
  aba Histórico).
- Itens do mesmo tipo e mesmo efeito podem dividir uma linha (por exemplo, as
  restrições de valor não negativo de uma mesma tela).
- Confira antes de terminar:
  `node /tmp/claude-0/-home-user-vela/28856e0b-50c8-5c55-815e-161f0b349494/scratchpad/manual/selfcheck.mjs <AREA>`
  tem de terminar com todos os itens citados.

### Divergências

Compare o código com o documento de módulo da área e com as regras
transversais (`docs/operations/regras-de-negocio.md`) que tocam a área. Só
divergências reais (documento diz X, código faz Y; ou rótulo da doc diferente
do da tela). Classe: `a` documento defasado e código coerente com a decisão;
`b` código diverge da decisão registrada (possível defeito); `c` documentos se
contradizem e o código não resolve. Caso prático com página, ação e efeito.

### Material antigo

Não é roteiro nem lista a responder (decisão do dono). Se quiser, use o texto
em `/tmp/claude-0/-home-user-vela/28856e0b-50c8-5c55-815e-161f0b349494/scratchpad/manual/manual-antigo.txt`
só como referência de redação. Nunca como fonte nem checklist.

### Capturas

As imagens que o manual vai precisar na sua área: tela, aba e estado (ex.:
"Ficha do B/L, aba Faturamento, fatura retida por Conta do Portal não ativa").

## Ao terminar

Responda com: número de regras, de mensagens e de itens sem efeito; o
resultado do selfcheck; as 5 divergências mais importantes; e qualquer ponto
que o código não resolve e precise de decisão do dono.
