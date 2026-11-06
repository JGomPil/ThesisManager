import { supabase } from '@/lib/supabase'
import type {
  Database, DocumentReviewStatus, DocumentRow, DocumentVersionRow,
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

  removeFile: async (storagePath: string): Promise<void> => {
    const { error } = await supabase.storage.from(DOCS_BUCKET).remove([storagePath])
    if (error) throw error
  },
}
