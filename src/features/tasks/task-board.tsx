import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KanbanSquare, List, ListChecks, Plus, Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState, ErrorPanel, FieldError, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { TASK_PRIORITIES, TASK_STATUSES, tasksRepo, type TaskWithAssignee } from '@/data/repositories/tasks.repo'
import type { TaskStatus } from '@/data/types/database'
import type { WorkWithRelations } from '@/data/repositories/works.repo'
import { taskFormSchema, type TaskFormValues } from '@/schemas/work'
import { canUpdateTaskStatus, type WorkCapabilities } from '@/domain/permissions/work-capabilities'
import { daysUntil } from '@/domain/works/progress'
import { cn } from '@/lib/utils'
import { TaskDetailDialog } from '@/features/tasks/task-detail-dialog'

export function TaskBoard({
  work,
  caps,
  userId,
}: {
  work: WorkWithRelations
  caps: WorkCapabilities
  userId: string | null
}) {
  const [view, setView] = React.useState<'kanban' | 'list'>('kanban')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const tasks = useQuery({ queryKey: qk.tasks.byWork(work.id), queryFn: () => tasksRepo.byWork(work.id) })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.tasks.byWork(work.id) })
    void qc.invalidateQueries({ queryKey: qk.tasks.mine })
  }

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => tasksRepo.setStatus(id, status),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => tasksRepo.remove(id),
    onSuccess: () => { invalidate(); toast.push('success', 'Tarea eliminada.') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (tasks.isLoading) return <LoadingPanel label="Cargando tareas…" />
  if (tasks.isError) return <ErrorPanel error={tasks.error} />

  const all = tasks.data ?? []

  // `byWork` devuelve también las subtareas (los puntos de las listas de
  // comprobación). El tablero muestra solo las tareas de primer nivel; si no se
  // filtrasen, cada punto aparecería además como una tarjeta suelta. Se agrupan
  // aquí, en memoria, en lugar de pedirlas en una segunda consulta: ya están
  // todas descargadas y así el recuento del progreso es siempre coherente con
  // lo que se ve.
  const rows = all.filter((t) => t.parent_task_id === null)
  const subtasksOf = (id: string) => all.filter((t) => t.parent_task_id === id)
  const openTask = rows.find((t) => t.id === openTaskId) ?? null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button
            variant={view === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('kanban')}
          >
            <KanbanSquare /> Kanban
          </Button>
          <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('list')}>
            <List /> Lista
          </Button>
        </div>

        {caps.canManagePlan && (
          <Button size="sm" onClick={() => setDialogOpen(true)}><Plus /> Nueva tarea</Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Sin tareas todavía"
          description={
            caps.canManagePlan
              ? 'Crea las tareas del plan de trabajo. Más adelante podrás partir de una plantilla por tipo de trabajo.'
              : 'Cuando la dirección planifique el trabajo, verás aquí tus tareas.'
          }
          action={caps.canManagePlan && <Button size="sm" onClick={() => setDialogOpen(true)}><Plus /> Nueva tarea</Button>}
        />
      ) : view === 'kanban' ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {TASK_STATUSES.map((col) => {
            const colTasks = rows.filter((t) => t.status === col.value)
            return (
              <div key={col.value} className="flex min-w-0 flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                  <ToneBadge tone={col.tone}>{col.label}</ToneBadge>
                  <span className="text-xs tabular-nums text-muted-foreground">{colTasks.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {colTasks.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      subtasks={subtasksOf(t.id)}
                      caps={caps}
                      userId={userId}
                      onOpen={() => setOpenTaskId(t.id)}
                      onStatus={(status) => setStatus.mutate({ id: t.id, status })}
                      onRemove={() => remove.mutate(t.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarea</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Fecha límite</TableHead>
                <TableHead>Estado</TableHead>
                {caps.canManagePlan && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const late = t.due_date !== null && t.status !== 'COMPLETADA' && (daysUntil(t.due_date) ?? 0) < 0
                const priority = TASK_PRIORITIES.find((p) => p.value === t.priority)
                return (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-[20rem]">
                      <button
                        type="button"
                        onClick={() => setOpenTaskId(t.id)}
                        className="text-left font-medium underline-offset-2 hover:underline"
                      >
                        {t.title}
                      </button>
                      {t.description && <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">{t.description}</span>}
                      {subtasksOf(t.id).length > 0 && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <ListChecks className="size-3" />
                          {subtasksOf(t.id).filter((x) => x.status === 'COMPLETADA').length}/{subtasksOf(t.id).length}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.assignee?.full_name ?? '—'}</TableCell>
                    <TableCell><ToneBadge tone={priority?.tone ?? null}>{priority?.label}</ToneBadge></TableCell>
                    <TableCell className={cn('text-sm', late ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                      {t.due_date ? format(parseISO(t.due_date), 'd MMM yyyy', { locale: es }) : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusSelect
                        task={t}
                        caps={caps}
                        userId={userId}
                        onChange={(status) => setStatus.mutate({ id: t.id, status })}
                      />
                    </TableCell>
                    {caps.canManagePlan && (
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => remove.mutate(t.id)} aria-label="Eliminar tarea">
                          <Trash2 />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      <TaskDetailDialog
        task={openTask}
        subtasks={openTask ? subtasksOf(openTask.id) : []}
        open={openTaskId !== null}
        onOpenChange={(v) => { if (!v) setOpenTaskId(null) }}
        caps={caps}
        userId={userId}
        workId={work.id}
      />


      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        work={work}
        onCreated={invalidate}
      />
    </div>
  )
}

function StatusSelect({
  task, caps, userId, onChange,
}: {
  task: TaskWithAssignee
  caps: WorkCapabilities
  userId: string | null
  onChange: (status: TaskStatus) => void
}) {
  const allowed = canUpdateTaskStatus(caps, task, userId)
  if (!allowed) {
    const s = TASK_STATUSES.find((x) => x.value === task.status)
    return <ToneBadge tone={s?.tone ?? null}>{s?.label}</ToneBadge>
  }
  return (
    <Select
      value={task.status}
      onChange={(e) => onChange(e.target.value as TaskStatus)}
      className="h-8 w-[10.5rem] text-xs"
      aria-label="Estado de la tarea"
    >
      {TASK_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </Select>
  )
}

function TaskCard({
  task, subtasks, caps, userId, onOpen, onStatus, onRemove,
}: {
  task: TaskWithAssignee
  subtasks: TaskWithAssignee[]
  caps: WorkCapabilities
  userId: string | null
  onOpen: () => void
  onStatus: (status: TaskStatus) => void
  onRemove: () => void
}) {
  const late = task.due_date !== null && task.status !== 'COMPLETADA' && (daysUntil(task.due_date) ?? 0) < 0
  const priority = TASK_PRIORITIES.find((p) => p.value === task.priority)

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        {/* El título abre la ficha: es el único sitio donde se puede leer la
            descripción y la lista de comprobación. Es un <button> y no un div
            con onClick para que funcione con teclado y con lector de pantalla. */}
        <button
          type="button"
          onClick={onOpen}
          className="block w-full text-left text-sm font-medium leading-snug underline-offset-2 hover:underline"
        >
          {task.title}
        </button>
        {subtasks.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${Math.round((subtasks.filter((x) => x.status === 'COMPLETADA').length / subtasks.length) * 100)}%`,
                }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {subtasks.filter((x) => x.status === 'COMPLETADA').length}/{subtasks.length}
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <ToneBadge tone={priority?.tone ?? null}>{priority?.label}</ToneBadge>
          {task.due_date && (
            <span className={cn('text-xs', late ? 'font-medium text-destructive' : 'text-muted-foreground')}>
              {format(parseISO(task.due_date), 'd MMM', { locale: es })}
            </span>
          )}
        </div>
        {task.assignee && <p className="truncate text-xs text-muted-foreground">{task.assignee.full_name}</p>}
        <div className="flex items-center gap-1">
          <StatusSelect task={task} caps={caps} userId={userId} onChange={onStatus} />
          {caps.canManagePlan && (
            <Button variant="ghost" size="icon" className="size-8" onClick={onRemove} aria-label="Eliminar tarea">
              <Trash2 />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function TaskDialog({
  open, onOpenChange, work, onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  work: WorkWithRelations
  onCreated: () => void
}) {
  const toast = useToast()
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { title: '', description: '', assignee_id: '', priority: 'MEDIA', start_date: '', due_date: '' },
  })

  const create = useMutation({
    mutationFn: (values: TaskFormValues) =>
      tasksRepo.create({
        work_id: work.id,
        title: values.title,
        description: values.description || null,
        assignee_id: values.assignee_id || null,
        priority: values.priority,
        start_date: values.start_date || null,
        due_date: values.due_date || null,
      }),
    onSuccess: () => {
      onCreated()
      toast.push('success', 'Tarea creada.')
      form.reset()
      onOpenChange(false)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const candidates = work.members.filter((m) => m.status === 'ACTIVE' && m.profile)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
          <DialogDescription>Se añadirá al plan de «{work.title}».</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-3" noValidate>
          <div>
            <Label htmlFor="task-title">Título</Label>
            <Input id="task-title" className="mt-1.5" {...form.register('title')} />
            <FieldError>{form.formState.errors.title?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="task-desc">Descripción</Label>
            <Textarea id="task-desc" rows={2} className="mt-1.5" {...form.register('description')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="task-assignee">Responsable</Label>
              <Select id="task-assignee" className="mt-1.5" {...form.register('assignee_id')}>
                <option value="">Sin asignar</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.user_id}>
                    {m.profile!.full_name} · {m.role?.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-priority">Prioridad</Label>
              <Select id="task-priority" className="mt-1.5" {...form.register('priority')}>
                {TASK_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="task-start">Inicio</Label>
              <Input id="task-start" type="date" className="mt-1.5" {...form.register('start_date')} />
            </div>
            <div>
              <Label htmlFor="task-due">Fecha límite</Label>
              <Input id="task-due" type="date" className="mt-1.5" {...form.register('due_date')} />
              <FieldError>{form.formState.errors.due_date?.message}</FieldError>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" loading={create.isPending}>Crear tarea</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
