import { canonicalizeDocument } from './cnpj'

export const INCOMPLETE_CNPJ_MESSAGE = 'Informe o CNPJ completo, com 14 caracteres.'

// Login do Portal aceita CNPJ numérico e alfanumérico. A validação de tela
// cobre só o COMPRIMENTO: é o que distingue "digitou pela metade" de "digitou
// outro CNPJ", e é decidível offline, sem revelar nada sobre a base. Se o CNPJ
// existe ou não, quem responde é o servidor — e ele responde igual para todos.
//
// ponytail: teto conhecido — não checa dígito verificador, embora
// `isValidCnpj` exista e siga a regra da Receita (numérico e alfanumérico).
// `customer_portal_accounts.login_cnpj` é cópia literal de
// `customers.cnpj_cpf`. A última contagem de produção encontrou apenas uma
// conta QA válida; ainda não existe decisão D09 para endurecer o login. Rever
// quando entrar dado real ou quando Administrativo/Produto aprovar a mudança.
export function isCompleteCnpjLogin(value: string): boolean {
  return canonicalizeDocument(value).length === 14
}

// Mesma mensagem para senha errada, CNPJ sem conta e CNPJ bloqueado (ADR 0049):
// uma mensagem própria do bloqueio revelaria que o CNPJ tem conta. Por isso a
// orientação sobre a suspensão de 15 minutos vai para todos os casos.
export const PORTAL_LOGIN_REJECTED_MESSAGE =
  'CNPJ ou senha inválidos. Após várias tentativas, o acesso fica suspenso por 15 minutos. Se esqueceu a senha, use "Esqueci minha senha".'
