# 0068 — Terminal do B/L herdado da Frente de Operação, com exceção individual auditada

Status: aceito — 2026-09-16

Estende a [ADR 0035](./0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md)
e a [ADR 0067](./0067-nob-automatico-ancorado-na-frente-de-operacao.md) quanto à
resolução do terminal de um B/L. Não altera a identidade do ADR
`(viagem, porto, terminal)`.

## Contexto

A spec de unificação de B/Ls institui a modalidade `cargo_mode = 'misto'` — um
mesmo conhecimento de embarque com contêineres e carga solta — e declara como
invariante de negócio que **todo B/L misto descarrega no mesmo terminal**. A
regra é correta na operação: a carga de um mesmo B/L sai do mesmo berço e entra
no mesmo recinto alfandegado.

O problema é que o modelo não tem onde escrevê-la.

**O B/L não carrega terminal.** Não existe coluna de terminal em `bls`, e
nenhuma tabela liga B/L a terminal. O terminal é atributo da **Frente de
Operação**, `voyage_escala_operation_fronts (voyage_id, port, sentido,
modalidade, terminal_id)`, e a ADR 0035 fixou que uma frente pertence a um único
terminal.

**Contêiner e carga solta são frentes diferentes.** Na importação, `modalidade`
distingue `carga_cheia` de `carga_solta`. Um B/L misto tem carga nas duas ao
mesmo tempo. Logo, a única tradução possível da invariante no modelo atual é:

> Se algum B/L misto descarrega no porto P da viagem V, então a frente
> `carga_cheia` e a frente `carga_solta` de (V, P) apontam para o mesmo
> `terminal_id`.

**E essa tradução amarra a escala inteira.** As frentes são do porto na viagem,
não do B/L: todos os demais B/Ls daquela escala usam as mesmas duas frentes. Um
B/L misto com 2 contêineres e 15 toneladas passaria a proibir que os outros 70
contêineres e 200 toneladas da escala fossem planejados em terminais distintos.
Um documento pequeno ditaria o planejamento portuário de documentos com os quais
não tem relação.

### O mesmo vazio já quebra o NOB

A ADR 0067 ancorou o NOB automático na cadeia

```
bls.cargo_mode → modalidade → voyage_escala_operation_fronts.terminal_id
                            → voyage_escala_terminal_state (ATB, id)
                            → anchor_atracacao_id do NOB
```

com dono explícito nos dois lados: `operationFrontKindForCargoMode` em TypeScript
e `public.bl_operation_front_modalidade` em SQL. As duas são funções **totais**
de `cargo_mode`, e as duas terminam em um fallback:

```sql
ELSE 'carga_cheia'
```

`'misto'` cai nesse fallback **em silêncio**. Um B/L misto seria roteado como se
fosse exclusivamente conteinerizado: o cliente receberia o NOB da atracação do
terminal que operou a frente de carga cheia, e a sua carga solta ficaria fora do
roteamento. Comunicação ao cliente endereçada errado, sem erro e sem sinal na
tela.

Isso mostra que o problema não é da fatura nem da tela de viagens: **falta ao
modelo a pergunta "em que terminal este B/L descarregou?"**, e hoje ela só é
respondível através da modalidade, que o B/L misto torna ambígua.

### O precedente do domínio

Omissão de Escala já resolve exatamente esta forma de problema. Um registro
global vive na Viagem (`voyage_omissions`) e vale para todos os B/Ls afetados; a
disposição individual vive no B/L (`bl_transshipments.disposition ∈
{transshipment, cod}`) e é operada na ficha dele. O `CONTEXT.md` descreve a
política: *"o registro global é mantido na Viagem; cada B/L afetado exibe os
dados herdados para consulta e conserva apenas sua ação individual"*.

A diferença a registrar é que COD e Transbordo sobrescrevem o **porto**; o
terminal continua vindo da frente mesmo neles. Esta ADR leva o mesmo padrão um
nível adiante, até o terminal.

Não há operação real: não existem faturas emitidas, ADRs fechados nem
comunicados disparados em produção. Nada precisa de backfill.

## Decisão

**1. O terminal de um B/L é herdado da Frente de Operação.** Este é o
comportamento padrão e permanece o de todos os B/Ls. Nada muda para o B/L
puramente conteinerizado ou puramente de carga solta.

**2. O B/L ganha uma exceção individual de terminal.** `bls.terminal_id`,
nulo por padrão. Nulo significa herança — não "sem terminal". Preenchido, vence
a frente, **sempre e em toda leitura**: ADR, NOB, painéis de escala e faturamento
resolvem o terminal do B/L por uma função única, e não cada um pela sua conta.

A precedência é total e sem exceção porque precedência parcial produz o pior
defeito possível neste domínio: a mesma carga contada em dois terminais
diferentes conforme o caminho de leitura, sem sinal na tela.

**3. A exceção é operada na ficha do B/L**, como a disposição de COD. A escala
edita as frentes; a ficha edita a exceção do documento. A tela de escala exibe
quais B/Ls daquele porto têm terminal próprio, para consulta.

