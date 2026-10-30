/**
 * Portos da consulta pública de container do fwlog.com.br (ADR 0114; Pecém
 * entrou por decisão do dono de 2026-10-30). Lista própria, separada dos
 * portos da Central de Informações (`portalServicePorts`): a migration 542
 * (`_public_lookup_port_codes()`) e a Edge repetem os códigos, e os testes
 * comparam as três.
 */
export const PUBLIC_LOOKUP_PORTS = [
  { code: 'BRSSA', name: 'Salvador' },
  { code: 'BRVIX', name: 'Vitória' },
  { code: 'BRPEC', name: 'Pecém' },
  { code: 'BRSUA', name: 'Suape' },
] as const
