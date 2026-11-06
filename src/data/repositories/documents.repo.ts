import { supabase } from '@/lib/supabase'
import type {
  Database, DocumentCommentRow, DocumentReviewStatus, DocumentRow, DocumentVersionRow,
} from '@/data/types/database'

type DocumentInsert = Database['public']['Tables']['documents']['Insert']
type VersionInsert = Database['public']['Tables']['document_versions']['Insert']

/** Cubo privado creado por la migración 0010. */
export const DOCS_BUCKET = 'work-documents'

/**
 * `document_versions` apunta a `profiles` por `author_id` y por `reviewer_id`,
 * así que los embeds necesitan pista explícita o PostgREST responde HTTP 300
 * PGRST201. Lo mismo para `documents.created_by`, donde la pista no es
 * estrictamente necesaria hoy pero se pone igual: deja la intención escrita y
 * no se rompe el día que esa tabla gane una segunda clave ajena a `profiles`.
 * `scripts/check-embeds.sh` lo vigila.
 */
const DOC_SELECT = `
  *,
  document_type:document_types(id,code,name),
  author:profiles!documents_created_by_fkey(id,full_name),
  versions:document_versions!document_versions_document_id_fkey(
    *,
    author:profiles!document_versions_author_id_fkey(id,full_name),
    reviewer:profiles!document_versions_reviewer_id_fkey(id,full_name)
  )
`

type PersonLite = { id: string; full_name: string } | null

export type DocumentVersionWithPeople = DocumentVersionRow & {
  author: PersonLite
  reviewer: PersonLite
}

export type DocumentCommentWithAuthor = DocumentCommentRow & {
  author: { id: string; full_name: string; avatar_url: string | null } | null
}

export type DocumentWithVersions = DocumentRow & {
  document_type: { id: string; code: string; name: string } | null
  author: PersonLite
  versions: DocumentVersionWithPeople[]
}

export const REVIEW_STATUSES: { value: DocumentReviewStatus; label: string; tone: string }[] = [
  { value: 'BORRADOR', label: 'Borrador', tone: 'slate' },
  { value: 'ENTREGADO', label: 'Entregado', tone: 'sky' },
  { value: 'EN_REVISION', label: 'En revisión', tone: 'amber' },
  { value: 'REVISADO', label: 'Revisado', tone: 'violet' },
  { value: 'APROBADO', label: 'Aprobado', tone: 'green' },
  { value: 'RECHAZADO', label: 'Rechazado', tone: 'red' },
]

/** Ordena las versiones de más reciente a más antigua. */
const sortVersions = (d: DocumentWithVersions): DocumentWithVersions => ({
  ...d,
  versions: [...(d.versions ?? [])].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)),
})

