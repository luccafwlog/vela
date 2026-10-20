import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_COMMUNICATION_NATURES,
  getCustomerCommunicationNature,
  resolveCustomerCommunicationRecipients,
  validateCustomerCommunicationFilters,
  buildCustomerCommunicationConference,
  type CustomerCommunicationBlCandidate,
} from '../customerCommunications'
import {
  CUSTOMER_COMMUNICATION_KINDS,
  validateCommunicationAttachments,
  renderCeMercanteTaxasTemplate,
  renderDemurrageTemplate,
  renderNoaTemplate,
  CUSTOMER_PORTAL_BILLING_URL,
} from '../customerCommunicationTemplates'
import { roleHasPermission } from '../../hooks/useAuth'
import { resolveBounceCascade } from '../../../supabase/functions/_shared/portalBounceCascade.ts'
import type { CustomerContact } from '../../types/database'
import { ALERT_RULES } from '../alertRulesCatalog'

function makeContact(overrides: Partial<CustomerContact> & { id: number; email: string }): CustomerContact {
  return {
    customer_id: 10,
    name: 'Contato',
    is_primary: false,
    purpose: 'geral',
    email_normalized: overrides.email.toLowerCase(),
    phone: null,
    created_at: null,
    deactivated_at: null,
    updated_at: '2026-09-01T00:00:00Z',
    origin: 'interno',
    ...overrides,
  }
}

function makeCandidate(overrides: Partial<CustomerCommunicationBlCandidate> & { id: string; customerId: number }): CustomerCommunicationBlCandidate {
  return {
    customerName: 'Cliente',
    customerCnpj: '11.111.111/0001-11',
    voyageId: 100,
    vesselName: 'COSCO SHIPPING XING WANG',
    voyageNumber: '2401E',
    pod: 'BRSSZ',
    pol: 'CNSHA',
    cargoMode: 'container',
    eta: '2026-09-10T12:00:00Z',
    ata: null,
    terminalId: null,
    terminalName: null,
    terminalStateId: null,
    milestoneAt: '2026-09-10T12:00:00Z',
    ...overrides,
  }
}

