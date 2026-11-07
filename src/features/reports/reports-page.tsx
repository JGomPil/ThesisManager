import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, BarChart3, CheckCircle2, Clock, Download, FileText, Printer, Users,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useRowLink } from '@/components/common/row-link'
import { qk } from '@/lib/query-keys'
import { descargarCsv } from '@/lib/download'
import { reportsRepo } from '@/data/repositories/reports.repo'
import { useAcademicYears, useWorkStatuses, useWorkTypes } from '@/hooks/use-catalogs'
import { ATTENTION_LABELS } from '@/domain/works/progress'
import {
  buildWorkReports, byPerson, isLate, summarize, toCsv, type WorkReportRow,
} from '@/domain/reports/aggregate'

/**
 * Informes y seguimiento.
 *
 * LAS CIFRAS SON LAS DE QUIEN MIRA, Y LA PANTALLA LO DICE. RLS devuelve a cada
 * cual sus trabajos: un director ve los suyos y la administración ve todos. Es
 * el comportamiento correcto, pero un panel de indicadores sin aclararlo se lee
 * como un total del grupo, y eso convertiría una regla de permisos en un error
 * de dato. De ahí la nota bajo el título, que no es decorativa.
 *
 * LOS GRÁFICOS SE CARGAN APARTE (`React.lazy`): Recharts es la dependencia más
 * pesada del proyecto y no debe viajar en el paquete inicial, que paga también
 * quien solo entra a ver sus tareas.
 *
 * EL PDF ES LA IMPRESIÓN DEL NAVEGADOR, no una biblioteca. «Guardar como PDF»
 * existe en todos los navegadores y da un resultado seleccionable y con enlaces
 * vivos; meter un generador de PDF en el paquete serían cientos de kilobytes
 * para producir una imagen peor. Lo que se ha hecho es preparar la hoja para
 * imprimirse: la navegación y los botones llevan `print:hidden`.
 */

