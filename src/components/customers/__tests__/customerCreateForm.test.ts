import { describe, expect, it } from 'vitest'
import { applyCnpjLookup, emptyCreateCustomerForm } from '../customerCreateForm'

const receita = {
  razao_social: 'OPEN KNOWLEDGE BRASIL',
  nome_fantasia: 'REDE PELO CONHECIMENTO LIVRE',
  cep: '01311902',
  endereco: 'AVENIDA PAULISTA, 37 - BELA VISTA',
  cidade: 'SAO PAULO',
  uf: 'SP',
}

describe('applyCnpjLookup (ADR 0127)', () => {
  it('preenche os campos vazios e guarda o que pôs', () => {
    const { form, filled } = applyCnpjLookup({ ...emptyCreateCustomerForm, cnpjCpf: '19131243000197' }, receita, {})
    expect(form).toMatchObject({ name: 'OPEN KNOWLEDGE BRASIL', tradeName: 'REDE PELO CONHECIMENTO LIVRE', zip: '01311902', address: 'AVENIDA PAULISTA, 37 - BELA VISTA', city: 'SAO PAULO', state: 'SP' })
    expect(filled.name).toBe('OPEN KNOWLEDGE BRASIL')
  })

  it('nunca troca o que o operador digitou', () => {
    const { form, filled } = applyCnpjLookup({ ...emptyCreateCustomerForm, name: 'Open Knowledge', city: 'São Paulo' }, receita, {})
    expect(form.name).toBe('Open Knowledge')
    expect(form.city).toBe('São Paulo')
    expect(form.state).toBe('SP')
    expect(filled).not.toHaveProperty('name')
  })

  it('outro CNPJ troca o que a consulta anterior pôs, e mantém o que foi editado depois', () => {
    const first = applyCnpjLookup(emptyCreateCustomerForm, receita, {})
    const edited = { ...first.form, address: 'Av. Paulista, 37' }
    const other = { ...receita, razao_social: 'OUTRA EMPRESA', nome_fantasia: '', endereco: 'RUA B, 1', cidade: 'SANTOS' }
    const { form } = applyCnpjLookup(edited, other, first.filled)
    expect(form.name).toBe('OUTRA EMPRESA')
    expect(form.tradeName).toBe('')
    expect(form.address).toBe('Av. Paulista, 37')
    expect(form.city).toBe('SANTOS')
  })

  it('sem dados (não achado ou indisponível), limpa só o que a consulta anterior pôs', () => {
    const first = applyCnpjLookup({ ...emptyCreateCustomerForm, zip: '29000000' }, receita, {})
    const { form, filled } = applyCnpjLookup(first.form, null, first.filled)
    expect(form.name).toBe('')
    expect(form.address).toBe('')
    expect(form.zip).toBe('29000000')
    expect(filled).toEqual({})
  })
})
