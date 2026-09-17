// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// voyageRouteSchedules importa o cliente Supabase no topo do modulo; os modais
// so usam helpers puros dele (POD_CE_STATUS_OPTIONS, getEditableVoyagePodCeStatus).
vi.mock('../../../services/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }))

import { EscalaModal, PolScheduleModal, type EscalaModalData } from '../VoyageScheduleModals'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

afterEach(cleanup)

describe('PolScheduleModal', () => {
  const base = {
    voyageId: 7,
    voyageLabel: 'NAVIO 123N',
    pol: 'CNNBO',
    pod: 'BRSSZ',
    etd: '2026-02-10',
    atd: '2026-02-12',
    ceMaster: null,
    batchIds: [11, 12],
  }

  it('nao renderiza conteudo quando fechado', () => {
    render(<PolScheduleModal open={false} polSchedule={base} onClose={() => {}} onSaved={async () => {}} />)
    expect(screen.queryByText('Editar ETD + ATD e Nº de Manifesto Mercante')).toBeNull()
  })

  it('pre-preenche ETD/ATD e envia o payload correto', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<PolScheduleModal open polSchedule={base} onClose={() => {}} onSaved={onSaved} />)

    expect(screen.getByText('NAVIO 123N')).toBeTruthy()
    expect(screen.getByText('Rota: CNNBO -> BRSSZ')).toBeTruthy()
    expect((screen.getByLabelText('ETD') as HTMLInputElement).value).toBe('2026-02-10')
    expect((screen.getByLabelText('ATD') as HTMLInputElement).value).toBe('2026-02-12')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSaved).toHaveBeenCalledWith({
      voyageId: 7,
      pol: 'CNNBO',
      pod: 'BRSSZ',
      etd: '2026-02-10',
      atd: '2026-02-12',
      ceMaster: null,
      batchIds: [11, 12],
    })
  })

  it('envia etd/atd null quando os campos sao limpos', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(<PolScheduleModal open polSchedule={base} onClose={() => {}} onSaved={onSaved} />)

    await user.clear(screen.getByLabelText('ETD'))
    await user.clear(screen.getByLabelText('ATD'))
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSaved).toHaveBeenCalledWith({
      voyageId: 7,
      pol: 'CNNBO',
      pod: 'BRSSZ',
      etd: null,
      atd: null,
      ceMaster: null,
      batchIds: [11, 12],
    })
  })

  it('pre-preenche e envia o CE Master para os batches do manifesto', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(
      <PolScheduleModal open polSchedule={{ ...base, ceMaster: '25BR00481' }} onClose={() => {}} onSaved={onSaved} />,
    )

    expect((screen.getByLabelText('Nº MANIFESTO') as HTMLInputElement).value).toBe('25BR00481')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ ceMaster: '25BR00481', batchIds: [11, 12] }))
  })

  it('edita CE Master por rota mesmo sem batch de manifesto (#322)', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    render(
      <PolScheduleModal
        open
        polSchedule={{ ...base, ceMaster: '25BR00481', batchIds: [] }}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    )

    expect(screen.getByText('Editar ETD + ATD e Nº de Manifesto Mercante')).toBeTruthy()
    expect((screen.getByLabelText('Nº MANIFESTO') as HTMLInputElement).value).toBe('25BR00481')

    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ pod: 'BRSSZ', ceMaster: '25BR00481', batchIds: [] }))
  })
})

const escalaBase: EscalaModalData = {
  voyageId: 9,
  voyageLabel: 'NAVIO 456S',
  port: 'BRSSZ',
  temImportacao: true,
  eta: '2026-03-01',
  ata: null,
  ceStatus: 'waiting',
  linked: true,
  escalaNumber: null,
  exportExistingId: null,
  temExportacao: false,
  hasGranite: false,
  hasEmpty: false,
  containersQty: null,
  movementsQty: null,
  dischargePorts: [],
  exportLocked: false,
}

