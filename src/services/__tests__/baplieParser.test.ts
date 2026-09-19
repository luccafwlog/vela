import { describe, expect, it } from 'vitest'
import { parseBaplieFile, parseBaplieText } from '../baplieParser'

function baplieFile(text: string) {
  return new File([text], 'baplie.edi', { type: 'text/plain' })
}

describe('baplieParser', () => {
  it('deduplica containers repetidos no EDI preservando atributos fisicos', async () => {
    const parsed = await parseBaplieFile(baplieFile([
      "UNB+UNOA:2+X+Y+260701:1200+1'",
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+UETU7016802+45G1+++5'",
      "LOC+147+010102'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+UETU7016802+45G1+++5'",
      "DGS+IMD+9+3166'",
      "UNT+10+1'",
    ].join('\n')))

    expect(parsed.containers).toHaveLength(1)
    expect(parsed.containers[0]).toMatchObject({
      container_number: 'UETU7016802',
      is_imo: true,
      imo_class: '9',
      un_number: '3166',
      slot: '010102',
    })
  })

  // Dialeto SMDG D95B usado pelo Baplie da GREEN PARANAGUA V12: o local vem
  // em LOC+9/LOC+11 (e não LOC+6/LOC+12), o peso em MEA+VGM (e não MEA+WT) e
  // o navio no último composto do TDT. Lendo só o outro dialeto, POL, POD e
  // peso saíam nulos nas 1.055 unidades e a viagem entrava sem porto de
  // descarga.
  it('lê POL, POD e peso no dialeto LOC+9 / LOC+11 / MEA+VGM', async () => {
    const parsed = await parseBaplieFile(baplieFile([
      "UNB+UNOA:2+CNGNS:NS+PENAVI1:+260330:1553+0'",
      "UNH+1+BAPLIE:D:95B:UN:SMDG22'",
      "TDT+20+12+++:172:20+++5LFD3:103::GREEN PARANAGUA'",
      "LOC+5+CNNSA:139'",
      "LOC+61+BRVIT:139'",
      "LOC+147+0040084::5'",
      "MEA+VGM++KGM:8900'",
      "LOC+9+CNTAG'",
      "LOC+11+BRVIT'",
      "LOC+83+BRVIT'",
      "RFF+BM:1'",
      "EQD+CN+SEGU7664016+42P3+++5'",
      "LOC+147+0081082::5'",
      "MEA+VGM++KGM:17300'",
      "LOC+9+CNNSA'",
      "LOC+11+BRSEP'",
      "LOC+83+BRSEP'",
      "RFF+BM:1'",
      "EQD+CN+FCIU8751693+45G0+++5'",
      "UNT+19+1'",
    ].join('\n')))

    expect(parsed.vessel_name).toBe('GREEN PARANAGUA')
    expect(parsed.voyage_number).toBe('12')
    // BRVIT é a forma antiga de Vitória; o porto é gravado sempre como BRVIX (e CNTAG como CNTAC).
    expect(parsed.containers[0]).toMatchObject({
      container_number: 'SEGU7664016',
      pol: 'CNTAC',
      pod: 'BRVIX',
      final_dest: 'BRVIX',
      weight_kg: 8900,
    })
    expect(parsed.containers[1]).toMatchObject({ pol: 'CNNSA', pod: 'BRSEP', weight_kg: 17300 })
    expect(parsed.pods).toEqual(['BRSEP', 'BRVIX'])
  })

  it('processa múltiplas mensagens dentro do mesmo interchange UNB...UNZ', async () => {
    const parsed = await parseBaplieFile(baplieFile([
      "UNB+UNOA:2+X+Y+260701:1200+1'",
      "UNH+1+BAPLIE:D:95B:UN:SMDG22'",
      "TDT+20+14+++:::GREEN SANTOS'",
      "LOC+147+010101'",
      "MEA+VGM++KGM:12000'",
      "LOC+6+CNTAC'",
      "LOC+12+BRVIX'",
      "EQD+CN+UETU7016802+45G1+++5'",
      "UNT+7+1'",
      "UNH+2+BAPLIE:D:95B:UN:SMDG22'",
      "LOC+147+010102'",
      "MEA+VGM++KGM:14000'",
      "LOC+6+CNTAC'",
      "LOC+12+BRSSZ'",
      "EQD+CN+MSCU9999999+45G1+++5'",
      "UNT+7+2'",
      "UNZ+2+1'",
    ].join('\n')))

    expect(parsed.containers).toHaveLength(2)
    expect(parsed.containers[0].container_number).toBe('UETU7016802')
    expect(parsed.containers[1].container_number).toBe('MSCU9999999')
    expect(parsed.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
  })
})

describe('baplieParser — P0-1: indicador cheio/vazio (EQD 8169)', () => {
  const head = "UNB+UNOA:2+X+Y+260101:0000+1'TDT+20+0012+++:::GREEN VITORIA'"

  it('EQD+CN+...+45G1+++4 (8169=4) e vazio', () => {
    const t = `${head}LOC+147+010101'LOC+9+CNTAO'LOC+11+BRVIX'EQD+CN+TCLU1234567+45G1+++4'`
    const parsed = parseBaplieText(t)
    expect(parsed.containers[0]?.status).toBe('empty')
  })

  it('8249 (equipment status, elemento 5) preenchido nao e lido como indicador cheio/vazio', () => {
    // Antes da correcao, o primeiro elemento nao vazio entre 5 e 6 era lido
    // como indicador; um 8249='2' (export) fazia um container vazio (8169=4)
    // virar 'full' por engano.
    const t = `${head}LOC+147+010101'LOC+9+CNTAO'LOC+11+BRVIX'EQD+CN+TCLU1234567+45G1++2+4'`
    const parsed = parseBaplieText(t)
    expect(parsed.containers[0]?.status).toBe('empty')
  })

  it('indicador ausente bloqueia com erro em vez de assumir full', () => {
    const t = `${head}LOC+147+010101'LOC+9+CNTAO'LOC+11+BRVIX'EQD+CN+TCLU1234567+45G1+++'`
    const parsed = parseBaplieText(t)
    expect(parsed.issues.some((i) => i.field === 'status' && i.severity === 'error')).toBe(true)
  })
})

describe('baplieParser — P0-2: unidade de peso do MEA (UN/ECE R20)', () => {
  const head = "UNB+UNOA:2+X+Y+260101:0000+1'TDT+20+0012+++:::GREEN VITORIA'"

  it('MEA em toneladas (TNE) converte para kg em vez de gravar o numero cru', () => {
    const t = `${head}LOC+147+010101'LOC+9+CNTAO'LOC+11+BRVIX'EQD+CN+TCLU1234567+45G1+++5'MEA+WT++TNE:24.5'`
    const parsed = parseBaplieText(t)
    expect(parsed.containers[0]?.weight_kg).toBe(24500)
  })

  it('MEA em libras (LBR) converte para kg', () => {
    const t = `${head}LOC+147+010101'LOC+9+CNTAO'LOC+11+BRVIX'EQD+CN+TCLU1234567+45G1+++5'MEA+WT++LBR:2000'`
    const parsed = parseBaplieText(t)
    expect(parsed.containers[0]?.weight_kg).toBeCloseTo(907.18474, 3)
  })

  it('MEA em quilos (KGM) permanece sem conversao', () => {
    const t = `${head}LOC+147+010101'LOC+9+CNTAO'LOC+11+BRVIX'EQD+CN+TCLU1234567+45G1+++5'MEA+WT++KGM:24500'`
    const parsed = parseBaplieText(t)
    expect(parsed.containers[0]?.weight_kg).toBe(24500)
  })

  it('unidade de peso desconhecida vira erro bloqueante, nao numero cru', () => {
    const t = `${head}LOC+147+010101'LOC+9+CNTAO'LOC+11+BRVIX'EQD+CN+TCLU1234567+45G1+++5'MEA+WT++XYZ:24500'`
    const parsed = parseBaplieText(t)
    expect(parsed.containers[0]?.weight_kg).toBeNull()
    expect(parsed.issues.some((i) => i.field === 'weight_kg' && i.severity === 'error')).toBe(true)
  })
})
