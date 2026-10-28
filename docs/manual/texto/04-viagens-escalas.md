A Viagem é a passagem de um navio pelos portos brasileiros. Tudo o que o Vela faz depois (B/Ls, CE Mercante, cobrança, Comunicados ao Cliente) se pendura nela e nas suas escalas. Este capítulo mostra como cadastrar a Viagem, planejar as escalas, manter as datas do navio em dia e registrar o que muda no caminho.

::: aprende
- cadastrar uma Viagem e planejar as escalas que ela faz no Brasil;
- atribuir os terminais e registrar chegada, atracação e saída do navio;
- saber o que muda sozinho quando uma data muda, e o que não muda;
- registrar a omissão de uma escala, o transbordo e a mudança de destino (COD);
- concluir, cancelar ou excluir uma Viagem.
:::

## 4.1 Cadastrar uma Viagem nova

<!-- regras: VIA-001 VIA-011 VIA-012 VIA-013 VIA-014 VIA-017 VIA-135 ACE-085 -->

::: ficha
- **Quando usar:** O armador confirmou uma viagem do navio para o Brasil e ela ainda não está no Vela.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** Tenha o nome do navio, o **IMO** (os 7 dígitos que identificam o navio) e o número da viagem que o armador usa. Procure a viagem em **Viagens › Buscar**: ela pode já ter sido criada por Chegadas e Saídas ou pela planilha de programação.
:::

::: passos
1. No menu, clique em **Viagens**.
2. No alto da página, clique em **Nova Viagem**. A janela **Nova Viagem** abre.
:::

![Viagens: o menu e o botão Nova Viagem.](captura/viagens-topo)

::: lado
3. Confira **Armador** e **SCAC**. Eles já vêm com Cosco Shipping Specialized Carriers e CSSC; troque só se a viagem for de outro armador.
4. Em **Navio**, digite o nome do navio.
5. Em **IMO**, digite os 7 dígitos do navio.
6. Em **Numero da viagem**, digite o número que o armador usa (por exemplo, 024E).
7. Se a viagem deve aparecer para os Clientes na programação do Portal, ligue a chave de **Chegadas e Saídas**. Ligada, ela diz **Aparece em Chegadas e Saídas**.
8. Clique em **Cadastrar viagem**. Aparece o aviso "Viagem cadastrada com sucesso." e a Viagem nasce **Ativa**.

![A janela Nova Viagem preenchida com o navio do exemplo.](captura/nova-viagem)
:::

As datas não são digitadas aqui. Chegada, atracação e saída pertencem a cada escala e são planejadas na ficha da Viagem ([4.2](#s4-2)). O bloco **1º Porto Brasileiro** só fica disponível depois que a Viagem tem uma escala ([4.4](#s4-4)).

::: sozinho
- Grava navio, SCAC e número da viagem em maiúsculas.
- Acha o navio pelo IMO. Achado assim, o navio mantém o nome que já tinha no cadastro, mesmo que você tenha digitado de outro jeito, e passa a ter o armador digitado.
- Navio novo entra com o nome padronizado: "ZYHY" vira "ZHONG YUAN HAI YUN", "CS", "C.S." e "C S" viram "COSCO SHIPPING", e "M/V", "MV" e "VSL" saem do nome.
- Acha o armador pelo SCAC. Se o SCAC já existe, vale o nome cadastrado e o nome digitado é ignorado; sem SCAC, o armador é achado pelo nome.
- Com a chave de Chegadas e Saídas ligada, publica a Viagem na programação e no Portal.
- Registra "Viagem criada" na **Linha do tempo** da Viagem, com a origem "botão Nova viagem".
:::

::: conferir
Em **Viagens**, a Viagem aparece na faixa de cartões do alto e no quadro, ordenada pela próxima escala; até você planejar as escalas, o cartão diz "Sem escala brasileira prevista". Clique nela para abrir a ficha, com o selo **Ativa**.
:::

::: aconteceu "Já existe a viagem NAVIO / NÚMERO. Abra a viagem existente em vez de cadastrar outra."
- **O que o sistema faz:** Recusa o cadastro. O Vela compara o navio pelo IMO (que vale mais que a grafia do nome) e o número sem diferença de maiúsculas nem espaços. Se a Viagem existente está cancelada, a mensagem termina com "Reative-a em Viagens em vez de cadastrar outra.".
- **Por quê:** Cada navio e número de viagem existe uma vez só no Vela.
- **O que você faz:** Abra a Viagem existente. Se ela está cancelada e deve voltar, peça ao {{Administrativo}} para usar **Reativar viagem** ([4.10](#s4-10)).
:::

::: aconteceu "Navio … com IMO conflitante (… vs …). Corrija antes de importar."
- **O que o sistema faz:** Recusa quando o nome é de um navio já cadastrado com outro IMO. Dois navios com o mesmo nome e sem IMO pedem o IMO.
- **Por quê:** O IMO identifica o navio; nome parecido não junta navios diferentes.
- **O que você faz:** Confira o IMO com o armador e digite o certo.
:::

::: aconteceu "Armador obrigatorio (min. 2 caracteres)"
- **O que o sistema faz:** Não grava sem armador e navio com pelo menos 2 caracteres e sem o número da viagem ("Navio obrigatorio (min. 2 caracteres)", "Numero da viagem obrigatorio").
- **O que você faz:** Preencha os três campos e clique de novo em **Cadastrar viagem**. Se o aviso for "Falha ao cadastrar viagem. Revise os dados e tente novamente.", confira os campos e tente de novo.
:::

::: atencao
O armador vale para todas as Viagens do mesmo navio: ao corrigir o armador de uma Viagem, você corrige nas outras do mesmo navio também. Navio e armador não têm tela própria nem exclusão; eles nascem e mudam pelas Viagens.
:::

::: porque
O IMO vale mais que a grafia do nome para o mesmo navio, escrito de dois jeitos, continuar sendo um navio só. E a Viagem nasce sem datas porque um navio pode passar por mais de um porto brasileiro, cada um com as suas datas.
:::
