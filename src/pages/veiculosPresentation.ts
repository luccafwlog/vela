// Apresentação da lista /veiculos. O Local de desova é atributo do container
// (CONTEXT.md), não do veículo: a lista agrupa os veículos pelo container para
// que o local seja editado uma vez por container, e não repetido em cada linha.

export type VehicleRowLike = {
  id: number
  container?: { id: number; container_number: string; type?: string | null; seal_number?: string | null; unpacking_location?: string | null } | null
  bl?: { id: string } | null
}

export type VehicleContainerGroup<T extends VehicleRowLike> = {
  /** `container:<id>` ou `none` para veículos sem container. */
  key: string
  container: NonNullable<T['container']> | null
  vehicles: T[]
  /** B/Ls distintos dos veículos do grupo, na ordem em que aparecem. */
  blIds: string[]
}

/** Agrupa preservando a ordem da página: o grupo nasce no primeiro veículo dele. */
export function groupVehiclesByContainer<T extends VehicleRowLike>(rows: readonly T[]): VehicleContainerGroup<T>[] {
  const groups = new Map<string, VehicleContainerGroup<T>>()
  for (const row of rows) {
    const key = row.container ? `container:${row.container.id}` : 'none'
    let group = groups.get(key)
    if (!group) {
      group = { key, container: (row.container ?? null) as VehicleContainerGroup<T>['container'], vehicles: [], blIds: [] }
      groups.set(key, group)
    }
    group.vehicles.push(row)
    const blId = row.bl?.id
    if (blId && !group.blIds.includes(blId)) group.blIds.push(blId)
  }
  return [...groups.values()]
}

/** Os agregados do hook usam "Nao informado" como rótulo de ausência. */
export function isMissingLabel(label: string) {
  return label.trim().toLowerCase() === 'nao informado'
}

export function displayAggregateLabel(label: string) {
  return isMissingLabel(label) ? 'Não informado' : label
}

/** Texto do alcance da edição do local, com o número real de veículos do container. */
export function unpackingScopeText(vehicleCount: number) {
  return vehicleCount === 1 ? 'Vale para o veículo deste container' : `Vale para os ${vehicleCount} veículos deste container`
}
