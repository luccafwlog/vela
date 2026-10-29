Quando o Vela recusa uma ação, a mensagem quase sempre diz o motivo com as palavras da regra, e basta lê-la ([1.4](01-o-vela.md#14-como-o-vela-fala)). Este apêndice junta as que não se explicam sozinhas, agrupadas por assunto, com o texto como aparece na tela; "…" marca a parte que muda a cada caso, como o número do B/L. Quando a mensagem já é explicada num capítulo, o quadro só remete à seção.

## Entrar no Vela

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "Credenciais inválidas ou usuário sem permissão ativa." | O e-mail ou a senha não conferem. | Confira o e-mail. Se esqueceu a senha, peça uma nova ao {{Administrativo}} ([25.4](25-administracao.md#254-redefinir-a-senha-ou-corrigir-o-e-mail)). |
| "Seu acesso ao Vela está desativado ou ainda não foi liberado. Procure o Administrativo." ou **Acesso ainda não liberado** | O seu usuário existe, mas não está ativo no Vela. | Peça ao {{Administrativo}} ([1.6](01-o-vela.md#16-quando-algo-dá-errado) e [25.5](25-administracao.md#255-desativar-ou-reativar-um-usuário)). |
| "Serviço de autenticação indisponível no momento. Verifique a conexão e tente novamente." | O pedido de entrada não chegou ao Vela. | Confira a internet e tente de novo. Se continuar, avise o suporte técnico. |
| "Não foi possível validar a segurança. Atualize a verificação e tente novamente." | A verificação de segurança da tela de entrada venceu ou foi recusada. | Refaça a verificação: cada tentativa de entrar pede uma nova. |
| "Sua sessao expirou. Entre novamente para continuar." | A sua sessão não vale mais: ela venceu, ou a sua senha, o seu e-mail ou o seu acesso mudaram. No Portal, o Cliente vê a mesma frase. | Entre de novo e refaça o que não foi gravado ([1.1](01-o-vela.md#11-entrar-e-sair); no Portal, [17.2](17-suporte-ao-cliente.md#172-o-cliente-não-consegue-entrar)). |

## Telas e conexão

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| **Acesso restrito** | A tela não é da sua equipe. | [1.6](01-o-vela.md#16-quando-algo-dá-errado) |
| **Página não encontrada** | O link está errado ou é antigo. | [1.6](01-o-vela.md#16-quando-algo-dá-errado) |
| **Sem conexão no momento.** | A internet caiu; a lista não está vazia. | [1.6](01-o-vela.md#16-quando-algo-dá-errado) |
| "Você está offline. Exibindo dados salvos — a leitura retoma ao reconectar." | Sem internet, a tela mostra a última leitura que tinha guardada. | Não confie nos números até a conexão voltar: a tela relê sozinha. |
| **Não foi possível exibir esta tela** | Um erro nessa tela; o resto do Vela funciona. | [1.6](01-o-vela.md#16-quando-algo-dá-errado) |
| **Erro inesperado** | O Vela não conseguiu abrir. | Clique em **Recarregar página**. Se continuar, leve ao suporte técnico a versão do Vela ([1.6](01-o-vela.md#16-quando-algo-dá-errado)). |

## Ação de outra equipe

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "Somente o Administrativo …", como "Somente o Administrativo cancela viagem." | A ação é reservada a outra equipe. | Peça a quem pode ([2.3](02-equipes-e-permissoes.md#23-a-quem-passar-cada-pedido)). |
| "Somente Operações e o Administrativo removem atracação." | Tirar um terminal de todas as frentes da escala remove a Atracação dele. | Peça a {{Operações}} ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)). |
| "Sem permissao para esta acao. Solicite acesso administrativo." | O Vela recusou pela equipe, sem uma frase própria para o caso. Não quer dizer que você precisa ser do {{Administrativo}}. | Veja em [2.2](02-equipes-e-permissoes.md#22-o-que-é-reservado-a-algumas-equipes) quem faz a ação e passe o pedido. |
| "Apenas administradores podem alterar role ou active de um perfil." | Só o {{Administrativo}} muda a equipe ou a situação de um usuário. | Peça ao {{Administrativo}} ([25.3](25-administracao.md#253-trocar-a-equipe-de-um-usuário)). |
| "Inspecao do Portal requer usuario interno ativo." | O Modo Inspeção recusou a sua sessão. | Entre de novo no Vela e abra a inspeção outra vez ([15.1](15-portal-o-que-o-cliente-ve.md#151-ver-o-portal-como-o-cliente-vê)). |

## Duas pessoas ao mesmo tempo

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "A escala foi atualizada por outra pessoa. Seus dados foram preservados; recarregue a escala antes de salvar novamente." | Outra pessoa salvou a mesma escala enquanto você editava; nada seu foi gravado. | Recarregue, confira o que mudou e refaça ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)). |
| "Este B/L foi alterado por outro usuário. Os dados foram recarregados; revise e salve novamente." | Outra pessoa salvou o B/L depois que você abriu a ficha. | Revise os campos e salve de novo ([7.2](07-ficha-do-bl.md#72-corrigir-os-dados-do-bl)). |
| "Outro usuário alterou este B/L. A fila foi recarregada; confira os dados e salve de novo." ou "Outro usuário alterou este grupo. A fila foi recarregada; confira e tente de novo." | Na Revisão, outra pessoa mexeu no mesmo B/L ou grupo antes de você; nada foi gravado. | Confira a fila: o caso pode já estar resolvido ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)). |
| "Solicitação alterada; atualize a página.", "Documento alterado; atualize a página", "Entrega alterada; atualize a página" ou "Condição VIP alterada" | No Desbloqueio de CE, outra pessoa mexeu no mesmo pedido. | Atualize a página e confira antes de repetir (capítulo 12). |
| "Preview obsoleto para … no B/L …: recarregue e reconfira." | Na planilha de datas, alguém mudou as datas do container depois da prévia; nada do arquivo foi gravado. | Escolha o arquivo de novo e confira a prévia ([9.3](09-containers-e-demurrage.md#93-importar-as-datas-por-planilha)). |
| "Conflito de concorrencia. Tente novamente." ou "Outra gravação estava usando os mesmos registros. Tente novamente." | Duas gravações nos mesmos registros ao mesmo tempo; a sua não entrou. | Tente de novo. |
| "Outra importação da mesma Viagem estava em andamento. Nada foi gravado: tente de novo." | Só uma importação grava em cada Viagem por vez. | [6.1](06-importacao.md#61-como-toda-importação-funciona) |

## Importação

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "Aguarde: a gravação ainda está em andamento." | A janela não fecha enquanto grava. | Espere o resultado na própria janela. |
| "Taxas Locais do B/L … não calculadas: …. Nada foi gravado: corrija e grave de novo." | O cálculo travou e levou a gravação inteira junto; quase sempre falta o câmbio do dia. | [6.10](06-importacao.md#610-quando-algo-fica-parado-depois-da-importação) |
| "Muitas tentativas. Aguarde alguns minutos e tente novamente." | A mesma ação foi repetida muitas vezes em pouco tempo, e o Vela segura as próximas por alguns minutos. | Espere e tente de novo. |
| "Nada foi gravado: o arquivo foi recusado" ou "Nada foi gravado: a base foi recusada" | A planilha grava tudo ou nada, e uma linha recusada recusou todas. | A janela lista cada linha e o motivo ([9.3](09-containers-e-demurrage.md#93-importar-as-datas-por-planilha) e [13.4](13-cadastro-do-cliente.md#134-importar-a-base-de-clientes)). |

## Somente leitura

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "B/L … cancelado: somente leitura. Reative para corrigir." ou "B/L … cancelado é somente leitura: reative o B/L pela ficha para alterar containers ou veículos." | O B/L foi cancelado, e nada nele muda. | Se o cancelamento foi engano, o {{Administrativo}} reativa ([7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl)). Para as datas de um container dividido, use o B/L ativo ([9.2](09-containers-e-demurrage.md#92-gravar-a-descarga-e-a-devolução)). |
| "Viagem … cancelada: operação selada e somente leitura." | A Viagem foi cancelada, e nada dela muda. | Se foi engano, o {{Administrativo}} reativa ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)). |
| "ADR fechado: reabra antes de alterar terminal." e as outras que começam com "ADR fechado: reabra" | O ADR de Saída do terminal está fechado e trava o que mexe nele. | Reabra o ADR, corrija e feche de novo ([11.6](11-adr-de-saida.md#116-reabrir-um-adr-fechado)). |
| "Atracação travada: …" ou "Escala … travada: …" | O terminal ou a escala já tem B/L com CE Mercante, documento financeiro emitido ou ADR de Saída fechado. | Com o ADR fechado, reabra-o ([11.6](11-adr-de-saida.md#116-reabrir-um-adr-fechado)). Com CE ou fatura, a Atracação fica; se um B/L descarregou em outro terminal, use a exceção do B/L ([7.7](07-ficha-do-bl.md#77-mudar-o-terminal-de-descarga-de-um-bl)). |

## B/L e containers

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "… Já foram gravados: …" (na janela **Corrigir** do container) | Parte da correção foi gravada antes do erro. | Corrija o que a mensagem aponta e clique em **Salvar correção** de novo: sai só o que faltou ([7.3](07-ficha-do-bl.md#73-corrigir-um-container)). |
| "O manifesto declara outro cliente" | O documento cita outro CNPJ. | [7.4](07-ficha-do-bl.md#74-vincular-ou-trocar-o-cliente-do-bl) |
| "O B/L … não pode ser cancelado agora: …" | Há fatura, pagamento ou Invoice de Demurrage em aberto no B/L. | [7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl) |
| "B/L … ja foi faturado (status financeiro=…): o recálculo manual não altera a fatura. Corrija os dados do B/L, que a fatura é corrigida automaticamente." | Depois da fatura, as taxas não se recalculam à mão. | Corrija o dado do B/L: a fatura é corrigida sozinha ([18.6](18-o-que-muda-sozinho.md#186-corrigir-um-bl)). |

## Excluir, cancelar e desativar

Quando o Vela não deixa excluir, ele diz o motivo de cada registro. Os motivos mais comuns:

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "B/L com CE Mercante" | O B/L tem CE: não se exclui. | O {{Administrativo}} cancela o B/L ([7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl)). |
| "documento financeiro emitido" | Há fatura de Taxas Locais (mesmo cancelada), Invoice de Demurrage ou valor recebido. | Não se exclui: cancele ([7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl)). |
| "ADR de Saída fechado", "Granito com CE Mercante ou faturado" ou "comunicado enviado ao cliente" | A Viagem já tem algo oficial ligado a ela. | Cancele a Viagem em vez de excluir ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)). |
| "viagem cancelada fica retida" | A Viagem cancelada não se exclui. | Ela fica no Vela como cancelada. |
| "cliente com CNPJ: desative em vez de excluir" | Cliente nunca se exclui. | [13.10](13-cadastro-do-cliente.md#1310-desativar-ou-reativar-um-cliente) |
| "vinculado a …", como "vinculado a pedido de Desbloqueio de CE" | Outro registro depende deste. | Resolva o vínculo ou cancele em vez de excluir. |
| "Não é possível excluir esta escala: existem B/Ls vinculados." | A escala tem B/L para aquele porto, mesmo cancelado. | Se o navio só deixou de ir ao porto, registre a omissão ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)). |
| "Esta tarifa já foi usada (ou já está em vigor): desative em vez de excluir." | A tarifa, o item ou a Condição de Cliente já entrou num cálculo ou já está em vigor. | Peça ao {{Administrativo}} que a desative ([9.7](09-containers-e-demurrage.md#97-cadastrar-tarifas-e-acordos-de-demurrage); capítulo 21). |
| "Registro referenciado nao existe ou ainda esta em uso." | Outro cadastro ainda usa este, como o item que tem Condição de Cliente. | Desative em vez de excluir (capítulo 21). |
| "Este local ainda está em uso em outros registros e não pode ser excluído." | O Local já foi usado. | Desative em vez de excluir ([10.7](10-veiculos-vazios-granito.md#107-cadastrar-depots-terminais-e-serviços)). |
| "Nada foi excluído: você não tem permissão para excluir este registro, ou ele já não existe." | Ou a exclusão não é da sua equipe, ou outra pessoa já excluiu. | Recarregue a lista; se o registro continua lá, peça ao {{Administrativo}}. |
| "A Viagem tem fatura viva ou baixa: …. Resolva cada B/L antes de cancelar a Viagem." | Algum B/L da Viagem tem fatura ou pagamento. | [4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir) e capítulos 22 a 24 |
| "O cliente não pode ser desativado: …. O Financeiro quita ou cancela antes." | O Cliente tem fatura, valor a receber ou Invoice de Demurrage em aberto. | [13.10](13-cadastro-do-cliente.md#1310-desativar-ou-reativar-um-cliente) |

## Taxas Locais, fatura e pagamento

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "Há linhas que precisam de revisão: corrija o B/L e recalcule antes de emitir." | Uma taxa do B/L está **Em revisão**. | [7.6](07-ficha-do-bl.md#76-as-taxas-locais-na-ficha) e capítulo 21 |
| "B/L … sem CE Mercante. Cadastre o CE antes de faturar." | A fatura, ou a volta dela a emitida, pede o CE de todos os B/Ls dela. | Importe a planilha de CE ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)). |
| "Saiu da revisão, mas o faturamento automático não concluiu: …" | O B/L saiu da Revisão, mas a fatura não saiu. | [8.6](08-revisao.md#86-o-que-acontece-quando-o-bl-sai-da-revisão) |
| "Somente o Administrativo cancela a baixa de um pagamento." | Desfazer uma baixa é do {{Administrativo}}. | Peça ao {{Administrativo}} (capítulo 24). |
| "O excedente desta baixa já foi devolvido ao Cliente: a baixa não pode ser cancelada." | O dinheiro a mais dessa baixa já voltou ao Cliente. | Capítulo 24. |
| "A liberação é concedida pelo Administrativo." | A Liberação de faturamento sem Portal é decisão do {{Administrativo}}. | [13.8](13-cadastro-do-cliente.md#138-liberar-o-faturamento-sem-portal) |

## Cliente e Portal

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "Já existe um registro com o valor "…"." | O valor, quase sempre o CNPJ, já está cadastrado. | Procure o Cliente pelo CNPJ: ele pode já existir ou estar desativado ([13.3](13-cadastro-do-cliente.md#133-cadastrar-um-cliente)). |
| "Endereço suprimido por bounce/complaint. Informe outro." | O e-mail escolhido para o convite está bloqueado. | Use outro endereço, ou libere este com a confirmação do Cliente ([14.7](14-portal-a-conta.md#147-liberar-um-endereço-bloqueado)). |
| "Conta ativa usa recuperação de senha." | A conta já está **Ativa** ou **Suspensa**: convite não serve. | Na ativa, o Cliente usa **Esqueci minha senha** ([17.4](17-suporte-ao-cliente.md#174-o-cliente-esqueceu-a-senha)); a suspensa precisa ser reativada ([14.8](14-portal-a-conta.md#148-suspender-ou-reativar-a-conta)). |
| "Cliente desativado não recebe convite." | O Cliente está desativado no Vela. | [13.10](13-cadastro-do-cliente.md#1310-desativar-ou-reativar-um-cliente) |
| "A conta mudou de situação. Atualize e tente novamente." | Outra pessoa mexeu na conta ao mesmo tempo. O Cliente pode ter recebido um link que já não vale. | Atualize e confira a **Conta** antes de reenviar ([14.4](14-portal-a-conta.md#144-acompanhar-o-convite-até-a-ativação)). |
| "O envio do email falhou. Verifique o status do convite antes de tentar novamente." | O provedor de e-mail recusou o convite, e a conta ficou **Falha no envio**. | Confira o endereço e use **Revisar e-mail e reenviar** ([17.5](17-suporte-ao-cliente.md#175-o-e-mail-não-chegou)). |
| "O e-mail continua bloqueado: ele também é contato de Cliente ou e-mail de recuperação do Portal. Corrija pelo cadastro do Cliente." | O endereço do usuário também é de um Cliente, e o bloqueio continua. | [25.4](25-administracao.md#254-redefinir-a-senha-ou-corrigir-o-e-mail) |
| "CNPJ ou senha inválidos. …" (no Portal) | Toda recusa de entrada no Portal mostra esta frase. | [15.2](15-portal-o-que-o-cliente-ve.md#152-como-o-cliente-entra) e [17.2](17-suporte-ao-cliente.md#172-o-cliente-não-consegue-entrar) |
| **Convite indisponível** (no Portal) | O link do convite venceu, já foi usado ou foi trocado por um reenvio. | [14.4](14-portal-a-conta.md#144-acompanhar-o-convite-até-a-ativação) e [17.3](17-suporte-ao-cliente.md#173-o-convite-não-funciona) |
| "Acesso ao Portal encerrado: cliente desativado." (no Portal) | O Cliente foi desativado no Vela. | Se for engano, o {{Administrativo}} reativa ([13.10](13-cadastro-do-cliente.md#1310-desativar-ou-reativar-um-cliente)). |
| "A verificação de segurança expirou ou não foi validada. Faça-a novamente." (no Portal) | A verificação da tela de entrada ou de recuperação de senha venceu. | Peça ao Cliente que refaça a verificação e tente de novo. |

## Desbloqueio de CE

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "Documento ainda não reenviado pelo cliente" | O Cliente anexou a versão nova, mas não reenviou a solicitação. | [12.3](12-desbloqueio-de-ce.md#123-analisar-os-documentos-de-uma-solicitação) |
| "Documento substituído" | O Cliente anexou uma versão mais nova. | Analise a versão nova. |
| "Documento não pertence à análise atual" | A solicitação está em rascunho, cancelada ou é VIP. | Abra a solicitação de novo e confira a situação ([12.1](12-desbloqueio-de-ce.md#121-entender-o-desbloqueio-de-ce)). |
| "Documento indisponível" | O envio do arquivo não terminou, ou o arquivo foi removido. | Peça ao Cliente que anexe o documento de novo. |

## Alertas e usuários

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "Item de alerta não está ativo." | O alerta já fechou, ou outra pessoa o resolveu antes. | Abra **Alertas** de novo e confira ([20.2](20-alertas.md#202-resolver-um-alerta)). |
| "Falha ao resolver o alerta." | A resolução não gravou, e o Vela não disse por quê. | Recarregue a fila; se o alerta continua, tente de novo. |
| "… é o último usuário Administrativo ativo. Antes de mudar o setor ou desativar, ative ou cadastre outro usuário Administrativo." | O Vela não fica sem ninguém no {{Administrativo}}. | [25.3](25-administracao.md#253-trocar-a-equipe-de-um-usuário) |
| "Já existe um usuário com este e-mail." | O e-mail é de outro usuário, ativo ou desativado. | [25.2](25-administracao.md#252-criar-um-usuário) |
| "Você não pode desativar o próprio acesso." | Desativar um usuário é sempre ato de outra pessoa. | [25.5](25-administracao.md#255-desativar-ou-reativar-um-usuário) |
| "A conta com a marca Dev só tem o e-mail e a senha trocados pela própria pessoa." | A conta que liga o envio real de e-mails é protegida. | [25.4](25-administracao.md#254-redefinir-a-senha-ou-corrigir-o-e-mail) |

## Quando o Vela não explica

| Mensagem | O que quer dizer | O que fazer |
|---|---|---|
| "O sistema recusou a operação por uma regra de negócio.", "Operação bloqueada por uma pendência do B/L ou da Viagem." ou "A operação não é possível no estado atual do registro." | O Vela recusou, mas o motivo veio num formato que a tela não mostra. | Avise o suporte técnico com a tela, a hora e a versão do Vela ([1.6](01-o-vela.md#16-quando-algo-dá-errado)). |
| "Registro nao encontrado." | O registro não existe mais: foi excluído, ou o link é antigo. | Recarregue a lista e procure de novo. |
| "Falha inesperada. Tente novamente." ou "Não foi possível concluir a operação. Tente novamente." | A ação falhou sem um motivo conhecido. | Tente de novo. Se repetir, avise o suporte técnico. |
