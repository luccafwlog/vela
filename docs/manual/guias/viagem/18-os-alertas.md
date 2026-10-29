O alerta abre sozinho quando algo precisa de uma pessoa e fecha sozinho quando a causa some: não se fecha à mão. O crítico vem em vermelho, e a equipe dele recebe também no sino.

::: tela alertas-fila
A fila de Alertas.
:::

::: passos
1. Abra **Alertas**, ou o cartão da sua equipe no **Painel**.
2. Em **Setor**, escolha a sua equipe.
3. Em **Busca**, digite o navio, o B/L ou o Cliente.
4. **Registro** diz onde está a pendência; **Resolver** leva à tela da correção.
:::

**Na importação e no CE**

| Alerta | Equipe | Abre quando | Fecha quando |
|---|---|---|---|
| **Cobertura Baplie / B/L** · crítico | {{Documentação}} | Container cheio no Baplie sem B/L, ou de B/L fora do Baplie | O Baplie e os B/Ls batem |
| **Revisão de B/L — cliente não vinculado** · crítico | {{Documentação}} | B/L na Revisão sem Cliente | O Cliente é vinculado |
| **Revisão de B/L — peso BB ausente** · crítico | {{Documentação}} | Carga solta na Revisão sem peso | O peso é informado |
| **Revisão de B/L — Portal não provisionado** · crítico | {{Documentação}} | B/L parado ou fatura retida porque o Portal do Cliente não está pronto | O Portal fica pronto |
| **Efeito de importação bloqueado** · crítico | {{Documentação}} | Um passo depois da importação falhou | A causa é corrigida e alguém usa **Reprocessar** |
| **Reenviar Comunicado de CE e Taxas** | {{Documentação}} | O CE de um B/L mudou depois do envio | O CE e Taxas é reenviado |

**Antes da chegada**, contando do primeiro ETA no Brasil

| Alerta | Equipe | Abre quando | Fecha quando |
|---|---|---|---|
| **B/L esperado pendente** · crítico | {{Documentação}} | 7 dias antes, falta B/L para algum porto da Viagem | Os B/Ls entram |
| **Baplie ausente** · crítico | {{Documentação}} | 7 dias antes, sem Baplie | O Baplie entra |
| **CE Mercante pendente** · crítico | {{Documentação}} | 5 dias antes, B/L sem CE ou rota de vazios sem Nº do manifesto | O CE entra e o número é informado |
| **Planilha de Veículos pendente** · crítico | {{Equipamentos}} | 5 dias antes, sem veículos nem a declaração | Os veículos entram ou a Viagem é declarada sem veículos |
| **B/L sem Cliente perto do ETA** · crítico | {{Documentação}} | 5 dias antes do ETA do porto, B/L dele sem Cliente | O Cliente é vinculado |

**Na chegada**

| Alerta | Equipe | Abre quando | Fecha quando |
|---|---|---|---|
| **Data da escala pendente** | {{Operações}} | No dia do ETA, sem ATA; com o ATA, sem ETB | A data é gravada |
| **Data de terminal pendente** | {{Operações}} | No dia do ETB, sem ATB; com o ATB, sem ETD; no dia do ETD, sem ATD | A data é gravada |
| **Comunicado NOA, NOR ou NOB pendente** | {{Documentação}} | A escala está na janela do aviso e um Cliente ainda não recebeu | O último destinatário recebe |

**Na saída do navio e depois**

| Alerta | Equipe | Abre quando | Fecha quando |
|---|---|---|---|
| **Exportação pendente pós-ATD** | {{Operações}} | ATD numa escala com exportação declarada e não lançada | A exportação é lançada ou a declaração, corrigida |
| **ADR — departamento pendente** | as três | Depois do ATD, com seção da equipe em **Pendente** | A última seção da equipe sai de **Pendente** |
| **ADR — prazo vencido** · crítico | as três | 72 horas depois do ATD, sem a assinatura da equipe | A equipe assina |
| **Disputa de invoice Demurrage** | {{Equipamentos}} | O Cliente abre ou responde uma Disputa no Portal | A vez passa ao Cliente ou a Disputa é resolvida |
