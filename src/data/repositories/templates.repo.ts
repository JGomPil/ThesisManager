import { supabase } from '@/lib/supabase'
import type {
  Database, TemplateFileRow, TemplateRow, TemplateTaskRow,
} from '@/data/types/database'

type TemplateInsert = Database['public']['Tables']['templates']['Insert']
type TemplateUpdate = Database['public']['Tables']['templates']['Update']
type TemplateTaskInsert = Database['public']['Tables']['template_tasks']['Insert']
type TemplateTaskUpdate = Database['public']['Tables']['template_tasks']['Update']
type TemplateFileInsert = Database['public']['Tables']['template_files']['Insert']

/** Cubo privado del material de plantilla, creado por la migración 0014. */
export const TEMPLATE_BUCKET = 'template-files'

/**
 * `templates` y `work_types` están unidas por DOS claves ajenas en sentidos
 * opuestos: `templates.work_type_id` y `work_types.default_template_id` (esta
 * última se añade con un `alter table` al final de la 0002, porque cuando se
 * crea `work_types` la tabla `templates` todavía no existe). Para PostgREST son
 * dos relaciones entre las mismas dos tablas, así que el embed es ambiguo y sin
 * pista responde HTTP 300 PGRST201 y la pantalla se queda vacía. Pasó.
 *
 * Y la pista no es cosmética: con la equivocada la consulta funcionaría y
 * devolvería otra cosa. Ver `scripts/check-embeds.sh`, que ahora cuenta las
 * relaciones sin mirar la dirección precisamente por este caso.
 */
const SELECT_PLANTILLA =
  '*, work_type:work_types!templates_work_type_id_fkey(id,name,short_name)'
  + ', tasks:template_tasks(*), files:template_files(*)'

export type TemplateWithTasks = TemplateRow & {
  work_type: { id: string; name: string; short_name: string } | null
  tasks: TemplateTaskRow[]
  /**
   * Todo el material de la plantilla en una sola consulta. Se agrupa por
   * `template_task_id` en la interfaz: traerlo tarea por tarea serían N
   * consultas para unas pocas filas, y el plan gratuito de Supabase se mide en
   * peticiones.
   */
  files: TemplateFileRow[]
}

