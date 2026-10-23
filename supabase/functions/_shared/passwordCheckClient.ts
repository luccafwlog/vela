import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2'

// Cliente da conferência de senha feita pelo servidor (portal-login e troca do
// Email de Recuperação). O captcha do Auth vale para o projeto inteiro, e o
// GoTrue só o dispensa quando o Authorization traz papel de administrador
// (`verifyCaptcha`: "skip captcha validation if authorization header contains
// an admin role"). O Turnstile do Portal já é conferido pela própria Edge, e o
// token não vale duas vezes; por isso a conferência vai com a chave
// service_role (auditoria run-3, captcha do login da equipe). Sessão só em
// memória, sem renovação: a função usa e descarta.
export function createPasswordCheckClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
}
