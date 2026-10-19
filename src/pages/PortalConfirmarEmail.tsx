import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PortalAccessHelp } from '../components/auth/PortalAccessHelp'
import { AuthLayout, AuthNotice } from '../components/auth/AuthLayout'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { supabasePortal } from '../services/supabase'

const INVALID_LINK_MESSAGE = 'Link de confirmação inválido ou expirado. Peça a troca novamente pelo Portal.'
const TRANSIENT_MESSAGE = 'Não foi possível confirmar agora. Abra o link do e-mail novamente em instantes.'
const RESET_IN_PROGRESS_MESSAGE = 'Recuperação de senha em andamento. O novo e-mail ainda não foi confirmado. Abra o link do e-mail novamente após sua conclusão.'
// 409: o link estava valido, mas o pedido de troca ja tinha sido resolvido por
// outro caminho (tipicamente a troca assistida pelo atendimento). Dizer "link
// invalido" aqui mandaria o cliente refazer uma troca que ja aconteceu.
const ALREADY_RESOLVED_MESSAGE = 'Este pedido de troca de e-mail já foi resolvido. Nenhuma ação é necessária; o Email de Recuperação em vigor é o atual.'

// `functions.invoke` nao rejeita em falha de transporte: devolve `{ error }`
// tanto para a resposta 410 da funcao quanto para rede fora do ar. Tratar as
// duas como link morto mandaria o cliente refazer a troca segurando um token
// ainda valido -- e refazer exige sessao ativa E senha atual, que o leitor do
// Email de Recuperacao normalmente nao tem. So o status da funcao decide.
function invokeStatus(invokeError: unknown): number | undefined {
  return (invokeError as { context?: { status?: number } } | null)?.context?.status
}

function errorMessageFor(invokeError: unknown): string {
  const status = invokeStatus(invokeError)
  if (status === 409) return ALREADY_RESOLVED_MESSAGE
  if (status === 423) return RESET_IN_PROGRESS_MESSAGE
  return status === 410 || status === 422 ? INVALID_LINK_MESSAGE : TRANSIENT_MESSAGE
}

// Rota publica, como `/portal/ativar` e `/portal/recuperar-senha`. A troca de
// email ja foi autorizada no pedido, que exigiu sessao ativa E senha atual; a
// confirmacao so precisa provar posse da caixa nova, e o token e essa prova.
// Exigir sessao aqui nao acrescentava barreira e trancava justamente quem le o
// Email de Recuperacao -- em geral o contato financeiro, que nao tem a senha.
export function PortalConfirmarEmail() {
  const confirmAction = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const [token] = useState(() => searchParams.get('confirm_email') ?? searchParams.get('token'))
  const [state, setState] = useState<'confirmando' | 'ok' | 'erro'>(token ? 'confirmando' : 'erro')
  const [error, setError] = useState(token ? '' : INVALID_LINK_MESSAGE)
  const requested = useRef(false)

  // Espelha o achado 3.3: o token sai da barra de enderecos assim que lido,
  // para nao vazar na telemetria; o valor fica em estado para o submit.
  useEffect(() => {
    if (!searchParams.get('confirm_email') && !searchParams.get('token')) return
    searchParams.delete('confirm_email')
    searchParams.delete('token')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!token || requested.current) return
    requested.current = true
    void (async () => {
      const confirmed = await confirmAction({
        title: 'Confirmar troca do e-mail de recuperação',
        message: 'Confirmar que o novo endereço de e-mail deve passar a valer para esta conta do Portal?',
        confirmLabel: 'Confirmar e-mail',
        affected: { summary: 'E-mail de Recuperação da conta atual' },
        consequence: 'O novo e-mail passa a valer, o anterior deixa de ser o endereço de recuperação e as sessões abertas em outros dispositivos são encerradas.',
        reversibility: 'Para trocar o endereço novamente, será necessário iniciar outro pedido e confirmar o novo link.',
      })
      if (!confirmed) {
        setError('Você voltou. O novo e-mail não foi confirmado; abra o link novamente quando quiser concluir a troca.')
        setState('erro')
        return
      }
      try {
        const { error: invokeError } = await supabasePortal.functions.invoke(
          'portal-recovery-email-change',
          { body: { action: 'confirm', token } },
        )
        if (invokeError) {
          setError(errorMessageFor(invokeError))
          setState('erro')
          return
        }
        setState('ok')
      } catch {
        setError(TRANSIENT_MESSAGE)
        setState('erro')
      }
    })()
  }, [token, confirmAction])

  return (
    <AuthLayout
      brand="portal"
      title={state === 'ok' ? 'E-mail confirmado' : state === 'erro' ? 'Confirmação de e-mail' : 'Confirmando seu e-mail…'}
    >
      {state === 'confirmando' ? (
        <p className="app-auth__body" role="status">Estamos confirmando o novo Email de Recuperação.</p>
      ) : null}

      {state === 'ok' ? (
        <div className="app-auth__body" role="status">
          <p>
            O novo Email de Recuperação passou a valer e o endereço anterior deixou de valer. As sessões abertas em
            outros dispositivos foram encerradas. Entre novamente no Portal.
          </p>
        </div>
      ) : null}

      {state === 'erro' ? <AuthNotice title={error} /> : null}

      <Link to="/portal/login" className={state === 'ok' ? 'app-btn app-btn--primary' : 'app-btn app-btn--secondary'}>
        Ir para o login
      </Link>

      <PortalAccessHelp />
    </AuthLayout>
  )
}
