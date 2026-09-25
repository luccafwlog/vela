import { createClient } from '@supabase/supabase-js'

const DEFAULT_EMAIL = 'qa-admin@example.test'
const DEFAULT_FULL_NAME = 'Preview Admin'

function errorMessage(error) {
  if (!error) return 'erro desconhecido'
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message)
  }
  return String(error)
}

function isPasswordPolicyError(error) {
  return errorMessage(error).toLowerCase().includes('password should contain at least one character of each')
}

function assertValidInput({ email, password, fullName }) {
  if (!email || !email.includes('@')) throw new Error('PREVIEW_ADMIN_EMAIL inválido.')
  if (!password || password.length < 8) throw new Error('PREVIEW_ADMIN_PASSWORD deve ter pelo menos 8 caracteres.')
  if (!fullName?.trim()) throw new Error('PREVIEW_ADMIN_FULL_NAME não pode ser vazio.')
}

/**
 * Creates or repairs the one shared test account inside one Supabase Preview
 * Branch. The clients are injected so this orchestration can be checked
 * without ever contacting a real project.
 */
export async function provisionPreviewAdmin({ authAdmin, profiles, email, password, fullName }) {
  assertValidInput({ email, password, fullName })

  const { data: listData, error: listError } = await authAdmin.listUsers({ page: 1, perPage: 1000 })
  if (listError) throw new Error(`Não foi possível listar os usuários da Preview: ${errorMessage(listError)}`)

  const matchingUsers = (listData?.users ?? []).filter(
    (user) => String(user.email ?? '').toLowerCase() === email.toLowerCase(),
  )
  if (matchingUsers.length > 1) {
    throw new Error(`Mais de um usuário corresponde ao e-mail de Preview ${email}.`)
  }

  const attributes = {
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, preview_fixture: true },
  }
  let user

  if (matchingUsers[0]) {
    const { data, error } = await authAdmin.updateUserById(matchingUsers[0].id, attributes)
    if (error && isPasswordPolicyError(error)) {
      // A senha pode ter sido aceita quando o fixture foi criado e passar a ser
      // rejeitada em um rerun após uma mudança na política do Auth. Preserve a
      // senha existente, mas ainda repare a confirmação do e-mail e metadados.
      console.warn(
        'A senha existente do usuário de Preview não foi reaplicada porque a política atual do Auth a rejeitou; ' +
          'mantendo a senha e reparando o restante do fixture.',
      )
      const metadataUpdate = await authAdmin.updateUserById(matchingUsers[0].id, {
        email_confirm: true,
        user_metadata: attributes.user_metadata,
      })
      if (metadataUpdate.error) {
        throw new Error(`Não foi possível atualizar o usuário de Preview: ${errorMessage(metadataUpdate.error)}`)
      }
      user = metadataUpdate.data?.user ?? matchingUsers[0]
    } else {
      if (error) throw new Error(`Não foi possível atualizar o usuário de Preview: ${errorMessage(error)}`)
      user = data?.user
    }
  } else {
    const { data, error } = await authAdmin.createUser({ email, ...attributes })
    if (error) throw new Error(`Não foi possível criar o usuário de Preview: ${errorMessage(error)}`)
    user = data?.user
  }

  if (!user?.id) throw new Error('A Auth API não devolveu o id do usuário de Preview.')

  const { error: profileError } = await profiles.upsert(
    { id: user.id, full_name: fullName, role: 'administrativo', active: true },
    { onConflict: 'id' },
  )
  if (profileError) throw new Error(`Não foi possível garantir o perfil admin da Preview: ${errorMessage(profileError)}`)

  return { id: user.id, email }
}

/**
 * Refuses to provision the fixture against the production project.
 *
 * Este script cria um usuário `role = 'administrativo'`, `active = true`, com e-mail
 * conhecido e senha fixa. Ele nunca deve tocar produção — mas nada nele exigia
 * isso: a URL vinha pronta do ambiente, e um `supabase branches get` que
 * resolvesse para o projeto pai (o branching do Supabase expõe o projeto de
 * produção como branch persistente) provisionaria a credencial conhecida lá.
 *
 * O `SUPABASE_PROJECT_REF` do workflow é, por definição, o ref de produção —
 * é ele que localiza as branches. Se o host da URL resolvida cita esse mesmo
 * ref, a URL não é a de uma Preview Branch: aborta.
 */
export function assertPreviewTarget(url, productionProjectRef) {
  const ref = (productionProjectRef ?? '').trim()
  if (!ref) {
    throw new Error(
      'SUPABASE_PROJECT_REF ausente: sem o ref de produção não há como provar que o alvo é uma Preview Branch.',
    )
  }
  let host
  try {
    host = new URL(url).host
  } catch {
    throw new Error(`SUPABASE_URL inválida: ${url}`)
  }
  if (host.split('.').includes(ref)) {
    throw new Error(
      `Recusado: SUPABASE_URL aponta para o projeto de produção (${ref}). ` +
        'O admin de Preview só pode ser provisionado numa Preview Branch.',
    )
  }
  return url
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}.`)
  return value
}

async function main() {
  // Nome próprio, não `SUPABASE_PROJECT_REF`: o step anterior despeja a saída
  // de `supabase branches get -o env` dentro de $GITHUB_ENV, e uma chave de
  // mesmo nome vinda do CLI sobrescreveria o ref de produção — apagando
  // justamente a referência contra a qual se compara.
  const url = assertPreviewTarget(
    requiredEnv('SUPABASE_URL'),
    requiredEnv('PRODUCTION_SUPABASE_PROJECT_REF'),
  )
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!secretKey) {
    throw new Error('Credencial server-side ausente: SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY.')
  }

  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const result = await provisionPreviewAdmin({
    authAdmin: client.auth.admin,
    profiles: client.from('user_profiles'),
    email: process.env.PREVIEW_ADMIN_EMAIL?.trim() || DEFAULT_EMAIL,
    password: requiredEnv('PREVIEW_ADMIN_PASSWORD'),
    fullName: process.env.PREVIEW_ADMIN_FULL_NAME?.trim() || DEFAULT_FULL_NAME,
  })

  console.log(`Usuário de Preview garantido: ${result.email} (${result.id})`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(errorMessage(error))
    process.exitCode = 1
  })
}
