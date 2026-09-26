import { describe, expect, it } from 'vitest'
import {
  MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE,
  buildCustomerCommunicationConference,
  filterCustomerCommunicationBls,
  getCustomerCommunicationAudienceRule,
  getCustomerCommunicationDispatchMode,
  getDefaultCustomerCommunicationKind,
  getEmailSuppressionReason,
  isInstitutionalCustomerCommunicable,
  isUserWrittenCustomerCommunicationKind,
  requiresResendConfirmation,
  resolveCustomerCommunicationRecipients,
  customerCommunicationStatusLabel,
  expandCandidatesForKind,
  validateCustomerCommunicationFilters,
  type CustomerCommunicationBlCandidate,
} from '../customerCommunications'
import type { CustomerContact } from '../../types/database'

function contact(id: number, email: string | null, purpose = 'demurrage'): CustomerContact {
  return {
    id,
    customer_id: 99,
    name: `Contato ${id}`,
    email,
    email_normalized: email?.toLowerCase() ?? null,
    phone: null,
    purpose,
    is_primary: id === 1,
    created_at: '2026-09-01T00:00:00Z',
    deactivated_at: null,
    updated_at: '2026-09-01T00:00:00Z',
    origin: 'interno',
  }
}

describe('resolução pura de destinatários de Comunicados', () => {
  it('rotula o estado parcial de uma comunicação com destinatários mistos', () => {
    expect(customerCommunicationStatusLabel('parcial')).toBe('Parcial')
  })

  it('retorna os quatro motivos de exclusão e mantém os elegíveis', () => {
    const result = resolveCustomerCommunicationRecipients({
      nature: 'documentacao',
      contacts: [
        contact(1, 'desligado@example.com'),
        contact(2, null),
        contact(3, 'reclamou@example.com'),
        contact(4, 'bounce@example.com'),
        contact(5, 'valido@example.com'),
      ],
      preferences: [
        { contact_id: 1, nature: 'documentacao', enabled: false },
        { contact_id: 3, nature: 'documentacao', enabled: true },
        { contact_id: 4, nature: 'documentacao', enabled: true },
        { contact_id: 5, nature: 'documentacao', enabled: true },
      ],
      communicationSuppressions: [{ email: 'RECLAMOU@example.com', reason: 'complaint' }],
      portalSuppressions: [{ email: 'BOUNCE@example.com', reason: 'bounce_permanente' }],
    })

    expect(result.eligible.map((row) => row.id)).toEqual([5])
    expect(result.excluded.map((row) => [row.contact.id, row.reason])).toEqual([
      [1, 'preferencia_desligada'],
      [2, 'email_ausente'],
      [3, 'suprimido_complaint'],
      [4, 'suprimido_bounce'],
    ])
    expect(result.blocked).toBe(false)
  })

  it('marca o cliente como bloqueado quando nenhum contato sobra', () => {
    const result = resolveCustomerCommunicationRecipients({
      nature: 'avisos_gerais',
      contacts: [contact(1, 'sem-envio@example.com')],
      preferences: [{ contact_id: 1, nature: 'avisos_gerais', enabled: false }],
    })

    expect(result.blocked).toBe(true)
    expect(result.excluded).toHaveLength(1)
  })

  it('mantém a assimetria entre complaint de canal e bounce compartilhado', () => {
    const complaint = { email: 'cliente@example.com', reason: 'complaint' }
    const bounce = { email: 'cliente@example.com', reason: 'bounce_permanente' }

    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'comunicados',
      communicationSuppressions: [complaint],
    })).toBe('complaint')
    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'portal',
      communicationSuppressions: [complaint],
    })).toBeNull()
    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'portal',
      sharedSuppressions: [complaint],
    })).toBe('complaint')
    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'comunicados',
      sharedSuppressions: [complaint],
    })).toBeNull()
    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'portal',
      sharedSuppressions: [bounce],
    })).toBe('bounce_permanente')
    expect(getEmailSuppressionReason('cliente@example.com', {
      channel: 'comunicados',
      sharedSuppressions: [bounce],
    })).toBe('bounce_permanente')
  })

  it('usa Natureza, não purpose, para decidir o envio', () => {
    const row = contact(1, 'demurrage@example.com', 'demurrage')
    const result = resolveCustomerCommunicationRecipients({
      nature: 'documentacao',
      contacts: [row],
      preferences: [
        { contact_id: 1, nature: 'demurrage', enabled: false },
        { contact_id: 1, nature: 'documentacao', enabled: true },
      ],
    })

    expect(result.eligible).toEqual([row])
    expect(result.excluded).toEqual([])
    expect(row.purpose).toBe('demurrage')
  })
})

