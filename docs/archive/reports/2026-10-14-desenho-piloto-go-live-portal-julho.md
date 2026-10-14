# 2026-10-14 — Desenho de piloto e GO LIVE do Portal (julho de 2026)

> **Origem:** cópia fiel da seção retirada de `docs/modules/portal-cliente.md` em 2026-10-14, quando o dono arquivou o desenho ([ADR 0083](../../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 20); os links relativos são os do módulo e não descrevem regra vigente.

### Piloto e abertura do Portal (procedimento não executado — decisão pendente D9-11)

**Decisão pendente (D9-11):** o desenho de piloto e GO LIVE abaixo, de julho
de 2026, nunca foi executado e não tem plano vivo; falta o dono decidir se ele
continua valendo quando o Portal abrir a clientes reais. Registrada no
[plano da revisão](../archive/plans/2026-10-13-revisao-geral-documentacao.md). Até a
decisão, o texto preserva o procedimento registrado; não é regra vigente. Saiu
do glossário na revisão de 2026-10-13.

- **Sequência de GO LIVE:** deploy sem disparos reais; pré-voo e reconciliação
  dos Clientes existentes; configuração e verificação de domínio, Resend e
  webhooks; ativação de alertas e suporte; piloto; aprovação final do
  Administrativo; abertura geral. Convites reais só depois das quatro
  primeiras etapas técnicas e operacionais.
- **Checklist de prontidão (antes do primeiro convite real):** o
  Administrativo aprova domínio/DNS verificado, Resend e webhooks
  configurados, backfill concluído, console e alertas operacionais, lista de
  clientes aprovada e canal de suporte monitorado.
- **Governança:** o Administrativo tem a aprovação final para iniciar e
  encerrar o piloto; a Documentação executa o provisionamento cotidiano dos
  clientes selecionados.
- **Lista de clientes-piloto:** cerca de dez clientes representativos,
  preparada pela Documentação e aprovada pelo Administrativo; prioriza
  atividade real, email validável e diversidade de casos. Cliente sem email
  não recebe disparo real e fica só na fila operacional.
- **Atendimento:** a Documentação é o primeiro nível e acompanha convites,
  ativações, expirações e pendências; o Administrativo trata exceções,
  incidentes de segurança e decisões de encerramento do piloto.
- **Métricas (acompanhamento diário):** clientes selecionados, convites
  enviados e entregues, ativações, expirações, bounces, tempo até ativação e
  pendências de atendimento.
- **Janela:** sem prazo fixo; o piloto fica aberto, com acompanhamento diário,
  até cumprir o critério de saída, e não há abertura geral enquanto houver
  cliente pendente.
- **Critério de saída:** cada cliente selecionado Ativo ou com a exceção
  formal "Provisionamento não necessário no momento", sem incidente crítico
  pendente e com autorização final do Administrativo para avançar.
- **Gates de teste do piloto** (qualquer falha bloqueia a aprovação):
  - *replay de token:* tentar reutilizar token consumido, expirado,
    invalidado por reenvio ou inválido; o segundo uso falha sem revelar
    informação;
  - *anti-enumeração e abuso:* resposta genérica para CNPJ inexistente ou
    senha incorreta; bloqueio por 15 minutos após cinco falhas em 15 minutos;
    recuperação sem confirmar a existência da conta; alerta ao Administrativo
    em abuso recorrente;
  - *recuperação assistida e troca de email:* senha atual, confirmação do novo
    endereço, email antigo mantido até a confirmação, validação manual com
    justificativa e auditoria quando a equipe intervém, operador sem acesso à
    senha final; falha deixa o cadastro inalterado e chamada não autorizada é
    negada;
  - *logs e auditoria:* logs de aplicação, navegador, rede e auditoria não
    expõem senha, token bruto, `service_role`, chave da Resend nem email
    completo;
  - *assinatura e replay de webhook:* assinatura inválida e timestamp fora da
    janela são rejeitados; repetição válida pode receber sucesso como no-op (ou
    ficar pendente de processamento), sem duplicar efeitos de entrega, bounce
    ou complaint;
  - *isolamento por CNPJ:* tentar acessar e alterar, por chamadas diretas à
    API, dados de outro Cliente/CNPJ; RLS, RPCs e Edge Functions devem negar,
    porque ocultar a ação na interface não basta.
- **Evidência de testes:** registro dos testes automatizados e manuais
  executados antes do piloto, com data, versão, ambiente e resultado; o piloto
  só começa sem falha crítica pendente.
- **Gate de upgrade:** antes da abertura geral, o Administrativo revisa
  métricas do piloto, cotas, necessidade de backups e previsão de emails e
  decide formalmente se o ambiente migra para Supabase Pro e/ou Resend Pro.
- **Rollback escalonado:** em incidente operacional, novos convites são
  pausados sem apagar histórico; em incidente de segurança, as sessões são
  revogadas e as contas afetadas podem ser suspensas. A retomada depende de
  decisão do Administrativo.
- **Abertura geral gradual:** a aprovação do GO LIVE não dispara convites em
  massa; cada Cliente fica em Aguardando análise até a revisão individual da
  Documentação ou do Administrativo, que escolhe o Email de Recuperação e
  envia o convite.
- **Monitoramento pós-abertura:** a Documentação acompanha fila e métricas
  diariamente; os alertas críticos continuam imediatos para o Administrativo,
  que pode pausar convites ou executar o rollback escalonado.

Estado registrado em outros documentos (não resolve a decisão): o backfill
rodou em produção em 2026-07-14 e o teste de isolamento por CNPJ contra
produção foi registrado depois da correção das guardas
([Console](#console-clientesportal)); o domínio `portalfwlog.com.br` está
verificado no Resend desde 2026-09-24, com webhook configurado e um convite
real entregue na caixa de entrada
([serviços externos](../operations/servicos-externos.md#resend-envio)). O
desenho cita passos que já não existem: o pré-voo (removido com o backfill),
a exceção "Provisionamento não necessário no momento" (retirada pelo
Bloco #521) e o email imediato de alerta crítico (decisão pendente D9-05).
