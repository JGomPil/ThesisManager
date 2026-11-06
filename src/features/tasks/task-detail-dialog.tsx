import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ListChecks, Plus, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToneBadge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/supabase'
import {
  TASK_PRIORITIES, TASK_STATUSES, tasksRepo, type TaskWithAssignee,
} from '@/data/repositories/tasks.repo'
import { daysUntil } from '@/domain/works/progress'
import { canUpdateTaskStatus } from '@/domain/permissions/work-capabilities'
import type { WorkCapabilities } from '@/domain/permissions/work-capabilities'

/**
 * Ficha de una tarea: lo que no cabía en el tablero.
 *
 * El tablero muestra título, prioridad y responsable, que es lo justo para
 * decidir a qué atender; pero sin poder abrir la tarea no había forma de leer
 * en qué consiste, que es su información más importante. La descripción se
 * guardaba y no se mostraba en ningún sitio.
 *
 * LA LISTA DE COMPROBACIÓN son subtareas reales (`tasks.parent_task_id`), no un
 * campo de texto ni un jsonb. Esa decisión tiene consecuencias deliberadas:
 *
 *  - Cada punto puede tener responsable y fecha propios si hace falta, y
 *    aparece en «mis tareas» de quien lo tenga asignado.
 *  - Hereda la seguridad de `tasks` sin añadir ni una política: un estudiante
 *    puede MARCAR puntos (es un cambio de `status`, lo único que el disparador
 *    `enforce_task_update_scope` le permite) pero no puede añadirlos ni
 *    borrarlos. Es exactamente el reparto que queremos: la dirección define el
 *    plan, el estudiante informa de su avance.
 *  - El progreso de la tarea sale del recuento de puntos completados, sin
 *    ningún campo que pueda quedar desincronizado.
 */
export function TaskDetailDialog({
  task, subtasks, open, onOpenChange, caps, userId, workId,
}: {
  task: TaskWithAssignee | null
  subtasks: TaskWithAssignee[]
  open: boolean
  onOpenChange: (v: boolean) => void
  caps: WorkCapabilities
  userId: string | null
  workId: string
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [newItem, setNewItem] = React.useState('')

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.tasks.byWork(workId) })
    void qc.invalidateQueries({ queryKey: qk.tasks.mine })
  }

  const addItem = useMutation({
    mutationFn: (title: string) =>
      tasksRepo.create({ work_id: workId, parent_task_id: task!.id, title, created_by: userId }),
    onSuccess: () => { invalidate(); setNewItem('') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const toggleItem = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      tasksRepo.setStatus(id, done ? 'COMPLETADA' : 'PENDIENTE'),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const removeItem = useMutation({
    mutationFn: (id: string) => tasksRepo.remove(id),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const setStatus = useMutation({
    mutationFn: (status: TaskWithAssignee['status']) => tasksRepo.setStatus(task!.id, status),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (!task) return null

  const priority = TASK_PRIORITIES.find((p) => p.value === task.priority)
  const status = TASK_STATUSES.find((s) => s.value === task.status)
  const late = task.due_date !== null && task.status !== 'COMPLETADA' && (daysUntil(task.due_date) ?? 0) < 0
  const done = subtasks.filter((s) => s.status === 'COMPLETADA').length
  const canTick = canUpdateTaskStatus(caps, task, userId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{task.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <ToneBadge tone={status?.tone ?? null}>{status?.label}</ToneBadge>
            <ToneBadge tone={priority?.tone ?? null}>{priority?.label}</ToneBadge>
            {task.assignee && <span className="text-xs">· {task.assignee.full_name}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              En qué consiste
            </h3>
            {task.description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{task.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sin descripción.{' '}
                {caps.canManagePlan && 'Edita la tarea para explicar en qué consiste.'}
              </p>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Inicio</p>
              <p>{task.start_date ? format(parseISO(task.start_date), 'd MMM yyyy', { locale: es }) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fecha límite</p>
              <p className={late ? 'font-medium text-destructive' : undefined}>
                {task.due_date ? format(parseISO(task.due_date), 'd MMM yyyy', { locale: es }) : '—'}
                {late && ' (vencida)'}
              </p>
            </div>
          </section>

          <section className="border-t pt-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <ListChecks className="size-3.5" />
              Lista de comprobación
              {subtasks.length > 0 && (
                <span className="tabular-nums normal-case">{done}/{subtasks.length}</span>
              )}
            </h3>

            {subtasks.length > 0 && (
              <>
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.round((done / subtasks.length) * 100)}%` }}
                  />
                </div>
                <ul className="space-y-1">
                  {subtasks.map((s) => {
                    const checked = s.status === 'COMPLETADA'
                    return (
                      <li key={s.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={!canTick || toggleItem.isPending}
                          onClick={() => toggleItem.mutate({ id: s.id, done: !checked })}
                          aria-label={checked ? 'Desmarcar' : 'Marcar como hecho'}
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                            checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                            !canTick && 'cursor-not-allowed opacity-50',
                          )}
                        >
                          {checked && <Check className="size-3" />}
                        </button>
                        <span className={cn('min-w-0 flex-1 truncate text-sm', checked && 'text-muted-foreground line-through')}>
                          {s.title}
                        </span>
                        {caps.canManagePlan && (
                          <Button
                            variant="ghost" size="icon" className="size-6"
                            onClick={() => removeItem.mutate(s.id)}
                            aria-label="Quitar punto"
                          >
                            <X className="size-3" />
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            {caps.canManagePlan ? (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const t = newItem.trim()
                  if (t.length >= 2) addItem.mutate(t)
                }}
              >
                <Input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  placeholder="Añadir un punto…"
                  aria-label="Nuevo punto de la lista"
                />
                <Button type="submit" size="sm" variant="outline" loading={addItem.isPending}>
                  <Plus /> Añadir
                </Button>
              </form>
            ) : (
              subtasks.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  La dirección no ha definido ninguna lista de comprobación para esta tarea.
                </p>
              )
            )}

            {subtasks.length > 0 && !canTick && (
              <p className="mt-2 text-xs text-muted-foreground">
                Solo puede marcar los puntos quien tenga la tarea asignada, o la dirección.
              </p>
            )}
          </section>
        </div>

        <DialogFooter className="sm:justify-between">
          {canTick && task.status !== 'COMPLETADA' ? (
            <Button
              variant="outline"
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate('COMPLETADA')}
            >
              <Check /> Marcar la tarea como completada
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            {caps.canManagePlan && (
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm(`¿Eliminar la tarea «${task.title}»?${subtasks.length > 0 ? ` Se eliminarán también sus ${subtasks.length} punto(s) de la lista.` : ''}`)) {
                    tasksRepo.remove(task.id).then(() => { invalidate(); onOpenChange(false) })
                      .catch((e) => toast.push('error', errorMessage(e)))
                  }
                }}
              >
                <Trash2 /> Eliminar
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
