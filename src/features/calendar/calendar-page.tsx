import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, parseISO,
  startOfMonth, startOfWeek, subMonths, subWeeks,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { cn } from '@/lib/utils'
import { useIsPhone } from '@/hooks/use-media-query'
import { qk } from '@/lib/query-keys'
import {
  groupByDay, KIND_LABELS, KIND_LABELS_FILTRO, KIND_TONES, monthGrid, weekDays,
  type CalendarEvent, type EventKind,
} from '@/domain/plan/calendar'
import { calendarRepo } from '@/data/repositories/calendar.repo'
import { DescargarIcs } from '@/features/calendar/ics-button'

/**
 * Calendario de todo lo que tiene fecha: vencimientos e inicios de tarea,
 * reuniones e hitos.
 *
 * El criterio de aceptación de la fase es «cada usuario ve en el calendario
 * solo los eventos de sus trabajos», y esta pantalla NO contiene ni una línea
 * que lo implemente: lo cumplen `tasks_select`, `meetings_select` y
 * `milestones_select` en PostgreSQL. Filtrarlo también aquí daría dos reglas
 * que mantener en paralelo, y la del cliente sería la que se quedara atrás.
 * Lo que sí hay aquí son filtros de COMODIDAD —por tipo de evento y por
 * trabajo—, que es otra cosa: quitan ruido de la vista, no ocultan nada.
 */

type Vista = 'mes' | 'semana' | 'agenda'

const VISTAS: { value: Vista; label: string }[] = [
  { value: 'mes', label: 'Mes' },
  { value: 'semana', label: 'Semana' },
  { value: 'agenda', label: 'Agenda' },
]

const TIPOS: EventKind[] = ['MEETING', 'MILESTONE', 'TASK_DUE', 'TASK_START']

