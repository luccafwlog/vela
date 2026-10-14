# 2026-10-13 — Revisão geral da documentação

> **Nota editorial (2026-10-14).** Plano encerrado e arquivado: o dono respondeu todas as decisões pendentes em 2026-10-14, registradas na [ADR 0083](../../../adr/0083-decisoes-da-revisao-geral-da-documentacao.md) (lotes A e B) e na [ADR 0084](../../../adr/0084-registro-de-decisoes-ja-em-producao.md) (C1). As correções de código seguem no [plano de correções](../../../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md). O texto abaixo é o registro das decisões como estavam pendentes.

Plano vivo da revisão aprovada pelo dono em 2026-10-13. As regras do trabalho
estão na [ADR 0082](../../adr/0082-governanca-documental-dono-unico-e-adr-historica.md)
e em [CONVENCOES.md](../../CONVENCOES.md). A varredura e a aplicação terminaram em
2026-10-14; o que foi feito está no
[relatório final](../audits/2026-10-13-revisao-geral-documentacao.md).
Este arquivo continua vivo como registro das decisões pendentes: vai para
`docs/archive/plans/` quando a última for respondida e virar ADR.

## Objetivo

A documentação viva diz o que o sistema faz hoje, cada fato tem um único dono,
e as ADRs antigas são lidas como histórico sem confundir com a regra vigente.

## Fases

| Fase | Entrega | Estado |
|---|---|---|
| 0 | ADR 0082, `CONVENCOES.md` e este plano | concluída |
| 1 | Inventário de temas × documentos | concluída em 2026-10-13: auditoria de 400 achados em 15 escopos |
| 2 | Varredura por domínio: corrige (a), registra (b) e (c), leva as regras do `CONTEXT.md` para os módulos | concluída em 2026-10-14 |
| 3 | Rodadas de decisão com o dono, em lote por domínio | em andamento: lotes A, B e C abaixo aguardam o dono |
| 4 | Faixas e índice de ADRs, documentos datados para o arquivo, ampliação do `docs:check`, relatório final | concluída em 2026-10-14 |

## Domínios da varredura

Cada domínio confronta, para o mesmo tema: cadeia de ADRs, `CONTEXT.md`, doc
do módulo, `regras-de-negocio.md`, `manual-financeiro.md`,
`RASTREABILIDADE.md`, `ARCHITECTURE.md` e `ROADMAP.md` contra as migrations
ativas e `src/`.

| # | Domínio | Documentos principais | Estado |
|---|---|---|---|
| 1 | Viagens e Operação | `viagens.md`, `chegadas-saidas.md`, `operacao-suporte.md` (ADR operacional, Line-Up) | aplicado em 2026-10-14 |
| 2 | B/L, EDI, Baplie, Granito e vazios | `manifesto-edi.md`, `granito.md` | aplicado em 2026-10-14 |
| 3 | CE Mercante e Desbloqueio de CE | `desbloqueio-ce.md`, plano e spec de desbloqueio | aplicado em 2026-10-14 |
| 4 | Clientes, Taxas Locais e Faturamento | `clientes.md`, `taxas-locais.md`, `faturamento.md`, `manual-financeiro.md` | aplicado em 2026-10-14 |
| 5 | Demurrage | `demurrage.md` | aplicado em 2026-10-14 |
| 6 | Conciliação PIX | `reconciliacao-pix.md` | aplicado em 2026-10-14 |
| 7 | Portal, autenticação e segurança | `portal-cliente.md`, `seguranca.md`, `portal-rate-limit.md` | aplicado em 2026-10-14 |
| 8 | Alertas, notificações e comunicação | `operacao-suporte.md` (alertas), comunicação com o cliente | aplicado em 2026-10-14 |
| 9 | Infraestrutura e processo | `WORKFLOW.md`, `setup/`, `servicos-externos.md`, `segredos-cron.md`, `backup-r2.md`, `observabilidade.md`, `AGENTS.md`, `README.md` | aplicado em 2026-10-14 |

## Inventário (Fase 1)

