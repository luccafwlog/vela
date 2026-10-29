Algumas coisas o Vela faz pelo relógio, sem que ninguém clique em nada: confere os prazos, manda os avisos ao Cliente, cobra a Demurrage, busca a cotação do dólar e baixa os Pix pagos. Quase todas essas rotinas também rodam logo depois da ação que as provoca; o relógio é a rede de segurança, que pega o que ficou para trás. Este capítulo diz quando cada rotina roda, o que ela muda para a equipe e para o Cliente e qual alerta avisa quando ela para. Os horários são de Brasília.

::: aprende
- quando cada rotina roda e o que ela muda;
- por que um efeito pode levar alguns minutos para aparecer;
- como os avisos ao Cliente e a cobrança da Demurrage saem sozinhos;
- qual alerta avisa que uma rotina parou, e o que fazer.
:::

## 19.1 O relógio do Vela

| Rotina | Quando roda | O que muda |
|---|---|---|
| Conferência dos alertas | A cada 15 minutos | Abre os alertas de prazo e fecha os que perderam a causa |
| Passos depois da importação | A cada minuto e logo depois da importação | Marcas do Baplie, Taxas Locais, faturas pelo CE, Invoice de Demurrage |
| Comunicados automáticos | A cada 2 minutos e logo depois do fato | NOA, NOR, NOB e CE e Taxas aos Clientes |
| Régua de Cobrança da Demurrage | A cada 5 minutos; envia em dia útil, a partir das 9h | E-mail de cobrança das Invoices em aberto |
| Situação da Demurrage | Todo dia, às 00h17 | Marca **Em atraso** os containers que venceram o free time |
| PTAX e recálculo da Demurrage | De segunda a sexta, às 14h | Câmbio do dia e novo valor em reais das Invoices |
| Pix do Itaú | A cada minuto, com a cobrança pelo Itaú ligada | QR das faturas e baixa dos Pix pagos |
| Desbloqueio de CE | Logo depois do fato e a cada 5 minutos; limpeza às 3h | Avisos ao Cliente, validação das solicitações, documentos vencidos |
| Liberação vencida | Todo dia, às 00h13 | Devolve à Revisão os B/Ls do Cliente sem Portal |
| Convites do Portal | A cada 15 minutos | Marca como expirado o convite com mais de 48 horas |
| Entrega de e-mail | A cada minuto e logo que o provedor avisa | Registra a entrega e bloqueia o endereço devolvido |
| Resumo do Portal | Todo dia, às 8h | E-mail interno à {{Documentação}} e ao {{Administrativo}} |

