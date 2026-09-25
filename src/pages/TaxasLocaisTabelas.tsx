import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TabButton } from '../components/ui/TabButton'
import { PageHeader } from '../components/ui/Card'
import { useAuth } from '../hooks/useAuth'
import { ChargeTablesTab } from '../components/taxasLocais/ChargeTablesTab'
import { ChargeOverridesTab } from '../components/taxasLocais/ChargeOverridesTab'
import type { CargoModeFilter, LocalChargeTab } from '../components/taxasLocais/chargeForms'

export function TaxasLocaisTabelas() {
  const { profile, user, isAdmin } = useAuth()
  // Visualização é global para todo perfil interno ativo; `can(...)` só
  // decide o que pode ser alterado (docs/archive/audits/2026-08-13-rbac-
  // departamentos-visualizacao.md, Achado P1).
  const canManageTables = Boolean(profile || user)
  const canManageOverrides = Boolean(profile || user)
  // Excluir item e override e do Administrativo no banco.
  const canDelete = isAdmin
  const [searchParams] = useSearchParams()
  const initialCustomerSearch = searchParams.get('cliente') ?? ''
  const [tab, setTab] = useState<LocalChargeTab>(searchParams.get('tab') === 'overrides' ? 'overrides' : 'tabelas')
  const [cargoModeFilter, setCargoModeFilter] = useState<CargoModeFilter>('')
  const [podFilter, setPodFilter] = useState('')

  return (
    <>
      <PageHeader
        title="Tabelas de Taxas Locais"
        description="Motor de cálculo por POD/modo de carga, overrides por cliente e pendências de revisão."
      />

      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        <TabButton active={tab === 'tabelas'} label="Tabelas" onClick={() => setTab('tabelas')} />
        <TabButton active={tab === 'overrides'} label="Overrides" onClick={() => setTab('overrides')} />
      </div>

      {tab === 'tabelas' ? (
        <ChargeTablesTab
          cargoModeFilter={cargoModeFilter}
          setCargoModeFilter={setCargoModeFilter}
          podFilter={podFilter}
          setPodFilter={setPodFilter}
          canEdit={canManageTables}
          canDelete={canDelete}
        />
      ) : null}

      {tab === 'overrides' ? (
        <ChargeOverridesTab
          cargoModeFilter={cargoModeFilter}
          setCargoModeFilter={setCargoModeFilter}
          podFilter={podFilter}
          setPodFilter={setPodFilter}
          initialCustomerSearch={initialCustomerSearch}
          canEdit={canManageOverrides}
          canDelete={canDelete}
        />
      ) : null}
    </>
  )
}