function candidate(overrides: Partial<CustomerCommunicationBlCandidate> = {}): CustomerCommunicationBlCandidate {
  return {
    id: 'BL-1',
    customerId: 99,
    customerName: 'Cliente 99',
    customerCnpj: '12.345.678/0001-95',
    voyageId: 7,
    vesselName: 'Navio 7',
    voyageNumber: 'V7',
    pod: 'BRSSZ',
    pol: 'BRRIO',
    cargoMode: 'container',
    eta: '2026-09-01T12:00:00Z',
    ata: null,
    terminalId: 'terminal-1',
    terminalName: 'Terminal 1',
    terminalStateId: 'state-1',
    milestoneAt: '2026-09-01T12:00:00Z',
    ...overrides,
  }
}

describe('recorte e conferência de Comunicados', () => {
  it('não permite conferência de carga sem filtro operacional, mesmo com CNPJ', () => {
    expect(validateCustomerCommunicationFilters({
      mode: 'carga', vesselVoyage: '', pol: '', pod: '', cnpj: '12.345.678/0001-95',
    }).valid).toBe(false)
    expect(validateCustomerCommunicationFilters({
      mode: 'carga', vesselVoyage: 'Navio', pol: '', pod: '', cnpj: '',
    }).valid).toBe(true)
  })

  it('navio e viagem num campo só: cada termo digitado precisa aparecer', () => {
    const rows = [
      candidate({ id: 'BL-1', vesselName: 'COSCO SHIPPING XING WANG', voyageNumber: '2401E' }),
      candidate({ id: 'BL-2', vesselName: 'COSCO SHIPPING XING WANG', voyageNumber: '2402E' }),
      candidate({ id: 'BL-3', vesselName: 'CMA VEGA', voyageNumber: '2401E' }),
    ]
    const recorte = (vesselVoyage: string) =>
      filterCustomerCommunicationBls(rows, { mode: 'carga', vesselVoyage, pol: '', pod: '', cnpj: '' }).map((row) => row.id)

    // Só o navio: todas as viagens dele.
    expect(recorte('xing wang')).toEqual(['BL-1', 'BL-2'])
    // Só a viagem: o número em qualquer navio — é o que se espera de uma busca só.
    expect(recorte('2401E')).toEqual(['BL-1', 'BL-3'])
    // Os dois juntos, na ordem natural de quem digita.
    expect(recorte('XING WANG 2401E')).toEqual(['BL-1'])
    // E fora de ordem, porque a busca casa termos e não a frase inteira.
    expect(recorte('2401e xing wang')).toEqual(['BL-1'])
    // Tolera barra, vírgula e hífen como separadores (ex.: rótulo "Navio / Viagem").
    expect(recorte('XING WANG / 2401E')).toEqual(['BL-1'])
    expect(recorte('XING WANG/2401E')).toEqual(['BL-1'])
    expect(recorte('XING WANG, 2401E')).toEqual(['BL-1'])
    expect(recorte('COSCO SHIPPING XING WANG - 2401E')).toEqual(['BL-1'])
    // Um termo que não existe zera o recorte em vez de ignorar o excedente.
    expect(recorte('XING WANG 9999')).toEqual([])
  })

  it('aplica CNPJ como restrição e normaliza pontuação', () => {
    const rows = filterCustomerCommunicationBls([
      candidate({ id: 'BL-1' }),
      candidate({ id: 'BL-2', customerId: 100, customerCnpj: '98.765.432/0001-10' }),
    ], {
      mode: 'carga', vesselVoyage: '', pol: '', pod: '', cnpj: '12.345.678000195',
    })
    expect(rows.map((row) => row.id)).toEqual(['BL-1'])
  })

  it('não reaplica filtros operacionais antigos no modo institucional', () => {
    const rows = filterCustomerCommunicationBls([candidate()], {
      mode: 'institucional', vesselVoyage: 'Outro navio V999', pol: 'BRYYY', pod: 'BRXXX', cnpj: '',
    })
    expect(rows.map((row) => row.id)).toEqual(['BL-1'])
  })

  it('inclui ETA futuro e exclui somente carga anterior ao limite institucional', () => {
    const now = new Date('2026-09-01T12:00:00Z')
    expect(isInstitutionalCustomerCommunicable([candidate({ eta: '2027-01-01T00:00:00Z' })], now)).toBe(true)
    expect(isInstitutionalCustomerCommunicable([candidate({ eta: '2025-08-31T23:59:59Z' })], now)).toBe(false)
  })

  it('agrupa por cliente, mostra exclusões e avança discriminador só para reenvio confirmado', () => {
    const first = candidate()
    const second = candidate({ id: 'BL-2', pod: 'BRSSZ', milestoneAt: first.milestoneAt })
    const contactRows = new Map([[99, [contact(1, 'cliente@example.com')]]])
    const conference = buildCustomerCommunicationConference({
      kind: 'aviso_chegada_noa',
      mode: 'carga',
      candidates: [first, second],
      contactsByCustomer: contactRows,
      preferences: [{ contact_id: 1, nature: 'avisos_operacionais', enabled: true }],
      history: [{
        customerId: 99,
        kind: 'aviso_chegada_noa',
        anchorVoyageId: 7,
        anchorPort: 'BRSSZ',
        anchorAtracacaoId: null,
        anchorInvoiceId: null,
        attemptDiscriminator: 0,
      }],
    })

    expect(conference.rows).toHaveLength(1)
    expect(conference.rows[0]?.bls).toHaveLength(2)
    expect(conference.rows[0]?.eligibleRecipients).toHaveLength(1)
    expect(conference.rows[0]?.nextAttemptDiscriminator).toBe(1)
    expect(conference.blockedCustomers).toHaveLength(0)
  })

  it('separa NOBs por identidade da linha de terminal e propaga unassignedOperationFronts', () => {
    const conference = buildCustomerCommunicationConference({
      kind: 'aviso_atracacao_nob',
      mode: 'carga',
      candidates: [
        candidate({ id: 'BL-1', terminalId: 'terminal-1', terminalStateId: 'state-1' }),
        candidate({ id: 'BL-2', terminalId: 'terminal-1', terminalStateId: 'state-2' }),
      ],
      contactsByCustomer: new Map([[99, [contact(1, 'cliente@example.com')]]]),
      preferences: [{ contact_id: 1, nature: 'avisos_operacionais', enabled: true }],
      unassignedOperationFronts: true,
    })

    expect(conference.rows).toHaveLength(2)
    expect(conference.rows.map((row) => row.renderInput.terminalId)).toEqual(['terminal-1', 'terminal-1'])
    expect(conference.unassignedOperationFronts).toBe(true)
  })

  it('usa o próprio disparo como âncora do comunicado livre e avança o discriminador', () => {
    const conference = buildCustomerCommunicationConference({
      kind: 'livre',
      mode: 'carga',
      nature: 'documentacao',
      candidates: [candidate({ id: 'BL-1' }), candidate({ id: 'BL-2', pod: 'BRVIX' })],
      contactsByCustomer: new Map([[99, [contact(1, 'cliente@example.com')]]]),
      preferences: [{ contact_id: 1, nature: 'documentacao', enabled: true }],
      history: [{
        customerId: 99,
        kind: 'livre',
        anchorVoyageId: null,
        anchorPort: null,
        anchorAtracacaoId: null,
        anchorInvoiceId: null,
        attemptDiscriminator: 1,
      }],
    })

    expect(conference.rows).toHaveLength(1)
    expect(conference.rows[0]?.bls).toHaveLength(2)
    expect(conference.rows[0]?.nextAttemptDiscriminator).toBe(2)
  })
})