A auditoria cobriu 12 domínios (D0 a D11) e 3 escopos transversais
(RASTREABILIDADE, ARCHITECTURE e índices): 304 achados (a), 42 duplicações,
49 (b), 4 (c) e 1 refutado. A contagem por escopo está no
[relatório final](../audits/2026-10-13-revisao-geral-documentacao.md#achados).

## Correções aplicadas — tipo (a)

Registradas por domínio no commit correspondente; resumo no
[relatório final](../audits/2026-10-13-revisao-geral-documentacao.md#o-que-mudou).

## Decisões pendentes — tipos (b) e (c)

Cada item traz o caso, as opções e a recomendação. Itens respondidos viram
ADR nova e saem desta lista.

A auditoria de 2026-10-13 (400 achados em 12 domínios e 3 escopos transversais,
cada um conferido por um verificador independente nas lentes de código e de
decisão) deixou 53 itens para o dono. Unidos os repetidos, são 50: 24
decisões de negócio (lote A), 25 defeitos em que o código desobedece uma
decisão já registrada (lote B) e uma decisão de organização documental tomada
na própria revisão (D9-19, no fim desta seção). A aplicação acrescentou A25,
B26 a B32 e C1: no total, 25 decisões de negócio, 32 defeitos e 1 registro. A evidência é leitura estática de código,
migrations ativas e documentos; o que diz "Suspeita" não foi executado.

### Lote A — decisões de negócio

#### Transversal e Administração

| Id | Caso | Opções | Recomendação |
|---|---|---|---|
| A1 (D0-22) | O Financeiro devolve R$ 600 de fatura paga a maior; a tela diz "Restituição pendente", mas o glossário chama isso de "Estorno" e usa "estorno" também para Cancelar baixa. | Adotar "Restituição" (estorno vira sinônimo a evitar) · Manter "Estorno" e trocar as telas | Adotar "Restituição", que já é o rótulo visível; Cancelar baixa continua distinto. |
| A2 (D0-06, D9-06) | O único Administrativo muda o próprio setor para Financeiro em `/admin/usuarios`; ninguém mais abre `/admin`. A regra "Administrador ativo mínimo" só existe no glossário. | Trava no banco (recusa rebaixar/desativar o último Administrativo) e motivo na tela · Retirar a regra e recuperar pelo painel do Supabase | Trava no banco e ADR nova; renomear para "Administrativo ativo mínimo". |
| A3 (D0-05) | Um Administrativo apaga um perfil interno chamando a API diretamente; o histórico perde o nome de quem assinou. A ADR 0074 diz que usuário não se exclui. | Revogar o DELETE no banco · Registrar que a regra vale só na tela | Revogar o DELETE (como a migration `086` fez com documento fiscal). |
| A4 (D11-11) | O hook `protect-files.sh` bloqueia migration nova; o `AGENTS.md` protege só as existentes, e na prática a criação passa por shell. | Hook bloqueia só arquivo existente · Toda escrita em `supabase/migrations/` exige autorização | Hook só para existentes; o gate `migrations:check` já cobre migration destrutiva. |
| A5 (D11-06) | Importar planilha ou gerar cobrança Pix faz uma função com privilégio de dono ler o Vault e chamar a Edge Function na hora (migrations `218`/`219`); a ADR 0063 diz que só o job do `pg_cron` lê o cofre. | Exceção registrada em ADR nova · Voltar a depender só do job de 1 minuto · Sinalização sem segredo consumida pelo job | Exceção em ADR nova, documentando a exposição na fila do `pg_net`. |
| A6 (D11-08) | O backup diário roda no Agendador do Windows do computador do dono; de 01 a 04/10 ficou sem cópia, acima da janela de 1 dia da ADR 0074. | Aceitar até entrar dado real · Mover para executor sempre ligado · Heartbeat no Better Stack | Heartbeat já, e executor sempre ligado antes de revogar o "Data status". |

#### Viagens e escalas

| Id | Caso | Opções | Recomendação |
|---|---|---|---|
| A7 (D1-23) | A viagem tem a escala BRSSA com 2 B/Ls sem CE importados por engano; o Administrativo quer tirar BRSSA. A tela recusa, o banco aceita, a ADR 0071 diz que pode. | Recusar no banco também (tirar os B/Ls primeiro) · Excluir em cascata com prévia · Excluir só a escala (como a RPC faz) | Recusar no banco, como a tela já faz. |
| A8 (D1-25) | A omissão de BRVIX foi registrada por engano e revertida; dias depois o armador confirma a omissão. Hoje a nova omissão é recusada como "já omitida". | Permitir nova omissão (unicidade só entre não revertidas) · Reabrir a revertida · Reversão é definitiva | Permitir nova omissão, preservando o histórico da revertida. |

#### Faturamento e Taxas Locais

| Id | Caso | Opções | Recomendação |
|---|---|---|---|
| A9 (D6-06) | O Financeiro clica em "Gerar fatura avulsa" e recebe "sem permissão": a RPC aceita só o Administrativo, mas ADR 0075, manual, módulo e glossário dizem que o Financeiro emite. | Liberar o Financeiro na RPC · Manter só Administrativo e corrigir os documentos (esconder o botão) | Decisão do dono, sem recomendação técnica: depende de quem deve poder criar cobrança fora da tabela. |
| A10 (D6-08) | Tabela ativa de Vitória com vigência até 30/09; B/L importado em 05/10. O cálculo automático cobra pela tabela; o lançamento manual e o "Item da tabela" da avulsa não a oferecem e usam a data do upload para a Condição de Cliente. | Alinhar o caminho manual ao automático (ADR 0040) · Registrar a exceção do caminho manual | Alinhar ao automático. |
| A11 (D6-09) | B/L faturado em R$ 1.000 sem pagamento sofre COD para porto cuja tabela dá R$ 1.200: a fatura é reemitida sozinha (ADR 0077), mas o painel ainda pede "Cancelar e reemitir" (ADR 0051). | ADR 0077 vale para COD e o Ajuste só registra · ADR 0051 vale e o COD sai da correção automática · Documentar o híbrido | ADR 0077 vale para COD; o Ajuste de COD se liquida com a sucessora. ADR nova. |

#### Demurrage

| Id | Caso | Opções | Recomendação |
|---|---|---|---|
| A12 (D7-02) | Invoice paga de USD 1.000; a devolução é corrigida e o valor cai para USD 800. Hoje só suspende e alerta; pela ADR 0078 item 19 o excedente viraria restituição sozinho. | Aceitar o tratamento manual (alerta + Restituição excepcional) por ADR nova · Implementar a restituição automática | Aceitar o manual enquanto Demurrage não tiver saldo nem pagamento parcial. |
| A13 (D7-03) | Invoice de USD 1.000 com 20% de desconto: o e-mail da Régua diz "Valor da cobrança: USD 1.000,00" e calcula o BRL sobre USD 800. | USD a cobrar (líquido) · Bruto, desconto e líquido · Só bruto | USD líquido, coerente com o BRL e com a tela. |
| A14 (D7-01) | Qualquer usuário interno ativo grava a referência cambial (ROE) que a emissão de Demurrage usa, pelo cabeçalho ou pela API. | Só o job do BCB e o Informar PTAX gravam · Emissão recusa referência manual não vinda do Informar PTAX · Aceitar por ADR | Restringir a gravação (ADR 0065, decisão 4). |
| A15 (D10-07) | Disputa aberta do dia 1 ao 30 numa Invoice cobrada no dia 0: ao fechar, a Régua manda as cobranças 2, 3, 4 e 5 em quatro rodadas horárias seguidas. | Uma cobrança ao retomar e as seguintes a cada intervalo · Manter e documentar a rajada | Ancorar no último envio. |

#### Conciliação PIX

| Id | Caso | Opções | Recomendação |
|---|---|---|---|
| A16 (D8-01) | A consulta do Itaú para; o extrato traz um Pix com TXID de uma Invoice de Demurrage (ou de uma avulsa). O plano B pelo extrato não acha a fatura e "Escolher fatura…" não lista fatura aberta. | Corrigir a busca pelo TXID da cobrança · Aceitar o limite (plano B só para individual/consolidada) · Corrigir só o Itaú | Corrigir: o plano B existe para quando o Itaú falha. Até lá, o módulo registra o limite. |
| A17 (D8-02) | Pix de Demurrage sem TXID legível, CNPJ com uma só Invoice aberta e valor igual à foto de ontem. A ADR 0015 previa baixa pela janela das duas PTAX; o código cria exceção. | Manter a exceção e registrar o abandono do fallback · Implementar o fallback por CNPJ | Manter a exceção e registrar em ADR nova. |

#### Portal do Cliente e segurança

| Id | Caso | Opções | Recomendação |
|---|---|---|---|
| A18 (D9-04) | Um usuário de Operações abre `/clientes/portal` para atender um Cliente sem convite e vê o Email de Recuperação e o status de entrega mascarados; a ADR 0045 mandava mostrar. | Restaurar a ADR 0045 · Manter o mascaramento por ADR nova | Restaurar: a leitura interna é global (ADR 0044). |
| A19 (D9-05) | Uma fatura antiga sem Portal ativo abre a exceção crítica: o glossário promete e-mail imediato a Documentação e Administrativo, mas só há sino e `/alertas` (o resumo das 08:00 não inclui a exceção). | Reimplementar o e-mail imediato · Aceitar sino + `/alertas` · Incluir a exceção no resumo das 08:00 | Aceitar sino + `/alertas` enquanto não há dados reais; no GO LIVE, incluir a exceção no resumo das 08:00 ou reimplementar o e-mail. |
| A20 (D9-11) | ~25 verbetes do glossário descrevem piloto e GO LIVE do Portal (≈10 clientes, critério de saída, rollback escalonado) que nunca foram executados nem têm plano vivo. | Mover para plano vivo de GO LIVE com os itens já cumpridos marcados · Registrar novo formato de abertura e arquivar o desenho de julho | Plano vivo de GO LIVE (onde também cabe a troca do "Data status"). |
| A21 (D9-20) | As RPCs legadas `upsert_customer_portal_account` e `set_customer_portal_account_active` (senha em tabela, ativação direta) continuam executáveis pelo Administrativo, e a policy `cpa_admin_all` permite as mesmas escritas direto na tabela; reativar uma conta Suspensa por esse caminho devolve acesso a dados. | Remover RPCs, job e tabela de sessões legadas e fechar a escrita direta · Revogar o EXECUTE e documentar como legado | Remover e fechar a policy (dados descartáveis pelo "Data status"). |

#### Alertas e comunicação

| Id | Caso | Opções | Recomendação |
|---|---|---|---|
| A22 (D10-04) | Cliente com o financeiro@ só na caixa Financeiro: a produtora inclui a caixa no Comunicado de CE e Taxas, a Edge Function recusa e o runner repete a cada 15 minutos. | Edge aceita as duas caixas (ADR 0064) · CE e Taxas é só de Documentação e Operação | Aceitar as duas caixas, como a ADR 0064 e o módulo dizem. |
| A23 (D10-15) | O CE de um B/L com Comunicado já enviado é trocado e abre "Reenviar Comunicado de CE e Taxas"; depois do reenvio o alerta não fecha, porque não existe ação de resolver. O mesmo vale para `portal_abuso_login`, que nenhum produtor fecha. | Fechar pela origem quando houver fato verificável · Ação "Resolver com justificativa" (exceção à ADR 0053) · Virar Notificação Interna | Fechar pela origem e decidir em ADR a resolução com justificativa para os tipos de conferência. |
| A24 (D10-17) | O ADR abre itens para Operações, Equipamentos e Documentação; Operações é avisado sem estar na audiência do catálogo. | Aceitar a união (catálogo + setor do item) · Voltar à ADR 0034 (só catálogo) | Aceitar a união, que é o que `/alertas/regras` ensina. |

### Lote B — defeitos contra decisão registrada

Em cada um, a decisão já existe (ADR ou decisão do dono) e o código não a
cumpre. Recomendação para todos: tratar como defeito em tarefa de código
separada; a documentação continua descrevendo a decisão e registra a
divergência em "Notas e divergências" do módulo até a correção.

| Id | Defeito | Decisão que o código não cumpre |
|---|---|---|
| B1 (D4-01) | Trocar o CE de um B/L com Desbloqueio conferido não abre `ce_trocado_com_desbloqueio` nem avisa na prévia: o código procura a confirmação removida na migration `160`. Bloqueia a ativação do Desbloqueio de CE. | ADR 0078, item 4 |
| B2 (D2-01) | O ADR de cada terminal mostra a carga da escala inteira: dois terminais exibem os mesmos containers e a exceção de terminal do B/L é ignorada. | ADR 0068 |
| B3 (D10-05, D2-29) | NOB com B/L misto ou com exceção de terminal nunca é gravado (manual nem automático); a produtora, a conferência manual, a Edge Function e a RPC usam regras diferentes. | ADR 0067 e ADR 0068 |
| B4 (D10-03) | Um Cliente do NOB sem contato faz a produtora automática abortar inteira: nenhum Comunicado automático sai para ninguém (Suspeita, leitura estática). | ADR 0064 |
| B5 (D2-02) | O sign-off do ADR terminalizado aceita seção Pendente por chamada direta à RPC. | ADR 0029/0036 (seções resolvidas antes da assinatura) |
| B6 (D2-03) | Escala sem terminal cai no ADR legado, que é criado e fechado sem terminal e sem a trava de frente TBC. | ADR 0035 e ADR 0068 |
| B7 (D2-08) | A seção Veículos (de Equipamentos) aparece no painel de Documentação. | Plano arquivado de 2026-08-26 |
| B8 (D2-09) | A Linha do Tempo do ADR não mostra quando o ATD foi registrado. | ADR 0039 |
| B9 (D2-11) | O prazo do ADR é avaliado em data UTC: assinatura às 22h de Brasília no último dia conta como atraso. | ADR 0039 (dia útil local) |
| B10 (D2-30) | O Embarque de Vazios só oferece portos de B/Ls: viagem só de embarque não cria o Embarque. | ADR 0035 (escala unificada) |
| B11 (D2-31) | A coluna Total do Embarque aplica o percentual legado; o ADR e o total do Embarque não. | ADR 0033 |
| B12 (D2-32) | O atalho de armazenagem não reconhece serviço sem condição, que o valor sugerido aceita. | ADR 0033 |
| B13 (D0-07) | Reativar tarifa e reativar usuário não pedem motivo; duas telas dizem "Ativar". | ADR 0072 e vocabulário de 2026-09-24 |
| B14 (D0-09) | Vazios: a trava pelo ADR de Saída fechado não existe e Excluir unidade não pede motivo. | ADR 0071, item 4, e ADR 0072 |
| B15 (D0-10) | Desativar/Reativar Local, terminal e serviço do depot: qualquer usuário, sem diálogo, com "inativado". | ADR 0073, item 8 |
| B16 (D5-07) | A sugestão de Cliente por nome não aparece na Revisão nem na ficha do Cliente (só no Granito). | ADR 0043 |
| B17 (D5-08) | B/L com CNPJ de Cliente desativado chega à Revisão como "Sem cliente vinculado", sem o motivo. | ADR 0073, item 6 |
| B18 (D5-20) | O mapa caixa → modelo de Comunicado está duplicado no navegador: modelo novo no banco não aparece na conferência. | ADR 0064 |
| B19 (D10-02, R-07) | Os alertas `caixa_sem_destinatario` e `cliente_sem_contato_principal` aparecem como "Alerta não catalogado" e não têm verbete em `/alertas/regras`. | ADR 0064 |
| B20 (D10-19) | A produtora automática ainda lê `customer_contact_preferences`. | ADR 0064 |
| B21 (D3-22) | A prévia do B/L de container trata o peso dos contêineres de um B/L misto como peso de faturamento. | ADR 0017 |
| B22 (D3-23) | A planilha-modelo de CE Mercante traz CEs de 9 dígitos, que a importação recusa. | Regra de 15 dígitos |
| B23 (D4-20) | O campo "Nº do manifesto" da Rota mostra exemplo de 9 caracteres. | ADR 0078 (13 caracteres) |
| B24 (D7-04) | O markup 1,065 está escrito em cinco pontos (navegador, Edge Function e três funções do banco). | ADR 0014 (ponto canônico único) |
| B25 (D9-22) | `portal_provisioning_backfill` voltou ao catálogo depois de removida. | Remoção na migration arquivada `203` |

### Itens levantados na aplicação das faixas das ADRs

Os agentes que escreveram as faixas "Situação atual" e os que aplicaram a
revisão nos documentos conferiram o código e encontraram mais nove pontos.
Eles não passaram pelo verificador independente; a evidência está na faixa de
cada ADR ou no documento citado.

| Id | Tipo | Caso | Recomendação |
|---|---|---|---|
| A25 (ADR 0002) | decisão | A reconsolidação self-service no Portal não avisa os operadores internos (o alerta saiu na migration arquivada `327`, sem ADR), e a RPC confere só que a consolidada é do Cliente, não quem a emitiu. | Decidir se o alerta interno volta e se a reconsolidação deve recusar consolidada emitida por outra parte. |
| B26 (ADR 0018) | defeito | As importações de B/L e de CE Mercante abertas na página da viagem, e o Embarque de Vazios aberto por ela, travam a viagem, contra a decisão 2 (viagem pré-semeada e editável). | Tratar como defeito. |
| B27 (ADR 0053) | defeito | `resolve_billing_alert` deixa qualquer usuário interno ativo fechar `billing_auto_issue_failed` e `billing_calculation_blocked`; a conferência da origem é feita só no navegador. | Tratar como defeito: recomputar a origem no servidor. |
| B28 (ADR 0061) | defeito | O diálogo "Vincular cliente ao grupo" da Revisão diz "sem alterar contatos", mas `save_bl_review` captura o e-mail do manifesto quando a fila de conciliação fecha. | Corrigir o texto do diálogo ou a captura, conforme a ADR 0064 (captura protegida). |
| B29 (ADR 0014) | defeito | `demurrage_invoices.due_date` existe e a ficha do Cliente conta Invoice de Demurrage vencida, contra "Demurrage não vence". | Tratar como defeito. |
| B30 (glossário) | defeito | O banco entrega ao Portal o free time e o valor por período de cada container de Demurrage, mas o detalhe da Invoice no Portal mostra só datas, dias e USD; o glossário prometia o detalhamento ao Cliente. | Decidir se o Portal passa a mostrar o detalhamento ou se a promessa sai. |
| B31 (ADR 0072) | defeito | Salvar do Local e do serviço em `/embarquevazios/depots` grava sem o diálogo de antes e depois (achado na aplicação de `regras-de-negocio.md`). | Tratar como defeito. |
| B32 (ADR 0058) | defeito | A Edge Function de aviso de fatura emitida que a [ADR 0058](../../adr/0058-canal-de-comunicado-ao-cliente.md) mandou apagar (o nome está na ADR) segue publicada e ativa em produção (v68, de 2026-09-01), sem código no repositório (Runtime, listagem só leitura em 2026-10-14; ver [Serviços externos](../../operations/servicos-externos.md)). | Apagar em produção é mutação: fica com o dono. |
| C1 | registro | Decisões já tomadas e em produção sem ADR: integração Pix dinâmica com o Itaú (migrations `151`–`154`, `219`), Automatic branching do Supabase desligado em 2026-10-07 e environments de Preview sem restrição de branch (recusa de 2026-10-06). | Registrar numa ADR nova de consolidação, sem mudar comportamento. |

Decisão de organização tomada na revisão, sem pergunta ao dono (D9-19): o
console `/clientes/portal` e a ativação do convite pertencem a
`docs/modules/portal-cliente.md`; `clientes.md` mantém o atalho com link.
