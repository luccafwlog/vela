import { describe, expect, it } from 'vitest'
import {
  PUBLIC_LOOKUP_PORT_CODES,
  PUBLIC_SCHEDULE_PORT_CODES,
  normalizePublicContainerNumber,
} from '../../../supabase/functions/_shared/publicFwlog.ts'
import { PORTAL_SCHEDULE_LANES, portalLaneCode } from '../portalScheduleLanes'
import { PUBLIC_LOOKUP_PORTS } from '../publicLookupPorts'
import { computeIsoContainerCheckDigit, parsePublicContainerNumber } from '../../lib/containerNumber'

// ADR 0114: a Edge repete as listas do front porque o Deno não importa
// `portCode.ts`; a migration 542 repete as mesmas no SQL
// (`publicFwlog.local-pg.test.ts`). Divergência aqui derruba o CI.
describe('widgets públicos: listas e número de container iguais em Edge e front', () => {
  it('portos do quadro são os do Portal, com Suape', () => {
    expect([...PUBLIC_SCHEDULE_PORT_CODES]).toEqual(PORTAL_SCHEDULE_LANES.map(portalLaneCode))
  })

  it('portos da consulta: Salvador, Vitória, Pecém e Suape', () => {
    expect([...PUBLIC_LOOKUP_PORT_CODES]).toEqual(PUBLIC_LOOKUP_PORTS.map((port) => port.code))
  })

  it('o validador do navegador e o da Edge aceitam e recusam os mesmos números', () => {
    const samples = ['CSQU3054383', 'csqu 305438-3', 'CSQU3054384', 'CSQX3054383', 'MSKU1234565', 'ZQPJ0000010', 'ABC', '', 'CSQU30543831']
    for (let serial = 0; serial < 200; serial++) {
      const base = `TGHU${String(serial * 4999).padStart(6, '0').slice(-6)}`
      samples.push(`${base}${computeIsoContainerCheckDigit(base)}`, `${base}${(Number(computeIsoContainerCheckDigit(base)) + 1) % 10}`)
    }
    for (const sample of samples) expect(normalizePublicContainerNumber(sample), sample).toBe(parsePublicContainerNumber(sample))
    expect(parsePublicContainerNumber('csqu 305438-3')).toBe('CSQU3054383')
  })
})
