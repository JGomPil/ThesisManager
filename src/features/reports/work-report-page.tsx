import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { qk } from '@/lib/query-keys'
import { worksRepo } from '@/data/repositories/works.repo'
import { tasksRepo, TASK_STATUSES } from '@/data/repositories/tasks.repo'
import { milestonesRepo } from '@/data/repositories/milestones.repo'
import { meetingsRepo } from '@/data/repositories/meetings.repo'
import { documentsRepo, REVIEW_STATUSES } from '@/data/repositories/documents.repo'
import { useAuth } from '@/features/auth/auth-context'
import { ATTENTION_LABELS } from '@/domain/works/progress'
import { buildWorkReports } from '@/domain/reports/aggregate'

/**
 * Informe de seguimiento de UN trabajo, pensado para imprimirse o guardarse en
 * PDF y llevarlo a una reunión de seguimiento o a una comisión.
 *
 * LO QUE ESTE INFORME NO LLEVA, Y ES LA DECISIÓN IMPORTANTE: ninguna nota
 * privada de reunión. La política `notes_select` ya se lo negaría al cliente
 * cuando no corresponde, pero aquí hay una razón añadida: un informe se imprime
 * y se pasa a otras manos. Un documento pensado para circular no es sitio para
 * lo que se escribió para no circular, ni siquiera para quien sí puede leerlo.
 * Lo que sí lleva son las ACTAS compartidas, que el estudiante también ve.
 *
 * Las fechas se escriben completas y en castellano porque el papel no tiene
 * dónde poner un `title` que aclare una abreviatura.
 */
