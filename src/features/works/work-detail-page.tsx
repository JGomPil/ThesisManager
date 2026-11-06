import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Archive, Pencil } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ToneBadge } from '@/components/ui/badge'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { worksRepo } from '@/data/repositories/works.repo'
import { tasksRepo } from '@/data/repositories/tasks.repo'
import { useWorkStatuses, useWorkTypeStatuses } from '@/hooks/use-catalogs'
import { useAuth } from '@/features/auth/auth-context'
import { resolveWorkCapabilities } from '@/domain/permissions/work-capabilities'
import { computeWorkProgress, daysUntil, attentionReasons, ATTENTION_LABELS } from '@/domain/works/progress'
import { statusesForWorkType } from '@/domain/works/statuses'
import { WorkMembersCard } from '@/features/works/work-members-card'
import { DocumentsCard } from '@/features/documents/documents-card'
import { MeetingsCard } from '@/features/meetings/meetings-card'
import { CommentsThread } from '@/features/comments/comments-thread'
import { TaskBoard } from '@/features/tasks/task-board'

export function WorkDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { userId, isOrgAdmin } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  const work = useQuery({ queryKey: qk.works.detail(id ?? ''), queryFn: () => worksRepo.get(id!), enabled: Boolean(id) })
  const tasks = useQuery({ queryKey: qk.tasks.byWork(id ?? ''), queryFn: () => tasksRepo.byWork(id!), enabled: Boolean(id) })
  const statuses = useWorkStatuses()
  const typeStatuses = useWorkTypeStatuses()

  const [archiveOpen, setArchiveOpen] = React.useState(false)
  const navigate = useNavigate()

  const archive = useMutation({
    mutationFn: () => worksRepo.archive(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.works.all })
      void qc.invalidateQueries({ queryKey: qk.works.archived })
      toast.push('success', 'Trabajo archivado. Puedes restaurarlo desde Administración → Archivados.')
      navigate('/trabajos')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const changeStatus = useMutation({
    mutationFn: (statusId: string) => worksRepo.update(id!, { status_id: statusId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.works.detail(id!) })
      void qc.invalidateQueries({ queryKey: qk.works.all })
      toast.push('success', 'Estado actualizado.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (work.isLoading) return <LoadingPanel />
  if (work.isError) return <ErrorPanel error={work.error} />
  if (!work.data) {
    return (
      <EmptyState
        title="Trabajo no encontrado"
        description="O no existe, o no tienes acceso a él. Ambas cosas se ven igual desde aquí, intencionadamente."
        action={<Button asChild variant="outline"><Link to="/trabajos">Volver a trabajos</Link></Button>}
      />
    )
  }

  const w = work.data
  const caps = resolveWorkCapabilities(w.members, userId, isOrgAdmin)
  const progress = computeWorkProgress(tasks.data ?? [], w.progress_override)
  const reasons = attentionReasons(progress, w.expected_end_date, w.status?.is_terminal ?? false)
  const availableStatuses = statusesForWorkType(w.work_type_id, statuses.data ?? [], typeStatuses.data ?? [])
  const days = daysUntil(w.expected_end_date)

  return (
    <div className="space-y-4">
      <PageHeader
        title={w.title}
        breadcrumb={[{ label: 'Trabajos', to: '/trabajos' }, { label: w.work_type?.short_name ?? 'Trabajo' }]}
        description={[
          w.work_type?.name,
          w.program?.name,
          w.academic_year?.code,
        ].filter(Boolean).join(' · ')}
        actions={
          <div className="flex items-center gap-2">
            {caps.canEditWork && (
              <Button asChild variant="outline"><Link to={`/trabajos/${w.id}/editar`}><Pencil /> Editar</Link></Button>
            )}
            {/* Archivar queda reservado a la administración. Esconder el botón
                es comodidad; quien lo impide de verdad es el disparador
                app.enforce_soft_delete_scope() de la migración 0008. */}
            {isOrgAdmin && (
              <Button variant="outline" onClick={() => setArchiveOpen(true)}>
                <Archive /> Archivar
              </Button>
            )}
          </div>
        }
      />

      {reasons.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          <span className="font-medium">Atención:</span>
          {reasons.map((r) => (
            <ToneBadge key={r} tone="amber">{ATTENTION_LABELS[r]}</ToneBadge>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Columna principal */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Plan de trabajo</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <TaskBoard work={w} caps={caps} userId={userId} />
            </CardContent>
          </Card>

          <MeetingsCard work={w} caps={caps} userId={userId} />

          {(w.description || w.objectives || w.methodology) && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm">Contenido académico</CardTitle></CardHeader>
              <CardContent className="space-y-3 pt-0 text-sm">
                {w.description && <Section label="Descripción" text={w.description} />}
                {w.objectives && <Section label="Objetivos" text={w.objectives} />}
                {w.methodology && <Section label="Metodología" text={w.methodology} />}
                {w.keywords.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Palabras clave</p>
                    <div className="flex flex-wrap gap-1">
                      {w.keywords.map((k) => <ToneBadge key={k} tone="slate">{k}</ToneBadge>)}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Comentarios del trabajo</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <CommentsThread
                workId={w.id}
                entityType="WORK"
                entityId={w.id}
                members={w.members.filter((m) => m.status === 'ACTIVE')}
                userId={userId}
                canComment={w.members.some((m) => m.status === 'ACTIVE' && m.user_id === userId)}
              />
            </CardContent>
          </Card>
        </div>

        {/* Columna lateral */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Estado y progreso</CardTitle></CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Estado</p>
                {caps.canEditWork ? (
                  <Select
                    value={w.status_id}
                    onChange={(e) => changeStatus.mutate(e.target.value)}
                    aria-label="Estado del trabajo"
                  >
                    {availableStatuses.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                ) : (
                  <ToneBadge tone={w.status?.color ?? null}>{w.status?.name}</ToneBadge>
                )}
              </div>

              {/* Las DOS cifras, separadas y etiquetadas. Nunca una sola. */}
              <div className="grid grid-cols-2 gap-3">
                <Metric
                  label="Progreso académico"
                  hint="a juicio de la dirección"
                  value={progress.academicProgress === null ? '—' : `${progress.academicProgress} %`}
                />
                <Metric
                  label="Tareas completadas"
                  hint={`${progress.completedTasks} de ${progress.totalTasks}`}
                  value={progress.taskCompletion === null ? '—' : `${progress.taskCompletion} %`}
                />
              </div>

              {(progress.overdueTasks > 0 || progress.blockedTasks > 0) && (
                <p className="text-xs text-muted-foreground">
                  {progress.overdueTasks > 0 && `${progress.overdueTasks} tarea(s) atrasada(s). `}
                  {progress.blockedTasks > 0 && `${progress.blockedTasks} bloqueada(s).`}
                </p>
              )}
            </CardContent>
          </Card>

          <WorkMembersCard work={w} caps={caps} />
          <DocumentsCard workId={w.id} caps={caps} userId={userId} />

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Fechas</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm">
              <DateRow label="Inicio" value={w.start_date} />
              <DateRow
                label="Fin previsto"
                value={w.expected_end_date}
                suffix={
                  days !== null && !w.status?.is_terminal
                    ? days < 0 ? `${Math.abs(days)} d de retraso` : `en ${days} d`
                    : undefined
                }
                danger={days !== null && days < 0 && !w.status?.is_terminal}
              />
              {w.work_type?.requires_defense && <DateRow label="Defensa" value={w.defense_date} />}
              <DateRow label="Fin real" value={w.actual_end_date} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Tu relación con este trabajo</CardTitle></CardHeader>
            <CardContent className="pt-0 text-sm text-muted-foreground">
              {caps.isMember ? (
                <ul className="space-y-1">
                  {caps.isStudent && <li>Participas como estudiante.</li>}
                  {caps.isSupervisor && <li>Tienes función de supervisión.</li>}
                  {!caps.isStudent && !caps.isSupervisor && isOrgAdmin && <li>Accedes como administrador del grupo.</li>}
                  {caps.canManagePlan && <li>Puedes planificar y editar tareas.</li>}
                  {caps.isStudent && (
                    <li className="text-xs">
                      Como estudiante puedes actualizar el estado de tus tareas, pero no las fechas
                      ni las notas privadas de supervisión.
                    </li>
                  )}
                </ul>
              ) : (
                <p>Sin relación registrada.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Archivar «{w.title}»?</DialogTitle>
            <DialogDescription>
              El trabajo desaparece de los listados y de la vista de todos sus participantes,
              pero <strong>no se borra</strong>: los trabajos tienen valor académico y su
              historial se conserva. Podrás restaurarlo desde{' '}
              <strong>Administración → Trabajos archivados</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>Cancelar</Button>
            <Button variant="destructive" loading={archive.isPending} onClick={() => archive.mutate()}>
              <Archive /> Archivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Section({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[0.7rem] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function DateRow({
  label, value, suffix, danger,
}: {
  label: string
  value: string | null
  suffix?: string
  danger?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={danger ? 'font-medium text-destructive' : ''}>
        {value ? format(parseISO(value), 'd MMM yyyy', { locale: es }) : '—'}
        {suffix && <span className="ml-1 text-xs text-muted-foreground">({suffix})</span>}
      </span>
    </div>
  )
}
