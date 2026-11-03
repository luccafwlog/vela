O CE libera a fatura. Na hora em que ele entra, a fatura de cada B/L sai sozinha e chega ao Portal do Cliente com o Pix. Depois dela, o B/L não é mais recalculado: a mudança refaz a fatura, e o Cliente recebe a cobrança de novo. Por isso, as taxas se conferem enquanto o B/L espera o CE.

::: lado
1. Em **Taxas Locais**, abra a aba **Validação**.
2. Filtre por **Motivo** ou **Navio / Viagem**.
3. Clique na seta à esquerda do B/L: a **Conferência do cálculo** mostra cada linha com a base, a quantidade e o valor.
::: tela validacao
A Validação: cada B/L com o primeiro motivo que segura a fatura.
:::
:::

| **Motivo** | O que fazer |
|---|---|
| **Taxa em revisão**, **Cálculo sem linhas** ou **Cálculo incompleto** | Corrija a causa e clique em **Recalcular** na linha. |
| **Sem cliente vinculado** | A {{Documentação}} vincula na Revisão. |
| **Conta do Portal não ativa** | A {{Documentação}} ativa o Portal, ou o {{Administrativo}} libera (etapa 7). |
| **Aguardando CE Mercante** | Nada: a fatura sai com o CE (etapa 6). |

A linha em revisão diz a causa na **Observação**: quase sempre falta tabela de cobrança ativa para o POD (etapas 1 e 2), o peso da carga solta ou o valor de um item.

::: atencao
Não existe aprovar a linha em revisão: corrija a causa e recalcule. A correção na ficha do B/L (container, peso, POD) já recalcula ao gravar.
:::
