# Desbloqueio de CE Mercante — Issue 557

Estado: execução autorizada; implementado no checkout, validação local em andamento
e publicação pendente. Data: 2026-10-04.
Fonte: [Issue 557](https://github.com/luccafwlog/vela/issues/557), lida com seus
critérios complementares de 07/09/2026; não há comentários na issue.
Plano derivado: [implementação](../plans/2026-10-04-desbloqueio-ce-mercante.md).
Revisada em 2026-10-07 pela [revisão do fluxo](../archive/specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md),
que prevalece onde divergir.

## Resultado pretendido

No Vela, **Importação → Desbloqueio de CE** reúne os B/Ls de importação com
`bls.ce_mercante` preenchido, inclusive os que ainda não têm solicitação. No
Portal, o cliente seleciona um ou vários B/Ls autorizados de seu CNPJ, baixa o
modelo do termo, anexa termo assinado e procuração e solicita o desbloqueio;
CNPJ VIP com documentos anuais aprovados e vigentes usa a cobertura já registrada.
Pagamento confirmado das taxas locais é obrigatório para enviar o pedido.
O desk analisa os documentos e acompanha os quatro requisitos por B/L.

Refinamento informado pelo usuário em 2026-10-04: a planilha ZPT tem somente
cinco colunas (B/L, termo, procuração, entrega de B/L e pagamento das taxas).
CNPJs com condição **VIP** apresentam termo e procuração de aplicabilidade anual
uma única vez na vigência, sem novos anexos a cada solicitação. Pagamento e
entrega física continuam obrigatórios por B/L.

Proposta para o requisito físico: a entrega do B/L original é registrada pelo
desk no Vela e bloqueia a aptidão para ZPT, mas não o envio do pedido pelo cliente.
Essa hipótese foi perguntada ao usuário e deve ser confirmada antes da execução.
Não implementar dispensa de original, assinatura eletrônica ou outros documentos
substitutivos sem uma regra de negócio específica.

## Opções e recomendação

1. **Recomendado: solicitação com vários B/Ls, requisitos individuais e exportação
   assistida.** Atende a issue, compartilha documentos e mantém a conferência no
   Vela; inclui a cobertura documental anual dos CNPJs VIP.
2. Pedido separado por B/L: mais simples, mas repete anexos e contraria o fluxo
   de múltiplos B/Ls descrito na issue.
3. Integração direta com ZPT/Mercante: reduz trabalho manual, mas exige API,
   credenciais, regras de retry e retorno oficial ainda não fornecidos. Fase futura.

## Portal do Cliente

Rota proposta `/portal/desbloqueio-ce`, item **Desbloqueio de CE** no menu e
atalho na operação. Abas **Solicitar desbloqueio** e **Minhas solicitações**.
Lista mostra B/L, CE, navio/viagem, POD, taxas locais e motivo de impedimento.
B/L sem CE não entra na seleção; B/L com dívida continua visível com orientação
para Faturas. Não limitar ao tipo container: incluir carga solta e misto em
`bls`, respeitando o recorte de importação já existente.

Seleção admite somente B/Ls do cliente, visíveis segundo a autorização vigente,
com CE, pagamento confirmado e sem pedido ativo ou desbloqueio já confirmado.
O backend valida novamente todos os B/Ls ao enviar; se um ficar inelegível,
recusa o envio inteiro e informa os impedimentos autorizados para essa conta.
Limites propostos: 100 B/Ls por pedido, um termo e uma procuração comuns ou
referências aos documentos anuais VIP; cada PDF de até
10 MiB cada, 20 uploads/24h e 100 MiB em rascunhos/pedidos ativos por cliente.

O botão **Baixar modelo do termo** oferece documento oficial versionado,
homologado pela agência; guardar sua versão no pedido. Não inventar texto jurídico.
O termo anexado deve abranger todos os B/Ls selecionados e o consignatário;
a procuração deve representar o mesmo CNPJ. O desk verifica esse conteúdo.
Upload incompleto fica em rascunho e nunca chega à fila como pedido enviado.
Confirmar envio mostrando B/Ls, anexos e consequência antes de executar.

Após envio, o cliente vê protocolo, B/Ls, quatro requisitos, andamento e motivos
de correção destinados a ele. Ao receber **Correção solicitada**, substitui
documentos por novas versões e reenvia; isso invalida as aprovações documentais
afetadas. Documentos comuns só são compartilhados dentro do mesmo pedido;
documentos anuais VIP são reutilizados entre pedidos do mesmo CNPJ durante sua
vigência aprovada. Nunca reutilizar entre CNPJs. Histórico preservado.

## Condição VIP e documentos anuais

A condição VIP é cadastrada para o Cliente/CNPJ no Vela, na ficha do cliente,
em uma seção **Desbloqueio de CE — VIP e documentos anuais**. Proposta de
responsabilidade: Administrativo/Documentação habilitam ou revogam a condição,
com motivo e histórico; o cliente não se declara VIP no Portal.
Essa seção mostra condição VIP, termo e procuração, vigência de cada documento,
status da análise, aprovador e versões anteriores. Ali o desk registra os
documentos recebidos, aprova, solicita correção, renova ou revoga sua cobertura.
A fila de Desbloqueio de CE identifica VIP e oferece atalho à seção do cliente.

No Portal, adicionar a aba **Documentos anuais** na página Desbloqueio de CE,
visível para clientes VIP. Ela mostra termo/procuração, início/fim da vigência,
status e ações para apresentar ou corrigir documentos uma vez por vigência.
O upload/análise anual é independente de pedido de B/L: é possível regularizar
documentos mesmo sem B/L selecionado ou com taxas pendentes.
O desk também pode cadastrar documentos entregues fora do Portal nessa mesma
cobertura, sem exigir novo upload do cliente.

Com ambos os documentos aprovados e vigentes, **Solicitar desbloqueio** mostra
**Cobertura VIP vigente** com suas datas e não exige anexos. O cliente seleciona
B/Ls pagos e envia; o desk não precisa reaprovar os mesmos documentos por pedido.
Termo/procuração aparecem como **Aprovado — documento anual VIP**, com acesso
às versões utilizadas. O cliente continua precisando pagar cada B/L e entregar
seu original na agência. O selo VIP sozinho não satisfaz os documentos.

Se um documento anual estiver ausente, em análise, vencido ou revogado, mostrar
o impedimento e direcionar a Documentos anuais para regularização; só enviar
pedido VIP sem anexos quando os dois estiverem aprovados e vigentes.
Não conceder dispensa automática nem mudar silenciosamente para fluxo comum.
Cliente sem condição VIP segue o procedimento comum com anexos por pedido.

Validade anual confirmada pelo usuário: **até 31 de dezembro do ano correspondente**.
Registrar `coverage_year`, `valid_from` e `valid_until` por documento, exigindo
`valid_until = 31/12/coverage_year`. A cobertura se torna utilizável somente
após aprovação e dentro da vigência; não retroagir a aprovação nem renovar
automaticamente em janeiro. Comparar datas na zona operacional America/Sao_Paulo,
incluindo todo o dia 31/12; em 01/01 os documentos do ano anterior não cobrem
novas solicitações nem exportações. Revalidar cobertura no
envio e na exportação, inclusive quando o pedido atravessar o vencimento.
Documento vencido/revogado ou perda da condição VIP retira aptidão de itens
ainda não desbloqueados e exige revisão documental. Confirmações/exportações
históricas ficam preservadas; fato externo confirmado não é desfeito automaticamente.

Cada pedido registra a origem comum/VIP e os IDs/versões dos documentos usados.
Renovação cria novas versões; o desk aplica a nova cobertura aprovada aos itens
pendentes afetados por ação explícita, com histórico e sem reupload por pedido.
Um documento novo ainda em análise não invalida o anterior que continua aprovado
e vigente; revogação explícita invalida. Alterar VIP não invalida documentos
comuns aprovados em outros pedidos.

## Vela

Rota proposta `/desbloqueio-ce`, sob Importação. Tabela com uma linha por B/L:
B/L, CE, cliente/CNPJ, navio/viagem, POD, protocolo, data do pedido, termo,
procuração, taxas locais, B/L entregue, aptidão e andamento ZPT.
Filtros server-side por viagem, POD, cliente, B/L/CE, situação e requisito
pendente; paginação de 25 linhas. Filtro **Sem solicitação** mantém visíveis
os B/Ls com CE que ainda não receberam pedido.

Abrir o protocolo mostra os B/Ls relacionados, documentos e histórico.
Ações: aprovar/solicitar correção de cada documento para B/Ls explicitamente
selecionados, registrar/reverter entrega física com motivo, cancelar pedido
com motivo, exportar aptos e confirmar desbloqueio com evidência externa.
Ação em lote mostra elegíveis e bloqueados; nunca aprova implicitamente um B/L
fora da seleção. Toda escrita segue o diálogo de confirmação do projeto.

Permissões propostas: Administrativo e Documentação consultam documentos e
executam análise, entrega, exportação e confirmação. Financeiro e Operações
consultam resumo/requisitos, sem download de procuração ou escrita. Equipamentos
sem acesso nesta fase. Espelhar a matriz no banco e em `useAuth`, incluindo
o alias legado `operator = documentacao`. Matriz sujeita à validação operacional.
Modo Inspeção do Portal oferece as mesmas leituras autorizadas, somente leitura.

## Requisitos e estados

| Eixo por B/L | Estados / origem |
|---|---|
| Termo | pendente, aprovado, correção solicitada; por pedido ou anual VIP vigente |
| Procuração | pendente, aprovado, correção solicitada; por pedido ou anual VIP vigente |
| Taxas locais | confirmado ou impedido, com motivo; ledger financeiro |
| B/L físico | aguardando ou entregue; desk, data e histórico de reversão |
| Aptidão | derivada dos quatro requisitos atuais e do CE vigente |
| ZPT | não exportado, exportado aguardando confirmação, desbloqueio confirmado |

Pedido: rascunho, enviado, em análise, correção solicitada, cancelado ou concluído.
Concluído exige todos os seus B/Ls com desbloqueio confirmado. Pedidos mistos
preservam o andamento individual; exibir contadores em vez de um selo global apto.
B/Ls sem pedido não têm aptidão para exportação, mesmo com pagamentos/documentos
de outros processos. Aprovar documentos e gerar arquivo nunca marca desbloqueado.

Pagamento não é checkbox editável nem comprovante enviado. Derivar dos
recebíveis locais vigentes de cada B/L (`bl_receivables`) e suas liquidações,
incluindo ajustes de COD que gerem obrigações locais exigíveis. Exigir cobertura
integral confirmada e ausência de saldo local exigível. Ausência de recebível ou
saldo zero sem evidência de liquidação não prova pagamento. Faturas consolidadas
satisfazem apenas os B/Ls efetivamente liquidados; `invoice.status = paid` ou
`covered` isolado não é evidência suficiente. Demurrage e fatura avulsa ficam fora
da exigência de taxas locais, salvo decisão posterior explícita.

Revalidar no envio, leitura, aprovação e exportação. Cancelamento de baixa ou
nova obrigação remove aptidão de B/L ainda não desbloqueado; invalidar caches
financeiros e da fila. Não apagar exportações antigas nem afirmar que um CE
já desbloqueado voltou a bloquear: nesse caso sinalizar revisão operacional.
CE corrigido depois do envio exige nova conferência; manter CE exportado no
snapshot. Não herdar confirmação para outro número de CE.
Cancelar o B/L ou retirar seu CE impede novas solicitações/exportações sem
apagar o histórico. B/L cancelado com CE permanece consultável no Vela mediante
filtro, com impedimento explícito; reconferir CE corrigido exige ação auditável
antes de voltar à fila de aptos.

## Modelo e fronteiras

Novas entidades propostas, sem copiar o ledger ou criar B/L artificial:

- `ce_unlock_requests`: cliente resolvido pela sessão, protocolo, estado,
  chave idempotente, versão do modelo, datas e versão de concorrência.
- `ce_unlock_request_bls`: pedido/B/L, CE da solicitação, aprovações ligadas
  às versões dos anexos, motivos e confirmação externa. Um pedido ativo por B/L.
- `ce_unlock_documents`: tipo, versão, objeto privado, hash, bytes, MIME,
  autor e data; proprietário CNPJ e vínculo exclusivo a pedido comum ou cobertura
  anual VIP; objetos imutáveis, substituição por nova versão.
- `ce_unlock_vip_customers`: condição por cliente/CNPJ, versão e eventos de
  habilitação/revogação. Não reutilizar a condição como privilégio financeiro.
- `ce_unlock_vip_documents`: vínculo ao documento anual, tipo, início/fim de
  validade, decisão de análise, aprovador e revogação; cobertura consultada por
  CNPJ e tipo, sem compartilhar documentos com outro CNPJ.
- `ce_unlock_request_document_sources`: origem comum/VIP e versões usadas por
  pedido/B/L, incluindo trocas auditadas de cobertura nos itens pendentes.
- `ce_unlock_bl_deliveries`: registro físico por B/L, independente do pedido,
  com eventos de registro/reversão; não pedir nova entrega a cada reenvio.
- `ce_unlock_events`: transições append-only com ator, data, versão e motivo.
- `ce_unlock_exports` e `ce_unlock_export_items`: lote, versão do layout,
  quem gerou, timestamp, hash, CE e snapshot dos quatro requisitos por B/L.

Reusar `supabase` interno, `supabasePortal`, `PortalScope`, contratos explícitos
cliente/inspeção, query keys e efeitos de cache. RPCs resolvem cliente com
`current_portal_customer_id()`; não aceitar CNPJ/customer_id do cliente como
autoridade. RLS/grants e RPCs impedem acesso cruzado a pedido, B/L ou anexo.
Guarda interna exige perfil ativo e papel permitido; `authenticated` sozinho
não distingue um cliente de um desk. Projetar resposta pública por allowlist.

Bucket privado dedicado `ce-unlock-documents`, sem escrita direta do Portal.
Edge Function autentica a sessão, valida elegibilidade/quota, MIME e magic bytes
PDF, gera caminho e registra objeto pela RPC autenticada; seguir o padrão de
`portal-dispute-attachment`, sem reutilizar tabelas/bucket de Demurrage.
Downloads após autorização atual, URL assinada curta de 60 segundos. Falha
de registro limpa órfão pelo Storage API; rotina server-only remove rascunhos
abandonados após 7 dias, sem apagar documentos anuais por não terem pedido.
Documentos VIP entram nas quotas por CNPJ e na retenção documental homologada.
Limite diário inclui tentativas, evitando contorno por
uploads sem metadados. Proposta: anexos de pedidos enviados e eventos por 5 anos,
a confirmar com responsável documental antes da publicação.

## Exportação e confirmação

Layout funcional confirmado pelo usuário: planilha simples, uma linha por B/L,
com exatamente estas cinco colunas e nesta ordem:

| BL | Termo | Procuração | Entrega de BL | Pagamento das taxas |
|---|---|---|---|---|
| BL-EXEMPLO | Sim | Sim | Sim | Sim |

Proposta de arquivo: XLSX, B/L como texto e requisitos como Sim/Não. Confirmar
somente a representação literal dos status/cabeçalhos na validação de um arquivo
de exemplo; não exigir API ou contrato adicional para planejar as cinco colunas.
CE, selo VIP, protocolo e datas ficam no Vela/snapshot, fora dessa planilha.
Para VIP, termo e procuração recebem Sim por documentos anuais aprovados e
vigentes, nunca apenas por estar marcado VIP; usar a mesma regra de aptidão.
Proposta: exportação operacional envia só B/Ls aptos selecionados; relatório
de acompanhamento separado pode conter todos e seus quatro requisitos.
Validar com ZPT se ela exige também linhas pendentes; essa decisão modifica
o adaptador, sem mudar aptidão nem permitir liberação antecipada.

Criar lote transacional com snapshot consistente e revalidação financeira;
servidor serializa o arquivo no layout homologado. Download não prova envio à
ZPT. Registrar envio externo separadamente quando o operador o confirmar.
Retry com mesma chave retorna o mesmo lote/arquivo; reexportação deliberada
gera lote novo ligado ao anterior. Snapshot antigo fica consultável, e geração
ou reenvio exige situação atual. Nenhum arquivo pode incorporar campos internos
não previstos; usar sanitização canônica de planilhas compatível com o layout.
Confirmar desbloqueio por B/L/CE mediante referência/evidência externa e ator.

## Decisões necessárias antes da execução dependente

| Decisão | Proposta / dependência |
|---|---|
| Entrega física e papéis | Desk registra após pedido; confirmar com operação |
| Termo e procuração | Modelo oficial, requisitos de assinatura/validade e retenção; agência fornece |
| “CS” na issue | Não criar campo CS nem trocar silenciosamente por CE; autor esclarece |
| Isenção/valor zero | Pagamento ausente não é confirmado; Financeiro define tratamento explícito |
| COD e cobertura | Financeiro homologa quais ajustes/recebíveis compõem taxas locais exigíveis |
| VIP — validade anual | Definida pelo usuário: até 31/12 do ano correspondente; aprovação e renovação documental por CNPJ |
| ZPT | Cinco colunas confirmadas; validar representação dos status em exemplo e evidência de retorno |

Esses pontos não impedem revisar o plano, mas impedem executar/publicar as
partes dependentes como se as hipóteses fossem decisões aprovadas.

## Evidência atual e aceite futuro

Evidência desta proposta: leitura estática da issue, telas, serviços e migrations
do checkout. Nenhum fluxo novo foi executado; nenhum estado de produção foi lido.
O aceite exige pedido com um/muitos B/Ls pagos, análise e correção documental,
entrega física auditável, recálculo após cancelamento de baixa, isolamento entre
CNPJs incluindo download, ausência de duplicação em retries e exportação validada
pela ZPT. Confirmar um B/L não conclui os demais do pedido. Validar também VIP
com cobertura anual aprovada, dois pedidos sem reanexação, vencimento/revogação,
renovação e isolamento entre CNPJs.
