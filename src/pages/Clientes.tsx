import { useEffect, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Download, Mail, Plus, ShieldCheck, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { FilterBar } from '../components/ui/FilterBar'
import { Field, Input, Select } from '../components/ui/Input'
import { MetricCard } from '../components/ui/MetricCard'
import { PageHeader } from '../components/ui/Card'
import { WorkspaceNav } from '../components/ui/WorkspaceNav'
import { useToast } from '../components/ui/Toast'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { CreateCustomerModal } from '../components/customers/CreateCustomerModal'
import { CustomerTable, type CustomerActionsMenu } from '../components/customers/CustomerTable'
import { ImportBaseModal } from '../components/customers/ImportBaseModal'
import {
  emptyCreateCustomerForm,
  newCustomerContact,
  type CreateCustomerForm,
  type CustomerContactForm,
  type CustomerCreateErrors,
} from '../components/customers/customerCreateForm'
import { useAuth } from '../hooks/useAuth'
import { useRowSelection } from '../hooks/useRowSelection'
import { filterCustomerRowsByClientSideFilters, useCustomers, useCustomerSummary, type CustomerFilters } from '../hooks/useCustomers'
import { usePortalProvisioning } from '../hooks/usePortalProvisioning'
import { escapeFilterTerm, formatBRL, formatCountLabel } from '../lib/utils'
import { isValidCnpj } from '../lib/cnpj'
import { getCustomerFilterChips, type CustomerSortKey } from '../lib/customerTableViewModel'
import { BLS_OF_CUSTOMER } from '../lib/supabaseEmbeds'
import { compareCustomerBaseWithExisting, importCustomerBaseRows, parseCustomerBaseFile, type ParsedCustomerBase } from '../services/customerBase'
import { checkCustomerDependencies, createCustomer, deleteCustomers, fetchIssuedInvoiceBalanceByCustomer } from '../services/customers'
import { formatBlockedSummary } from '../services/deleteDependencies'
import { exportCustomerBaseWorkbook } from '../services/exports'
import { supabase } from '../services/supabase'
import type { CustomerListItem } from '../types/database'

const customerCreateSchema = z.object({
  cnpjCpf: z
    .string()
    .refine((val) => isValidCnpj(val), 'Informe um CNPJ de 14 posições válido'),
  name: z.string().min(2, 'Razão Social obrigatória (mín. 2 caracteres)'),
})

export function Clientes() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user, effectiveRole, profile, can } = useAuth()
  const canEditCustomers = Boolean(profile || user)
  const [deleting, setDeleting] = useState(false)
  const [actionsMenu, setActionsMenu] = useState<CustomerActionsMenu | null>(null)
  const [filters, setFilters] = useState<CustomerFilters>({
    search: '',
    contactEmail: '',
    emailStatus: '',
    blStatus: '',
    pendingStatus: '',
    sortKey: 'name',
    sortDirection: 'asc',
    page: 0,
    pageSize: 50,
  })
  const selectionScope = [
    filters.search,
    filters.contactEmail,
    filters.emailStatus,
    filters.blStatus,
    filters.pendingStatus,
    filters.sortKey,
    filters.sortDirection,
    filters.page,
    filters.pageSize,
  ].join('|')
  const selection = useRowSelection<number>(selectionScope)

  function setFilterField<K extends 'search' | 'contactEmail' | 'emailStatus' | 'blStatus' | 'pendingStatus'>(
    field: K,
    value: CustomerFilters[K],
  ) {
    setFilters((current) => ({ ...current, [field]: value, page: 0 }))
  }
  const activeFilterCount = (['search', 'contactEmail', 'emailStatus', 'blStatus', 'pendingStatus'] as const)
    .filter((key) => String(filters[key] ?? '').trim() !== '').length
  function clearFilters() {
    setFilters((current) => ({ ...current, search: '', contactEmail: '', emailStatus: '', blStatus: '', pendingStatus: '', page: 0 }))
  }
  function toggleSort(sortKey: CustomerSortKey) {
    setFilters((current) => ({
      ...current,
      sortKey,
      sortDirection: current.sortKey === sortKey && current.sortDirection === 'asc' ? 'desc' : 'asc',
      page: 0,
    }))
  }
  const filterChips = getCustomerFilterChips(filters)
  async function copyText(value: string, label: string) {
    await navigator.clipboard.writeText(value)
    showToast(`${label} copiado.`, 'success')
    setActionsMenu(null)
  }
  function openActionsMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    row: { id: number; name: string; cnpj_cpf: string; email: string | null },
  ) {
    if (actionsMenu?.id === row.id) {
      setActionsMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setActionsMenu({ id: row.id, top: rect.bottom + 6, left: rect.right, name: row.name, cnpj: row.cnpj_cpf, email: row.email })
  }
  // O menu flutua via position:fixed para escapar do recorte do container de scroll
  // da tabela; por isso precisa fechar quando o usuario rola, redimensiona ou clica fora.
  useEffect(() => {
    if (!actionsMenu) return
    const close = () => setActionsMenu(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-actions-menu]')) close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [actionsMenu])
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateCustomerForm>(emptyCreateCustomerForm)
  const [createErrors, setCreateErrors] = useState<CustomerCreateErrors>({})
  const [saving, setSaving] = useState(false)
  const [baseFileName, setBaseFileName] = useState('')
  const [parsedBase, setParsedBase] = useState<ParsedCustomerBase | null>(null)
  const [parsingBase, setParsingBase] = useState(false)
  const [importingBase, setImportingBase] = useState(false)
  const { data, isLoading, error } = useCustomers(filters)
  const { data: summary } = useCustomerSummary(filters)
  const canSeePortalQueue = ['administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos'].includes(effectiveRole ?? '')
  const { data: portalRows } = usePortalProvisioning(canSeePortalQueue)
  const awaitingPortalAnalysis = canSeePortalQueue
    ? (portalRows?.filter((row) => row.provisioning_decision === 'aguardando_analise').length ?? null)
    : null

  const totalPages = Math.ceil((data?.totalCount ?? 0) / filters.pageSize)

  async function handleCreateCustomer() {
    const validation = customerCreateSchema.safeParse({
      cnpjCpf: createForm.cnpjCpf,
      name: createForm.name,
    })
    if (!validation.success) {
      const fieldErrors: CustomerCreateErrors = {}
      for (const issue of validation.error.issues) {
        const field = issue.path[0] as keyof CustomerCreateErrors
        if (!fieldErrors[field]) fieldErrors[field] = issue.message
      }
      setCreateErrors(fieldErrors)
      return
    }
    setCreateErrors({})

    const activeContacts = createForm.contacts.filter(
      (contact) => contact.name.trim() || contact.email.trim() || contact.phone.trim(),
    )

    if (activeContacts.some((contact) => !contact.name.trim())) {
      showToast('Todo contato preenchido parcialmente precisa ter nome.', 'error')
      return
    }

    const primaryContact = activeContacts.find((contact) => contact.is_primary)
    if (!primaryContact || !primaryContact.email?.trim() || !primaryContact.email.includes('@')) {
      showToast('O cliente precisa ter ao menos um contato principal com e-mail válido.', 'error')
      return
    }

    setSaving(true)
    try {
      const customer = await createCustomer({
        cnpjCpf: createForm.cnpjCpf,
        name: createForm.name,
        tradeName: createForm.tradeName,
        address: createForm.address,
        city: createForm.city,
        state: createForm.state,
        zip: createForm.zip,
        notes: createForm.notes,
        contacts: activeContacts,
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
      ])

      showToast('Cliente cadastrado com sucesso.', 'success')
      setCreateOpen(false)
      setCreateForm(emptyCreateCustomerForm)
      navigate(`/clientes/${encodeURIComponent(customer.cnpj_cpf)}`)
    } catch {
      showToast('Falha ao cadastrar cliente.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleBaseFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setBaseFileName(nextFile?.name ?? '')
    setParsedBase(null)

    if (!nextFile) return

    setParsingBase(true)
    try {
      const parsed = await compareCustomerBaseWithExisting(await parseCustomerBaseFile(nextFile))
      setParsedBase(parsed)
      showToast(
        parsed.rowErrors.length
          ? `Base lida com ${parsed.rows.length} clientes validos e ${parsed.rowErrors.length} linhas ignoradas.`
          : `Base lida com ${parsed.rows.length} clientes validos.`,
        parsed.rowErrors.length ? 'info' : 'success',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível ler a base. Confira o layout do arquivo.'
      showToast(message, 'error')
    } finally {
      setParsingBase(false)
    }
  }

  async function handleImportBase() {
    if (!parsedBase?.rows.length) return

    setImportingBase(true)
    try {
      const result = await importCustomerBaseRows(parsedBase.rows, { changedBy: user?.id ?? null })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
      ])
      const linkedMsg = result.blsLinked ? ` ${formatCountLabel(result.blsLinked, 'B/L vinculado', 'B/Ls vinculados')} automaticamente.` : ''
      const failedMsg = result.errors?.length
        ? ` ${result.errors.length} cliente(s) ficaram pendentes para correção.`
        : ''
      showToast(
        `Base importada: ${formatCountLabel(result.imported, 'novo', 'novos')}, ${formatCountLabel(result.updated, 'atualizado', 'atualizados')}, ${formatCountLabel(result.contactsCreated, 'contato', 'contatos')}.${linkedMsg}${failedMsg}`,
        result.errors?.length ? 'info' : 'success',
      )
      resetImportModal()
    } catch {
      showToast('Falha ao importar base de clientes.', 'error')
    } finally {
      setImportingBase(false)
    }
  }

  async function handleExportBase() {
    try {
      let query = supabase
        .from('customers')
        .select(`*, ${BLS_OF_CUSTOMER}(id, charge_status), customer_contacts(id, email, purpose, is_primary, deactivated_at, origin, customer_contact_box_links(box_code))`)
        .order('name', { ascending: true })

      if (filters.search) {
        const search = escapeFilterTerm(filters.search)
        if (search) {
          query = query.or(
            `name.ilike.%${search}%,trade_name.ilike.%${search}%,cnpj_cpf.ilike.%${search}%`,
          )
        }
      }

      const allRows: unknown[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await query.range(from, from + 999)
        if (error) throw error
        allRows.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }

      const rowsWithBalances = allRows as CustomerListItem[]
      const balances = await fetchIssuedInvoiceBalanceByCustomer(rowsWithBalances.map((row) => row.id))
      const rows = filterCustomerRowsByClientSideFilters(
        rowsWithBalances.map((row) => ({ ...row, pending_balance: balances.get(row.id) ?? 0 })),
        filters,
      )

      await exportCustomerBaseWorkbook(rows)
      showToast(`Base exportada com ${rows.length} cliente(s).`, 'success')
    } catch {
      showToast('Falha ao exportar base de clientes.', 'error')
    }
  }

  function resetImportModal() {
    setImportOpen(false)
    setBaseFileName('')
    setParsedBase(null)
    setParsingBase(false)
    setImportingBase(false)
  }

  function resetCreateModal() {
    setCreateOpen(false)
    setCreateForm(emptyCreateCustomerForm)
    setCreateErrors({})
    setSaving(false)
  }

  async function runCustomerDelete(ids: number[]) {
    setDeleting(true)
    try {
      const report = await checkCustomerDependencies(ids)
      if (report.deletableIds.length === 0) {
        showToast(`Nenhum cliente pode ser excluido. ${formatBlockedSummary(report.blockedIds)}`, 'error')
        return
      }

      const parts = [
        `Excluir ${report.deletableIds.length} cliente(s)? Os contatos e overrides de tarifa serao excluidos junto. Esta acao e irreversivel.`,
      ]
      if (report.blockedIds.length) parts.push(formatBlockedSummary(report.blockedIds))
      const ok = await confirm({ message: parts.join('\n\n'), tone: 'danger', confirmLabel: 'Excluir' })
      if (!ok) return

      await deleteCustomers(report.deletableIds, user?.id)
      selection.clear()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customers-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
      ])
      showToast(`${report.deletableIds.length} cliente(s) excluido(s).`, 'success')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'erro desconhecido'
      showToast(`Falha ao excluir cliente(s): ${detail}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  function updateCreateField<K extends keyof Omit<CreateCustomerForm, 'contacts'>>(field: K, value: CreateCustomerForm[K]) {
    setCreateForm((current) => ({ ...current, [field]: value }))
  }

  function updateContact(index: number, patch: Partial<CustomerContactForm>) {
    setCreateForm((current) => ({
      ...current,
      contacts: current.contacts.map((contact, currentIndex) =>
        currentIndex === index ? { ...contact, ...patch } : contact,
      ),
    }))
  }

  function addContact() {
    setCreateForm((current) => ({ ...current, contacts: [...current.contacts, newCustomerContact()] }))
  }

  function removeContact(index: number) {
    setCreateForm((current) => ({
      ...current,
      contacts: current.contacts.length === 1 ? [newCustomerContact()] : current.contacts.filter((_, currentIndex) => currentIndex !== index),
    }))
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Cadastro mestre de consignatários. Importe a base antes dos manifestos para vínculo automático por CNPJ."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            {/* Importar/Exportar são utilitários de manutenção da base: ficam em
                `ghost` para não disputar atenção com a ação principal da tela. */}
            <Button variant="ghost" onClick={() => setImportOpen(true)}>
              <Upload size={16} />
              Importar base
            </Button>
            <Button variant="ghost" onClick={handleExportBase}>
              <Download size={16} />
              Exportar base
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={16} />
              Novo Cliente
            </Button>
          </div>
        }
      />

      <WorkspaceNav
        ariaLabel="Outros ambientes de Clientes"
        items={[
          {
            to: '/clientes/portal',
            label: 'Provisionamento do Portal',
            description: 'Convites, e-mails e situações de conta.',
            icon: ShieldCheck,
            count: awaitingPortalAnalysis,
            countLabel: 'Clientes aguardando análise',
          },
          ...(can('customer_communications')
            ? [{
                to: '/clientes/comunicacao',
                label: 'Comunicação',
                description: 'Comunicados e histórico de envios.',
                icon: Mail,
              } as const]
            : []),
        ]}
      />

      <div className="mb-5">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Saldo pendente" value={formatBRL(summary?.pendingBalance ?? 0)} tone="primary" />
          <MetricCard label="Clientes" value={String(summary?.totalCustomers ?? 0)} />
          <MetricCard label="B/Ls vinculados" value={String(summary?.totalBls ?? 0)} />
          <MetricCard label="Taxas pendentes" value={String(summary?.chargePending ?? 0)} />
          <MetricCard label="Faturados" value={String(summary?.chargeReady ?? 0)} />
        </div>
      </div>

      <FilterBar activeCount={activeFilterCount} onClear={clearFilters}>
        <div className="app-filter-grid">
          <Field label="Buscar por nome ou CNPJ">
            <Input
              value={filters.search}
              onChange={(event) => setFilterField('search', event.target.value)}
              placeholder="Razao social, fantasia ou documento"
            />
          </Field>
          <Field label="Buscar por e-mail do contato">
            <Input
              type="email"
              value={filters.contactEmail}
              onChange={(event) => setFilterField('contactEmail', event.target.value)}
              placeholder="email@cliente.com"
            />
          </Field>
          <Field label="E-mails vinculados">
            <Select value={filters.emailStatus} onChange={(event) => setFilterField('emailStatus', event.target.value as CustomerFilters['emailStatus'])}>
              <option value="">Todos</option>
              <option value="with">Com e-mails</option>
              <option value="without">Sem e-mails</option>
            </Select>
          </Field>
          <Field label="BLs vinculados">
            <Select value={filters.blStatus} onChange={(event) => setFilterField('blStatus', event.target.value as CustomerFilters['blStatus'])}>
              <option value="">Todos</option>
              <option value="with">Com B/Ls</option>
              <option value="without">Sem B/Ls</option>
            </Select>
          </Field>
          <Field label="Valores pendentes">
            <Select value={filters.pendingStatus} onChange={(event) => setFilterField('pendingStatus', event.target.value as CustomerFilters['pendingStatus'])}>
              <option value="">Todos</option>
              <option value="with">Com saldo pendente</option>
              <option value="without">Sem saldo pendente</option>
            </Select>
          </Field>
        </div>
      </FilterBar>

      {filterChips.length ? (
        <div className="app-filter-chips">
          {filterChips.map((chip) => (
            <button key={chip.key} type="button" className="app-filter-chip" onClick={() => setFilterField(chip.key, '' as never)}>
              {chip.label}
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}

      {canEditCustomers ? (
        <BulkActionsBar
          count={selection.count}
          onClear={selection.clear}
          onDelete={() => runCustomerDelete([...selection.selected])}
          deleting={deleting}
          noun={['cliente', 'clientes']}
        />
      ) : null}

      <CustomerTable
        data={data}
        isLoading={isLoading}
        error={error}
        canEditCustomers={canEditCustomers}
        selection={selection}
        filters={filters}
        totalPages={totalPages}
        actionsMenu={actionsMenu}
        deleting={deleting}
        onToggleSort={toggleSort}
        onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
        onOpenActionsMenu={openActionsMenu}
        onCopy={copyText}
        onDeleteCustomer={(id) => {
          setActionsMenu(null)
          void runCustomerDelete([id])
        }}
        portalRows={portalRows ?? undefined}
      />

      <CreateCustomerModal
        open={createOpen}
        form={createForm}
        errors={createErrors}
        saving={saving}
        onClose={resetCreateModal}
        onSubmit={() => void handleCreateCustomer()}
        onFieldChange={updateCreateField}
        onContactChange={updateContact}
        onAddContact={addContact}
        onRemoveContact={removeContact}
      />

      <ImportBaseModal
        open={importOpen}
        baseFileName={baseFileName}
        parsedBase={parsedBase}
        parsingBase={parsingBase}
        importingBase={importingBase}
        onClose={resetImportModal}
        onFileChange={(event) => void handleBaseFile(event)}
        onImport={() => void handleImportBase()}
      />
    </>
  )
}
