import { isBreakbulkCargoMode, isContainerCargoMode } from './cargoMode'
import { countDistinctContainerNumbers } from './containerCounts'
import type { BLListItem } from '../types/database'

/**
 * Números do badge no locale da aplicação. O `toFixed(1)` anterior escrevia
 * `12.3 ton` numa tela que formata todo o resto como `12,3`, e sem separador de
 * milhar — o que ajudava um peso mil vezes maior (`135263 ton`) a passar
 * despercebido — além de truncar em uma casa o que o B/L declara em três.
 */
function formatCargoNumber(value: number) {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}

function formatBreakbulkCargo(bl: BLListItem): string {
  const weightTon = Number(bl.bb_weight_ton ?? 0)
  if (weightTon > 0) return `${formatCargoNumber(weightTon)} ton`

  const packages = Number(bl.bb_packages_qty ?? 0)
  if (packages > 0) return `${formatCargoNumber(packages)} vol`

  const itemsCount = bl.bl_breakbulk_items?.length ?? 0
  return `${itemsCount} ${itemsCount === 1 ? 'item' : 'itens'}`
}

/**
 * Resumo da carga de um B/L para a coluna `Carga` de `/bls`.
 *
 * A modalidade é lida pelos mesmos predicados do resto do sistema. A versão
 * anterior tratava `misto` com um ramo próprio que, quando o B/L não tinha
 * número de contêiner legível, escapava para o `return` final e imprimia
 * `0 CNTR` — descartando a carga solta que o B/L comprovadamente tem.
 */
export function formatBlCargoBadge(bl: BLListItem): string {
  const containerCount = countDistinctContainerNumbers(bl.bl_containers)

  if (isBreakbulkCargoMode(bl.cargo_mode)) {
    const breakbulk = formatBreakbulkCargo(bl)
    if (isContainerCargoMode(bl.cargo_mode) && containerCount > 0) {
      return `${containerCount} CNTR + ${breakbulk}`
    }
    return breakbulk
  }

  return `${containerCount} CNTR`
}
