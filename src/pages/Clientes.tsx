import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Download, Plus, Search, Upload } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Field, Input, Select } from '../components/ui/Input'
import { MetricCard } from '../components/ui/MetricCard'
import { NoValue } from '../components/ui/NoValue'
import { EmptyState, PageHeader } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'
import { useConfirm, useConfirmWithReason } from '../components/ui/ConfirmDialog'
import { BulkActionsBar } from '../components/shared/BulkActionsBar'
import { QueryStateGate } from '../components/shared/QueryStateGate'
import { useNarrowViewport } from '../components/bl/useNarrowViewport'
import { CreateCustomerModal } from '../components/customers/CreateCustomerModal'
import { CustomerTable } from '../components/customers/CustomerTable'
import { ClientesTabs } from '../components/customers/ClientesTabs'
import { ImportBaseModal, type CustomerBaseRefusal } from '../components/customers/ImportBaseModal'
import {
  emptyCreateCustomerForm,
  newCustomerContact,
  type CreateCustomerForm,
  type CustomerContactForm,
  type CustomerCreateErrors,
} from '../components/customers/customerCreateForm'
import { useAuth } from '../hooks/useAuth'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useRowSelection } from '../hooks/useRowSelection'
import { fetchCustomerRows, useCustomers, useCustomerSummary, type CustomerFilters } from '../hooks/useCustomers'
import { usePortalProvisioning } from '../hooks/usePortalProvisioning'
import { formatBRL, formatCnpjCpf, formatCountLabel } from '../lib/utils'
import { userFacingErrorMessage } from '../lib/errors'
import { isValidCnpj } from '../lib/cnpj'
import { type CustomerSortKey } from '../lib/customerTableViewModel'
import { CUSTOMER_COMMUNICATION_BOXES } from '../services/customerCommunicationBoxes'
import { compareCustomerBaseWithExisting, customerNameChanges, importCustomerBaseRows, parseCustomerBaseFile, type ParsedCustomerBase } from '../services/customerBase'
import { afterBlRevisado, afterCargaAlterada } from '../services/cacheEffects'
import { checkCustomerDependencies, createCustomer, deleteCustomers } from '../services/customers'
import { buildDeleteAffected, formatDeleteOutcome } from '../services/deleteDependencies'
import { exportCustomerBaseWorkbook } from '../services/exports'
import {
  EMPTY_CUSTOMER_FILTERS,
  clientesSearchFromFilters,
  filtersFromClientesSearch,
  rememberClientesListSearch,
} from './clientesListState'

const customerCreateSchema = z.object({
  cnpjCpf: z
    .string()
    .refine((val) => isValidCnpj(val), 'Informe um CNPJ de 14 posições válido'),
  name: z.string().trim().min(2, 'Informe a razão social (mínimo de 2 caracteres)'),
})

type PanelFilterKey = 'contactEmail' | 'emailStatus' | 'blStatus' | 'pendingStatus'
const PANEL_FILTER_KEYS: PanelFilterKey[] = ['contactEmail', 'emailStatus', 'blStatus', 'pendingStatus']

