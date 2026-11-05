import { supabase } from '@/lib/supabase'
import type { OrganizationMemberRow, ProfileRow } from '@/data/types/database'

export type Membership = OrganizationMemberRow & {
  organization: { id: string; name: string; slug: string } | null
}

export const peopleRepo = {
  /** Perfil del usuario autenticado. RLS garantiza que solo pueda ser el suyo. */
  me: async (userId: string): Promise<ProfileRow | null> => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) throw error
    return data
  },

  updateMe: async (userId: string, patch: Partial<ProfileRow>): Promise<ProfileRow> => {
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single()
    if (error) throw error
    return data
  },

  /**
   * Pertenencias administrativas del usuario. Son INDEPENDIENTES de las
   * relaciones académicas: ser administrador no convierte a nadie en director.
   */
  myMemberships: async (userId: string): Promise<Membership[]> => {
    const { data, error } = await supabase
      .from('organization_members')
      .select('*, organization:organizations(id,name,slug)')
      .eq('user_id', userId)
      .eq('is_active', true)
    if (error) throw error
    return (data ?? []) as unknown as Membership[]
  },

  /** Directorio de personas visibles (misma organización, por RLS). */
  directory: async (): Promise<ProfileRow[]> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .order('full_name')
    if (error) throw error
    return data ?? []
  },
}
