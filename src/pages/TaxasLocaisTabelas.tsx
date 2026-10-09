import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { PageHeader } from '../components/ui/Card'
import { useAuth } from '../hooks/useAuth'
import { ChargeTablesTab } from '../components/taxasLocais/ChargeTablesTab'
import { ChargeOverridesTab } from '../components/taxasLocais/ChargeOverridesTab'
import type { CargoModeFilter, ConditionsLens, LocalChargeTab, TablesLens } from '../components/taxasLocais/chargeForms'
import { normalizeChargeTablePod } from './taxasLocaisHelpers'

const CARGO_MODES: CargoModeFilter[] = ['container', 'carga_solta', 'granito']
const TABLE_LENSES: TablesLens[] = ['todas', 'aplicadas', 'aviso', 'inativas']
const CONDITION_LENSES: ConditionsLens[] = ['todas', 'vigentes', 'futuras', 'encerradas']

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function TaxasLocaisTabelas() {
  const { profile, user, isAdmin } = useAuth()
  // Visualização é global para todo perfil interno ativo; `can(...)` só
  // decide o que pode ser alterado (docs/archive/audits/2026-08-13-rbac-
  // departamentos-visualizacao.md, Achado P1).
  const canEdit = Boolean(profile || user)
  // Excluir, desativar e reativar são do Administrativo no banco (ADR 0073).
  const canDelete = Boolean(isAdmin)
  const [searchParams, setSearchParams] = useSearchParams()

  // O recorte vive na URL (aba, modo, POD, lente, Cliente): voltar de outra
  // tela ou compartilhar o link mantém o que a pessoa estava olhando. `tab`
  // continua `overrides` para os links já existentes (ficha do Cliente,
  // redirecionamento de /faturamento).
  const tab: LocalChargeTab = searchParams.get('tab') === 'overrides' ? 'overrides' : 'tabelas'
  const cargoModeFilter = pick(searchParams.get('modo'), CARGO_MODES, '')
  const podFilter = normalizeChargeTablePod(searchParams.get('pod'))
  const tablesLens = pick(searchParams.get('lente'), TABLE_LENSES, 'todas')
  const conditionsLens = pick(searchParams.get('vigencia'), CONDITION_LENSES, 'todas')
  const customerSearch = searchParams.get('cliente') ?? ''

  const setParam = useCallback((key: string, value: string, fallback = '') => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (!value || value === fallback) next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const filterProps = {
    cargoModeFilter,
    setCargoModeFilter: (value: CargoModeFilter) => setParam('modo', value),
    podFilter,
    setPodFilter: (value: string) => setParam('pod', value),
  }

  return (
    <>
      <PageHeader title="Tabelas de Taxas Locais" />

      <TabList label="Cadastro de Taxas Locais" className="mb-4">
        <TabButton
          id="taxas-tab-tabelas"
          controls="taxas-panel-tabelas"
          active={tab === 'tabelas'}
          label="Tabelas"
          onClick={() => setParam('tab', 'tabelas', 'tabelas')}
        />
        <TabButton
          id="taxas-tab-condicoes"
          controls="taxas-panel-condicoes"
          active={tab === 'overrides'}
          label="Condições de Cliente"
          onClick={() => setParam('tab', 'overrides', 'tabelas')}
        />
      </TabList>

      {tab === 'tabelas' ? (
        <div role="tabpanel" id="taxas-panel-tabelas" aria-labelledby="taxas-tab-tabelas">
          <ChargeTablesTab
            {...filterProps}
            lens={tablesLens}
            setLens={(value) => setParam('lente', value, 'todas')}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </div>
      ) : (
        <div role="tabpanel" id="taxas-panel-condicoes" aria-labelledby="taxas-tab-condicoes">
          <ChargeOverridesTab
            {...filterProps}
            lens={conditionsLens}
            setLens={(value) => setParam('vigencia', value, 'todas')}
            customerSearch={customerSearch}
            setCustomerSearch={(value) => setParam('cliente', value)}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </div>
      )}
    </>
  )
}
