import type { BreakbulkApproval, BreakbulkImportResult, BreakbulkReimportCheck } from '../../services/breakbulkImport'
import {
  approvesBilledRouteChanges,
  approvesCustomerChanges,
  describeBilledChange,
  describeBreakbulkPending,
  describeOtherVoyage,
} from '../../services/breakbulkImport'
import { ImportNotice, ImportSection } from './ImportParts'
import { plural } from './importPresentation'

/**
 * Prévia da reimportação de carga solta (Manifesto BB e B/L avulso), com as
 * mesmas regras da RPC (ADR 0078, item 14): B/L de outra Viagem recusa o lote,
 * CNPJ de outro Cliente só troca com aceite e a rota de B/L faturado pede a
 * confirmação de faturamento, com a fatura e o valor antes → depois e também
 * para peso, CBM, volumes e máquinas (ADR 0094, B5). Sem marcar, o resto do arquivo é aplicado. B/L
 * cancelado é somente leitura: a linha é ignorada, com aviso no painel de
 * erros e avisos da prévia.
 *
 * Marcar guarda as transições mostradas (B/L, Cliente atual → do arquivo, rota),
 * não um "sim" solto: trocar o arquivo ou a Viagem desmarca o que não foi visto,
 * e a gravação só aplica o que continua igual.
 */
export function BreakbulkReimportReview({
  check,
  approval,
  onApprovalChange,
}: {
  check: BreakbulkReimportCheck | undefined
  approval: BreakbulkApproval
  onApprovalChange: (approval: BreakbulkApproval) => void
}) {
  // B/L cancelado (D1 da regra de 2026-10-19) é aviso da prévia, no painel
  // de erros e avisos: a linha não é tocada e o resto do arquivo entra.
  if (!check || check.existing.length === 0) return null
  const acceptCustomerChanges = approvesCustomerChanges(approval, check)
  const overrideBilling = approvesBilledRouteChanges(approval, check)

  return (
    <ImportSection
      title={plural(check.existing.length, 'B/L já cadastrado', 'B/Ls já cadastrados')}
      aside="o arquivo corrige só o que traz"
    >
      <p className="app-panel__meta">
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
            {check.customerChanges.some((change) => change.fileCustomerMissing) ? (
              <p>
                Consignatário não cadastrado: com a troca confirmada, o B/L sai do Cliente atual e volta para a
                Reconciliação de Cliente até o novo consignatário ser cadastrado. Com fatura ou recebível a troca é
                recusada; cadastre o Cliente antes de reimportar.
              </p>
            ) : null}
          </ImportNotice>
          <label className="app-import-override">
            <input
              type="checkbox"
              checked={acceptCustomerChanges}
              onChange={(event) => onApprovalChange({ ...approval, customerChanges: event.target.checked ? check.customerChanges : [] })}
            />
            <span>
              <span className="app-import-override__title">
                Confirmo a troca de Cliente em {plural(check.customerChanges.length, 'B/L', 'B/Ls')}
              </span>
              <span className="app-import-override__hint">
                O B/L passa ao novo consignatário e as taxas locais são reemitidas; com recebimento, devolva ao Cliente
                original antes da nova cobrança. Sem marcar, o Cliente, o consignatário e o CNPJ gravados ficam.
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {check.billedRouteChanges.length ? (
        <div className="grid gap-2">
          <ImportNotice tone="warning" title={`Mudança que afeta a cobrança em ${plural(check.billedRouteChanges.length, 'B/L faturado', 'B/Ls faturados')}`}>
            <ul className="app-import-notice__list">
              {check.billedRouteChanges.map((change) => (
                <li key={change.blId}>
                  <span className="app-import-code">{change.blId}</span>:{' '}
                  {change.fields.some((field) => field === 'POL' || field === 'POD') ? <>rota {change.currentRoute} ⇒ {change.fileRoute}</> : null}
                  {change.cargoChange ? <>{change.fields.some((field) => field === 'POL' || field === 'POD') ? '; ' : ''}{change.cargoChange}</> : null}
                  {change.billing ? <> · {describeBilledChange(change.billing)}</> : null}
                </li>
              ))}
            </ul>
          </ImportNotice>
          <label className="app-import-override">
            <input
              type="checkbox"
              checked={overrideBilling}
              onChange={(event) => onApprovalChange({ ...approval, billedRouteChanges: event.target.checked ? check.billedRouteChanges : [] })}
            />
            <span>
              <span className="app-import-override__title">Confirmo a mudança nos B/Ls faturados</span>
              <span className="app-import-override__hint">
                A fatura emitida só é cancelada e reemitida se o valor mudar; mudar só o POL não reemite. Com
                pagamento, a diferença segue para restituição ou avulsa. No B/L misto com terminais em conflito, a fatura
                não é cancelada e um alerta avisa; se a nova fatura sair retida (Portal, valor a revisar), ela fica em
                Reemissão pendente. Sem marcar, a rota e a carga gravadas ficam.
              </span>
            </span>
          </label>
        </div>
      ) : null}
    </ImportSection>
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
