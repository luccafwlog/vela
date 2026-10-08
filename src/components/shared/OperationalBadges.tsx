import { Badge } from '../ui/Badge'

export function ChargeStatusBadge({ status }: { status: string | null }) {
  switch (status) {
    case 'calculated':
      return <Badge tone="blue">Calculado</Badge>
    case 'review_required':
      return <Badge tone="yellow">Revisão</Badge>
    case 'reviewed':
      return <Badge tone="green">Revisado</Badge>
    case 'ready_for_billing':
      return <Badge tone="green">Pronto</Badge>
    case 'exempt':
      return <Badge tone="slate">Isento</Badge>
    default:
      return <Badge tone="slate">Não calculado</Badge>
  }
}

export function CargoProfileBadge({ isImo, isOog }: { isImo: boolean; isOog: boolean }) {
  const profile = getCargoProfile(isImo, isOog)
  const tone = profile === 'IMO/OOG' || profile === 'IMO' ? 'red' : profile === 'OOG' ? 'yellow' : 'blue'

  return <Badge tone={tone}>{profile}</Badge>
}

/** SOC/COC do container; sem informação, o sistema trata como COC. */
export function ContainerOwnershipBadge({ ownership, title }: { ownership: string | null | undefined; title?: string }) {
  if (ownership === 'SOC') return <Badge tone="green" title={title ?? 'Shipper owned: do cliente, sem devolução nem Demurrage'}>SOC</Badge>
  if (ownership === 'COC') return <Badge tone="blue" title={title ?? 'Carrier owned: do armador'}>COC</Badge>
  return <Badge tone="slate" title={title ?? 'Sem informação no B/L nem no Baplie; tratado como COC'}>Não informado</Badge>
}

function getCargoProfile(isImo: boolean, isOog: boolean) {
  if (isImo && isOog) return 'IMO/OOG'
  if (isImo) return 'IMO'
  if (isOog) return 'OOG'
  return 'Padrão'
}