export function CalendarPage() {
  /**
   * En un teléfono arranca en AGENDA, no en mes.
   *
   * La vista de mes es una rejilla de siete columnas con un ancho mínimo de
   * 44 rem: en una pantalla de 390 px existe, se desplaza y es inútil —cada
   * día son 55 px y no cabe ni el título de un evento—. La agenda es una
   * lista, que es la forma correcta de leer fechas en vertical.
   *
   * Es el valor INICIAL, no una imposición: los tres botones siguen ahí y
   * girar el móvil no te cambia la vista que hayas elegido a mano.
   */
  const esMovil = useIsPhone()
  const [vista, setVista] = React.useState<Vista>(esMovil ? 'agenda' : 'mes')
  const [ancla, setAncla] = React.useState(new Date())
  const [ocultos, setOcultos] = React.useState<EventKind[]>([])
  const [trabajo, setTrabajo] = React.useState<string>('')

  // La ventana que se pide al servidor es la de la vista, con un margen: así
  // cambiar de mes no vacía la pantalla mientras llega la consulta siguiente.
  const { desde, hasta } = React.useMemo(() => {
    if (vista === 'semana') {
      return {
        desde: format(subWeeks(startOfWeek(ancla, { weekStartsOn: 1 }), 1), 'yyyy-MM-dd'),
        hasta: format(addWeeks(endOfWeek(ancla, { weekStartsOn: 1 }), 1), 'yyyy-MM-dd'),
      }
    }
    return {
      desde: format(subMonths(startOfMonth(ancla), 1), 'yyyy-MM-dd'),
      hasta: format(addMonths(endOfMonth(ancla), 1), 'yyyy-MM-dd'),
    }
  }, [vista, ancla])

  const eventos = useQuery({
    queryKey: qk.calendar(desde, hasta),
    queryFn: () => calendarRepo.events(desde, hasta),
  })

  // En su propio useMemo porque `?? []` crea un array nuevo en cada render, y
  // eso invalidaría el useMemo de abajo siempre.
  const todos = React.useMemo(() => eventos.data ?? [], [eventos.data])
  const trabajos = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const e of todos) m.set(e.workId, e.workTitle ?? 'Trabajo sin título')
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [todos])

  // El mismo criterio para la pantalla y para la descarga: dos copias de esta
  // condición acabarían diciendo cosas distintas.
  const visible = React.useCallback(
    (e: CalendarEvent) => !ocultos.includes(e.kind) && (trabajo === '' || e.workId === trabajo),
    [ocultos, trabajo],
  )
  const visibles = todos.filter(visible)
  const porDia = groupByDay(visibles)

  const nombreCalendario =
    trabajo === ''
      ? 'Thesis Manager · mis fechas'
      : `Thesis Manager · ${trabajos.find(([id]) => id === trabajo)?.[1] ?? 'trabajo'}`

  const mover = (paso: -1 | 1) =>
    setAncla((d) => (vista === 'semana' ? addWeeks(d, paso) : addMonths(d, paso)))

  const titulo =
    vista === 'semana'
      ? `Semana del ${format(startOfWeek(ancla, { weekStartsOn: 1 }), "d 'de' MMMM yyyy", { locale: es })}`
      : format(ancla, "MMMM 'de' yyyy", { locale: es })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendario"
        description="Vencimientos, reuniones e hitos de los trabajos a los que tienes acceso. Puedes descargarlas a tu propio calendario: el fichero es una foto del día de hoy, no una suscripción, así que si una fecha cambia hay que volver a descargarlo."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label="Vista del calendario">
              {VISTAS.map((v) => (
                <Button
                  key={v.value}
                  size="sm"
                  variant={vista === v.value ? 'secondary' : 'ghost'}
                  aria-pressed={vista === v.value}
                  onClick={() => setVista(v.value)}
                >
                  {v.label}
                </Button>
              ))}
            </div>
            {/* Se lleva lo que se está viendo —los mismos filtros—, pero de una
                ventana mucho más ancha que la del mes a la vista: quien baja
                sus fechas las quiere todas, no las de esta pantalla. */}
            <DescargarIcs
              etiqueta={nombreCalendario}
              nombre={nombreCalendario}
              filtrar={visible}
            />
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-3 p-3">
          {/* DOS BLOQUES, Y EN UN MÓVIL DOS FILAS: a la izquierda moverse por
              el tiempo, a la derecha filtrar. Era todo una sola fila con un
              `ml-auto`, y en un teléfono se desbordaba por la derecha. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => mover(-1)} aria-label="Anterior">
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon" onClick={() => mover(1)} aria-label="Siguiente">
                <ChevronRight />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAncla(new Date())}>Hoy</Button>
              <span className="min-w-0 text-sm font-medium capitalize">{titulo}</span>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:ml-auto sm:justify-end">
              {TIPOS.map((k) => {
                const activo = !ocultos.includes(k)
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={activo}
                    // El rótulo largo —«Vencimiento de tarea»— se queda en el
                    // `title` y para el lector de pantalla: lo que se ve es
                    // una palabra, que es lo que cabe. Ver `KIND_LABELS_FILTRO`.
                    title={`Mostrar u ocultar: ${KIND_LABELS[k]}`}
                    aria-label={KIND_LABELS[k]}
                    onClick={() =>
                      setOcultos((prev) => (activo ? [...prev, k] : prev.filter((x) => x !== k)))
                    }
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs transition-colors',
                      activo ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {KIND_LABELS_FILTRO[k]}
                  </button>
                )
              })}
              {trabajos.length > 1 && (
                /* UN `select` NO SE ENCOGE SOLO: el navegador lo dibuja tan
                   ancho como su opción más larga, y aquí las opciones son
                   títulos de trabajos de ochenta caracteres. Eso era lo que
                   ensanchaba la página en el móvil. Con un ancho declarado
                   —toda la fila en el teléfono, un tope de 16 rem a partir de
                   `sm`— el texto se recorta dentro y la página no se mueve. */
                <select
                  value={trabajo}
                  onChange={(e) => setTrabajo(e.target.value)}
                  aria-label="Filtrar por trabajo"
                  className="h-7 w-full min-w-0 truncate rounded-md border border-input bg-background px-2 text-xs sm:w-auto sm:max-w-[16rem]"
                >
                  <option value="">Todos los trabajos</option>
                  {trabajos.map(([id, t]) => (
                    <option key={id} value={id}>{t}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {eventos.isLoading ? (
            <LoadingPanel label="Cargando el calendario…" />
          ) : eventos.isError ? (
            <ErrorPanel error={eventos.error} />
          ) : vista === 'mes' ? (
            <MonthView month={ancla} porDia={porDia} />
          ) : vista === 'semana' ? (
            <WeekView date={ancla} porDia={porDia} />
          ) : (
            <AgendaView eventos={visibles} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DayEvents({ eventos, compacto }: { eventos: CalendarEvent[]; compacto?: boolean }) {
  return (
    <ul className="space-y-0.5">
      {eventos.map((e) => (
        <li key={e.id}>
          <Link
            to={e.href}
            title={`${KIND_LABELS[e.kind]}: ${e.title}${e.workTitle ? ` · ${e.workTitle}` : ''}`}
            className={cn(
              'block truncate rounded px-1 py-0.5 text-[11px] hover:bg-accent',
              e.done && 'text-muted-foreground line-through',
            )}
          >
            <span
              className={cn(
                'mr-1 inline-block size-1.5 rounded-full align-middle',
                e.kind === 'MEETING' && 'bg-blue-500',
                e.kind === 'MILESTONE' && 'bg-violet-500',
                e.kind === 'TASK_DUE' && 'bg-amber-500',
                e.kind === 'TASK_START' && 'bg-slate-400',
              )}
              aria-hidden
            />
            {e.time && <span className="mr-1 text-muted-foreground">{e.time}</span>}
            {e.title}
            {!compacto && e.workTitle && (
              <span className="ml-1 text-muted-foreground">· {e.workTitle}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function MonthView({ month, porDia }: { month: Date; porDia: Map<string, CalendarEvent[]> }) {
  const semanas = monthGrid(month)
  const hoy = format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
            <div key={d} className="px-2 py-1">{d}</div>
          ))}
        </div>
        {semanas.map((semana, i) => (
          <div key={i} className="grid grid-cols-7 border-b last:border-b-0">
            {semana.map((d) => (
              <div
                key={d.day}
                className={cn(
                  'min-h-[5.5rem] border-r p-1 last:border-r-0',
                  !d.inMonth && 'bg-muted/30',
                  d.day === hoy && 'bg-primary/5',
                )}
              >
                <p
                  className={cn(
                    'mb-0.5 px-1 text-xs',
                    !d.inMonth && 'text-muted-foreground',
                    d.day === hoy && 'font-semibold text-primary',
                  )}
                >
                  {Number(d.day.slice(-2))}
                </p>
                <DayEvents eventos={porDia.get(d.day) ?? []} compacto />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function WeekView({ date, porDia }: { date: Date; porDia: Map<string, CalendarEvent[]> }) {
  const dias = weekDays(date)
  const hoy = new Date()

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
      {dias.map((d) => {
        const fecha = parseISO(d)
        return (
          <div
            key={d}
            className={cn('rounded-lg border p-2', isSameDay(fecha, hoy) && 'border-primary bg-primary/5')}
          >
            <p className="mb-1 text-xs font-medium capitalize">
              {format(fecha, 'EEE d', { locale: es })}
            </p>
            {(porDia.get(d) ?? []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground">—</p>
            ) : (
              <DayEvents eventos={porDia.get(d) ?? []} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function AgendaView({ eventos }: { eventos: CalendarEvent[] }) {
  if (eventos.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Nada en este periodo"
        description="No hay vencimientos, reuniones ni hitos con los filtros activos."
      />
    )
  }

  const porDia = groupByDay(eventos)
  return (
    <ul className="divide-y">
      {[...porDia.entries()].map(([dia, lista]) => (
        <li key={dia} className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
          <p className="w-40 shrink-0 text-sm font-medium capitalize">
            {format(parseISO(dia), "EEEE d 'de' MMMM", { locale: es })}
          </p>
          <ul className="min-w-0 flex-1 space-y-1">
            {lista.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <ToneBadge tone={KIND_TONES[e.kind]}>{KIND_LABELS[e.kind]}</ToneBadge>
                {e.time && <span className="text-xs text-muted-foreground">{e.time}</span>}
                <Link
                  to={e.href}
                  className={cn('min-w-0 hover:underline', e.done && 'text-muted-foreground line-through')}
                >
                  {e.title}
                </Link>
                {e.workTitle && <span className="text-xs text-muted-foreground">· {e.workTitle}</span>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