**4. B/L misto sem exceção, com frentes divergentes, é pendência de revisão.**
A herança de um B/L misto só é bem definida quando as duas frentes apontam para
o mesmo terminal. Divergindo, o gate registra
`review:mixed_bl_terminal_conflict` e bloqueia `ready_for_billing`.

A remediação é **definir o terminal daquele B/L**, não replanejar a escala. A
pendência continua existindo, mas o seu custo deixa de recair sobre os demais
documentos do porto.

Com a exceção preenchida, a invariante de terminal único deixa de ser validada e
passa a ser **estrutural**: um B/L tem um `terminal_id`, e os seus contêineres e
a sua carga solta seguem esse valor por construção. Não há estado que a viole.

**5. A exceção exige justificativa registrada.** Autor, data e motivo em
`audit_logs`, como a ADR 0051 exige do COD. A razão é a mesma: a exceção muda em
qual ADR a carga é contada, e o ADR é o que o Financeiro usa para aprovar
pagamento de fatura. Exceção que altera apuração não pode ser anônima.

**6. A exceção não reprecifica.** `charge_tables` é chaveada por `pod`,
`carrier_id`, `cargo_mode` e vigência; **terminal não participa da resolução de
preço** (`resolve_local_charge_table_id(p_cargo_mode, p_pod, p_reference_date)`).
Mudar o terminal de um B/L é atribuição operacional pura: muda o ADR que conta a
carga, não o valor cobrado.

Nenhum análogo a `cod_adjustments`, fatura complementar ou restituição é criado
por esta decisão.

**Esta é uma premissa explícita, não uma propriedade permanente.** Se um dia a
Taxa Local passar a variar por terminal dentro do mesmo porto, esta decisão
adquire consequência financeira e precisa ser revisitada junto com a modelagem
de preço. Quem alterar a chave de `charge_tables` deve ler esta ADR antes.

**7. A âncora de terminal deixa de ser derivada da modalidade.** O caminho
`cargo_mode → modalidade → terminal` da ADR 0067 permanece válido como
**herança** (decisão 1), mas deixa de ser o resolvedor final: a âncora passa a
ser o terminal resolvido do B/L — exceção quando houver, herança quando não.

O fallback `ELSE 'carga_cheia'` de `operationFrontKindForCargoMode` e de
`public.bl_operation_front_modalidade` deixa de ser aceitável para `'misto'`:
uma modalidade única não descreve um B/L que tem carga em duas. As duas funções
passam a tratar `'misto'` explicitamente, e o roteamento do NOB de um B/L misto
usa o terminal resolvido, não a modalidade inferida.

**8. Frente `TBC` não anula a exceção.** A ADR 0035 fixa que frente sem terminal
não cria ADR e bloqueia o fechamento — isso continua valendo para a herança. Um
B/L com exceção explícita para o terminal T, porém, conta no ADR de T
independentemente do estado da frente: a exceção é afirmação direta sobre o
documento, não um valor derivado da frente.

**9. Mudança de terminal na frente não limpa a exceção.** A exceção é ato
deliberado e sobrevive ao replanejamento da escala; quem quiser devolver o B/L à
herança limpa a exceção explicitamente, o que também é auditado. O caminho
inverso — a frente silenciosamente sobrescrever uma decisão registrada com
justificativa — perderia informação que alguém deliberadamente gravou.

## Consequências

- `bls` ganha `terminal_id uuid NULL` com FK para o cadastro de terminais. Nulo
  é herança; a coluna não recebe default.
- A resolução do terminal de um B/L passa a ter **uma** implementação
  compartilhada, em SQL e em TypeScript, presas à mesma tabela de casos por
  teste — mesma convenção que a ADR 0067 adotou para `cargo_mode → modalidade`.
  Resolver terminal em cada consumidor é o que esta decisão existe para impedir.
- `operationFrontKindForCargoMode` (`src/services/escalaTerminalAllocation.ts`) e
  `public.bl_operation_front_modalidade` (migration `045`) deixam de mapear
  `'misto'` para `'carga_cheia'` por fallback. `escalaOperationFrontKind.test.ts`
  ganha o caso.
- O ADR do terminal passa a contar a carga de um B/L com exceção, e a deixar de
  contá-la no terminal da frente. A identidade `(viagem, porto, terminal)` e o
  `report_id` não mudam.
- O NOB da ADR 0067 passa a ancorar B/L misto pela exceção ou pela herança
  resolvida, encerrando o roteamento silencioso pela frente de carga cheia.
- O `CONTEXT.md` ganha o verbete correspondente **na entrega que implementar
  esta decisão**, não antes: a ADR registra a decisão, o `CONTEXT.md` descreve o
  comportamento vigente.
- A spec `docs/spec/2026-09-16-unificacao-bls-carga-mista-design.md` passa a
  referenciar esta ADR no lugar da decisão em aberto que carregava.
- Sem operação real, não há backfill, reatribuição de ADR nem recomunicação.
- Fica **fora** desta decisão: terminal por contêiner ou por item de carga
  solta. A exceção é do documento. Fracionar um B/L entre terminais é
  exatamente o que a invariante proíbe.
