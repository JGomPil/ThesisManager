import { supabase } from '@/lib/supabase'
import type { Database, TemplateRow, TemplateTaskRow } from '@/data/types/database'

type TemplateInsert = Database['public']['Tables']['templates']['Insert']
type TemplateUpdate = Database['public']['Tables']['templates']['Update']
type TemplateTaskInsert = Database['public']['Tables']['template_tasks']['Insert']
type TemplateTaskUpdate = Database['public']['Tables']['template_tasks']['Update']

export type TemplateWithTasks = TemplateRow & {
  work_type: { id: string; name: string; short_name: string } | null
  tasks: TemplateTaskRow[]
}

export const templatesRepo = {
  list: async (): Promise<TemplateWithTasks[]> => {
    const { data, error } = await supabase
      .from('templates')
      .select('*, work_type:work_types(id,name,short_name), tasks:template_tasks(*)')
      .order('name')
    if (error) throw error
    return ((data ?? []) as unknown as TemplateWithTasks[]).map((t) => ({
      ...t,
      tasks: [...(t.tasks ?? [])].sort((a, b) => a.order_index - b.order_index),
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
      .select('*, work_type:work_types(id,name,short_name), tasks:template_tasks(*)')
      .eq('is_active', true)
      .or(`work_type_id.eq.${workTypeId},work_type_id.is.null`)
      .order('name')
    if (error) throw error
    return ((data ?? []) as unknown as TemplateWithTasks[]).map((t) => ({
      ...t,
      tasks: [...(t.tasks ?? [])].sort((a, b) => a.order_index - b.order_index),
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
