import type { BreakbulkImportResult, BreakbulkReimportCheck } from '../../services/breakbulkImport'
import { describeBreakbulkPending, describeOtherVoyage } from '../../services/breakbulkImport'
import { ImportNotice } from './ImportParts'
import { plural } from './importPresentation'

/**
 * Prévia da reimportação de carga solta (Manifesto BB e B/L avulso), com as
 * mesmas regras da RPC (ADR 0078, item 14): B/L de outra Viagem recusa o lote,
 * CNPJ de outro Cliente só troca com aceite e a rota de B/L faturado pede a
 * confirmação de faturamento. Sem marcar, o resto do arquivo é aplicado.
 */
export function BreakbulkReimportReview({
  check,
  acceptCustomerChanges,
  onAcceptCustomerChanges,
  overrideBilling,
  onOverrideBilling,
}: {
  check: BreakbulkReimportCheck | undefined
  acceptCustomerChanges: boolean
  onAcceptCustomerChanges: (value: boolean) => void
  overrideBilling: boolean
  onOverrideBilling: (value: boolean) => void
}) {
  if (!check || check.existing.length === 0) return null

  return (
    <section className="app-import-section" aria-label="B/Ls já cadastrados">
      <h3 className="app-import-section__title">
        {plural(check.existing.length, 'B/L já cadastrado', 'B/Ls já cadastrados')}: o arquivo corrige só o que traz
      </h3>
      <p className="text-sm text-[var(--app-muted)]">
        CE Mercante, Cliente vinculado, Revisão e observações ficam como estão. Valor vazio no arquivo não apaga o
        valor gravado.
      </p>

      {check.otherVoyage.length ? (
        <ImportNotice tone="danger" role="alert" title="B/L de outra Viagem: o lote será recusado">
          <ul className="app-import-notice__list">
            {check.otherVoyage.map((entry) => <li key={entry.blId}>{describeOtherVoyage(entry)}</li>)}
          </ul>
        </ImportNotice>
      ) : null}

      {check.codPodKept.length ? (
        <ImportNotice tone="warning" title="B/L em COD: o POD não muda">
          <p>
            {check.codPodKept.join(', ')}: o destino foi alterado pela Omissão de Escala (COD). Os demais campos são
            aplicados; o POD do arquivo é ignorado.
          </p>
        </ImportNotice>
      ) : null}

      {check.customerChanges.length ? (
        <div className="grid gap-2">
          <ImportNotice tone="warning" title={`Troca de Consignatário em ${plural(check.customerChanges.length, 'B/L', 'B/Ls')}`}>
            <ul className="app-import-notice__list">
              {check.customerChanges.map((change) => (
                <li key={change.blId}>
                  <span className="app-import-code">{change.blId}</span>: {change.currentCustomer} → {change.fileCustomer}
                </li>
              ))}
            </ul>
          </ImportNotice>
          <label className="app-import-override">
            <input
              type="checkbox"
              checked={acceptCustomerChanges}
              onChange={(event) => onAcceptCustomerChanges(event.target.checked)}
            />
            <span>
              <span className="app-import-override__title">
                Confirmo a troca de Cliente em {plural(check.customerChanges.length, 'B/L', 'B/Ls')}
              </span>
              <span className="app-import-override__hint">
                O B/L passa ao novo consignatário e as taxas locais são reemitidas; com recebimento, devolva ao Cliente
                original antes da nova cobrança. Sem marcar, o Cliente atual fica.
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {check.billedRouteChanges.length ? (
        <div className="grid gap-2">
          <ImportNotice tone="warning" title={`Rota diferente em ${plural(check.billedRouteChanges.length, 'B/L faturado', 'B/Ls faturados')}`}>
            <ul className="app-import-notice__list">
              {check.billedRouteChanges.map((change) => (
                <li key={change.blId}>
                  <span className="app-import-code">{change.blId}</span>: {change.fields.join(' e ')}
                </li>
              ))}
            </ul>
          </ImportNotice>
          <label className="app-import-override">
            <input type="checkbox" checked={overrideBilling} onChange={(event) => onOverrideBilling(event.target.checked)} />
            <span>
              <span className="app-import-override__title">Corrigir também a rota dos B/Ls faturados</span>
              <span className="app-import-override__hint">
                A fatura emitida é cancelada e reemitida com a base nova; com pagamento, a diferença segue para
                restituição. Sem marcar, a rota gravada fica.
              </span>
            </span>
          </label>
        </div>
      ) : null}
    </section>
  )
}

/** O que a importação gravou e o que ficou de fora, por B/L. */
export function BreakbulkImportOutcome({ result }: { result: BreakbulkImportResult }) {
  const pending = describeBreakbulkPending(result)

  return (
    <ImportNotice
      tone={pending.length ? 'warning' : 'success'}
      role="status"
      title={`${plural(result.inserted.length, 'B/L novo', 'B/Ls novos')}, ${plural(result.updated.length, 'corrigido', 'corrigidos')}, ${plural(result.unchanged.length, 'sem mudança', 'sem mudança')}`}
    >
      {pending.length ? (
        <ul className="app-import-notice__list">
          {pending.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : (
        <p>Tudo o que o arquivo trazia foi aplicado.</p>
      )}
    </ImportNotice>
  )
}