export function WorkReportPage() {
  const { id = '' } = useParams()
  const { profile } = useAuth()

  const work = useQuery({ queryKey: qk.works.detail(id), queryFn: () => worksRepo.get(id), enabled: !!id })
  const tareas = useQuery({ queryKey: qk.tasks.byWork(id), queryFn: () => tasksRepo.byWork(id), enabled: !!id })
  const hitos = useQuery({ queryKey: qk.milestones.byWork(id), queryFn: () => milestonesRepo.byWork(id), enabled: !!id })
  const reuniones = useQuery({ queryKey: qk.meetings.byWork(id), queryFn: () => meetingsRepo.byWork(id), enabled: !!id })
  const docs = useQuery({ queryKey: qk.documents.byWork(id), queryFn: () => documentsRepo.byWork(id), enabled: !!id })

  if (work.isLoading) return <LoadingPanel />
  if (work.isError) return <ErrorPanel error={work.error} />
  if (!work.data) {
    return (
      <EmptyState
        title="Trabajo no encontrado"
        description="O no existe, o no tienes acceso a él. La base de datos no distingue entre las dos cosas a propósito."
      />
    )
  }

  const w = work.data
  const [fila] = buildWorkReports(
    [w],
    (tareas.data ?? []).map((t) => ({
      work_id: t.work_id, status: t.status, due_date: t.due_date, parent_task_id: t.parent_task_id,
    })),
    (hitos.data ?? []).map((m) => ({ work_id: m.work_id, due_date: m.due_date, is_met: m.is_met })),
  )
  const principales = (tareas.data ?? []).filter((t) => t.parent_task_id === null)
  const fecha = (d: string | null) => (d ? format(parseISO(d), "d 'de' MMMM 'de' yyyy", { locale: es }) : '—')

  return (
    <div className="space-y-4">
      <PageHeader
        title="Informe de seguimiento"
        description={w.title}
        breadcrumb={[{ label: 'Informes', to: '/informes' }, { label: 'Trabajo' }]}
        actions={
          <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
            <Printer /> Imprimir o guardar en PDF
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Datos del trabajo</CardTitle></CardHeader>
        <CardContent className="grid gap-x-6 gap-y-2 pt-0 text-sm sm:grid-cols-2">
          <Dato etiqueta="Título" valor={w.title} />
          <Dato etiqueta="Tipo" valor={fila!.typeName} />
          <Dato etiqueta="Estado" valor={<ToneBadge tone={fila!.statusColor}>{fila!.statusName}</ToneBadge>} />
          <Dato etiqueta="Curso académico" valor={fila!.academicYear} />
          <Dato etiqueta="Titulación" valor={fila!.programName} />
          <Dato etiqueta="Línea de investigación" valor={fila!.researchLine} />
          <Dato etiqueta="Estudiante(s)" valor={fila!.students.map((s) => s.name).join(', ') || '—'} />
          <Dato
            etiqueta="Dirección"
            valor={fila!.supervisors.map((s) => s.name).join(', ') || '—'}
          />
          <Dato etiqueta="Inicio" valor={fecha(w.start_date)} />
          <Dato etiqueta="Fin previsto" valor={fecha(w.expected_end_date)} />
          <Dato etiqueta="Fin real" valor={fecha(w.actual_end_date)} />
          <Dato etiqueta="Defensa" valor={fecha(w.defense_date)} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Progreso</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {/* DOS CIFRAS, SIEMPRE SEPARADAS Y ETIQUETADAS. Un trabajo puede
                tener el 90 % de las tareas hechas y un 40 % de progreso
                académico porque hay que reescribir el capítulo central. */}
            <dl className="space-y-3 text-sm">
              <Cifra
                etiqueta="Tareas completadas"
                valor={fila!.progress.taskCompletion}
                detalle={`${fila!.progress.completedTasks} de ${fila!.progress.totalTasks} tareas`}
              />
              <Cifra
                etiqueta="Progreso académico (valoración de la dirección)"
                valor={fila!.progress.academicProgress}
                detalle={fila!.progress.academicProgress === null ? 'Sin valorar' : 'Juicio de quien supervisa, no un cálculo'}
              />
            </dl>
            {fila!.attention.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
                {fila!.attention.map((a) => (
                  <ToneBadge key={a} tone={a === 'PAST_DEADLINE' || a === 'OVERDUE_TASKS' ? 'red' : 'amber'}>
                    {ATTENTION_LABELS[a]}
                  </ToneBadge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Hitos</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {(hitos.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin hitos definidos.</p>
            ) : (
              <ul className="divide-y text-sm">
                {(hitos.data ?? []).map((m) => (
                  <li key={m.id} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 break-words">{m.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fecha(m.due_date)}</span>
                    {m.is_met
                      ? <ToneBadge tone="green">cumplido</ToneBadge>
                      : <ToneBadge tone={m.due_date < new Date().toISOString().slice(0, 10) ? 'red' : 'slate'}>
                          {m.due_date < new Date().toISOString().slice(0, 10) ? 'vencido' : 'pendiente'}
                        </ToneBadge>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Plan de trabajo</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {principales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Este trabajo no tiene tareas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarea</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Fecha límite</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {principales.map((t) => {
                  const e = TASK_STATUSES.find((s) => s.value === t.status)
                  const vencida = t.status !== 'COMPLETADA' && t.due_date !== null
                    && t.due_date < new Date().toISOString().slice(0, 10)
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="max-w-[20rem]"><span className="line-clamp-2">{t.title}</span></TableCell>
                      <TableCell><ToneBadge tone={e?.tone ?? null}>{e?.label}</ToneBadge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.assignee?.full_name ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fecha(t.start_date)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-sm ${vencida ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                        {fecha(t.due_date)}{vencida && ' (vencida)'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Reuniones y actas</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {(reuniones.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin reuniones registradas.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {(reuniones.data ?? []).slice(0, 10).map((r) => (
                  <li key={r.id} className="border-b pb-2 last:border-0">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(r.scheduled_at), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}
                      {r.agreements.length > 0 && ` · ${r.agreements.length} acuerdo(s)`}
                    </p>
                    {r.summary && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{r.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Solo actas compartidas. Este informe no incluye ninguna nota privada de reunión.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Documentos</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {(docs.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin documentos.</p>
            ) : (
              <ul className="divide-y text-sm">
                {(docs.data ?? []).map((d) => {
                  const ultima = d.versions[0]
                  const estado = REVIEW_STATUSES.find((s) => s.value === ultima?.review_status)
                  return (
                    <li key={d.id} className="flex items-center gap-2 py-1.5">
                      <span className="min-w-0 flex-1 break-words">{d.name}</span>
                      {ultima && (
                        <span className="shrink-0 text-xs text-muted-foreground">{ultima.version_label}</span>
                      )}
                      {estado && <ToneBadge tone={estado.tone}>{estado.label}</ToneBadge>}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pie del informe: quién lo generó y cuándo. En papel, un informe sin
          fecha no se puede comparar con otro. */}
      <p className="text-xs text-muted-foreground">
        Informe generado el {format(new Date(), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}
        {profile?.full_name ? ` por ${profile.full_name}` : ''}. Thesis Manager · Grupo de Ingeniería
        Biomédica, Universidad de Valladolid.
      </p>
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="mt-0.5">{valor}</dd>
    </div>
  )
}

function Cifra({ etiqueta, valor, detalle }: { etiqueta: string; valor: number | null; detalle: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="mt-1 flex items-center gap-3">
        {/* Sin dato se escribe una raya, no un 0 %: un cero se leería como
            «no ha avanzado nada», que es una afirmación distinta. */}
        <span className="text-xl font-semibold tabular-nums">{valor === null ? '—' : `${valor} %`}</span>
        {valor !== null && (
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${valor}%` }} />
          </span>
        )}
      </dd>
      <p className="mt-0.5 text-xs text-muted-foreground">{detalle}</p>
    </div>
  )
}
