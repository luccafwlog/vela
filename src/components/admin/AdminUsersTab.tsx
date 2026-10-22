import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, TriangleAlert, UserCheck, UserX } from 'lucide-react'
import { Block } from '../ui/Block'
import { Button } from '../ui/Button'
import { Field, Input, Select } from '../ui/Input'
import { NoValue } from '../ui/NoValue'
import { RowActionButton } from '../ui/RowActionButton'
import { StatusText } from '../ui/StatusText'
import { useToast } from '../ui/Toast'
import { useConfirm, useConfirmWithReason } from '../ui/ConfirmDialog'
import { QueryStateGate } from '../shared/QueryStateGate'
import { EditarAcessoModal, type EditarAcessoInput } from './EditarAcessoModal'
import { NovoUsuarioModal } from './NovoUsuarioModal'
import { PermissionMatrixBlock } from './PermissionMatrixBlock'
import { formatBrasiliaDateTime } from './auditLogPresentation'
import { classifyDbError } from '../../lib/errors'
import { departmentLabel } from '../../lib/departmentLabel'
import { formatDate } from '../../lib/utils'
import { useAuth } from '../../hooks/useAuth'
import { reactivateCatalogRow } from '../../services/deleteRecords'
import { queryKeys } from '../../services/queryKeys'
import {
  MANAGED_PROFILES,
  PROFILE_LABELS,
  createUser,
  deactivateUser,
  listAllUserProfiles,
  managedProfileOf,
  restoreUserRole,
  updateUserCredentials,
  updateUserProfile,
  type AdminUserRow,
} from '../../services/adminUsers'

type SituationFilter = 'ativos' | 'inativos' | 'todos'

function sameEmail(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()
}

const BOUNCED_TITLE = 'E-mail devolvido pelo provedor ou marcado como spam: o sistema não envia mais para ele. Corrija em Editar acesso.'

