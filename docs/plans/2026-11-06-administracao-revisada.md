# Plano: Administração revisada

Estado: em execução. Etapa 1 entregue em 2026-11-06; etapas 2 a 5 pendentes.

Origem: pedido do dono de 2026-11-06 e o
[diagnóstico da Administração](../archive/audits/administracao-2026-11-06.md).
A proposta com as telas desenhadas foi apresentada ao dono e aprovada com as
recomendações abaixo.

## Decisões do dono (2026-11-06)

1. **Abas.** A Administração fica com Usuários, Histórico de ações e Sistema.
   Usuários não muda.
2. **Sistema é só da conta Dev** (Administrativo com a marca Dev,
   [ADR 0104](../adr/0104-marca-dev-e-chave-de-envio-pelo-suporte.md)), para ver
   e para mexer. Os demais do Administrativo veem só Usuários e Histórico de
   ações. Toda leitura ou escrita sensível que a aba ganhar é barrada no banco
   por `is_dev_user()`; esconder a aba é só navegação.
3. **Falhas de entrega de alertas** deixa de ser aba e vira item de
   **Pontos de atenção** dentro de Sistema, junto com "equipe sem pessoa ativa".
4. **Envio real** sai de Clientes › Comunicação e vai para Sistema ›
   Configurações; continua só da conta Dev. A confirmação de cada envio continua
   dizendo se é envio real.
5. **Prazo do ADR** vira a quinta visão de Relatórios, visível só ao
   Administrativo, como hoje, com Exportar planilha.
6. **Histórico de ações**: uma linha por ação; parar de gravar as colunas
   técnicas e a segunda cópia da mesma mudança daqui para a frente. Nenhuma
   linha já gravada é apagada nem reescrita.
7. **Sugestões que entram:** e-mail de teste do Envio real, rotinas automáticas
   visíveis e "equipe sem pessoa ativa". As demais (rodar rotina agora, conta das
   rotinas, calendário de feriados, aviso para a equipe, último acesso,
   e-mails bloqueados, vencimento do Pix) ficam para depois, uma a uma.

## Etapas

1. **Ajustes rápidos no Histórico e abas da conta Dev — entregue (2026-11-06).**
   Quando com segundos; rodapé "de mais de 10.000" quando a contagem para no
   teto, sem "Página X de 200", e Próxima segue enquanto a página vier cheia;
   motivos técnicos traduzidos na leitura e textos padrão do sistema fora da
   tela (`src/lib/auditReasons.ts`, também no Histórico do B/L); nomes para os
   campos e situações que viravam "B/L alterado" ou código cru. Sistema e Falhas
   de entrega de alertas só para a conta Dev (`src/pages/adminTabs.ts`). Sem
   mudança no banco.
2. **Histórico com uma linha por ação.** `admin_action_history` passa a agrupar
   pelo par (`changed_at`, `changed_by`) e a contar ações; a linha aberta traz o
   resumo ("17 B/Ls criados, 781 containers") e o campo a campo. Busca por B/L,
   navio, container ou Cliente; período rápido (Hoje, 7 dias, 30 dias); Assunto
   agrupado por área; Exportar planilha. Migration só de leitura.
3. **Gravar menos ruído.** `audit_row_changes` deixa de gravar as colunas
   técnicas; as funções que gravam a linha semântica pulam a linha do gatilho
   (`vela.audit_skip`). Só daqui para a frente: sem plano de preservação, porque
   nenhuma linha existente muda.
4. **Nova aba Sistema.** Pontos de atenção (alerta sem destinatário, equipe sem
   pessoa ativa, rotina com falha, leitura do Pix parada, e-mail bloqueado,
   feriados do ano seguinte), Rotinas automáticas (as 21 de `cron.job`, por RPC
   com `is_dev_user()`), Configurações (Envio real com o e-mail de teste,
   intervalo da Régua de cobrança, conta das rotinas, Pix Itaú e feriados, em
   leitura onde ainda não há tela). A aba Falhas de entrega de alertas sai, e o
   endereço antigo abre Sistema. O bloco Canal de envio sai de Clientes ›
   Comunicação.
5. **Prazo do ADR em Relatórios.** Visão `prazo-do-adr` em `/relatorios`, só
   para o Administrativo, com Exportar planilha; `/admin/prazo-do-adr` passa a
   abrir Relatórios.

Cada etapa atualiza o Manual do Operador (capítulo 25), a
[RASTREABILIDADE](../RASTREABILIDADE.md) e
[Operação e suporte § `/admin`](../modules/operacao-suporte.md#admin).
