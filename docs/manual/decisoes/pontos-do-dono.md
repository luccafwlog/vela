# Pontos do dono fora das fichas

Decisões que o dono trouxe em 2026-10-27 depois de decidir as 112 fichas. Cada uma vira
tarefa própria, junto com as fichas; as que mudam regra pedem ADR nova. O
manual descreve o que o sistema faz até a correção sair.

## 1. Fila de Alertas para todos — confirmado, sem mudança

Combinado com o time: todos veem todos os alertas em `/alertas`, de qualquer
setor. Conferido no código (leitura, sem execução): `list_alert_queue_page`,
`count_alert_queue` e `summarize_alert_queue_by_department` (migration `002`)
só exigem usuário ativo; a tela abre em "Todos os setores"; dispensar e
resolver não olham o setor. Os cartões do Painel abrem a fila já filtrada
pelo setor do cartão.

## 2. Sino só com o que é do setor, e alerta resolvido sai do sino

- **Situação:** executado em 2026-10-27, migration `476`, [ADR 0107](../../adr/0107-sino-so-do-setor-responsavel.md), com a exceção do Financeiro nos quatro tipos do dinheiro decidida pelo dono no mesmo dia.
- **Hoje:** `fanout_alert_item` (migration `328`) entrega à audiência do
  catálogo (`alert_type_catalog.audience_departments`), que em 5 dos 50 tipos
  inclui setor que não é o responsável: Revisão de B/L — Portal não
  provisionado (+Administrativo), Consulta de Pix do Itaú parada
  (+Financeiro), PIX sem conciliação segura (+Documentação, +Equipamentos),
  Data da escala pendente e Data de terminal pendente (+Documentação). A
  notificação fica no sino e conta como não lida até a pessoa marcar como
  lida, mesmo com o alerta resolvido (`list_internal_notifications` e
  `count_unread_internal_notifications`, migration `002`, não olham o item).
- **Decidido:** o sino entrega só ao setor responsável pelo item (o
  `alert_items.department`). O alerta resolvido, pela origem ou com
  justificativa, sai do sino e do número sem a pessoa marcar como lido.
  O sino é por setor: o sistema não designa alerta a uma pessoa.
- **Decidido (ok do dono à recomendação):** alerta crítico sem ninguém ativo
  no setor responsável continua indo ao Administrativo (rede de segurança).
- Afeta também a matriz de Admin › Usuários ("Recebe os alertas do próprio
  setor", `src/services/permissionMatrix.ts`) e a tela de Regras dos alertas
  (`src/services/alertRulesCatalog.ts`, `notifiedDepartments`).

## 3. Retirar a dispensa de alerta

- **Situação:** executado em 2026-10-27, migration `476`, [ADR 0108](../../adr/0108-fim-da-dispensa-de-alertas.md).
- **Decidido:** o time concordou que dispensar alerta não é útil e pode ser
  prejudicial. A ação Dispensar sai do sistema.
- **O que sai ou muda:** botão Dispensar e janela em `/alertas`
  (`src/pages/Alertas.tsx`), cartão e lente Dispensados, coluna "Dispensado
  até"; `dismiss_alert_item` (migration `441`) e o Eco de Tratamento da
  dispensa; `dismissed_count` no resumo por setor e o detalhe "N dispensados"
  nos cartões do Painel (`src/pages/Painel.tsx`); o filtro `dismissed` das
  RPCs da fila; o texto "Pode ser dispensado temporariamente…" das 50 regras
  em `alertRulesCatalog.ts`; o tópico de dispensa no manual. O histórico
  (`alert_item_dismissals`) fica guardado. As fichas ALE-D07 (motivo curto
  na dispensa) e a parte de dispensa da ALE-D18 deixam de valer.
- **Decidido (ok do dono às recomendações):** (a) dispensas vigentes no dia
  da mudança acabam e o alerta volta a Ativos na hora; (b) tipos cuja origem
  a equipe não consegue corrigir (saúde de rotina, provedor de e-mail, Pix de
  fora do Vela) seriam abertos para sempre: a tarefa mapeia esses tipos e,
  onde não houver saída, dá a eles "Resolver com justificativa" (o alerta
  reabre se a causa voltar).
- Afeta o ponto 2: sem dispensa, deixa de existir a pergunta de o alerta
  dispensado sair do sino.

## 4. Chave "Envio real de e-mails": desligada redireciona para o suporte

Ferramenta de desenvolvimento e teste; o dono vai retirá-la antes da operação
com Clientes reais.

- **Hoje:** `app_settings.communications_enabled` (migration `002`). Desligada,
  os e-mails que obedecem à chave não saem: a tentativa é gravada como aceita
  e a tela mostra "Em simulação". Obedecem: Comunicados
  (`send-customer-communication`), Régua de Cobrança da Demurrage
  (`demurrage-dunning`), avisos do Desbloqueio de CE (`ce-unlock-notify-email`)
  e e-mails de eventos do Portal (`portal-email-events-runner`). Não obedecem
  e saem sempre: convite do Portal, recuperação e redefinição de senha do
  Portal, troca de e-mail de recuperação e resumo diário do Portal à equipe.
  Quem muda: qualquer usuário do Administrativo (`set_communications_enabled`).
- **Decidido:** a chave vale para todo e-mail dirigido a Cliente, inclusive
  os do Portal (convite, senha, troca de e-mail de recuperação). Ligada,
  envia normalmente. Desligada, o e-mail é enviado de verdade, mas para
  `suporte@portalfwlog.com.br` em vez do Cliente. E-mail para a própria
  equipe (resumo diário do Portal) não passa pela chave.
- **Decidido:** só o dono muda a chave, por uma permissão nova acima do
  Administrativo chamada **Dev**, em que só ele estará; no começo a única
  diferença para o Administrativo é a chave, e outras permissões especiais
  podem entrar depois. Em vez de e-mail fixo por ambiente.
- **Decidido (ok do dono às recomendações):**
  - Dev é uma marca no usuário, que continua no setor Administrativo e faz
    tudo o que ele faz; só o que for exclusivo de Dev olha a marca. A marca é
    dada só por migration, sem tela, e vale igual em produção e staging. Um
    setor novo exigiria revisar cerca de 200 verificações do Administrativo no
    banco e 76 nas telas. A tela de Usuários mostra "Administrativo · Dev".
  - Atribuição (2026-10-27): por migration com a lista de e-mails
    (`lucca.juliatti@fwlog.com.br`, o mesmo em produção e staging); nenhuma
    tela nem usuário logado muda a marca; cada mudança fica no Histórico de
    ações. Detalhe no [plano de correções](../../archive/plans/2026-10-27-correcoes-decididas-pelo-dono.md).
  - O e-mail redirecionado chega ao suporte com o assunto começando por
    "[Teste → <e-mail do Cliente>]" e uma linha no topo dizendo qual Cliente
    receberia.
  - O envio redirecionado conta como enviado na Cobertura, na Régua e nos
    alertas; a tela troca "Em simulação" por "Redirecionado ao suporte".

## 5. Decisões da revisão da PR #1070 (2026-10-27)

A revisão da PR #1070 (relatório em
[`docs/archive/audits/revisao-pr-1070-2026-10-27.md`](../../archive/audits/revisao-pr-1070-2026-10-27.md))
levantou pontos em que o código escolhia sozinho. O dono decidiu cada um no
mesmo dia; todos foram executados nas migrations `482` a `488`.

