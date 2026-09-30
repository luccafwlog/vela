import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decideInternalTarget } from '../../../supabase/functions/_shared/internalUserTarget'

const base = { userId: 'u-1', dummyUserId: 'dummy', hasProfile: true, isPortalAccount: false }

describe('admin-users: alvo interno (auditoria run-2 #8)', () => {
  it('aceita usuário interno com perfil', () => {
    expect(decideInternalTarget(base)).toEqual({ ok: true })
  })

  it('recusa conta do Portal, sentinela do portal-login e usuário sem perfil com 404', () => {
    expect(decideInternalTarget({ ...base, isPortalAccount: true })).toMatchObject({ ok: false, status: 404 })
    expect(decideInternalTarget({ ...base, userId: 'dummy' })).toMatchObject({ ok: false, status: 404 })
    expect(decideInternalTarget({ ...base, hasProfile: false })).toMatchObject({ ok: false, status: 404 })
  })

  it('recusa user_id vazio com 422', () => {
    expect(decideInternalTarget({ ...base, userId: '' })).toMatchObject({ ok: false, status: 422 })
  })
})

describe('admin-users: revogação de sessões (auditoria run-2 #9)', () => {
  const source = readFileSync('supabase/functions/admin-users/index.ts', 'utf8')

  it('usa a RPC internal_revoke_sessions e não o signOut do GoTrue', () => {
    expect(source).toContain("admin.rpc('internal_revoke_sessions'")
    expect(source).not.toContain('auth.admin.signOut')
  })

  it('confere o alvo antes de alterar credencial ou desativar', () => {
    expect(source.match(/await checkInternalTarget\(userId\)/g)).toHaveLength(2)
  })

  it('trata falha de auditoria como falha', () => {
    expect(source).toContain('if (error) throw new Error(`audit_logs:')
  })
})

const fn = (name: string) => readFileSync(`supabase/functions/${name}/index.ts`, 'utf8')

describe('send-customer-communication: conteúdo renderizado no servidor (auditoria run-2 #10)', () => {
  const source = fn('send-customer-communication')

  it('renderiza livre/institucional a partir de message_body e ignora o HTML do navegador', () => {
    expect(source).toContain("const userWrittenKind = kind === 'livre' || kind === 'institucional'")
    expect(source).toContain('canonicalPayload = await renderUserWrittenCommunication(admin')
    expect(source).toContain("from('customers')")
  })

  it('grava assunto, texto e hash do HTML enviados no registro do comunicado', () => {
    expect(source).toContain('rendered_subject: effectiveSubject')
    expect(source).toContain('rendered_html_sha256: await sha256Hex(effectiveHtml)')
    const migration = readFileSync('supabase/migrations/108_customer_communication_rendered_copy.sql', 'utf8')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS rendered_subject text')
  })
})

describe('senha do Portal derivada com pepper (auditoria run-2 #7, D1 = a)', () => {
  it.each(['portal-login', 'portal-invite-activate', 'portal-password-reset', 'portal-recovery-email-change'])('%s usa derivePortalAuthPassword', (name) => {
    expect(fn(name)).toContain('derivePortalAuthPassword(')
    expect(fn(name)).toContain('portalPasswordPepper()')
  })

  it('ativação e recuperação nunca gravam a senha pura no GoTrue', () => {
    expect(fn('portal-invite-activate')).toContain('password: authPassword')
    expect(fn('portal-password-reset')).toContain('resetPortalPasswordFailClosed(account.auth_user_id, authPassword')
  })
})

