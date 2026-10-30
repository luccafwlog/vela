# Capítulo 6 — Importação da documentação: situações

Catálogo do capítulo 6 do sumário final (destino `Op 5` da matriz). Formato e
regras em [README](README.md). Rascunho de 2026-10-28, montado a partir das
regras da matriz; ainda não conferido pelo dono.

## Quem importa

Qualquer setor importa arquivos e reprocessa efeito de importação (ACE-090,
ACE-091, CEB-005). Na rotina, a Documentação importa os B/Ls, o CE Mercante e
o Baplie. Algumas correções que aparecem nas situações são só do
Administrativo: excluir, cancelar e reativar B/L (BLR-015, BLR-102).

## Quero fazer…

| Nº | Objetivo | Regras |
|---|---|---|
| Q6.01 | Importar os B/Ls de container de uma Viagem | BLR-017 a BLR-025, BLR-038, BLR-046, BLR-065 |
| Q6.02 | Importar a carga solta: Manifesto BB ou B/L avulso | BLR-048 a BLR-052, BLR-062 a BLR-064 |
| Q6.03 | Reimportar um B/L que o armador corrigiu | BLR-030 a BLR-037, BLR-055 |
| Q6.04 | Importar a planilha de CE Mercante e emitir as faturas | CEB-003, CEB-007 a CEB-019 |
| Q6.05 | Informar ou corrigir o Nº de Manifesto Mercante de uma rota | VIA-053, VIA-054, CEB-017, CEB-042 |
| Q6.06 | Importar o Baplie e conferir com os B/Ls | CEB-001, CEB-004, CEB-057 a CEB-067, CEB-079, CEB-080 |
| Q6.07 | Resolver as divergências entre Baplie e B/L | CEB-081 a CEB-087, CEB-097 |
| Q6.08 | Cadastrar os vazios de importação vindos do Baplie | CEB-092, CEB-093, EQU-073 |
| Q6.09 | Conferir o que a importação gravou | BLR-046, BLR-069, BLR-070, CEB-067 |
| Q6.10 | Destravar uma importação que ficou bloqueada depois de gravar | ALE-022, ALE-068 |

## Aconteceu…

### Na prévia, antes de gravar

#### S6.01 — A prévia diz que o arquivo é de outra viagem

- **O que o sistema faz:** marca o B/L com erro ("Arquivo é da viagem …, mas
  você apontou …") e não deixa importar nada. No Baplie, o navio diferente
  bloqueia; o número de viagem do armador não é conferido.
- **Por quê:** a Viagem de destino é escolhida antes do arquivo justamente para
  o sistema comparar navio e viagem.
- **O que você faz:** confira a Viagem de destino. Se escolheu errado, troque
  a Viagem (a prévia é refeita). Se o arquivo é que está errado, peça o arquivo
  certo ao armador.
- **Regras:** BLR-019, CEB-058, CEB-062.

#### S6.02 — Um B/L tem erro e nada é importado

- **O que o sistema faz:** desliga **Importar** e diz "Com erro no arquivo,
  nada é importado. Corrija e escolha o arquivo de novo.". Com vários arquivos,
  um ilegível bloqueia todos.
- **Por quê:** importação com erro é recusada inteira, para a Viagem nunca
  ficar com metade do arquivo gravada.
- **O que você faz:** abra o painel de problemas (dá para baixar em CSV),
  corrija o arquivo ou tire dele o B/L com erro e escolha o arquivo de novo.
- **Regras:** BLR-025, BLR-052, BLR-063, BLR-066, CEB-009, CEB-059.

#### S6.03 — O B/L já está em outra Viagem (importei na Viagem errada)

- **O que o sistema faz:** no arquivo de B/L de container, a linha vira erro:
  "O B/L … já está na Viagem …: exclua o B/L lá (se tiver CE Mercante, tire o CE
  antes) e importe de novo (cancelar não libera o número)". Na carga solta, o
  arquivo inteiro é recusado, com a mesma orientação. Se o B/L está cancelado na
  outra Viagem, a mensagem manda reativá-lo lá, tirar o CE Mercante, excluí-lo e
  importar de novo.
- **Por quê:** a importação nunca muda a Viagem de um B/L, e o número do B/L
  existe uma vez só no sistema, mesmo cancelado.