| # | Ponto | Decisão do dono | Onde ficou |
|---|---|---|---|
| P1 | Outro Administrativo podia redefinir a senha da conta Dev e ligar a chave de envio | Só a própria pessoa troca e-mail e senha da conta com a marca Dev; desativar e trocar o setor seguem com o Administrativo; esquecida a senha, a redefinição é pelo painel do Supabase | `admin-users`, Editar acesso; [ADR 0104](../../adr/0104-marca-dev-e-chave-de-envio-pelo-suporte.md) |
| P2 | ACE-D06 (opção B) foi feita com alcance menor: só falhas de entrega e linhas de Usuário do Histórico ficaram do Administrativo | Vale o alcance da PR: o resto do Histórico e o Prazo do ADR seguem lidos por todos, porque alimentam as telas de Viagem, Line Up, ADR, B/L e Taxas | Migration `475`; [ADR 0106](../../adr/0106-nome-do-autor-no-historico-para-todos.md) |
| P3 | Quatro críticos da Documentação deixaram de avisar o Administrativo (Exceção crítica de fatura do Portal, Caixa sem destinatário, Cliente sem contato principal, Contato com bounce sem alternativa) | Os quatro avisam também o Administrativo, como o Financeiro nos tipos do dinheiro | Migration `485`; [ADR 0107](../../adr/0107-sino-so-do-setor-responsavel.md) |
| P4 | Alerta de origem externa resolvido com justificativa ficava calado sem prazo | Volta 24 horas depois da justificativa se a causa continuar; na rotina agendada, outro tipo de falha reabre na hora | Migration `485`; [ADR 0108](../../adr/0108-fim-da-dispensa-de-alertas.md) |
| P5 | Dois Pix na mesma cobrança: o extrato fechava os dois | O extrato fecha um Pix; o outro vira Restituição "Pix em duplicidade", como na baixa normal | Migration `483`; [Reconciliação Pix](../../modules/reconciliacao-pix.md) |
| P6 | Troca de CNPJ do B/L reemitia a Invoice de Demurrage para Cliente sem gate | Respeita o gate do novo Cliente: retida até o gate abrir, sai recalculada e com aviso | Migration `484`; [Demurrage](../../modules/demurrage.md) |
| P7 | Reemissão por datas da Invoice que o Cliente já via ficava retida com o gate fechado | Reemite mesmo assim (o CE continua exigido); o gate vale para a primeira emissão | Migration `484`; [Demurrage](../../modules/demurrage.md) |
| P8 | VIP: B/L que muda de solicitação; solicitações em andamento na troca da regra | Vale o primeiro envio do B/L, contando a solicitação de onde ele saiu; quem já tinha o anual ligado continua coberto | Migration `487`; [ADR 0110](../../adr/0110-vip-cobre-pela-data-da-solicitacao.md) |
| P9 | Tabela de Taxas Locais usada só por B/L cancelado ou nunca faturado | Continua travada: mudar POD ou modo exige tabela nova | Migration `470` (sem mudança); [Taxas Locais](../../modules/taxas-locais.md) |
| P10 | O Novo cliente gravava contatos para qualquer setor | Só Administrativo, Documentação e Equipamentos criam pelo Novo cliente; os demais trazem o Cliente pela Base e pela Revisão; o Cliente do manifesto pela ficha do B/L segue para todos | Migration `486`; [Segurança](../../operations/seguranca.md) |
| P11 | Atracação TBC com ATB e ATD | TBC não é terminal, é só "terminal a confirmar": o banco recusa ATB, ATD e Restow nela, sempre; ETB e ETD seguem | Migration `482`; [ADR 0109](../../adr/0109-frente-de-operacao-exige-terminal-ate-o-ata.md) |
| P12 | Onde corrigir | Direto na branch da PR #1070 | Commits da PR |
