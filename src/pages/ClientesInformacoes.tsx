import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useInternalPortalInformation } from '../hooks/usePortalInformation'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, PageHeader } from '../components/ui/Card'
import { InformationEditor, type InformationField } from '../components/portal-information/InformationEditor'
import { externalInformationUrl, type InformationKind, type PortalInformation } from '../services/portalInformation'

import { DemurrageSection } from '../components/portal/information/ReferenceSections'

type Section = 'depots' | 'agents' | 'contacts' | 'carriers' | 'notes'
const contactSubjects = [{ value: 'importacao', label: 'Importação' }, { value: 'exportacao', label: 'Exportação' }, { value: 'containers', label: 'Containers' }, { value: 'geral', label: 'Geral' }]
const sections: { key: Section; label: string }[] = [{ key: 'depots', label: 'Depots' }, { key: 'agents', label: 'Agentes' }, { key: 'contacts', label: 'Atendimento' }, { key: 'carriers', label: 'Tracking' }, { key: 'notes', label: 'Demurrage' }]
const fields: Record<Section, InformationField[]> = {
  depots: [{ key: 'ports', label: 'Portos de devolução (códigos)', type: 'list' }, { key: 'address', label: 'Endereço', type: 'text' }, { key: 'opening_hours', label: 'Horário de atendimento' }, { key: 'emails', label: 'E-mails', type: 'list' }, { key: 'phones', label: 'Telefones', type: 'list' }, { key: 'scheduling_url', label: 'URL de agendamento', type: 'url' }, { key: 'instructions', label: 'Instruções de devolução', type: 'text' }, { key: 'restrictions', label: 'Restrições', type: 'text' }, { key: 'published', label: 'Publicado no Portal', type: 'boolean' }],
  agents: [{ key: 'name', label: 'Nome do agente', required: true }, { key: 'ports', label: 'Portos (códigos)', type: 'list', required: true }, { key: 'emails', label: 'E-mails', type: 'list' }, { key: 'active', label: 'Ativo', type: 'boolean' }],
  contacts: [{ key: 'key', label: 'Identificador', required: true }, { key: 'title', label: 'Assunto de atendimento', required: true }, { key: 'description', label: 'Descrição', type: 'text' }, { key: 'emails', label: 'E-mails', type: 'list' }, { key: 'phones', label: 'Telefones', type: 'list' }, { key: 'whatsapp', label: 'URL do WhatsApp', type: 'url' }, { key: 'address', label: 'Endereço', type: 'text' }, { key: 'active', label: 'Ativo', type: 'boolean' }],
  carriers: [{ key: 'tracking_url', label: 'URL de tracking do armador', type: 'url' }],
  notes: [{ key: 'demurrage_notes', label: 'Observações públicas de Demurrage', type: 'text' }],
}
const kindBySection: Record<Section, InformationKind> = { depots: 'depot', agents: 'agent', contacts: 'contact', carriers: 'carrier', notes: 'notes' }
function editorData(item: Record<string, unknown>, fieldList: InformationField[]) {
  const result = { ...item }
  for (const field of fieldList) if (field.type === 'list') result[field.key] = Array.isArray(item[field.key]) ? (item[field.key] as string[]).join(', ') : ''
  return result
}
function rowsFor(catalog: PortalInformation, section: Section): Record<string, unknown>[] {
  return section === 'notes' ? [{ demurrage_notes: catalog.demurrage_notes }] : catalog[section]
}

