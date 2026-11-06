import { supabase } from '@/lib/supabase'
import type { Database, MilestoneRow } from '@/data/types/database'

type MilestoneInsert = Database['public']['Tables']['milestones']['Insert']
type MilestoneUpdate = Database['public']['Tables']['milestones']['Update']

export const milestonesRepo = {
  byWork: async (workId: string): Promise<MilestoneRow[]> => {
    const { data, error } = await supabase
      .from('milestones')
      .select('*')
      .eq('work_id', workId)
      .order('due_date')
    if (error) throw error
    return data ?? []
  },

  create: async (input: MilestoneInsert): Promise<MilestoneRow> => {
    const { data, error } = await supabase.from('milestones').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  update: async (id: string, patch: MilestoneUpdate): Promise<MilestoneRow> => {
    const { data, error } = await supabase
      .from('milestones').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  /**
   * Marca el hito como cumplido o lo devuelve a pendiente.
   *
   * NO ENVÍA `met_at` a propósito: la pone el disparador `milestones_met_at` de
   * la migración 0012. Dos sitios escribiendo la misma información acaban
   * discrepando, y la fecha de cumplimiento de un hito académico es
   * exactamente el dato que no conviene tener en dos versiones.
   */
  setMet: async (id: string, isMet: boolean): Promise<MilestoneRow> => {
    const { data, error } = await supabase
      .from('milestones').update({ is_met: isMet }).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('milestones').delete().eq('id', id)
    if (error) throw error
  },
}
