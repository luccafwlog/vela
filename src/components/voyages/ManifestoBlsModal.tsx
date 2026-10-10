import { useMemo, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { useConfirmWithReason } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { userFacingErrorMessage } from '../../lib/errors'
import {
  useMoveBlsToManifestoMercante,
  useUnlinkBlsFromManifestoMercante,
  useVoyageBlsForManifesto,
} from '../../hooks/useManifestosMercante'
import {
  canonicalManifestoNumero,
  MANIFESTO_NUMERO_PATTERN,
  parsePastedBlList,
  type VoyageManifestoBl,
} from '../../services/manifestosMercanteService'

const sameRoute = (a: string | null | undefined, b: string | null | undefined) =>
  String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase()

/**
 * Ver B/Ls da rota (Viagem → Rotas e Manifestos): Mover ou Desvincular em
 * lote, com busca, Selecionar todos os filtrados, Shift e Colar lista de B/Ls
 * (ADR 0078, item 7; migration 181). Tudo ou nada, com motivo.
 */
export function ManifestoBlsModal({
  open,
  onClose,
  voyageId,
  route,
}: {
  open: boolean
  onClose: () => void
  voyageId: number
  route: { pol: string; pod: string; label: string }
}) {
  const { showToast } = useToast()
  const confirmWithReason = useConfirmWithReason()
  const { data, isLoading } = useVoyageBlsForManifesto(voyageId, open)
  const moveMutation = useMoveBlsToManifestoMercante(voyageId)
  const unlinkMutation = useUnlinkBlsFromManifestoMercante(voyageId)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const [pasteMissing, setPasteMissing] = useState<string[]>([])
  const [target, setTarget] = useState('')
  const lastIndex = useRef<number | null>(null)

  const routeBls = useMemo(
    () => (data ?? []).filter((bl) => sameRoute(bl.pol, route.pol) && sameRoute(bl.pod, route.pod)),
    [data, route.pol, route.pod],
  )
  const filtered = useMemo(() => {
    const term = search.trim().toUpperCase()
    if (!term) return routeBls
    return routeBls.filter((bl) => bl.id.toUpperCase().includes(term) || (bl.manifestoNumero ?? '').includes(term))
  }, [routeBls, search])
  const selectable = (bl: VoyageManifestoBl) => !bl.cancelled
  const selectedBls = routeBls.filter((bl) => selected.has(bl.id))
  const canonicalTarget = canonicalManifestoNumero(target)
  const targetValid = MANIFESTO_NUMERO_PATTERN.test(canonicalTarget)
  const busy = moveMutation.isPending || unlinkMutation.isPending

  function toggle(bl: VoyageManifestoBl, index: number, shiftKey: boolean) {
    // O índice anterior é lido agora: o atualizador do estado roda depois.
    const anchor = lastIndex.current
    setSelected((current) => {
      const next = new Set(current)
      const turnOn = !current.has(bl.id)
      if (shiftKey && anchor !== null) {
        const [from, to] = [Math.min(anchor, index), Math.max(anchor, index)]
        filtered.slice(from, to + 1).filter(selectable).forEach((item) => (turnOn ? next.add(item.id) : next.delete(item.id)))
      } else if (turnOn) next.add(bl.id)
      else next.delete(bl.id)
      return next
    })
    lastIndex.current = index
  }

  function selectAllFiltered() {
    setSelected((current) => new Set([...current, ...filtered.filter(selectable).map((bl) => bl.id)]))
  }

  function selectPasted() {
    const wanted = parsePastedBlList(paste)
    const byId = new Map(routeBls.filter(selectable).map((bl) => [bl.id.toUpperCase(), bl.id]))
    setSelected((current) => new Set([...current, ...wanted.map((id) => byId.get(id)).filter((id): id is string => Boolean(id))]))
    setPasteMissing(wanted.filter((id) => !byId.has(id)))
  }

  function origins(): string {
    const numbers = Array.from(new Set(selectedBls.map((bl) => bl.manifestoNumero ?? 'sem Manifesto')))
    return numbers.join(', ')
  }

  async function handleMove() {
    const reason = await confirmWithReason({
      title: 'Mover B/Ls de Manifesto Mercante',
      message: `${selectedBls.length} B/L(s) sairão de ${origins()} e irão para ${canonicalTarget}.`,
      consequence: 'Tudo ou nada: se um B/L não puder mudar, nenhum muda. Um número novo é cadastrado nesta rota.',
      reversibility: 'Mover de novo, com motivo.',
      confirmLabel: 'Mover',
      affected: { summary: `${selectedBls.length} B/L(s)`, items: selectedBls.map((bl) => bl.id) },
    })
    if (reason === null) return
    try {
      const result = await moveMutation.mutateAsync({ blIds: selectedBls.map((bl) => bl.id), numero: canonicalTarget, reason })
      showToast(`${result.moved} B/L(s) movido(s) para ${result.numero}${result.created ? ' (Manifesto cadastrado agora)' : ''}.`, 'success')
      setSelected(new Set())
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Não foi possível mover os B/Ls.'), 'error')
    }
  }

  async function handleUnlink() {
    const reason = await confirmWithReason({
      title: 'Desvincular B/Ls do Manifesto Mercante',
      message: `${selectedBls.length} B/L(s) sairão de ${origins()} e ficarão sem Manifesto.`,
      consequence: 'Tudo ou nada. O CE Mercante dos B/Ls não muda.',
      reversibility: 'Mover para um Manifesto, com motivo.',
      confirmLabel: 'Desvincular',
      tone: 'danger',
      affected: { summary: `${selectedBls.length} B/L(s)`, items: selectedBls.map((bl) => bl.id) },
    })
    if (reason === null) return
    try {
      const result = await unlinkMutation.mutateAsync({ blIds: selectedBls.map((bl) => bl.id), reason })
      showToast(`${result.unlinked} B/L(s) desvinculado(s).`, 'success')
      setSelected(new Set())
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Não foi possível desvincular os B/Ls.'), 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`B/Ls da rota ${route.label}`}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Buscar B/L ou Manifesto">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" onClick={selectAllFiltered} disabled={!filtered.length}>
              Selecionar todos os filtrados
            </Button>
          </div>
        </div>

        <details>
          <summary className="cursor-pointer text-sm">Colar lista de B/Ls</summary>
          <div className="mt-2 space-y-2">
            <Field label="Lista de B/Ls" hint="Um por linha, ou separados por vírgula ou espaço.">
              <Textarea value={paste} onChange={(event) => setPaste(event.target.value)} />
            </Field>
            <Button variant="secondary" onClick={selectPasted} disabled={!paste.trim()}>Selecionar da lista</Button>
            {pasteMissing.length ? (
              <p role="status" className="text-sm text-red-400">Fora desta rota ou cancelados: {pasteMissing.join(', ')}</p>
            ) : null}
          </div>
        </details>

        <div className="app-table-scroll max-h-80">
          <table className="app-table app-table--compact w-full text-left text-sm">
            <caption className="sr-only">B/Ls da rota; Shift seleciona um intervalo</caption>
            <thead>
              <tr>
                <th scope="col" className="w-10"><span className="sr-only">Selecionar</span></th>
                <th scope="col">B/L</th>
                <th scope="col">Manifesto Mercante</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={3}>Carregando…</td></tr>
              ) : filtered.length ? filtered.map((bl, index) => (
                <tr key={bl.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${bl.id}`}
                      checked={selected.has(bl.id)}
                      disabled={!selectable(bl)}
                      onClick={(event) => toggle(bl, index, event.shiftKey)}
                      onChange={() => undefined}
                    />
                  </td>
                  <td className="font-mono">{bl.id}{bl.cancelled ? ' (cancelado)' : ''}</td>
                  <td className="font-mono">{bl.manifestoNumero ?? '—'}</td>
                </tr>
              )) : (
                <tr><td colSpan={3}>Nenhum B/L nesta busca.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Field
            label="Mover para o Nº de Manifesto Mercante"
            hint={target ? (targetValid ? `Será gravado como ${canonicalTarget}.` : 'O número tem 13 caracteres, letras ou dígitos.') : undefined}
          >
            <Input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="Ex.: 1226501860578" />
          </Field>
          <div className="flex items-end">
            <Button onClick={() => void handleMove()} disabled={!selectedBls.length || !targetValid || busy}>
              Mover {selectedBls.length ? `(${selectedBls.length})` : ''}
            </Button>
          </div>
          <div className="flex items-end">
            <Button variant="danger" onClick={() => void handleUnlink()} disabled={!selectedBls.length || busy}>
              Desvincular
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
