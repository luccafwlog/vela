import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { StatusText } from '../ui/StatusText'
import { useMercanteEdiInput } from '../../hooks/useManifestosMercante'
import { formatDate, formatCountLabel } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import { downloadBlob } from '../../lib/download'
import {
  buildMercanteBreakbulkEdi,
  buildMercanteCargoEdi,
  buildMercanteVaziosEdi,
  mercanteFileTag,
  mercantePortCode,
  type MercanteEdiIssue,
  type MercanteEdiResult,
} from '../../services/mercanteEdi'
import { registerMercanteEdiFile, type MercanteCargoInput, type MercanteVaziosInput } from '../../services/mercanteEdiData'
import { queryKeys } from '../../services/queryKeys'

/** `carga_solta`: arquivo parcial, com o que a equipe completa antes de enviar. */
export type MercanteEdiRoute = { pol: string; pod: string; label: string; kind: 'carga' | 'carga_solta' | 'vazio' }

function isCargo(input: MercanteCargoInput | MercanteVaziosInput): input is MercanteCargoInput {
  return 'bls' in input
}

function IssueList({ title, issues, tone }: { title: string; issues: MercanteEdiIssue[]; tone: 'danger' | 'warning' }) {
  if (!issues.length) return null
  return (
    <section aria-label={title} className="space-y-1">
      <h3 className="text-sm font-semibold"><StatusText tone={tone}>{title} ({issues.length})</StatusText></h3>
      <ul className="max-h-56 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm">
        {issues.map((issue, index) => (
          <li key={`${issue.ref ?? 'manifesto'}-${index}`}>
            {issue.ref ? <span className="font-mono">{issue.ref}: </span> : null}{issue.message}
          </li>
        ))}
      </ul>
    </section>
  )
}

const FILE_MODE = { carga: 'container', carga_solta: 'carga_solta', vazio: 'vazio' } as const

/**
 * Gerar EDI Mercante de uma linha de Rotas e Manifestos (issue 560): prévia
 * com os dados do manifesto, o que impede o download e os avisos. Baixar
 * arquivo registra a geração no Histórico da Viagem, com o número sequencial
 * do Vela no nome (migration 600), e só então baixa; o envio ao Mercante
 * continua fora do Vela.
 */
