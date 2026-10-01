import { supabase } from './supabase'
import type { AppSettings } from '../types/database'
import { toError } from '../lib/errors'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  id: 1,
  communications_enabled: false,
  demurrage_dunning_interval_days: 7,
  created_at: '',
}

export async function fetchAppSettings(): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()

  if (error) throw toError(error)
  if (!data) return DEFAULT_APP_SETTINGS
  return data
}

export async function setCommunicationsEnabled(enabled: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_communications_enabled', {
    p_enabled: enabled,
  })

  if (error) throw toError(error)
  return data
}

export async function setDemurrageDunningIntervalDays(days: number): Promise<number> {
  const { data, error } = await supabase.rpc('set_demurrage_dunning_interval_days', {
    p_days: days,
  })

  if (error) throw toError(error)
  return data
}
