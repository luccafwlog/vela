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