describe('reforços da Fase 3', () => {
  it('Turnstile sem secret só libera o stack local', async () => {
    const { isLocalSupabase } = await import('../../../supabase/functions/_shared/turnstile')
    expect(isLocalSupabase('http://127.0.0.1:54321')).toBe(true)
    expect(isLocalSupabase('http://kong:8000')).toBe(true)
    expect(isLocalSupabase('https://fgmkhbzhaeebrsizwccx.supabase.co')).toBe(false)
    expect(isLocalSupabase(undefined)).toBe(false)
  })

  it('cobrança agrupada de Demurrage escapa o HTML', () => {
    const source = fn('demurrage-dunning')
    expect(source).toContain('${escapeHtml(anchor.customer!.name)}')
    expect(source).toContain('${escapeHtml(line.candidate.doc_number)}')
  })

  it('suspensão valida a situação, cancela convites e a reativação bane o usuário antigo', () => {
    const source = fn('portal-account-suspend')
    expect(source).toContain("account.account_situation === 'suspenso'")
    expect(source).toContain(".from('portal_invites').update({ status: 'cancelado' })")
    expect(source).toContain("ban_duration: '876000h'")
  })

  it('ativação exige conta pendente sem usuário técnico e só devolve convite consumido', () => {
    const source = fn('portal-invite-activate')
    expect(source).toContain(".is('auth_user_id', null).in('account_situation', PENDING_SITUATIONS)")
    expect(source).not.toMatch(/update\(\{ status: 'pendente', consumed_at: null \}\)\.eq\('id', invite\.id\)\n/)
  })

  it('imports remotos com versão exata', () => {
    const sources = ['admin-users', 'portal-login', 'portal-email-webhook'].map(fn).join('\n')
    expect(sources).not.toMatch(/esm\.sh\/[^'"]+@\d+['"]/)
  })
})

describe('reforços adicionais das Edge Functions (D4 = b)', () => {
  it('assinatura e extensão de arquivo', async () => {
    const { base64Head, matchesExtension, matchesMagicBytes } = await import('../../../supabase/functions/_shared/fileSignature')
    const pdf = Buffer.from('%PDF-1.7 conteudo').toString('base64')
    expect(matchesMagicBytes(base64Head(pdf), 'application/pdf')).toBe(true)
    expect(matchesMagicBytes(base64Head(Buffer.from('<html>').toString('base64')), 'application/pdf')).toBe(false)
    expect(matchesExtension('fatura.PDF', 'application/pdf')).toBe(true)
    expect(matchesExtension('fatura.html', 'application/pdf')).toBe(false)
    expect(matchesExtension('foto.jpeg', 'image/jpeg')).toBe(true)
  })

  it('anexos de Comunicado e de Dispute conferem conteúdo e extensão', () => {
    expect(fn('send-customer-communication')).toContain('matchesMagicBytes(base64Head(contentBase64), contentType)')
    expect(fn('portal-dispute-attachment')).toContain('matchesExtension(file.name, file.type)')
  })

  it('Dispute confere sessão e cota antes de ler e gravar o arquivo', () => {
    const source = fn('portal-dispute-attachment')
    expect(source.indexOf("portal.rpc('portal_check_dispute_attachment_eligibility'")).toBeLessThan(source.indexOf('await file.arrayBuffer()'))
    expect(source.indexOf("req.headers.get('Content-Length')")).toBeLessThan(source.indexOf('await req.formData()'))
  })

  it('histórico do Comunicado grava navio e viagem derivados dos B/Ls', () => {
    const source = fn('send-customer-communication')
    expect(source).toContain('p_vessel_name: derivedVesselName')
    expect(source).not.toContain('body.vessel_name')
  })

  it('Cliente desativado fica fora de recuperação, convite, Comunicados e resumo', () => {
    expect(fn('portal-password-recovery')).toContain('deactivated_at) return')
    expect(fn('portal-invite-send')).toContain('Cliente desativado não recebe convite.')
    expect(fn('send-customer-communication')).toContain('Cliente desativado não recebe Comunicados.')
    expect(fn('portal-daily-digest')).toContain(".is('customers.deactivated_at', null)")
  })

  it('troca de e-mail de recuperação exige conta ativa e tem cota diária', () => {
    const source = fn('portal-recovery-email-change')
    expect(source).toContain("account.account_situation !== 'ativo'")
    expect(source).toContain('>= EMAIL_CHANGE_DAILY_LIMIT')
  })

  it('anexos órfãos de Dispute são removidos pelo job do detector', () => {
    expect(fn('alerts-detector')).toContain("admin.rpc('list_orphaned_dispute_attachments'")
  })
})
