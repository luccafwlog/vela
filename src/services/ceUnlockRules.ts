import { sanitizeCellValue } from '../lib/spreadsheetSafe'
export type AnnualDocument = { status:string; valid_from:string | null; valid_until:string | null; coverage_year:number | null }
export function annualDocumentValid(doc:AnnualDocument, now = new Date()):boolean {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit' }).format(now)
  return doc.status === 'approved' && !!doc.valid_from && doc.valid_until === `${doc.coverage_year}-12-31` && doc.valid_from <= today && doc.valid_until >= today
}
export function zptRows(items:Array<{bl_id:string;termo:boolean;procuracao:boolean;delivered:boolean;paid:boolean}>):Record<string,string>[] {
  const yes = (value:boolean) => value ? 'Sim' : 'Não'
  return items.map(item => ({ BL:String(sanitizeCellValue(item.bl_id)), Termo:yes(item.termo), Procuração:yes(item.procuracao), 'Entrega de BL':yes(item.delivered), 'Pagamento das taxas':yes(item.paid) }))
}
