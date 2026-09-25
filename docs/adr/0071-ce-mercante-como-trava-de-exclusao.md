# 0071 — O CE Mercante é a trava de exclusão

Status: aceito — 2026-09-24. Implementação pendente: o banco e as telas ainda
seguem as regras da 0009 e da 0024.

Supersede parcialmente a
[ADR 0009](./0009-hard-delete-controlado-bloqueios-fiscais-auditoria.md) quanto
ao critério de quando um registro operacional pode ser excluído, ao papel
autorizado e à auditoria best-effort, e a
[ADR 0024](./0024-cancelamento-viagem-estado-retido-exclusao-hard-delete.md)
quanto à exclusão de viagem com vínculo e à reativação de viagem cancelada.
Mantém da 0009 a rejeição de soft delete generalizado e, da 0024, o
cancelamento como estado retido.

## Contexto

A [revisão da exclusão de dados](../archive/audits/2026-09-24-revisao-exclusao-de-dados.md)
encontrou critérios de exclusão escolhidos módulo a módulo: viagem só sem
nenhum vínculo, B/L e cliente só sem vínculo fiscal, escala por qualquer
usuário. Revisando a auditoria com o dono do negócio, as ações sobre
registros ganharam um vocabulário único em `CONTEXT.md` (seção "Ações sobre
registros"). Faltava dizer **até quando** um erro de cadastro se resolve
excluindo.

O CE Mercante é o marco que já separa as duas fases no sistema: sem CE, a
fatura de Taxas Locais não é emitida (`enforce_invoice_ce_on_issue`) e o B/L
não é liberado no Portal. Antes dele, os dados de uma viagem ainda são
trabalho interno; depois dele, o cliente e o fisco já os viram.

## Decisão

1. **Trava.** Todo dado de uma viagem (viagem, escala, atracação, B/L,
   container, veículo, vazios e demais) pode ser excluído enquanto não
   estiver travado. O que trava é o CE Mercante vinculado ao B/L.
2. **Alcance.** O CE trava o B/L, a carga dele (containers e veículos) e
   tudo de que ele depende: escala, atracação e terminal, e a viagem. Os B/Ls
   sem CE da mesma viagem continuam excluíveis.
3. **Documento financeiro também trava.** Fatura, invoice de Demurrage ou
   recebível travam o que referenciam, o que vier primeiro, porque a invoice
   de Demurrage não passa pelo gate do CE.
4. **Vazios não têm CE.** A trava deles é o ADR de Saída fechado daquela
   escala e terminal; reabrir o ADR solta a trava. Antes dela, unidade manual
   e linha de serviço de vazios podem ser excluídas por qualquer usuário
   ativo, porque são custo interno sem cliente; o banco passa a aceitar isso
   também na linha de serviço. A função `delete_baplie_manifest_for_voyage`,
   sem tela, é removida; o BAPLIE e a planilha de vazios se substituem por
   reimportação.
5. **CE errado.** Corrigir o número mantém a trava. Apagar o CE solta a
   trava só enquanto nenhuma fatura tiver sido emitida e nenhum B/L tiver sido
   liberado no Portal.
6. **Depois da trava**, nada se exclui: o caminho é corrigir, substituir,
   reemitir ou cancelar.
7. **Cascata com prévia.** Excluir uma viagem sem trava leva junto os B/Ls,
   a carga e as escalas dela. A tela mostra antes o que será apagado e exige
   motivo; o banco executa tudo numa transação, ou nada.
8. **Autoria.** Excluir, cancelar e reativar são do Administrativo, sempre
   com motivo e rastro. Viagem cancelada por engano pode ser reativada.
9. **B/L cancelado.** Um B/L com CE que não vai seguir (a carga não embarcou,
   o armador reemitiu com outro número) é cancelado pelo Administrativo, com
   motivo, e pode ser reativado. Ele sai do faturamento e aparece no Portal
   como cancelado se já tiver sido liberado. O cancelamento é bloqueado
   enquanto houver fatura ou recebível aberto dele: o Financeiro cancela ou
   estorna antes. O B/L cancelado libera o CE; a unicidade CE × B/L vale
   entre B/Ls não cancelados.
10. **Reimportação é correção.** Reimportar o B/L depois do CE pode tirar
    containers e veículos que o novo arquivo não traz, porque o arquivo é a
    fonte da carga. A prévia mostra o que sai, fica rastro, e B/L faturado
    continua exigindo a autorização auditada.
11. **Taxa manual do B/L** é cobrança, não dado operacional: pode ser
    excluída pelo Administrativo até ser faturada, independentemente do CE.
12. **Programação de Navios.** A viagem sai de Chegadas e Saídas e do
    Portal sozinha, ao receber o último ATD. "Remover do Portal" deixa de
    existir: tirar a viagem antes disso só se faz em Viagens, por Excluir ou
    Cancelar. A função `archive_vessel_schedule` e seu serviço, sem tela,
    são removidos.
13. **Recuperação.** A cópia da linha gravada pela auditoria de banco
   (`audit_row_changes`) é suficiente para recadastrar à mão; não há ação de
   restaurar. Isso exige que toda tabela coberta tenha o trigger e que
   `audit_logs` seja imutável.

## Consequências

- **Positivas:** um critério só, que o usuário entende pelo processo e não
  pela tabela; erro de cadastro de viagem inteira se desfaz num passo antes do
  CE.
- **Negativas / custos:** exclusão de viagem com B/Ls passa a ser cascata e
  exige RPC transacional (achado A2); a trava precisa ser verificada no banco
  para cada entidade, não só na tela; `voyages` precisa ganhar auditoria
  (achado A5) e `audit_logs` precisa deixar de aceitar UPDATE/DELETE (achado
  A4) antes de a exclusão ampliada entrar.
- **Em aberto:** as regras de exclusão das demais telas (cadastros, tarifas,
  clientes, faturamento) seguem sendo revisadas tela a tela; se fatura
  cancelada pode ser reativada ainda será decidido.
