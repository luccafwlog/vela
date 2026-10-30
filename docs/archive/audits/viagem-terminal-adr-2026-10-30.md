# Mapeamento: o que se liga à Viagem e ao terminal chega ao ADR? — 2026-10-30

Auditoria pontual, nascida histórica. A regra vigente está em
[Viagens § Agency Departure Report (ADR)](../../modules/viagens.md#agency-departure-report-adr).

## Pergunta

No teste do dono em BRVIX (Vitória), os veículos e os vazios de importação
apareciam nos cards do porto da aba Importação da Viagem e não no ADR do
terminal. A pergunta foi se tudo o que se liga a uma Viagem e a um terminal
chega ao ADR.

## Como o ADR por terminal decide o que mostra

Os cards do porto leem os dados por porto (POD do B/L, POD do vazio). O ADR por
terminal faz um segundo recorte: uma seção só mostra dado quando o terminal do
ADR tem uma **Frente de Operação** daquela seção
(`sectionIsVisible` em `VoyageAgencyReportTab.tsx`). As frentes vêm de duas
fontes (`fetchEscalaTerminalState`, `escalaTerminalAllocation.ts`): as gravadas
em Editar escala (`voyage_escala_operation_fronts`) e as derivadas dos dados da
escala, que nascem `TBC` até alguém gravar o terminal. Por isso um dado que está
no card do porto e não tem frente com terminal some do ADR (**Código**).

## Mapa

| Dado | Liga à escala por | Frente | Seção do ADR | Recorte por terminal | Situação |
|---|---|---|---|---|---|
| ATA | Escala | — | Escala | — | Chega (**Código**) |
| ATB, ATD, Restow | Atracação do terminal | — | Escala | Atracação do terminal do ADR | Chega (**Código**) |
| Containers cheios do B/L | `bls.pod` (todas as grafias do porto) | Carga cheia, de `cargo_mode` `container`/`misto` | Carga descarregada | Exceção de terminal do B/L ou frente da modalidade (ADR 0068) | Chega com a frente com terminal (**Código**) |
| Carga solta | `bls.pod` | Carga solta, de `carga_solta`/`misto` | Carga descarregada | Idem | Chega com a frente com terminal (**Código**) |
| Carga em transbordo (escala omitida) | `voyage_omissions.discharge_pod` → `bl_transshipments` | Nenhuma derivada (o B/L tem POD no porto omitido) | Carga descarregada / Veículos | Pela frente da escala de descarga | Lacuna, abaixo |
| Veículos | `vehicles` → B/L com `bls.pod` | **Veículos: nunca nascia** | Veículos | Frente de Veículos (nenhuma) | **Defeito: não chegava a nenhum ADR por terminal.** Corrigido |
| Vazios de importação | `vazios_importacao_containers.pod` | Vazios IMP, derivada | Vazios descarregados | Frente inteira | **Defeito: derivada TBC sumia do ADR e o ADR fechava sem ela.** Corrigido |
| Vazios do Baplie | `baplie_containers.pod` | — | Vazios descarregados (contagem e divergência) | Segue a seção | Chega (**Código**) |
| Local de desova | container do veículo | — | Veículos | Segue o veículo | Chega com os veículos (**Código**) |
| Granito | `granite_bls.loading_port` (normalizado) | Granito, **só da declaração de exportação** | Carga carregada | Frente inteira | **Defeito: Granito sem declaração não chegava ao ADR por terminal.** Corrigido |
| Embarque de vazios | `vazios_export_operations.embark_port` | Vazios EXP, só da declaração | Embarque de vazios | Frente inteira | Em correção em outra sessão (dono, 2026-10-30) |

## Defeitos corrigidos nesta mudança

1. **Veículos.** A frente de Veículos era derivada de `bls.cargo_mode = 'veiculo'`,
   valor que não existe: o B/L é `container`, `carga_solta` ou `misto`, e o
   veículo viaja em container. Sem frente, a seção Veículos de todo ADR por
   terminal ficava sem dado, e a janela Editar escala nunca oferecia o terminal
   dessa frente. Agora a frente nasce do veículo gravado num B/L da escala, e o
   veículo fica no ADR do terminal dela, salvo exceção de terminal do B/L
   (**Teste:** `escalaTerminalAllocation.test.ts`, `VoyageAgencyReportTab.test.tsx`).
2. **Frente derivada sem terminal.** Uma frente que nasce dos dados depois da
   última gravação de Editar escala (o vazio importado depois, por exemplo) fica
   `TBC`. A seção dizia "Não há frente atribuída a este terminal.", nada
   avisava, e o banco só recusava o fechamento com frente `TBC` gravada: o ADR
   fechava e congelava o retrato sem o dado. Agora a seção e o bloco ADR mostram
   "Sem terminal (TBC)", **Fechar ADR** fica desabilitado e o banco recusa o
   fechamento (migration `514`) (**Teste:** `adrFrenteDerivadaSemTerminal.local-pg.test.ts`,
   Postgres 16 local descartável).
3. **Granito.** A frente de Granito só nascia da declaração de exportação
   ("tem exportação" + Granito), e a importação do Granito não mexe nela
   (`import_granite_manifest_transactional`). Agora a frente nasce também do
   Granito importado no porto (B/L pelo porto de carregamento, com o do
   manifesto na falta dele), Editar escala abre com o Granito declarado nesse
   caso (sem a declaração a janela descartava a frente ao gravar) e o banco
   confere a frente dele no fechamento (migration `515`) (**Teste:**
   `escalaTerminalAllocation.test.ts`, `VoyageScheduleModals.test.tsx`,
   `adrFrenteDerivadaSemTerminal.local-pg.test.ts`). Pedido do dono na mesma
   data.
4. **Cache.** Importar veículos, vazios ou B/Ls não relia as frentes do ADR
   (`['agency-report-terminal-state']`); a aba podia mostrar a frente antiga por
   até 30 s. Entrou nos efeitos de carga (**Teste:** `cacheEffects.test.ts`).

## Lacunas que ficam

- **Carga só em transbordo.** As frentes de importação são derivadas dos B/Ls
  com POD no porto. Numa escala que só recebe carga em transbordo (B/L com POD
  no porto omitido), nenhuma frente nasce dessa carga, salvo a marcação "tem
  importação" (carga cheia): carga solta e veículos em transbordo não chegam ao
  ADR por terminal (**Código**).
- **Exceção de terminal sem frente.** O B/L com exceção para um terminal que não
  tem frente daquela seção não aparece em nenhum ADR; a pendência
  `review:bl_terminal_sem_frente` (ADR 0068) é o sinal hoje (**Código**).
- A trava do banco cobre as frentes de importação e a de Granito; a de
  Embarque de vazios derivada da declaração e ainda não gravada é bloqueada só
  pela tela (**Código**).

## Evidência e limites

Leitura estática do código e das migrations; testes Vitest; as migrations `514`
e `515` aplicadas e executada no Postgres 16 local descartável (`setup-local-pg.sh`).
Consulta somente leitura ao projeto Supabase de produção em 2026-10-30: a Viagem
169 (BRVIX) tem 1.896 veículos e 22 vazios de importação, nenhuma frente gravada
e nenhum ADR; o banco inteiro não tinha frente gravada, então o caso exato do
teste não pôde ser reconstituído (dados descartados). Não verificado: a tela
autenticada no navegador e a migration no Supabase remoto.
