Quase toda ação no Vela tem efeitos que vão além da tela em que você está. O CE que você grava emite a fatura e mostra o B/L ao Cliente; a data do navio que você corrige chega ao Portal e muda os prazos da documentação; a devolução de um container que passou do free time emite a Demurrage. Este capítulo junta esses efeitos, ação por ação, para você saber o que a sua ação muda para outra equipe e para o Cliente. Cada quadro segue a mesma ordem: o que você faz, o que o Vela faz sozinho e onde isso aparece. O que roda pelo relógio, sem ação de ninguém, está no [capítulo 19](19-rotinas-por-horario.md).

::: aprende
- o que o CE Mercante libera ao ser gravado;
- o que as datas do navio mudam na programação, nos prazos e nos avisos ao Cliente;
- o que acontece com a cobrança quando o Cliente ou o B/L muda;
- o que muda quando as datas de um container mudam;
- o que a emissão e o cancelamento de uma fatura fazem sozinhos.
:::

## 18.1 Vincular o CE ao B/L

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}. O primeiro CE entra só pela planilha de CE ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)); na ficha do B/L dá para corrigir ou remover o CE ([6.6](06-importacao.md#66-corrigir-o-ce-ou-o-manifesto-de-um-bl)).

O CE é o que torna a Taxa Local devida. Por isso é a ação com mais efeitos no Vela: ela fecha o cálculo, emite a fatura e abre o B/L para o Cliente.

| Você faz | O Vela faz | Onde aparece |
|---|---|---|
| Grava o primeiro CE do B/L | Calcula as Taxas Locais de novo e emite a fatura, se o B/L está pronto. | **Taxas Locais**; Portal: "Nova fatura emitida" |
| | Mostra o B/L ao Cliente. | Portal do Cliente |
| | Põe o B/L no Manifesto Mercante da rota. | **Rotas e Manifestos** |
| | Fecha **CE Mercante pendente** quando nada mais falta e pode passar **BLs e CEs** da escala a **Aprovado**. | **Alertas**; ficha da Viagem |
| | Quando todos os B/Ls do Cliente na Viagem têm CE, estão sem pendência na Revisão e faturados, manda o Comunicado de CE e Taxas. | E-mail ao Cliente |
| Troca o CE | Registra a troca no histórico do B/L. Não recalcula nem mexe na fatura já emitida. Pela ficha, o B/L continua no mesmo Manifesto; pela planilha, passa ao Manifesto do arquivo. Se o Comunicado de CE e Taxas já saiu, abre **Reenviar Comunicado de CE e Taxas**; se o Desbloqueio de CE já foi conferido, abre **CE trocado depois do Desbloqueio conferido**. | **Alertas** da {{Documentação}} |
| Remove o CE (só sem fatura) | Tira o B/L do Portal e do Manifesto, e o B/L volta a contar como CE pendente. | Portal; **Alertas** |

O B/L que não está pronto não perde nada: a fatura espera e sai sozinha quando a pendência se resolve. O resultado da planilha diz o que segura cada uma ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)).

