import { describe, expect, it } from 'vitest'
import { parseBaplieFile, parseBaplieText } from '../baplieParser'

function baplieFile(text: string) {
  return new File([text], 'baplie.edi', { type: 'text/plain' })
}

describe('baplieParser', () => {
  it.each([
    ['12', '  N', 'BRSEP', 'BRSEP', 'warning'],
    ['11', 'N', 'BRSEP', 'BRSEP', 'warning'],
    ['12', null, 'BRSEP', 'BRSEP', 'warning'],
    ['12', 'BRVIX', 'BRSEP', 'BRVIX', null],
    ['11', 'BRVIX', 'BRSEP', 'BRVIX', null],
    ['12', null, null, null, 'error'],
  ])('resolve POD de LOC+%s (%s) com Delivery %s', (qualifier, pod, delivery, expectedPod, severity) => {
    const parsed = parseBaplieText([
      "LOC+147+010101'",
      "LOC+6+TAO'",
      ...(pod === null ? [] : [`LOC+${qualifier}+${pod}'`]),
      ...(delivery === null ? [] : [`LOC+83+${delivery}'`]),
      "MEA+VGM++KGM:12000'",
      "EQD+CN+CAAU2184518+45G1+++5'",
    ].join('\n'))

    expect(parsed.containers[0]).toMatchObject({ pod: expectedPod, final_dest: delivery === 'BRSEP' ? 'BRSEP' : null })
    expect(parsed.pods).toEqual(expectedPod ? [expectedPod] : [])
    expect(parsed.issues).toEqual(severity ? [expect.objectContaining({ field: 'pod', severity })] : [])
    if (severity === 'warning') expect(parsed.issues[0].message).toContain('Utilizado o local de entrega BRSEP (LOC+83)')
  })

  // E9-02: POD informado e não reconhecido, sem local de entrega que o
  // substitua, é porto fora das escalas: o container sai com aviso. Aqui é o
  // único container, então o arquivo bloqueia por não sobrar nenhum.
  it.each([['XXXXX'], [null]])('POD não reconhecido (N) com Delivery %s tira o container com aviso', (delivery) => {
    const parsed = parseBaplieText([
      "LOC+147+010101'",
      "LOC+6+TAO'",
      "LOC+12+N'",
      ...(delivery === null ? [] : [`LOC+83+${delivery}'`]),
      "MEA+VGM++KGM:12000'",
      "EQD+CN+CAAU2184518+45G1+++5'",
    ].join('\n'))

    expect(parsed.containers).toEqual([])
    expect(parsed.issues).toEqual([
      expect.objectContaining({ field: 'pod', code: 'unknown_port', severity: 'warning', message: expect.stringContaining('não reconhecido (N)') }),
      expect.objectContaining({ severity: 'error', message: expect.stringMatching(/Nenhum container a importar/) }),
    ])
  })

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

  it('lê o nome do navio no C222 e não o código da transportadora (COSCO)', () => {
    const parsed = parseBaplieText([
      "UNB+UNOA:1+CNCAN+COSA+260821:1201++++++COT'",
      "TDT+20+22++BPCF5:103::COSCO SHIPPING FAN RONG++COT:172:20'",
      "UNT+2+1'",
    ].join('\n'))

    expect(parsed.vessel_name).toBe('COSCO SHIPPING FAN RONG')
    expect(parsed.voyage_number).toBe('22')
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

  it('bloqueia indicador ausente em qualquer EQD consecutivo', () => {
    const t = `${head}LOC+147+010101'LOC+9+CNTAO'LOC+11+BRVIX'EQD+CN+TCLU1234567+45G1+++5'EQD+CN+MSCU9999999+45G1+++''`
    const parsed = parseBaplieText(t)
    expect(parsed.containers).toHaveLength(2)
    expect(parsed.issues.filter((i) => i.field === 'status' && i.severity === 'error')).toHaveLength(1)
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

describe('baplieParser — SOC/COC (EQD 8077, elemento 4)', () => {
  const head = "UNB+UNOA:2+X+Y+260101:0000+1'TDT+20+0012+++:::GREEN VITORIA'"
  const unit = (number: string, supplier: string) => `LOC+147+0101${number.slice(-2)}'LOC+9+CNTAO'LOC+11+BRVIX'MEA+WT++KGM:20000'EQD+CN+${number}+45G1+${supplier}+2+5'`

  it('1 = SOC, 2 = COC, vazio = não informado; o 8249 ao lado não interfere', () => {
    const parsed = parseBaplieText(`${head}${unit('TCLU1234567', '1')}${unit('TGHU7654325', '2')}${unit('CSNU2049996', '')}`)
    expect(parsed.containers.map((c) => [c.container_number, c.ownership, c.status])).toEqual([
      ['TCLU1234567', 'SOC', 'full'],
      ['TGHU7654325', 'COC', 'full'],
      ['CSNU2049996', null, 'full'],
    ])
  })
})

// Obs. 1 (sessão de testes de 2026-10-20): o mesmo navio importado em SMDG 1.5
// ou em 2.2 precisa produzir o mesmo staging. Fixtures mínimas com as
// diferenças reais entre as versões: LOC+6/12 com código curto × LOC+9/11 com
// LOCODE e agência, EQD com código de tamanho antigo × novo e fornecedor, MEA
// só WT × WT e VGM, e segmentos que só o 2.2 traz (GID, FTX, CNT).
describe('baplieParser — Obs. 1: SMDG 1.5 e 2.2 do mesmo navio dão o mesmo staging', () => {
  const smdg15 = [
    "UNB+UNOA:2+COS+FWL+261020:1500+15'",
    "UNH+1+BAPLIE:D:95B:UN:SMDG15'",
    "BGM++15+9'",
    "TDT+20+11+++:::GREEN ITAJAI'",
    "LOC+5+CNTAO'",
    "LOC+61+BRVIX'",
    "LOC+147+0010282'",
    "MEA+WT++KGM:22000'",
    "LOC+6+TAO'",
    "LOC+12+VIX'",
    "LOC+83+VIX'",
    "RFF+BM:1'",
    "EQD+CN+UETU7016802+4510+++5'",
    "NAD+CA+COS:172:20'",
    "LOC+147+0030184'",
    "MEA+WT++KGM:18000'",
    "LOC+6+TAO'",
    "LOC+12+SEP'",
    "LOC+83+SEP'",
    "RFF+BM:CSC4516000'",
    "EQD+CN+SEGU7664016+2210+++5'",
    "NAD+CA+COS:172:20'",
    "LOC+147+0050086'",
    "MEA+WT++KGM:3800'",
    "LOC+6+CNTAG'",
    "LOC+12+VIX'",
    "EQD+CN+FCIU8751693+4510+++4'",
    "NAD+CA+COS:172:20'",
    "UNT+27+1'",
    "UNZ+1+15'",
  ].join('\n')

  const smdg22 = [
    "UNB+UNOA:2+COS+FWL+261020:1600+22'",
    "UNH+1+BAPLIE:D:95B:UN:SMDG22'",
    "BGM++22+9'",
    "DTM+137:2610201600:201'",
    "TDT+20+11+++:::GREEN ITAJAI'",
    "LOC+5+CNTAO:139:6'",
    "LOC+61+BRVIX:139:6'",
    "LOC+147+0010282::5'",
    "GID++1'",
    "FTX+AAA+++GENERAL CARGO'",
    "MEA+WT++KGM:22000'",
    "MEA+VGM++KGM:22000'",
    "LOC+9+CNTAO:139:6'",
    "LOC+11+BRVIX:139:6'",
    "LOC+83+BRVIX:139:6'",
    "RFF+BM:1'",
    "EQD+CN+UETU7016802:6346:5+45G1:6346:5+++5'",
    "NAD+CA+COS:172:20'",
    "LOC+147+0030184::5'",
    "MEA+VGM++KGM:18000'",
    "LOC+9+CNTAO:139:6'",
    "LOC+11+BRSEP:139:6'",
    "LOC+83+BRSEP:139:6'",
    "RFF+BM:CSC4516000'",
    "EQD+CN+SEGU7664016:6346:5+22G1:6346:5+++5'",
    "NAD+CA+COS:172:20'",
    "LOC+147+0050086::5'",
    "MEA+VGM++KGM:3800'",
    "LOC+9+CNTAC:139:6'",
    "LOC+11+BRVIX:139:6'",
    "EQD+CN+FCIU8751693:6346:5+45G1:6346:5+++4'",
    "NAD+CA+COS:172:20'",
    "CNT+8:3'",
    "UNT+32+1'",
    "UNZ+1+22'",
  ].join('\n')

  const comparable = (text: string) => parseBaplieText(text).containers.map((c) => ({
    container_number: c.container_number, pol: c.pol, pod: c.pod, final_dest: c.final_dest,
    status: c.status, slot: c.slot, bl_ref: c.bl_ref,
  }))

  it('unidades, POL/POD normalizados, destino final, status, slot e B/L iguais', () => {
    const v15 = parseBaplieText(smdg15)
    const v22 = parseBaplieText(smdg22)
    expect(v15.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(v22.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(comparable(smdg15)).toEqual(comparable(smdg22))
    expect(comparable(smdg22)).toEqual([
      { container_number: 'UETU7016802', pol: 'CNTAO', pod: 'BRVIX', final_dest: 'BRVIX', status: 'full', slot: '0010282', bl_ref: '1' },
      { container_number: 'SEGU7664016', pol: 'CNTAO', pod: 'BRSEP', final_dest: 'BRSEP', status: 'full', slot: '0030184', bl_ref: 'CSC4516000' },
      { container_number: 'FCIU8751693', pol: 'CNTAC', pod: 'BRVIX', final_dest: null, status: 'empty', slot: '0050086', bl_ref: null },
    ])
    expect(v15.pods).toEqual(v22.pods)
  })

  it('arquivo com LOC+9 e LOC+6 (ou 11 e 12) fica com 9 e 11, em qualquer ordem', () => {
    const unit = (locs: string) => `UNB+UNOA:2+X+Y+261020:1500+1'TDT+20+11+++:::GREEN ITAJAI'LOC+147+0010282'MEA+VGM++KGM:20000'${locs}EQD+CN+UETU7016802+45G1+++5'`
    for (const locs of [
      "LOC+9+CNTAO'LOC+6+CNWUH'LOC+11+BRVIX'LOC+12+BRSSZ'",
      "LOC+6+CNWUH'LOC+9+CNTAO'LOC+12+BRSSZ'LOC+11+BRVIX'",
    ]) {
      const parsed = parseBaplieText(unit(locs))
      expect(parsed.containers[0]).toMatchObject({ pol: 'CNTAO', pod: 'BRVIX' })
      expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([])
    }
  })
})
