import { supabase } from '@/lib/supabase'
import type { Database, InvitationRow, InvitationStatus } from '@/data/types/database'

type InvitationInsert = Database['public']['Tables']['invitations']['Insert']

/**
 * Altas autorizadas.
 *
 * NO ES UNA COLA DE ENVÍO, y llamarla así costó un diagnóstico: la aplicación
 * no envía correos —haría falta la clave `service_role`, que no puede existir
 * en un frontend público— y el panel de Supabase tampoco envía estas filas.
 * Lo que hay aquí es una lista de PERMISOS DE ENTRADA: cada fila dice que, si
 * alguna vez existe una cuenta con ese correo, quedará de alta en el grupo con
 * la función prevista. El alta de verdad es un acto manual en tres pasos y está
 * descrita en DEPLOYMENT.md.
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

/**
 * LOS RÓTULOS DICEN SI ESA PERSONA PUEDE ENTRAR O NO, que es lo único que se
 * viene a mirar aquí. No es un detalle de redacción.
 *
 * «Enviada» era mentira a medias: la aplicación no envía ningún correo, así que
 * ese estado solo significaba que quien administra marcó la fila a mano. Leído
 * en una tabla, «Enviada» se entiende como «el sistema la ha enviado», y lo que
 * se concluye cuando la persona no recibe nada es que el envío ha fallado
 * —cuando lo que pasa es que nunca hubo envío—. Y encima tapaba el dato útil:
 * esa fila es una cuenta QUE TODAVÍA NO EXISTE.
 *
 * «Aceptada» tampoco decía lo que significa, y la fecha exacta importa: la pone
 * la base de datos (migración 0005) EN EL MOMENTO EN QUE SE CREA LA CUENTA, no
 * cuando la persona entra. El disparador cuelga de `profiles`, y el perfil lo
 * crea `app.handle_new_user` al insertarse la fila en `auth.users`. O sea que
 * no es que haya «aceptado» nada: es que ya tiene cuenta. Y eso convierte el
 * estado en el único indicador fiable de la pantalla, porque responde sin salir
 * de ella la pregunta que si no exige un viaje al panel de Supabase.
 */
export const INVITATION_STATUS_LABELS: Record<InvitationStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Falta crear su cuenta', tone: 'amber' },
  SENT: { label: 'Avisada, sin cuenta aún', tone: 'sky' },
  ACCEPTED: { label: 'Cuenta creada y de alta', tone: 'green' },
  CANCELLED: { label: 'Cancelada', tone: 'slate' },
}
