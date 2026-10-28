# Alterar as taxas calculadas de um B/L

Estado: decisões D1 a D14 tomadas pelo dono do Vela em 2026-10-28, uma por
vez; **spec aprovada pelo dono em 2026-10-28**. O plano em lotes fica em
`docs/plans/`.

## Pedido

Pedido do dono (2026-10-28): **o operador deve poder alterar as taxas
calculadas de qualquer B/L.** Vem antes de qualquer outra etapa, inclusive da
Etapa 2 do [Manual do Operador](../plans/2026-10-26-manual-do-operador.md),
porque muda telas e o manual.

## Resumo

Na ficha do B/L, aba **Faturamento**, bloco **Taxas Locais**, qualquer setor
passa a poder, com justificativa:

- **alterar o valor** de uma taxa, por unidade ou pelo total, na moeda dela;
- **excluir** uma taxa da cobrança;
- **isentar** o B/L inteiro das Taxas Locais;
- desfazer cada uma dessas ações.

A quantidade nunca se altera: ela vem da carga do B/L. A alteração sobrevive
aos recálculos que o sistema faz sozinho e só se perde quando o B/L troca de
tabela (POD ou modalidade novos). Em B/L já faturado, a fatura emitida não é
editada: a alteração passa pela correção automática que já existe (reemite
sem pagamento; abate e restitui, ou abre Fatura desatualizada, com pagamento).
O Cliente vê só o valor final. Toda ação fica no **Histórico das taxas**, logo
abaixo da tabela, e a alteração aparece marcada na Validação, na fatura do
Vela e na ficha do Cliente. Eventos que mexem num B/L com taxa alterada avisam
pelo tamanho do efeito: prévia, confirmação ou alerta.

Hoje nada disso existe: todo recálculo apaga e refaz as linhas calculadas pela
tabela, e a correção automática da fatura também lê a tabela. Por isso a
alteração é gravada como uma decisão do B/L sobre a taxa, que o cálculo, a
emissão, a correção, o COD, o Desbloqueio de CE e as prévias passam a
respeitar, e não como edição da linha.

## Decisões do dono

### D1 — Alcance: só Taxas Locais

A alteração vale para as Taxas Locais do B/L (as linhas do bloco **Taxas
Locais** da ficha). A Demurrage fica como está: ela já tem **Desconto** (em %
ou US$, qualquer setor, com justificativa), free time e diárias P1/P2 por B/L
e reemissão pelas datas. Se faltar algo na Demurrage, é um pedido separado.

### D2 — Forma: alterar o valor (por unidade ou total) ou excluir a taxa; quantidade fixa

Em cada taxa do B/L o operador pode:

- **alterar o valor**, na moeda da taxa (R$ ou US$), abaixo ou acima da
  tabela, de um destes dois jeitos, à escolha dele (a flexibilidade é
  essencial, decisão do dono):
  - **valor por unidade** — o total passa a ser a quantidade do B/L × o valor
    alterado;
  - **valor total da taxa** — o total digitado é o que se cobra por aquela
    taxa no B/L;
- **excluir a taxa** da cobrança do B/L.

A **quantidade não se altera**: ela é a quantidade do item de carga do B/L
(containers, peso, rateio do container compartilhado) e mudá-la à mão teria
impacto maior no sistema. Para mudar a quantidade, corrige-se o B/L, que já
recalcula. Valor zero não se digita: para não cobrar, exclui-se a taxa. O que
acontece com o valor total alterado quando a quantidade do B/L muda depois é
decidido à parte.

### D3 — Permissão: todos os setores; uma regra só no bloco

Todos os setores (Administrativo, Financeiro, Operações, Documentação e
Equipamentos) alteram o valor e excluem taxas do B/L. A exclusão de cobrança
manual, hoje só do Administrativo
([ADR 0071](../adr/0071-ce-mercante-como-trava-de-exclusao.md), item 11),
passa a seguir a mesma regra: uma regra só para as linhas do bloco **Taxas
Locais**. A autorização fica no banco: quem não é usuário interno ativo é
recusado mesmo chamando a ação fora da tela. B/L faturado é tratado em decisão
própria.

**Histórico obrigatório na própria página.** Toda alteração e toda exclusão
ficam registradas e aparecem no lugar onde são feitas (a ficha do B/L, aba
**Faturamento**, bloco **Taxas Locais**), não só na aba **Histórico**. O
conteúdo do registro é detalhado na decisão de rastreio.

### D4 — Justificativa obrigatória, sem aprovação

Alterar e excluir exigem justificativa de ao menos 10 caracteres (como o câmbio
manual do B/L e a Restituição excepcional), conferida na tela e no banco. Não
há aprovação: a alteração vale na hora. Motivo: a fatura sai sozinha na
gravação do CE Mercante, e uma aprovação pendente ou seguraria a fatura (o
Cliente atrasa a retirada da carga) ou a deixaria sair com o valor antigo para
depois ser corrigida (reemissão ou Restituição). O controle é a justificativa,
o histórico na página e a marca de taxa alterada.

### D5 — Recálculo: a alteração se mantém, salvo troca de tabela

O sistema continua recalculando sozinho nos mesmos momentos de hoje; a
alteração do operador passa por eles assim:

| O que provoca o recálculo | Valor alterado ou taxa excluída |
|---|---|
| Gravação do CE Mercante, **Recalcular** (Validação ou Revisão), importação, B/Ls irmãos de container | Mantém |
| Mudança na carga (container que entra ou sai, IMO/OOG, SOC, peso, veículos, rateio do container compartilhado) | Mantém o valor por unidade, e a quantidade segue o B/L |
| Vínculo ou troca de Cliente antes da fatura | Mantém; a Condição do Cliente novo vale só nas taxas não alteradas |
| Correção de item de tabela ou de Condição pelo Administrativo | Mantém nas taxas alteradas; as demais seguem a correção |
| Reimportação com **Passar o B/L … ao preço de hoje** | Mantém nas taxas alteradas, e a prévia diz isso |
| Mudança de **POD** ou de **modalidade** (COD antes da fatura, reimportação com aceite, ficha) | Descarta, com registro no histórico da página ("Alteração descartada: o B/L passou para a tabela …"); a taxa volta ao valor da tabela, sem a marca de alterada |
| Taxa em revisão (sem preço, peso ausente…) | Não se altera; corrige-se o B/L |

