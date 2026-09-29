import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, InlineError } from '../components/ui/Card'
import { Field, Input } from '../components/ui/Input'
import { supabasePortal } from '../services/supabase'
import { PASSWORD_RULE_MESSAGE, isValidPassword } from '../lib/passwordPolicy'

const invalid = 'Link inválido ou expirado. Solicite um novo convite à empresa.'
export function PortalAtivacao() {
  const [params, setParams] = useSearchParams(); const [token] = useState(() => params.get('token') ?? '')
  const [company, setCompany] = useState<{ company_name: string; cnpj_masked: string } | null>(null)
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(token ? '' : invalid); const [done, setDone] = useState(false); const [loading, setLoading] = useState(Boolean(token)); const [submitting, setSubmitting] = useState(false)
  // Achado 3.3 (auditoria 2026-08-12): o token vaza para a telemetria via
  // event.request.url se permanecer na URL. Removido da barra de enderecos
  // assim que lido, mantido em estado para o submit (espelha PortalProfile).
  useEffect(() => {
    if (!params.get('token')) return
    params.delete('token'); setParams(params, { replace: true })
  }, [params, setParams])
  useEffect(() => {
    if (!token) return
    void supabasePortal.functions.invoke('portal-invite-activate', { body: { action: 'inspect', token } }).then(({ data, error: invokeError }) => {
      if (invokeError || !data?.company_name) setError(invalid); else setCompany(data as { company_name: string; cnpj_masked: string })
      setLoading(false)
    })
  }, [token])
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!isValidPassword(password)) { setError(PASSWORD_RULE_MESSAGE); return }
    if (password !== confirm) { setError('As senhas não conferem.'); return }
    setSubmitting(true)
    try { const { error: invokeError } = await supabasePortal.functions.invoke('portal-invite-activate', { body: { action: 'activate', token, password } }); if (invokeError) throw invokeError; setDone(true) } catch { setError('Não foi possível ativar o acesso. Solicite um novo convite.') } finally { setSubmitting(false) }
  }
  return <main className="app-auth"><Card className="app-auth__card"><h1 className="app-auth__title">Ativar acesso ao Portal</h1>{loading ? <p>Verificando convite...</p> : done ? <><p className="mt-4">Acesso ativado. Você já pode entrar com seu CNPJ e a senha criada.</p><Link className="mt-4 inline-block text-[var(--app-link)]" to="/portal/login">Ir para o login</Link></> : company ? <><p className="mt-4">Empresa: <strong>{company.company_name}</strong></p><p className="text-sm text-[var(--app-muted)]">CNPJ: {company.cnpj_masked}</p><form className="mt-4 grid gap-4" onSubmit={submit}><Field label="Nova senha" hint={PASSWORD_RULE_MESSAGE}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field><Field label="Confirmar senha"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>{error ? <InlineError message={error} /> : null}<Button loading={submitting} type="submit">Ativar acesso</Button></form></> : <InlineError message={error || invalid} />}</Card></main>
}
