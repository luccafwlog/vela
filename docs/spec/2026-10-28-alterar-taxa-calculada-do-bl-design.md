# Alterar as taxas calculadas de um B/L

Estado: rascunho em entrevista com o dono do Vela (2026-10-28). As decisões
abaixo são registradas à medida que o dono responde; a spec só vale depois da
aprovação dele, e nenhum código é escrito antes disso.

## Pedido

Pedido do dono (2026-10-28): **o operador deve poder alterar as taxas
calculadas de qualquer B/L.** Vem antes de qualquer outra etapa, inclusive da
Etapa 2 do [Manual do Operador](../plans/2026-10-26-manual-do-operador.md).

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
