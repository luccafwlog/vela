import { useMemo } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { StatusText } from '../ui/StatusText'
import { useMercanteEdiInput } from '../../hooks/useManifestosMercante'
import { formatDate, formatCountLabel } from '../../lib/utils'
import { userFacingErrorMessage } from '../../lib/errors'
import {
  buildMercanteCargoEdi,
  buildMercanteVaziosEdi,
  mercanteFileName,
  mercantePortCode,
  type MercanteEdiIssue,
  type MercanteEdiResult,
} from '../../services/mercanteEdi'
import type { MercanteCargoInput, MercanteVaziosInput } from '../../services/mercanteEdiData'

export type MercanteEdiRoute = { pol: string; pod: string; label: string; kind: 'carga' | 'vazio' }

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

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

/**
 * Gerar EDI Mercante de uma linha de Rotas e Manifestos (issue 560): prévia
 * com os dados do manifesto, o que impede o download e os avisos. Só lê e
 * baixa o arquivo; o envio ao Mercante continua fora do Vela.
 */
export function MercanteEdiModal({ voyageId, route, onClose }: { voyageId: number; route: MercanteEdiRoute; onClose: () => void }) {
  const { data, isLoading, error } = useMercanteEdiInput(voyageId, route)

  const result = useMemo<(MercanteEdiResult & { extra: MercanteEdiIssue[] }) | null>(() => {
    if (!data) return null
    const extra: MercanteEdiIssue[] = []
    if (!data.hasBaplie && route.kind === 'carga') {
      extra.push({ severity: 'aviso', ref: null, message: 'A Viagem não tem Baplie importado: o IMO vem do Baplie, então nenhum contêiner sai como carga perigosa. Importe o Baplie antes de enviar.' })
    }
    if (isCargo(data)) {
      for (const skipped of data.skippedBls) {
        extra.push({ severity: 'aviso', ref: skipped.id, message: `Fora do arquivo: ${skipped.reason} ainda não entra no EDI Mercante.` })
      }
      return { ...buildMercanteCargoEdi(data.header, data.bls), extra }
    }
    return { ...buildMercanteVaziosEdi(data.header, data.vazios), extra }
  }, [data, route.kind])

  const impedimentos = result?.issues.filter((issue) => issue.severity === 'impedimento') ?? []
  const avisos = [...(result?.extra ?? []), ...(result?.issues.filter((issue) => issue.severity === 'aviso') ?? [])]
  const title = route.kind === 'vazio' ? `EDI Mercante de vazios · ${route.label}` : `EDI Mercante · ${route.label}`

  let counts: string | null = null
  if (data && isCargo(data)) {
    const containers = data.bls.flatMap((bl) => bl.containers)
    counts = [
      formatCountLabel(data.bls.length, 'B/L', 'B/Ls'),
      formatCountLabel(containers.length, 'contêiner', 'contêineres'),
      `${containers.filter((container) => container.shared).length} divididos entre B/Ls`,
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
              : <p role="status">Pronto para baixar. O envio ao Mercante continua fora do Vela.</p>}
            <IssueList title="Impedimentos" issues={impedimentos} tone="danger" />
            <IssueList title="Avisos" issues={avisos} tone="warning" />
          </>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button
            disabled={!result?.content || !data}
            onClick={() => {
              if (!result?.content || !data) return
              downloadText(mercanteFileName(data.vesselName, data.voyageNumber, new Date()), result.content)
            }}
          >
            Baixar arquivo
          </Button>
        </div>
      </div>
    </Modal>
  )
}
