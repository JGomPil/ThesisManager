import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Archive, Check, Pencil } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ToneBadge } from '@/components/ui/badge'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { EnPantallaCompleta, ExpandButton, FullscreenPanel } from '@/components/common/fullscreen'
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
import { ScheduleCard } from '@/features/plan/schedule-card'
import { MilestonesCard } from '@/features/plan/milestones-card'
import { CommentsThread } from '@/features/comments/comments-thread'
import { TaskBoard } from '@/features/tasks/task-board'
import { TextoConFormato } from '@/components/common/rich-text'
import { DescargarIcs } from '@/features/calendar/ics-button'

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
  const [planExpandido, setPlanExpandido] = React.useState(false)
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

  /**
   * Las dos valoraciones de la dirección, cada una donde se mira.
   *
   * Comparten la invalidación con el cambio de estado: `works.detail` para esta
   * pantalla y `works.all` porque el progreso académico sale también en los
   * listados y en el resumen. Si se cambiaran solo desde el formulario de
   * edición, para subir un 10 % habría que entrar a editar el trabajo entero,
   * guardar y volver; la pista «a juicio de la dirección» está escrita aquí, y
   * aquí tiene que poder emitirse ese juicio.
   */
  const setProgreso = useMutation({
    mutationFn: (valor: number | null) => worksRepo.update(id!, { progress_override: valor }),
    onSuccess: (_row, valor) => {
      void qc.invalidateQueries({ queryKey: qk.works.detail(id!) })
      void qc.invalidateQueries({ queryKey: qk.works.all })
      toast.push(
        'success',
        valor === null ? 'Progreso académico: sin valorar.' : `Progreso académico: ${valor} %.`,
      )
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const setFinReal = useMutation({
    mutationFn: (valor: string | null) => worksRepo.update(id!, { actual_end_date: valor }),
    onSuccess: (_row, valor) => {
      void qc.invalidateQueries({ queryKey: qk.works.detail(id!) })
      void qc.invalidateQueries({ queryKey: qk.works.all })
      toast.push('success', valor === null ? 'Fecha de fin real borrada.' : 'Fecha de fin real guardada.')
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
  const tablero = <TaskBoard work={w} caps={caps} userId={userId} />

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
            {/* El alumno también entra a «Editar», pero allí solo ve el
                contenido académico: lo demás se lo frena el disparador
                `enforce_work_update_scope` (0030) y el formulario ni se lo
                enseña. `canEditWork` sigue siendo la dirección. */}
            {caps.canEditAcademicContent && (
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Columna principal.
            `min-w-0` NO ES ADORNO: una celda de rejilla tiene `min-width:auto`,
            o sea que se ensancha hasta caber su contenido. Dentro de esta van el
            tablero y el cronograma, que son filas anchas con su propio
            desplazamiento horizontal, y sin esto la celda —y con ella la página
            entera— crecía hasta el ancho del tablero. En el móvil el resultado
            era que el dedo movía LA PÁGINA en lugar del tablero: se veía la
            segunda columna, se volvía a arrastrar y aparecía la primera, y a la
            tercera no se llegaba nunca. Ningún error, solo una pantalla que no
            obedece. */}
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* El tablero se construye UNA vez (`tablero`) y se enseña en un
              sitio o en el otro, nunca en los dos: tiene estado propio
              —diálogos abiertos, tarea seleccionada— y dos copias vivas a la
              vez son dos tableros que se contradicen. */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm">Plan de trabajo</CardTitle>
              <ExpandButton
                label="Ver el plan de trabajo a pantalla completa"
                onClick={() => setPlanExpandido(true)}
              />
            </CardHeader>
            <CardContent className="pt-0">
              {planExpandido ? <EnPantallaCompleta /> : tablero}
            </CardContent>
          </Card>

          <FullscreenPanel
            open={planExpandido}
            onOpenChange={setPlanExpandido}
            title={`Plan de trabajo · ${w.title}`}
          >
            {planExpandido && tablero}
          </FullscreenPanel>

          <ScheduleCard workId={w.id} tasks={tasks.data ?? []} />

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

        {/* Columna lateral. `min-w-0` por lo mismo que la principal: aquí hay
            correos y títulos largos, y una celda de rejilla no se encoge por
            debajo de su contenido si no se le dice. */}
        <div className="min-w-0 space-y-4">
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
                <ProgresoAcademico
                  valor={w.progress_override}
                  puedeEditar={caps.canEditWork}
                  guardando={setProgreso.isPending}
                  onGuardar={(v) => setProgreso.mutate(v)}
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

          <MilestonesCard workId={w.id} caps={caps} />
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
              <FinReal
                valor={w.actual_end_date}
                inicio={w.start_date}
                puedeEditar={caps.canEditWork}
                guardando={setFinReal.isPending}
                onGuardar={(v) => setFinReal.mutate(v)}
              />

              {/* Las fechas del PLAN —vencimientos, hitos y reuniones—, al
                  calendario de cada cual. Está aquí, en la tarjeta de fechas,
                  porque es donde se las busca; y se recorta a este trabajo,
                  que es de lo que habla esta pantalla. */}
              <div className="space-y-1.5 border-t pt-3">
                <DescargarIcs
                  etiqueta={w.title}
                  nombre={`Thesis Manager · ${w.title}`}
                  filtrar={(e) => e.workId === w.id}
                />
                <p className="text-xs text-muted-foreground">
                  Vencimientos, hitos y reuniones de este trabajo. Es una foto de hoy: si cambian
                  las fechas, vuelve a descargarlo.
                </p>
              </div>
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
                      Como estudiante escribes el contenido académico, tus hitos, las reuniones y
                      las tareas que tengas asignadas, con su lista de comprobación. No llevas el
                      estado del trabajo, las fechas, el progreso —que lo valora la dirección—,
                      quién es responsable de cada tarea ni las notas privadas de supervisión.
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
      {/* Con el mismo formato que los comentarios. La metodología de un
          trabajo es una lista de pasos, y escrita de corrido hay que leerla
          entera para contarlos. Lo que hay guardado sin marcas sale igual que
          salía: ver `rich-text.tsx`. */}
      <TextoConFormato texto={text} className="text-[0.925rem]" />
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

/**
 * Progreso académico: la valoración de la dirección, editable aquí mismo.
 *
 * Quien no puede editar el trabajo ve la cifra tal cual (`Metric`), que es lo
 * que había antes. Quien puede, ve un campo con el número y un botón que
 * APARECE SOLO CUANDO HAY ALGO QUE GUARDAR. No se guarda al teclear: un
 * `onChange` que escribe en la base de datos manda una petición por pulsación
 * —«40» pasa por «4»— y encima deja guardado el número a medias si uno se
 * distrae a mitad de camino.
 *
 * Vaciar el campo guarda `null`, que es «sin valorar»: distinto de 0 %, que es
 * una valoración de cero. La pista lo dice, porque desde el campo vacío no hay
 * manera de adivinarlo.
 */
function ProgresoAcademico({
  valor, puedeEditar, guardando, onGuardar,
}: {
  valor: number | null
  puedeEditar: boolean
  guardando: boolean
  onGuardar: (v: number | null) => void
}) {
  const [texto, setTexto] = React.useState(valor === null ? '' : String(valor))

  // Si el valor cambia por fuera (otra pestaña, el formulario de edición), el
  // campo se pone al día. La dependencia es `valor`, no `texto`: lo que se
  // está escribiendo no se pisa.
  React.useEffect(() => { setTexto(valor === null ? '' : String(valor)) }, [valor])

  if (!puedeEditar) {
    return (
      <Metric
        label="Progreso académico"
        hint="a juicio de la dirección"
        value={valor === null ? '—' : `${valor} %`}
      />
    )
  }

  const limpio = texto.trim()
  const numero = limpio === '' ? null : Number(limpio)
  const valido = limpio === '' || (/^\d{1,3}$/.test(limpio) && numero! <= 100)
  const cambiado = valido && numero !== valor

  return (
    <div className="rounded-md border p-2.5">
      <Label htmlFor="progreso-academico" className="text-xs font-normal text-muted-foreground">
        Progreso académico
      </Label>
      <div className="mt-0.5 flex items-baseline gap-1">
        <Input
          id="progreso-academico"
          type="number"
          min={0}
          max={100}
          step={1}
          inputMode="numeric"
          className="h-8 w-16 px-2 text-base font-semibold tabular-nums"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && cambiado) {
              e.preventDefault()
              onGuardar(numero)
            }
          }}
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
      <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
        a juicio de la dirección; vacío = sin valorar
      </p>
      {!valido && (
        <p className="mt-1 text-[0.7rem] font-medium text-destructive">Un número entero del 0 al 100.</p>
      )}
      {cambiado && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1.5 h-7 w-full"
          loading={guardando}
          onClick={() => onGuardar(numero)}
        >
          <Check /> Guardar
        </Button>
      )}
    </div>
  )
}

/**
 * Fin real: la fecha en que el trabajo terminó de verdad.
 *
 * Mismo reparto que el progreso —se lee si no se puede editar, se escribe si
 * sí— y mismo botón que solo sale cuando la fecha ha cambiado: un
 * `<input type="date">` emite cambios mientras se teclea el día, y el valor
 * intermedio es la cadena vacía, así que guardar al vuelo borraría la fecha
 * cada vez que alguien la escribe a mano en lugar de elegirla del calendario.
 *
 * La comprobación contra la fecha de inicio es la misma que hace el formulario
 * (`workFormSchema`). No la impone la base de datos —su único `check` de
 * fechas es el del fin PREVISTO—, así que se repite aquí a propósito: este es
 * el otro sitio por donde se escribe esta fecha.
 */
function FinReal({
  valor, inicio, puedeEditar, guardando, onGuardar,
}: {
  valor: string | null
  inicio: string | null
  puedeEditar: boolean
  guardando: boolean
  onGuardar: (v: string | null) => void
}) {
  const [texto, setTexto] = React.useState(valor ?? '')
  React.useEffect(() => { setTexto(valor ?? '') }, [valor])

  if (!puedeEditar) return <DateRow label="Fin real" value={valor} />

  const anterior = texto !== '' && inicio !== null && texto < inicio
  const cambiado = !anterior && (texto === '' ? null : texto) !== valor

  return (
    <div className="space-y-1.5 border-t pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="fin-real" className="font-normal text-muted-foreground">Fin real</Label>
        <Input
          id="fin-real"
          type="date"
          min={inicio ?? undefined}
          className="h-8 w-auto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>
      {anterior && (
        <p className="text-xs font-medium text-destructive">
          No puede ser anterior al inicio ({format(parseISO(inicio!), 'd MMM yyyy', { locale: es })}).
        </p>
      )}
      {cambiado && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-full"
          loading={guardando}
          onClick={() => onGuardar(texto === '' ? null : texto)}
        >
          <Check /> {texto === '' ? 'Borrar la fecha' : 'Guardar el fin real'}
        </Button>
      )}
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
