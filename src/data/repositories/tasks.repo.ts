import { supabase } from '@/lib/supabase'
import { unwrap, unwrapUpdated } from '@/data/repositories/unwrap'
import { columnasIniciales, ESTADOS_TAREA, type CardMove } from '@/domain/plan/board'
import type {
  BoardColumnRow, Database, TaskDependencyRow, TaskPriority, TaskRow, TaskStatus,
} from '@/data/types/database'

type TaskInsert = Database['public']['Tables']['tasks']['Insert']
type TaskUpdate = Database['public']['Tables']['tasks']['Update']
type BoardColumnInsert = Database['public']['Tables']['board_columns']['Insert']
type BoardColumnUpdate = Database['public']['Tables']['board_columns']['Update']

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
  /**
   * El plan de trabajo. `deleted_at is null` SIEMPRE: desde la 0025, borrar una
   * tarea es archivarla, y quien puede planificar sigue viendo las archivadas
   * en la consulta de la base de datos —hace falta para poder restaurarlas—.
   * Si este filtro se olvidara, las tareas de la papelera volverían al tablero
   * como si no se hubieran borrado.
   */
  byWork: async (workId: string): Promise<TaskWithAssignee[]> => {
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('work_id', workId)
      .is('deleted_at', null)
      .order('order_index')
      .order('created_at')
    if (error) throw error
    return (data ?? []) as unknown as TaskWithAssignee[]
  },

  /**
   * El color de una tarea (0026). `null` lo quita.
   *
   * Va aparte de `update` porque es la acción de un clic en la ficha, y no el
   * guardado de un formulario: mandar la tarea entera desde ahí pisaría
   * cualquier cosa que se estuviera editando a la vez en otra pantalla.
   */
  setColor: async (id: string, color: string | null): Promise<void> => {
    const { error } = await supabase.from('tasks').update({ color }).eq('id', id)
    if (error) throw error
  },

  /** Lo que hay en la papelera de un trabajo. Solo devuelve filas a quien planifica. */
  archived: async (workId: string): Promise<TaskWithAssignee[]> => {
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('work_id', workId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as unknown as TaskWithAssignee[]
  },

  /**
   * Borrar una tarea es ARCHIVARLA (0025). Un disparador se lleva con ella sus
   * subtareas, y restaurarla las devuelve.
   */
  archive: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  },

  restore: async (id: string): Promise<void> => {
    const { error } = await supabase.from('tasks').update({ deleted_at: null }).eq('id', id)
    if (error) throw error
  },

  /**
   * Lo justo para medir el estado de TODOS los trabajos visibles: una fila por
   * tarea de primer nivel, con tres columnas.
   *
   * POR QUÉ EXISTE
   * El resumen llamaba a `computeWorkProgress([], …)`, o sea calculaba el
   * progreso de cada trabajo con una lista de tareas VACÍA. Consecuencia: todos
   * los trabajos salían como «Sin planificación» —`totalTasks` era 0 siempre—,
   * y, mucho peor, `overdueTasks` y `blockedTasks` valían 0 también, así que
   * «Tareas atrasadas» y «Tareas bloqueadas», los dos motivos más graves de la
   * tarjeta «Necesita atención», no se mostraron nunca. La tarjeta avisaba de lo
   * único que no era verdad y callaba lo que sí.
   *
   * UNA SOLA CONSULTA, no una por trabajo: son decenas de idas y vueltas contra
   * un proyecto gratuito para pintar una tarjeta. Las subtareas se descartan en
   * SQL (`parent_task_id is null`) porque la regla del dominio solo cuenta las de
   * primer nivel, y traerlas sería traer las listas de comprobación enteras.
   *
   * No lleva filtro de trabajos: RLS ya devuelve solo las tareas de los trabajos
   * que quien pregunta puede ver.
   */
  topLevelSummary: async (): Promise<{ work_id: string; status: TaskStatus; due_date: string | null }[]> => {
    const { data, error } = await supabase
      .from('tasks')
      .select('work_id, status, due_date')
      .is('parent_task_id', null)
      // Sin esto, una tarea de la papelera seguiría contando como atrasada en
      // «Necesita atención», y no habría forma de quitarla de ahí.
      .is('deleted_at', null)
    if (error) throw error
    return (data ?? []) as { work_id: string; status: TaskStatus; due_date: string | null }[]
  },

  /** Tareas asignadas al usuario en todos sus trabajos (dashboard). */
  mine: async (userId: string): Promise<TaskWithWork[]> => {
    const { data, error } = await supabase
      .from('tasks')
      .select(`${TASK_SELECT}, work:academic_works(id,title,work_type:work_types!academic_works_work_type_id_fkey(short_name,color))`)
      .eq('assignee_id', userId)
      .is('deleted_at', null)
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
  /**
   * El estado de una tarea. `completed_at` NO se manda: lo pone y lo quita el
   * disparador `app.sync_task_completed_at` (0024), que es el único sitio donde
   * se decide. Antes lo escribía esta función, y cualquier otra vía de cambiar
   * el estado —la lista de comprobación, el tablero, una peticion a PostgREST—
   * dejaba tareas completadas sin fecha de completado: no daba error, faltaban
   * de los recuentos por fechas.
   */
  setStatus: async (id: string, status: TaskStatus): Promise<TaskRow> => {
    const patch: TaskUpdate = { status }
    const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    return data
  },

  /**
   * Guarda un orden nuevo en un conjunto de tareas hermanas.
   *
   * Recibe YA calculado lo que hay que escribir (`reorderWrites`, en
   * `domain/plan/reorder.ts`), que son solo las filas cuya posición cambia:
   * mover un punto una fila arriba son dos escrituras, no la lista entera.
   *
   * UNA PETICIÓN POR FILA, y no es un descuido. PostgREST no sabe dar un valor
   * distinto a cada fila en una sola llamada, y `upsert` —que sí lo haría— es
   * un `insert ... on conflict do update`: habría que reenviar las columnas
   * obligatorias de cada tarea (`work_id`, `title`) solo para cambiarle un
   * número, y un identificador equivocado insertaría una tarea nueva en lugar
   * de fallar. Como son unas pocas filas y van en paralelo, se queda así.
   *
   * Si alguna falla, se lanza el primer error: el orden puede quedar a medias y
   * eso es aceptable —es presentación, no datos—, pero quien lo pidió tiene que
   * enterarse de que no se ha guardado todo.
   */
  reorder: async (cambios: { id: string; order_index: number }[]): Promise<void> => {
    if (cambios.length === 0) return
    const respuestas = await Promise.all(
      cambios.map(({ id, order_index }) =>
        supabase.from('tasks').update({ order_index }).eq('id', id)),
    )
    const fallo = respuestas.find((r) => r.error)
    if (fallo?.error) throw fallo.error
  },

  /**
   * Aplica un movimiento del tablero: lo que devuelve `planCardMove`.
   *
   * Una petición por fila, por lo mismo que `reorder`: PostgREST no sabe dar un
   * valor distinto a cada fila en una sola llamada. Son pocas —la tarjeta
   * movida y, si acaso, las de su columna de destino que cambian de sitio—,
   * así que van en paralelo.
   *
   * El estado NO se manda cuando la columna destino es del catálogo: lo deriva
   * el disparador `app.sync_task_board_column()` de la 0024, que es el único
   * sitio donde se decide. Mandarlo también desde aquí sería tener dos
   * opiniones sobre el mismo dato.
   */
  applyBoardMoves: async (movimientos: CardMove[]): Promise<void> => {
    if (movimientos.length === 0) return
    const respuestas = await Promise.all(
      movimientos.map(({ id, ...patch }) => supabase.from('tasks').update(patch).eq('id', id)),
    )
    const fallo = respuestas.find((r) => r.error)
    if (fallo?.error) throw fallo.error
  },

  // ---------------------------------------------------------------------------
  // Columnas del tablero (migración 0024)
  // ---------------------------------------------------------------------------
  /**
   * Las columnas de UN trabajo. Están aquí y no en `catalogs.repo` porque no
   * son un catálogo del grupo: son parte del plan de trabajo, como los hitos y
   * las fases, y las administra quien dirige ese trabajo.
   *
   * Lista vacía no es un error ni un estado a medias: es lo que tiene un
   * trabajo que no ha creado columnas, y entonces el tablero agrupa por estado
   * como siempre (`resolveBoard`).
   */
  boardColumns: async (workId: string): Promise<BoardColumnRow[]> =>
    unwrap(
      await supabase
        .from('board_columns')
        .select('*')
        .eq('work_id', workId)
        .order('display_order')
        .order('name'),
    ),

  createBoardColumn: async (input: BoardColumnInsert): Promise<BoardColumnRow> =>
    unwrap(await supabase.from('board_columns').insert(input).select('*').single()),

  // `unwrapUpdated` y no `.single()`: a un UPDATE al que la política le
  // descarta las filas, PostgreSQL no le da error. Sin esto, quien no puede
  // tocar la columna vería que «se ha guardado» y al recargar seguiría igual.
  updateBoardColumn: async (id: string, patch: BoardColumnUpdate): Promise<BoardColumnRow> =>
    unwrapUpdated(
      await supabase.from('board_columns').update(patch).eq('id', id).select('*').maybeSingle(),
      'esta columna del tablero',
    ),

  removeBoardColumn: async (id: string): Promise<void> => {
    const { error } = await supabase.from('board_columns').delete().eq('id', id)
    if (error) throw error
  },

  reorderBoardColumns: async (cambios: { id: string; display_order: number }[]): Promise<void> => {
    if (cambios.length === 0) return
    const respuestas = await Promise.all(
      cambios.map(({ id, display_order }) =>
        supabase.from('board_columns').update({ display_order }).eq('id', id)),
    )
    const fallo = respuestas.find((r) => r.error)
    if (fallo?.error) throw fallo.error
  },

  /**
   * Crea el primer tablero de un trabajo: «Por hacer», «En curso» y «Hecho».
   *
   * Y COLOCA LAS TAREAS QUE YA EXISTÍAN, cada una según el estado que tiene en
   * ese momento (lo reparte `columnasIniciales`, en el dominio). Dejarlas todas
   * en la primera columna sería tirar información que ya se tenía y obligar a
   * recolocar a mano un plan entero.
   *
   * Es la ÚNICA vez que el estado decide una columna. A partir de aquí son dos
   * clasificaciones independientes: mover una tarjeta no cambia el estado, y
   * renombrar una columna no significa nada para la aplicación.
   */
  seedBoardColumns: async (
    workId: string, tareas: { id: string; status: TaskStatus }[],
  ): Promise<BoardColumnRow[]> => {
    const plantilla = columnasIniciales()
    const filas = unwrap(
      await supabase
        .from('board_columns')
        .insert(plantilla.map((c, i) => ({
          work_id: workId, name: c.name, color: c.color, display_order: i,
        })))
        .select('*'),
    )

    const destino = new Map<string, string>()
    plantilla.forEach((c) => {
      const fila = filas.find((f) => f.name === c.name)
      if (fila) c.estados.forEach((e) => destino.set(e, fila.id))
    })

    const colocaciones = tareas
      .map((t) => ({ id: t.id, board_column_id: destino.get(t.status) }))
      .filter((x): x is { id: string; board_column_id: string } => x.board_column_id !== undefined)
    if (colocaciones.length > 0) {
      const respuestas = await Promise.all(
        colocaciones.map((c) =>
          supabase.from('tasks').update({ board_column_id: c.board_column_id }).eq('id', c.id)),
      )
      const fallo = respuestas.find((r) => r.error)
      if (fallo?.error) throw fallo.error
    }
    return filas
  },

  /**
   * BORRADO DEFINITIVO, el de verdad: arrastra en cascada las subtareas, las
   * dependencias y los comentarios de la tarea. Se llama desde la papelera y
   * nada más; el icono de la tarjeta archiva (`archive`), que es lo que se
   * espera de un icono que se pulsa sin pensar.
   */
  destroy: async (id: string): Promise<void> => {
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

/**
 * Los cinco estados con su nombre y su color.
 *
 * La lista vive en el dominio (`domain/plan/board.ts`) porque desde la 0024 es
 * también el tablero por defecto: una organización que no configura columnas ve
 * una por estado. Se reexporta con el nombre de siempre para no renombrar los
 * cuatro sitios que la usan para pintar una pastilla.
 */
export const TASK_STATUSES = ESTADOS_TAREA

export const TASK_PRIORITIES: { value: TaskPriority; label: string; tone: string }[] = [
  { value: 'BAJA', label: 'Baja', tone: 'slate' },
  { value: 'MEDIA', label: 'Media', tone: 'sky' },
  { value: 'ALTA', label: 'Alta', tone: 'orange' },
  { value: 'URGENTE', label: 'Urgente', tone: 'red' },
]
