import type { Dispatch, SetStateAction } from 'react'
import { Save, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select } from '../ui/Input'
import type { LocalChargeTableWithItems } from '../../services/charges/chargeTableService'
import { EMPTY_TABLE_ITEM_FORM, type ChargeTableItemForm } from './chargeForms'

type ChargeTableItemFormCardProps = {
  tables: LocalChargeTableWithItems[]
  tableItemForm: ChargeTableItemForm
  setTableItemForm: Dispatch<SetStateAction<ChargeTableItemForm>>
  onSave: () => void
  saving: boolean
}

export function ChargeTableItemFormCard({
  tables,
  tableItemForm,
  setTableItemForm,
  onSave,
  saving,
}: ChargeTableItemFormCardProps) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="app-table__cell-stack">
          <h2 className="app-panel__title">{tableItemForm.id ? 'Editar item de taxa' : 'Novo item de taxa'}</h2>
          <div className="app-table__cell-meta">Mantenha a granularidade da regra aqui, sem inflar a grade principal.</div>
        </div>
        {tableItemForm.id ? (
          <Button variant="ghost" type="button" onClick={() => setTableItemForm(EMPTY_TABLE_ITEM_FORM)}>
            <X size={15} />
            Cancelar edição
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tabela">
          <Select
            value={tableItemForm.chargeTableId}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                chargeTableId: event.target.value,
              }))
            }
          >
            <option value="">Selecione</option>
            {tables.map((table) => (
              <option key={table.id} value={table.id}>
                {table.cargo_mode === 'carga_solta' ? 'BB' : table.cargo_mode === 'granito' ? 'GRA' : 'CNTR'} | {table.pod ?? '-'} | {table.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nome do item">
          <Input
            value={tableItemForm.name}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
            placeholder="THD / BL Fee / ISPS"
          />
        </Field>
        <Field label="Categoria">
          <Select
            value={tableItemForm.category}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                category: event.target.value as 'base' | 'other_charge',
              }))
            }
          >
            <option value="base">Base</option>
            <option value="other_charge">Other charge</option>
          </Select>
        </Field>
        {/* Etapa 7 do plano de faturamento (ADR 0038 achado 1): TEU tirado do
            seletor porque o motor de cálculo nunca implementou essa base —
            um item cadastrado como TEU hoje é sinalizado como
            review_required (migration 264), não removido; se algum dia
            TEU for implementado, reintroduzir a opção aqui. */}
        <Field label="Base de aplicacao">
          <Select
            value={tableItemForm.applicationBasis}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                applicationBasis: event.target.value as 'bl' | 'container_distinct_voyage' | 'weight_ton' | 'teu',
              }))
            }
          >
            <option value="bl">B/L</option>
            <option value="container_distinct_voyage">Container distinto por viagem</option>
            <option value="weight_ton">Tonelada</option>
            {/* Achado 10 da review da PR 501: migration 264 sinaliza itens TEU
                como review_required, mas nao os remove/migra no banco. Sem
                esta opcao condicional, editar um item existente com
                applicationBasis='teu' mostrava o <select> em branco/invalido
                (nenhuma <option> casava o value atual). Mantida so quando o
                item aberto ja e 'teu', marcada como legado/desabilitada para
                nao ser escolhida em itens novos. */}
            {tableItemForm.applicationBasis === 'teu' ? (
              <option value="teu" disabled>
                TEU (legado, não suportado)
              </option>
            ) : null}
          </Select>
        </Field>
        <Field label="Perfil">
          <Select
            value={tableItemForm.cargoProfile}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                cargoProfile: event.target.value as 'standard' | 'imo' | 'oog' | 'any',
              }))
            }
          >
            <option value="any">Qualquer</option>
            <option value="standard">Padrao</option>
            <option value="imo">IMO</option>
            <option value="oog">OOG</option>
          </Select>
        </Field>
        <Field label="Moeda">
          <Select
            value={tableItemForm.currency}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                currency: event.target.value as 'BRL' | 'USD',
              }))
            }
          >
            <option value="BRL">BRL</option>
            <option value="USD">USD</option>
          </Select>
        </Field>
        <Field label="Valor unitario">
          <Input
            value={tableItemForm.unitValue}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                unitValue: event.target.value,
              }))
            }
            placeholder="0.00"
          />
        </Field>
        <Field label="Ordem de exibição">
          <Input
            value={tableItemForm.sortOrder}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                sortOrder: event.target.value,
              }))
            }
            placeholder="100"
          />
        </Field>
        <Field label="Apenas manual">
          <Select
            value={tableItemForm.manualOnly ? '1' : '0'}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                manualOnly: event.target.value === '1',
              }))
            }
          >
            <option value="0">Nao</option>
            <option value="1">Sim</option>
          </Select>
        </Field>
        <Field label="Cobra de container SOC" hint="Não: containers SOC (do cliente) ficam fora da quantidade, como Drop Off e Damage Protection.">
          <Select
            value={tableItemForm.appliesToSoc ? '1' : '0'}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                appliesToSoc: event.target.value === '1',
              }))
            }
          >
            <option value="1">Sim</option>
            <option value="0">Nao</option>
          </Select>
        </Field>
        <Field label="Ativo">
          <Select
            value={tableItemForm.active ? '1' : '0'}
            onChange={(event) =>
              setTableItemForm((current) => ({
                ...current,
                active: event.target.value === '1',
              }))
            }
          >
            <option value="1">Sim</option>
            <option value="0">Nao</option>
          </Select>
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="button" onClick={onSave} loading={saving}>
          <Save size={15} />
          {tableItemForm.id ? 'Salvar item' : 'Criar item'}
        </Button>
      </div>
    </Card>
  )
}