describe('Contrato entre modo, modelo e público do disparo', () => {
  it('todo modelo manual pertence a exatamente um modo, e o modo é derivado dele', () => {
    for (const [mode, kinds] of Object.entries(MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE)) {
      for (const kind of kinds) {
        expect(getCustomerCommunicationDispatchMode(kind)).toBe(mode)
      }
    }
    // Um modelo nunca aparece nos dois modos: escolher modelo não pode trocar o modo.
    const carga = MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE.carga
    const institucional = MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE.institucional
    expect(carga.filter((kind) => institucional.includes(kind))).toEqual([])
    expect(getDefaultCustomerCommunicationKind('carga')).toBe('aviso_chegada_noa')
    expect(getDefaultCustomerCommunicationKind('institucional')).toBe('institucional')
  })

  it('o comunicado livre é escrito pelo operador e continua ancorado na carga', () => {
    expect(isUserWrittenCustomerCommunicationKind('livre')).toBe(true)
    expect(isUserWrittenCustomerCommunicationKind('institucional')).toBe(true)
    expect(isUserWrittenCustomerCommunicationKind('aviso_chegada_noa')).toBe(false)
    expect(getCustomerCommunicationDispatchMode('livre')).toBe('carga')
    expect(MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE.carga).toContain('livre')
    // O modo carga exige filtro operacional; isso vale também para o livre.
    expect(validateCustomerCommunicationFilters({
      mode: 'carga', vesselVoyage: '', pol: '', pod: '', cnpj: '',
    }).valid).toBe(false)
  })

  it('só o livre deixa o operador escolher o público', () => {
    expect(getCustomerCommunicationAudienceRule('livre')).toMatchObject({ editable: true, audience: { mode: 'todos' } })
    expect(getCustomerCommunicationAudienceRule('institucional')).toMatchObject({ editable: false, audience: { mode: 'todos' } })
    expect(getCustomerCommunicationAudienceRule('aviso_prontidao_nor')).toMatchObject({
      editable: false,
      audience: { mode: 'caixa', boxCode: 'documentacao_operacao' },
    })
  })

  it('só os modelos ancorados em carga confirmam reenvio', () => {
    expect(requiresResendConfirmation('aviso_atracacao_nob')).toBe(true)
    expect(requiresResendConfirmation('livre')).toBe(false)
    expect(requiresResendConfirmation('institucional')).toBe(false)
  })
})

describe('NOB: nome do terminal que vai ao cliente', () => {
  const UUID = 'd0000000-0000-4000-8000-000000000001'
  function nobFor(terminalCode: string | null) {
    const schedules = new Map([[7, [{
      port: 'BRSSZ', eta: '2026-09-01T12:00:00Z', ata: null, omitted: false, deleted: false,
      atracacoes: [{ stateId: 'state-1', terminalId: UUID, terminalCode, atb: '2026-09-02T08:00:00Z' }],
    }]]])
    return expandCandidatesForKind([candidate({ terminalId: null, terminalName: null, terminalStateId: null })], schedules as never, 'aviso_atracacao_nob')
  }

  it('usa a sigla do terminal da Atracação', () => {
    expect(nobFor('BTP').map((row) => row.terminalName)).toEqual(['BTP'])
  })

  it('sem sigla, deixa o terminal vazio em vez de pôr o UUID no aviso', () => {
    const [row] = nobFor(null)
    expect(row.terminalId).toBe(UUID)
    expect(row.terminalName).toBeNull()
  })
})