const terminalScaleBase = {
  voyageId: 9,
  port: 'BRSSZ',
  portId: 99,
  revision: 0,
  fronts: [
    { id: 'f1', sentido: 'importacao' as const, modalidade: 'carga_cheia' as const, terminalId: 't-norte', source: 'operational_data' as const, hasData: true, section: 'carga_descarregada' as const },
    { id: 'f2', sentido: 'importacao' as const, modalidade: 'vazio' as const, terminalId: null, source: 'operational_data' as const, hasData: true, section: 'vazios_descarregados' as const },
    { id: 'f3', sentido: 'exportacao' as const, modalidade: 'granito' as const, terminalId: 't-sul', source: 'export_declaration' as const, hasData: false, section: 'carga_carregada' as const },
    { id: 'f4', sentido: 'exportacao' as const, modalidade: 'vazio' as const, terminalId: null, source: 'export_declaration' as const, hasData: false, section: 'vazios_embarcados' as const },
  ],
  tbcFronts: [],
  terminals: [
    { terminalId: 't-norte', atb: '2026-03-02T08:00:00Z', atd: null, restow: null },
    { terminalId: 't-sul', atb: null, atd: null, restow: 2 },
  ],
  activeTerminals: [
    { id: 't-norte', code: 'T-NORTE', name: 'Terminal Norte', active: true, portId: 99, historical: false },
    { id: 't-sul', code: 'T-SUL', name: 'Terminal Sul', active: true, portId: 99, historical: false },
    { id: 't-other-port', code: 'T-OUTRO', name: 'Outro porto', active: true, portId: 100, historical: false },
  ],
  historicalTerminals: [
    { id: 't-old', code: 'T-OLD', name: 'Terminal antigo', active: false, portId: 99, historical: true },
  ],
  agencyReports: [],
}

function terminalEscala(overrides: Partial<EscalaModalData> = {}): EscalaModalData {
  return {
    ...escalaBase,
    temExportacao: true,
    hasGranite: true,
    hasEmpty: true,
    terminalScale: terminalScaleBase,
    ...overrides,
  }
}

function renderEscala(escala: EscalaModalData, onSaved = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ConfirmDialogProvider>
      <EscalaModal open escala={escala} onClose={() => {}} onSaved={onSaved} />
    </ConfirmDialogProvider>,
  )
  return onSaved
}

