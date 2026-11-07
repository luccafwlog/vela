import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALERT_RULES } from '../alertRulesCatalog'
import {
  ALERT_BUILTIN_ESCALATION,
  ALERT_DEV_ROUTING,
  ALERT_LINKS,
  ALERT_MAP_NOTICES,
  ALERT_MAP_OFF_MAP,
  ALERT_MAP_SHORT_LABELS,
  ALERT_MAP_STATIONS,
  ALERT_STAKES_BY_TYPE,
  inactionWalk,
  linksOf,
} from '../alertRulesMap'

// Mapa dos alertas (ADR 0134): todo alerta vivo tem lugar, toda ligação
// aponta para alguém que existe e a conta Dev espelha o catálogo SQL.
const placed = ALERT_MAP_STATIONS.flatMap((station) => station.nodes)
const liveTypes = ALERT_RULES.map((rule) => rule.type)

function migration(prefix: string): string {
  const dir = resolve(process.cwd(), 'supabase/migrations')
  const file = readdirSync(dir).find((name) => name.startsWith(`${prefix}_`))
  if (!file) throw new Error(`migration ${prefix} não encontrada`)
  return readFileSync(resolve(dir, file), 'utf8')
}

describe('Mapa dos alertas', () => {
  it('põe cada alerta vivo num momento, uma vez só; fora fica só o que não abre mais', () => {
    expect(new Set(placed).size).toBe(placed.length)
    const missing = liveTypes.filter((type) => !placed.includes(type) && !ALERT_MAP_OFF_MAP.includes(type))
    expect(missing).toEqual([])
    const unknown = placed.filter((id) => !liveTypes.includes(id as never) && !(id in ALERT_MAP_NOTICES))
    expect(unknown).toEqual([])
    for (const type of ALERT_MAP_OFF_MAP) {
      expect(ALERT_RULES.find((rule) => rule.type === type)?.trigger).toMatch(/^Não abre mais/)
    }
    expect(Object.keys(ALERT_MAP_NOTICES).every((id) => placed.includes(id as never))).toBe(true)
  })

  it('diz o que fica parado para todo alerta do mapa, e só para eles', () => {
    const mapTypes = placed.filter((id) => !(id in ALERT_MAP_NOTICES))
    expect(mapTypes.filter((type) => !(type in ALERT_STAKES_BY_TYPE))).toEqual([])
    expect(Object.keys(ALERT_STAKES_BY_TYPE).filter((type) => !mapTypes.includes(type as never))).toEqual([])
  })

  it('liga só o que está no mapa, sem repetir ligação nem ligar o alerta a ele mesmo', () => {
    const keys = ALERT_LINKS.map((item) => `${item.from}>${item.to}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const item of ALERT_LINKS) {
      expect(placed).toContain(item.from)
      expect(placed).toContain(item.to)
      expect(item.from).not.toBe(item.to)
      expect(item.text.length).toBeGreaterThan(20)
    }
    for (const key of [...Object.keys(ALERT_MAP_SHORT_LABELS), ...Object.keys(ALERT_BUILTIN_ESCALATION), ...Object.keys(ALERT_DEV_ROUTING)]) {
      expect(placed).toContain(key)
    }
  })

  it('espelha a conta Dev do catálogo SQL: só ela (605, 620), junto com a equipe (620, 621) e pela causa (620)', () => {
    const sql = ['605', '620', '621'].map(migration).join('\n')
    const only = [...sql.matchAll(/notify_dev_only = true WHERE type = '([a-z_]+)'/g)].map((match) => match[1]).sort()
    const also = [...sql.matchAll(/also_notify_dev = true WHERE type (?:= '([a-z_]+)'|IN \(([^)]+)\))/g)]
      .flatMap((match) => match[1] ? [match[1]] : match[2].split(',').map((item) => item.trim().replace(/'/g, '')))
      .sort()
    const technical = migration('620').match(/FUNCTION public\._alert_item_is_technical[\s\S]*?\$function\$;/)![0]
    const cause = [...technical.matchAll(/WHEN '([a-z_]+)' THEN/g)].map((match) => match[1]).sort()
    const routed = (mode: string) => Object.entries(ALERT_DEV_ROUTING).filter(([, value]) => value === mode).map(([type]) => type).sort()
    expect(routed('only')).toEqual(only)
    expect(routed('also')).toEqual(also)
    expect(routed('cause')).toEqual(cause)
  })

  it('o reforço que a própria regra traz está escrito no texto dela', () => {
    for (const type of Object.keys(ALERT_BUILTIN_ESCALATION)) {
      expect(ALERT_RULES.find((rule) => rule.type === type)?.timing).toMatch(/vira Crítico/)
    }
  })

  it('separa o que vem antes, o que acontece sem ação, o que vem em seguida e a mesma causa', () => {
    const portal = linksOf('review_portal_not_ready')
    expect(portal.before.map((item) => item.from)).toEqual(expect.arrayContaining(['portal_convite_expirado', 'portal_falha_envio', 'liberacao_vencendo']))
    expect(portal.inaction.map((item) => item.to)).toEqual(['demurrage_travado'])
    expect(portal.next.map((item) => item.to)).toEqual(['portal_reprocessamento_falhou'])
    expect(portal.same.map((item) => item.to)).toEqual(['portal_excecao_critica_fatura'])
    // A mesma causa aparece dos dois lados.
    expect(linksOf('portal_excecao_critica_fatura').same).toHaveLength(1)
  })

  it('"E se ninguém agir?" segue o que vira, segura e atrapalha, até o que fica parado', () => {
    const walk = inactionWalk('voyage_vehicle_declaration_pending')
    expect(walk.steps).toEqual([
      ['voyage_vehicle_declaration_pending'],
      ['voyage_vehicle_sheet_pending', 'voyage_ce_mercante_missing'],
      ['demurrage_travado'],
    ])
    // A Planilha também segura o CE, que já está no mesmo passo.
    expect(walk.stepLinks[1].map((item) => `${item.from}>${item.to}`)).toEqual([
      'voyage_vehicle_declaration_pending>voyage_vehicle_sheet_pending',
      'voyage_vehicle_declaration_pending>voyage_ce_mercante_missing',
    ])
    expect(walk.stakes).toEqual(['ce', 'fatura', 'aviso', 'portal', 'desbloqueio', 'demurrage'])

    // O caminho normal (depois) não entra: sem CE não há emissão para falhar.
    const ce = inactionWalk('voyage_ce_mercante_missing')
    expect(ce.steps.flat()).not.toContain('billing_auto_issue_failed')
    // Alerta sem ligação de falta de ação fica num passo só.
    expect(inactionWalk('portal_abuso_login').steps).toEqual([['portal_abuso_login']])
  })
})
