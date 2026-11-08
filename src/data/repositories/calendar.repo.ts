import { supabase } from '@/lib/supabase'
import { collectEvents, type CalendarEvent } from '@/domain/plan/calendar'

/**
 * Eventos del calendario en un intervalo de días.
 *
 * Tres consultas, no una vista: una vista tendría que unir tareas, hitos y
 * reuniones, y una vista en PostgreSQL **no hereda la RLS de las tablas que
 * une** salvo que se declare `security_invoker`. Una vista mal declarada aquí
 * sería un agujero silencioso que enseñaría el calendario de todo el grupo a
 * cualquiera. Tres consultas a tres tablas con sus políticas puestas no tienen
 * ese problema, y en este volumen de datos la diferencia de coste no se nota.
 *
 * El criterio de aceptación de la fase —«cada usuario ve en el calendario solo
 * los eventos de sus trabajos»— lo cumplen por tanto `tasks_select`,
 * `milestones_select` y `meetings_select`, que ya filtran por
 * `app.accessible_work_ids()`. Aquí no hay ni un filtro de permisos.
 */
export const calendarRepo = {
  events: async (from: string, to: string): Promise<CalendarEvent[]> => {
    const [tasks, meetings, milestones] = await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, work_id, status, start_date, due_date, work:academic_works(title)')
        .is('parent_task_id', null)
        // Lo archivado no es un evento: una tarea en la papelera no vence.
        .is('deleted_at', null)
        .or(
          `and(due_date.gte.${from},due_date.lte.${to}),` +
            `and(start_date.gte.${from},start_date.lte.${to})`,
        )
        .limit(500),
      supabase
        .from('meetings')
        .select('id, title, work_id, scheduled_at, work:academic_works(title)')
        .gte('scheduled_at', `${from}T00:00:00Z`)
        .lte('scheduled_at', `${to}T23:59:59Z`)
        .limit(300),
      supabase
        .from('milestones')
        .select('id, name, work_id, due_date, is_met, work:academic_works(title)')
        .gte('due_date', from)
        .lte('due_date', to)
        .limit(300),
    ])

    if (tasks.error) throw tasks.error
    if (meetings.error) throw meetings.error
    if (milestones.error) throw milestones.error

    return collectEvents({
      tasks: (tasks.data ?? []) as never,
      meetings: (meetings.data ?? []) as never,
      milestones: (milestones.data ?? []) as never,
    })
  },
}
