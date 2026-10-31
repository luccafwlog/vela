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
import { communicationBoxKindsFromMigrations } from './communicationBoxKindsSql'
import { renderCustomerCommunicationTemplate } from '../customerCommunicationTemplates'

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
  it('não permite conferência de carga sem Viagem escolhida, mesmo com CNPJ ou porto', () => {
    expect(validateCustomerCommunicationFilters({
      mode: 'carga', voyageId: null, pol: '', pod: '', cnpj: '12.345.678/0001-95',
    }).valid).toBe(false)
    // POD sozinho alcançava toda viagem já feita para o porto.
    expect(validateCustomerCommunicationFilters({
      mode: 'carga', voyageId: null, pol: '', pod: 'BRVIX', cnpj: '',
    })).toEqual({ valid: false, message: 'No modo carga, escolha o Navio / Viagem.' })
    expect(validateCustomerCommunicationFilters({
      mode: 'carga', voyageId: 7, pol: '', pod: '', cnpj: '',
    }).valid).toBe(true)
  })

  it('a Viagem é a escolhida, pelo id: a viagem 6 não traz a 16 nem a 26 do mesmo navio', () => {
    const rows = [
      candidate({ id: 'BL-6', voyageId: 6, vesselName: 'GREEN GUANGZHOU', voyageNumber: '6' }),
      candidate({ id: 'BL-16', voyageId: 16, vesselName: 'GREEN GUANGZHOU', voyageNumber: '16' }),
      candidate({ id: 'BL-26', voyageId: 26, vesselName: 'GREEN GUANGZHOU', voyageNumber: '26' }),
    ]
    expect(filterCustomerCommunicationBls(rows, { mode: 'carga', voyageId: 6, pol: '', pod: '', cnpj: '' }).map((row) => row.id)).toEqual(['BL-6'])
  })

  it('POL e POD vazios são a Viagem inteira; escolhidos, casam pelo porto normalizado', () => {
    const rows = [
      candidate({ id: 'BL-VIT', pol: 'CNTAO', pod: 'BRVIT' }),
      candidate({ id: 'BL-VIX', pol: 'CNNGB', pod: 'BRVIX' }),
      candidate({ id: 'BL-SSZ', pol: 'CNTAO', pod: 'BRSSZ' }),
    ]
    const recorte = (pol: string, pod: string) =>
      filterCustomerCommunicationBls(rows, { mode: 'carga', voyageId: 7, pol, pod, cnpj: '' }).map((row) => row.id)
    expect(recorte('', '')).toEqual(['BL-VIT', 'BL-VIX', 'BL-SSZ'])
    // BRVIT e BRVIX são o mesmo porto, como na régua.
    expect(recorte('', 'BRVIX')).toEqual(['BL-VIT', 'BL-VIX'])
    expect(recorte('CNTAO', '')).toEqual(['BL-VIT', 'BL-SSZ'])
    expect(recorte('CNTAO', 'BRVIX')).toEqual(['BL-VIT'])
    // Código é comparado inteiro, não por trecho: "BRV" não é porto.
    expect(recorte('', 'BRV')).toEqual([])
  })

  it('aplica CNPJ como restrição e normaliza pontuação', () => {
    const rows = filterCustomerCommunicationBls([
      candidate({ id: 'BL-1' }),
      candidate({ id: 'BL-2', customerId: 100, customerCnpj: '98.765.432/0001-10' }),
    ], {
      mode: 'carga', voyageId: 7, pol: '', pod: '', cnpj: '12.345.678000195',
    })
    expect(rows.map((row) => row.id)).toEqual(['BL-1'])
  })

  it('não reaplica filtros operacionais antigos no modo institucional', () => {
    const rows = filterCustomerCommunicationBls([candidate()], {
      mode: 'institucional', voyageId: 999, pol: 'BRYYY', pod: 'BRXXX', cnpj: '',
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

  // D12 de 2026-10-27 (opção B do dono): Cliente sem contato ativo com e-mail sai do institucional.
  it('institucional tira da lista o Cliente sem contato ativo com e-mail', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    const build = (contacts: CustomerContact[]) => buildCustomerCommunicationConference({
      kind: 'institucional',
      mode: 'institucional',
      candidates: [candidate()],
      contactsByCustomer: new Map([[99, contacts]]),
      now,
    })
    expect(build([]).rows).toHaveLength(0)
    expect(build([contact(1, null), { ...contact(2, 'antigo@example.com'), deactivated_at: '2026-09-02T00:00:00Z' }]).rows).toHaveLength(0)
    expect(build([contact(1, 'cliente@example.com')]).rows).toHaveLength(1)
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
    // O modo carga exige a Viagem; isso vale também para o livre.
    expect(validateCustomerCommunicationFilters({
      mode: 'carga', voyageId: null, pol: '', pod: '', cnpj: '',
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

describe('NOB: regra única de quem entra na Atracação (B3, migration 243)', () => {
  const T1 = 'd0000000-0000-4000-8000-0000000000a1'
  const T2 = 'd0000000-0000-4000-8000-0000000000a2'
  const schedules = new Map([[7, [{
    port: 'BRSSZ', eta: '2026-09-01T12:00:00Z', ata: null, omitted: false, deleted: false,
    atracacoes: [{ stateId: 'state-1', terminalId: T1, terminalCode: 'T1', atb: '2026-09-02T08:00:00Z' }],
  }]]])
  const key = (terminal: string, modalidade: string) => `7::BRSSZ::${terminal}::${modalidade}`
  const nob = (row: Partial<CustomerCommunicationBlCandidate>, fronts: string[]) =>
    expandCandidatesForKind([candidate({ terminalId: null, terminalName: null, terminalStateId: null, ...row })], schedules as never,
      'aviso_atracacao_nob', new Set(fronts)).map((item) => item.id)

  it('o B/L misto só entra com as frentes de carga cheia e de carga solta no terminal', () => {
    expect(nob({ id: 'MIX', cargoMode: 'misto' }, [key(T1, 'carga_solta'), key(T2, 'carga_cheia')])).toEqual([])
    expect(nob({ id: 'MIX', cargoMode: 'misto' }, [key(T1, 'carga_solta'), key(T1, 'carga_cheia')])).toEqual(['MIX'])
  })

  it('a exceção de terminal do B/L vence a frente', () => {
    expect(nob({ id: 'EXC', terminalOverrideId: T1 }, [key(T2, 'carga_cheia')])).toEqual(['EXC'])
    expect(nob({ id: 'EXC', terminalOverrideId: T2 }, [key(T1, 'carga_cheia')])).toEqual([])
  })
})

describe('CE e Taxas no Disparo (pedido do dono, 2026-10-31)', () => {
  const boxKinds = communicationBoxKindsFromMigrations()
  const docs = { ...contact(1, 'docs@cliente.com'), customer_id: 99 }
  const fin = { ...contact(2, 'fin@cliente.com'), customer_id: 99, is_primary: false }
  const dem = { ...contact(3, 'dem@cliente.com'), customer_id: 99, is_primary: false }
  const boxLinks = [
    { contact_id: 1, box_code: 'documentacao_operacao' },
    { contact_id: 2, box_code: 'financeiro' },
    { contact_id: 3, box_code: 'demurrage' },
  ]
  const ready = {
    ready: true,
    reason: null,
    renderInput: {
      customerId: 99, customerName: 'Cliente 99', vesselName: 'Navio 7', voyageNumber: 'V7', port: 'BRSSZ', milestoneAt: '',
      bls: [{ id: 'BL-SSZ', customerId: 99 }, { id: 'BL-VIX', customerId: 99 }],
      ceMercanteRows: [{ blId: 'BL-SSZ', ceMercante: '152605000001', totalBrl: 100 }, { blId: 'BL-VIX', ceMercante: '152605000002', totalBrl: 50 }],
    },
  }
  function conference(ceData: typeof ready | { ready: false; reason: string; renderInput: null } | null, history: Parameters<typeof buildCustomerCommunicationConference>[0]['history'] = []) {
    const kind = 'ce_mercante_taxas' as const
    return buildCustomerCommunicationConference({
      kind,
      mode: 'carga',
      audience: getCustomerCommunicationAudienceRule(kind).audience,
      candidates: [candidate({ id: 'BL-SSZ', pod: 'BRSSZ' }), candidate({ id: 'BL-VIX', pod: 'BRVIX' })],
      contactsByCustomer: new Map([[99, [docs, fin, dem]]]),
      boxLinks,
      boxKinds,
      history,
      ceMercante: ceData ? new Map([['99:7', ceData]]) : new Map(),
    })
  }

  it('o modo Carga oferece os quatro e-mails automáticos da carga e o livre', () => {
    expect(MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE.carga).toEqual(['aviso_chegada_noa', 'aviso_prontidao_nor', 'aviso_atracacao_nob', 'ce_mercante_taxas', 'livre'])
    expect(getCustomerCommunicationDispatchMode('ce_mercante_taxas')).toBe('carga')
    expect(isUserWrittenCustomerCommunicationKind('ce_mercante_taxas')).toBe(false)
    expect(requiresResendConfirmation('ce_mercante_taxas')).toBe(true)
    expect(getCustomerCommunicationAudienceRule('ce_mercante_taxas')).toMatchObject({ editable: false, label: 'Documentação e Operação e Financeiro' })
  })

  it('uma linha por Cliente e Viagem, com os B/Ls dos dois portos, para Documentação e Operação e Financeiro', () => {
    const result = conference(ready)
    expect(result.rows).toHaveLength(1)
    const [row] = result.rows
    expect(row!.bls.map((bl) => bl.id)).toEqual(['BL-SSZ', 'BL-VIX'])
    // Demurrage não recebe o CE e Taxas; Financeiro recebe, como na Edge.
    expect(row!.eligibleRecipients.map((recipient) => recipient.email).sort()).toEqual(['docs@cliente.com', 'fin@cliente.com'])
    expect(row!.blocked).toBe(false)
    expect(row!.nextAttemptDiscriminator).toBe(0)
    // A prévia sai com os CEs e valores lidos para a conferência.
    const rendered = renderCustomerCommunicationTemplate('ce_mercante_taxas', row!.renderInput)
    expect(rendered.text).toContain('152605000002')
  })

  it('o Cliente sem prontidão fica bloqueado, com o motivo, e fora da seleção', () => {
    const [row] = conference({ ready: false, reason: 'CE Mercante ausente', renderInput: null }).rows
    expect(row).toMatchObject({ blocked: true, selected: false, blockedReason: 'CE Mercante ausente' })
    // Prontidão que não pôde ser lida também não deixa enviar.
    expect(conference(null).rows[0]).toMatchObject({ blocked: true, blockedReason: 'Não foi possível conferir a prontidão do CE e Taxas.' })
  })

  it('o envio anterior conta pelo Cliente e Viagem, sem porto (o CE grava porto nulo)', () => {
    const history = [{ customerId: 99, kind: 'ce_mercante_taxas', anchorVoyageId: 7, anchorPort: null, anchorAtracacaoId: null, anchorInvoiceId: null, attemptDiscriminator: 0 }]
    expect(conference(ready, history).rows[0]!.nextAttemptDiscriminator).toBe(1)
    // Outra Viagem não conta.
    expect(conference(ready, [{ ...history[0]!, anchorVoyageId: 8 }]).rows[0]!.nextAttemptDiscriminator).toBe(0)
  })
})