::: atencao
- Grave o CE depois de completar os B/Ls que dividem um container. A Taxa Local do container é rateada entre os B/Ls já gravados; se um B/L chega depois da fatura, o rateio muda e a fatura emitida é corrigida.
- A fatura que uma pessoa cancelou não volta pelo CE ([18.9](#189-emitir-ou-cancelar-uma-fatura)).
:::

## 18.2 Mudar a chegada prevista do navio

**Quem faz:** {{Qualquer equipe}}, na escala ([4.4](04-viagens-escalas.md#44-manter-as-datas-do-navio-em-dia)) ou em **Chegadas e Saídas** ([5.3](05-programacao.md#53-corrigir-as-datas-de-um-navio)).

O ETA, a chegada prevista, é a data que mais mexe no Vela, porque os prazos da documentação e os avisos de chegada contam dele.

| Você faz | O Vela faz | Onde aparece |
|---|---|---|
| Muda o ETA | Reordena a **Próxima escala**, a lista de Viagens e o Line Up. | Viagens; Line Up |
| | Leva a data nova à programação. | **Chegadas e Saídas**; Portal e site fwlog.com.br, se a Viagem está publicada e Ativa |
| | Refaz os prazos da documentação. Sete dias antes do primeiro ETA no Brasil abrem **B/L esperado pendente** e **Baplie ausente**; cinco dias antes, **CE Mercante pendente** e, para {{Equipamentos}}, **Planilha de Veículos pendente**. O alerta de B/L sem Cliente conta do ETA de cada porto, cinco dias antes. | **Alertas** da {{Documentação}} |
| | Move a janela do aviso de chegada (NOA), que sai aos Clientes a partir de cinco dias antes do ETA. | E-mail ao Cliente |
| Deixa o ETA chegar sem o ATA | No próprio dia do ETA, abre **Data da escala pendente**. | **Alertas** |

::: atencao
- Antecipar o ETA pode abrir de uma vez os alertas de prazo que ainda não valiam e mandar o aviso de chegada aos Clientes.
- O ETA não muda a cobrança: as Taxas Locais usam a data da importação do B/L, e a Demurrage corre pela descarga de cada container.
:::

## 18.3 Registrar a chegada, a atracação e a saída

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Operações}}, na escala e no cartão de cada terminal ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)).

| Você faz | O Vela faz | Onde aparece |
|---|---|---|
| Registra o ATA (chegada) | Passa a vez à escala seguinte na **Próxima escala**, marca a linha como chegada no Line Up e mostra a chegada efetiva na programação. | Viagens; Line Up; **Chegadas e Saídas**; Portal |
| | Fecha **Data da escala pendente** do ETA e, se nenhum terminal tem ETB, abre o que pede o ETB. | **Alertas** |
| | Encerra a janela do NOA e manda o NOR (Aviso de Chegada) a cada Cliente que tem B/L ativo para aquele porto. | E-mail ao Cliente |
| Registra o ATB (atracação) | Mostra o navio atracado (faixa verde) no Painel e na Tela TV e manda o NOB (Aviso de Atracação) aos Clientes daquele terminal. Sem ETD, abre **Data de terminal pendente**. | Painel; Tela TV; e-mail ao Cliente |
| Registra o ATD (saída) | Começa o prazo de 72 horas do ADR de Saída do terminal e abre o alerta de cada equipe que ainda tem seção pendente nele. | **ADR**; **Alertas** (capítulo 11) |
| | Quando todos os terminais da escala têm ATD, a linha sai da Tela TV e a escala é concluída; quando todas as escalas estão concluídas, a Viagem fica **Concluída** e sai de Chegadas e Saídas, do Portal e do site fwlog.com.br. | Tela TV; Viagens; Portal |
| | Se a escala declarou exportação de Granito ou de vazios e ela ainda não foi lançada, abre **Exportação pendente pós-ATD** para {{Operações}}. | **Alertas** |

