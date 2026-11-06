import { supabase } from '@/lib/supabase'
import type { OrganizationMemberRow, ProfileRow } from '@/data/types/database'

export type PendingAccount = {
  id: string
  full_name: string
  email: string
  created_at: string
}

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

  /**
   * Cuentas creadas a mano que todavía no pertenecen a ninguna organización.
   *
   * NO sale de `profiles`: `profiles_select` no deja ver a quien no comparte
   * organización, y eso es deliberado. Sale de `public.pending_accounts()`, que
   * comprueba por dentro que quien pregunta administra algo y devuelve solo las
   * cuentas sin pertenencia. Ver la cabecera de la migración 0013.
   */
  pendingAccounts: async (): Promise<PendingAccount[]> => {
    const { data, error } = await supabase.rpc('pending_accounts')
    if (error) throw error
    return data ?? []
  },

  /**
   * Autoriza una cuenta: la mete en la organización.
   *
   * No necesitó ninguna política nueva —`org_members_write` ya permitía a la
   * administración escribir filas de su organización—; lo que faltaba era
   * poder VER a quién autorizar.
   */
  authorize: async (
    organizationId: string, userId: string, role: OrganizationMemberRow['role'],
  ): Promise<void> => {
    const { error } = await supabase
      .from('organization_members')
      .insert({ organization_id: organizationId, user_id: userId, role })
    if (error) throw error
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
