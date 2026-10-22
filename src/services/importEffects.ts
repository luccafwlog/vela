import type { Json } from '../types/database'
import { supabase } from './supabase'
import { toError } from '../lib/errors'

export type ImportEffectState = 'pending' | 'running' | 'retry_wait' | 'blocked' | 'succeeded' | 'superseded'
export type ImportEffectKind = 'physical_flags' | 'provisional_charges' | 'local_billing' | 'granite_billing' | 'demurrage_billing' | 'vehicle_followup'

export type ImportEffect = {
  id: number
  source_action_id: string
  effect_kind: ImportEffectKind
  entity_id: string
  status: ImportEffectState
  attempts: number
  created_at: string
  created_by: string | null
  source_revision: number
  source_snapshot: Record<string, Json>
  depends_on_effect_id: number | null
  next_attempt_at: string
  lease_until: string | null
  leased_by: string | null
  last_error_code: string | null
  last_error_message: string | null
  result: Record<string, Json> | null
  superseded_by_effect_id: number | null
  updated_at: string
}

export type ImportEffectOutcome = {
  effect: ImportEffect
  idempotent: boolean
}

// O erro do PostgREST em `{ data, error }` é objeto, não `Error`: `toError`
// mantém a mensagem e o SQLSTATE para a tela traduzir (ADR 0095, decisão 4).
function throwRpcError(error: unknown): never {
  throw toError(error)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asEffect(value: unknown): ImportEffect {
  if (!isObject(value) || typeof value.id !== 'number' || typeof value.entity_id !== 'string') {
    throw new Error('Resposta invalida da fila de efeitos de import.')
  }
  return value as unknown as ImportEffect
}

function asOutcome(value: unknown): ImportEffectOutcome {
  if (!isObject(value) || !('effect' in value)) {
    throw new Error('Resposta invalida da fila de efeitos de import.')
  }
  return {
    effect: asEffect(value.effect),
    idempotent: value.idempotent === true,
  }
}

export async function enqueueImportEffect(input: {
  sourceActionId: string
  effectKind: ImportEffectKind
  entityId: string
  createdBy: string
  sourceRevision?: number
  dependsOnEffectId?: number | null
  sourceSnapshot?: Record<string, Json>
}): Promise<ImportEffectOutcome> {
  const { data, error } = await supabase.rpc('enqueue_import_effect', {
    p_source_action_id: input.sourceActionId,
    p_effect_kind: input.effectKind,
    p_entity_id: input.entityId,
    p_created_by: input.createdBy,
    p_source_revision: input.sourceRevision ?? 1,
    p_depends_on_effect_id: input.dependsOnEffectId ?? null,
    p_source_snapshot: input.sourceSnapshot ?? {},
  })
  if (error) throwRpcError(error)
  return asOutcome(data)
}

export async function claimImportEffects(input: {
  workerId: string
  limit?: number
  leaseSeconds?: number
}): Promise<ImportEffect[]> {
  const { data, error } = await supabase.rpc('claim_import_effects', {
    p_worker_id: input.workerId,
    p_limit: input.limit ?? 20,
    p_lease_seconds: input.leaseSeconds ?? 300,
  })
  if (error) throwRpcError(error)
  if (!Array.isArray(data)) throw new Error('Resposta invalida do claim de efeitos de import.')
  return data.map(asEffect)
}

export async function completeImportEffect(input: {
  effectId: number
  workerId: string
  status: Exclude<ImportEffectState, 'pending' | 'running'>
  result?: Record<string, Json>
  errorCode?: string | null
  errorMessage?: string | null
  retryAt?: string | null
}): Promise<ImportEffectOutcome> {
  const { data, error } = await supabase.rpc('complete_import_effect', {
    p_effect_id: input.effectId,
    p_worker_id: input.workerId,
    p_status: input.status,
    p_result: input.result ?? {},
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_retry_at: input.retryAt ?? null,
  })
  if (error) throwRpcError(error)
  return asOutcome(data)
}

export async function listImportEffects(options: {
  entityId?: string
  status?: ImportEffectState
  limit?: number
} = {}): Promise<ImportEffect[]> {
  const { data, error } = await supabase.rpc('list_import_effects', {
    p_entity_id: options.entityId ?? null,
    p_status: options.status ?? null,
    p_limit: options.limit ?? 100,
  })
  if (error) throwRpcError(error)
  if (!Array.isArray(data)) throw new Error('Resposta invalida da consulta de efeitos de import.')
  return data.map(asEffect)
}

export async function retryImportEffect(effectId: number, justification: string): Promise<ImportEffectOutcome> {
  const { data, error } = await supabase.rpc('retry_import_effect', {
    p_effect_id: effectId,
    p_justification: justification,
  })
  if (error) throwRpcError(error)
  return asOutcome(data)
}