describe('Revisão Completa E2E: Módulo de Comunicação com o Cliente', () => {
  describe('1. Modelos de Envio Cadastrados e Mapeamento de Natureza', () => {
    it('todos os 7 modelos estão cadastrados e reconhecidos no sistema', () => {
      const expectedKinds = [
        'aviso_chegada_noa',
        'aviso_prontidao_nor',
        'aviso_atracacao_nob',
        'ce_mercante_taxas',
        'cobranca_demurrage',
        'institucional',
        'livre',
      ]
      expect([...CUSTOMER_COMMUNICATION_KINDS].sort()).toEqual(expectedKinds.sort())
    })

    it('mapeia cada modelo obrigatório à sua respectiva natureza', () => {
      expect(getCustomerCommunicationNature('aviso_chegada_noa')).toBe('avisos_operacionais')
      expect(getCustomerCommunicationNature('aviso_prontidao_nor')).toBe('avisos_operacionais')
      expect(getCustomerCommunicationNature('aviso_atracacao_nob')).toBe('avisos_operacionais')
      expect(getCustomerCommunicationNature('ce_mercante_taxas')).toBe('documentacao')
      expect(getCustomerCommunicationNature('cobranca_demurrage')).toBe('demurrage')
      expect(getCustomerCommunicationNature('institucional')).toBe('avisos_gerais')
    })

    it('modelo livre suporta qualquer uma das 4 naturezas definidas pelo operador', () => {
      for (const nature of CUSTOMER_COMMUNICATION_NATURES) {
        expect(getCustomerCommunicationNature('livre', nature)).toBe(nature)
      }
    })
  })

  describe('2. Ações de Recorte, Destinatários e Conferência', () => {
    it('invariante 3: modo carga exige ao menos um filtro de carga para evitar disparos acidentais à base inteira', () => {
      const emptyValidation = validateCustomerCommunicationFilters({
        mode: 'carga',
        vesselVoyage: '',
        pol: '',
        pod: '',
        cnpj: '',
      })
      expect(emptyValidation.valid).toBe(false)
      expect(emptyValidation.message).toContain('filtro operacional')

      const cnpjOnlyValidation = validateCustomerCommunicationFilters({
        mode: 'carga',
        vesselVoyage: '',
        pol: '',
        pod: '',
        cnpj: '12.345.678/0001-90',
      })
      expect(cnpjOnlyValidation.valid).toBe(false)

      const validValidation = validateCustomerCommunicationFilters({
        mode: 'carga',
        vesselVoyage: '2401E',
        pol: '',
        pod: '',
        cnpj: '',
      })
      expect(validValidation.valid).toBe(true)
    })

    it('modo institucional permite conferência sobre o conjunto de Clientes Comunicáveis', () => {
      const instValidation = validateCustomerCommunicationFilters({
        mode: 'institucional',
        vesselVoyage: '',
        pol: '',
        pod: '',
        cnpj: '',
      })
      expect(instValidation.valid).toBe(true)
    })

    it('resolve contatos com os 4 motivos de exclusão e marca cliente bloqueado quando zera (Invariante 5)', () => {
      const contacts = [
        makeContact({ id: 1, customer_id: 10, name: 'Sem Email', email: '', is_primary: false, purpose: 'geral' }),
        makeContact({ id: 2, customer_id: 10, name: 'Pref Desligada', email: 'off@ex.com', is_primary: false, purpose: 'geral' }),
        makeContact({ id: 3, customer_id: 10, name: 'Reclamou', email: 'complaint@ex.com', is_primary: false, purpose: 'geral' }),
        makeContact({ id: 4, customer_id: 10, name: 'Caixa Morta', email: 'bounce@ex.com', is_primary: false, purpose: 'geral' }),
      ]

      const preferences = [
        { contact_id: 2, nature: 'avisos_operacionais' as const, enabled: false },
      ]
      const communicationSuppressions = [{ email: 'complaint@ex.com', reason: 'complaint' }]
      const portalSuppressions = [{ email: 'bounce@ex.com', reason: 'bounce_permanente' }]

      const resolved = resolveCustomerCommunicationRecipients({
        contacts,
        nature: 'avisos_operacionais',
        preferences,
        communicationSuppressions,
        portalSuppressions,
      })

      expect(resolved.eligible).toHaveLength(0)
      expect(resolved.blocked).toBe(true)
      expect(resolved.excluded).toHaveLength(4)

      const reasons = new Set(resolved.excluded.map((e) => e.reason))
      expect(reasons.has('email_ausente')).toBe(true)
      expect(reasons.has('preferencia_desligada')).toBe(true)
      expect(reasons.has('suprimido_complaint')).toBe(true)
      expect(reasons.has('suprimido_bounce')).toBe(true)
    })

    it('invariante 7: supressão de complaint é restrita ao canal de Comunicados; bounce permanente bloqueia ambos', () => {
      const contact = makeContact({ id: 10, customer_id: 5, name: 'Maria', email: 'maria@empresa.com', is_primary: true, purpose: 'geral' })

      // 1. Complaint do canal de comunicados:
      const channelBlocked = resolveCustomerCommunicationRecipients({
        contacts: [contact],
        nature: 'avisos_operacionais',
        preferences: [],
        communicationSuppressions: [{ email: 'maria@empresa.com', reason: 'complaint' }],
        portalSuppressions: [],
      })
      expect(channelBlocked.blocked).toBe(true)
      expect(channelBlocked.excluded[0]?.reason).toBe('suprimido_complaint')

      // 2. Bounce permanente registrado no portal: bloqueia canal de comunicados também
      const bounceBlocked = resolveCustomerCommunicationRecipients({
        contacts: [contact],
        nature: 'avisos_operacionais',
        preferences: [],
        communicationSuppressions: [],
        portalSuppressions: [{ email: 'maria@empresa.com', reason: 'bounce_permanente' }],
      })
      expect(bounceBlocked.blocked).toBe(true)
      expect(bounceBlocked.excluded[0]?.reason).toBe('suprimido_bounce')
    })
  })

  describe('3. Contadores da Conferência e Detalhamento', () => {
    it('calcula com precisão totalCustomers, totalEligibleEmails, totalExcludedEmails e contagens por motivo', () => {
      const candidateA = makeCandidate({
        id: 'BL-1',
        voyageId: 100,
        customerId: 1,
        customerName: 'Cliente A',
        customerCnpj: '11.111.111/0001-11',
      })
      const candidateB = makeCandidate({
        id: 'BL-2',
        voyageId: 100,
        customerId: 2,
        customerName: 'Cliente B',
        customerCnpj: '22.222.222/0001-22',
      })

      const contactsByCustomer = new Map([
        [1, [makeContact({ id: 101, customer_id: 1, name: 'A1', email: 'a1@test.com', is_primary: true }), makeContact({ id: 102, customer_id: 1, name: 'A2', email: 'a2@test.com', is_primary: false })]],
        [2, [makeContact({ id: 201, customer_id: 2, name: 'B1', email: '', is_primary: true })]], // bloqueado
      ])

      const conference = buildCustomerCommunicationConference({
        kind: 'aviso_chegada_noa',
        mode: 'carga',
        candidates: [candidateA, candidateB],
        contactsByCustomer,
        preferences: [],
      })

      expect(conference.totalCustomers).toBe(2)
      expect(conference.totalEligibleEmails).toBe(2)
      expect(conference.totalExcludedEmails).toBe(1)
      expect(conference.blockedCustomers).toHaveLength(1)
      expect(conference.blockedCustomers[0]?.customerId).toBe(2)
      expect(conference.excludedReasonCounts.email_ausente).toBe(1)
      expect(conference.excludedReasonCounts.preferencia_desligada).toBe(0)
    })
  })

  describe('4. Gates de Negócio e Segurança', () => {
    it('Gate RBAC: rota e ações de comunicados são concedidas a administrativo, documentacao e equipamentos, e negadas a operacoes e financeiro', () => {
      expect(roleHasPermission('administrativo', 'customer_communications')).toBe(true)
      expect(roleHasPermission('documentacao', 'customer_communications')).toBe(true)
      expect(roleHasPermission('equipamentos', 'customer_communications')).toBe(true)
      expect(roleHasPermission('operacoes', 'customer_communications')).toBe(false)
      expect(roleHasPermission('financeiro', 'customer_communications')).toBe(false)
    })

    it('Gate Invariante 6: proíbe anexos em CE Mercante e Demurrage, permitindo nos demais modelos', () => {
      const pdf = { filename: 'doc.pdf', contentType: 'application/pdf', size: 1024 }

      expect(validateCommunicationAttachments('ce_mercante_taxas', [pdf]).valid).toBe(false)
      expect(validateCommunicationAttachments('cobranca_demurrage', [pdf]).valid).toBe(false)

      expect(validateCommunicationAttachments('aviso_chegada_noa', [pdf]).valid).toBe(true)
      expect(validateCommunicationAttachments('aviso_prontidao_nor', [pdf]).valid).toBe(true)
      expect(validateCommunicationAttachments('aviso_atracacao_nob', [pdf]).valid).toBe(true)
      expect(validateCommunicationAttachments('institucional', [pdf]).valid).toBe(true)
      expect(validateCommunicationAttachments('livre', [pdf]).valid).toBe(true)
    })

    it('Gate Invariante 6: limita anexos a no máximo 3 arquivos e 10 MB no total', () => {
      const pdf = (size: number) => ({ filename: 'doc.pdf', contentType: 'application/pdf', size })

      expect(validateCommunicationAttachments('institucional', [pdf(1), pdf(2), pdf(3)]).valid).toBe(true)
      expect(validateCommunicationAttachments('institucional', [pdf(1), pdf(2), pdf(3), pdf(4)]).valid).toBe(false)
      expect(validateCommunicationAttachments('institucional', [pdf(11 * 1024 * 1024)]).valid).toBe(false)
    })

    it('Gate Invariante 1: um comunicado é gerado por cliente com apenas seus próprios B/Ls', () => {
      expect(() => renderNoaTemplate({
        customerId: 10,
        customerName: 'Cliente A',
        vesselName: 'V',
        voyageNumber: '1',
        port: 'P',
        milestoneAt: '2026-09-01T10:00:00Z',
        bls: [
          { id: 'BL-A', customerId: 10 },
          { id: 'BL-B', customerId: 20 }, // Pertence a outro cliente!
        ],
      })).toThrow('B/L de outro cliente não pode entrar no comunicado')
    })
  })

  describe('5. Alertas Operacionais e Cascata de Bounce', () => {
    it('catálogo de alertas registra os 4 tipos de comunicado com roteamento e severidades corretas', () => {
      const noaAlert = ALERT_RULES.find((a) => a.type === 'comunicado_noa_pendente')
      const norAlert = ALERT_RULES.find((a) => a.type === 'comunicado_nor_pendente')
      const nobAlert = ALERT_RULES.find((a) => a.type === 'comunicado_nob_pendente')
      const bounceAlert = ALERT_RULES.find((a) => a.type === 'cliente_contato_bounced_sem_alternativa')

      expect(noaAlert).toBeDefined()
      expect(noaAlert?.responsibleDepartments).toContain('documentacao')
      expect(noaAlert?.destination).toBe('/clientes/comunicacao')

      expect(norAlert).toBeDefined()
      expect(norAlert?.responsibleDepartments).toContain('documentacao')
      expect(norAlert?.destination).toBe('/clientes/comunicacao')

      expect(nobAlert).toBeDefined()
      expect(nobAlert?.responsibleDepartments).toContain('documentacao')
      expect(nobAlert?.destination).toBe('/clientes/comunicacao')

      expect(bounceAlert).toBeDefined()
      expect(bounceAlert?.severity).toBe('critical')
      expect(bounceAlert?.catalogAudience).toEqual(expect.arrayContaining(['documentacao']))
    })

    it('cascata de bounce (C11): bounce em contato secundário notifica o principal', () => {
      const contacts = [
        { id: 1, email: 'principal@cliente.com', is_primary: true },
        { id: 2, email: 'secundario@cliente.com', is_primary: false },
      ]
      const decision = resolveBounceCascade({
        contacts,
        bouncedEmail: 'secundario@cliente.com',
      })

      expect(decision.notificationRecipient?.email).toBe('principal@cliente.com')
      expect(decision.shouldOpenAlert).toBe(false)
    })

    it('cascata de bounce (C11): bounce no contato principal notifica o alternativo disponível', () => {
      const contacts = [
        { id: 1, email: 'principal@cliente.com', is_primary: true },
        { id: 2, email: 'alternativo@cliente.com', is_primary: false },
      ]
      const decision = resolveBounceCascade({
        contacts,
        bouncedEmail: 'principal@cliente.com',
      })

      expect(decision.notificationRecipient?.email).toBe('alternativo@cliente.com')
      expect(decision.shouldOpenAlert).toBe(false)
    })

    it('cascata de bounce (C11): cliente sem nenhum contato alternativo válido aciona abertura do alerta interno', () => {
      const contacts = [
        { id: 1, email: 'unico@cliente.com', is_primary: true },
      ]
      const decision = resolveBounceCascade({
        contacts,
        bouncedEmail: 'unico@cliente.com',
      })

      expect(decision.notificationRecipient).toBeNull()
      expect(decision.shouldOpenAlert).toBe(true)
    })
  })

  describe('6. Régua de Cobrança Semanal de Demurrage', () => {
    it('comunicado de Demurrage apresenta total em USD, valor informativo em BRL com ROE, e link sem PIX', () => {
      const rendered = renderDemurrageTemplate({
        customerId: 10,
        customerName: 'Importadora Sul',
        vesselName: 'COSCO STAR',
        voyageNumber: '101S',
        port: 'Santos',
        milestoneAt: '2026-09-01T00:00:00Z',
        bls: [{ id: 'BL-DEM-1', customerId: 10 }],
        demurrage: {
          docNumber: 'DEM-999',
          totalUsd: 1200,
          totalBrl: 6600,
          roe: 5.5,
          roeReferenceDate: '2026-09-01',
        },
      })

      expect(rendered.subject).toContain('Cobrança de Demurrage — DEM-999 — COSCO STAR / 101S')
      expect(rendered.text).toContain('Invoice DEM-999: US$ 1.200,00 (valor da cobrança)')
      expect(rendered.text).toContain('6.600,00')
      expect(rendered.text).toContain('ROE: 5,5000 em 01/09/2026')
      expect(rendered.text).toContain('O valor em reais é recalculado no dia do pagamento.')
      expect(rendered.html).not.toMatch(/PIX|chave pix/i)
      expect(rendered.html).toContain(CUSTOMER_PORTAL_BILLING_URL)
    })
  })

  describe('7. Comunicado de CE Mercante e Taxas Locais', () => {
    it('apresenta ênfase destacada no número do CE Mercante e resumo em BRL com link para o Portal', () => {
      const rendered = renderCeMercanteTaxasTemplate({
        customerId: 10,
        customerName: 'Importadora Norte',
        vesselName: 'COSCO SHIPPING XING WANG',
        voyageNumber: '2401E',
        port: 'Santos',
        milestoneAt: '2026-09-01T00:00:00Z',
        bls: [{ id: 'BL-100', customerId: 10 }],
        ceMercanteRows: [
          { blId: 'BL-100', ceMercante: '123456789012345', totalBrl: 850.5 },
        ],
        totalBrl: 850.5,
      })

      expect(rendered.subject).toBe('CE Mercante e Taxas Locais disponíveis — COSCO SHIPPING XING WANG / 2401E — Porto de Santos')
      expect(rendered.html).toContain('123456789012345')
      expect(rendered.html).toContain('BL-100')
      expect(rendered.html).toContain('850,50')
      expect(rendered.html).not.toMatch(/PIX|vencimento/i)
      expect(rendered.html).toContain(CUSTOMER_PORTAL_BILLING_URL)
    })
  })
})