Confirmar a chegada em **Chegadas e Saídas** grava o ATA da escala, com os mesmos efeitos ([5.4](05-programacao.md#54-confirmar-a-saída-ou-a-chegada)).

::: atencao
A saída confirmada em **Chegadas e Saídas** é a do porto de origem, não a de um terminal brasileiro. Ela não começa o prazo do ADR nem conclui a Viagem: para isso, registre o ATD no cartão do terminal.
:::

## 18.4 Vincular ou trocar o Cliente do B/L

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}, na Revisão (capítulo 8) ou na ficha do B/L (capítulo 7).

O Cliente é quem vê o B/L no Portal e quem recebe a fatura. Mudar o Cliente leva a cobrança junto.

| Você faz | O Vela faz | Onde aparece |
|---|---|---|
| Vincula o Cliente ao B/L | Recalcula as Taxas Locais com a Condição de Cliente dele e, se o B/L já tem CE, tenta emitir a fatura na hora. | **Taxas Locais**; ficha do B/L |
| | Põe o B/L no Portal desse Cliente (se já tem CE) e nos avisos automáticos: se o navio já está na janela, o Cliente recebe o NOA, o NOR ou o NOB na rodada seguinte. | Portal; e-mail ao Cliente |
| | Fecha o alerta de B/L sem Cliente perto do ETA quando não sobra nenhum. | **Alertas** |
| Desvincula o Cliente | Anula o valor a receber que ainda não tinha fatura e tira o B/L do Portal dele. | Saldo do Cliente; Portal |
| Troca o Cliente de um B/L faturado, sem pagamento | Cancela a fatura e a reemite para o novo Cliente, com o câmbio da importação. Faz o mesmo com a fatura avulsa e a Invoice de Demurrage do B/L; a nova Invoice sai sem o desconto, e a Disputa aberta do Cliente anterior é encerrada. A dispensa de cobrança de um container passa ao novo Cliente. | **Taxas Locais**; Portal dos dois Clientes |
| Troca o Cliente de um B/L com pagamento | Não emite para o novo Cliente até o {{Financeiro}} confirmar a devolução ao Cliente original. Se a Invoice de Demurrage ou a fatura avulsa já foi paga, a troca é recusada até essa devolução. | Detalhe da fatura, em **Ajustes pela correção do B/L** |
| O Cliente ativa o Portal, ou o {{Administrativo}} concede a Liberação de faturamento | Emite na hora as faturas que estavam retidas, com o preço da importação, manda à fila as Invoices de Demurrage retidas e tira os B/Ls da Revisão pelo motivo do Portal. | **Taxas Locais**; Portal: "Nova fatura emitida" |

::: atencao
- Se o Portal do novo Cliente não está pronto e não há Liberação, a fatura de Taxas Locais antiga não é cancelada e abre **Fatura desatualizada** para o {{Administrativo}} e o {{Financeiro}}. Já a Invoice de Demurrage é cancelada, e a nova sai sozinha quando o Portal do novo Cliente for ativado ou a Liberação for concedida.
:::

## 18.5 Importar os arquivos

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}} (capítulo 6).

