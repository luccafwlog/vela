import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { StatusScreen } from '../components/layout/StatusScreen'

// Antes, qualquer rota desconhecida caía em /painel com `replace`: o usuário
// era realocado sem aviso e o Back nem devolvia a URL digitada. Um link velho,
// um typo ou um bookmark de rota removida viravam "o sistema me jogou no
// Painel". Agora a rota inexistente se identifica e mostra o caminho de volta.
export function NaoEncontrado() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <StatusScreen
      icon={Compass}
      title="Página não encontrada"
      actions={(
        <>
          <Link to="/painel" className="app-btn app-btn--primary">
            Voltar para o Painel
          </Link>
          <button type="button" className="app-btn app-btn--secondary" onClick={() => navigate(-1)}>
            Voltar à página anterior
          </button>
        </>
      )}
    >
      <p>
        Nenhuma tela do Vela responde por{' '}
        <code className="app-status-panel__code">{pathname}</code>.
      </p>
      <p>Se o link estava salvo, a tela pode ter mudado de endereço. Use o menu para chegar até ela.</p>
    </StatusScreen>
  )
}
