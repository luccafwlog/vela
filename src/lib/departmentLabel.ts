/** Nome do departamento exibido ao usuário interno (perfil e menu da conta). */
export function departmentLabel(role: string | null | undefined): string {
  switch (role) {
    case 'administrativo': return 'Administrativo'
    case 'financeiro': return 'Financeiro'
    case 'operacoes': return 'Operações'
    case 'equipamentos': return 'Equipamentos'
    case 'operator':
    case 'documentacao': return 'Documentação'
    default: return '—'
  }
}
