import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, InlineError } from '../components/ui/Card'
import { useConfirm } from '../components/ui/ConfirmDialog'
import { supabasePortal } from '../services/supabase'

const INVALID_LINK_MESSAGE = 'Link de confirmacao invalido ou expirado. Peca a troca novamente pelo Portal.'
const TRANSIENT_MESSAGE = 'Nao foi possivel confirmar agora. Abra o link do email novamente em instantes.'
// 409: o link estava valido, mas o pedido de troca ja tinha sido resolvido por
// outro caminho (tipicamente a troca assistida pelo atendimento). Dizer "link
// invalido" aqui mandaria o cliente refazer uma troca que ja aconteceu.
const ALREADY_RESOLVED_MESSAGE = 'Este pedido de troca de email ja foi resolvido. Nenhuma acao e necessaria; o Email de Recuperacao em vigor e o atual.'

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
    <main className="app-auth">
      <Card className="app-auth__card">
        <div className="app-auth__brand">
          <img alt="Fwlog" className="app-auth__logo app-auth__logo--on-light" src="/branding/fwlog-logo.png" />
          <div>
            <h1 className="app-auth__title">
              {state === 'ok' ? 'Email confirmado' : state === 'erro' ? 'Confirmacao de email' : 'Confirmando seu email...'}
            </h1>
          </div>
        </div>

        {state === 'confirmando' ? (
          <p className="text-sm text-[var(--app-muted)]">Estamos confirmando o novo Email de Recuperacao.</p>
        ) : null}

        {state === 'ok' ? (
          <p className="text-sm text-[var(--app-muted)]">
            O novo Email de Recuperacao passou a valer e o endereco anterior deixou de valer. As sessoes abertas em
            outros dispositivos foram encerradas — entre novamente no Portal.
          </p>
        ) : null}

        {state === 'erro' ? <InlineError message={error} /> : null}

        <div className="mt-4 text-center">
          <Link to="/portal/login" className="text-sm text-[var(--app-link)] hover:underline">
            Ir para o login
          </Link>
        </div>
      </Card>
    </main>
  )
}
