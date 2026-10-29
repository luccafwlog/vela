A Revisão é a fila dos B/Ls que a importação não conseguiu deixar prontos para faturar: falta o Cliente, o Portal do Cliente ou o peso da carga solta. Enquanto o B/L está nela, a fatura dele espera. O Vela calcula essas pendências sozinho, e o B/L sai da fila sozinho quando a última se resolve. O seu trabalho é decidir o que o sistema não pode adivinhar, como quem é o Cliente de um CNPJ novo. Neste capítulo você lê a fila e resolve cada pendência.

::: aprende
- o que segura um B/L na Revisão e como ler a fila;
- cadastrar ou vincular o Cliente de vários B/Ls de uma vez;
- convidar o Cliente para o Portal;
- informar o peso da carga solta;
- o que acontece quando o B/L sai da Revisão.
:::

## 8.1 Ler a fila da Revisão

**Quem faz:** {{Todas as equipes}}. Na rotina, a {{Documentação}}.

O B/L entra na Revisão com uma destas três pendências:

| Pendência | Quer dizer | Onde se resolve |
|---|---|---|
| **Sem cliente vinculado** | A importação não achou um Cliente com o CNPJ do consignatário. | [8.2](#82-cadastrar-ou-vincular-o-cliente) |
| **Portal não provisionado** | O Cliente não tem o Portal pronto para faturar (conta ativa e e-mail de recuperação válido) nem Liberação de faturamento sem Portal. | [8.3](#83-convidar-o-cliente-para-o-portal) |
| **Peso da carga solta ausente** | O B/L de carga solta ou misto está sem peso. | [8.4](#84-informar-o-peso-da-carga-solta) |

Fora delas, só o B/L faturado cuja carga mudou volta para cá ([8.5](#85-quando-a-pendência-não-é-uma-das-três)). O CE Mercante e o cálculo das Taxas Locais também seguram a fatura, mas se resolvem fora da Revisão (capítulos 6 e 21).

::: tela revisao-fila
A Revisão com cinco Clientes, entre eles a NOVA ROTA, ainda sem cadastro, e a MAQUINAS HORIZONTE, esperando o Portal.
:::

1. Os cartões contam as pendências e filtram a fila ao toque. **Outras pendências** reúne o que não é nenhuma das três ([8.5](#85-quando-a-pendência-não-é-uma-das-três)).
2. **Buscar** acha pelo B/L, Cliente, consignatário ou CNPJ; **Navio / viagem** recorta por Viagem.
3. Cada linha é um Cliente, com os seus B/Ls e a **Próxima ação**. A seta abre o grupo.

A fila agrupa os B/Ls pelo CNPJ, mesmo quando ainda não há Cliente: um cadastro resolve todos os B/Ls do grupo de uma vez. Primeiro vêm os grupos que você resolve ali mesmo, os maiores na frente; os que só esperam o Portal ficam no fim. Embaixo de cada grupo aberto, os B/Ls aparecem só para conferência: para corrigir outros dados, abra a ficha do B/L (capítulo 7).

::: atencao
O número ao lado de **Revisão**, no menu, não se atualiza sozinho: o que outra pessoa resolveu só aparece quando você grava algo ou recarrega a página.
:::

## 8.2 Cadastrar ou vincular o Cliente

**Quem faz:** {{Qualquer equipe}} · e-mail do Cliente: {{Administrativo}}, {{Documentação}} e {{Equipamentos}} · convite do Portal: {{Documentação}} e {{Administrativo}}

Quando o CNPJ do B/L não é de nenhum Cliente, alguém decide: o Cliente é novo e precisa de cadastro, ou ele já existe com outro nome. O CNPJ lido no B/L manda: o Vela só cadastra com um dos CNPJs que o B/L traz.

::: lado
1. Na linha do Cliente, clique na seta para abrir o grupo.
2. No bloco **Cadastrar o cliente**, confira o CNPJ lido e escolha **Cadastrar novo cliente** ou **Vincular a um cliente cadastrado**.
3. Para cadastrar, confira **Razão social**, **CNPJ** e **E-mail principal**, que vêm do B/L. Em **Portal do Cliente**, escolha **Enviar o convite agora** ou **Deixar para depois** ({{Equipamentos}} escolhe **Deixar para depois**).
4. Clique em **Cadastrar e vincular** (ou **Vincular N B/Ls**) e confirme.

::: tela revisao-cadastrar
O grupo da NOVA ROTA COMERCIO LTDA, com o CNPJ lido no B/L CSC45810A03K00.
:::
:::

O cadastro grava o Cliente e o e-mail como contato e vincula de uma vez todos os B/Ls do grupo sem Cliente. Quem não é do Administrativo, da Documentação ou de Equipamentos cadastra o Cliente sem e-mail e sem convite.

Repare que o B/L troca de pendência: no exemplo, o CSC45810A03K00 sai de **Sem cliente vinculado** e passa a **Portal não provisionado**, porque o Cliente novo ainda não tem Portal ([8.3](#83-convidar-o-cliente-para-o-portal)).

A **Próxima ação** do grupo muda quando o B/L não traz um CNPJ claro:

| Próxima ação | Quando | O que fazer |
|---|---|---|
| **Identificar o cliente** | Nenhum CNPJ foi lido no B/L. | Leia o texto do consignatário e da descrição da carga que o grupo mostra e informe o CNPJ. |
| **Confirmar o CNPJ do cliente** | O B/L cita CNPJs diferentes. | Clique em **Usar este CNPJ** no do consignatário; o formulário aparece depois. |

::: atencao
- Uma **Sugestão por nome** nunca vincula sozinha: pode ser outra empresa de nome parecido. Confira o CNPJ antes de clicar em **Usar a sugestão**.
- Se o CNPJ é de um Cliente desativado, o grupo não oferece o cadastro: reative o Cliente na ficha dele (capítulo 13) e volte.
- B/L já vinculado cujo documento cita outro CNPJ aparece no bloco **CNPJ do B/L diferente do cliente vinculado**. A troca do Cliente é feita na ficha do B/L ([7.4](07-ficha-do-bl.md#74-vincular-ou-trocar-o-cliente-do-bl)).
:::

## 8.3 Convidar o Cliente para o Portal

**Quem faz:** {{Documentação}} e {{Administrativo}}

A fatura só sai para o Cliente com o Portal ativo, porque é no Portal que ele a vê e paga. Por isso o B/L do Cliente sem conta ativa fica em **Portal não provisionado**. Há duas saídas: o Cliente ativa a conta pelo convite, ou o {{Administrativo}} concede a Liberação de faturamento sem Portal, na ficha do Cliente. Nos dois casos os B/Ls saem da fila sozinhos.

1. Abra o grupo do Cliente. O bloco **Portal do Cliente** mostra a situação da conta e o **E-mail para o convite**.
2. Se o e-mail não é o certo, clique em **Usar outro e-mail** e digite o novo.
3. Clique em **Autorizar e enviar convite** (ou **Reenviar convite** ou **Enviar novo convite**, conforme a situação) e confirme em **Enviar convite**.

Quando a conta está suspensa ou não aceita convite, o bloco leva a **Abrir no Provisionamento do Portal** (capítulo 14). A Liberação fica em **Liberação na ficha do Cliente**.

::: atencao
A Liberação de faturamento sem Portal tem data de revisão. Quando ela vence, os B/Ls ainda não faturados do Cliente voltam para a Revisão.
:::

## 8.4 Informar o peso da carga solta

**Quem faz:** {{Qualquer equipe}}

Na carga solta, a cobrança depende do peso. Sem ele, o B/L espera aqui.

1. Abra o grupo. No bloco **Informar o peso da carga solta**, digite o peso em toneladas na coluna **Peso (t)**, com vírgula decimal.
2. Tecle Enter (Esc desfaz).
3. Confira o antes → depois e clique em **Salvar correção**.

O peso também pode ser corrigido na ficha do B/L, no campo **Peso (t)** da aba **Detalhes do B/L** ([7.2](07-ficha-do-bl.md#72-corrigir-os-dados-do-bl)).

## 8.5 Quando a pendência não é uma das três

**Quem faz:** {{Qualquer equipe}}

O cartão **Outras pendências** reúne o B/L que está em Revisão por um motivo que não é nenhuma das três pendências. A próxima ação é **Conferir os dados do B/L**: o grupo mostra os dados principais para corrigir, com **Notas da revisão** e **Justificativa**.

1. Abra o grupo e leia a pendência registrada, quando houver.
2. Corrija o que faltar e clique em **Salvar revisão**. O Vela recalcula: se não sobra pendência, o B/L sai da fila.

O caso mais comum é o B/L já faturado cuja carga mudou depois da fatura (um container a mais, um peso corrigido). Ele volta para a Revisão para lembrar que a fatura precisa de correção. Esse B/L sai da fila sozinho quando a fatura é corrigida (capítulo 22).

::: atencao
No B/L faturado, **Salvar revisão** tira o B/L da fila, mas não corrige a fatura, embora o resultado fale em fatura emitida: é a fatura antiga. Corrija a fatura primeiro.
:::

## 8.6 O que acontece quando o B/L sai da Revisão

**Quem faz:** {{Todas as equipes}}

Quando você resolve a última pendência, o B/L sai da Revisão e o Vela tenta faturar na hora: recalcula as Taxas Locais e, se o B/L tem CE Mercante e o cálculo está completo, emite a fatura. Sem CE, a fatura espera a planilha de CE (capítulo 6) e sai sozinha depois.

Cada ação deixa um resultado no alto da tela:

| Resultado | O que fazer |
|---|---|
| "Saiu da revisão e a fatura foi emitida automaticamente." | Nada. |
| "Continua em revisão: …" | Resolva a pendência que sobrou. |
| "Saiu da revisão, mas o faturamento automático não concluiu: …" | Leia o motivo. "Aguardando cadastro do CE Mercante" é o caminho normal: a fatura sai depois da planilha de CE. Os outros motivos costumam ser do cálculo das Taxas Locais (capítulo 21). |

No cadastro ou vínculo do grupo, o resultado resume o grupo: quantos B/Ls saíram, quantas faturas foram emitidas e o que continua em revisão.

O aviso "taxas locais ainda por recalcular", com **Recalcular taxas**, aparece sempre que a fatura não sai, também por falta de CE. Nesse caso não precisa recalcular: a fatura sai com a planilha de CE.

::: atencao
- Se a última fatura do B/L foi cancelada por uma pessoa, a Revisão não emite outra: a nova sai só pelo **Emitir fatura** da ficha ([7.6](07-ficha-do-bl.md#76-as-taxas-locais-na-ficha)).
:::
