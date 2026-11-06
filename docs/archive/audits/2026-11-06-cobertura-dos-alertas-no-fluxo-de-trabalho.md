# Cobertura dos alertas no fluxo de trabalho do Vela — 2026-11-06

Revisão pedida pelo dono em 2026-11-06, depois da brecha dos veículos
([ADR 0128](../../adr/0128-ce-mercante-travado-ate-resposta-de-veiculos.md)):
Equipamentos tinha de dizer se a Viagem teria veículos, e sem isso a
Documentação vinculava o CE Mercante cedo demais e o Cliente era faturado
errado. A pergunta desta revisão é a mesma, feita para o Vela inteiro: **para
cada ação que depende de uma pessoa, o alerta avisa a equipe certa a tempo de
cumprir o prazo? E, onde avisar não basta, o sistema garante a ordem?**

É registro datado: diz o que estava no código e no banco local naquele
checkout. A regra viva dos alertas continua em
[Operação e Suporte § Alertas](../../modules/operacao-suporte.md#alertas-e-notificações-internas)
e no [capítulo 20 do Manual do Operador](../../manual/texto/20-alertas.md). A
revisão técnica anterior, de abertura e fechamento dos alertas, é a de
[2026-10-21](../../revisao-alertas-2026-10.md); esta não a refaz.

- **Base:** `staging` em `24e5168` (migrations até `602`) e o replay da cadeia
  ativa num Postgres 16 local descartável (`scripts/setup-local-pg.sh`), lido
  com `pg_get_functiondef`. Produção e staging não foram consultadas.
- **Rótulos de evidência** como em [CONVENCOES.md](../../CONVENCOES.md):
  **Código** (leitura estática da definição vigente). As brechas marcadas com ✔
  foram conferidas de novo, à mão, no banco local; as demais vêm da leitura das
  quatro frentes desta revisão (Desbloqueio e Comunicados, Equipamentos e
  Demurrage, Operações e ADR, Documentação e faturamento), com o arquivo e a
  migration citados. Nenhum cenário foi executado contra produção, e nenhum
  fluxo de usuário foi exercitado de ponta a ponta para as brechas.
- **Junto com esta revisão** foi entregue a tela **Regras de alertas**
  didática, com a troca de gravidade pelo Administrativo
  ([ADR 0130](../../adr/0130-gravidade-do-alerta-pela-tela.md), migration
  `603`). Algumas brechas de gravidade abaixo já podem ser ajustadas por ela,
  sem código.

## Resumo

**O padrão dos veículos se repete.** Em quatro formas:

| Forma | O que é | Quantas |
|---|---|---|
| **Sem alerta** | Uma ação com prazo que ninguém cobra: o prazo passa e só quem abre a tela certa percebe | 15 |
| **Ordem não garantida** | O sistema deixa fazer antes da hora, e o erro chega ao Cliente (o caso dos veículos) | 3 |
| **Avisa quem não pode agir** | O alerta chega a uma equipe que não tem permissão para a correção | 4 |
| **Não escala** | O alerta existe, mas avisa uma vez, fica Normal e afunda na fila | 4 |

**As dez mais graves**, pelo que custam ao Cliente ou à receita:

| # | Brecha | O que acontece na prática | Risco |
|---|---|---|---|
| B01 ✔ | Prazo do Desbloqueio de CE sem nenhum aviso interno | O Cliente recebe "Prazo para desbloqueio até 17:00"; a equipe não recebe alerta, sino nem e-mail, antes nem depois de vencer | Alto |
| B05 ✔ | Data de descarga não registrada | O grupo de containers some da página Demurrage e nunca é cobrado; nenhum alerta | Alto |
| B08 ✔ | ATD esquecido | Os alertas do ADR de Saída e da exportação nunca abrem e a Viagem não conclui; só sobra um alerta Normal | Alto |
| B16 | CE vinculado sem Baplie | A fatura sai sem as marcas do Baplie; quando ele chega, a fatura é refeita (ou vira Fatura Avulsa, se paga) | Alto |
| B17 | CE com B/L faltando no container ou divergência Baplie × B/L | A fatura sai; o B/L que chega depois refaz a divisão e a fatura de quem já foi cobrado | Alto |
| B07 | Fatura cancelada à mão (Taxas Locais e Demurrage) | Nada emite de novo sozinho, e nenhum alerta lembra: o Cliente fica sem fatura | Alto |
| B13 | B/L que chega depois do CE e Taxas enviado | O CE e o valor desse B/L nunca vão por e-mail; nenhum alerta (o manual admite) | Alto |
| B11 ✔ | Viagem sem ETA no Brasil | Nenhum alerta de prazo abre (D−7, D−5, NOA, B/L sem Cliente); tirar o ETA fecha em silêncio os que estavam abertos | Médio |
| B10 | Exportação sem dono antes do ATD | Ninguém é lembrado antes da saída; depois, o alerta vai a Operações, e o ADR pode fechar com "Nada a declarar" sem a exportação | Médio |
| B19 ✔ | Alerta de PTAX vai à Documentação | Quem usa **Informar PTAX** é Financeiro, Equipamentos ou Administrativo; a Documentação recebe e não pode agir, com 30 minutos até o Pix da Demurrage virar | Médio |

**O que está bem coberto** está em [O que já está bem coberto](#o-que-já-está-bem-coberto).
As propostas estão junto de cada brecha e consolidadas em
[Alertas e travas propostos](#alertas-e-travas-propostos); as escolhas que
cabem ao dono, em [Decisões pendentes](#decisões-pendentes).

## O mapa: etapa por etapa

As etapas são as do [guia da Viagem](../../manual/guias/viagem/) do Manual do
Operador, mais o Desbloqueio de CE, a Demurrage e o dinheiro. D−7 e D−5 contam
do primeiro ETA no Brasil.

| Etapa | Quem faz | Até quando | O que depende disso | Alerta hoje | Veredito |
|---|---|---|---|---|---|
| 1. Abrir a Viagem (programação) | Documentação | Antes de tudo; o ETA dirige os prazos | Todos os alertas de prazo | Nenhum para Viagem sem ETA | Brecha B11; ETA mudado depois do NOA, B26 |
| 2. Terminais das frentes | Operações | Antes do NOB, do ADR e do EDI | NOB, ADR, EDI Mercante | **Escala sem terminal**, crítico, D−5 do ETA da escala | Coberto; ver B25 para a 2ª escala |
| 3. Baplie | Documentação | Antes dos B/Ls e do CE | Marcas IMO/OOG nas Taxas Locais; conferência dos containers | **Baplie ausente**, crítico, D−7 | Avisa, mas não trava o CE: B16 |
| 4. Vazios de importação | Documentação | Antes do D−5 | CE pendente da Viagem | Rota sem Nº de manifesto entra no **CE Mercante pendente** | Coberto |
| 5. B/Ls | Documentação | D−7 | Cliente, CE, fatura, avisos | **B/L esperado pendente**, crítico, D−7; **Cobertura Baplie / B/L** | Coberto por rota; B/L faltando em container já coberto é invisível: B17 |
| 6. Carga solta | Documentação | Antes do CE | Cobrança pelo peso | **Revisão — peso BB ausente**, crítico | Coberto; a fatura espera sozinha |
| 7. Veículos | Equipamentos | D−7 resposta; D−5 planilha | CE dos B/Ls de container | **Declaração** (Normal, D−7) e **Planilha de Veículos ausente** (crítico, D−5), com trava do CE | Coberto desde a ADR 0128; restos em B18 |
| 8. Revisão | Documentação | Antes do CE | Fatura, avisos, Portal | Revisão (três, críticos) e **B/L sem Cliente perto do ETA** | Coberto; a fatura espera sozinha |
| 9. Portal do Cliente | Documentação (convite); Cliente (ativação) | Antes do CE | Fatura retida sem Portal pronto | **Revisão — Portal não provisionado**, crítico; pendências do Portal, Normais | Coberto, mas não escala com o ETA e a saída (Liberação) é do Administrativo: B15, B21 |
| 10–11. CE Mercante | Documentação | D−5 | Fatura, Portal, CE e Taxas, Desbloqueio | **CE Mercante pendente**, crítico, D−5, um aviso | Trava só pelos veículos: B16, B17; não escala: B23 |
| 12. Avisos ao Cliente | Sistema; Documentação trata o que travou | NOA até o ETA; NOR/NOB até 30 dias | Cliente informado | NOA/NOR/NOB pendentes, recusado, sem destinatário | NOA perdido fecha em silêncio: B12; CE e Taxas de B/L tardio: B13 |
| 13. ATA, ATB, ATD | Operações | No dia | NOR, NOB, ADR (72 h do ATD), exportação, conclusão da Viagem | **Data da escala** e **Data de terminal pendente**, Normais | Não escala; ATD esquecido desliga o ADR: B08 |
| 14. Desbloqueio de CE | Documentação | 17h do dia ou 12h do dia útil seguinte, do último requisito | Retirada da carga | Nenhum para o prazo; sino só na solicitação nova | B01, B02, B03, B04, B22 |
| 15. Descarga e devolução | Equipamentos (na rotina) | Logo depois da operação | Demurrage | Nenhum para a descarga; devolução só no cartão **Correndo (US$)** | B05, B06 |
| 16. Exportação | Equipamentos (na rotina) | Antes do ADR | ADR de Saída, serviços cobrados | **Exportação pendente pós-ATD**, Normal, a Operações, só depois do ATD | B10, B20 |
| 17. ADR de Saída | Cada equipe assina; qualquer uma fecha | 72 h do ATD | Retrato que o Financeiro usa para aprovar pagamentos | **ADR — departamento pendente** e **prazo vencido** (crítico) | Fechar não tem dono nem prazo: B09 |
| Demurrage (Invoice e Disputa) | Equipamentos | 1 dia útil na Disputa | Cobrança | Disputa, prazo da Disputa, Demurrage travada, cobrança recusada | Coberto; Invoice cancelada à mão: B07; rotinas: B14 |
| Pix e restituição | Financeiro | Sem prazo definido | Fatura paga, Desbloqueio | **PIX sem conciliação segura** (crítico), **Restituição pendente** (Normal) | Roteamento certo; não escala: B23 |

## Brechas

Cada brecha diz o fato, a evidência, um exemplo (simulação, não caso
observado) e a proposta. "Decisão" marca o que só o dono escolhe.

### Sem alerta: prazo que ninguém cobra

**B01 ✔ — Prazo do Desbloqueio de CE.** Risco alto.
- **Fato.** Quando os quatro requisitos se cumprem, o Cliente recebe no Portal e
  por e-mail "Prazo para desbloqueio até dd/mm, HH:MM". A equipe não recebe
  alerta, sino nem e-mail, nem antes nem depois de vencer. O prazo só aparece na
  tela **Desbloqueio de CE** ("Hoje, HH:MM" em âmbar, "Venceu …" em vermelho), e
  a lista é ordenada por B/L, não por prazo. O caso mais arriscado é o último
  requisito acontecer fora da tela: o Pix baixado pela consulta do Itaú, ou o
  B/L do VIP validado pela rotina de 5 minutos.
- **Evidência (Código).** O catálogo não tem tipo de alerta para o prazo; as
  nove conferências de `run_alert_detectors` (migration `352`) e as rotinas do
  `pg_cron` não olham o Desbloqueio. Os únicos produtores de alerta do módulo
  são `_set_bl_ce_mercante` (CE trocado depois do desbloqueio) e
  `ce_unlock_email_finish` (aviso não enviado). `ce_unlock_private.notify`
  (`466`) e `validate_direct` (`581`) só escrevem para o Cliente. Regra do prazo
  em [Desbloqueio de CE § Prazo (SLA)](../../modules/desbloqueio-ce.md#prazo-sla).
- **Exemplo.** Terça, 10h40, o Pix das Taxas Locais é baixado pelo Itaú; o
  termo, a procuração e o original já estavam ok. O Cliente recebe "até 17:00
  de hoje". Ninguém da Documentação abre a tela à tarde: o B/L sai como
  "Exportado fora do prazo" no dia seguinte.
- **Proposta.** Alerta **Desbloqueio de CE perto do prazo** (Documentação),
  aberto na hora em que o prazo começa, com o horário na mensagem, e que passa
  a crítico quando faltar pouco (por exemplo, 2 horas) e no vencimento. Fecha
  na exportação para a ZPT. **Decisão:** antecedência e se o Administrativo
  também recebe.

**B02 — Solicitação de desbloqueio parada na análise.** Risco médio.
- **Fato.** O aviso **Nova solicitação de desbloqueio de CE** vai só à
  Documentação, só no envio, e fica no sino até a pessoa ler; não volta e não
  tem desvio para o Administrativo, que também gere o Desbloqueio. Depois de
  lido, a solicitação pode ficar dias sem análise sem nenhum sinal; o tempo de
  análise não entra no prazo (o prazo só começa com os quatro requisitos).
- **Evidência (Código).** `_notify_ce_unlock_submitted` (`595`, `599`); prazo
  pela migration `448` ([ADR 0101](../../adr/0101-desbloqueio-ce-prazo-e-vigencia-anual.md)).
- **Proposta.** Alerta **Solicitação aguardando análise** (Documentação, com
  desvio ao Administrativo) depois de N horas úteis com documento a analisar.

**B03 — Exportado para a ZPT e nunca conciliado.** Risco médio.
- **Fato.** A conciliação com a ZPT é uma importação manual. Nada lembra quem
  exportou e não conciliou, nem o B/L **Divergente**. E o alerta **CE trocado
  depois do Desbloqueio conferido** só existe se a conciliação foi feita: sem
  ela, um CE trocado depois do desbloqueio na ZPT não abre nada.
- **Evidência (Código).** `ce_unlock_reconcile` (`575`) só grava
  `ce_unlock_zpt_status`; `_bl_ce_unlock_conferred` (`277`).
- **Proposta.** Alerta **Desbloqueio sem conciliação** depois de 1 dia útil da
  exportação, e alerta para **Divergente na ZPT**.

**B04 — Documentos anuais do VIP.** Risco baixo. O anual enviado pelo Portal não
avisa ninguém, e todo anual vence em 31/12 sem aviso. Proposta: sino no envio do
anual e alerta em dezembro para VIP sem o anual do ano seguinte.

**B05 ✔ — Data de descarga não registrada.** Risco alto.
- **Fato.** A descarga não vem de arquivo do armador: alguém importa a planilha
  do terminal (na rotina, Equipamentos). Sem ela, o container fica para sempre
  no free time. O grupo em que nenhum container tem descarga não cai em
  nenhuma divisão da Demurrage: some da página, não gera Invoice nem alerta. Se
  só um container falta, o grupo inteiro espera. A devolução não pode ser
  gravada sem a descarga. O Cliente vê "Sem descarga" no Portal.
- **Evidência (Código).** Na leitura da Demurrage (migration `593`), o estado
  `no_discharge` não liga `has_overstay`, `has_running` nem `has_to_issue`; a
  divisão fica nula e o grupo sai pelo filtro `division IS NOT NULL`. Nenhum
  tipo do catálogo nem conferência lê a descarga. A [ADR 0078](../../adr/0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md),
  item 19, tirou a cópia automática do ATA para a descarga.
- **Exemplo.** Viagem com ATD em 01/11; ninguém importa a planilha do terminal.
  Em 30/11 os containers continuam "no free time" e a sobreestadia de um mês não
  foi cobrada; nada aparece em lugar nenhum do Vela interno.
- **Proposta.** Alerta **Container sem descarga** (Equipamentos): N dias depois
  do ATB do terminal, containers de B/L da escala sem data de descarga; crítico
  depois de M dias. Fecha quando a data entra. **Decisão:** N e M.

**B06 — Devolução não registrada.** Risco baixo. Só o cartão **Correndo (US$)**
mostra. O Vela não distingue "não devolveu" de "devolveu e ninguém gravou";
gravada tarde, a Invoice sai com a data certa. Sem proposta urgente; um alerta
para container correndo há mais de N dias ajudaria a cobrar o Cliente.

**B07 — Fatura cancelada à mão fica sem nova fatura.** Risco alto.
- **Fato.** Cancelar a fatura de Taxas Locais devolve o B/L a não faturado, e
  "nada emite aquele B/L sozinho, nem o CE, nem a ativação do Portal, nem a
  Liberação: a nova fatura sai só pelo **Emitir**"
  ([manual 18.9](../../manual/texto/18-o-que-muda-sozinho.md)). Na Demurrage, a
  Invoice cancelada à mão espera **Gerar Invoice** e a fila de 15 minutos a
  pula. Nenhum alerta lembra nos dois casos; o número de Taxas Locais no menu
  conta só a revisão.
- **Evidência (Código).** `_cancel_invoice_core` e `cancel_demurrage_invoice`
  (`573`); a fila da Demurrage pula `cancelled_doc` (`531`).
- **Proposta.** Alerta **B/L sem fatura depois do cancelamento** (Documentação)
  e **Demurrage a gerar de novo** (Equipamentos), 1 dia depois do cancelamento
  sem nova emissão; fecham na emissão.

**B08 ✔ — ATD esquecido desliga a cadeia do ADR.** Risco alto.
- **Fato.** Os dois alertas do ADR exigem o ATD do terminal; sem ele, nunca
  abrem. A exportação pós-ATD também não abre, e a Viagem não conclui (segue no
  Portal e no site como ativa e "Atracada" no Line-Up). O único sinal é a **Data
  de terminal pendente** ("ETD passou sem ATD"), Normal, que avisa uma vez e
  afunda na fila. Quando o ATD entra atrasado, as 72 horas das outras equipes
  já estão comidas, e o crítico do prazo cai sobre elas, não sobre Operações.
  O ATB também pode ser gravado sem o ATA: o NOB sai e o NOR, não.
- **Evidência (Código).** `reconcile_agency_report_alerts`: as duas
  elegibilidades exigem `v_atd IS NOT NULL` (definição vigente da `574`).
- **Proposta.** Escalonar a data pendente: **ATD pendente** vira crítico 24 h
  depois do ETD, e o ATA, 24 h depois do ETA. Exigir o ATA para gravar o ATB.
  **Decisão:** prazo e se outras equipes são avisadas.

**B09 — Fechar o ADR não tem dono nem prazo.** Risco médio. Com as três
assinaturas, todos os alertas do ADR fecham, e fechar fica sem prazo ("ato sem
dono", [ADR 0039](../../adr/0039-prazo-de-conclusao-do-adr-medido-por-departamento.md)).
O fechamento congela o retrato que o Financeiro usa para aprovar pagamentos de
faturas ([Viagens § ADR](../../modules/viagens.md#agency-departure-report-adr)),
e um ADR assinado e não fechado também não aparece em **Prazo do ADR**.
Proposta: alerta **ADR assinado e não fechado** 24 h depois da terceira
assinatura. **Decisão:** de quem é o fechamento.

**B10 — Exportação sem dono antes do ATD.** Risco médio.
- **Fato.** Nada lembra de lançar a exportação declarada antes da saída; o
  alerta só abre no ATD de qualquer terminal do porto, vai a Operações (B20) e
  confere pela Viagem, não pelo porto. As seções **Carga carregada** e
  **Embarque de vazios** aceitam **Nada a declarar** sem conferir a exportação
  declarada na escala, e fechar o ADR não confere; depois de fechado, o
  embarque e as linhas de serviço ficam travados até reabrir.
- **Evidência (Código).** `reconcile_voyage_export_after_atd_alerts` (`346`); a
  assinatura (`573`) não lê a exportação.
- **Proposta.** Exportação a Equipamentos (B20); recusar **Nada a declarar** e
  **Fechar ADR** na escala com exportação declarada e nada lançado, como a
  trava dos veículos; conferir por porto.

**B11 ✔ — Viagem sem ETA no Brasil.** Risco médio. Sem o primeiro ETA
brasileiro, todo alerta de prazo fecha e não abre (B/L esperado, Baplie, CE,
veículos, B/L sem Cliente; a escala sem ETA também fica sem NOA e sem **Escala
sem terminal**). Tirar o ETA fecha em silêncio os que estavam abertos, e o sino
os apaga. A importação de B/L pode criar escala sem ETA. Nenhum tipo cobre
"Viagem sem ETA". Evidência: `reconcile_voyage_bl_expected_alerts` resolve
quando `get_voyage_first_brazilian_eta` é nulo (`346`), e os demais seguem o
mesmo padrão. Proposta: alerta **Viagem sem ETA** (Documentação) para Viagem
ativa com B/L e sem ETA no Brasil.

**B12 ✔ — NOA perdido fecha em silêncio.** Risco médio. Quando o ETA chega sem
o NOA a algum Cliente, a janela vence, o alerta **Comunicado NOA pendente**
fecha sozinho e a Cobertura mostra **Não devido**: nada registra que o aviso
não saiu. Evidência: `detect_customer_communication_alerts` fecha "o que não é
mais alvo: entregue a todos, janela vencida, escala…". Proposta: na janela
vencida, abrir **NOA não enviado** (Normal, Documentação, fecha com
justificativa), para o fato ficar visível.

**B13 — B/L que chega depois do CE e Taxas.** Risco alto. O Cliente que já
recebeu o CE e Taxas e ganha na Viagem um B/L novo não recebe outro: quando o
B/L fica pronto, "o Vela não manda outro CE e Taxas e nenhum alerta abre"
([manual 16.3](../../manual/texto/16-emails-e-comunicados.md)). O alerta
**Reenviar Comunicado de CE e Taxas** só abre quando um CE é trocado ou
removido. Proposta: abrir o mesmo alerta quando um B/L do Cliente fica pronto
depois do envio; fecha no reenvio.

**B14 — Rotinas internas que falham em silêncio.** Risco médio. A situação da
Demurrage (00h17), a Demurrage travada e A emitir (15 min), o prazo da Disputa
(15 min), a Liberação vencida (00h13) e os próprios vigias (`http-job-failures`,
`import-effects-queue-health`, `itau-pix-checkpoint-health`) são rotinas só de
banco: **Rotina agendada com resposta de erro** lê as chamadas HTTP, não elas.
É a sugestão S1 da revisão de 2026-10-21, ainda aberta. O manual
([19.9](../../manual/texto/19-rotinas-por-horario.md)) já avisa. Proposta: alerta
**Rotina interna sem rodar**, que lê o histórico de execuções do agendador, e um
heartbeat externo do vigia.

**B15 — Liberação de faturamento vence sem aviso antes.** Risco médio. O manual
pede ação "antes de vencer", mas não há aviso prévio; no vencimento, os B/Ls
voltam à Revisão e o alerta vai à Documentação, que não renova a Liberação (só
o Administrativo). Proposta: alerta ao Administrativo 2 dias úteis antes do
vencimento.

### Ordem não garantida: o caso dos veículos

**B16 — CE vinculado sem Baplie.** Risco alto.
- **Fato.** A trava dos veículos é a única checagem na entrada do CE. Sem
  Baplie, a fatura sai na hora; o IMO pode vir do B/L, mas OOG e SOC/COC só vêm
  do Baplie. Quando ele chega, o Vela reaplica as marcas: fatura sem pagamento é
  cancelada e emitida de novo (o Cliente vê no Portal e recebe Pix novo, sem
  e-mail novo); paga com aumento abre **Fatura desatualizada** e pede Fatura
  Avulsa; paga com redução gera abatimento ou restituição.
- **Evidência (Código).** `_analyze_ce_mercante_rows` (`597`) só trava pelos
  veículos; `import_baplie_file_atomic` (`509`) chama a correção da base da
  fatura (`574`). O guia diz que com divergência "o CE ainda não entra"
  ([etapa 10](../../manual/guias/viagem/10-conferir-antes-do-ce.md)); o sistema
  não aplica.
- **Proposta.** Trava como a dos veículos: o primeiro CE de B/L de container é
  recusado na Viagem sem Baplie, salvo declaração "Viagem sem Baplie" com
  motivo. **Decisão:** travar ou só avisar na prévia.

**B17 — CE com divergência Baplie × B/L ou com B/L faltando no container.**
Risco alto. A prévia do CE não mostra a divergência aberta da rota. E o B/L que
falta num container já coberto por outro B/L é invisível para os dois alertas:
**B/L esperado pendente** fecha com um B/L por porto, e a **Cobertura** compara
números de container. Quando ele chega, as faturas dos vizinhos são refeitas
(canceladas e reemitidas, abatidas ou abrem **Fatura desatualizada**).
Proposta: a prévia da planilha de CE lista as divergências da rota e pede
confirmação, ou recusa. **Decisão:** qual dos dois.

**B18 — A trava dos veículos é mais larga que os alertas dela.** Risco médio. A
trava vale sem olhar ETA nem porto, mas os alertas de veículos exigem o
primeiro ETA no Brasil e porto elegível: a Documentação pode ficar travada sem
Equipamentos ser avisado (a recusa cita Equipamentos). Na Viagem concluída a
trava sai e o CE tardio não tem proteção. Proposta: a tentativa recusada pela
trava abre a **Declaração de veículos pendente** para Equipamentos na hora,
com ou sem ETA.

### Avisa quem não pode agir

**B19 ✔ — PTAX e feriados na Documentação.** Risco médio. **Falha na
atualização da PTAX Demurrage** é crítico da Documentação, mas
**Informar PTAX** (`recalculate_demurrage_invoices_manual`) recusa quem não é
Financeiro, Administrativo ou Equipamentos. A PTAX é das 14h e o Pix da
Demurrage vira às 14h30. **Calendário de feriados pendente** também é da
Documentação, e só o suporte técnico grava feriados. Proposta: PTAX para o
Financeiro (ou Equipamentos, dono da Demurrage) e feriados para o
Administrativo. A tela de regras já diz quem age.

**B20 — Exportação pós-ATD em Operações.** Risco médio. Na rotina, quem lança
Granito e Embarque de vazios é Equipamentos, que assina essas seções do ADR e
não recebe o alerta. Proposta: Equipamentos como responsável (ou os dois).

**B21 — Tabela de cobrança, cálculo e Liberação.** Risco médio. **Tabela de
cobrança faltando** (Normal) e **Cálculo bloqueado** vão à Documentação, mas
ativar, reativar ou corrigir tabela já usada e conceder a Liberação são só do
Administrativo (`guard_tariff_active_change`, `guard_tariff_correction_admin`,
`grant_customer_billing_portal_release`). E a tabela faltando só abre pela
emissão do CE: o B/L retido por Portal não abre o alerta, e depois da ativação
o bloqueio fica mudo (`_auto_bill_bl_core`, `573`). Proposta: avisar também o
Administrativo (como nos quatro críticos de contato) e fazer **Tabela de
cobrança faltando** crítico: ela segura fatura, CE e Taxas, pagamento e
Desbloqueio.

**B22 — Solicitação de desbloqueio só à Documentação.** Risco baixo. Ver B02.

### Não escala: o alerta existe, mas fica quieto

**B23 — Nenhum alerta escala com o tempo.** Risco médio. O sino avisa uma vez,
na abertura (e no marco, nos poucos tipos que têm marco). A fila põe os
críticos primeiro e, dentro da gravidade, os mais recentes: o Normal antigo
afunda. Exemplos: **Data da escala/terminal pendente** (Normal), **CE Mercante
pendente** (um aviso só, no D−5, nada perto do ETA), **Restituição pendente**
(Normal, dinheiro do Cliente sem prazo), as pendências do Portal (só a falta de
Cliente ganha o selo **ETA próximo**). Proposta: um mecanismo único de
**escalonamento por idade**: na tela **Regras de alertas**, ao lado da
gravidade, "vira Crítico depois de N horas aberto", com novo aviso no sino. É a
continuação natural da troca de gravidade entregue agora.

**B24 — Alerta Normal sem ninguém ativo no setor não chega a ninguém.** Risco
baixo. Só o crítico desvia ao Administrativo; o Normal vai para **Falhas de
entrega de alertas**. A tela de regras agora diz isso em cada regra, e a troca
de gravidade permite mudar caso a caso.

**B25 — Escala sem terminal na segunda e terceira escalas.** Risco baixo hoje.
O alerta abre no D−5 do ETA de cada escala, mas o CE é cobrado no D−5 do
primeiro ETA no Brasil e o EDI Mercante pede o terminal do porto. Como o EDI
hoje é só da conta Dev, o impacto é pequeno.

**B26 — Programação que muda depois do NOA.** Risco baixo. NOA entregue não é
devido de novo quando o ETA muda (sugestão S6 de 2026-10-21, ainda aberta), e
porto que o armador tira da planilha é mantido ("X" ou vazio = deixar como
está).

### Menores

- **Local de desova** sem alerta: aparece "Local de desova não informado" no
  ADR; não muda cobrança.
- **Armazenagem a lançar** do Embarque de vazios sem alerta; depois do ADR
  fechado, as linhas travam.
- **Veículo LCL na Demurrage** suspenso sem alerta nem prazo (decisão da
  [ADR 0124](../../adr/0124-veiculo-lcl-na-demurrage.md)); cobrar depende de
  alguém lembrar.
- **Escala sem carga** mantém a Viagem ativa para sempre; ADR fechado antes do
  ATD recusa o ATD até reabrir.
- **Conferência dos alertas parcial**: um detector que quebra devolve sucesso na
  rotina; só o Sentry e o Better Stack veem.

## O que já está bem coberto

- **Prazos da documentação antes da chegada:** B/L esperado, Baplie, CE
  Mercante (D−7 e D−5), críticos e à Documentação; os veículos, com trava do CE
  desde a ADR 0128.
- **Revisão:** Cliente, peso e Portal, críticos e na hora; a fatura espera
  sozinha o B/L sair da Revisão, e o B/L sem Cliente perto do ETA tem alerta
  próprio.
- **Comunicados:** sem destinatário, recusado e os pendentes fecham na entrega;
  o CE trocado depois do envio pede reenvio.
- **Dinheiro:** Pix sem conciliação, consulta do Itaú parada e restituição são
  do Financeiro, que é quem resolve; a correção da fatura emitida é automática
  quando pode ser, e vira **Fatura desatualizada** quando não pode.
- **Demurrage:** Disputa com prazo de 1 dia útil, Demurrage travada pelo setor
  do motivo, cobrança recusada.
- **ADR:** cada equipe recebe o próprio alerta; o crítico do prazo de 72 horas
  existe (desde que haja ATD, B08).

## Alertas e travas propostos

| Proposta | Equipe | Abre | Fecha | Gravidade | Brecha |
|---|---|---|---|---|---|
| Desbloqueio de CE perto do prazo | Documentação | Prazo começa; reforço perto do vencimento | Exportação para a ZPT | Normal → Crítico | B01 |
| Solicitação aguardando análise | Documentação (desvio ao Administrativo) | N horas úteis sem análise | Documento analisado | Normal | B02 |
| Desbloqueio sem conciliação; Divergente na ZPT | Documentação | 1 dia útil sem conciliação; divergência | Conciliação confere | Normal | B03 |
| Container sem descarga | Equipamentos | N dias depois do ATB sem descarga | Descarga gravada | Normal → Crítico | B05 |
| B/L sem fatura depois do cancelamento; Demurrage a gerar de novo | Documentação; Equipamentos | 1 dia sem nova emissão | Emissão | Normal | B07 |
| ATA/ATD pendentes escalam | Operações | 24 h depois do ETA/ETD | Data gravada | Crítico | B08 |
| ADR assinado e não fechado | A decidir | 24 h depois da terceira assinatura | Fechamento | Normal | B09 |
| Trava da exportação no ADR | Equipamentos | Nada a declarar ou Fechar ADR com exportação declarada e não lançada | — (trava) | — | B10 |
| Viagem sem ETA | Documentação | Viagem ativa com B/L e sem ETA no Brasil | ETA gravado | Normal | B11 |
| NOA não enviado | Documentação | Janela vence sem o NOA | Justificativa | Normal | B12 |
| Reenviar CE e Taxas para B/L tardio | Documentação | B/L fica pronto depois do envio | Reenvio | Normal | B13 |
| Rotina interna sem rodar | Administrativo | Execução falha ou some | Execução certa | Crítico | B14 |
| Liberação vencendo | Administrativo | 2 dias úteis antes | Renovação ou vencimento | Normal | B15 |
| Trava do CE sem Baplie | Documentação | Primeiro CE sem Baplie na Viagem | — (trava) | — | B16 |
| Divergências na prévia do CE | Documentação | Prévia com divergência da rota | — (confirmação ou trava) | — | B17 |
| Escalonamento por idade, na tela de regras | Administrativo configura | N horas aberto | — | Vira Crítico | B23 |

E de roteamento: PTAX ao Financeiro (ou Equipamentos), feriados ao
Administrativo (B19); exportação a Equipamentos (B20); tabela de cobrança,
cálculo e Portal não provisionado avisando também o Administrativo (B21).

## O que a nova tela já permite

Com a troca de gravidade entregue nesta revisão
([ADR 0130](../../adr/0130-gravidade-do-alerta-pela-tela.md)), o Administrativo
pode, sem código, dar mais peso a alertas que hoje são Normais e seguram
dinheiro ou prazo. Sugestões para avaliar (não foram aplicadas):

| Alerta | Hoje | Sugestão | Por quê |
|---|---|---|---|
| Tabela de cobrança faltando | Normal | Crítico | Segura fatura, CE e Taxas, pagamento e Desbloqueio |
| Exportação pendente pós-ATD | Normal | Crítico | Corre contra as 72 h do ADR |
| Restituição pendente | Normal | Crítico | Dinheiro do Cliente parado, sem prazo |
| Data de terminal pendente | Normal | Avaliar | Cobre ETB, ATB, ETD e ATD juntos: o ATD esquecido desliga o ADR (B08), mas um ETB atrasado não tem o mesmo peso; o escalonamento por idade (B23) resolve melhor |

A gravidade não muda quem recebe: os roteamentos de B19 a B21 continuam
pedindo mudança no código.

## Decisões pendentes

1. **Desbloqueio (B01, B02):** com quanta antecedência avisar, a partir de
   quando é crítico, e se o Administrativo também recebe.
2. **Descarga (B05):** quantos dias depois do ATB sem descarga abrem o alerta,
   e quando ele vira crítico.
3. **Datas do navio (B08):** quantas horas depois do ETA/ETD sem ATA/ATD o
   alerta vira crítico; se o ATB passa a exigir o ATA.
4. **CE antes da hora (B16, B17):** travar o CE como nos veículos, ou avisar na
   prévia com confirmação.
5. **Exportação (B10, B20):** Equipamentos como responsável; recusar **Nada a
   declarar** e **Fechar ADR** sem a exportação declarada.
6. **Fechar o ADR (B09):** de quem é, e em quanto tempo.
7. **Roteamento (B19, B21):** PTAX para o Financeiro ou Equipamentos;
   Administrativo avisado em tabela de cobrança, cálculo e Portal.
8. **Escalonamento por idade (B23):** um mecanismo geral, configurável na tela
   de regras, ou reforços pontuais por alerta.

## O que não foi verificado

- **Produção e staging.** Não foram consultadas: não se sabe quantos B/Ls hoje
  estão sem descarga, quantos prazos de Desbloqueio venceram, quantas Viagens
  estão sem ETA ou com ATD faltando. As consultas para isso partem das
  evidências citadas.
- **Fluxos de ponta a ponta.** As brechas vêm de leitura de código; nenhum
  cenário foi executado para elas. A tela nova e a troca de gravidade foram
  exercitadas no app local (emulador e Postgres descartável) e nos testes.
- **Regras externas.** Prazos da Receita (Siscomex Carga/Mercante) e do armador
  não estão no repositório e não foram conferidos.
