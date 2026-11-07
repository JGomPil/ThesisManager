import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CheckCircle2, ListTodo } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useRowLink } from '@/components/common/row-link'
import { cn, toneEdgeClass } from '@/lib/utils'
import { qk } from '@/lib/query-keys'
import { worksRepo } from '@/data/repositories/works.repo'
import { tasksRepo } from '@/data/repositories/tasks.repo'
import { useWorkTypes } from '@/hooks/use-catalogs'
import { useAuth } from '@/features/auth/auth-context'
import { attentionReasons, ATTENTION_LABELS, computeWorkProgress, daysUntil } from '@/domain/works/progress'
import { resolveWorkCapabilities } from '@/domain/permissions/work-capabilities'

export function DashboardPage() {
  const { userId, isOrgAdmin, profile } = useAuth()
  const rowLink = useRowLink()
  const workTypes = useWorkTypes()
  const works = useQuery({ queryKey: qk.works.list({}), queryFn: () => worksRepo.list({ onlyActive: true }) })
  const myTasks = useQuery({
    queryKey: [...qk.tasks.mine, userId],
    queryFn: () => tasksRepo.mine(userId!),
    enabled: userId !== null,
  })

  if (works.isLoading || workTypes.isLoading) return <LoadingPanel />
  if (works.isError) return <ErrorPanel error={works.error} />
  if (workTypes.isError) return <ErrorPanel error={workTypes.error} />

  const allWorks = works.data ?? []
  const types = workTypes.data ?? []

  // Separación por relación del usuario con cada trabajo. No mezcla permisos:
  // `allWorks` ya viene filtrado por RLS, aquí solo se agrupa para presentar.
  const asSupervisor = allWorks.filter((w) => {
    const caps = resolveWorkCapabilities(w.members, userId, false)
    return caps.isSupervisor
  })
  const asStudent = allWorks.filter((w) => {
    const caps = resolveWorkCapabilities(w.members, userId, false)
    return caps.isStudent
  })

  // Una tarjeta por tipo de trabajo ACTIVO del catálogo: añadir
  // «Academia de Alumnos Internos» o cualquier tipo futuro hace aparecer su
  // tarjeta sin tocar este componente.
  const countsByType = types.map((t) => ({
    type: t,
    count: allWorks.filter((w) => w.work_type_id === t.id && !w.status?.is_terminal).length,
  }))

  const needAttention = allWorks
    .map((w) => {
      const progress = computeWorkProgress([], w.progress_override)
      const reasons = attentionReasons(progress, w.expected_end_date, w.status?.is_terminal ?? false)
      return { work: w, reasons }
    })
    .filter((x) => x.reasons.length > 0)
    .slice(0, 6)

  const upcoming = allWorks
    .filter((w) => !w.status?.is_terminal && w.expected_end_date)
    .map((w) => ({ work: w, days: daysUntil(w.expected_end_date) ?? 9999 }))
    .filter((x) => x.days <= 90)
    .sort((a, b) => a.days - b.days)
    .slice(0, 6)

  const firstName = profile?.full_name?.split(' ')[0]

  return (
    <div className="space-y-5">
      <PageHeader
        title={firstName ? `Hola, ${firstName}` : 'Resumen'}
        description={
          isOrgAdmin
            ? 'Vista global del grupo. Incluye todos los trabajos de la organización.'
            : 'Tu actividad: lo que supervisas y lo que te corresponde como estudiante.'
        }
      />

      {/* Recuento por tipo, generado desde el catálogo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {countsByType.map(({ type, count }) => (
          <Link key={type.id} to={`/trabajos?tipo=${type.id}`} className="group">
            {/* La franja del color del tipo. Antes el color solo salía en la
                pastilla de dentro, así que cuatro tarjetas de cuatro tipos
                distintos se veían iguales desde un metro. */}
            <Card className={cn('h-full border-l-4 transition-colors', toneEdgeClass(type.color))}>
              <CardContent className="flex flex-col gap-1.5 p-4">
                <ToneBadge tone={type.color} className="w-fit">{type.short_name}</ToneBadge>
                <p className="text-2xl font-semibold tabular-nums">{count}</p>
                <p className="text-xs text-muted-foreground">
                  {count === 1 ? 'trabajo activo' : 'trabajos activos'}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
        {countsByType.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="p-4 text-sm text-muted-foreground">
              No hay tipos de trabajo en el catálogo.{' '}
              {isOrgAdmin && <Link to="/admin/tipos" className="text-primary underline">Crear el primero</Link>}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Mis tareas */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListTodo className="size-4 text-muted-foreground" /> Mis tareas pendientes
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {myTasks.isLoading && <LoadingPanel label="Cargando tareas…" />}
            {myTasks.isError && <ErrorPanel error={myTasks.error} />}
            {myTasks.data && myTasks.data.length === 0 && (
              <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-emerald-600" /> No tienes tareas pendientes.
              </p>
            )}
            <ul className="divide-y">
              {(myTasks.data ?? []).slice(0, 8).map((t) => {
                const late = t.due_date !== null && (daysUntil(t.due_date) ?? 0) < 0
                return (
                  <li key={t.id} className="flex cursor-pointer items-center gap-3 py-2 text-sm" {...rowLink(`/trabajos/${t.work_id}`)}>
                    <Link to={`/trabajos/${t.work_id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate font-medium">{t.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{t.work?.title}</span>
                    </Link>
                    {t.due_date && (
                      <span className={late ? 'shrink-0 text-xs font-medium text-destructive' : 'shrink-0 text-xs text-muted-foreground'}>
                        {format(parseISO(t.due_date), 'd MMM', { locale: es })}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>

        {/* Necesita atención */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="size-4 text-muted-foreground" /> Necesita atención
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {needAttention.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Nada que requiera atención inmediata.</p>
            ) : (
              <ul className="divide-y">
                {needAttention.map(({ work, reasons }) => (
                  <li key={work.id} className="flex cursor-pointer items-start gap-3 py-2 text-sm" {...rowLink(`/trabajos/${work.id}`)}>
                    <Link to={`/trabajos/${work.id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate font-medium">{work.title}</span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {reasons.slice(0, 2).map((r) => (
                          <span key={r} className="text-xs text-muted-foreground">{ATTENTION_LABELS[r]}</span>
                        ))}
                      </span>
                    </Link>
                    <ToneBadge tone={work.work_type?.color ?? null}>{work.work_type?.short_name}</ToneBadge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Próximas entregas */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="size-4 text-muted-foreground" /> Próximas fechas previstas
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {upcoming.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Sin fechas en los próximos 90 días.</p>
            ) : (
              <ul className="divide-y">
                {upcoming.map(({ work, days }) => (
                  <li key={work.id} className="flex cursor-pointer items-center gap-3 py-2 text-sm" {...rowLink(`/trabajos/${work.id}`)}>
                    <Link to={`/trabajos/${work.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {work.title}
                    </Link>
                    <span className={days < 0 ? 'shrink-0 text-xs font-medium text-destructive' : 'shrink-0 text-xs text-muted-foreground'}>
                      {days < 0 ? `${Math.abs(days)} d de retraso` : `en ${days} d`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Mis contextos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Mi actividad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-sm">
            <ContextRow label="Trabajos que superviso" to="/trabajos?contexto=supervisor" count={asSupervisor.length} />
            <ContextRow label="Mis trabajos como estudiante" to="/trabajos?contexto=estudiante" count={asStudent.length} />
            {isOrgAdmin && <ContextRow label="Todos los trabajos del grupo" to="/trabajos" count={allWorks.length} />}
            {asSupervisor.length === 0 && asStudent.length === 0 && !isOrgAdmin && (
              <EmptyState
                title="Todavía no participas en ningún trabajo"
                description="El administrador debe asignarte como director, codirector o estudiante."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ContextRow({ label, to, count }: { label: string; to: string; count: number }) {
  return (
    <Link to={to} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent">
      <span>{label}</span>
      <span className="font-medium tabular-nums">{count}</span>
    </Link>
  )
}