export const documentsRepo = {
  /**
   * No se filtra por usuario: RLS ya devuelve solo los documentos de los
   * trabajos accesibles. Los archivados los filtra la propia política, que
   * únicamente los muestra a quien valida entregables o a la administración.
   */
  byWork: async (workId: string): Promise<DocumentWithVersions[]> => {
    const { data, error } = await supabase
      .from('documents')
      .select(DOC_SELECT)
      .eq('work_id', workId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) throw error
    return ((data ?? []) as unknown as DocumentWithVersions[]).map(sortVersions)
  },

  create: async (input: DocumentInsert): Promise<DocumentRow> => {
    const { data, error } = await supabase.from('documents').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  update: async (id: string, patch: Partial<DocumentInsert>): Promise<DocumentRow> => {
    const { data, error } = await supabase.from('documents').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  /** Archivado lógico: la historia documental de un trabajo no se tira. */
  archive: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  addVersion: async (input: VersionInsert): Promise<DocumentVersionRow> => {
    const { data, error } = await supabase.from('document_versions').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  /**
   * Cambio del estado de revisión. Va en su propio método porque es acto de
   * supervisión: la política `versions_update` exige `can_validate_deliverables`
   * o ser administrador del trabajo. Quien entrega no puede aprobarse a sí mismo.
   */
  setReviewStatus: async (
    versionId: string,
    status: DocumentReviewStatus,
    reviewerId: string | null,
    notes?: string | null,
  ): Promise<void> => {
    const { error } = await supabase
      .from('document_versions')
      .update({
        review_status: status,
        reviewed_at: new Date().toISOString(),
        reviewer_id: reviewerId,
        ...(notes === undefined ? {} : { notes }),
      })
      .eq('id', versionId)
    if (error) throw error
  },

  /**
   * Sube el fichero al cubo privado.
   *
   * La ruta `<work_id>/<document_id>/<fichero>` NO es decorativa: el primer
   * segmento es la llave de autorización de las políticas de `storage.objects`
   * (migración 0010). Cambiarla sin cambiar las políticas abriría el cubo.
   *
   * El nombre se normaliza porque Storage rechaza ciertos caracteres, y se le
   * añade un sufijo temporal para que subir dos veces el mismo fichero no
   * sobrescriba la versión anterior: cada versión debe conservar su fichero.
   */
  upload: async (file: File, workId: string, documentId: string): Promise<string> => {
    const safe = file.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .slice(-120)
    const path = `${workId}/${documentId}/${Date.now()}-${safe}`
    const { error } = await supabase.storage.from(DOCS_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    })
    if (error) throw error
    return path
  },

  /**
   * URL de descarga temporal. El cubo es privado, así que no hay URL pública:
   * Storage firma una URL de duración corta y solo si las políticas dejan leer
   * el objeto a quien la pide.
   */
  downloadUrl: async (storagePath: string, seconds = 120): Promise<string> => {
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(storagePath, seconds)
    if (error) throw error
    return data.signedUrl
  },

  // ---------------------------------------------------------------------------
  // Comentarios anclados a una VERSIÓN (migración 0015)
  //
  // El anclaje es la versión y no una página ni un párrafo: una posición dentro
  // del fichero no se puede resolver cuando el fichero puede ser un PDF, un
  // .docx o un enlace a Drive, y una referencia que no se puede resolver es
  // peor que ninguna. «Esto, en la v3» se entiende siempre y no se rompe al
  // subir la v4.
  //
  // `work_id` NO se envía: lo pone el disparador `app.enforce_doc_comment_scope`
  // a partir de la versión. Es la columna por la que la política decide quién ve
  // el comentario, así que no es un dato que deba poner el cliente.
  // ---------------------------------------------------------------------------

  comments: async (versionId: string): Promise<DocumentCommentWithAuthor[]> => {
    const { data, error } = await supabase
      .from('document_comments')
      .select('*, author:profiles!document_comments_author_id_fkey(id,full_name,avatar_url)')
      .eq('version_id', versionId)
      .order('created_at')
    if (error) throw error
    return (data ?? []) as unknown as DocumentCommentWithAuthor[]
  },

  /**
   * Cuántos comentarios tiene cada versión del trabajo, en UNA consulta.
   * Sirve para poder decir «3 comentarios» en el listado sin pedirlos uno por
   * uno: son decenas de filas y el plan gratuito se mide en peticiones.
   */
  commentCounts: async (workId: string): Promise<Record<string, number>> => {
    const { data, error } = await supabase
      .from('document_comments')
      .select('version_id')
      .eq('work_id', workId)
    if (error) throw error
    const cuenta: Record<string, number> = {}
    for (const f of data ?? []) cuenta[f.version_id] = (cuenta[f.version_id] ?? 0) + 1
    return cuenta
  },

  addComment: async (versionId: string, authorId: string, content: string): Promise<void> => {
    const { error } = await supabase
      .from('document_comments')
      // Sin `work_id`: la columna es NOT NULL, pero PostgreSQL comprueba las
      // restricciones DESPUÉS de los disparadores BEFORE, y el de la 0015 ya lo
      // ha rellenado con el de la versión. Mandarlo desde aquí solo abriría la
      // posibilidad de mandarlo mal.
      .insert({ version_id: versionId, author_id: authorId, content })
    if (error) throw error
  },

  removeComment: async (id: string): Promise<void> => {
    const { error } = await supabase.from('document_comments').delete().eq('id', id)
    if (error) throw error
  },

  removeFile: async (storagePath: string): Promise<void> => {
    const { error } = await supabase.storage.from(DOCS_BUCKET).remove([storagePath])
    if (error) throw error
  },
}
