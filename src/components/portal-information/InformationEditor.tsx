import { useState } from 'react'
import { useSavePortalInformation } from '../../hooks/usePortalInformation'
import { externalInformationUrl, type InformationKind } from '../../services/portalInformation'
import { Button } from '../ui/Button'
import { Field, Input, Select, Textarea } from '../ui/Input'
import { Modal } from '../ui/Modal'

export type InformationField = { key: string; label: string; type?: 'list' | 'url' | 'boolean' | 'text'; required?: boolean; readOnly?: boolean; options?: { value: string; label: string }[] }
export function InformationEditor({ title, kind, data, fields, onClose, onSaved }: { title: string; kind: InformationKind; data: Record<string, unknown>; fields: InformationField[]; onClose: () => void; onSaved?: () => void }) {
  const [draft, setDraft] = useState(data)
  const [error, setError] = useState<string | null>(null)
  const save = useSavePortalInformation()
  async function submit() {
    const payload: Record<string, unknown> = {}
    for (const key of ['id', 'carrier_id', 'key']) if (draft[key] != null) payload[key] = draft[key]
    for (const field of fields) payload[field.key] = draft[field.key]
    for (const field of fields) {
      if (field.type === 'list') payload[field.key] = String(draft[field.key] ?? '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
      if (field.type === 'url') {
        const raw = String(draft[field.key] ?? '').trim()
        if (raw && !externalInformationUrl(raw)) { setError(`${field.label}: informe uma URL HTTP ou HTTPS válida, sem credenciais.`); return }
        payload[field.key] = raw ? externalInformationUrl(raw) : null
      }
    }
    for (const field of fields) {
      if (field.required) {
        const value = payload[field.key]
        if (Array.isArray(value) ? !value.length : !String(value ?? '').trim()) {
          setError(`${field.label}: informe pelo menos um valor.`); return
        }
        if (typeof value === 'string') payload[field.key] = value.trim()
      }
      if (field.options && !field.options.some(option => option.value === payload[field.key])) {
        setError(`${field.label}: selecione um assunto disponível.`); return
      }
    }
    if (kind === 'depot' && payload.published && (!Array.isArray(payload.ports) || !payload.ports.length)) {
      setError('Informe pelo menos um porto de devolução antes de publicar o depot.'); return
    }
    setError(null)
    try { await save.mutateAsync({ kind, data: payload }); onSaved?.(); onClose() }
    catch { setError('Não foi possível salvar. Revise os dados e tente novamente.') }
  }
  return <Modal open title={title} onClose={onClose}>
    <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void submit() }}>
      {fields.map(field => field.type === 'boolean' ? <label key={field.key} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(draft[field.key])} onChange={e => setDraft({ ...draft, [field.key]: e.target.checked })} />{field.label}</label> :
        <Field key={field.key} label={field.label} required={field.required} hint={field.type === 'list' ? 'Separe os valores por vírgula ou por linha.' : undefined}>
          {field.readOnly ? <span>{field.options?.find(option => option.value === draft[field.key])?.label ?? String(draft[field.key] ?? '')}</span> : field.options ? <Select value={String(draft[field.key] ?? '')} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select> : field.type === 'text' || field.type === 'list' ? <Textarea rows={3} value={String(draft[field.key] ?? '')} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} /> : <Input value={String(draft[field.key] ?? '')} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })} />}
        </Field>)}
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      <div className="flex gap-2"><Button type="submit" loading={save.isPending}>Salvar informações</Button><Button type="button" variant="secondary" disabled={save.isPending} onClick={onClose}>Cancelar</Button></div>
    </form>
  </Modal>
}
