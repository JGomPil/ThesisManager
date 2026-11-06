import { supabase } from '@/lib/supabase'
import type {
  Database, MeetingAgreementRow, MeetingPrivateNoteRow, MeetingRow,
} from '@/data/types/database'

type MeetingInsert = Database['public']['Tables']['meetings']['Insert']
type MeetingUpdate = Database['public']['Tables']['meetings']['Update']
type AgreementInsert = Database['public']['Tables']['meeting_agreements']['Insert']

/**
 * `meeting_participants` y `meeting_agreements` apuntan cada uno a una sola
 * tabla de personas, pero las pistas se ponen igual, por la razón del resto del
 * proyecto: dejan escrita la intención y no se rompen el día que la tabla gane
 * una segunda clave ajena. `scripts/check-embeds.sh` lo exige.
 */
const MEETING_SELECT = `
  *,
  participants:meeting_participants(
    meeting_id, user_id, attended,
    profile:profiles!meeting_participants_user_id_fkey(id,full_name)
  ),
  agreements:meeting_agreements(*)
`

export type MeetingWithDetail = MeetingRow & {
  participants: {
    meeting_id: string
    user_id: string
    attended: boolean | null
    profile: { id: string; full_name: string } | null
  }[]
  agreements: MeetingAgreementRow[]
}

export const MEETING_MODALITIES = [
  { value: 'PRESENCIAL', label: 'Presencial' },
  { value: 'ONLINE', label: 'En línea' },
  { value: 'HIBRIDA', label: 'Híbrida' },
] as const

export const meetingsRepo = {
  byWork: async (workId: string): Promise<MeetingWithDetail[]> => {
    const { data, error } = await supabase
      .from('meetings')
      .select(MEETING_SELECT)
      .eq('work_id', workId)
      .order('scheduled_at', { ascending: false })
    if (error) throw error
    return ((data ?? []) as unknown as MeetingWithDetail[]).map((m) => ({
      ...m,
      agreements: [...(m.agreements ?? [])].sort((a, b) => a.order_index - b.order_index),
    }))
  },

  create: async (input: MeetingInsert): Promise<MeetingRow> => {
    const { data, error } = await supabase.from('meetings').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  update: async (id: string, patch: MeetingUpdate): Promise<MeetingRow> => {
    const { data, error } = await supabase.from('meetings').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('meetings').delete().eq('id', id)
    if (error) throw error
  },

  setParticipants: async (
    meetingId: string,
    rows: { user_id: string; attended: boolean | null }[],
  ): Promise<void> => {
    // Se reemplaza el conjunto completo: la alternativa (calcular el diferencial
    // en el cliente) añade estado y puede desincronizarse si alguien edita
    // desde otra pestaña.
    const { error: delError } = await supabase
      .from('meeting_participants').delete().eq('meeting_id', meetingId)
    if (delError) throw delError
    if (rows.length === 0) return
    const { error } = await supabase
      .from('meeting_participants')
      .insert(rows.map((r) => ({ meeting_id: meetingId, ...r })))
    if (error) throw error
  },

  addAgreement: async (input: AgreementInsert): Promise<MeetingAgreementRow> => {
    const { data, error } = await supabase.from('meeting_agreements').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  removeAgreement: async (id: string): Promise<void> => {
    const { error } = await supabase.from('meeting_agreements').delete().eq('id', id)
    if (error) throw error
  },

  /** Vincula el acuerdo con la tarea que se ha generado a partir de él. */
  linkAgreementTask: async (agreementId: string, taskId: string): Promise<void> => {
    const { error } = await supabase
      .from('meeting_agreements').update({ task_id: taskId }).eq('id', agreementId)
    if (error) throw error
  },

  /**
   * NOTAS PRIVADAS DE DIRECCIÓN.
   *
   * Consulta separada y deliberadamente NO embebida en `MEETING_SELECT`. Si
   * viniesen dentro de la reunión, un día alguien reutilizaría ese select en
   * una pantalla que ve el estudiante y la nota viajaría en el JSON aunque no
   * se pintara. La política `private_notes_select` lo impediría de todos modos
   * —es la frontera real— pero no hay motivo para pedir al servidor algo que no
   * se va a usar, ni para que el dato pase cerca de donde no debe.
   *
   * Devuelve una lista vacía para quien no puede verlas, sin error: RLS filtra
   * filas, no rechaza la consulta. Que esté vacía no significa que no existan.
   */
  privateNotes: async (meetingId: string): Promise<MeetingPrivateNoteRow[]> => {
    const { data, error } = await supabase
      .from('meeting_private_notes')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  addPrivateNote: async (
    meetingId: string, workId: string, authorId: string, content: string,
  ): Promise<MeetingPrivateNoteRow> => {
    const { data, error } = await supabase
      .from('meeting_private_notes')
      .insert({ meeting_id: meetingId, work_id: workId, author_id: authorId, content })
      .select('*')
      .single()
    if (error) throw error
    return data
  },

  removePrivateNote: async (id: string): Promise<void> => {
    const { error } = await supabase.from('meeting_private_notes').delete().eq('id', id)
    if (error) throw error
  },
}
