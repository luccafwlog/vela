import { formatPortDisplayName } from '../../lib/voyageFormat'
import type { LocalChargeLine } from '../../services/charges/chargeOperationsService'

export type ConferenceGroupKind = 'tabela' | 'manual' | 'sem_tabela'

export type ConferenceGroup = {
  key: string
  kind: ConferenceGroupKind
  title: string
  subtitle: string | null
  lines: LocalChargeLine[]
  totalBrl: number
  totalUsd: number
}

function toAmount(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

// O agrupamento responde à pergunta que a expansão precisa responder: de onde
// veio cada valor. Três origens possíveis, nesta ordem de leitura:
//
//   `tabela`     — cálculo automático a partir de uma tabela de cobrança
//                  cadastrada (a de Vitória para quem descarrega em Vitória);
//   `manual`     — linha lançada à mão, que não sai de tabela nenhuma;
//   `sem_tabela` — anomalia: linha automática sem tabela vinculada. Não é um
//                  estado esperado, e some da conferência se for tratada como
//                  as demais — por isso ganha grupo próprio em vez de cair no
//                  balaio de "outras".
export function groupChargeLinesByTable(lines: LocalChargeLine[]): ConferenceGroup[] {
  const groups = new Map<string, ConferenceGroup>()

  for (const line of lines) {
    const isManual = line.source === 'manual'
    const hasTable = line.charge_table_id != null
    const kind: ConferenceGroupKind = isManual ? 'manual' : hasTable ? 'tabela' : 'sem_tabela'
    const key = kind === 'tabela' ? `tabela:${line.charge_table_id}` : kind

    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        kind,
        title: groupTitle(kind, line),
        subtitle: groupSubtitle(kind, line),
        lines: [],
        totalBrl: 0,
        totalUsd: 0,
      }
      groups.set(key, group)
    }

    group.lines.push(line)
    group.totalBrl += toAmount(line.total_value_brl)
    group.totalUsd += toAmount(line.total_value_usd)
  }

  const order: Record<ConferenceGroupKind, number> = { tabela: 0, manual: 1, sem_tabela: 2 }
  return [...groups.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title, 'pt-BR'))
}

function groupTitle(kind: ConferenceGroupKind, line: LocalChargeLine) {
  if (kind === 'manual') return 'Lançamentos manuais'
  if (kind === 'sem_tabela') return 'Sem tabela vinculada'
  return line.charge_table_name?.trim() || `Tabela #${line.charge_table_id}`
}

function groupSubtitle(kind: ConferenceGroupKind, line: LocalChargeLine) {
  if (kind === 'manual') return 'Itens manuais da tabela: quantidade informada na operação.'
  if (kind === 'sem_tabela') return 'Linha automática sem tabela de cobrança vinculada — recalcule para reconciliar.'
  const pod = line.charge_table_pod?.trim()
  return pod ? `Descarga em ${formatPortDisplayName(pod)}` : null
}

// A base de aplicação mora em `src/lib/applicationBasis.ts`; a planilha da
// Validação (serviço) usa o mesmo rótulo.
export { applicationBasisLabel } from '../../lib/applicationBasis'

export function sumChargeLines(lines: LocalChargeLine[]) {
  return lines.reduce(
    (acc, line) => ({
      totalBrl: acc.totalBrl + toAmount(line.total_value_brl),
      totalUsd: acc.totalUsd + toAmount(line.total_value_usd),
    }),
    { totalBrl: 0, totalUsd: 0 },
  )
}

// Divergência entre o que a conferência soma (charge_calculations, congelado
// para B/L faturado: `calculate_bl_local_charges` recusa recálculo em
// invoiced/partially_paid/paid) e o que a fatura registrou para o B/L.
//
// Elas divergem num caso real: na consolidação, quando a soma dos itens não
// bate com o saldo do B/L, a migration 261 congela UMA linha agregada. Aí a
// tela mostra o detalhamento e a fatura cobrou outro número — e o operador que
// abriu a conferência para conferir a fatura precisa saber disso.
//
// Tolerância de um centavo: os dois lados são NUMERIC(14,2) somados em pontos
// diferentes, e igualdade exata de ponto flutuante acusaria diferença que não
// existe.
const TOLERANCIA_BRL = 0.01

export function detectarDivergenciaComFatura(
  calculado: { totalBrl: number; totalUsd: number },
  faturado: { totalBrl: number; totalUsd: number | null } | null,
) {
  if (!faturado) return null

  const difBrl = Math.abs(calculado.totalBrl - faturado.totalBrl)
  // `null` em USD é "a fatura não registra USD nesta forma", não "zero".
  const difUsd = faturado.totalUsd == null ? 0 : Math.abs(calculado.totalUsd - faturado.totalUsd)

  if (difBrl <= TOLERANCIA_BRL && difUsd <= TOLERANCIA_BRL) return null

  return { calculado, faturado }
}
