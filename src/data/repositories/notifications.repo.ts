import { supabase } from '@/lib/supabase'
import type { NotificationRow } from '@/data/types/database'

/**
 * Buzón de notificaciones internas.
 *
 * NO HAY MÉTODO PARA CREARLAS, y es a propósito: `notifications` no tiene
 * política de INSERT. Las crean disparadores en la base de datos (migración
 * 0011) cuando ocurre el hecho que se notifica. Si el cliente pudiera
 * insertarlas, cualquier usuario podría escribir avisos en el buzón de
 * cualquier otro, que es suplantación.
 *
 * Tampoco hay disparador sobre las notas privadas de dirección: avisar de que
 * existe una nota privada revelaría su existencia a quien no puede leerla.
 */
export const notificationsRepo = {
  list: async (limit = 30): Promise<NotificationRow[]> => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data ?? []
  },

  unreadCount: async (): Promise<number> => {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
    if (error) throw error
    return count ?? 0
  },

  markRead: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  },

  markAllRead: async (): Promise<void> => {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null)
    if (error) throw error
  },

  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('notifications').delete().eq('id', id)
    if (error) throw error
  },
}
