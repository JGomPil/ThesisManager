import { supabase } from '@/lib/supabase'
import type {
  Database, TaskDependencyRow, TaskPriority, TaskRow, TaskStatus,
} from '@/data/types/database'

type TaskInsert = Database['public']['Tables']['tasks']['Insert']
type TaskUpdate = Database['public']['Tables']['tasks']['Update']

// `tasks` apunta a `profiles` por `assignee_id` y por `created_by`: sin la pista
// explícita PostgREST responde HTTP 300 PGRST201 y el tablero se queda vacío.
// Ver la nota de works.repo.ts y scripts/check-embeds.sh.
const TASK_SELECT = `*, assignee:profiles!tasks_assignee_id_fkey(id,full_name,avatar_url)`

export type TaskWithAssignee = TaskRow & {
  assignee: { id: string; full_name: string; avatar_url: string | null } | null
}

export type TaskWithWork = TaskWithAssignee & {
  work: { id: string; title: string; work_type: { short_name: string; color: string } | null } | null
}

export const tasksRepo = {
  byWork: async (workId: string): Promise<TaskWithAssignee[]> => {
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('work_id', workId)
      .order('order_index')
      .order('created_at')
    if (error) throw error
    return (data ?? []) as unknown as TaskWithAssignee[]
  },

  /** Tareas asignadas al usuario en todos sus trabajos (dashboard). */
  mine: async (userId: string): Promise<TaskWithWork[]> => {
    const { data, error } = await supabase
      .from('tasks')
      .select(`${TASK_SELECT}, work:academic_works(id,title,work_type:work_types!academic_works_work_type_id_fkey(short_name,color))`)
      .eq('assignee_id', userId)
      .neq('status', 'COMPLETADA')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(50)
    if (error) throw error
    return (data ?? []) as unknown as TaskWithWork[]
  },

  create: async (input: TaskInsert): Promise<TaskRow> => {
    const { data, error } = await supabase.from('tasks').insert(input).select('*').single()
    if (error) throw error
    return data
  },

  update: async (id: string, patch: TaskUpdate): Promise<TaskRow> => {
    const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  /**
   * Cambio de estado. Es la única modificación que un estudiante puede hacer
   * sobre su tarea: el trigger `enforce_task_update_scope` rechaza cualquier
   * otra columna si no tiene can_manage_plan. Por eso va en su propio método.
   */
  setStatus: async (id: string, status: TaskStatus): Promise<TaskRow> => {
    const patch: TaskUpdate = {
      status,
      completed_at: status === 'COMPLETADA' ? new Date().toISOString() : null,
    }
    const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  remove: async (id: string): Promise<void> => {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Dependencias de un conjunto de tareas.
   *
   * Recibe los identificadores en lugar del trabajo, y no es por comodidad:
   * `task_dependencies` apunta DOS veces a `tasks`, así que cualquier embed
   * suyo necesitaría una pista explícita y devolvería filas anidadas que no
   * hacen falta. Como la pantalla ya tiene cargadas las tareas, filtrar por
   * `task_id` es una consulta plana y una ida y vuelta menos.
   *
   * Basta mirar `task_id`: la migración 0012 garantiza que las dos tareas de
   * una dependencia son del mismo trabajo (prueba `[79]`), así que no hay
   * aristas que se escapen por el otro extremo.
   */
  dependencies: async (taskIds: string[]): Promise<TaskDependencyRow[]> => {
    if (taskIds.length === 0) return []
    const { data, error } = await supabase
      .from('task_dependencies')
      .select('task_id, depends_on_task_id')
      .in('task_id', taskIds)
    if (error) throw error
    return data ?? []
  },

  addDependency: async (taskId: string, dependsOnTaskId: string): Promise<void> => {
    const { error } = await supabase
      .from('task_dependencies')
      .insert({ task_id: taskId, depends_on_task_id: dependsOnTaskId })
    if (error) throw error
  },

  removeDependency: async (taskId: string, dependsOnTaskId: string): Promise<void> => {
    const { error } = await supabase
      .from('task_dependencies')
      .delete()
      .eq('task_id', taskId)
      .eq('depends_on_task_id', dependsOnTaskId)
    if (error) throw error
  },
}

export const TASK_STATUSES: { value: TaskStatus; label: string; tone: string }[] = [
  { value: 'PENDIENTE', label: 'Pendiente', tone: 'slate' },
  { value: 'EN_CURSO', label: 'En curso', tone: 'blue' },
  { value: 'BLOQUEADA', label: 'Bloqueada', tone: 'red' },
  { value: 'EN_REVISION', label: 'En revisión', tone: 'amber' },
  { value: 'COMPLETADA', label: 'Completada', tone: 'green' },
]

export const TASK_PRIORITIES: { value: TaskPriority; label: string; tone: string }[] = [
  { value: 'BAJA', label: 'Baja', tone: 'slate' },
  { value: 'MEDIA', label: 'Media', tone: 'sky' },
  { value: 'ALTA', label: 'Alta', tone: 'orange' },
  { value: 'URGENTE', label: 'Urgente', tone: 'red' },
]