- **O que você faz:** peça ao Administrativo para excluir o B/L na Viagem
  errada (lista BLs, caixa de seleção, **Excluir**) e importe de novo na
  Viagem certa. A exclusão só é possível se o B/L não tem CE Mercante nem
  documento financeiro; veja S6.18. Com CE Mercante, tire o CE antes (B/L
  cancelado: reative-o primeiro, porque o cancelado é somente leitura).
- **Regras:** BLR-015, BLR-026, BLR-053.
- **P2 (decidida em 2026-10-30):** a orientação "exclua o B/L lá" parava na
  trava do CE, e o B/L cancelado quase sempre tem CE. O dono decidiu que a
  mensagem diz o caminho inteiro (migration `551`, revisão da release
  luccafwlog/vela#1117).
- **P1 (decidida e corrigida em 2026-10-28):** a mensagem da carga solta
  mandava "corrija a Viagem do B/L pela ficha", mas a ficha do B/L não tem
  como mudar a Viagem. O dono decidiu que ela diria o mesmo que a do B/L de
  container; a correção entrou pela PR luccafwlog/vela#1083 (migration `500`).
  O manual ensina excluir e importar de novo.

#### S6.04 — O B/L do arquivo está cancelado

- **O que o sistema faz:** deixa esse B/L de fora com aviso e importa o resto;
  o resultado lista "B/Ls cancelados que ficaram como estavam". Arquivo só com
  B/Ls cancelados não grava nada.
- **Por quê:** B/L cancelado é somente leitura, e a importação nunca reativa.
- **O que você faz:** se o B/L deve voltar, peça ao Administrativo **Mais
  ações › Reativar B/L** na ficha e importe de novo. Se o armador reemitiu com
  outro número, importe o B/L novo (S6.17).
- **Regras:** BLR-027, BLR-054, BLR-063, CEB-014.

#### S6.05 — Peso ou tara com número ambíguo ("3,800", "28.000")

- **O que o sistema faz:** no arquivo de B/L de container, o B/L vira erro com
  as duas leituras possíveis. No Manifesto BB, "Detectar pelo arquivo" recusa o
  valor que o arquivo não desempata. Número presente e ilegível fica vazio com
  aviso.
- **Por quê:** o mesmo texto pode ser 3,8 kg ou 3.800 kg; o sistema não
  adivinha peso, que muda a cobrança.
- **O que você faz:** no B/L de container, corrija o número no arquivo. No
  Manifesto BB, escolha o **Formato numérico do arquivo** (vírgula ou ponto
  decimal) e a prévia é refeita.
- **Regras:** BLR-022, BLR-023, BLR-050, BLR-051, BLR-064.

#### S6.06 — O porto de descarga (POD) não é reconhecido

- **O que o sistema faz:** marca a linha com erro ("POD … não está no cadastro
  de portos" ou "POD ausente no arquivo").
- **Por quê:** o POD define a tabela de cobrança, o Manifesto e a escala.
- **O que você faz:** corrija o arquivo ou cadastre o porto (capítulo 5,
  cadastros de apoio) e escolha o arquivo de novo.
- **Regras:** BLR-029.

#### S6.07 — O sistema não achou o Cliente do B/L

- **O que o sistema faz:** só vincula sozinho pelo CNPJ de um único Cliente
  ativo. Achado só pelo nome, ou sem CNPJ, ou com dois CNPJs, o B/L entra sem
  Cliente, fica **Pendente** e vai para a Revisão. A prévia mostra "CNPJ não
  identificado" em âmbar.
- **Por quê:** vincular o Cliente errado põe o B/L no Portal e na fatura de
  outra empresa.
- **O que você faz:** importe normalmente e resolva na Revisão (capítulo 8):
  vincule o Cliente cadastrado ou cadastre um novo.
- **Regras:** BLR-024, BLR-041, BLR-042, BLR-047, BLR-059.

#### S6.08 — O container já está no B/L de outro Cliente

- **O que o sistema faz:** em container FCL, erro na prévia ("container FCL
  não é dividido entre Clientes diferentes") e recusa na gravação.
- **Por quê:** container cheio (FCL) é de um Cliente só; só LCL e container com
  veículos podem ser divididos.
- **O que você faz:** confirme com o armador qual B/L está certo e corrija o
  arquivo ou o outro B/L.
- **Regras:** BLR-034.

#### S6.09 — A prévia avisa "Arquivo já importado"

- **O que o sistema faz:** mostra quem importou e quando, sem bloquear.
- **Por quê:** importar de novo o mesmo arquivo é permitido (por exemplo, para
  refazer uma etapa), mas costuma ser engano.
- **O que você faz:** confira se é mesmo para gravar de novo; se não, feche a
  janela.
- **Regras:** BLR-068, EQU-071.

#### S6.10 — O arquivo de B/L tem aba de veículos (VIN)

- **O que o sistema faz:** ignora a aba e avisa; os veículos já gravados
  ficam.
- **Por quê:** veículos entram só pela planilha de Veículos.
- **O que você faz:** importe a planilha de Veículos (capítulo 10).
- **Regras:** BLR-028, EQU-049.

### Reimportar um B/L

#### S6.11 — Reimportei e um container sumiu do arquivo

- **O que o sistema faz:** a prévia avisa "Saem do B/L: …" e, ao gravar, o
  container sai com registro no Histórico. Os containers que continuam mantêm
  descarga, devolução, local de desova e correções manuais.
- **Por quê:** o arquivo novo do armador é a fonte da lista de containers.
- **O que você faz:** confira o aviso **Saem do B/L** antes de importar. Se o
  container não devia sair, peça o arquivo correto.
- **Regras:** BLR-031, BLR-032, BLR-033.

#### S6.12 — O container não sai do B/L na reimportação

- **O que o sistema faz:** a linha do B/L vira erro quando o container que
  sairia tem veículo gravado.
- **Por quê:** o veículo precisa estar num container do B/L.
- **O que você faz:** mova ou exclua os veículos (planilha de Veículos ou
  ficha) e importe de novo.
- **Regras:** BLR-033, EQU-056.
- **Fora do texto (P3, decidida em 2026-10-28):** o sistema também segura o
  container que tem Invoice de Demurrage, mas o dono confirmou que o armador
  tirar do B/L um container já cobrado de Demurrage não ocorre na operação.

#### S6.13 — Reimportei um B/L já faturado e mudou o que é cobrado

- **O que o sistema faz:** quando muda quantidade de containers, IMO/OOG,
  SOC/COC, peso da carga solta, CNPJ, POL ou POD, a prévia abre o bloco
  **Faturamento** com "Confirmar o faturamento do B/L …", nunca marcado. Sem
  marcar, o resto do arquivo entra e o que afeta a cobrança fica como estava.
  Marcado, a fatura sem pagamento é cancelada e reemitida; com pagamento, fica
  desatualizada e segue para restituição ou cobrança avulsa.
- **Por quê:** fatura emitida não muda de valor sem alguém decidir.
- **O que você faz:** confira o valor antes → depois e marque a confirmação
  quando a mudança é real. Na carga solta, a confirmação é "Confirmo a mudança
  nos B/Ls faturados".
- **Regras:** BLR-035, BLR-036, BLR-056, BLR-057, FAT-133, FAT-134.

#### S6.14 — A prévia oferece "Passar o B/L ao preço de hoje"

- **O que o sistema faz:** para B/L sem fatura cujo preço de hoje (tabela,
  condição do Cliente ou câmbio) difere do fixado na primeira importação,
  abre o bloco **Preço**, um aceite por B/L. Sem marcar, o preço antigo fica.
- **Por quê:** o preço é fixado na data da importação; só muda se alguém
  aceitar.
- **O que você faz:** marque quando a cobrança deve seguir o preço atual.
- **Regras:** BLR-037, TAX-053.

#### S6.15 — O arquivo traz outro consignatário (trocar o Cliente do B/L)

- **O que o sistema faz:** abre o bloco **Troca de consignatário** (de → para,
  CNPJ, o que acontece com recebimentos) com um aceite só. Sem aceite, o
  Cliente fica e o resto entra. Com aceite, o B/L passa ao novo Cliente: Taxas
  Locais sem pagamento são reemitidas para ele; com pagamento, o recebido é
  devolvido ao Cliente original antes da nova cobrança. Impedem a troca, com o
  motivo no cartão, a Invoice de Demurrage paga sem restituição e o
  consignatário não cadastrado em B/L faturado.
- **Por quê:** trocar o Cliente muda quem vê o B/L no Portal e quem paga.
- **O que você faz:** confira o cartão e aceite. Se houver impedimento, resolva
  antes (restituição pelo Financeiro ou cadastro do Cliente) e reimporte. A
  troca também pode ser feita na ficha do B/L, **Trocar Cliente** (capítulo 7).
- **Regras:** BLR-039, BLR-040, BLR-043, BLR-058, BLR-085, BLR-086.

#### S6.16 — Outras situações da reimportação

- B/L em COD: o POD não muda pelo arquivo ("B/L em COD: o POD continua …").
  BLR-045, VIA-069.
- Taxa alterada à mão: a seção **Taxas alteradas à mão** mostra o efeito e pede
  **Gravar mesmo assim** quando a alteração se perde. CEB-099.
- Container novo no B/L reimportado nasce sem datas de descarga e devolução,
  mesmo que o mesmo container tenha datas em outro B/L. EQU-127.
- Laden on Board vazio não apaga a data gravada; ATD corrigido à mão na Viagem
  não muda. BLR-031, BLR-044.

### Trocar o B/L

#### S6.17 — O armador reemitiu o B/L com outro número

- **O que o sistema faz:** o B/L novo é um B/L novo; o antigo não vira o novo.
- **Por quê:** o número identifica o B/L no Vela, no Portal e no Mercante.
- **O que você faz:** tire o B/L antigo primeiro, para os containers e o CE
  não ficarem em dois B/Ls ao mesmo tempo.
  1. B/L antigo **sem CE Mercante**: o Administrativo exclui o antigo pela
     lista BLs.
  2. B/L antigo **com CE Mercante**: antes, resolva o que impede o
     cancelamento (fatura em aberto: o Administrativo cancela; pagamento: o
     Financeiro ou o Administrativo registra a Restituição). Depois o
     Administrativo usa **Mais ações › Cancelar B/L** ("Use quando a carga não
     embarcou ou o armador reemitiu o documento com outro número."). O
     cancelamento libera o CE.
  3. Importe o arquivo do B/L novo.
  4. Importe a planilha de CE Mercante com o CE no B/L novo.
- **Regras:** BLR-015, BLR-034, BLR-102, BLR-103, BLR-104, BLR-105, CEB-023.

#### S6.18 — Preciso tirar um B/L da Viagem e ele não pode ser excluído

- **O que o sistema faz:** a exclusão é recusada com o motivo: "B/L com CE
  Mercante" (cancele em vez de excluir) ou "documento financeiro emitido"
  (qualquer fatura de Taxas Locais dele, mesmo cancelada, ou Invoice de
  Demurrage).
- **Por quê:** B/L com documento oficial ou financeiro não some do sistema;
  ele é cancelado e fica no histórico.
- **O que você faz:** cancele o B/L (S6.17, passo 2). Se o B/L foi importado
  na Viagem errada e já teve fatura, ele não chega mais à Viagem certa:
  confira a Viagem antes de importar o CE e, se acontecer, leve o caso ao
  suporte técnico.
- **Regras:** BLR-015, BLR-102 a BLR-106.
- **P2 (decidida em 2026-10-28: caso raro, vai ao suporte técnico):** um B/L importado na Viagem errada que já teve fatura
  (mesmo cancelada) não pode ser excluído, e cancelar não libera o número
  (BLR-026). Executado no banco local em 2026-10-28 (dados montados à mão numa
  transação desfeita no fim): B/L com uma fatura cancelada recebe o motivo
  "documento financeiro emitido" em `bl_delete_lock_reasons`, e o mesmo número
  numa segunda Viagem é recusado pela chave do B/L. Nenhuma ação ativa muda a
  Viagem de um B/L. Logo, esse B/L não chega mais à Viagem certa. A chance é
  pequena: a prévia já recusa arquivo de outro navio ou viagem (S6.01), e a
  fatura só sai depois do CE.

### CE Mercante e Manifesto

#### S6.19 — A planilha de CE tem B/L que não existe no Vela

- **O que o sistema faz:** bloqueia a planilha inteira.
- **Por quê:** o CE nunca cria B/L.
- **O que você faz:** importe primeiro o arquivo do B/L e depois a planilha
  de CE.
- **Regras:** CEB-010, CEB-012.

#### S6.20 — O CE aparece com menos de 15 dígitos

- **O que o sistema faz:** erro da linha; a mensagem orienta a formatar a
  coluna como texto.
- **Por quê:** o Excel tira os zeros à esquerda de número, e o CE tem 15
  dígitos.
- **O que você faz:** formate a coluna CE como texto no Excel, digite de novo
  e importe.
- **Regras:** CEB-009.

#### S6.21 — A planilha tem B/Ls de rotas diferentes

- **O que o sistema faz:** recusa o lote ("Nada foi gravado: …").
- **Por quê:** cada importação é um Manifesto Mercante, e o Manifesto é de uma
  Viagem e de uma rota POL → POD.
- **O que você faz:** separe a planilha por rota, uma importação por
  Manifesto.
- **Regras:** CEB-007, CEB-012, CEB-042.

#### S6.22 — O Nº de Manifesto já pertence a outra rota ou Viagem

- **O que o sistema faz:** recusa o lote.
- **Por quê:** o número do Manifesto é único no sistema e pertence a uma rota.
- **O que você faz:** confira o número no Mercante. Repetir o número da mesma
  rota só junta B/Ls a ele.
- **Regras:** CEB-012, CEB-017, CEB-042.

#### S6.23 — O CE do B/L está errado

- **O que o sistema faz:** a planilha com outro CE para o mesmo B/L mostra
  **Troca o CE** e pede "Confirmo trocar o CE…" e **Motivo**; a fatura emitida
  não muda. Pela ficha, **Corrigir CE** troca o número. **Remover CE** é
  recusado se o B/L tem fatura emitida ("Corrija o número"). Trocar o CE de
  B/L com Desbloqueio conferido abre um alerta crítico para a Documentação.
- **Por quê:** o CE é documento oficial e a troca fica registrada com motivo.
- **O que você faz:** use a planilha (vários B/Ls) ou **Corrigir CE** na ficha
  (um B/L), com o motivo. Se houver o alerta de Desbloqueio, confira o
  Desbloqueio de novo (capítulo 12).
- **Regras:** BLR-094, BLR-107, CEB-011, CEB-013, DCE-076.

#### S6.24 — Importei o CE e a fatura não saiu

- **O que o sistema faz:** o resultado da emissão separa **faturados**,
  **retidos** (Portal do Cliente não ativo), **aguardando** (Cliente sem
  conciliação, B/L em Revisão ou tabela de cobrança faltando), **nada a
  faturar**, **bloqueados** e **pulados** (fatura cancelada por uma pessoa:
  sai só por **Emitir** na ficha).
- **Por quê:** a fatura só sai quando B/L, Cliente e tabela estão prontos.
- **O que você faz:** leia o motivo de cada B/L no resultado e resolva a causa:
  Revisão (capítulo 8), Portal do Cliente (capítulo 14), tabela de cobrança
  (capítulo 21). Resolvida a causa, a emissão segue sozinha ou por **Retomar
  emissão**.
- **Regras:** CEB-018, CEB-019, CEB-020, FAT-048, FAT-054.

#### S6.25 — A janela fechou ou a emissão parou no meio

- **O que o sistema faz:** o CE já está gravado. **A emissão parou** oferece
  **Retomar emissão**. Se a janela fechou, o sistema emite depois sozinho
  (rotina a cada minuto).
- **Por quê:** o CE e a fatura são gravados em etapas, com uma rede de
  segurança para a segunda.
- **O que você faz:** use **Retomar emissão** ou importe a mesma planilha de
  novo; não há fatura em dobro.
- **Regras:** CEB-018, CEB-021, FAT-054.

#### S6.26 — "Taxas Locais do B/L … não calculadas" e nada foi gravado

- **O que o sistema faz:** recusa o arquivo inteiro (B/L ou CE) dizendo o B/L
  e o que falta, quase sempre o câmbio do dia.
- **Por quê:** o B/L não é gravado sem a cobrança calculada.
- **O que você faz:** espere o câmbio do dia ou peça **Informar PTAX** ao
  Financeiro, ao Administrativo ou a Equipamentos e importe de novo.
- **Regras:** ACE-108, BLR-038, CEB-016, FAT-056, FAT-106.

### Baplie

#### S6.27 — Container no Baplie sem B/L

- **O que o sistema faz:** mostra a divergência **No Baplie, sem B/L**; o
  container não conta como carga nem gera cobrança. Em navio compartilhado,
  container de outro armador também aparece assim.
- **O que você faz:** peça ao armador o B/L ou a correção do manifesto. A
  divergência some quando o B/L é importado.
- **Regras:** CEB-069, CEB-081.

#### S6.28 — O B/L declara container que o Baplie não mostra

- **O que o sistema faz:** **Em B/L, fora do Baplie**; a cobrança continua
  pelo B/L. Se o Baplie traz o container vazio, a divergência é **Cheio no
  B/L, vazio no Baplie**.
- **O que você faz:** confirme o embarque com o armador; se embarcou, peça o
  Baplie corrigido e reimporte.
- **Regras:** CEB-082.

#### S6.29 — SOC/COC ou IMO/OOG diferentes entre B/L e Baplie

- **O que o sistema faz:** **SOC/COC diverge** (vale o B/L) ou **IMO/OOG
  manual diverge** (vale a correção manual). Nada é trocado sozinho.
- **O que você faz:** confirme com o armador. Se o B/L estiver certo, **Vale o
  B/L** com motivo; se estiver errado, corrija na aba Carga da ficha.
- **Regras:** CEB-072, CEB-073, CEB-083, CEB-084, CEB-085.

#### S6.30 — O Baplie traz porto brasileiro que não é escala da Viagem

- **O que o sistema faz:** mostra o porto desmarcado ("sem escala na viagem").
  Marcado, os containers entram, mas ficam pendentes de conciliação até a
  escala existir. Porto estrangeiro fora das escalas fica de fora com aviso.
- **O que você faz:** confira se o navio vai mesmo a esse porto; se vai, crie
  a escala na Viagem (capítulo 4).
- **Regras:** CEB-063, CEB-064, VIA-052.

#### S6.31 — Reimportei o Baplie e apareceu "Substituir o Baplie da viagem"

- **O que o sistema faz:** lista o que foi incluído, removido e alterado e as
  marcas IMO/OOG que caem. **Substituir** grava; **Voltar** não grava. Só os
  portos marcados são substituídos.
- **O que você faz:** confira a lista, principalmente as marcas que caem
  (podem mudar Taxas Locais), e substitua.
- **Regras:** CEB-065, CEB-066, CEB-071, CEB-074, CEB-099.

### Depois de gravar

#### S6.32 — "Outra importação da mesma Viagem estava em andamento"

- **O que o sistema faz:** não grava nada.
- **Por quê:** só uma importação por Viagem grava de cada vez.
- **O que você faz:** espere e importe de novo.
- **Regras:** BLR-070, CEB-015.

#### S6.33 — O B/L ficou Pendente na Revisão depois de importar

- **O que o sistema faz:** a importação passa cada B/L pela régua da Revisão;
  o que tem pendência fica **Pendente**, com a lista no fim das notas.
- **O que você faz:** resolva na Revisão (capítulo 8).
- **Regras:** BLR-047, BLR-060.

#### S6.34 — Alerta "Efeito de importação bloqueado"

- **O que o sistema faz:** o que a importação deixou para depois (marcas do
  Baplie, cálculo, faturamento) falhou e parou.
- **O que você faz:** leia o **Motivo do bloqueio**, corrija a causa e use
  **Reprocessar** com a justificativa. O alerta fecha quando o efeito conclui.
- **Regras:** ALE-022, ALE-068.

#### S6.35 — O Cliente não vê o B/L no Portal

- **O que o sistema faz:** B/L sem CE Mercante não aparece no Portal.
- **O que você faz:** importe a planilha de CE Mercante.
- **Regras:** POR-066.

## Outras importações

Têm catálogo no capítulo de cada uma (lote da Etapa 3): programação de navios
(capítulo 5; VIA-111 a VIA-113), Veículos, Vazios, Embarque de vazios e
Granito (capítulo 10; EQU-049 a EQU-053, EQU-064 a EQU-073, EQU-083, EQU-084,
EQU-111 a EQU-114), datas de descarga e devolução (capítulo 9; EQU-028 a
EQU-033), Base de Clientes (capítulo 13; CLI-014 a CLI-020) e arquivo da ZPT
(capítulo 12; DCE-073, DCE-074).

## Perguntas abertas

| Nº | Situação | Pergunta |
|---|---|---|
Todas decididas em 2026-10-28: P1 (S6.03; a mensagem da carga solta passa a
dizer o mesmo que a do container, corrigida pela migration `500`), P2 (S6.18; caso raro:
o manual orienta conferir a Viagem antes do CE e, se acontecer, levar ao
suporte técnico; o sistema não muda) e P3 (S6.12; container com Demurrage que
sai do B/L não ocorre na operação).