export function AdminUsersTab() {
  const queryClient = useQueryClient()
  const { user: sessionUser, signOut } = useAuth()
  const currentUserId = sessionUser?.id ?? null
  const { showToast } = useToast()
  const confirm = useConfirm()
  const confirmWithReason = useConfirmWithReason()
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('')
  const [situation, setSituation] = useState<SituationFilter>('ativos')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [novoAberto, setNovoAberto] = useState(false)
  const [editando, setEditando] = useState<AdminUserRow | null>(null)

  const usersQuery = useQuery({ queryKey: queryKeys.admin.users(), queryFn: listAllUserProfiles })
  // Toda mudança de usuário grava no Histórico de ações: a aba relê os dois.
  const invalidateUsers = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() })
    void queryClient.invalidateQueries({ queryKey: [queryKeys.admin.auditLogs(null)[0]] })
  }

  const reactivateMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => reactivateCatalogRow('user_profiles', id, reason),
    onSuccess: () => {
      invalidateUsers()
      showToast('Usuário reativado.', 'success')
      setPendingId(null)
    },
    onError: (err: Error) => { showToast(classifyDbError(err).message, 'error'); setPendingId(null) },
  })

  const deactivateMutation = useMutation({
    mutationFn: deactivateUser,
    onSuccess: () => {
      invalidateUsers()
      showToast('Usuário desativado e sessão encerrada.', 'success')
      setPendingId(null)
    },
    onError: (err: Error) => { showToast(err.message, 'error'); setPendingId(null) },
  })

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      invalidateUsers()
      showToast('Usuário criado.', 'success')
      setNovoAberto(false)
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  })

  // Setor e credenciais saem da mesma janela: o setor muda primeiro (a recusa do
  // banco, como a do último Administrativo ativo, para tudo) e depois o e-mail ou a senha.
  // Se as credenciais falharem, o setor volta ao de antes, para a edição não ficar pela metade,
  // mas só se ainda está com o setor que esta edição gravou.
  // ponytail: compensação no navegador, não transação; o upgrade é uma função só no servidor.
  const accessMutation = useMutation({
    mutationFn: async ({ user, input }: { user: AdminUserRow; input: EditarAcessoInput; releasesEmail: boolean }) => {
      // O próprio setor não muda aqui (a janela já trava): trocando o próprio setor,
      // a Edge Function recusaria as credenciais e a volta seria recusada pelo banco.
      if (input.role && user.id === currentUserId) throw new Error('O seu próprio setor só pode ser trocado por outra pessoa do Administrativo.')
      const newRole = input.role && input.role !== user.role ? input.role : null
      if (input.role) await updateUserProfile(user.id, { role: input.role })
      if (!input.email && !input.password) return null
      try {
        return await updateUserCredentials({ user_id: user.id, email: input.email, password: input.password })
      } catch (err) {
        if (!newRole) throw err
        const failure = classifyDbError(err).message
        const restored = await restoreUserRole(user.id, newRole, user.role).catch(() => false)
        if (restored) throw new Error(`${failure} O setor voltou a ${departmentLabel(user.role)}.`, { cause: err })
        throw new Error(`${failure} O setor ficou como ${PROFILE_LABELS[newRole]} e não voltou a ${departmentLabel(user.role)}; confira em Editar acesso.`, { cause: err })
      }
    },
    onSuccess: (result, { releasesEmail }) => {
      if (result?.sessionEnded) {
        // A própria credencial mudou: o token desta sessão já não vale (migration 407).
        showToast('Acesso atualizado. Entre de novo com a nova credencial.', 'success')
        setEditando(null)
        void signOut()
        return
      }
      invalidateUsers()
      if (releasesEmail && result?.released === 0) {
        // A RPC mantém suprimido o endereço que também é contato de Cliente ou e-mail de recuperação do Portal.
        showToast('O e-mail continua bloqueado: ele também é contato de Cliente ou e-mail de recuperação do Portal. Corrija pelo cadastro do Cliente.', 'error')
      } else {
        showToast('Acesso atualizado.', 'success')
      }
      setEditando(null)
    },
    onError: (err: unknown) => {
      // O setor volta ao anterior quando as credenciais falham; a lista relê para confirmar.
      invalidateUsers()
      showToast(classifyDbError(err).message, 'error')
    },
  })

  const busy = reactivateMutation.isPending || deactivateMutation.isPending

  async function handleToggleActive(user: AdminUserRow) {
    // A7: com a ação deste usuário em andamento, o segundo clique não repete a chamada.
    if (pendingId === user.id) return
    const current = user.active
    const confirmOptions = {
      title: current ? 'Desativar usuário' : 'Reativar usuário',
      message: current
        ? 'Desativar este usuário revoga o acesso e encerra a sessão dele imediatamente. Confirmar?'
        : 'Reativar este usuário restaura o acesso dele ao sistema. Confirmar?',
      confirmLabel: current ? 'Desativar' : 'Reativar',
      tone: current ? ('danger' as const) : ('primary' as const),
      consequence: current
        ? `O acesso de ${user.full_name} será revogado e sua sessão no sistema será encerrada imediatamente.`
        : `O acesso de ${user.full_name} será reativado e o usuário poderá fazer login novamente.`,
      reversibility: current
        ? 'O usuário pode ser reativado a qualquer momento na Administração.'
        : 'O usuário pode ser desativado novamente caso necessário.',
    }
    // Reativar pede motivo (ADR 0072), gravado pela RPC reactivate_catalog_row (migration 261).
    const reason = current ? ((await confirm(confirmOptions)) ? '' : null) : await confirmWithReason(confirmOptions)
    if (reason === null) return
    setPendingId(user.id)
    if (current) deactivateMutation.mutate(user.id)
    else reactivateMutation.mutate({ id: user.id, reason })
  }

  async function handleSaveAccess(user: AdminUserRow, input: EditarAcessoInput) {
    const emailChanged = Boolean(input.email) && !sameEmail(input.email, user.email)
    const releasesEmail = Boolean(input.email) && !emailChanged
    const changes = [
      ...(input.role ? [{ field: 'Setor', before: departmentLabel(user.role), after: PROFILE_LABELS[input.role] }] : []),
      ...(releasesEmail ? [{ field: 'E-mail', before: 'Devolvido', after: 'Liberado para receber de novo' }] : []),
      ...(emailChanged ? [{ field: 'E-mail', before: user.email ?? '', after: input.email! }] : []),
      ...(input.password ? [{ field: 'Senha', before: '••••••••', after: 'Nova senha definida' }] : []),
    ]
    const onlyRole = Boolean(input.role) && !input.email && !input.password
    const confirmed = await confirm({
      title: onlyRole ? 'Alterar setor' : input.role ? 'Alterar setor e credenciais' : 'Alterar credenciais de acesso',
      message: `Atualizar o acesso de ${user.full_name}?`,
      confirmLabel: 'Salvar',
      tone: 'primary',
      changes,
      consequence: [
        input.role ? `${user.full_name} passa a ter o acesso de ${PROFILE_LABELS[input.role]}, como mostra "O que cada setor pode".` : null,
        input.password ? 'A senha será redefinida imediatamente.' : null,
        emailChanged ? 'O novo e-mail passará a ser exigido no login.' : null,
        releasesEmail ? 'O sistema volta a enviar e-mails para este endereço.' : null,
      ].filter(Boolean).join(' '),
      reversibility: 'O setor e as credenciais podem ser alterados de novo na Administração.',
    })
    if (!confirmed) return
    accessMutation.mutate({ user, input, releasesEmail })
  }

  const users = usersQuery.data ?? []
  const term = search.trim().toLowerCase()
  const visibleUsers = users.filter((user) => {
    if (situation === 'ativos' && !user.active) return false
    if (situation === 'inativos' && user.active) return false
    if (sector && managedProfileOf(user.role) !== sector) return false
    return !term || user.full_name.toLowerCase().includes(term) || (user.email ?? '').toLowerCase().includes(term)
  })
  const activeCount = visibleUsers.filter((user) => user.active).length
  const countLabel = situation === 'ativos'
    ? `${activeCount} ${activeCount === 1 ? 'ativo' : 'ativos'}`
    : `${visibleUsers.length} ${visibleUsers.length === 1 ? 'usuário' : 'usuários'}`

  return (
    <>
      <div className="app-filter-grid mb-4">
        <Field label="Busca">
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou e-mail" aria-label="Buscar por nome ou e-mail" />
        </Field>
        <Field label="Setor">
          <Select value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">Todos</option>
            {MANAGED_PROFILES.map((profile) => <option key={profile} value={profile}>{PROFILE_LABELS[profile]}</option>)}
          </Select>
        </Field>
        <Field label="Situação">
          <Select value={situation} onChange={(e) => setSituation(e.target.value as SituationFilter)}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </Select>
        </Field>
        <div className="flex items-end justify-end">
          <Button onClick={() => setNovoAberto(true)}>Novo usuário</Button>
        </div>
      </div>

      <Block title="Usuários" aside={usersQuery.data ? countLabel : null} flush className="mb-6">
        <QueryStateGate
          isLoading={usersQuery.isLoading}
          isError={Boolean(usersQuery.error)}
          hasData={usersQuery.data !== undefined}
          errorMessage="Não foi possível carregar os usuários."
          onRetry={() => void usersQuery.refetch?.()}
          loadingLabel="Carregando usuários…"
        >
          {visibleUsers.length === 0 ? (
            <p className="px-4 py-8 text-center text-[var(--app-muted)]">Nenhum usuário com estes filtros.</p>
          ) : (
            <div className="app-table-scroll">
              <table className="app-table">
                <caption className="sr-only">Usuários internos</caption>
                <thead>
                  <tr>
                    <th scope="col" className="app-table__text-head">Nome</th>
                    <th scope="col" className="app-table__text-head">E-mail</th>
                    <th scope="col">Setor</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Último acesso</th>
                    <th scope="col">Criado em</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((user) => {
                    const isBusy = pendingId === user.id && busy
                    return (
                      <tr key={user.id} className={user.active ? undefined : 'app-table__row--muted'}>
                        <td className="app-table__text" title={user.full_name}>{user.full_name}</td>
                        <td className="app-table__text" title={user.email_bounced ? BOUNCED_TITLE : user.email ?? undefined}>
                          {!user.email ? <NoValue label="Sem e-mail" /> : user.email_bounced ? (
                            <StatusText tone="warning">
                              {user.email}
                              <TriangleAlert size={14} role="img" aria-label="E-mail devolvido" className="ml-1 inline-block align-text-bottom" />
                            </StatusText>
                          ) : user.email}
                        </td>
                        <td>{departmentLabel(user.role)}</td>
                        <td>{user.active ? 'Ativo' : <StatusText tone="muted">Inativo</StatusText>}</td>
                        <td className="tabular-nums whitespace-nowrap">
                          {user.last_sign_in_at ? formatBrasiliaDateTime(user.last_sign_in_at) : <StatusText tone="muted">Nunca acessou</StatusText>}
                        </td>
                        <td className="tabular-nums">{user.created_at ? formatDate(user.created_at) : <NoValue label="Sem data de criação" />}</td>
                        <td>
                          <div className="flex items-center justify-center gap-2">
                            <RowActionButton label={`Editar acesso de ${user.full_name}`} title="Editar acesso" icon={KeyRound} disabled={isBusy} onClick={() => setEditando(user)} />
                            {user.active ? (
                              <RowActionButton label={`Desativar ${user.full_name}`} title="Desativar" icon={UserX} variant="danger" disabled={isBusy} onClick={() => void handleToggleActive(user)} />
                            ) : (
                              <RowActionButton label={`Reativar ${user.full_name}`} title="Reativar" icon={UserCheck} disabled={isBusy} loading={isBusy} onClick={() => void handleToggleActive(user)} />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </QueryStateGate>
      </Block>

      <PermissionMatrixBlock />

      {novoAberto ? (
        <NovoUsuarioModal
          open
          onClose={() => setNovoAberto(false)}
          onSubmit={async (input) => {
            const confirmed = await confirm({
              title: 'Criar usuário interno',
              message: `Criar acesso para ${input.full_name} no setor ${PROFILE_LABELS[input.role]}?`,
              confirmLabel: 'Criar usuário',
              affected: { summary: `${input.full_name} · ${input.email} · Setor: ${PROFILE_LABELS[input.role]}` },
              consequence: `O usuário poderá entrar no sistema com o acesso de ${PROFILE_LABELS[input.role]}.`,
              reversibility: 'O usuário pode ser desativado ou mudar de setor na Administração.',
            })
            if (!confirmed) return
            createMutation.mutate(input)
          }}
          submitting={createMutation.isPending}
        />
      ) : null}
      {editando ? (
        <EditarAcessoModal
          open
          userName={editando.full_name}
          currentEmail={editando.email}
          currentRole={editando.role}
          emailBounced={Boolean(editando.email_bounced)}
          isSelf={editando.id === currentUserId}
          onClose={() => setEditando(null)}
          onSubmit={(input) => void handleSaveAccess(editando, input)}
          submitting={accessMutation.isPending}
        />
      ) : null}
    </>
  )
}
