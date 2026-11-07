# Plano: Administração revisada

Estado: **executado e arquivado em 2026-11-06**, as cinco etapas na branch
`claude/sleepy-babbage-5wot7m` (migrations `603` a `605` e a Edge Function
`admin-test-email`). Regra vigente em
[Operação e suporte § `/admin`](../../modules/operacao-suporte.md#admin), em
[Clientes § Chave de envio](../../modules/clientes.md#chave-de-envio-de-comunicados) e em
[Viagens § Prazo de Conclusão do ADR](../../modules/viagens.md#prazo-de-conclusão-do-adr);
o Manual do Operador está no capítulo 25.

Origem: pedido do dono de 2026-11-06 e o
[diagnóstico da Administração](../audits/administracao-2026-11-06.md). A
proposta com as telas desenhadas foi apresentada ao dono e aprovada com as
recomendações abaixo; no mesmo dia o dono pediu a execução de todas as etapas.

## Decisões do dono (2026-11-06)

1. **Abas.** A Administração fica com Usuários, Histórico de ações e Sistema.
   Usuários não muda.
2. **Sistema é só da conta Dev** (Administrativo com a marca Dev,
   [ADR 0104](../../adr/0104-marca-dev-e-chave-de-envio-pelo-suporte.md)), para ver
   e para mexer. Os demais do Administrativo veem só Usuários e Histórico de
   ações. Toda leitura sensível da aba é barrada no banco por `is_dev_user()`.
3. **Falhas de entrega de alertas** deixa de ser aba e vira bloco de Sistema,
   com "equipe sem pessoa ativa" nos Pontos de atenção.
4. **Envio real** sai de Clientes › Comunicação e vai para Sistema ›
   Configurações; continua só da conta Dev. A confirmação de cada envio continua
   dizendo se é envio real.
5. **Prazo do ADR** vira a quinta visão de Relatórios, visível só ao
   Administrativo, com Exportar planilha.
6. **Histórico de ações**: uma linha por ação; parar de gravar as colunas
   técnicas e a segunda cópia da mesma mudança daqui para a frente. Nenhuma
   linha já gravada é apagada nem reescrita.
7. **Sugestões que entram:** e-mail de teste do Envio real, rotinas automáticas
   visíveis e "equipe sem pessoa ativa". As demais (rodar rotina agora, conta das
   rotinas pela tela, calendário de feriados, aviso para a equipe, último acesso,
   e-mails bloqueados numa lista, vencimento do Pix) ficaram fora deste plano e
   não foram feitas; cada uma depende de um pedido novo do dono.

## Etapas e o que foi feito

1. **Ajustes rápidos no Histórico e abas da conta Dev.** Quando com segundos;
   rodapé "de mais de 10.000" quando a contagem para no teto, com Próxima
   enquanto a página vier cheia (`TableFooterPagination`, `countIsFloor`);
   motivos técnicos traduzidos na leitura e textos padrão do sistema fora da
   tela (`src/lib/auditReasons.ts`, também no Histórico do B/L); nomes para os
   campos e situações que viravam "B/L alterado" ou código cru.
2. **Histórico com uma linha por ação** (migration `603`). `admin_action_history_actions`
   agrupa pelo par (`changed_at`, `changed_by`) e conta ações; a linha aberta
   traz o resumo e o campo a campo (`admin_action_history` com `p_action_key`);
   Busca, Período rápido (padrão 30 dias), Assunto por área e Exportar planilha.
3. **Gravar menos ruído** (migration `604`). `audit_row_changes` não grava mais
   as colunas técnicas. **Diferente do planejado:** (a) a tabela `voyages` ficou
   de fora, porque os gatilhos de `audit_logs` reconciliam os alertas da Viagem a
   cada linha dela, e o retrato das escalas é o sinal que fecha "B/Ls esperados"
   (`alertasFechamNaHora.local-pg.test.ts` falhou com a primeira versão); (b) a
   segunda cópia da mesma mudança sai na leitura (603), pela mesma regra do
   Histórico do B/L, em vez de `vela.audit_skip` em cada função — a função grava
   a linha dela depois do `UPDATE`, quando a do gatilho já existe, e o histórico
   não se altera nem se apaga.
4. **Nova aba Sistema** (migration `605`, Edge Function `admin-test-email`).
   Pontos de atenção, Rotinas automáticas, Configurações (Envio real com
   **Enviar teste para mim**), Falhas de entrega de alertas, Versão e Ambiente;
   o bloco Canal de envio saiu de Clientes › Comunicação; a confirmação de
   **Desativar** avisa quando a pessoa é a última ativa da equipe.
5. **Prazo do ADR em Relatórios.** Visão `prazo-do-adr` em `/relatorios`, só
   para o Administrativo, com Exportar planilha; `/admin/prazo-do-adr` e
   `/admin/prazo-adr` redirecionam.

## Não verificado

- Login real no navegador e as telas em staging ou produção: a prova é de testes
  de tela, suítes no Postgres 16 local e o `deno check`/`deno test` da função.
- O envio do e-mail de teste pelo provedor: a função só sai no próximo merge em
  `main` ([Serviços externos](../../operations/servicos-externos.md#edge-functions)).
- O custo da leitura por ação com o histórico de produção inteiro (período
  **Tudo**): medido só no banco local; a tela abre em 30 dias.
