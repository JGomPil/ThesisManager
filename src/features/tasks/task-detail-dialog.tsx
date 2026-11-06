import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ListChecks, MessageSquare, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react'
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
import { DocumentsCard } from '@/features/documents/documents-card'
import { CommentsThread } from '@/features/comments/comments-thread'
import { TaskDependencies } from '@/features/tasks/task-dependencies'
import { TaskReferenceMaterial } from '@/features/tasks/task-reference-material'
import type { WorkMemberWithRole } from '@/data/repositories/works.repo'
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
  task, subtasks, siblings, open, onOpenChange, onEdit, caps, userId, workId, members,
}: {
  task: TaskWithAssignee | null
  subtasks: TaskWithAssignee[]
  /** Tareas de primer nivel del trabajo: candidatas a dependencia. */
  siblings: TaskWithAssignee[]
  open: boolean
  onOpenChange: (v: boolean) => void
  /**
   * Abre el formulario de edición. Lo gestiona el tablero, no esta ficha:
   * cierra este diálogo y abre el otro, en lugar de apilar dos modales —que en
   * un teléfono deja la mitad de la pantalla inservible y atrapa el foco.
   */
  onEdit: () => void
  caps: WorkCapabilities
  userId: string | null
  workId: string
  /** Participantes activos del trabajo: hacen falta para elegir a quién mencionar. */
  members: WorkMemberWithRole[]
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
                {caps.canManagePlan && 'Pulsa «Editar» para explicar en qué consiste.'}
              </p>
            )}
          </section>

          {/* Las fechas se LEEN aquí y se cambian en «Editar». Durante un tiempo
              solo se podían poner al crear la tarea, que es tanto como no
              poder ponerlas: en un plan académico la fecha de una tarea es lo
              que más cambia. */}
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

          {/* El material de la plantilla va ANTES de la lista de comprobación:
              se lee el guion y después se van marcando los puntos. */}
          {task.template_task_id && (
            <TaskReferenceMaterial templateTaskId={task.template_task_id} />
          )}

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

          {task.parent_task_id === null && (
            <TaskDependencies
              task={task}
              siblings={siblings}
              workId={workId}
              canManage={caps.canManagePlan}
            />
          )}

          <section className="border-t pt-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Paperclip className="size-3.5" /> Documentos de esta tarea
            </h3>
            {/* Los documentos pertenecen al trabajo; aquí se filtran los
                vinculados a esta tarea. Añadir uno desde aquí lo vincula
                automáticamente, que es lo que se espera al estar dentro. */}
            <DocumentsCard workId={workId} caps={caps} userId={userId} taskId={task.id} />
          </section>

          <section className="border-t pt-3">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <MessageSquare className="size-3.5" /> Comentarios
            </h3>
            <CommentsThread
              workId={workId}
              entityType="TASK"
              entityId={task.id}
              members={members}
              userId={userId}
              canComment={members.some((m) => m.user_id === userId)}
            />
          </section>
        </div>

        <DialogFooter className="sm:justify-between">
          {canTick && task.status !== 'COMPLETADA' ? (
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate('COMPLETADA')}
            >
              <Check /> Marcar como completada
            </Button>
          ) : (
            // En un teléfono el hueco vacío ocuparía una fila entera del pie.
            <span className="hidden sm:block" />
          )}
          <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
            {caps.canManagePlan && (
              <Button variant="outline" onClick={onEdit}>
                <Pencil /> Editar
              </Button>
            )}
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