describe('EscalaModal', () => {
  it('usa modos de operação e mostra o planejamento de vazios sem checkbox solto', async () => {
    const user = userEvent.setup()
    renderEscala({ ...escalaBase, port: null })

    expect(screen.getByRole('button', { name: 'Somente importação' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Importação + exportação' })).toBeTruthy()
    expect(screen.queryByLabelText('Esta escala terá exportação')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Importação + exportação' }))
    await user.click(screen.getByRole('button', { name: 'Embarque de vazios' }))

    expect(screen.getByLabelText('Quantidade de CNTR vazios')).toBeTruthy()
    expect(screen.getByLabelText('Movimentos')).toBeTruthy()
  })

  it('não cria a grade de datas para TBC sem data preenchida', () => {
    renderEscala({
      ...escalaBase,
      terminalScale: {
        ...terminalScaleBase,
        fronts: [terminalScaleBase.fronts[1]],
        terminals: [{ terminalId: null, atb: null, atd: null, restow: null }],
      },
    })

    expect(screen.queryByLabelText('ETB TBC')).toBeNull()
    expect(screen.getByText(/permanece em TBC/i)).toBeTruthy()
  })

  it('edita a escala existente sem oferecer troca de porto', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala(escalaBase)

    expect(screen.getByText('Escala: BRSSZ')).toBeTruthy()
    expect(screen.queryByLabelText('Porto da escala')).toBeNull()
    expect((screen.getByLabelText('ETA') as HTMLInputElement).value).toBe('2026-03-01')
    expect(screen.queryByLabelText('RESTOW')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        voyageId: 9,
        port: 'BRSSZ',
        eta: '2026-03-01',
        ata: null,
        linked: true,
        exportacao: { temExportacao: false, hasGranite: false, hasEmpty: false, containersQty: null, movementsQty: null, dischargePorts: [] },
      }),
    )
  })

  it('preserva o status de BLs e CEs ao salvar sem alterar o campo', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala(terminalEscala({ ceStatus: 'received' }))

    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ ceStatus: 'received' }))
  })

  it('normaliza o porto por extenso antes de enviar', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({ ...escalaBase, port: 'Vitoria', temImportacao: false })

    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ port: 'BRVIX', temImportacao: false }))
  })

  it('exige uma frente ao declarar exportação em uma escala nova', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({ ...escalaBase, port: null })

    await user.type(screen.getByLabelText('Porto da escala'), 'BRVIX')
    await user.click(screen.getByRole('button', { name: 'Somente exportação' }))
    await user.click(screen.getByRole('button', { name: 'Adicionar escala' }))

    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('granito ou vazios')
  })

  it('preserva declaração e planejamento de uma linha legada sem flags', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({
      ...escalaBase,
      exportExistingId: 'legacy-export-id',
      temExportacao: true,
      containersQty: 4,
      movementsQty: 2,
      dischargePorts: ['ITGOA'],
    })

    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      exportacao: {
        temExportacao: true,
        hasGranite: false,
        hasEmpty: false,
        containersQty: 4,
        movementsQty: 2,
        dischargePorts: ['ITGOA'],
      },
    }))
  })

  it('recusa porto estrangeiro ao criar a escala', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({ ...escalaBase, port: null })

    await user.type(screen.getByLabelText('Porto da escala'), 'CNSHA')
    await user.click(screen.getByRole('button', { name: 'Adicionar escala' }))

    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('porto brasileiro')
  })

  it('declara vazios sem exigir quantidades e envia o planejamento quando informado', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({ ...escalaBase, port: null })

    expect(screen.queryByLabelText('Quantidade de CNTR vazios')).toBeNull()

    await user.type(screen.getByLabelText('Porto da escala'), 'brvix')
    await user.click(screen.getByRole('button', { name: 'Somente exportação' }))
    await user.click(screen.getByRole('button', { name: 'Embarque de vazios' }))
    await user.type(screen.getByLabelText('Quantidade de CNTR vazios'), '10')
    await user.type(screen.getByLabelText('Portos de descarga'), 'itgoa, nlrtm brssz')
    await user.click(screen.getByRole('button', { name: 'Adicionar escala' }))

    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 'BRVIX',
        exportacao: {
          temExportacao: true,
          hasGranite: false,
          hasEmpty: true,
          containersQty: 10,
          movementsQty: null,
          dischargePorts: ['BRSSZ', 'ITGOA', 'NLRTM'],
        },
      }),
    )
  })

  it('confirma a retirada principal e preserva dados quando o cancelamento é escolhido', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({
      ...escalaBase,
      exportExistingId: 'export-existing-id',
      temExportacao: true,
      hasEmpty: true,
      containersQty: 4,
      movementsQty: 2,
      dischargePorts: ['ITGOA'],
    })

    const toggle = screen.getByRole('button', { name: 'Somente importação' })
    await user.click(toggle)

    const confirmation = screen.getByRole('dialog', { name: 'Retirar a exportação desta escala' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect((screen.getByLabelText('Quantidade de CNTR vazios') as HTMLInputElement).value).toBe('4')
    expect((screen.getByLabelText('Portos de descarga') as HTMLInputElement).value).toBe('ITGOA')

    await user.click(within(confirmation).getByRole('button', { name: 'Cancelar' }))

    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect((screen.getByLabelText('Quantidade de CNTR vazios') as HTMLInputElement).value).toBe('4')
    expect((screen.getByLabelText('Portos de descarga') as HTMLInputElement).value).toBe('ITGOA')

    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      exportacao: expect.objectContaining({
        temExportacao: true,
        hasEmpty: true,
        containersQty: 4,
        movementsQty: 2,
        dischargePorts: ['ITGOA'],
      }),
    }))
  })

  it('só permite remover fronts e planejamento depois da confirmação principal', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({
      ...escalaBase,
      exportExistingId: 'export-existing-id',
      temExportacao: true,
      hasEmpty: true,
      containersQty: 4,
      movementsQty: 2,
      dischargePorts: ['ITGOA'],
    })

    await user.click(screen.getByRole('button', { name: 'Somente importação' }))
    const confirmation = screen.getByRole('dialog', { name: 'Retirar a exportação desta escala' })
    await user.click(within(confirmation).getByRole('button', { name: 'Retirar' }))
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      exportacao: {
        temExportacao: false,
        hasGranite: false,
        hasEmpty: false,
        containersQty: null,
        movementsQty: null,
        dischargePorts: [],
      },
    }))
  })

  it('trava a retirada da exportacao quando ha carga vinculada', () => {
    renderEscala({ ...escalaBase, temExportacao: true, hasEmpty: true, exportLocked: true, containersQty: 4 })

    const toggle = screen.getByRole('button', { name: 'Embarque de vazios' }) as HTMLButtonElement
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.disabled).toBe(true)
    expect(screen.getByText(/carga de exportação vinculada/i)).toBeTruthy()
  })

  it('não trava granito por vazios vinculados à mesma escala', async () => {
    renderEscala({ ...escalaBase, temExportacao: true, hasGranite: true, hasEmpty: true, exportLocked: true, graniteLocked: false, emptyLocked: true })

    const graniteToggle = screen.getByRole('button', { name: 'Granito' }) as HTMLButtonElement
    expect(graniteToggle.disabled).toBe(false)
    fireEvent.click(graniteToggle)
    expect(graniteToggle.getAttribute('aria-pressed')).toBe('false')
  })

  it('permite escala somente de exportação com ETA e atracação', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({
      ...escalaBase,
      temImportacao: true,
      temExportacao: true,
      hasGranite: true,
      eta: '2026-08-10',
    })

    await user.click(screen.getByRole('button', { name: 'Somente exportação' }))
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).toHaveBeenCalled()
  })

  it('não rebasa campos digitados quando o estado terminal chega depois', () => {
    const loadingTerminalScale = {
      ...terminalScaleBase,
      fronts: [],
      terminals: [],
      loading: true,
    }
    const rendered = render(
      <ConfirmDialogProvider>
        <EscalaModal open escala={{ ...escalaBase, terminalScale: loadingTerminalScale }} onClose={vi.fn()} onSaved={vi.fn(async () => undefined)} />
      </ConfirmDialogProvider>,
    )
    const numberInput = screen.getByLabelText('Nº escala (Mercante)') as HTMLInputElement
    fireEvent.change(numberInput, { target: { value: 'DIGITADO' } })

    rendered.rerender(
      <ConfirmDialogProvider>
        <EscalaModal
          open
          escala={{ ...escalaBase, escalaNumber: null, terminalScale: { ...terminalScaleBase, loading: false } }}
          onClose={vi.fn()}
          onSaved={vi.fn(async () => undefined)}
        />
      </ConfirmDialogProvider>,
    )

    expect(numberInput.value).toBe('DIGITADO')
    expect((screen.getByLabelText('Terminal da operação Importação Carga cheia') as HTMLSelectElement).value).toBe('t-norte')
    expect((screen.getByLabelText('ATB T-NORTE') as HTMLInputElement).value).toBe('2026-03-02')
  })

  it('não permite salvar enquanto o estado terminalizado ainda carrega', async () => {
    const onSaved = vi.fn().mockResolvedValue(undefined)
    renderEscala({ ...escalaBase, terminalScale: { ...terminalScaleBase, fronts: [], terminals: [], loading: true } }, onSaved)

    expect((screen.getByRole('button', { name: 'Salvar escala' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('posiciona o foco na data do terminal solicitado pela ação da Visão geral', async () => {
    renderEscala(terminalEscala({ focusTerminalId: 't-norte' }))

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('ETB T-NORTE')))
  })

  it('exige justificativa para alterar expectativa em escala já revisionada mesmo sem terminal atribuído', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({
      ...escalaBase,
      terminalScale: {
        ...terminalScaleBase,
        revision: 1,
        fronts: terminalScaleBase.fronts.map((front) => ({ ...front, terminalId: null })),
        terminals: [],
      },
    })

    await user.click(screen.getByRole('button', { name: 'Somente exportação' }))
    await user.click(screen.getByRole('button', { name: 'Granito' }))
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('justificativa')
  })

  it('não exige justificativa por diferença de formato nas datas nem por resíduos com exportação desligada', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala({
      ...escalaBase,
      temExportacao: false,
      hasGranite: true,
      hasEmpty: true,
      containersQty: 4,
      movementsQty: 2,
      dischargePorts: ['ITGOA'],
      terminalScale: {
        ...terminalScaleBase,
        revision: 1,
        fronts: terminalScaleBase.fronts.filter((front) => front.sentido === 'importacao'),
        terminals: [{ terminalId: 't-norte', atb: '2026-03-02T00:00:00Z', atd: null, restow: null }],
      },
    })

    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('edita quatro frentes em dois terminais, mantém TBC e envia datas sem placeholder', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala(terminalEscala())

    expect(screen.getByRole('region', { name: 'Terminais por operação' })).toBeTruthy()
    const cargaCheia = screen.getByLabelText('Terminal da operação Importação Carga cheia') as HTMLSelectElement
    const vazioImport = screen.getByLabelText('Terminal da operação Importação Vazios') as HTMLSelectElement
    const granito = screen.getByLabelText('Terminal da operação Exportação Granito') as HTMLSelectElement
    expect(cargaCheia.value).toBe('t-norte')
    expect(vazioImport.value).toBe('')
    expect(granito.value).toBe('t-sul')
    expect(within(cargaCheia).queryByRole('option', { name: 'T-OUTRO' })).toBeNull()
    expect(screen.getAllByText(/TBC — pendente/i).length).toBeGreaterThan(0)

    await user.selectOptions(vazioImport, 't-norte')
    await user.selectOptions(screen.getByLabelText('Terminal da operação Exportação Vazios'), 't-sul')
    await user.type(screen.getByLabelText('ATD T-NORTE'), '2026-03-03')
    await user.type(screen.getByLabelText('Justificativa da alteração'), 'distribuição operacional')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      terminalState: expect.objectContaining({
        expectedRevision: 0,
        fronts: expect.arrayContaining([
          expect.objectContaining({ sentido: 'importacao', modalidade: 'vazio', terminalId: 't-norte' }),
          expect.objectContaining({ sentido: 'exportacao', modalidade: 'vazio', terminalId: 't-sul' }),
        ]),
        terminals: expect.arrayContaining([
          expect.objectContaining({ terminalId: 't-norte', atd: '2026-03-03' }),
          expect.objectContaining({ terminalId: 't-sul', restow: 2 }),
        ]),
      }),
    }))
    const payload = onSaved.mock.calls[0][0]
    expect(payload.terminalState.terminals.every((terminal: { terminalId: string }) => terminal.terminalId)).toBe(true)
  })

  it('remove do payload o estado do terminal que ficou sem frente', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala(terminalEscala())

    await user.selectOptions(screen.getByLabelText('Terminal da operação Exportação Granito'), 't-norte')
    await user.type(screen.getByLabelText('Justificativa da alteração'), 'migração de operação')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    const payload = onSaved.mock.calls[0][0]
    expect(payload.terminalState.terminals.map((terminal: { terminalId: string | null }) => terminal.terminalId)).toEqual(['t-norte', null])
  })

  it('filtra terminal por porto e mostra inativo somente como histórico associado', async () => {
    const user = userEvent.setup()
    const escala = terminalEscala({
      terminalScale: {
        ...terminalScaleBase,
        fronts: terminalScaleBase.fronts.map((front) => front.id === 'f1' ? { ...front, terminalId: 't-old' } : front),
      },
    })
    renderEscala(escala)

    const select = screen.getByLabelText('Terminal da operação Importação Carga cheia') as HTMLSelectElement
    expect(within(select).getByRole('option', { name: /T-OLD.*inativo/ })).toBeTruthy()
    expect(within(select).queryByRole('option', { name: 'T-OUTRO' })).toBeNull()
    await user.selectOptions(select, '')
    expect(select.value).toBe('')
  })

  it('rejeita somente ATD anterior ao ATB e permite datas parciais', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala(terminalEscala())
    const atd = screen.getByLabelText('ATD T-NORTE')
    await user.type(atd, '2026-03-01')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('ATD não pode ser anterior')
    await user.clear(atd)
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))
    expect(onSaved).toHaveBeenCalled()
  })

  it('rejeita ATD sem ATB com mensagem de preenchimento', async () => {
    const user = userEvent.setup()
    const onSaved = renderEscala(terminalEscala())
    const atd = screen.getByLabelText('ATD T-SUL')
    await user.type(atd, '2026-03-03')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Informe o ATB')
  })

  it('preserva a edição no conflito de revisão e bloqueia ADR fechado com ação de reabertura', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockRejectedValueOnce(Object.assign(new Error('REVISAO_OBSOLETA'), { code: 'P0001' }))
    renderEscala(terminalEscala({ terminalScale: { ...terminalScaleBase, revision: 1 } }), onSaved)
    const select = screen.getByLabelText('Terminal da operação Importação Carga cheia') as HTMLSelectElement
    await user.selectOptions(select, 't-sul')
    await user.type(screen.getByLabelText('Justificativa da alteração'), 'ajuste operacional')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))
    expect(screen.getByRole('alert').textContent).toContain('recarregue')
    expect(select.value).toBe('t-sul')

    const blocked = vi.fn().mockRejectedValueOnce(Object.assign(new Error('ADR fechado'), {
      code: 'ADR_CLOSED_BLOCKED',
      blockers: [{ reportId: 'adr-1', terminalId: 't-sul', terminalCode: 'T-SUL', reason: 'front_change' }],
    }))
    cleanup()
    renderEscala(terminalEscala(), blocked)
    await user.selectOptions(screen.getByLabelText('Terminal da operação Importação Carga cheia'), 't-sul')
    await user.type(screen.getByLabelText('Justificativa da alteração'), 'ajuste com ADR fechado')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))
    expect(screen.getByRole('alert').textContent).toContain('ADR fechado')
    expect(screen.getByText(/terminal T-SUL/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reabrir ADR' })).toBeTruthy()
  })

  it('rejeita ATA com data preenchida e hora vazia', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    renderEscala(escalaBase, onSaved)

    await user.type(screen.getByLabelText('ATA'), '2026-03-05')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('hora do ATA é obrigatória')
  })

  it('permite ATA com data e hora preenchidas', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    renderEscala(escalaBase, onSaved)

    await user.type(screen.getByLabelText('ATA'), '2026-03-05')
    await user.type(screen.getByLabelText('ATA Hora'), '14:30')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      ata: '2026-03-05T14:30:00',
    }))
  })

  it('permite ETA com ou sem hora preenchida', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    renderEscala(escalaBase, onSaved)

    await user.clear(screen.getByLabelText('ETA'))
    await user.type(screen.getByLabelText('ETA'), '2026-03-10')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      eta: '2026-03-10',
    }))

    onSaved.mockClear()
    await user.type(screen.getByLabelText('ETA Hora'), '10:00')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      eta: '2026-03-10T10:00:00',
    }))
  })

  it('rejeita ATB de terminal com data preenchida e hora vazia', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    renderEscala(terminalEscala({
      terminalScale: {
        ...terminalScaleBase,
        terminals: [
          { terminalId: 't-norte', atb: null, atd: null, restow: null },
          { terminalId: 't-sul', atb: null, atd: null, restow: null },
        ],
      },
    }), onSaved)

    await user.type(screen.getByLabelText('ATB T-NORTE'), '2026-03-04')
    await user.click(screen.getByRole('button', { name: 'Salvar escala' }))

    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('hora do ATB é obrigatória')
  })
})