| Você faz | O Vela faz | Onde aparece |
|---|---|---|
| Importa B/Ls | Vincula o Cliente pelo CNPJ, aplica as marcas do Baplie (se ele já foi importado), calcula as Taxas Locais provisórias e põe na Revisão o B/L com pendência. | Ficha do B/L; **Revisão** |
| | Recalcula a saída do porto de origem, pelo menor **Laden on Board**, e o status **BLs e CEs** de cada escala. | **Rotas e Manifestos**; ficha da Viagem |
| Importa o Baplie | Aplica as marcas IMO, OOG e SOC/COC aos containers dos B/Ls e recalcula as Taxas Locais dos que não têm fatura; nos faturados, a fatura segue a correção ([18.6](#186-corrigir-um-bl)). Fecha o alerta **Baplie ausente**. | **Baplie EDI**; **Alertas** |
| Importa veículos | Recalcula as Taxas Locais de cada B/L sem fatura. Se um B/L ficou isento, cancela em até um minuto as faturas dele sem pagamento. | **Taxas Locais** |
| Importa o CE | Veja [18.1](#181-vincular-o-ce-ao-bl). | |

O B/L importado ainda não aparece ao Cliente: ele só chega ao Portal com o CE.

::: atencao
Alguns desses passos rodam segundos depois da gravação ([19.3](19-rotinas-por-horario.md#193-os-passos-depois-da-importação)). Se um deles trava, abre um alerta ([6.10](06-importacao.md#610-quando-algo-fica-parado-depois-da-importação)).
:::

## 18.6 Corrigir um B/L

**Quem faz:** {{Qualquer equipe}}, na ficha do B/L (capítulo 7) ou pela reimportação ([6.3](06-importacao.md#63-reimportar-um-bl-que-o-armador-corrigiu)).

A fatura emitida nunca é editada. Quando a correção muda o valor ou o Cliente de um B/L faturado, o Vela compara o B/L com a fatura no fim da gravação e corrige a cobrança sozinho. O caminho depende de a fatura já ter pagamento ou não.

| Você faz | O Vela faz | Onde aparece |
|---|---|---|
| Corrige peso, containers, veículos, destino ou tipo de carga de um B/L sem fatura | Recalcula as Taxas Locais na hora, com o preço fixado na importação. Se o cálculo falha, nada é gravado. | Ficha do B/L |
| Corrige um B/L faturado, sem pagamento, e o valor muda | Cancela a fatura e a reemite, com número e Pix novos. | **Taxas Locais**; Portal: "Nova fatura emitida" |
| O mesmo, com pagamento e valor menor | Abate o saldo em aberto. O que passar dele vira restituição ao Cliente e abre **Restituição pendente** para o {{Administrativo}} e o {{Financeiro}}. | **Alertas** |
| O mesmo, com pagamento e valor maior | Abre **Fatura desatualizada**. A diferença se cobra por fatura avulsa. | **Alertas** |
| Inclui, altera ou tira carga de um B/L faturado | Devolve o B/L à Revisão como **Pendente**, com o motivo "Carga … após faturamento". | **Revisão** (capítulo 8) |
| Muda o POL, o POD ou a Viagem do B/L | Tira o B/L do Manifesto Mercante. Se ele tem CE, abre **CE fora do Manifesto da rota** para a {{Documentação}}. | **Rotas e Manifestos**; **Alertas** |

::: atencao
- Se a nova fatura não pode sair (por exemplo, o Portal do Cliente está fechado), nada é cancelado: a fatura antiga continua valendo e abre **Fatura desatualizada** com o motivo. Resolvido o motivo, use **Tentar aplicar correção** no detalhe da fatura.
- Mudar as datas do navio não recalcula nada.
:::

## 18.7 Cancelar, reativar ou excluir um B/L

**Quem faz:** {{Administrativo}}. Quando usar cada um está em [6.9](06-importacao.md#69-trocar-o-bl).

| Você faz | O Vela faz | Onde aparece |
|---|---|---|
| Cancela o B/L | Tira o B/L do faturamento: anula o valor a receber sem fatura e apaga o cálculo, inclusive as taxas manuais. | **Taxas Locais** |
| | Mostra o B/L como **Cancelado** no Portal, tira-o do Manifesto Mercante e libera o CE para o B/L reemitido. | Portal; **Rotas e Manifestos** |
| | Deixa de contar o B/L na saída do porto de origem e nos alertas da Revisão. Os containers dele saem do atraso da Demurrage. | Ficha da Viagem; **Demurrage** |
| | Se um container dele também está no B/L de outro Cliente, a Demurrage do container passa a ser cobrada só do outro ([18.8](#188-mudar-as-datas-de-um-container)). | **Demurrage** |
| Reativa o B/L | Recalcula as taxas automáticas, devolve o B/L ao Manifesto (se ele ainda serve à rota) e o atraso dos containers volta a contar. | Ficha do B/L |
| Exclui o B/L | Apaga o B/L com os containers, os cálculos e os alertas dele, e recalcula a saída do porto de origem. | Lista **BLs** |

::: atencao
Reativar não traz de volta a taxa lançada à mão: ela precisa ser lançada de novo.
:::

## 18.8 Mudar as datas de um container

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}} (capítulo 9).

A descarga e a devolução são do container físico, e é por elas que corre a Demurrage. O dono do container (SOC ou COC) e a divisão dele entre Clientes também mudam a cobrança, com a mesma regra das datas.

| Você faz | O Vela faz | Onde aparece |
|---|---|---|
| Grava a descarga ou a devolução | Leva a mesma data a todos os B/Ls ativos da Viagem que dividem o container. | Ficha de cada B/L |
| | Recalcula a situação de Demurrage (**No free time**, **Em atraso** ou **Devolvido**) e a divisão do grupo na página **Demurrage** ([9.5](09-containers-e-demurrage.md#95-acompanhar-a-demurrage-dos-containers)). | **Demurrage**; aba Carga do B/L |
| Grava a última devolução de um grupo (os B/Ls do mesmo Cliente na Viagem que dividem containers) | Se algum container passou do free time, emite sozinho a Invoice de Demurrage do grupo, em cerca de um minuto. Sem CE ou sem Portal pronto (nem Liberação), o grupo fica em **Travado** e a Invoice sai sozinha quando o CE chega, o Portal é ativado ou a Liberação é concedida. O Cliente é avisado e a Régua de Cobrança começa ([19.5](19-rotinas-por-horario.md#195-a-demurrage-pelo-relógio)). | **Demurrage**; Portal: "Nova fatura de demurrage" |
| Muda o free time de um grupo já devolvido (condição do B/L, acordo, tarifa ou cadastro de tipos) ou desfaz uma dispensa | Se o grupo passa a ter Demurrage a cobrar, emite a Invoice sozinho, em até 15 minutos. | **Demurrage**; Portal: "Nova fatura de demurrage" |
| Muda a data de um container já cobrado, sem pagamento, desconto ou Disputa | Cancela a Invoice e a reemite com as datas novas. | **Demurrage** |
| Passa a SOC um container já cobrado, na ficha ou pelo Baplie | Cancela a Invoice e a reemite sem ele. | **Demurrage** |
| Importa, cancela ou exclui o B/L de outro Cliente com o mesmo container na Viagem | Refaz a divisão do container entre os Clientes ([9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai)): a Invoice já emitida é cancelada e reemitida com a parte nova. | **Demurrage** |
| Qualquer uma dessas mudanças numa Invoice com pagamento, desconto ou Disputa aberta | Não reemite: suspende a Régua de Cobrança daquela Invoice e abre **Datas mudaram em Invoice de Demurrage emitida** para o {{Administrativo}}, com a causa. | **Alertas** |

::: atencao
- A Invoice cancelada à mão não volta sozinha: nenhuma data, CE ou troca de Cliente a emite de novo. Use **Gerar Invoice** ([9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai)).
- O container que entra depois num B/L da Viagem nasce sem datas, mesmo que já tenha datas em outro B/L. Grave as datas pelo B/L novo.
- As datas do container não mudam as Taxas Locais nem devolvem o B/L à Revisão.
:::

## 18.9 Emitir ou cancelar uma fatura

**Quem faz:** emitir, {{Qualquer equipe}}, em **Taxas Locais** › **Validação**; cancelar, o {{Administrativo}} (capítulo 22).

A fatura de Taxas Locais normalmente sai sozinha com o CE ([18.1](#181-vincular-o-ce-ao-bl)). Seja automática, seja pelo **Emitir**, os efeitos são os mesmos.

| Você faz | O Vela faz | Onde aparece |
|---|---|---|
| Emite a fatura | Marca o B/L como faturado e o tira da **Validação**. Fecham os alertas de faturamento do B/L. | **Taxas Locais**; **Alertas** |
| | Avisa o Cliente com o número e o valor. Com a cobrança pelo Itaú ligada, o QR do Pix sai segundos depois ([19.6](19-rotinas-por-horario.md#196-o-pix-do-itaú)). | Portal: "Nova fatura emitida" |
| | Se era o último B/L do Cliente na Viagem que faltava, manda o Comunicado de CE e Taxas. | E-mail ao Cliente |
| Cancela a fatura | Deixa de cobrar o saldo e invalida o Pix. No Portal, a fatura só aparece no filtro de canceladas. | **Taxas Locais**; Portal |
| | Devolve o B/L a não faturado: ele reaparece na **Validação**. Depois disso, nada emite aquele B/L sozinho, nem o CE, nem a ativação do Portal, nem a Liberação: a nova fatura sai só pelo **Emitir**. | **Taxas Locais** › **Validação** |