export function ClientesInformacoes() {
  const catalog = useInternalPortalInformation()
  const { profile, isAdmin } = useAuth()
  const [section, setSection] = useState<Section>('depots')
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [creatingContact, setCreatingContact] = useState(false)
  const [saved, setSaved] = useState(false)
  const canEdit = profile?.active === true && (isAdmin || (section === 'depots' && profile.role === 'equipamentos'))
  const missingSubjects = contactSubjects.filter(subject => !catalog.data?.contacts.some(contact => contact.key === subject.value))
  const editorFields = section === 'contacts' ? fields.contacts.map(field => field.key === 'key' ? { ...field, label: 'Assunto', readOnly: !creatingContact, options: creatingContact ? missingSubjects : contactSubjects } : field) : fields[section]
  const rows = catalog.data ? rowsFor(catalog.data, section) : []
  return <div className="grid gap-5">
    <PageHeader title="Informações do Portal" description="Informações de devolução, agentes, atendimento e tracking e tarifas de Demurrage publicadas para os clientes." />
    <Card>
      <nav aria-label="Seções das informações do Portal" className="flex flex-wrap gap-2">{sections.map(s => <Button key={s.key} variant={section === s.key ? 'primary' : 'secondary'} aria-pressed={section === s.key} onClick={() => { setSection(s.key); setEditing(null); setSaved(false) }}>{s.label}</Button>)}</nav>
    </Card>
    {catalog.isLoading ? <Card>Carregando informações...</Card> : catalog.error || !catalog.data ? <Card><p role="alert">Não foi possível consultar as informações do Portal.</p><Button variant="secondary" onClick={() => void catalog.refetch()}>Tentar novamente</Button></Card> : <>
      {saved ? <p role="status" className="text-sm text-emerald-400">Informações salvas.</p> : null}
      {section === 'depots' ? <Card><p className="text-sm text-slate-400">Os depots abaixo pertencem ao cadastro do Vela. A publicação e os portos de devolução complementam esse cadastro.</p><Link className="text-sm text-blue-400" to="/embarquevazios/depots">Abrir cadastro de depots</Link><p className="mt-3 text-sm text-slate-400">Portos disponíveis: {catalog.data.ports.map(p => `${p.code} · ${p.name}`).join('; ') || 'Nenhum porto cadastrado.'}</p></Card> : null}
      {canEdit && (section === 'agents' || (section === 'contacts' && missingSubjects.length > 0)) ? <div><Button onClick={() => { setCreatingContact(section === 'contacts'); setEditing(section === 'agents' ? { name: '', ports: [], emails: [], active: true } : { key: missingSubjects[0]?.value, title: '', description: '', emails: [], phones: [], whatsapp: null, address: '', active: true }) }}>Adicionar {section === 'agents' ? 'agente' : 'atendimento'}</Button></div> : null}
      {section === 'notes' && <DemurrageSection information={catalog.data} showNotes={false} />}
      {!rows.length ? <Card>Nenhuma informação cadastrada nesta seção.</Card> : <div className={section === 'notes' ? 'grid gap-4' : 'grid gap-4 md:grid-cols-2'}>{rows.map((row, index) => {
        const title = String(row.name ?? row.title ?? 'Observações de Demurrage')
        const url = externalInformationUrl(typeof row.tracking_url === 'string' ? row.tracking_url : typeof row.scheduling_url === 'string' ? row.scheduling_url : null)
        return <Card key={String(row.id ?? row.key ?? row.carrier_id ?? index)}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-white">{title}</h2>{section === 'depots' ? <Badge tone={row.active && row.published ? 'green' : 'slate'}>{!row.active ? 'Inativo' : row.published ? 'Publicado' : 'Não publicado'}</Badge> : typeof row.active === 'boolean' ? <Badge tone={row.active ? 'green' : 'slate'}>{row.active ? 'Ativo' : 'Inativo'}</Badge> : null}</div>
          <div className="grid gap-2 text-sm text-slate-400">{fields[section].filter(f => f.type !== 'boolean').map(f => {
            const value = row[f.key]
            return value ? <p key={f.key} className="whitespace-pre-wrap break-words"><span className="font-medium">{f.label}: </span>{Array.isArray(value) ? value.join(', ') : String(value)}</p> : null
          })}</div>
          {url ? <a className="mt-3 inline-block text-sm text-blue-400" href={url} target="_blank" rel="noopener noreferrer">{section === 'carriers' ? 'Abrir tracking' : 'Abrir agendamento'}</a> : null}
          {canEdit ? <div className="mt-4"><Button variant="secondary" onClick={() => { setSaved(false); setCreatingContact(false); setEditing(row) }}>Editar {title}</Button></div> : null}
        </Card>
      })}</div>}
      <Card><p className="text-sm text-slate-400">As tarifas são mantidas nos cadastros oficiais do Vela.</p><div className="mt-2 flex flex-wrap gap-4"><Link className="text-sm text-blue-400" to="/taxas-locais/tabelas">Taxas Locais</Link><Link className="text-sm text-blue-400" to="/demurrage/taxas">Tarifas de Demurrage</Link></div></Card>
    </>}
    {editing && canEdit ? <InformationEditor title={`Editar ${sections.find(s => s.key === section)?.label}`} kind={kindBySection[section]} data={editorData(editing, editorFields)} fields={editorFields} onClose={() => setEditing(null)} onSaved={() => setSaved(true)} /> : null}
  </div>
}
