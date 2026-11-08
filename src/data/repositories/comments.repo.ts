import { supabase } from '@/lib/supabase'
import type { CommentEntityType, CommentRow, Database } from '@/data/types/database'

type CommentInsert = Database['public']['Tables']['comments']['Insert']

const COMMENT_SELECT = `
  *,
  author:profiles!comments_author_id_fkey(id,full_name,avatar_url)
`

export type CommentWithAuthor = CommentRow & {
  author: { id: string; full_name: string; avatar_url: string | null } | null
}

export const commentsRepo = {
  /**
   * Comentarios de una entidad concreta del trabajo.
   *
   * `work_id` es obligatorio en la tabla aunque el comentario cuelgue de una
   * tarea o de un documento: es lo que permite a la política de RLS decidir con
   * una sola comprobación, sin tener que saltar a la tabla de la entidad. Está
   * desnormalizado a propósito.
   */
  byEntity: async (
    workId: string, entityType: CommentEntityType, entityId: string,
  ): Promise<CommentWithAuthor[]> => {
    const { data, error } = await supabase
      .from('comments')
      .select(COMMENT_SELECT)
      .eq('work_id', workId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []) as unknown as CommentWithAuthor[]
  },

  create: async (input: CommentInsert): Promise<CommentRow> => {
    const { data, error } = await supabase.from('comments').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  /**
   * Cambiar el texto de un comentario ya publicado.
   *
   * SOLO EL AUTOR, Y SOLO EL TEXTO, y ninguna de las dos cosas la decide esta
   * función: la política `comments_update` exige `author_id = app.uid()` y el
   * disparador `enforce_comment_immutable` (0029) congela el trabajo, la
   * entidad, el autor y la fecha de creación. Que aquí se mande únicamente
   * `content` es comodidad, no la garantía.
   *
   * `updated_at` NO se manda: lo pone el disparador `comments_updated_at`. Una
   * marca de «editado» que dependa del cliente es una marca que se puede
   * omitir hablando con la API directamente.
   */
  update: async (id: string, content: string): Promise<void> => {
    const { error } = await supabase.from('comments').update({ content }).eq('id', id)
    if (error) throw error
  },

  /** Borrado lógico: deja el hueco en la conversación sin romper las respuestas. */
  remove: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('comments').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  },
}
