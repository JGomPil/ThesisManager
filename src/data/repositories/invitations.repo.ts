import { supabase } from '@/lib/supabase'
import type { Database, InvitationRow, InvitationStatus } from '@/data/types/database'

type InvitationInsert = Database['public']['Tables']['invitations']['Insert']

/**
 * Cola de invitaciones.
 *
 * La aplicación NO envía los correos: hacerlo requiere la clave `service_role`,
 * que no puede existir en un frontend público. Esto es una lista de trabajo
 * para el administrador, que envía desde el panel de Supabase.
 *
 * Ver la cabecera de supabase/migrations/0005_invitations.sql para el camino
 * de automatización con una Edge Function, que no añadiría coste.
 */
export const invitationsRepo = {
  list: async (): Promise<InvitationRow[]> => {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .order('status')
      .order('created_at')
    if (error) throw error
    return data ?? []
  },

  create: async (input: InvitationInsert): Promise<InvitationRow> => {
    // El correo se normaliza aquí: la base de datos tiene un CHECK que exige
    // minúsculas, para que el índice único no se pueda burlar con mayúsculas.
    const { data, error } = await supabase
      .from('invitations')
      .insert({ ...input, email: input.email.trim().toLowerCase() })
      .select('*')
      .single()
    if (error) throw error
    return data
  },

  setStatus: async (id: string, status: InvitationStatus): Promise<InvitationRow> => {
    const { data, error } = await supabase
      .from('invitations')
      .update({ status, sent_at: status === 'SENT' ? new Date().toISOString() : null })
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw error
    return data
  },

  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('invitations').delete().eq('id', id)
    if (error) throw error
  },
}

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Pendiente de enviar', tone: 'amber' },
  SENT: { label: 'Enviada', tone: 'sky' },
  ACCEPTED: { label: 'Aceptada', tone: 'green' },
  CANCELLED: { label: 'Cancelada', tone: 'slate' },
}