export const templatesRepo = {
  list: async (): Promise<TemplateWithTasks[]> => {
    const { data, error } = await supabase
      .from('templates')
      .select(SELECT_PLANTILLA)
      .order('name')
    if (error) throw error
    return ((data ?? []) as unknown as TemplateWithTasks[]).map((t) => ({
      ...t,
      tasks: [...(t.tasks ?? [])].sort((a, b) => a.order_index - b.order_index),
      files: [...(t.files ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'es')),
    }))
  },

  /**
   * Plantillas aplicables a un trabajo de este tipo: las de su tipo y las
   * genéricas (`work_type_id` nulo). El filtro se repite en la base de datos
   * dentro de `app.apply_template`, que rechaza una plantilla de otro tipo
   * (prueba `[86]`); aquí solo evita ofrecer lo que va a fallar.
   */
  forWorkType: async (workTypeId: string): Promise<TemplateWithTasks[]> => {
    const { data, error } = await supabase
      .from('templates')
      .select(SELECT_PLANTILLA)
      .eq('is_active', true)
      .or(`work_type_id.eq.${workTypeId},work_type_id.is.null`)
      .order('name')
    if (error) throw error
    return ((data ?? []) as unknown as TemplateWithTasks[]).map((t) => ({
      ...t,
      tasks: [...(t.tasks ?? [])].sort((a, b) => a.order_index - b.order_index),
      files: [...(t.files ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'es')),
    }))
  },

  create: async (input: TemplateInsert): Promise<TemplateRow> => {
    const { data, error } = await supabase.from('templates').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  update: async (id: string, patch: TemplateUpdate): Promise<TemplateRow> => {
    const { data, error } = await supabase
      .from('templates').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('templates').delete().eq('id', id)
    if (error) throw error
  },

  addTask: async (input: TemplateTaskInsert): Promise<TemplateTaskRow> => {
    const { data, error } = await supabase.from('template_tasks').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  updateTask: async (id: string, patch: TemplateTaskUpdate): Promise<TemplateTaskRow> => {
    const { data, error } = await supabase
      .from('template_tasks').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  removeTask: async (id: string): Promise<void> => {
    const { error } = await supabase.from('template_tasks').delete().eq('id', id)
    if (error) throw error
  },

  // ---------------------------------------------------------------------------
  // Material de referencia (migración 0014)
  //
  // Ni al aplicar la plantilla ni al abrir la tarea se COPIA nada: la tarea
  // creada guarda `template_task_id` y de ahí sale su material. Corregir la
  // rúbrica una vez la corrige para todos los trabajos en curso, y el plan
  // gratuito de Storage (1 GB) no paga treinta copias del mismo PDF.
  // ---------------------------------------------------------------------------

  /** El material de una tarea de plantilla: lo que ve quien abre la tarea real. */
  filesForTemplateTask: async (templateTaskId: string): Promise<TemplateFileRow[]> => {
    const { data, error } = await supabase
      .from('template_files')
      .select('*')
      .eq('template_task_id', templateTaskId)
      .order('title')
    if (error) throw error
    return data ?? []
  },

  addFile: async (input: TemplateFileInsert): Promise<TemplateFileRow> => {
    const { data, error } = await supabase.from('template_files').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  /**
   * Sube el fichero al cubo privado.
   *
   * La ruta `<template_id>/<id>/<fichero>` NO es decorativa: el primer segmento
   * es la llave de autorización de las políticas de `storage.objects`
   * (migración 0014, `app.can_access_template_object`). Cambiarla sin cambiar
   * las políticas abriría el cubo.
   *
   * El identificador intermedio lo pone el cliente y es el mismo que irá en la
   * fila: así, si la fila no llega a crearse, el objeto queda en una carpeta
   * que nadie referencia y se puede localizar y limpiar.
   */
  uploadFile: async (file: File, templateId: string, fileId: string): Promise<string> => {
    const safe = file.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .slice(-120)
    const path = `${templateId}/${fileId}/${safe}`
    const { error } = await supabase.storage.from(TEMPLATE_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    })
    if (error) throw error
    return path
  },

  /** El cubo es privado: no hay URL pública, solo una firmada de duración corta. */
  downloadUrl: async (storagePath: string, seconds = 120): Promise<string> => {
    const { data, error } = await supabase.storage
      .from(TEMPLATE_BUCKET).createSignedUrl(storagePath, seconds)
    if (error) throw error
    return data.signedUrl
  },

  /**
   * Quita el material. Primero el objeto y después la fila: al revés, un fallo
   * entre las dos dejaría una fila apuntando a un fichero que ya no existe, que
   * es un adjunto roto en la pantalla de todos los estudiantes. Si falla el
   * orden que sí se usa, lo que queda son bytes huérfanos inaccesibles.
   */
  removeFile: async (file: TemplateFileRow): Promise<void> => {
    if (file.storage_path) {
      const { error } = await supabase.storage.from(TEMPLATE_BUCKET).remove([file.storage_path])
      if (error) throw error
    }
    const { error } = await supabase.from('template_files').delete().eq('id', file.id)
    if (error) throw error
  },

  /**
   * Aplica la plantilla al trabajo y devuelve cuántas tareas ha creado.
   *
   * Una sola llamada, no N inserciones: o se crea el plan entero o no se crea
   * nada (prueba `[87]`). La función de PostgreSQL resuelve además la jerarquía
   * interna de la plantilla, que el cliente no puede resolver sin ir
   * descubriendo identificadores a mitad de la secuencia.
   *
   * `startDate` es el día cero del plan. Si no se pasa, la base de datos usa el
   * inicio del trabajo y, en su defecto, hoy.
   */
  apply: async (workId: string, templateId: string, startDate?: string): Promise<number> => {
    const { data, error } = await supabase.rpc('apply_template', {
      p_work: workId,
      p_template: templateId,
      p_start: startDate ?? null,
    })
    if (error) throw error
    return data ?? 0
  },
}