export function Clientes() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const { user, effectiveRole, isAdmin } = useAuth()
  const narrow = useNarrowViewport()
  // Excluir e desativar exigem o Administrativo no banco; a tela só oferece
  // as ações a quem pode executá-las.
  const canDeleteCustomers = isAdmin
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Busca, filtros, ordem e página vivem na URL: voltar da ficha, recarregar ou
  // compartilhar o endereço reabre a mesma lista.
  const [filters, setFilters] = useState<CustomerFilters>(() => filtersFromClientesSearch(searchParams))
  const listSearch = clientesSearchFromFilters(filters)
  // Última query string que a própria página gravou. Uma URL diferente dela
  // veio de fora (menu "Clientes", Alerta, link com ?saldo=): a URL vence e o
  // recorte é relido dela, em vez de ser sobrescrito pelo estado antigo.
  const writtenSearch = useRef(searchParams.toString())
  useEffect(() => {
    const urlSearch = searchParams.toString()
    if (urlSearch !== writtenSearch.current) {
      writtenSearch.current = urlSearch
      setFilters(filtersFromClientesSearch(searchParams))
      return
    }
    if (listSearch !== urlSearch) {
      writtenSearch.current = listSearch
      setSearchParams(new URLSearchParams(listSearch), { replace: true })
    }
    rememberClientesListSearch(listSearch)
  }, [listSearch, searchParams, setSearchParams])

  // A busca consulta o banco: espera a pausa da digitação.
  const debouncedSearch = useDebouncedValue(filters.search)
  const queryFilters = useMemo(() => ({ ...filters, search: debouncedSearch }), [filters, debouncedSearch])

  const selectionScope = clientesSearchFromFilters(queryFilters)
  const selection = useRowSelection<number>(selectionScope)

  function setFilterField<K extends 'search' | PanelFilterKey>(field: K, value: CustomerFilters[K]) {
    setFilters((current) => ({ ...current, [field]: value, page: 0 }))
  }
  function togglePresence(field: 'emailStatus' | 'pendingStatus', value: 'with' | 'without') {
    setFilterField(field, filters[field] === value ? '' : value)
  }
  const panelFilterCount = PANEL_FILTER_KEYS.filter((key) => String(filters[key] ?? '').trim() !== '').length
  const hasAnyFilter = panelFilterCount > 0 || filters.search.trim() !== ''
  function clearFilters() {
    setFilters((current) => ({ ...EMPTY_CUSTOMER_FILTERS, sortKey: current.sortKey, sortDirection: current.sortDirection }))
  }
  function toggleSort(sortKey: CustomerSortKey) {
    setFilters((current) => ({
      ...current,
      sortKey,
      sortDirection: current.sortKey === sortKey && current.sortDirection === 'asc' ? 'desc' : 'asc',
      page: 0,
    }))
  }
  async function copyText(value: string, label: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível')
      await navigator.clipboard.writeText(value)
      showToast(`${label} copiado.`, 'success')
    } catch {
      showToast(`Não foi possível copiar o ${label}.`, 'error')
    }
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateCustomerForm>(emptyCreateCustomerForm)
  const [createErrors, setCreateErrors] = useState<CustomerCreateErrors>({})
  const [saving, setSaving] = useState(false)
  const [baseFile, setBaseFile] = useState<File | null>(null)
  const [baseReadError, setBaseReadError] = useState<string | null>(null)
  const [baseWriteError, setBaseWriteError] = useState<string | null>(null)
  const [baseRefused, setBaseRefused] = useState<CustomerBaseRefusal | null>(null)
  const [parsedBase, setParsedBase] = useState<ParsedCustomerBase | null>(null)
  const [parsingBase, setParsingBase] = useState(false)
  const [importingBase, setImportingBase] = useState(false)
  const { data, isLoading, error, fetchStatus, refetch } = useCustomers(queryFilters)
  const summaryQuery = useCustomerSummary(queryFilters)
  const summary = summaryQuery.data
  const canSeePortalQueue = ['administrativo', 'documentacao', 'financeiro', 'operacoes', 'equipamentos'].includes(effectiveRole ?? '')
  const { data: portalRows, isLoading: portalLoading, isError: portalError } = usePortalProvisioning(canSeePortalQueue)

  const totalPages = Math.ceil((data?.totalCount ?? 0) / filters.pageSize)

  // Link com ?pagina= além do total (lista que encolheu, URL antiga): vai para
  // a última página que existe em vez de mostrar o vazio.
  const pageOutOfRange = Boolean(data && data.totalCount > 0 && filters.page >= totalPages)
  if (pageOutOfRange) setFilters((current) => ({ ...current, page: Math.max(0, totalPages - 1) }))

  // O resumo é uma consulta própria: falha ou carregamento vira o traço discreto, nunca zero.
  const metric = (value: number | undefined, format: (n: number) => string = String) =>
    summary && value !== undefined ? format(value) : <NoValue label="Resumo indisponível" />

  async function handleCreateCustomer() {
    const validation = customerCreateSchema.safeParse({
      cnpjCpf: createForm.cnpjCpf,
      name: createForm.name,
    })
    const fieldErrors: CustomerCreateErrors = {}
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const field = issue.path[0] as 'cnpjCpf' | 'name'
        if (!fieldErrors[field]) fieldErrors[field] = issue.message
      }
    }

    const activeContacts = createForm.contacts.filter(
      (contact) => contact.name.trim() || contact.email.trim() || contact.phone.trim(),
    )
    const primaryContact = activeContacts.find((contact) => contact.is_primary)
    if (activeContacts.some((contact) => !contact.name.trim())) {
      fieldErrors.contacts = 'Informe o nome de todo contato preenchido.'
    } else if (!primaryContact || !primaryContact.email?.trim() || !primaryContact.email.includes('@')) {
      fieldErrors.contacts = 'O contato principal precisa de um e-mail válido.'
    }

    setCreateErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return

    const confirmed = await confirm({
      title: 'Cadastrar cliente',
      message: `Cadastrar o cliente "${createForm.name.trim()}" (${formatCnpjCpf(createForm.cnpjCpf)})?`,
      confirmLabel: 'Cadastrar cliente',
      affected: {
        summary: `${createForm.name.trim()} · CNPJ ${formatCnpjCpf(createForm.cnpjCpf)} · ${formatCountLabel(activeContacts.length, 'contato', 'contatos')}`,
        items: activeContacts.map((c) => `${c.name} (${c.email || 'sem e-mail'})${c.is_primary ? ' · principal' : ''}`),
      },
      consequence: 'O cliente entra no cadastro ativo, pode ser vinculado a B/Ls e aparece na fila de Provisionamento do Portal como "Aguardando análise". Nenhum convite é enviado.',
      reversibility: 'Os dados podem ser editados na ficha; cadastros sem vínculos operacionais podem ser desativados ou excluídos pelo Administrativo.',
    })
    if (!confirmed) return

    setSaving(true)
    try {
      const customer = await createCustomer({
        cnpjCpf: createForm.cnpjCpf,
        name: createForm.name.trim(),
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
        queryClient.invalidateQueries({ queryKey: ['customers-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
      ])

      showToast('Cliente cadastrado.', 'success')
      setCreateOpen(false)
      setCreateForm(emptyCreateCustomerForm)
      navigate(`/clientes/${encodeURIComponent(customer.cnpj_cpf)}`)
    } catch (cause) {
      // O formulário continua aberto com o motivo junto dos botões.
      setCreateErrors({ submit: userFacingErrorMessage(cause, 'Não foi possível cadastrar o cliente. Confira os dados e tente de novo.') })
    } finally {
      setSaving(false)
    }
  }

  async function handleBaseFile(nextFile: File | null) {
    setBaseFile(nextFile)
    setParsedBase(null)
    setBaseReadError(null)
    setBaseWriteError(null)
    setBaseRefused(null)

    if (!nextFile) return

    setParsingBase(true)
    try {
      const parsed = await compareCustomerBaseWithExisting(await parseCustomerBaseFile(nextFile))
      setParsedBase(parsed)
    } catch (error) {
      setBaseReadError(error instanceof Error ? error.message : 'Não foi possível ler a base. Confira o layout do arquivo.')
    } finally {
      setParsingBase(false)
    }
  }

  // Regra de 2026-10-19: a base inteira é gravada numa chamada (migration 326);
  // se o banco recusa um Cliente, nada é gravado e o modal lista a recusa. O
  // aceite dos avisos no modal cobre a troca de razão social.
  async function handleImportBase(confirmNameChange: boolean) {
    if (!parsedBase?.rows.length || parsedBase.rowErrors.length) return

    setImportingBase(true)
    setBaseWriteError(null)
    try {
      const result = await importCustomerBaseRows(parsedBase.rows, {
        changedBy: user?.id ?? null,
        confirmNameChange: confirmNameChange && customerNameChanges(parsedBase.rows).length > 0,
      })
      if (!result.ok) {
        setBaseRefused(result.errors)
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customers-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
        // B/L vinculado pela Base sai da Revisão e segue para o faturamento (ADR 0078, item 24).
        result.blsLinked ? afterBlRevisado(queryClient) : Promise.resolve(),
        result.blsLinked ? afterCargaAlterada(queryClient) : queryClient.invalidateQueries({ queryKey: ['bls'] }),
      ])
      const linkedMsg = result.blsLinked ? ` ${formatCountLabel(result.blsLinked, 'B/L vinculado', 'B/Ls vinculados')} automaticamente.` : ''
      showToast(
        `Base importada: ${formatCountLabel(result.imported, 'novo', 'novos')}, ${formatCountLabel(result.updated, 'atualizado', 'atualizados')}, ${formatCountLabel(result.contactsCreated, 'contato', 'contatos')}.${linkedMsg}`,
        'success',
      )
      resetImportModal()
    } catch (cause) {
      // O motivo fica no modal, junto da prévia, e não só num toast.
      setBaseWriteError(userFacingErrorMessage(cause, 'A gravação falhou. Tente de novo em instantes.'))
    } finally {
      setImportingBase(false)
    }
  }

  // Exporta exatamente o recorte da lista (busca por documento, filtros e
  // ordem), todas as páginas.
  async function handleExportBase() {
    setExporting(true)
    try {
      const { rows } = await fetchCustomerRows({ ...queryFilters, page: 0 }, false)
      if (!rows.length) {
        showToast('Nenhum cliente no recorte atual para exportar.', 'info')
        return
      }
      await exportCustomerBaseWorkbook(rows)
      showToast(`Base exportada com ${formatCountLabel(rows.length, 'cliente', 'clientes')}.`, 'success')
    } catch {
      showToast('Falha ao exportar base de clientes.', 'error')
    } finally {
      setExporting(false)
    }
  }

  function resetImportModal() {
    setImportOpen(false)
    setBaseFile(null)
    setBaseReadError(null)
    setBaseWriteError(null)
    setBaseRefused(null)
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
        await confirm({
          title: 'Excluir cliente',
          message: 'Nenhum cliente selecionado pode ser excluído.',
          affected: { summary: `${report.blockedIds.length} cliente(s) bloqueado(s).`, blocked: buildDeleteAffected('cliente(s)', report).blocked },
          consequence: 'Nada foi alterado. Para tirar o cliente das listas sem apagá-lo, use Desativar cliente.',
          tone: 'primary',
          noticeOnly: true,
        })
        return
      }

      const reason = await confirmWithReason({
        title: 'Excluir cliente',
        message: `Excluir ${report.deletableIds.length} cliente(s)?`,
        affected: buildDeleteAffected('cliente(s)', report),
        consequence: 'Os clientes saem das listas e das escolhas; contatos e overrides de tarifa deles são apagados junto.',
        reversibility: 'Não é possível desfazer pelo sistema; o registro apagado fica guardado na auditoria.',
        confirmLabel: 'Excluir',
        tone: 'danger',
      })
      if (reason === null) return

      const result = await deleteCustomers(report.deletableIds, reason)
      selection.clear()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customers-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
      ])
      const outcome = formatDeleteOutcome('cliente(s)', result)
      showToast(outcome.message, outcome.tone)
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

  // Um único principal: escolher outro desmarca o anterior. O principal nasce
  // em todas as caixas (CONTEXT.md, "Caixa de Comunicação"); o anterior mantém
  // as caixas que já tinha.
  function setPrimaryContact(index: number) {
    const allBoxes = CUSTOMER_COMMUNICATION_BOXES.map((box) => box.code)
    setCreateForm((current) => ({
      ...current,
      contacts: current.contacts.map((contact, currentIndex) =>
        currentIndex === index
          ? { ...contact, is_primary: true, box_codes: Array.from(new Set([...contact.box_codes, ...allBoxes])) }
          : { ...contact, is_primary: false },
      ),
    }))
  }

  function addContact() {
    setCreateForm((current) => ({ ...current, contacts: [...current.contacts, newCustomerContact()] }))
  }

  function removeContact(index: number) {
    setCreateForm((current) => {
      if (current.contacts.length === 1) return { ...current, contacts: [newCustomerContact(true)] }
      const removedPrimary = current.contacts[index]?.is_primary
      const contacts = current.contacts.filter((_, currentIndex) => currentIndex !== index)
      // Sem principal o cadastro é recusado: o primeiro restante assume.
      if (removedPrimary && contacts[0]) contacts[0] = { ...contacts[0], is_primary: true, box_codes: CUSTOMER_COMMUNICATION_BOXES.map((box) => box.code) }
      return { ...current, contacts }
    })
  }

  const emptyState = hasAnyFilter ? (
    <EmptyState
      icon={Search}
      title="Nenhum cliente com esses filtros"
      description="Confira a grafia, busque pelo CNPJ ou limpe os filtros."
      action={<Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>}
    />
  ) : (
    <EmptyState
      title="Nenhum cliente cadastrado"
      description="Importe a base antes dos manifestos: B/Ls com o mesmo CNPJ são vinculados automaticamente."
      action={(
        <div className="app-customer-empty-actions">
          <Button onClick={() => setImportOpen(true)}><Upload size={16} aria-hidden="true" />Importar base</Button>
          <Button variant="secondary" onClick={() => setCreateOpen(true)}><Plus size={16} aria-hidden="true" />Novo cliente</Button>
        </div>
      )}
    />
  )

  return (
    <>
      <PageHeader
        title="Clientes"
        action={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} aria-hidden="true" />
              Importar base
            </Button>
            <Button variant="secondary" loading={exporting} loadingLabel="Exportando…" onClick={() => void handleExportBase()}>
              <Download size={16} aria-hidden="true" />
              Exportar base
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              Novo cliente
            </Button>
          </>
        }
      />

      <ClientesTabs active="clientes" />

      <div className="app-metric-row" role="group" aria-label="Totais do recorte">
        <MetricCard label="Clientes" value={metric(summary?.totalCustomers)} />
        <MetricCard label="B/Ls vinculados" value={metric(summary?.totalBls)} />
        <MetricCard
          label="Saldo pendente"
          value={metric(summary?.pendingBalance, formatBRL)}
          tone={(summary?.pendingBalance ?? 0) > 0 ? 'warning' : 'secondary'}
          selected={filters.pendingStatus === 'with'}
          onSelect={() => togglePresence('pendingStatus', 'with')}
        />
        <MetricCard
          label="Taxas a revisar"
          value={metric(summary?.chargePending)}
          tone={(summary?.chargePending ?? 0) > 0 ? 'warning' : 'secondary'}
        />
        <MetricCard
          label="Sem e-mail de contato"
          value={metric(summary?.customersWithoutEmail)}
          tone={(summary?.customersWithoutEmail ?? 0) > 0 ? 'warning' : 'secondary'}
          selected={filters.emailStatus === 'without'}
          onSelect={() => togglePresence('emailStatus', 'without')}
        />
      </div>
      {summaryQuery.isError ? <p className="app-customer-note" role="alert">Totais indisponíveis; aparecem como —.</p> : null}

      <div className="app-filter-grid">
        <Field label="Buscar cliente">
          <Input
            type="search"
            value={filters.search}
            onChange={(event) => setFilterField('search', event.target.value)}
            placeholder="Razão social, nome fantasia ou CNPJ"
          />
        </Field>
        <Field label="E-mail do contato">
          <Input
            type="email"
            value={filters.contactEmail}
            onChange={(event) => setFilterField('contactEmail', event.target.value)}
            placeholder="email@cliente.com"
          />
        </Field>
        <Field label="B/Ls vinculados">
          <Select value={filters.blStatus} onChange={(event) => setFilterField('blStatus', event.target.value as CustomerFilters['blStatus'])}>
            <option value="">Todos</option>
            <option value="with">Com B/Ls</option>
            <option value="without">Sem B/Ls</option>
          </Select>
        </Field>
        <Field label="Saldo pendente">
          <Select value={filters.pendingStatus} onChange={(event) => setFilterField('pendingStatus', event.target.value as CustomerFilters['pendingStatus'])}>
            <option value="">Todos</option>
            <option value="with">Com saldo pendente</option>
            <option value="without">Sem saldo pendente</option>
          </Select>
        </Field>
        <Field label="E-mails de contato">
          <Select value={filters.emailStatus} onChange={(event) => setFilterField('emailStatus', event.target.value as CustomerFilters['emailStatus'])}>
            <option value="">Todos</option>
            <option value="with">Com e-mail</option>
            <option value="without">Sem e-mail</option>
          </Select>
        </Field>
        {hasAnyFilter ? <div><Button variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div> : null}
      </div>

      {canDeleteCustomers ? (
        <BulkActionsBar
          count={selection.count}
          onClear={selection.clear}
          onDelete={() => runCustomerDelete([...selection.selected])}
          deleting={deleting}
          noun={['cliente', 'clientes']}
        />
      ) : null}

      <QueryStateGate
        isLoading={isLoading}
        isError={Boolean(error)}
        isPaused={fetchStatus === 'paused'}
        hasData={data !== undefined}
        errorMessage="Não foi possível carregar os clientes."
        onRetry={() => void refetch()}
      >
        <CustomerTable
          data={data}
          canDeleteCustomers={canDeleteCustomers}
          selection={selection}
          filters={filters}
          totalPages={totalPages}
          deleting={deleting}
          narrow={narrow}
          emptyState={emptyState}
          onToggleSort={toggleSort}
          onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
          onCopy={copyText}
          onDeleteCustomer={(id) => void runCustomerDelete([id])}
          portalRows={portalRows ?? undefined}
          portalStatus={portalError ? 'error' : portalLoading ? 'loading' : 'ready'}
        />
      </QueryStateGate>

      <CreateCustomerModal
        open={createOpen}
        form={createForm}
        errors={createErrors}
        saving={saving}
        // Fechar durante a gravação deixaria o resultado cair num modal
        // fechado (erro antigo na próxima abertura, segundo cadastro).
        onClose={() => { if (!saving) resetCreateModal() }}
        onSubmit={() => void handleCreateCustomer()}
        onFieldChange={updateCreateField}
        onContactChange={updateContact}
        onSetPrimary={setPrimaryContact}
        onAddContact={addContact}
        onRemoveContact={removeContact}
      />

      <ImportBaseModal
        open={importOpen}
        baseFile={baseFile}
        readError={baseReadError}
        writeError={baseWriteError}
        refused={baseRefused}
        parsedBase={parsedBase}
        parsingBase={parsingBase}
        importingBase={importingBase}
        onClose={() => { if (!importingBase) resetImportModal() }}
        onFileSelect={(file) => void handleBaseFile(file)}
        onImport={(confirmNameChange) => void handleImportBase(confirmNameChange)}
      />
    </>
  )
}
