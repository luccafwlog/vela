O Vela escreve ao Cliente por e-mail: avisa que o navio vai chegar, que chegou e que atracou, manda o CE Mercante com as Taxas Locais, cobra a Demurrage e cuida da conta do Portal. Quase tudo sai sozinho, na hora certa ([19.4](19-rotinas-por-horario.md#194-os-comunicados-automáticos)). Este capítulo é o lado da equipe: saber para quem vai cada e-mail, acompanhar se ele saiu e chegou, mandar à mão o que faltou, reenviar o CE e Taxas e corrigir o contato que não recebe. Quase tudo isso fica em **Clientes**, aba **Comunicação**.

::: aprende
- para quais contatos do Cliente vai cada e-mail;
- como saber se os e-mails estão saindo de verdade ou indo para o suporte;
- acompanhar, viagem por viagem, os avisos que já saíram;
- conferir se um e-mail chegou;
- mandar à mão um NOA, NOR ou NOB, ou um texto seu;
- reenviar o Comunicado de CE e Taxas;
- descobrir por que um aviso não saiu e corrigir o contato.
:::

## 16.1 Saber para quem vai cada e-mail

**Quem faz:** {{Todas as equipes}}

O Cliente não recebe tudo em todos os endereços. Cada contato dele fica em uma ou mais de três **caixas**, e cada e-mail vai para as caixas do seu assunto. Na ficha do Cliente, aba **Cadastro e contatos**, o bloco **Quem recebe os Comunicados** mostra quem está em cada caixa; como cadastrar os contatos e ligá-los às caixas está no capítulo 13.

| E-mail | Quando sai | Vai para |
|---|---|---|
| **NOA**, **NOR** e **NOB** (chegada prevista, chegada e atracação) | Sozinho, pelas datas do navio; ou à mão ([16.5](#165-mandar-um-noa-nor-ou-nob-à-mão)) | Caixa **Documentação e Operação** |
| **CE Mercante · Taxas Locais** | Sozinho, quando o Cliente fica pronto na Viagem; reenvio à mão ([16.7](#167-reenviar-o-comunicado-de-ce-e-taxas)) | Caixas **Documentação e Operação** e **Financeiro** |
| **Cobrança de Demurrage** | Sozinha, pela Régua de Cobrança ([19.5](19-rotinas-por-horario.md#195-a-demurrage-pelo-relógio)) | Caixas **Financeiro** e **Demurrage** |
| **Comunicado livre** | À mão, para os Clientes de uma Viagem ([16.6](#166-escrever-um-comunicado-livre-ou-institucional)) | Todos os contatos ou a caixa que você escolhe |
| **Institucional** | À mão, sem carga ([16.6](#166-escrever-um-comunicado-livre-ou-institucional)) | Todos os contatos |
| Avisos do Desbloqueio de CE | Documento recusado e documentação validada (capítulo 12) | Caixa **Documentação e Operação** |
| E-mails da conta do Portal | Convite, recuperação de senha, troca de e-mail (capítulo 14) | O **E-mail de recuperação** da conta |

Só recebe o contato ativo, com e-mail válido e endereço que não está bloqueado. O mesmo endereço em dois contatos recebe uma vez, e cada e-mail fala de um Cliente só. Toda caixa precisa de alguém: quando ela fica sem outro contato que possa receber, o contato principal volta a recebê-la.

::: atencao
- A caixa sem nenhum contato ativo com e-mail aparece com "Nenhum contato com e-mail", em âmbar, e os avisos dela não saem. Ligue um contato a ela (capítulo 13).
- Os avisos do Desbloqueio de CE também vão ao sino do Portal; sem contato na caixa, ficam só no sino.
:::

## 16.2 Saber se os e-mails saem de verdade

**Quem faz:** {{Todas as equipes}}

No alto da **Comunicação**, o bloco **Canal de envio** diz para onde vão agora os e-mails ao Cliente:

- **Envio real**: os e-mails saem para os contatos do Cliente.
- **Redirecionado ao suporte**, em âmbar: todo e-mail de Cliente vai para suporte@portalfwlog.com.br, com "[Teste → e-mail do Cliente]" no assunto. Nada chega ao Cliente.

É a chave **Envio real**, uma ferramenta de teste que existe enquanto o Vela não opera com Clientes reais. Ela vale para todo e-mail de Cliente: os Comunicados automáticos e os mandados à mão, a Cobrança de Demurrage, os avisos do Desbloqueio de CE e os e-mails da conta do Portal. O **Resumo do Portal**, que vai à equipe, não depende dela ([19.8](19-rotinas-por-horario.md#198-o-portal-liberação-entrega-de-e-mail-e-resumo-diário)).

O e-mail que foi ao suporte conta como enviado: a Cobertura e o Histórico o mostram como **Redirecionado ao suporte** ou **Ao suporte**, e ligar a chave depois não o reenvia ao Cliente.

A chave só aparece para quem a equipe de desenvolvimento autorizou, no próprio bloco.

## 16.3 Acompanhar a Cobertura de viagens

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

A **Cobertura de viagens** responde "os Clientes desta viagem já foram avisados?". Cada linha é um navio e viagem num porto de descarga: a COSCO SHIPPING SEREIA / 024E tem uma linha para Salvador (BRSSA) e outra para Vitória (BRVIX). Nas colunas **NOA**, **NOR** e **NOB**, "2 de 3" quer dizer dois Clientes avisados de três devidos, em âmbar enquanto falta algum; "—", que nada é devido ainda (o NOA conta a partir de 5 dias antes do ETA, o NOR depois do ATA). **CE e Taxas enviados** conta os Clientes que receberam, dos que já podem receber; **Sem CE ou fatura**, os que ainda não podem.

::: passos
1. Em **Clientes**, abra a aba **Comunicação**. A vista **Cobertura de viagens** abre primeiro.
2. Se precisa, filtre por **Navio**, **Viagem** ou **Mês** (o mês do ETA). A viagem da escala mais próxima vem no alto.
3. Clique na seta da linha para ver cada Cliente e a situação de cada aviso.
4. Para ver o e-mail que saiu, clique em **Enviado em …**: abre o Histórico desse Cliente na Viagem.
:::

::: tela comunicacao-cobertura
A Cobertura de viagens, com a COSCO SHIPPING SEREIA / 024E nos dois portos.
:::

Na linha aberta, cada aviso de cada Cliente diz em que pé está:

| Situação | Quer dizer |
|---|---|
| **Enviado em …** | Saiu. Também **Redirecionado ao suporte em …** (chave desligada) ou **Parcial em …** (parte dos contatos falhou). |
| **Na fila · próxima rodada às …** e **Em envio** | Está saindo sozinho; não faça nada. |
| **Devido, não enviado** | Só no CE e Taxas: o Cliente está pronto e o e-mail ainda não saiu. |
| **Bloqueado** | Não sai até alguém agir. O motivo vem embaixo ([16.8](#168-quando-um-aviso-não-sai)). |
| **Não devido** ou **Sem atracação devida** | Não há aviso a mandar agora. |

::: atencao
- No NOA, NOR e NOB, **Não devido** aparece também quando a janela do aviso passou sem envio. Para saber se um aviso saiu, confira o **Histórico** ([16.4](#164-conferir-se-um-e-mail-saiu-e-chegou)).
- "Reenvio pendente", no CE e Taxas, é o Cliente que já recebeu e ganhou na Viagem um B/L que ainda não está pronto. Quando o B/L ficar pronto, o Vela não manda outro CE e Taxas sozinho: reenvie à mão ([16.7](#167-reenviar-o-comunicado-de-ce-e-taxas)).
:::

## 16.4 Conferir se um e-mail saiu e chegou

**Quem faz:** {{Qualquer equipe}}

O **Histórico** da **Comunicação** guarda cada Comunicado enviado ao Cliente, automático ou à mão, com o resultado de cada destinatário. É ali que você responde ao Cliente que diz "não recebi". O mesmo Comunicado aparece também no **Histórico** da ficha do Cliente e, quando fala de um B/L, no da ficha do B/L, com link para cá.

::: passos
1. Em **Clientes** › **Comunicação**, abra a vista **Histórico**.
2. Filtre por **Navio**, **Mês**, **Modelo**, **Situação** ou **Origem** (**Automático** ou **Operador**).
3. Clique na seta da linha. Aparecem os B/Ls, os anexos e cada destinatário, com o e-mail usado, o **Envio** (**Real** ou **Ao suporte**), a **Situação** e o **Motivo** da falha.
:::

A **Situação** da linha resume os destinatários: **Enviado** quando todos saíram, **Parcial** quando parte falhou, **Falha** quando nenhum saiu e **Ao suporte** com a chave desligada. A de cada destinatário diz até onde o e-mail foi:

| Situação do destinatário | Quer dizer |
|---|---|
| **Em envio** ou **Aceito pelo provedor** | Saiu do Vela; ainda não há confirmação de que chegou. |
| **Entregue** | O servidor de e-mail do Cliente recebeu. |
| **Falha passageira** | Um problema que passa. Pode repetir. |
| **Recusado pelo provedor**, **Devolvido (endereço inexistente)** ou **Marcado como spam** | Repetir não adianta: corrija o contato ([16.9](#169-corrigir-o-contato-que-não-recebe)). |

A confirmação de entrega, a devolução e o spam chegam do provedor em poucos minutos ([19.8](19-rotinas-por-horario.md#198-o-portal-liberação-entrega-de-e-mail-e-resumo-diário)). Os e-mails da conta do Portal (convite, recuperação de senha) não ficam neste Histórico: a entrega deles aparece no **Provisionamento do Portal**, em **Última entrega** (capítulo 14).

::: atencao
"Entregue" quer dizer que o servidor do Cliente recebeu, não que alguém leu. Se o Cliente não acha o e-mail, peça que procure no spam e confira o endereço.
:::

## 16.5 Mandar um NOA, NOR ou NOB à mão

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

Os avisos de chegada e atracação saem sozinhos. Mande à mão quando o automático já não sai (a janela passou: o NOA só vai até o ETA, o NOR e o NOB até 30 dias depois) ou quando o Cliente pede de novo. À mão não há janela: o NOA precisa do ETA da escala, o NOR do ATA e o NOB do ATB da atracação.

::: passos
1. Em **Clientes** › **Comunicação**, abra a vista **Disparo**. Em **Modo**, deixe **Carga** e escolha o modelo: **NOA · Chegada Próxima**, **NOR · Aviso de Chegada** ou **NOB · Aviso de Atracação**.
2. Em **Recorte da carga**, informe pelo menos um de **Navio / Viagem**, **POL** ou **POD**, como COSCO SHIPPING SEREIA / 024E e BRVIX. Para um Cliente só, acrescente o **CNPJ do Cliente (opcional)**.
3. Clique em **Conferir destinatários**. A lista mostra cada Cliente, os B/Ls, os e-mails que vão receber e os que ficaram de fora, com o motivo. Desmarque quem não deve receber; **Ver e-mail** mostra a mensagem daquele Cliente.
4. Clique em **Disparar para N cliente(s)** e confirme. A confirmação diz se é **Enviar de verdade** ou **Enviar ao suporte**, conforme a chave ([16.2](#162-saber-se-os-e-mails-saem-de-verdade)).
5. Leia o **Resultado do disparo**: quantos saíram, quantos foram ao suporte e cada falha, com o motivo.
:::

Para a falha passageira, use **Repetir só as falhas**: sai de novo no mesmo Comunicado, só para quem falhou. A falha marcada "Não adianta repetir; corrija o contato." fica fora: corrija o contato antes ([16.9](#169-corrigir-o-contato-que-não-recebe)). O aviso mandado à mão conta para o automático: quem recebeu pela tela não recebe o mesmo aviso de novo ([19.4](19-rotinas-por-horario.md#194-os-comunicados-automáticos)).

::: atencao
- O Cliente que já recebeu aquele aviso na mesma escala aparece com "Reenvio N", e o disparo só libera depois de você marcar **Confirmo o reenvio.** Ele recebe de novo.
- A linha **Bloqueado** não pode ser marcada; o motivo está em **Situação**. No NOB, o terminal sem sigla bloqueia o Cliente, e a atracação sem frente de operação atribuída não traz carga nenhuma: atribua a frente na escala ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)).
:::

## 16.6 Escrever um Comunicado livre ou institucional

**Quem faz:** {{Qualquer equipe}}

Há dois jeitos de mandar um texto seu:

- O **Comunicado livre** (modo **Carga**) vai aos Clientes de uma Viagem. O e-mail leva, além do seu texto, o bloco "Sua carga", com o navio, a viagem e os B/Ls daquele Cliente, e o Comunicado aparece no histórico de cada B/L. Em **Público**, você escolhe **Todos os contatos** ou uma caixa.
- O **Institucional** (modo **Institucional**) não fala de carga e vai para todos os contatos de cada **Cliente Comunicável**: o Cliente com contato com e-mail e com B/L numa escala que teve ETA nos últimos 12 meses (viagem futura também conta).

::: passos
1. Em **Disparo**, escolha o **Modo**. No livre, escolha **Comunicado livre**, informe o recorte da carga e o **Público**; no institucional, informe o **CNPJ do Cliente (opcional)** se o texto é para um Cliente só.
2. Escreva **Assunto** e **Mensagem**. A saudação e a assinatura entram sozinhas. Para usar um texto guardado, escolha-o em **Reaproveitar modelo salvo...**; para guardar este, dê um **Nome do modelo** e clique em **Salvar este texto**.
3. Se precisa de anexo, use **Adicionar**, em **Anexos**.
4. Clique em **Conferir destinatários**, confira a lista e dispare, como em [16.5](#165-mandar-um-noa-nor-ou-nob-à-mão).
:::

::: atencao
- O institucional sem CNPJ vai para todos os Clientes Comunicáveis, a base inteira. Confira os números em **Pronto para disparar** antes de confirmar.
- O modelo salvo não se edita nem se apaga: confira o texto antes de salvar.
:::

## 16.7 Reenviar o Comunicado de CE e Taxas

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

O Comunicado de CE e Taxas traz, para cada B/L do Cliente na Viagem, o CE Mercante e o valor faturado, com o total da viagem e um botão para as faturas no Portal. Ele sai sozinho uma vez por Cliente e Viagem, quando o Cliente fica pronto: todos os B/Ls dele naquela Viagem com CE, sem pendência na Revisão e faturados. A ATLANTICO IMPORTADORA, com um B/L para Salvador e outro para Vitória, só recebe quando os dois estão prontos; um Cliente não espera o outro.

Ele não se dispara pela vista **Disparo**: o reenvio sai pelo **Histórico**. Reenvie quando:

- o CE de um B/L mudou depois do envio. Abre para a {{Documentação}} o alerta **Reenviar Comunicado de CE e Taxas**, cujo link já abre o Histórico daquele B/L;
- o Cliente ganhou um B/L na Viagem depois do envio e ele ficou pronto;
- o Cliente pede de novo.

::: passos
1. Em **Clientes** › **Comunicação**, vista **Histórico**, escolha o **Modelo** **CE Mercante · Taxas Locais** e o **Navio**, ou siga o link do alerta.
2. Clique na seta do Comunicado mais recente do Cliente naquela Viagem.
3. Clique em **Reenviar CE e Taxas** e confirme. O e-mail sai com o CE e os valores de agora, para as caixas **Documentação e Operação** e **Financeiro**.
4. Leia o resultado embaixo do botão: "CE e Taxas reenviado (tentativa N)." ou "Reenvio não feito", com o motivo.
:::

O reenvio fecha o alerta **Reenviar Comunicado de CE e Taxas** dos B/Ls daquele Cliente na Viagem.

::: atencao
- O reenvio só sai com o Cliente pronto. Com um B/L sem CE, em Revisão ou sem fatura, aparece "Reenvio não feito" e o motivo; resolva a pendência antes.
- **Reenviar CE e Taxas** só aparece no Comunicado mais recente de cada Cliente e Viagem.
:::

## 16.8 Quando um aviso não sai

**Quem faz:** {{Documentação}}

Comece pela **Cobertura de viagens**: abra a linha da viagem e veja a situação do Cliente ([16.3](#163-acompanhar-a-cobertura-de-viagens)). Quando o aviso está **Bloqueado**, o motivo diz o que fazer:

| O motivo diz | O que fazer |
|---|---|
| "falta faturar N B/Ls", "falta CE Mercante em N B/Ls" ou "N B/Ls em revisão" | Só no CE e Taxas. Resolva a pendência do B/L (capítulos 6 e 8); o aviso sai sozinho logo depois. |
| "sem contato ativo na caixa do modelo" | Ligue à caixa um contato com e-mail (capítulo 13). O aviso sai em poucos minutos. |
| "falha no envio; nova tentativa a partir de …" | Nada: o Vela tenta de novo sozinho. |
| "recusado na última rodada; volta em até 24 h" | Leia o motivo no alerta, corrija o dado indicado ou avise o suporte técnico. |

Se o aviso aparece como **Enviado**, abra o **Histórico** e veja a situação de cada destinatário ([16.4](#164-conferir-se-um-e-mail-saiu-e-chegou)). Se o NOA, o NOR ou o NOB aparece como **Não devido** e não está no Histórico, a janela passou: mande à mão ([16.5](#165-mandar-um-noa-nor-ou-nob-à-mão)).

Esses casos também chegam à {{Documentação}} como alerta (capítulo 20). Os avisos do Desbloqueio de CE e a Cobrança de Demurrage não entram na Cobertura: quando não saem, também abrem um alerta.

::: atencao
Com o **Canal de envio** em **Redirecionado ao suporte**, a Cobertura mostra o aviso como saído, mas nada chegou ao Cliente ([16.2](#162-saber-se-os-e-mails-saem-de-verdade)).
:::

## 16.9 Corrigir o contato que não recebe

**Quem faz:** {{Documentação}}, {{Equipamentos}} e {{Administrativo}}

Quando o servidor do Cliente devolve um e-mail porque o endereço não existe, ou quando o Cliente o marca como spam, o Vela bloqueia o endereço. O contato continua no cadastro, com o aviso "Endereço bloqueado: Falha permanente na entrega (Bounce)" ou "Endereço bloqueado: Reclamação registrada", e deixa de receber. O endereço devolvido para de receber os Comunicados e os e-mails do Portal; o marcado como spam, só os Comunicados.

O Vela reage sozinho: as caixas que ficaram sem destinatário voltam ao contato principal, e outro contato do Cliente recebe o e-mail "Falha de entrega: atualize o cadastro do cliente", com um botão para **Meu perfil**, no Portal. Se não sobra nenhum contato válido, abre **Cliente sem contato alternativo** para a {{Documentação}} e o {{Administrativo}} (capítulo 20).

::: passos
1. Peça ao Cliente o endereço certo.
2. Na ficha do Cliente, aba **Cadastro e contatos**, troque o **E-mail** do contato bloqueado, ou adicione um contato novo e ligue-o às caixas.
3. Clique em **Salvar contatos**.
:::

O endereço novo já recebe os próximos e-mails. O próprio Cliente também pode corrigir os contatos em **Meu perfil**, no Portal (capítulo 15).

::: atencao
- Nenhuma tela do Vela tira o bloqueio de um contato: o caminho é trocar o e-mail. Digitar de novo o mesmo endereço não libera. O **E-mail de recuperação** da conta do Portal tem caminho próprio, no **Provisionamento do Portal** (capítulo 14).
- Se uma caixa fica só com endereços bloqueados, o Vela salva os contatos, avisa que a caixa segue sem e-mail apto a receber e abre um alerta (capítulo 20).
:::
