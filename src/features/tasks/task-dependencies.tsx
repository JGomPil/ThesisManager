import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitBranch, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { ToneBadge } from '@/components/ui/badge'
import { Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { tasksRepo, TASK_STATUSES, type TaskWithAssignee } from '@/data/repositories/tasks.repo'
import { motivoSinCandidatas, wouldCreateCycle } from '@/domain/plan/dependencies'

/**
 * Dependencias de una tarea: de qué otras tareas hay que esperar.
 *
 * El desplegable NO ofrece las opciones que crearían un ciclo. La comprobación
 * es la misma que hace el disparador `app.assert_no_dependency_cycle`, pero
 * aquí sirve para otra cosa: que la opción imposible no esté a la vista. Si la
 * comprobación del cliente se equivocara y ofreciera una opción mala, la base
 * de datos la rechazaría con un mensaje claro. Al contrario no funciona: una
 * interfaz prudente no impide que alguien hable con PostgREST directamente, y
 * por eso la regla de verdad está en la migración 0012.
 *
 * Una dependencia no bloquea nada: es información. En un trabajo académico el
 * orden previsto cambia cada mes, y una aplicación que se negara a dejar
 * avanzar una tarea «porque el plan dice que todavía no» acabaría con la gente
 * borrando las dependencias para poder trabajar.
 *
 * LAS SUBTAREAS TAMBIÉN SE PUEDEN ELEGIR. Antes solo se ofrecían las tareas de
 * primer nivel, y era una limitación de esta pantalla y de nadie más: el
 * disparador `taskdeps_same_work` exige que las dos tareas sean del mismo
 * TRABAJO, no del mismo nivel. Y es una espera que se da: «no empiezo a
 * redactar hasta que esté el punto “figuras definitivas” de la tarea de
 * análisis». En la lista van con el nombre de su tarea delante, porque una
 * subtarea suelta entre tareas de primer nivel no se distingue.
 *
 * NO SE OFRECEN la propia tarea, sus propias subtareas ni la tarea de la que
 * esta es subtarea: una tarea no se termina hasta que sus subtareas están
 * hechas, así que esas esperas ya están dichas por la jerarquía, y añadirlas
 * solo ensucia el cronograma.
 *
 * Y CUANDO NO HAY NADA QUE OFRECER, SE DICE POR QUÉ. Un desplegable
 * deshabilitado que pone «No hay tareas disponibles» es una puerta cerrada sin
 * cartel: faltan tareas, ya están todas elegidas o las que quedan harían un
 * círculo, y cada cosa se arregla de manera distinta. El motivo lo decide
 * `motivoSinCandidatas`, que está probado.
 */
export function TaskDependencies({
  task, tasks, workId, canManage,
}: {
  task: TaskWithAssignee
  /** TODAS las tareas del trabajo, subtareas incluidas. */
  tasks: TaskWithAssignee[]
  workId: string
  canManage: boolean
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [elegida, setElegida] = React.useState('')

  const ids = React.useMemo(() => tasks.map((t) => t.id), [tasks])

  const deps = useQuery({
    queryKey: qk.dependencies.byTasks(workId),
    queryFn: () => tasksRepo.dependencies(ids),
    enabled: ids.length > 0,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.dependencies.byTasks(workId) })

  const anadir = useMutation({
    mutationFn: (dependsOn: string) => tasksRepo.addDependency(task.id, dependsOn),
    onSuccess: () => { void invalidate(); setElegida('') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const quitar = useMutation({
    mutationFn: (dependsOn: string) => tasksRepo.removeDependency(task.id, dependsOn),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const todas = deps.data ?? []
  const mias = todas.filter((d) => d.task_id === task.id)
  const dependientes = todas.filter((d) => d.depends_on_task_id === task.id)
  const porId = new Map(tasks.map((t) => [t.id, t]))

  /** «Análisis › Figuras definitivas» para una subtarea; el título, si no lo es. */
  const etiqueta = (t: TaskWithAssignee) => {
    const padre = t.parent_task_id === null ? null : porId.get(t.parent_task_id)
    return padre ? `${padre.title} › ${t.title}` : t.title
  }

  const yaDepende = (id: string) => mias.some((d) => d.depends_on_task_id === id)

  // Lo que tiene sentido ofrecer, antes de descartar por dependencia o ciclo.
  const elegibles = tasks.filter(
    (t) => t.id !== task.id && t.parent_task_id !== task.id && t.id !== task.parent_task_id,
  )
  const candidatas = elegibles.filter(
    (t) => !yaDepende(t.id) && !wouldCreateCycle(todas, task.id, t.id),
  )
  const motivo = motivoSinCandidatas({
    otras: elegibles.length,
    yaDependen: elegibles.filter((t) => yaDepende(t.id)).length,
    ciclo: elegibles.filter((t) => !yaDepende(t.id) && wouldCreateCycle(todas, task.id, t.id)).length,
  })

  const CARTEL: Record<NonNullable<typeof motivo>, { corto: string; largo: string }> = {
    SOLA: {
      corto: 'No hay otras tareas',
      largo: 'Es la única tarea del plan, así que no hay nada a lo que esperar. Crea alguna más y vuelve aquí.',
    },
    YA_TODAS: {
      corto: 'Ya espera a todas',
      largo: 'Esta tarea ya espera a todas las demás del plan.',
    },
    CICLO: {
      corto: 'Crearían un círculo',
      largo: 'Las demás ya dependen de esta, directa o indirectamente, así que elegirlas crearía un círculo: A espera a B y B espera a A. Para invertir el orden, quita primero la dependencia contraria.',
    },
    MEZCLA: {
      corto: 'No queda ninguna',
      largo: 'Las que faltan, o ya son dependencia de esta, o crearían un círculo.',
    },
  }

  return (
    <section className="border-t pt-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <GitBranch className="size-3.5" /> Dependencias
      </h3>

      {deps.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          {mias.length === 0 ? (
            <p className="text-sm text-muted-foreground">Esta tarea no espera a ninguna otra.</p>
          ) : (
            <ul className="space-y-1">
              {mias.map((d) => {
                const otra = porId.get(d.depends_on_task_id)
                const estado = TASK_STATUSES.find((s) => s.value === otra?.status)
                return (
                  <li key={d.depends_on_task_id} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Espera a</span>
                    <span className="min-w-0 flex-1 break-words">
                      {otra ? etiqueta(otra) : '(tarea no visible)'}
                    </span>
                    {estado && <ToneBadge tone={estado.tone}>{estado.label}</ToneBadge>}
                    {canManage && (
                      <Button
                        variant="ghost" size="icon" className="size-7"
                        onClick={() => quitar.mutate(d.depends_on_task_id)}
                        aria-label="Quitar la dependencia"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {dependientes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {dependientes.length} tarea(s) esperan a esta:{' '}
              {dependientes.map((d) => {
                const otra = porId.get(d.task_id)
                return otra ? etiqueta(otra) : '—'
              }).join(', ')}.
            </p>
          )}

          {canManage && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (elegida) anadir.mutate(elegida)
              }}
            >
              <Select
                value={elegida}
                onChange={(e) => setElegida(e.target.value)}
                aria-label="Tarea de la que depende"
                className="min-w-[10rem] flex-1"
                disabled={candidatas.length === 0}
              >
                <option value="">
                  {motivo ? CARTEL[motivo].corto : 'Esperar a…'}
                </option>
                {candidatas.map((t) => (
                  <option key={t.id} value={t.id}>{etiqueta(t)}</option>
                ))}
              </Select>
              <Button type="submit" size="sm" variant="outline" loading={anadir.isPending} disabled={!elegida}>
                <Plus /> Añadir
              </Button>
            </form>
          )}

          {/* El motivo va aquí, justo debajo del desplegable que no se puede
              usar, y no al final de la sección: es donde se mira cuando algo
              no responde. */}
          {canManage && motivo && (
            <p className="text-xs text-muted-foreground">{CARTEL[motivo].largo}</p>
          )}
        </div>
      )}
    </section>
  )
}
