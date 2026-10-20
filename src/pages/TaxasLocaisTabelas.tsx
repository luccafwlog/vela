import { useCallback, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useSearchParams } from 'react-router-dom'
import { TabButton } from '../components/ui/TabButton'
import { TabList } from '../components/ui/TabList'
import { PageHeader } from '../components/ui/Card'
import { useAuth } from '../hooks/useAuth'
import { ChargeTablesTab } from '../components/taxasLocais/ChargeTablesTab'
import { ChargeOverridesTab } from '../components/taxasLocais/ChargeOverridesTab'
import type { CargoModeFilter, ConditionsLens, LocalChargeTab, TablesLens } from '../components/taxasLocais/chargeForms'
import { normalizeChargeTablePod } from './taxasLocaisHelpers'

// Granito só totaliza a carga e não tem taxa (lote 5b): `?modo=granito` cai
// em "Todos". ponytail: `charge_tables_cargo_mode_check` ainda aceita
// 'granito' no banco; tirar de lá pede migration própria.
const CARGO_MODES: CargoModeFilter[] = ['container', 'carga_solta']
const TABLE_LENSES: TablesLens[] = ['todas', 'aplicadas', 'nao-usadas', 'aviso', 'inativas']
const CONDITION_LENSES: ConditionsLens[] = ['todas', 'vigentes', 'futuras', 'encerradas', 'sem-efeito']

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

  // A criação abre pelo botão do título; o modal continua dono da aba.
  const [creating, setCreating] = useState(false)

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
      <PageHeader
        title="Tabelas de Taxas Locais"
        action={canEdit ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" />
            {tab === 'tabelas' ? 'Nova tabela' : 'Nova condição'}
          </Button>
        ) : undefined}
      />

      <TabList label="Cadastro de Taxas Locais" className="mb-4">
        <TabButton
          id="taxas-tab-tabelas"
          controls="taxas-panel-tabelas"
          active={tab === 'tabelas'}
          label="Tabelas"
          onClick={() => { setCreating(false); setParam('tab', 'tabelas', 'tabelas') }}
        />
        <TabButton
          id="taxas-tab-condicoes"
          controls="taxas-panel-condicoes"
          active={tab === 'overrides'}
          label="Condições de Cliente"
          onClick={() => { setCreating(false); setParam('tab', 'overrides', 'tabelas') }}
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
            creating={creating}
            onCreateDone={() => setCreating(false)}
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
            creating={creating}
            onCreateDone={() => setCreating(false)}
          />
        </div>
      )}
    </>
  )
}
