/**
 * Veículo LCL na Demurrage (migration 593, ADR 0124): B/L de modalidade
 * container, com veículo e Movement To com LCL ou CFS, a mesma regra que isenta
 * as Taxas Locais. Tem free time fixo de 30 dias, acima da condição do B/L, do
 * acordo e da tarifa, e a cobrança suspensa: só o Gerar Invoice emite.
 *
 * Quem decide é o banco (`_bl_is_lcl_vehicle`, `_demurrage_lcl_vehicle_free_days`
 * e a classificação `list_demurrage_billing_board`). Esta é a cópia da prévia
 * que o navegador calcula na ficha do B/L e na ficha do Cliente.
 * ponytail: a prévia olha o B/L; o banco suspende o container só quando todo
 * B/L do mesmo Cliente com ele na Viagem é de veículo LCL. Container dividido
 * com B/L de outra carga aparece suspenso na prévia e é cobrado na emissão;
 * a ficha do B/L corrige pela classificação quando ela traz o container.
 */
export const LCL_VEHICLE_FREE_DAYS = 30

export function isLclVehicleBl(bl: { cargo_mode?: string | null; movement_to?: string | null } | null | undefined, vehicleCount: number): boolean {
  if (!bl || bl.cargo_mode !== 'container' || vehicleCount <= 0) return false
  const movement = (bl.movement_to ?? '').trim().toUpperCase()
  return movement.includes('LCL') || movement.includes('CFS')
}
