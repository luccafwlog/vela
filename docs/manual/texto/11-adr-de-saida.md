O ADR de Saída (Agency Departure Report) é o relatório de saída do navio em cada terminal: o retrato do que foi descarregado e carregado ali, conferido e assinado por quem responde por cada parte. Você não digita a carga no ADR. Ele junta o que os B/Ls, o Baplie, os Vazios, os Veículos, o Granito e o Embarque de vazios já registraram, e cada equipe confere a sua parte, assina dentro do prazo e, com as três assinaturas, alguém fecha. O ADR fechado é o retrato que o {{Financeiro}} consulta.

::: aprende
- encontrar o ADR de cada terminal e ler o que ele mostra;
- conferir e resolver as seções da sua equipe;
- assinar pela equipe e reabrir a assinatura;
- cumprir o prazo de 72 horas depois da saída do navio;
- fechar, imprimir e reabrir o ADR.
:::

## 11.1 Abrir o ADR de um terminal

**Quem faz:** {{Todas as equipes}}

Cada terminal da escala tem o seu ADR. Ele nasce quando você atribui o terminal a uma frente de operação ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)). Frentes no mesmo terminal dividem o mesmo ADR, e cada terminal fecha o seu sem esperar os outros. Escala só de exportação também tem ADR; porto estrangeiro não tem.

1. Na ficha da Viagem, abra a aba **ADR**.
2. Em **Escala**, clique no porto.
3. Em **Terminal**, escolha o terminal.

No alto, o bloco **ADR** resume o andamento ("2 de 3 departamentos assinados" e quem falta), o **Prazo de conclusão**, a escala e o terminal. Abaixo vêm as seções, agrupadas pela equipe que responde por elas, e no fim a **Linha do tempo do ADR**:

| Equipe | Seções |
|---|---|
| {{Operações}} | **Escala**: armador, navio, porto, terminal, ATA, ATB, ATD e Restow |
| {{Documentação}} | **Carga descarregada** e **Vazios descarregados** |
| {{Equipamentos}} | **Veículos**, **Carga carregada** (o Granito) e **Embarque de vazios** |

No exemplo do manual, a COSCO SHIPPING SEREIA 024E tem o ADR do terminal TVV na escala de Vitória (BRVIX).

::: atencao
- "Nenhum terminal atribuído às frentes desta escala (TBC)" quer dizer que o ADR ainda não existe. Atribua o terminal na escala ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)).
- A escala omitida só aparece na aba se já tinha ADR fechado, com o selo **Omitida**. Na Viagem cancelada, o ADR é só leitura.
:::

## 11.2 Conferir as seções da sua equipe

**Quem faz:** {{Operações}}, {{Documentação}} e {{Equipamentos}}, cada uma as suas seções; o {{Administrativo}} resolve qualquer uma

O ADR mostra só o que aconteceu, sem linha zerada, e cada container conta uma vez pelo número. Os números vêm de onde foram registrados: se algo está errado, corrija na origem e o ADR mostra a correção. Cada seção começa **Pendente**, e a equipe dona a resolve como **Confirmado**, quando o que ela mostra é o que aconteceu, ou **Nada a declarar**.

1. Confira o conteúdo da seção.
2. Na faixa da seção, clique em **Alterar** e escolha **Confirmado** ou **Nada a declarar**.
3. Clique em **Confirmar**.
4. Se quiser deixar um registro, use **Adicionar observação**. O texto vai para o relatório impresso.

O que cada seção traz e onde se corrige:

