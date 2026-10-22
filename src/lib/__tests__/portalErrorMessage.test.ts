import { describe, expect, it } from 'vitest'
import { portalErrorMessage } from '../portalErrorMessage'

describe('portalErrorMessage', () => {
  it('mapeia codigos e erros conhecidos sem vazar mensagens cruas', () => {
    expect(portalErrorMessage(Object.assign(new Error('raw limit'), { code: 'P0429' }), 'Falha generica.')).toBe(
      'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    )
    expect(portalErrorMessage(Object.assign(new Error('raw session'), { code: '28000' }), 'Falha generica.')).toBe(
      'Sua sessao expirou. Entre novamente para continuar.',
    )
    expect(portalErrorMessage(new Error('New password should be different from the old password.'), 'Falha generica.')).toBe(
      'A nova senha deve ser diferente da senha atual.',
    )
    expect(portalErrorMessage(new Error('detalhe interno do banco'), 'Falha generica.')).toBe('Falha generica.')
  })

  it('preserva a mensagem de negocio das RPCs do Portal (22023/P0002)', () => {
    expect(
      portalErrorMessage(Object.assign(new Error('Informe o motivo da disputa.'), { code: '22023' }), 'Falha generica.'),
    ).toBe('Informe o motivo da disputa.')
    expect(
      portalErrorMessage(
        Object.assign(new Error('Esta fatura ja possui uma disputa em aberto.'), { code: 'P0002' }),
        'Falha generica.',
      ),
    ).toBe('Esta fatura ja possui uma disputa em aberto.')
  })

  it('preserva a recusa de estado das RPCs (55000), sem vazar texto técnico', () => {
    expect(
      portalErrorMessage(Object.assign(new Error('A fatura já foi paga e não pode ser contestada.'), { code: '55000' }), 'Falha generica.'),
    ).toBe('A fatura já foi paga e não pode ser contestada.')
    expect(
      portalErrorMessage(Object.assign(new Error('invoice_state_check'), { code: '55000' }), 'Falha generica.'),
    ).toBe('A operação não é possível no estado atual do registro.')
  })
})