const Graficos = {
  PorRetraso: React.lazy(() =>
    import('@/features/reports/reports-charts').then((m) => ({ default: m.BarrasPorRetraso }))),
  Simples: React.lazy(() =>
    import('@/features/reports/reports-charts').then((m) => ({ default: m.BarrasSimples }))),
  Progreso: React.lazy(() =>
    import('@/features/reports/reports-charts').then((m) => ({ default: m.BarrasDeProgreso }))),
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const rowLink = useRowLink()

  const tipo = params.get('tipo') ?? ''
  const estado = params.get('estado') ?? ''
  const curso = params.get('curso') ?? ''
  const soloActivos = params.get('activos') !== 'no'

  const workTypes = useWorkTypes()
  const statuses = useWorkStatuses()
  const years = useAcademicYears()

  const filtros = {
    workTypeId: tipo || undefined,
    statusId: estado || undefined,
    academicYearId: curso || undefined,
    onlyActive: soloActivos,
  }
  const datos = useQuery({
    queryKey: qk.reports.snapshot(filtros),
    queryFn: () => reportsRepo.load(filtros),
  })

  const setParam = (clave: string, valor: string) => {
    const next = new URLSearchParams(params)
    if (valor) next.set(clave, valor)
    else next.delete(clave)
    setParams(next, { replace: true })
  }

  const filas = React.useMemo(
    () => (datos.data ? buildWorkReports(datos.data.works, datos.data.tasks, datos.data.milestones) : []),
    [datos.data],
  )
  const indicadores = React.useMemo(() => summarize(filas), [filas])
  const estudiantes = React.useMemo(() => byPerson(filas, 'student'), [filas])
  const direccion = React.useMemo(() => byPerson(filas, 'supervisor'), [filas])

  const descargar = () => {
    const hoy = format(new Date(), 'yyyy-MM-dd')
    descargarCsv(`informe-trabajos-${hoy}.csv`, toCsv(filas, ATTENTION_LABELS))
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Informes y seguimiento"
        description="Indicadores de los trabajos a los que tienes acceso. Si diriges trabajos, son los tuyos; la administración ve todos."
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" onClick={descargar} disabled={filas.length === 0}>
              <Download /> CSV
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer /> Imprimir o guardar en PDF
            </Button>
          </div>
        }
      />

      <Card className="p-3 print:hidden">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={tipo} onChange={(e) => setParam('tipo', e.target.value)} aria-label="Tipo de trabajo">
            <option value="">Todos los tipos</option>
            {(workTypes.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select value={estado} onChange={(e) => setParam('estado', e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            {(statuses.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={curso} onChange={(e) => setParam('curso', e.target.value)} aria-label="Curso académico">
            <option value="">Todos los cursos</option>
            {(years.data ?? []).map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
          </Select>
          <Select
            value={soloActivos ? 'si' : 'no'}
            onChange={(e) => setParam('activos', e.target.value === 'si' ? '' : 'no')}
            aria-label="Incluir archivados"
          >
            <option value="si">Sin los archivados</option>
            <option value="no">Incluir los archivados</option>
          </Select>
        </div>
      </Card>

      {datos.isLoading && <LoadingPanel label="Calculando indicadores…" />}
      {datos.isError && <ErrorPanel error={datos.error} />}

      {/* Un informe con listas recortadas daría totales MENORES de los reales y
          parecerían buenos. Se avisa en vez de mostrar una cifra falsa. */}
      {datos.data?.truncated && (
        <Card className="border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">Los totales podrían estar incompletos</p>
          <p className="mt-1 text-muted-foreground">
            El servidor ha recortado la lista de {datos.data.truncatedWhat.join(' y ')}. Filtra por
            curso o por tipo para reducir el conjunto; los números de esta pantalla no son fiables
            mientras aparezca este aviso.
          </p>
        </Card>
      )}

      {datos.data && filas.length === 0 && (
        <EmptyState
          icon={BarChart3}
          title="No hay trabajos que resumir"
          description="Ajusta los filtros o crea el primer trabajo."
        />
      )}

      {filas.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Indicador etiqueta="Trabajos" valor={indicadores.total} icono={FileText} />
            <Indicador etiqueta="En curso" valor={indicadores.active} icono={Clock} />
            <Indicador etiqueta="Terminados" valor={indicadores.finished} icono={CheckCircle2} />
            <Indicador
              etiqueta="Con retraso" valor={indicadores.late} icono={AlertTriangle}
              tono={indicadores.late > 0 ? 'text-destructive' : undefined}
              ayuda="Fecha prevista superada o tareas vencidas"
            />
            <Indicador
              etiqueta="Sin planificación" valor={indicadores.withoutPlan} icono={BarChart3}
              ayuda="Trabajos en curso sin ninguna tarea"
            />
          </div>

          <React.Suspense fallback={<LoadingPanel label="Cargando gráficos…" />}>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Por tipo de trabajo</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <Graficos.PorRetraso datos={indicadores.byType} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Por estado</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <Graficos.Simples datos={indicadores.byStatus} nombre="Trabajos" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-1.5 text-sm">
                    <Users className="size-4 text-muted-foreground" /> Carga por dirección
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <Graficos.PorRetraso
                    datos={direccion.map((p) => ({ label: p.name, total: p.works.length, late: p.late }))}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Progreso de los trabajos en curso</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {/* Las dos cifras, en dos barras: el % de tareas es mecánico y
                      el progreso académico es el juicio de quien supervisa. */}
                  <Graficos.Progreso
                    datos={filas.filter((f) => !f.isTerminal).slice(0, 12).map((f) => ({
                      label: f.title.length > 28 ? `${f.title.slice(0, 27)}…` : f.title,
                      tareas: f.progress.taskCompletion,
                      academico: f.progress.academicProgress,
                    }))}
                  />
                </CardContent>
              </Card>
            </div>
          </React.Suspense>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Trabajo por trabajo</CardTitle>
            </CardHeader>
            {/* MÓVIL: tarjetas. Esta tabla tiene ocho columnas y cuatro son
                cifras; en un teléfono no es una tabla, es un carrusel en el
                que nunca se ven a la vez el nombre del trabajo y el número que
                se está leyendo, que es la única forma en que un número
                significa algo. */}
            <CardContent className="space-y-2 pt-0 sm:hidden">
              {filas.map((f) => (
                <div
                  key={f.id}
                  className="cursor-pointer rounded-lg border p-3 active:bg-accent"
                  {...rowLink(`/informes/trabajo/${f.id}`)}
                >
                  <Link to={`/informes/trabajo/${f.id}`} className="font-medium hover:underline">
                    <span className="line-clamp-2">{f.title}</span>
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ToneBadge tone={f.statusColor}>{f.statusName}</ToneBadge>
                    <span className="text-xs text-muted-foreground">{f.typeShort}</span>
                  </div>
                  <p className="mt-1.5 break-words text-sm text-muted-foreground">
                    {f.students.map((s) => s.name).join(', ') || 'Sin estudiante asignado'}
                  </p>

                  {/* Las dos cifras, cada una con su nombre y sin fundirse. */}
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-sm text-muted-foreground">% tareas</dt>
                      <dd className="tabular-nums">
                        {f.progress.taskCompletion === null ? '—' : `${f.progress.taskCompletion} %`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Progreso académico</dt>
                      <dd className="tabular-nums">
                        {f.progress.academicProgress === null ? '—' : `${f.progress.academicProgress} %`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Tareas</dt>
                      <dd className="tabular-nums">
                        {f.progress.completedTasks}/{f.progress.totalTasks}
                        {f.progress.overdueTasks > 0 && (
                          <span className="ml-1 text-destructive">(+{f.progress.overdueTasks})</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Fin previsto</dt>
                      <dd className={isLate(f) ? 'font-medium text-destructive' : undefined}>
                        {f.expectedEndDate
                          ? format(parseISO(f.expectedEndDate), 'd MMM yyyy', { locale: es })
                          : '—'}
                      </dd>
                    </div>
                  </dl>

                  {f.overdueMilestones > 0 && (
                    <p className="mt-1.5 text-sm font-medium text-destructive">
                      {f.overdueMilestones} hito(s) vencido(s)
                    </p>
                  )}
                </div>
              ))}
            </CardContent>

            <CardContent className="hidden pt-0 sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trabajo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Estudiante</TableHead>
                    <TableHead className="text-right">Tareas</TableHead>
                    <TableHead className="text-right">% tareas</TableHead>
                    <TableHead className="text-right">Progreso acad.</TableHead>
                    <TableHead className="text-right">Hitos vencidos</TableHead>
                    <TableHead>Fin previsto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((f) => (
                    <TableRow key={f.id} className="cursor-pointer" {...rowLink(`/informes/trabajo/${f.id}`)}>
                      <TableCell className="max-w-[18rem]">
                        <Link to={`/informes/trabajo/${f.id}`} className="font-medium hover:underline">
                          <span className="line-clamp-2">{f.title}</span>
                        </Link>
                        <span className="text-xs text-muted-foreground">{f.typeShort}</span>
                      </TableCell>
                      <TableCell><ToneBadge tone={f.statusColor}>{f.statusName}</ToneBadge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {f.students.map((s) => s.name).join(', ') || '—'}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {f.progress.completedTasks}/{f.progress.totalTasks}
                        {f.progress.overdueTasks > 0 && (
                          <span className="ml-1 text-destructive">(+{f.progress.overdueTasks} vencidas)</span>
                        )}
                      </TableCell>
                      {/* Las dos columnas NO se funden nunca, y una sin dato se
                          dice con una raya: un 0 % se leería como «no avanza». */}
                      <TableCell className="text-right text-sm tabular-nums">
                        {f.progress.taskCompletion === null ? '—' : `${f.progress.taskCompletion} %`}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {f.progress.academicProgress === null ? '—' : `${f.progress.academicProgress} %`}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {f.overdueMilestones > 0
                          ? <span className="font-medium text-destructive">{f.overdueMilestones}</span>
                          : <span className="text-muted-foreground">0</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {f.expectedEndDate
                          ? (
                            <span className={isLate(f) ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                              {format(parseISO(f.expectedEndDate), 'd MMM yyyy', { locale: es })}
                            </span>
                          )
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <PersonasCard titulo="Por estudiante" filas={estudiantes} />
            <PersonasCard titulo="Por dirección" filas={direccion} />
          </div>
        </>
      )}
    </div>
  )
}

function Indicador({
  etiqueta, valor, icono: Icono, tono, ayuda,
}: {
  etiqueta: string
  valor: number
  icono: React.ComponentType<{ className?: string }>
  tono?: string
  ayuda?: string
}) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{etiqueta}</p>
          <p className={`mt-0.5 text-2xl font-semibold tabular-nums ${tono ?? ''}`}>{valor}</p>
        </div>
        <Icono className="size-4 shrink-0 text-muted-foreground" />
      </div>
      {ayuda && <p className="mt-1 text-xs text-muted-foreground">{ayuda}</p>}
    </Card>
  )
}

/**
 * La misma persona puede salir en las dos tarjetas: doctoranda de su tesis y
 * directora de un TFG. No es un error de agrupación, es el diseño de roles no
 * excluyentes del proyecto.
 */
function PersonasCard({
  titulo, filas,
}: {
  titulo: string
  filas: { id: string; name: string; works: WorkReportRow[]; active: number; late: number; overdueTasks: number }[]
}) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{titulo}</CardTitle></CardHeader>
      <CardContent className="pt-0">
        {filas.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nadie que mostrar.</p>
        ) : (
          <ul className="divide-y text-sm">
            {filas.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.works.length} trabajo(s) · {p.active} en curso
                </span>
                {p.late > 0 && <ToneBadge tone="red">{p.late} con retraso</ToneBadge>}
                {p.overdueTasks > 0 && <ToneBadge tone="amber">{p.overdueTasks} tareas vencidas</ToneBadge>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
