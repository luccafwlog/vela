// Editar acesso (Edge admin-users) e o e-mail devolvido do usuário interno
// (plano de correção dos e-mails, 2.8, D19). Quando o Administrativo salva o
// e-mail do usuário, a supressão por bounce ou reclamação do endereço anterior
// sai (RPC release_internal_user_email_suppression, migration 310), a não ser
// que o endereço também seja de Cliente. Sem isso, um e-mail corrigido na
// caixa do usuário e salvo de novo continuaria suprimido para sempre.

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * Libera a supressão do e-mail anterior do usuário interno depois de salvar o
 * e-mail em Editar acesso. Falha aqui não desfaz a troca já feita no Auth:
 * fica no log e o Alerta `usuario_email_devolvido` continua aberto.
 */
export async function releasePreviousEmailSuppression(
  admin: RpcClient,
  previousEmail: string | null | undefined,
  savedEmail: string | null | undefined,
): Promise<number> {
  const previous = previousEmail?.trim().toLowerCase()
  if (!previous || !savedEmail?.trim()) return 0
  try {
    const { data, error } = await admin.rpc('release_internal_user_email_suppression', { p_email: previous })
    if (error) {
      console.error('admin-users: falha ao liberar a supressão do e-mail anterior', error)
      return 0
    }
    return typeof data === 'number' ? data : 0
  } catch (error) {
    console.error('admin-users: falha ao liberar a supressão do e-mail anterior', error)
    return 0
  }
}