export function MercanteEdiModal({ voyageId, route, onClose }: { voyageId: number; route: MercanteEdiRoute; onClose: () => void }) {
  const { data, isLoading, error } = useMercanteEdiInput(voyageId, route)
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)

  const result = useMemo<(MercanteEdiResult & { extra: MercanteEdiIssue[] }) | null>(() => {
    if (!data) return null
    const extra: MercanteEdiIssue[] = []
    if (!data.hasBaplie && route.kind !== 'vazio') {
      extra.push({ severity: 'aviso', ref: null, message: 'A Viagem não tem Baplie importado: o IMO vem do Baplie, então nenhum contêiner sai como carga perigosa. Importe o Baplie antes de enviar.' })
    }
    if (isCargo(data)) {
      for (const skipped of data.skippedBls) {
        extra.push({ severity: 'aviso', ref: skipped.id, message: `Fora deste arquivo: ${skipped.reason} vai no EDI Mercante da carga solta (botão da mesma linha).` })
      }
      const build = route.kind === 'carga_solta' ? buildMercanteBreakbulkEdi : buildMercanteCargoEdi
      return { ...build(data.header, data.bls), extra }
    }
    return { ...buildMercanteVaziosEdi(data.header, data.vazios), extra }
  }, [data, route.kind])

  const impedimentos = result?.issues.filter((issue) => issue.severity === 'impedimento') ?? []
  const completar = result?.issues.filter((issue) => issue.severity === 'completar') ?? []
  const avisos = [...(result?.extra ?? []), ...(result?.issues.filter((issue) => issue.severity === 'aviso') ?? [])]
  const title = route.kind === 'vazio'
    ? `EDI Mercante de vazios · ${route.label}`
    : route.kind === 'carga_solta' ? `EDI Mercante de carga solta · ${route.label}` : `EDI Mercante · ${route.label}`

  let counts: string | null = null
  if (data && isCargo(data)) {
    const containers = data.bls.flatMap((bl) => bl.containers)
    const breakbulkItems = data.bls.reduce((total, bl) => total + bl.breakbulkItems.length, 0)
    const vehicles = data.bls.reduce((total, bl) => total + bl.vehicles.length, 0)
    counts = [
      formatCountLabel(data.bls.length, 'B/L', 'B/Ls'),
      formatCountLabel(containers.length, 'contêiner', 'contêineres'),
      ...(route.kind === 'carga_solta'
        ? [formatCountLabel(breakbulkItems, 'item de carga solta', 'itens de carga solta'), formatCountLabel(vehicles, 'veículo', 'veículos')]
        : [`${containers.filter((container) => container.shared).length} divididos entre B/Ls`]),
      `${containers.filter((container) => container.isImo).length} IMO`,
    ].join(' · ')
  } else if (data) {
    counts = formatCountLabel(data.vazios.length, 'contêiner vazio', 'contêineres vazios')
  }

  return (
    <Modal open onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        {isLoading ? <p>Carregando os dados da rota…</p> : null}
        {error ? <p role="alert"><StatusText tone="danger">{userFacingErrorMessage(error)}</StatusText></p> : null}
        {data ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-[var(--app-muted)]">Navio e viagem</dt>
            <dd>{data.vesselName} V.{data.voyageNumber} · IMO {data.header.vesselImo ?? '—'}</dd>
            <dt className="text-[var(--app-muted)]">Rota no Mercante</dt>
            <dd className="font-mono">{mercantePortCode(data.header.pol)} → {mercantePortCode(data.header.pod)}</dd>
            <dt className="text-[var(--app-muted)]">Encerramento (ATD no POL)</dt>
            <dd>{formatDate(data.header.closingDate)}</dd>
            <dt className="text-[var(--app-muted)]">Operação (ETA no POD)</dt>
            <dd>{formatDate(data.header.operationDate)}</dd>
            <dt className="text-[var(--app-muted)]">Terminal de descarga</dt>
            <dd className="font-mono">{data.header.terminalCode ?? '—'}</dd>
            <dt className="text-[var(--app-muted)]">Conteúdo</dt>
            <dd>{counts}</dd>
          </dl>
        ) : null}
        {result ? (
          <>
            {impedimentos.length
              ? <p role="status"><StatusText tone="danger">O arquivo não pode ser baixado enquanto houver impedimento.</StatusText></p>
              : completar.length
                ? <p role="status">Arquivo parcial: complete os itens de "A completar" antes de enviar ao Mercante.</p>
                : <p role="status">Pronto para baixar. O envio ao Mercante continua fora do Vela.</p>}
            <IssueList title="Impedimentos" issues={impedimentos} tone="danger" />
            <IssueList title="A completar" issues={completar} tone="warning" />
            <IssueList title="Avisos" issues={avisos} tone="warning" />
          </>
        ) : null}
        {saveError ? (
          <p role="alert"><StatusText tone="danger">{userFacingErrorMessage(saveError, 'Não foi possível registrar o arquivo no Histórico da Viagem; nada foi baixado. Tente de novo.')}</StatusText></p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button
            disabled={!result?.content || !data || saving}
            onClick={async () => {
              if (!result?.content || !data) return
              const content = result.content
              setSaving(true)
              setSaveError(null)
              try {
                // Sem o registro, o arquivo não é baixado: todo EDI baixado fica no Histórico.
                const record = await registerMercanteEdiFile({
                  voyageId,
                  pol: data.header.pol,
                  pod: data.header.pod,
                  mode: FILE_MODE[route.kind],
                  tag: mercanteFileTag(data.vesselName, data.voyageNumber),
                  blCount: isCargo(data) ? data.bls.length : 0,
                  itemCount: isCargo(data)
                    ? data.bls.reduce((total, bl) => total + bl.containers.length + bl.breakbulkItems.length + bl.vehicles.length, 0)
                    : data.vazios.length,
                })
                downloadBlob(record.fileName, new Blob([content], { type: 'text/plain;charset=utf-8' }))
                void queryClient.invalidateQueries({ queryKey: queryKeys.voyages.timeline(voyageId) })
              } catch (err) {
                setSaveError(err)
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? 'Registrando…' : 'Baixar arquivo'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
