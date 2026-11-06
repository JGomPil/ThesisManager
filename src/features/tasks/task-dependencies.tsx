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
import { wouldCreateCycle } from '@/domain/plan/dependencies'

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
 */
export function TaskDependencies({
  task, siblings, workId, canManage,
}: {
  task: TaskWithAssignee
  /** Tareas del mismo trabajo, de primer nivel: candidatas a dependencia. */
  siblings: TaskWithAssignee[]
  workId: string
  canManage: boolean
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [elegida, setElegida] = React.useState('')

  const ids = React.useMemo(() => siblings.map((t) => t.id), [siblings])

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
  const porId = new Map(siblings.map((t) => [t.id, t]))

  const candidatas = siblings.filter(
    (t) =>
      t.id !== task.id &&
      !mias.some((d) => d.depends_on_task_id === t.id) &&
      !wouldCreateCycle(todas, task.id, t.id),
  )

  const descartadas = siblings.filter(
    (t) => t.id !== task.id && !mias.some((d) => d.depends_on_task_id === t.id) && wouldCreateCycle(todas, task.id, t.id),
  ).length

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
                    <span className="min-w-0 flex-1 truncate">{otra?.title ?? '(tarea no visible)'}</span>
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
              {dependientes.map((d) => porId.get(d.task_id)?.title ?? '—').join(', ')}.
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
                  {candidatas.length === 0 ? 'No hay tareas disponibles' : 'Esperar a…'}
                </option>
                {candidatas.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </Select>
              <Button type="submit" size="sm" variant="outline" loading={anadir.isPending} disabled={!elegida}>
                <Plus /> Añadir
              </Button>
            </form>
          )}

          {canManage && descartadas > 0 && (
            <p className="text-xs text-muted-foreground">
              {descartadas} tarea(s) no aparecen en la lista porque ya dependen de esta,
              directa o indirectamente: elegirlas crearía un círculo.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
