import type { TaskStatus } from '@/data/types/database'

/**
 * Qué trabajo cuelga de cada hito.
 *
 * Un hito es una fecha que hay que cumplir —depósito, defensa, envío de un
 * artículo— y desde la migración 0035 las tareas pueden engancharse a ella. La
 * pregunta que eso permite contestar, y que antes no contestaba nadie, es la
 * única que importa delante de una fecha: **qué me queda por hacer para
 * llegar**.
 *
 * ESTÁ AQUÍ Y NO EN LA TARJETA porque son dos reglas que se olvidan al
 * escribirlas en un `filter` dentro del JSX:
 *
 *  · las SUBTAREAS no se cuentan. Un punto de una lista de comprobación es una
 *    fila de `tasks` con `parent_task_id`, y si se contara, un hito con una
 *    tarea de diez puntos diría «11 tareas». La tarea es la unidad de trabajo;
 *    sus puntos son su detalle.
 *  · lo COMPLETADO sigue contando en el total. «2 de 5» informa; «quedan 3»
 *    sin denominador no dice si el hito está casi listo o casi vacío.
 */
export type TareaDeHito = {
  milestone_id: string | null
  parent_task_id: string | null
  status: TaskStatus
}

export type ResumenDeHito = {
  /** Tareas de primer nivel enganchadas al hito. */
  total: number
  /** De esas, las que no están completadas. */
  pendientes: number
}

export function resumenDeHito(tareas: TareaDeHito[], hitoId: string): ResumenDeHito {
  const suyas = tareas.filter((t) => t.milestone_id === hitoId && t.parent_task_id === null)
  return {
    total: suyas.length,
    pendientes: suyas.filter((t) => t.status !== 'COMPLETADA').length,
  }
}

/**
 * La frase que se enseña debajo del nombre del hito. Devuelve `null` cuando no
 * hay nada enganchado: un «0 tareas» en cada hito del trabajo es ruido, y
 * además leería como un reproche en un plan que todavía no se ha escrito.
 */
export function fraseDeHito(resumen: ResumenDeHito): string | null {
  if (resumen.total === 0) return null
  const tareas = resumen.total === 1 ? '1 tarea' : `${resumen.total} tareas`
  if (resumen.pendientes === 0) return resumen.total === 1 ? '1 tarea, hecha' : `${tareas}, todas hechas`
  if (resumen.pendientes === resumen.total) {
    return resumen.total === 1 ? '1 tarea pendiente' : `${tareas}, ninguna hecha`
  }
  return `${tareas}, ${resumen.pendientes} sin terminar`
}