- **Carga descarregada** conta os containers cheios dos B/Ls do terminal, por tipo e natureza (**Carga geral**, **IMO**, **OOG**), com o destino final separado do transbordo, e a carga solta num quadro próprio. A fonte é o B/L: container cheio que está no Baplie sem B/L não entra e aparece como **Divergência** ([6.8](06-importacao.md#68-resolver-as-divergências-entre-baplie-e-bl)). O B/L com exceção de terminal conta no terminal da exceção ([7.7](07-ficha-do-bl.md#77-mudar-o-terminal-de-descarga-de-um-bl)).
- **Vazios descarregados** compara os vazios do Baplie com os de **Vazios IMP**, onde se marca cama e cover plate (capítulo 10).
- **Veículos**, **Carga carregada** e **Embarque de vazios** mostram o que foi lançado em **Veículos**, **Granito** e no Embarque de vazios (capítulo 10). Granito ou embarque lançado num porto que não é escala da Viagem aparece como **Dado órfão**.

No exemplo, a Carga descarregada do TVV mostra os containers dos B/Ls CSC45810A01K00 e CSC45810A03K00 e, no quadro da carga solta, o CSC45810B01K00. O CSNU240105, que está no Baplie sem B/L, aparece como Divergência.

::: atencao
- Seção sem dado mostra "Nada operado nesta escala." e continua pedindo resolução: o vazio não é conclusão.
- Mudar uma decisão já registrada pede justificativa. Voltar uma seção a **Pendente** desfaz a assinatura da equipe dona ([11.3](#113-assinar-pela-equipe)).
:::

## 11.3 Assinar pela equipe

**Quem faz:** {{Operações}}, {{Documentação}} e {{Equipamentos}}, cada uma a sua parte; o {{Administrativo}} assina por qualquer uma

A assinatura é a palavra da equipe de que todas as suas seções refletem o que aconteceu na escala. É ela que conta para o prazo e para o fechamento. O {{Financeiro}} não assina o ADR.

1. Resolva todas as seções da sua equipe ([11.2](#112-conferir-as-seções-da-sua-equipe)). A faixa da equipe diz quantas estão resolvidas e "aguarda assinatura".
2. Clique em **Assinar Documentação** (ou **Assinar Operações**, **Assinar Equipamentos**).
3. Clique em **Confirmar**.

A faixa passa a dizer "Assinado por … em …". Você pode assinar antes da saída do navio: quando o ATD chega, a assinatura já conta como feita no prazo.

Para corrigir depois de assinar, clique em **Reabrir Documentação** (ou o botão da sua equipe), escreva a **Justificativa** e confirme. Só a assinatura da sua equipe é desfeita; as das outras continuam. O prazo da sua equipe volta a correr, e vale a assinatura nova: se ela vier depois do vencimento, a equipe fica atrasada.

::: atencao
Com alguma seção da equipe em **Pendente**, o botão de assinar fica apagado.
:::

## 11.4 Cumprir o prazo de 72 horas

**Quem acompanha:** {{Todas as equipes}}; o resumo por período, o {{Administrativo}}

Cada equipe tem até 72 horas corridas depois do ATD do terminal para assinar a sua parte. Sábado, domingo e feriado contam: o navio que sai do TVV na sexta às 18h tem o prazo vencendo na segunda às 18h. O prazo aparece no bloco **ADR**, em **Prazo de conclusão**; enquanto não há ATD, "Aguardando a saída do navio".

O prazo conta da saída do navio, não da hora em que alguém registrou a saída. Um ATD lançado dois dias depois deixa só um dia para as equipes, e o ADR pode nascer vencido. Registre o ATD no dia ([4.4](04-viagens-escalas.md#44-manter-as-datas-do-navio-em-dia)).

A **Linha do tempo do ADR**, no pé da aba, conta a história: a saída do navio e quando ela foi registrada, o vencimento, cada assinatura e cada reabertura com a justificativa, e o fechamento. Cada equipe aparece como **No prazo**, **Atrasado** ou **Sem prazo**.

Depois do ATD, a equipe com seção pendente recebe um alerta, e outro quando o prazo vence sem assinatura; os dois fecham com a assinatura da equipe ou com o fechamento do ADR (capítulo 20).

O {{Administrativo}} acompanha o cumprimento em **Admin** › **Prazo do ADR**: os ADRs fechados no período escolhido em **Fechado de** e **Fechado até** e, por equipe, quantos foram assinados no prazo, quantas horas cada assinatura atrasou e quem **Não assinou**, que conta como fora do prazo. A medida é da equipe, nunca da pessoa.

::: atencao
- O ATD que vale é o da Atracação do terminal. A saída confirmada em **Chegadas e Saídas** é a do porto de origem e não começa o prazo ([18.3](18-o-que-muda-sozinho.md#183-registrar-a-chegada-a-atracação-e-a-saída)).
- A escala omitida não tem prazo e fica fora da medição.
:::

## 11.5 Fechar e imprimir o ADR

**Quem faz:** {{Qualquer equipe}}

Fechar congela o retrato. O ADR fechado não muda mais, mesmo que a origem mude depois, e é esse retrato que o {{Financeiro}} consulta e que se imprime.

1. Com as três assinaturas, o bloco **ADR** diz "Pronto para fechar". Clique em **Fechar ADR**.
2. Clique em **Confirmar fechamento**.
3. Para imprimir, clique em **Imprimir** e, na janela **Relatório de Saída do Navio (ADR)**, em **Imprimir** de novo.

O ADR passa a mostrar "Fechado em … por …" e os alertas dele fecham. O impresso traz a identificação, as datas da escala, as seções, as observações, as assinaturas das equipes e, em página nova, as unidades que tiveram armazenagem. Ele não diz se o prazo foi cumprido.

Com o ADR fechado, o Vela trava o que mexe nele: o terminal das frentes, o ATB, o ATD e o Restow da Atracação, a declaração de exportação e o Embarque de vazios daquela escala (capítulo 10). Para mudar qualquer um, reabra o ADR ([11.6](#116-reabrir-um-adr-fechado)).

::: atencao
- Uma frente em TBC em qualquer ponto da escala impede o fechamento. Atribua o terminal antes ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)).
- O Vela deixa fechar antes da saída do navio, mas depois não aceita o ATD daquele terminal sem reabrir. Feche depois de registrar o ATD.
:::

## 11.6 Reabrir um ADR fechado

**Quem faz:** {{Qualquer equipe}}

Reabra quando precisar mudar algo que o ADR fechado trava, como o ATD ou o terminal, ou quando o retrato precisa mostrar uma correção feita na origem.

1. No ADR fechado, clique em **Reabrir**.
2. Escreva a **Justificativa** e clique em **Confirmar reabertura**.
3. Faça a correção e feche de novo ([11.5](#115-fechar-e-imprimir-o-adr)).

Reabrir descarta o retrato, mas não apaga resoluções, observações, assinaturas nem histórico. Como as três assinaturas continuam valendo, **Fechar ADR** já volta liberado. Se a correção mudou o que uma equipe assinou, ela reabre a própria assinatura e assina de novo ([11.3](#113-assinar-pela-equipe)).

::: atencao
Enquanto o ADR está reaberto, não há retrato para imprimir nem para o {{Financeiro}}. Feche de novo assim que terminar.
:::
