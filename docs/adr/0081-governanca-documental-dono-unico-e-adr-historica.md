# 0081 — Governança da documentação: um dono por fato e ADR como registro histórico

Status: aceito — 2026-10-13 (decisões do dono). Aplicada pela
[revisão geral da documentação](../plans/2026-10-13-revisao-geral-documentacao.md).

Refina a seção "Histórico vs arquivo" e a tabela "Responsabilidade de cada
documento" de [CONVENCOES.md](../CONVENCOES.md). Não altera nenhuma regra de
negócio.

## Contexto

Em 2026-10-13 a documentação viva somava cerca de 60 documentos e 80 ADRs; a
última revisão geral era de 2026-09-18/19 e, desde então, entraram 205 commits.
A leitura da estrutura mostrou quatro problemas:

1. **Cadeias de ADRs.** 37 ADRs estavam "supersedidas parcialmente" e nenhuma
   integralmente. Para saber a regra vigente de Demurrage, autenticação do
   Portal ou sign-off do ADR operacional era preciso ler de quatro a seis ADRs
   em sequência e montar a regra de cabeça. O status aparecia em lugares
   diferentes em cada arquivo (linha `Status:` antes ou depois de nota
   editorial, às vezes só no índice).
2. **A mesma regra em até cinco lugares.** `CONTEXT.md` (2.376 linhas),
   `docs/modules/*`, `docs/operations/regras-de-negocio.md`,
   `docs/operations/manual-financeiro.md` e as ADRs descreviam a mesma regra.
   `CONVENCOES.md` dizia que a regra de negócio pertencia ao `CONTEXT.md`;
   `regras-de-negocio.md` dizia que a regra do módulo pertencia ao módulo.
   Cada cópia envelhecia em ritmo próprio: o `CONTEXT.md` ainda chamava de
   "não implementadas" decisões que o índice de ADRs já dava como entregues.
3. **Números de migration ambíguos.** Depois da consolidação da
   [ADR 0062](./0062-consolidacao-migrations-schema-1-0.md), a cadeia ativa
   recomeçou em `001`, enquanto `supabase/migrations_archive/` guarda a cadeia
   anterior `001`–`384`. ADRs antigas citam números da cadeia arquivada
   (`221`, `253`, `274`, `297`…) que hoje também existem na cadeia ativa com
   outro conteúdo.
4. **Documentos datados fora do arquivo histórico,** contra a regra de que
   auditorias e relatórios nascem históricos.

## Decisão

1. **Um dono por fato.** Cada tipo de informação tem um único documento dono;
   os demais apontam para ele com link e não repetem a regra:

   | Informação | Dono |
   |---|---|
   | Termo, entidade, estado e a distinção entre conceitos próximos | `CONTEXT.md` (glossário) |
   | Regra vigente de um domínio, telas e ações | Doc do módulo em `docs/modules/` |
   | Regra que atravessa módulos | `docs/operations/regras-de-negocio.md` |
   | Procedimento do usuário do Financeiro | `docs/operations/manual-financeiro.md` |
   | Caminho da tela até hook, serviço, RPC e tabela | `docs/RASTREABILIDADE.md` |
   | Camadas, integrações, modelo de dados e mapa de rotas | `docs/ARCHITECTURE.md` |
   | Comandos, ambiente, testes, migrations e deploy | `WORKFLOW.md` e `docs/setup/` |
   | Por que decidimos e o que rejeitamos | ADR |
   | O que existe hoje | Código e migrations ativas (prova, não documento) |

2. **`CONTEXT.md` é glossário.** Cada verbete traz o termo, uma definição
   curta, a distinção que evita confusão e o link para o módulo dono da regra.
   Prazos, ramos, exceções, efeitos colaterais e estado de implementação saem
   do glossário para o módulo (ou para `regras-de-negocio.md`, se a regra
   atravessar módulos).

3. **ADRs ficam todas, no lugar e com a numeração estável.** Uma ADR antiga
   guarda o "por que não", que evita reabrir uma decisão já tomada. ADRs não
   são movidas para `docs/archive/` nem apagadas, e o texto original não é
   reescrito. O custo de ler uma ADR antiga como se fosse vigente é resolvido
   assim:
   - toda ADR estendida ou supersedida (parcial ou integralmente) começa, logo
     abaixo do título, por uma faixa **Situação atual** que diz o que não vale
     mais, quais ADRs posteriores mudaram a decisão e em que documento está a
     regra vigente;
   - o índice de ADRs tem as colunas Status, Implementação e "Regra vigente
     em", e a linha `Status:` de cada ADR concorda com o índice;
   - o estado de implementação ("implementada", "parcial: falta X",
     "pendente") é registrado separado do status da decisão.

4. **Migration arquivada é citada como arquivada.** Em documento vivo, um
   número sem qualificação é da cadeia ativa (`supabase/migrations/`). Número
   da cadeia anterior à consolidação é escrito "migration arquivada `NNN`" ou
   com o caminho `migrations_archive/NNN_…`. O texto original das ADRs não é
   reescrito; a faixa e o índice fazem a desambiguação.

5. **Toda divergência é classificada antes de qualquer correção:**
   - **(a) documento defasado, código coerente com a decisão:** corrige-se o
     documento;
   - **(b) código diverge da decisão registrada:** não se reescreve o
     documento para coincidir com o código, porque pode ser um defeito. O
     caso é registrado como decisão pendente e, se for defeito, vira tarefa
     separada; a correção do código não entra na revisão documental, exceto
     quando trivial e autorizada;
   - **(c) documentos se contradizem e o código não resolve:** decisão
     pendente.

6. **Decisões pendentes não travam o trabalho.** Ficam registradas com caso
   prático, opções e recomendação, e são levadas ao dono em lotes por
   domínio. As respostas viram ADR nova, como nas ADRs 0079 e 0080.

7. **Documentos datados nascem históricos.** Auditoria, inventário,
   relatório ou pesquisa com data no nome vai para `docs/archive/`, salvo
   plano ou spec vivos.

8. **O gate documental protege a estrutura.** `npm run docs:check` passa a
   verificar a concordância entre o status de cada ADR e o índice, a presença
   da faixa nas ADRs supersedidas e a ausência de documento datado fora de
   `docs/archive/`, `docs/plans/` e `docs/spec/`.

## Alternativas rejeitadas

- **Arquivar as ADRs supersedidas.** Quebraria links de código, testes e
  documentos, e perderia o "por que não". Nenhuma ADR estava integralmente
  substituída; a dor real eram as cadeias parciais.
- **Consolidar cada cadeia numa ADR nova.** Acrescentaria mais um elo à cadeia
  e duplicaria uma regra que pertence ao módulo. A regra vigente por extenso
  fica no módulo; a ADR explica o motivo.
- **Manter `CONTEXT.md` como dono da regra.** É o primeiro documento que os
  agentes leem e já tinha 2.376 linhas que repetiam os módulos com
  defasagens próprias.

## Consequências

- Para saber a regra vigente, lê-se o módulo; para saber por quê, segue-se o
  link para a ADR. Ninguém precisa montar a regra a partir da cadeia.
- Uma mudança de regra atualiza um documento dono e, se for decisão nova, cria
  uma ADR e a faixa nas ADRs afetadas.
- `CONTEXT.md` fica menor e passa a ser lido como vocabulário; os módulos
  ficam maiores.
- Achados do tipo (b) não são corrigidos silenciosamente na documentação; a
  lista vai ao dono.