Tabela nova cadastrada não muda B/L existente (o B/L fica vinculado à tabela do
primeiro cálculo, [ADR 0093](../adr/0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md),
decisão 1); o B/L só troca de tabela quando muda de POD ou de modalidade.

### D6 — Aviso ao operador pelo tamanho do efeito

Quando um evento vai mexer num B/L com taxa alterada à mão, o aviso depende do
efeito sobre a alteração. Não há confirmação em todo evento: na maioria (D5) a
alteração se mantém e nada muda nela.

1. **Prévia.** As telas que já mostram prévia antes de gravar (arquivo de B/L,
   Manifesto BB, planilha de CE, Baplie, planilha de veículos) ganham a seção
   **Taxas alteradas à mão**, com cada B/L afetado e o que acontece com cada
   alteração: mantida; quantidade muda (com o total antes → depois); ou
   descartada (com o motivo).
2. **Confirmação obrigatória**, só quando alguma alteração vai ser descartada
   ou mudar de valor: o botão de gravar pede uma confirmação à parte que lista
   as taxas afetadas. Vale na prévia e nos diálogos da ficha do B/L (POD,
   modalidade, containers), do COD e da correção de container.
3. **Aviso nos diálogos que já confirmam**, sem passo a mais: **Recalcular
   selecionados**, **Recalcular** da Revisão, **Emitir fatura**, **Emitir** da
   Validação e fatura consolidada ("Este B/L tem 2 taxas alteradas à mão; a
   fatura sai com os valores alterados.").
4. **Evento sem ninguém na tela** (por exemplo, a fila de efeitos de
   importação): alteração mantida fica só no histórico da página; descartada
   ou com valor mudado fica no histórico e abre um alerta para os setores do
   faturamento.

### D7 — Valor total alterado mantém o total quando a quantidade muda

Taxa com o **valor total** alterado continua com o total digitado quando a
quantidade do B/L muda depois (container que entra ou sai, rateio do container
compartilhado, peso). Exemplo: THD de 2 containers alterado para R$ 2.000
continua R$ 2.000 com 3 containers. Quem escolhe "total" diz "por esta taxa,
este B/L paga R$ X"; para acompanhar a quantidade, altera-se o valor por
unidade (D5). Toda mudança de quantidade numa taxa com total alterado pede a
confirmação da D6, mesmo sem mudar o valor ("total alterado mantido em R$ 2.000;
a quantidade passou de 2 para 3"), e fica no histórico da página.

### D8 — B/L faturado: permitido, pela correção automática da fatura

Alterar e excluir taxa também valem para B/L faturado, parcialmente pago ou
pago, para os mesmos setores (D3) e com justificativa (D4). A fatura emitida
nunca é editada: a alteração passa pela mesma correção automática que hoje
trata a correção de item de tabela pelo Administrativo
([Faturamento § Correção após emissão](../modules/faturamento.md#correção-após-emissão-adr-0077)):

| Situação da fatura | Efeito |
|---|---|
| Sem pagamento | Cancela e reemite com número novo, aviso "Nova fatura emitida" no Portal e Pix novo; a antiga fica no filtro **Cancelada** como "Substituída pela INV-…"; Pix pago depois no QR antigo vai para análise e cai na sucessora ou vira Restituição. A consolidada é recriada só com os mesmos B/Ls |
| Com pagamento, valor menor | Abate primeiro o saldo em aberto; o que passar vira **Restituição pendente**, confirmada pelo Financeiro ou pelo Administrativo com comprovante |
| Com pagamento, valor maior | **Fatura desatualizada**; a diferença se cobra por **Fatura avulsa**. Enquanto o alerta está aberto, o Desbloqueio de CE marca "Diferença de valor a faturar" |
| Reemissão travada (Portal não pronto, B/L misto com terminais em conflito) | A fatura continua valendo, com **Fatura desatualizada** e **Tentar aplicar correção** |

A confirmação diz o efeito antes de gravar (por exemplo: "A fatura INV-… será
cancelada e reemitida com número novo, e o Cliente será avisado no Portal" ou
"O Cliente já pagou R$ X: a diferença de R$ Y vira Restituição a confirmar pelo
Financeiro"). Lançar cobrança manual nova em B/L faturado continua recusado,
como hoje: serviço adicional vai em Fatura avulsa.

Esta decisão pede uma ADR nova, que supersede parcialmente a
[ADR 0077](../adr/0077-fatura-emitida-nao-muda-de-valor.md) (item 2, item 5 e
"ninguém digita valor de correção nem concede desconto") e preserva o
princípio central: fatura emitida nunca é editada; o sistema reemite, abate ou
restitui.

### D9 — Portal: o Cliente vê só o valor final

Na fatura (Portal, impressão e e-mail) a taxa alterada aparece como qualquer
outra, com o valor novo; a taxa excluída não aparece. Não há marca, valor da
tabela nem ajuste à vista do Cliente, como já acontece com a Condição de
Cliente; a justificativa é interna. Na taxa com valor total alterado, o
**Unitário** impresso é o total dividido pela quantidade, arredondado (como no
rateio do container compartilhado), e vale o total. Fatura já emitida segue a
D8: "Nova fatura emitida" com número novo, e a antiga em **Cancelada** como
"Substituída pela INV-…"; com pagamento, o Cliente vê o saldo abatido ou a
restituição. Uma observação para o Cliente na fatura pode entrar depois, como
pedido separado, sem refazer esta mudança.

### D10 — Rastreio no Vela e como desfazer

| Onde | O que aparece |
|---|---|
| Ficha do B/L › **Faturamento** › **Taxas Locais**, linha alterada | Marca **Alterada** ao lado do nome da taxa; ao passar o mouse: "Tabela: R$ 1.420 por container · alterada por Fulano em 28/10/2026 · motivo…" |
| Mesma tabela, linha excluída | Continua visível, em cinza e riscada, com **Excluída**, fora do total |
| Ações na linha | **Alterar valor** e **Excluir**; na alterada, também **Voltar ao valor da tabela**; na excluída, **Incluir de novo**. Todas com justificativa (D4) e, em B/L faturado, pela D8 |
| Bloco **Histórico das taxas**, logo abaixo da tabela | Uma linha por ação: data e hora, quem, taxa, antes → depois ("R$ 1.420/container → R$ 1.200/container", "total R$ 2.840 → R$ 2.000", "excluída", "descartada pelo sistema: o B/L passou para a tabela …"), justificativa e efeito na fatura ("INV-0012 reemitida como INV-0031", "Restituição de R$ 400") |
| Aba **Histórico** do B/L, família Taxas | As mesmas linhas, com frases legíveis (corrige o texto cru de hoje, como "Taxa: qty=2 \| note=…") |
| **Validação** › **Conferência do cálculo** | Marca **alterada** na linha (como "tarifa negociada") e a linha excluída listada como **excluída** |
| **Validação** › **Mais filtros** | Filtro **Com taxa alterada à mão** |
| **Validação** › **Exportar** | Coluna **Taxas alteradas à mão** ("THD: R$ 1.420 → R$ 1.200; Taxa X: excluída") |
| Detalhe da fatura no Vela › **Itens da fatura** | Coluna **Origem** com **Calculado**, **Manual** ou **Alterado** |
| Ficha do Cliente › **Financeiro** | Lista **B/Ls com taxa alterada**, ao lado de "B/Ls com cobrança manual" |
| **Histórico de ações** do Administrativo | A ação com autor, antes, depois e justificativa |

### D11 — A alteração vale só para aquele B/L

A alteração e a exclusão valem só para o B/L em que são feitas. Não há atalho
para virar Condição de Cliente nem aplicação em lote a outros B/Ls. A Condição
de Cliente continua sendo cadastrada em **Tabelas e condições** (por unidade,
só item automático, com vigência, valendo para os B/Ls importados depois); a
lista **B/Ls com taxa alterada** na ficha do Cliente (D10) mostra quando o
mesmo ajuste se repete. Aplicar a alteração a vários B/Ls de uma vez é um
pedido separado.

### D12 — Isentar Taxas Locais à mão

Para não cobrar nada de um B/L, o operador usa o botão **Isentar Taxas
Locais**, no bloco **Taxas Locais** da ficha. A ideia é do dono: um clique,
nenhum item cobrado, nenhuma fatura emitida. O B/L passa ao estado **Isento**
que o sistema já trata em todas as telas (fila da Validação, CE "Nada a
faturar: B/L isento das Taxas Locais.", Desbloqueio de CE com o Financeiro
atendido, Portal sem valor, correção automática que cancela sem reemitir), em
vez de um estado novo.

| Ponto | Como fica |
|---|---|
| Quem | Todos os setores, com justificativa de ao menos 10 caracteres (D3, D4) |
| Efeito | B/L **Isento**, com "Isenção manual: <justificativa>". Nada é cobrado, nem as taxas calculadas nem as cobranças manuais; não sai fatura |
| As linhas | Continuam visíveis em cinza, com as alterações e exclusões que tinham, como referência |
| Recálculos | A isenção se mantém em todos, inclusive na troca de POD ou de modalidade (é decisão sobre o B/L); a prévia (D6) diz "B/L isento à mão: continua isento" |
| B/L faturado sem pagamento | A fatura é cancelada sem sucessora, como hoje com o B/L que fica isento depois da fatura |
| B/L faturado com pagamento | Todo o recebido vira **Restituição pendente**, confirmada pelo Financeiro (D8) |
| Desfazer | **Retirar isenção**, com justificativa: o B/L volta a ser calculado com as alterações e exclusões que tinha; a fatura sai pelo **Emitir fatura**, como depois de qualquer fatura cancelada por uma pessoa |
| Excluir a última taxa | Recusado: "Esta é a última taxa cobrada do B/L. Para não cobrar nada, use Isentar Taxas Locais." Só há um caminho para chegar a zero |
| Isenção automática (veículo LCL) | Continua como está; o motivo na ficha diferencia as duas |
| Rastreio | **Isentar** e **Retirar isenção** entram no **Histórico das taxas** da página (D10), no filtro e na planilha da Validação |

A isenção à mão entra na ADR nova da D8: ela estende a regra atual, em que a
isenção só existe com prova positiva (veículo com Movement To LCL).

### D13 — Troca de Cliente: a alteração continua com o B/L

Antes e depois da fatura, a troca de Cliente (CNPJ) mantém as taxas alteradas,
as excluídas e a isenção à mão. O que é do Cliente vai por Condição de Cliente,
que já segue o Cliente (na troca vale a do Cliente novo); a alteração à mão é,
por desenho, do B/L (avaria, falha operacional, cobrança que não se aplica
àquela carga). A confirmação da troca lista as alterações que continuam ("2
taxas alteradas à mão continuam para o novo Cliente"); se alguma era do Cliente
anterior, o operador usa **Voltar ao valor da tabela** ou **Retirar isenção**.
Depois da fatura vale o fluxo atual da troca (sem pagamento, cancela e reemite
para o Cliente novo; com pagamento, devolve ao original e cobra o novo depois
da devolução), já com as alterações.

Difere de propósito do **Desconto** da Demurrage, que a Invoice reemitida para
o Cliente novo não herda (decisão do dono de 2026-10-22): lá o desconto é a
única ferramenta e mistura o que é do Cliente e o que é do B/L; aqui o que é do
Cliente tem a Condição. A ADR nova registra esse porquê.

### D14 — Detalhes aprovados em bloco

1. **Cobrança manual** ganha as mesmas ações das calculadas: **Alterar valor**
   (por unidade ou total) e **Voltar ao valor da tabela**. O **Editar** de hoje
   continua (quantidade e observação), porque na manual a quantidade é o
   operador quem informa. **Excluir** continua apagando a linha, agora para
   todos os setores (D3) e com justificativa; para voltar, lança-se de novo.
2. **THD de container IMO e OOG** (a linha "× 2,5") é linha própria e se altera
   sozinha; alterar o THD Padrão não muda a linha IMO/OOG.
3. **Container compartilhado:** a alteração vale só para a parte deste B/L; os
   outros B/Ls que dividem o container não mudam.
4. **B/L cancelado e reativado:** cancelado, nada se altera (é só consulta). Na
   reativação voltam as alterações, as exclusões e a isenção à mão das taxas
   calculadas. A cobrança manual continua se perdendo no cancelamento, como
   hoje (fora desta mudança).
5. **Alerta do evento sem ninguém na tela** (D6, nível 4): tipo novo **Taxa
   alterada à mão mudou**, Normal, setor responsável Administrativo, avisa
   também o Financeiro (como a Fatura desatualizada); abre o B/L e fecha com
   **Resolver com justificativa**.
6. **Taxa em dólar:** o valor alterado é em US$ e converte pelo câmbio fixado
   do B/L, como toda taxa em dólar.
7. **Viagem cancelada:** nada se altera, como hoje.

## Comportamento por tela

### 1. Ficha do B/L › aba Faturamento › bloco Taxas Locais

**Título do bloco.** Ao lado de **Adicionar cobrança manual** e **Emitir
fatura** entra **Isentar Taxas Locais**; no B/L isento à mão, ele dá lugar a
**Retirar isenção**. B/L isento pelo veículo LCL não mostra nenhum dos dois. B/L
cancelado e B/L de Viagem cancelada continuam só consulta: nenhum botão.

**Resumo do bloco.** O fato **Isenção** passa a mostrar também a isenção à mão:
"Isenção manual: <justificativa> · por <nome> em dd/mm/aaaa". A frase do B/L
faturado muda para: "Faturado: as taxas são a base da fatura. Alterar, excluir
ou isentar passa pela correção da fatura (reemissão, abatimento ou
Restituição)."

**Tabela de taxas.** Colunas como hoje (Taxa, Origem, Situação, Qtd.,
Unitário, Total, Observação), com:

- **linha alterada:** marca **Alterada** ao lado do nome; ao passar o mouse,
  "Tabela: R$ 1.420,00 por container · alterada por <nome> em dd/mm/aaaa ·
  <justificativa>". Unitário e Total mostram o valor cobrado. Na alteração pelo
  total, o Unitário é o total ÷ quantidade, arredondado;
- **linha excluída:** continua na tabela, em cinza e riscada, com **Excluída**
  e o valor que teria; não entra no Total do pé;
- **B/L isento à mão:** todas as linhas em cinza, como referência, com as
  marcas que tinham; o Total do pé é R$ 0,00;
- **linha em revisão:** sem ações, como hoje.

**Ações na linha** (coluna de ações, para todos os setores, fora do B/L
cancelado e da Viagem cancelada):

| Linha | Ações |
|---|---|
| Calculada, sem alteração | **Alterar valor da taxa**, **Excluir taxa** |
| Calculada, alterada | **Alterar valor da taxa**, **Voltar ao valor da tabela**, **Excluir taxa** |
| Calculada, excluída | **Incluir taxa de novo** |
| Manual | **Editar cobrança manual** (quantidade e observação, como hoje), **Alterar valor da taxa**, **Voltar ao valor da tabela** (se alterada), **Excluir cobrança manual** |
| Qualquer, com o B/L isento à mão | Nenhuma: primeiro **Retirar isenção** |
| Em revisão | Nenhuma |

**Alterar valor da taxa** abre o modal **Alterar valor — <taxa>** com:

- fatos fixos: **Quantidade** ("2 containers · vem da carga do B/L, não se
  altera"), **Valor da tabela** ("R$ 1.420,00 por container · total
  R$ 2.840,00") e, se já alterada, **Valor atual**;
- escolha **Por unidade** / **Total da taxa** (controle segmentado; abre em
  "Por unidade", ou no jeito da alteração atual);
- campo **Novo valor por unidade (R$)** ou **Novo valor total (R$)**, na moeda
  da taxa (US$ para taxa em dólar); aceita "1.420,50" como os demais
  formulários de Taxas Locais;
- linha viva: "Novo total: R$ 2.400,00 · −15,5% sobre a tabela";
- **Justificativa (interna)**, obrigatória, com a ajuda "Fica no histórico do
  B/L com o seu nome. O Cliente não vê.";
- botões **Revisar alteração** e **Voltar**. **Revisar alteração** abre a
  confirmação com o efeito (abaixo, "Confirmações").

**Excluir taxa**, **Voltar ao valor da tabela**, **Incluir taxa de novo**,
**Excluir cobrança manual**, **Isentar Taxas Locais** e **Retirar isenção**
abrem a confirmação com justificativa (o padrão de confirmação com motivo do
Vela), com o efeito na fatura quando o B/L está faturado.

**Bloco Histórico das taxas**, logo abaixo da tabela, sempre visível. Colunas
**Quando**, **Quem**, **Taxa**, **O que mudou**, **Justificativa** e **Efeito na
fatura**, da mais recente para a mais antiga. Vazio: "Nenhuma alteração à mão
nas taxas deste B/L." Frases de **O que mudou** estão em "Mensagens".

**Aviso de diferença.** "As taxas mudaram depois da emissão…" deixa de
aparecer quando a diferença é só a da consolidada com outros B/Ls (compara a
parte deste B/L, não o total da fatura inteira).

### 2. Taxas Locais › Validação

- **Conferência do cálculo:** marca **alterada** na linha (como "tarifa
  negociada"), com o valor da tabela ao passar o mouse; linha excluída
  listada como **excluída**, fora do subtotal; B/L isento à mão com "Isenção
  manual: <justificativa>".
- **Mais filtros:** novo filtro **Com taxa alterada à mão** (alterada,
  excluída ou isenta à mão).
- **Motivo:** o B/L isento à mão é **Isento** (situação resolvida, fora da fila
  padrão, visível com **Incluir faturados e isentos**). O B/L com taxa excluída
  e as demais cobradas segue os motivos de hoje.
- **Exportar:** coluna nova **Taxas alteradas à mão** ("THD: R$ 1.420,00 →
  R$ 1.200,00 por container; Taxa X: excluída; Isento à mão"). As colunas por
  taxa trazem o valor cobrado; o Subtotal não soma linha excluída.
- **Recalcular selecionados** e **Recalcular** (linha): a confirmação diz "N
  B/Ls têm taxas alteradas à mão: as alterações se mantêm no recálculo."
- **Emitir** (linha): a confirmação diz "Este B/L tem N taxas alteradas à mão;
  a fatura sai com os valores alterados."

### 3. Faturas (Vela)

- **Detalhe da fatura › Itens da fatura:** coluna **Origem** com
  **Calculado**, **Manual** ou **Alterado**; ao passar o mouse em **Alterado**,
  o valor da tabela. Taxa excluída não vira item.
- **Emitir fatura** (ficha do B/L) e **Gerar fatura consolidada:** o mesmo aviso
  "Este B/L tem N taxas alteradas à mão; a fatura sai com os valores
  alterados." (na consolidada, por B/L).
- **Fatura desatualizada**, **Reemissão pendente**, **Tentar aplicar correção**
  e **Ajustes pela correção do B/L:** sem tela nova; a correção vinda da
  alteração aparece com a origem "Alteração das taxas do B/L pelo operador".
- **Impressão da fatura:** sem marca de alteração (D9).

### 4. Portal do Cliente

Nada novo na tela (D9). A fatura mostra o valor cobrado; a taxa excluída não
aparece; o B/L isento à mão não mostra valor, como o isento de hoje. A marca de
alteração, o valor da tabela e a justificativa **não saem do banco para o
Portal**, nem no dado da fatura. Na fatura reemitida valem o aviso "Nova fatura
emitida" e a antiga em **Cancelada** como "Substituída pela INV-…"; na fatura
cancelada pela isenção, a antiga aparece em **Cancelada**, sem sucessora.

### 5. Históricos

- **Aba Histórico do B/L**, família **Taxas:** as mesmas linhas do Histórico das
  taxas, com as mesmas frases; a edição de cobrança manual deixa de aparecer
  como "Taxa: qty=2 | note=…" e passa a "Cobrança manual <taxa>: quantidade
  2 → 3".
- **Histórico de ações** (Administrativo): a ação, o B/L, a taxa, antes,
  depois, a justificativa e o autor.

### 6. Ficha do Cliente › Financeiro

Lista **B/Ls com taxa alterada**, ao lado de "B/Ls com cobrança manual": B/L,
Viagem, taxas alteradas ("THD: R$ 1.420,00 → R$ 1.200,00; Taxa X: excluída;
Isento à mão"), quem e quando, com link para a ficha do B/L.

### 7. Prévias e confirmações dos eventos (D6)

**Prévia.** As prévias de arquivo de B/L, Manifesto BB (inclusive a revisão da
reimportação), planilha de CE Mercante, Baplie e planilha de veículos ganham a
seção **Taxas alteradas à mão**, com uma linha por alteração dos B/Ls afetados
(inclusive irmãos de container que o arquivo mexe):

- "<B/L> · <taxa>: mantida (R$ 1.200,00 por container)";
- "<B/L> · <taxa>: quantidade muda de 2 para 3 — total R$ 2.400,00 →
  R$ 3.600,00";
- "<B/L> · <taxa>: valor total alterado mantido em R$ 2.000,00; a quantidade
  passa de 2 para 3" (pede confirmação);
- "<B/L> · <taxa>: alteração descartada — o B/L passa para a tabela <nome>"
  (pede confirmação);
- "<B/L>: isento à mão — continua isento".

**Confirmação obrigatória.** Quando a lista tem alteração descartada ou taxa
com total alterado cuja quantidade muda, o botão de gravar abre um segundo
diálogo, **Taxas alteradas à mão serão afetadas**, com a lista e o botão
**Gravar mesmo assim**. O mesmo diálogo aparece nas gravações da ficha do B/L
que mudam POD, modalidade, containers, veículos ou peso, na correção de
container, na marcação de COD e nas ações da página Veículos (mover e excluir
veículo), sempre que o B/L tiver taxa alterada à mão afetada.

**Aviso nos diálogos que já confirmam:** Recalcular (Validação e Revisão),
Emitir, Emitir fatura e fatura consolidada (seções 2 e 3).

**Sem confirmação na tela:** quando uma alteração é descartada ou uma taxa com
total alterado muda de quantidade sem que alguém tenha confirmado na tela
(rotina, fila de efeitos de importação, gravação feita em outro B/L que muda o
rateio), o Histórico das taxas registra e abre o alerta **Taxa alterada à mão
mudou** (D14).

### 8. Alertas

Tipo novo **Taxa alterada à mão mudou**: domínio Financeiro, severidade Normal,
setor responsável Administrativo, avisa também o Financeiro; um item por B/L;
link **Abrir B/L** para a aba Faturamento; fecha com **Resolver com
justificativa**. Entra no catálogo de regras de alerta e no sino dos dois
setores.

### 9. Desbloqueio de CE

O requisito Financeiro (taxas pagas) usa o valor com as alterações. O B/L
isento à mão conta como atendido, como o isento de hoje
([ADR 0087](../adr/0087-desbloqueio-ce-aceite-operacional.md), item 2).
Fatura desatualizada aberta por alteração que aumentou o valor de fatura paga
marca "Diferença de valor a faturar", como hoje.

### 10. Revisão

O **Recalcular** da Revisão mostra o aviso da seção 2 e passa a atualizar a ficha
do B/L na hora (hoje ela fica com o valor antigo até recarregar).

## Efeitos no dinheiro e no Portal

| Situação do B/L | Alterar ou excluir taxa | Isentar à mão |
|---|---|---|
| Sem fatura (com ou sem CE) | O cálculo passa a cobrar o valor alterado; a fatura sai depois com ele | Nada é cobrado; o CE responde "Nada a faturar: B/L isento das Taxas Locais."; sai da fila da Validação |
| Fatura sem pagamento | Cancela e reemite com número novo, aviso no Portal e Pix novo; a consolidada volta só com os mesmos B/Ls | Cancela a fatura sem sucessora; a consolidada é encerrada sem reemissão e os demais B/Ls seguem pelas individuais |
| Fatura com pagamento, valor menor | Abate o saldo em aberto; o que passar vira **Restituição pendente** (Financeiro ou Administrativo confirma com comprovante) | Todo o recebido vira **Restituição pendente** |
| Fatura com pagamento, valor maior | **Fatura desatualizada**; diferença por **Fatura avulsa** | — |
| Reemissão travada (Portal não pronto, B/L misto com terminais em conflito) | A fatura continua valendo; **Fatura desatualizada** com **Tentar aplicar correção** | Idem |

Pix: o QR da fatura cancelada deixa de ser oferecido; Pix pago depois nele vai
para análise e cai na sucessora ou vira Restituição, como hoje. Recebimento já
registrado nunca é apagado: a correção abate ou restitui.

## Mensagens

| Situação | Texto |
|---|---|
| Ação na linha | **Alterar valor da taxa**, **Excluir taxa**, **Voltar ao valor da tabela**, **Incluir taxa de novo**, **Excluir cobrança manual** |
| Botões do bloco | **Isentar Taxas Locais**, **Retirar isenção** |
| Modal | Título "Alterar valor — <taxa>"; escolha **Por unidade** / **Total da taxa**; campos **Novo valor por unidade (R$)**, **Novo valor total (R$)** (US$ na taxa em dólar); linha viva "Novo total: R$ … · −15,5% sobre a tabela"; **Justificativa (interna)** com "Fica no histórico do B/L com o seu nome. O Cliente não vê."; botões **Revisar alteração** e **Voltar** |
| Erros no modal | "Informe um valor maior que zero. Para não cobrar a taxa, use Excluir taxa." · "Informe um valor válido, como 1.420,50." · "Escreva a justificativa (ao menos 10 caracteres)." · "O valor é igual ao atual: nada a alterar." |
| Confirmação, B/L sem fatura | Título "Alterar valor da taxa"; mudança "<taxa> · por container: R$ 1.420,00 → R$ 1.200,00; total R$ 2.840,00 → R$ 2.400,00"; consequência "O B/L passa a cobrar R$ 2.400,00 por esta taxa. A alteração vale nos próximos recálculos e na fatura; só se perde se o B/L mudar de POD ou de modalidade."; reversibilidade "Volte quando quiser com Voltar ao valor da tabela, com justificativa."; botão **Alterar valor** |
| Confirmação, fatura sem pagamento | "A fatura INV-… (R$ X) será cancelada e reemitida com número novo, no valor de R$ Y. O Cliente recebe o aviso no Portal e um Pix novo." |
| Confirmação, fatura paga, valor menor | "O Cliente já pagou R$ X da fatura INV-…. A cobrança deste B/L passa a R$ Y: R$ A saem do saldo em aberto e R$ B viram Restituição, a confirmar pelo Financeiro com comprovante." |
| Confirmação, fatura paga, valor maior | "O Cliente já pagou a fatura INV-…. A cobrança deste B/L passa a R$ Y: abre Fatura desatualizada, e a diferença de R$ Z se cobra por Fatura avulsa." |
| Confirmação, reemissão travada | "A fatura INV-… não pode ser reemitida agora (<motivo>). Ela continua valendo com Fatura desatualizada; resolva o motivo e use Tentar aplicar correção." |
| Confirmação de excluir | Título "Excluir taxa"; "A taxa <taxa> (R$ X) sai da cobrança deste B/L e da fatura. A linha continua na ficha, riscada."; reversibilidade "Volte com Incluir taxa de novo, com justificativa."; botão **Excluir taxa** (+ efeito na fatura, se faturado) |
| Confirmação de voltar | Título "Voltar ao valor da tabela"; "A taxa <taxa> volta a R$ … (tabela)." (+ efeito na fatura) |
| Confirmação de incluir de novo | Título "Incluir taxa de novo"; "A taxa <taxa> volta à cobrança pelo valor da tabela, R$ …." (+ efeito na fatura) |
| Confirmação de isentar | Título "Isentar Taxas Locais do B/L"; sem fatura: "Nenhuma taxa deste B/L será cobrada, nem as manuais, e a fatura não será emitida. O B/L sai da fila da Validação e o Desbloqueio de CE considera o Financeiro atendido."; fatura sem pagamento: "A fatura INV-… será cancelada, sem nova fatura. O Cliente vê a fatura em Canceladas no Portal."; com pagamento: "O Cliente já pagou R$ X: o valor vira Restituição, a confirmar pelo Financeiro com comprovante."; reversibilidade "Retirar isenção recalcula as taxas com as alterações que o B/L tinha; a fatura sai pelo Emitir fatura."; botão **Isentar** |
| Confirmação de retirar isenção | Título "Retirar isenção"; "As taxas voltam a ser calculadas, com as alterações e exclusões que o B/L tinha. A fatura não sai sozinha: use Emitir fatura quando o B/L estiver pronto."; botão **Retirar isenção** |
| Sucesso | "Valor da taxa alterado." · "Valor da taxa alterado. Fatura INV-… reemitida como INV-…." · "Taxa excluída da cobrança." · "Taxa de volta ao valor da tabela." · "Taxa incluída de novo." · "Cobrança manual excluída." · "B/L isento das Taxas Locais." · "Isenção retirada: taxas recalculadas." |
| Falha | "Não foi possível <alterar a taxa / excluir a taxa / isentar o B/L>: <motivo do banco>." (o motivo aparece; acaba o "Falha ao salvar linha manual de taxa." sem motivo) |
| Recusas do banco | "Justificativa obrigatória: escreva ao menos 10 caracteres." · "Informe um valor maior que zero. Para não cobrar a taxa, use Excluir taxa." · "B/L <B/L> cancelado e somente leitura; reative o B/L para alterar as taxas." · "Viagem <viagem> cancelada: operação selada e somente leitura." · "Taxa em revisão não se altera: corrija o B/L e recalcule." · "Esta é a última taxa cobrada do B/L. Para não cobrar nada, use Isentar Taxas Locais." · "B/L isento das Taxas Locais: retire a isenção para alterar as taxas." · "Esta taxa não está mais no cálculo do B/L; atualize a página." · "Somente usuário interno ativo altera as taxas do B/L." |
| Histórico, O que mudou | "Valor por unidade: R$ 1.420,00 → R$ 1.200,00" · "Valor total: R$ 2.840,00 → R$ 2.000,00" · "Excluída da cobrança (era R$ 2.840,00)" · "Voltou ao valor da tabela (R$ 1.420,00 por container)" · "Incluída de novo" · "Cobrança manual excluída" · "B/L isento das Taxas Locais" · "Isenção retirada" · "Alteração descartada pelo sistema: o B/L passou para a tabela <nome> (POD <POD>)" · "Quantidade mudou de 2 para 3; valor total alterado mantido em R$ 2.000,00" |
| Histórico, Efeito na fatura | "INV-… cancelada e reemitida como INV-…" · "Abatido R$ X do saldo; Restituição de R$ Y" · "Fatura desatualizada: diferença de R$ Z a cobrar por avulsa" · "INV-… cancelada sem nova fatura (B/L isento)" · "Correção pendente: <motivo>" · "Sem fatura" |
| Alerta | Título "Taxa alterada à mão mudou"; "A alteração à mão da taxa <taxa> do B/L <B/L> foi descartada: o B/L passou para a tabela <nome>." ou "A quantidade da taxa <taxa> do B/L <B/L> mudou de 2 para 3; o valor total alterado foi mantido em R$ 2.000,00. Confira se ainda vale."; resolução "Confira as taxas do B/L e resolva com justificativa." |

## Permissões

| Ação | Adm | Fin | Ope | Doc | Equ | Onde o banco aplica |
|---|---|---|---|---|---|---|
| Alterar valor, excluir, voltar ao valor da tabela, incluir de novo (taxa calculada ou manual) | ✔ | ✔ | ✔ | ✔ | ✔ | RPCs novas com usuário interno ativo, autor = quem está logado, justificativa de ao menos 10 caracteres |
| Excluir cobrança manual | ✔ | ✔ | ✔ | ✔ | ✔ | `delete_manual_bl_charge` deixa de exigir o Administrativo e passa a exigir justificativa (supersede a [ADR 0071](../adr/0071-ce-mercante-como-trava-de-exclusao.md), item 11) |
| Isentar Taxas Locais e retirar isenção | ✔ | ✔ | ✔ | ✔ | ✔ | RPCs novas, mesmas regras |
| As mesmas ações em B/L faturado | ✔ | ✔ | ✔ | ✔ | ✔ | Mesmas RPCs; o efeito na fatura passa pela correção automática |
| Confirmar a Restituição gerada | ✔ | ✔ | — | — | — | `confirm_invoice_refund`, sem mudança |
| Gravar direto nas linhas de cálculo ou nas alterações | — | — | — | — | — | Sem escrita direta pela API (migration `231` e as tabelas novas sem INSERT/UPDATE/DELETE para usuário logado) |
| Ver a marca, o valor da tabela e a justificativa | ✔ | ✔ | ✔ | ✔ | ✔ | Leitura interna; **o Portal não recebe** |

Usuário do Portal, usuário desativado e chamada sem sessão são recusados.

## Casos de borda

- **Item desativado pelo Administrativo** depois da alteração: a taxa sai do B/L
  com ou sem alteração, como hoje; a alteração fica guardada e volta se o item
  for reativado. Não é descarte, não abre alerta.
- **Taxa que entra em revisão** depois da alteração (peso ausente, item sem
  preço): a linha mostra a revisão; a alteração fica guardada e volta quando a
  revisão se resolve.
- **Container compartilhado:** a alteração vale só para a parte deste B/L; o
  arredondamento do rateio continua fechando o valor cheio do container entre
  as linhas não alteradas dos irmãos.
- **Taxa em dólar:** valor alterado em US$, convertido pelo câmbio fixado do
  B/L na emissão.
- **B/L sem Cliente:** pode ser alterado; a alteração segue com o B/L (D13).
- **B/L não calculado:** **Isentar Taxas Locais** vale; alterar e excluir
  aparecem quando houver linhas.
- **Isento à mão e depois isento pelo veículo LCL:** retirar a isenção à mão
  deixa a isenção automática.
- **Edição de quantidade de cobrança manual com total alterado:** mantém o
  total (D7) e a confirmação diz isso.

## Fora do escopo

- Demurrage (D1).
- Virar Condição de Cliente ou aplicar a alteração em lote (D11).
- Observação para o Cliente na fatura (D9).
- Lançar cobrança manual nova em B/L faturado (continua recusado; vai em
  avulsa).
- A cobrança manual que se perde no cancelamento do B/L (D14, item 4).

## Desenho técnico (para o plano)

Resumo das escolhas que o plano detalha; nada aqui é código ainda.

- **Onde a alteração mora.** Tabela nova de alterações por B/L e taxa (chave da
  linha do cálculo: `auto:item:<item>`, `auto:item:<item>:imo_oog` ou a chave da
  cobrança manual), com tipo (por unidade, total ou excluída), moeda, valor,
  quantidade de referência, tabela de origem, justificativa, autor e datas de
  criação e de encerramento (voltar, incluir de novo, descarte). Uma alteração
  ativa por B/L e taxa. Tabela nova para a isenção à mão, por B/L. Um registro
  de eventos, só de inclusão, alimenta o Histórico das taxas, com o efeito na
  fatura. Sem escrita direta pela API.
- **Quem respeita a alteração.** O resolvedor das linhas do B/L passa a aplicar
  as alterações ativas e a isenção à mão. Assim o cálculo e todo recálculo, a
  cotação da correção automática (`_quote_bl_local_charges`), o COD, o
  Desbloqueio de CE e as prévias que simulam o recálculo passam a ver o mesmo
  valor sem caminho paralelo. Na cobrança manual, que o recálculo já preserva,
  a alteração vale na própria linha (e a cotação já soma as manuais). Linha
  excluída fica com total zero e situação
  própria; linha de B/L isento à mão fica Isenta com total zero. As linhas
  guardam também o valor da tabela, para a tela mostrar.
- **Descarte.** Alteração cuja tabela deixou de ser a do B/L (POD ou modalidade
  novos) é encerrada pelo cálculo, com evento; item desativado ou taxa em
  revisão deixam a alteração dormente.
- **B/L faturado.** A RPC da alteração recalcula e chama a correção automática
  com a origem nova "Alteração das taxas do B/L pelo operador", a mesma
  máquina da correção de tabela. A confirmação lê antes uma prévia do efeito
  calculada no servidor.
- **Fatura.** A emissão copia para o item a marca de alteração dentro do
  registro congelado do item; o detalhe do Vela lê; a projeção do Portal não
  inclui a marca.
- **Confirmação e alerta.** A confirmação da tela registra um aceite curto do
  usuário para os B/Ls listados; o cálculo, ao descartar ou mudar a quantidade
  de uma alteração pelo total, abre o alerta quando não há aceite do usuário
  da sessão para aquele B/L.
- **Cache.** Uma função nova em `src/services/cacheEffects.ts` para "taxas do
  B/L alteradas" invalida linhas, ficha, lista, Validação, Histórico, faturas,
  correção, saldo e ficha do Cliente, Desbloqueio de CE e alertas. As ações de
  cobrança manual passam a usar a mesma função (hoje deixam a Validação, o
  Histórico e o saldo do Cliente desatualizados até 30 segundos).
- **Migrations.** Novas, na sequência a partir da `491`. Nenhuma reescreve
  linha existente.

## Documentação a atualizar

- **ADR nova 0111** (alteração, exclusão e isenção à mão das Taxas Locais do
  B/L): supersede parcialmente a
  [0077](../adr/0077-fatura-emitida-nao-muda-de-valor.md) (item 2, item 5 e
  "ninguém digita valor de correção nem concede desconto") e a
  [0071](../adr/0071-ce-mercante-como-trava-de-exclusao.md) (item 11), estende
  a regra de isenção (prova positiva do veículo LCL) e registra a diferença
  para o desconto da Demurrage (D13). Faixas "Situação atual" na 0077, na 0071
  e na [0085](../adr/0085-modelo-de-permissoes-por-perfil.md) (linha "Excluir
  taxa manual do B/L"); índice de ADRs.
- **Módulos:** [Taxas Locais](../modules/taxas-locais.md) (dono da regra),
  [Faturamento](../modules/faturamento.md) (correção pela alteração e
  isenção), [Desbloqueio de CE](../modules/desbloqueio-ce.md),
  [Operação e Suporte](../modules/operacao-suporte.md) (alerta novo),
  [Portal do Cliente](../modules/portal-cliente.md) (o que não aparece),
  [Clientes](../modules/clientes.md) (lista na ficha).
- [Segurança](../operations/seguranca.md) (matriz de permissões),
  [Manual financeiro](../operations/manual-financeiro.md) (Restituição vinda da
  alteração), [CONTEXT.md](../../CONTEXT.md) (Taxa alterada à mão, Isenção à
  mão; "Correção de B/L após faturamento"),
  [RASTREABILIDADE.md](../RASTREABILIDADE.md), a matriz do manual em
  `docs/manual/cobertura/` (09a, 09b, 08, 12) e [CHANGELOG](../CHANGELOG.md).
- No fim: esta spec vai para `docs/archive/specs/`, o plano para
  `docs/archive/plans/`, e o "Estado" do
  [plano do Manual do Operador](../plans/2026-10-26-manual-do-operador.md)
  registra que a mudança entrou.

## Verificação prevista

- **Banco local (Postgres 16, `npm run test:local-pg` num banco recriado):**
  permissões por setor e recusas; alteração por unidade e por total; exclusão,
  voltar e incluir de novo; isenção e retirada; cada linha da tabela da D5;
  descarte na troca de POD e de modalidade; total mantido com quantidade nova
  (D7); fatura sem pagamento reemitida, paga com abatimento e Restituição,
  paga com valor maior em Fatura desatualizada, reemissão travada; isenção de
  fatura sem e com pagamento; Desbloqueio de CE; Portal sem a marca; alerta sem
  aceite e sem alerta com aceite.
- **Testes de tela:** bloco Taxas Locais (marcas, ações por linha, modal,
  confirmações, Histórico das taxas), Conferência, filtro e planilha da
  Validação, detalhe da fatura, prévias com a seção nova, invalidação de cache.
- **Checks do `AGENTS.md`:** `docs:check`, `typecheck`, `lint`, `test`,
  `build`, `migrations:check`, `rpc:check`, `manual:coverage`,
  `design:check` e `a11y:contrast`.
- **Fica para staging:** uma reemissão real com Pix do Itaú; a Restituição
  confirmada pelo Financeiro; o aviso "Nova fatura emitida" chegando ao
  Cliente; a prévia do arquivo de B/L com um B/L alterado.