Por isso um efeito pode levar um ou dois minutos para aparecer. Se depois de alguns minutos ele não apareceu, confira os **Alertas**: quando uma rotina para, um alerta avisa ([19.9](#199-quando-uma-rotina-para)).

## 19.2 Os alertas que dependem do relógio

**Quem acompanha:** {{Todas as equipes}}, cada uma os seus alertas (capítulo 20).

A maior parte dos alertas abre e fecha na hora da ação. Alguns dependem só da passagem do tempo: ninguém mexe em nada, e o prazo chega. Esses são abertos pela conferência de 15 minutos, que também fecha o que perdeu a causa e corrige o que a ação deixou passar. São eles:

- o ETA, o ETB ou o ETD que chegou sem a data realizada, no próprio dia;
- os prazos da documentação: 7 dias antes do primeiro ETA no Brasil, os de B/L esperado e de Baplie; 5 dias antes, o de CE Mercante pendente e o de Planilha de Veículos; 5 dias antes do ETA de cada porto, o de B/L sem Cliente;
- o prazo de 72 horas do ADR de Saída, contado do ATD;
- os avisos ao Cliente que deviam ter saído e não saíram;
- as contas do Portal do Cliente e os e-mails sem retorno do provedor.

O convite do Portal que expira (48 horas) não é reenviado sozinho: reenvie pelo **Provisionamento do Portal** (capítulo 14).

::: atencao
O alerta de prazo pode aparecer até 15 minutos depois de o prazo vencer.
:::

## 19.3 Os passos depois da importação

**Quem acompanha:** {{Documentação}}

A importação grava o arquivo e deixa alguns passos para logo depois: aplicar as marcas do Baplie, calcular as Taxas Locais, emitir a fatura pelo CE, emitir a Invoice de Demurrage quando o último container é devolvido e refazer as contas depois dos veículos. Eles rodam em segundos depois da gravação e, de novo, a cada minuto.

O passo que espera alguém não é falha. O B/L em Revisão ou sem tabela de cobrança espera sem o alerta de bloqueio (a falta de tabela de cobrança tem o seu, **Tabela de cobrança faltando**) e sai sozinho quando a Revisão, o Cliente ou a tabela de cobrança mudam.

O passo que falha por um motivo passageiro tenta de novo sozinho; a falha de dado bloqueia na hora. Bloqueado, o passo abre **Efeito de importação bloqueado**, que se resolve com **Reprocessar** ([6.10](06-importacao.md#610-quando-algo-fica-parado-depois-da-importação)).

## 19.4 Os Comunicados automáticos

**Quem acompanha:** {{Documentação}}

Os avisos ao Cliente saem sozinhos. A cada 2 minutos o Vela confere o que ficou devido e manda; o fato que deixa um aviso pronto (uma data do navio, um CE, uma fatura) o adianta para logo depois da gravação.

| Aviso | Quando sai | Para quais contatos |
|---|---|---|
| **NOA · Chegada Próxima** | De 5 dias antes do ETA até o ETA, enquanto a escala não tem ATA | Caixa **Documentação e Operação** |
| **NOR · Aviso de Chegada** | Depois do ATA, por até 30 dias | Caixa **Documentação e Operação** |
| **NOB · Aviso de Atracação** | Depois do ATB, por até 30 dias, para os B/Ls daquele terminal | Caixa **Documentação e Operação** |
| **CE e Taxas** | Quando todos os B/Ls do Cliente na Viagem têm CE, estão sem pendência na Revisão e faturados | Caixas **Documentação e Operação** e **Financeiro** |

Cada contato recebe cada aviso uma vez. O NOA, o NOR ou o NOB que você mandou à mão também conta: o contato que já recebeu não recebe de novo. Quando um envio falha, o Vela tenta de novo e, se não conseguir, abre um alerta (capítulo 20).

::: atencao
Enquanto a chave **Envio real** estiver desligada, todo e-mail ao Cliente vai para o suporte, com "[Teste → e-mail do Cliente]" no assunto, e conta como recebido. Ligar a chave depois não reenvia ao Cliente o que foi ao suporte.
:::

## 19.5 A Demurrage pelo relógio

**Quem acompanha:** {{Equipamentos}}

Três rotinas cuidam da Demurrage:

- **Todo dia, às 00h17,** o Vela marca **Em atraso** os containers não devolvidos que venceram o free time. Gravar uma data já recalcula na hora; esta rotina cuida da passagem do dia.
- **De segunda a sexta, às 14h,** busca a PTAX, a cotação oficial do dólar, e grava o câmbio do dia. Com ele, recalcula em reais as Invoices emitidas e não pagas, com Pix novo; o valor em dólar não muda, e a Invoice com câmbio informado à mão fica como está. Em feriado vale a última PTAX divulgada. Esse câmbio é também o que as Taxas Locais em dólar fixam no primeiro cálculo.
- **A cada 5 minutos,** a Régua de Cobrança manda por e-mail a cobrança de cada Invoice emitida e não paga, só em dia útil e a partir das 9h. A primeira sai na primeira rodada depois da emissão, dentro desse horário; as seguintes, a cada 7 dias (o intervalo padrão), até o pagamento. As Invoices do mesmo Cliente vão num e-mail só. A Régua pausa a Invoice com Disputa aberta ou com Pix em análise.

::: atencao
- Se a PTAX não chega, o último câmbio continua valendo, abre um alerta (capítulo 20) e alguém do {{Financeiro}}, do {{Administrativo}} ou de {{Equipamentos}} usa **Informar PTAX**, em **Demurrage**.
- Com a cobrança pelo Itaú ligada, a partir de 1º de novembro abre **Calendário de feriados pendente** se os feriados do ano seguinte não estão cadastrados. Sem eles, feriado conta como dia útil na Régua e nos prazos do Pix da Demurrage. Peça o cadastro ao suporte técnico.
:::

## 19.6 O Pix do Itaú

**Quem acompanha:** {{Financeiro}}

Com a cobrança pelo Itaú ligada, uma rotina a cada minuto cuida do Pix das faturas:

- **gera o QR** segundos depois da emissão e o refaz quando o saldo muda. Até lá, a fatura impressa diz "QR Code em preparação". O QR da Demurrage vale até 14h30 do dia útil seguinte e acompanha a PTAX;
- **consulta os Pix recebidos** na conta e dá a baixa automática do Pix de cobrança do Vela que tem o valor exato. A fatura fica **Paga** no Vela e no Portal, com o recibo;
- **separa o que não é seguro**: o Pix com valor diferente, ou de uma fatura já paga ou cancelada, vai para **Pix em análise** e abre **PIX sem conciliação segura** para o {{Financeiro}} e o {{Administrativo}} (capítulo 24).

::: atencao
Se a consulta para, os Pix pagos deixam de ser baixados e abre um alerta (capítulo 20). Enquanto isso, o {{Financeiro}} usa **Conciliar extrato**, em **Conciliação PIX**.
:::

## 19.7 O Desbloqueio de CE

**Quem acompanha:** {{Documentação}}

- **Avisos ao Cliente.** Os dois avisos do Desbloqueio de CE (documento recusado e documentação validada) saem por e-mail segundos depois de gravados; a rotina de 5 minutos repete os que ficaram para trás.
- **Validação.** A mesma rotina de 5 minutos reconfere as solicitações pelo que acontece fora do Desbloqueio, como um pagamento, uma isenção ou a troca de Cliente. Por isso a solicitação pode levar até 5 minutos para passar a **Documentação validada** depois que a fatura é paga.
- **Limpeza.** Todo dia, às 3h, o Vela remove os arquivos que passaram do prazo de guarda e cancela o rascunho criado há mais de 7 dias que já não tem documento guardado, o que solta os B/Ls dele.

O detalhe de cada prazo está no capítulo 12.

## 19.8 O Portal: Liberação, entrega de e-mail e resumo diário

**Quem acompanha:** {{Documentação}} e {{Administrativo}}

**Liberação vencida.** A Liberação de faturamento sem Portal vale até a data de revisão; passado esse dia, as novas faturas do Cliente voltam a ficar retidas na hora. Às 00h13, uma rotina devolve à Revisão os B/Ls não faturados desses Clientes, com o alerta **Revisão de B/L — Portal não provisionado**.

**Entrega de e-mail.** A cada minuto, e logo que o provedor de e-mail avisa, o Vela registra se cada e-mail foi entregue, devolvido ou marcado como spam: é a **Última entrega** que aparece no Provisionamento do Portal. O endereço devolvido em definitivo ou marcado como spam é bloqueado e para de receber. Se ele era o último contato válido do Cliente, abre **Cliente sem contato alternativo**.

**Resumo do Portal.** Às 8h, cada pessoa ativa da {{Documentação}} e do {{Administrativo}} recebe o e-mail **Resumo do Portal**, com o que pede ação e o que fechou. Ele não sai quando não há nada a mostrar.

## 19.9 Quando uma rotina para

**Quem faz:** a equipe que recebe o alerta.

Uma rotina parada não trava a tela: a gravação acontece, e o que a rotina faria fica esperando. Por isso o aviso vem pelos **Alertas**: cada rotina tem o seu, e ele chega à equipe que pode agir. Quase sempre o caminho é corrigir o dado que o alerta aponta (um contato do Cliente, a PTAX do dia) ou avisar o suporte técnico. Cada um desses alertas está no capítulo 20.

::: atencao
A situação da Demurrage (00h17) e a Liberação vencida (00h13) não têm alerta próprio quando falham. Se um container que venceu o free time continua **No free time** no dia seguinte, avise o suporte técnico.
:::
