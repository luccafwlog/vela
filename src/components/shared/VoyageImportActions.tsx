import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Car, FileText, Mountain, Package, PackageOpen, ShieldCheck, type LucideIcon } from 'lucide-react'
import { Button } from '../ui/Button'
import { useAuth } from '../../hooks/useAuth'
import { BlImportModal } from './BlImportModal'
import { BlDocumentImportModal } from './BlDocumentImportModal'
import { CeMercanteImportModal } from './CeMercanteImportModal'
import { BreakbulkManifestImportModal } from './BreakbulkManifestImportModal'
import { GraniteImportModal } from './GraniteImportModal'
import { VaziosImportacaoImportModal } from './VaziosImportacaoImportModal'
import { BaplieImportModal } from './BaplieImportModal'
import { VehicleImportModal } from './VehicleImportModal'

type ImportType = 'bb' | 'granite' | 'ceMercanteGranite' | 'vaziosImp' | 'vaziosExp' | 'vehicles' | 'baplie' | 'blFreight' | 'blBreakbulk' | 'ceMercante'

type ImportGroup = 'baplie' | 'bls' | 'importEquipment' | 'exportManifest' | 'exportVazios'

const IMPORT_LABELS: Record<ImportType, string> = {
  bb: 'Manifesto BB',
  granite: 'Manifesto Granito',
  ceMercanteGranite: 'CE Mercante (Granito)',
  vaziosImp: 'Vazios IMP',
  vaziosExp: 'Novo embarque de vazios',
  vehicles: 'Veículos',
  baplie: 'Baplie EDI',
  blFreight: 'B/L container',
  blBreakbulk: 'B/L carga solta',
  ceMercante: 'CE Mercante',
}

const IMPORT_ORDER: ImportType[] = ['baplie', 'blFreight', 'blBreakbulk', 'ceMercante', 'bb', 'vehicles', 'vaziosImp', 'granite', 'ceMercanteGranite', 'vaziosExp']

const IMPORT_GROUP_BY_TYPE: Record<ImportType, ImportGroup> = {
  baplie: 'baplie',
  blFreight: 'bls',
  blBreakbulk: 'bls',
  ceMercante: 'bls',
  bb: 'bls',
  vehicles: 'importEquipment',
  vaziosImp: 'importEquipment',
  granite: 'exportManifest',
  ceMercanteGranite: 'exportManifest',
  vaziosExp: 'exportVazios',
}

const IMPORT_ICONS: Record<ImportType, LucideIcon> = {
  baplie: Package,
  blFreight: Box,
  blBreakbulk: FileText,
  ceMercante: ShieldCheck,
  bb: FileText,
  vehicles: Car,
  vaziosImp: PackageOpen,
  granite: Mountain,
  ceMercanteGranite: ShieldCheck,
  vaziosExp: PackageOpen,
}

export function VoyageImportActions({
  voyageId,
  voyageLabel,
  userId,
  types,
}: {
  voyageId: number
  voyageLabel: string
  userId: string
  types: ImportType[]
}) {
  const [activeType, setActiveType] = useState<ImportType | null>(null)
  const navigate = useNavigate()
  const { profile } = useAuth()
  const canEditVazios = Boolean(profile || userId)
  const canEditVehicles = Boolean(profile || userId)
  const allowedTypes = IMPORT_ORDER.filter((type) => {
    if (!types.includes(type)) return false
    if (type === 'vaziosExp') return canEditVazios
    if (type === 'vehicles') return canEditVehicles
    return Boolean(profile || userId)
  })
  // Quem abre pela Viagem importa nela: os modais recebem a viagem fixa.
  const fixedVoyage = useMemo(() => ({ id: voyageId, label: voyageLabel }), [voyageId, voyageLabel])
  const actionGroups: Array<{ group: ImportGroup; types: ImportType[] }> = []
  for (const type of allowedTypes) {
    const group = IMPORT_GROUP_BY_TYPE[type]
    const current = actionGroups[actionGroups.length - 1]
    if (current?.group === group) current.types.push(type)
    else actionGroups.push({ group, types: [type] })
  }

  return (
    <>
      <div className="app-import-actions" role="group" aria-label="Importações da viagem">
        {actionGroups.map(({ group, types: groupTypes }, groupIndex) => (
          <div key={group} className="app-import-actions__group">
            {groupIndex > 0 ? <span aria-hidden="true" className="app-import-actions__sep mx-1 h-6 w-px self-center bg-[var(--app-border)]" /> : null}
            {groupTypes.map((type) => {
              const Icon = IMPORT_ICONS[type]
              return (
                <Button key={type} variant="secondary" onClick={() => type === 'vaziosExp' ? navigate(`/embarquevazios?voyage=${voyageId}`) : setActiveType(type)}>
                  <Icon size={14} aria-hidden="true" />
                  {IMPORT_LABELS[type]}
                </Button>
              )
            })}
          </div>
        ))}
      </div>

      {activeType === 'bb' ? (
        <BreakbulkManifestImportModal voyage={fixedVoyage} userId={userId} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'granite' ? (
        <GraniteImportModal voyage={fixedVoyage} userId={userId} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'vaziosImp' ? (
        <VaziosImportacaoImportModal voyage={fixedVoyage} userId={userId} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'baplie' ? (
        <BaplieImportModal voyage={fixedVoyage} userId={userId} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'vehicles' && canEditVehicles ? (
        <VehicleImportModal voyage={fixedVoyage} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'blFreight' ? (
        <BlImportModal
          open
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'blBreakbulk' ? (
        <BlDocumentImportModal
          voyageId={voyageId}
          voyageLabel={voyageLabel}
          onClose={() => setActiveType(null)}
        />
      ) : null}

      {activeType === 'ceMercante' ? (
        <CeMercanteImportModal open initialVoyageId={voyageId} onClose={() => setActiveType(null)} />
      ) : null}

      {activeType === 'ceMercanteGranite' ? (
        <CeMercanteImportModal open target="granite" initialVoyageId={voyageId} onClose={() => setActiveType(null)} />
      ) : null}
    </>
  )
}
