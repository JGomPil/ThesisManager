import * as React from 'react'
import { CalendarRange, ChevronLeft, ChevronRight, Flag } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useIsPhone } from '@/hooks/use-media-query'
import { Button } from '@/components/ui/button'
import {
  buildGantt, HEADER_HEIGHT, ROW_HEIGHT, type GanttInput,
} from '@/domain/plan/gantt'
import { blockedByDependencies, topologicalOrder, type Dep } from '@/domain/plan/dependencies'
import type { MilestoneRow } from '@/data/types/database'

/**
 * Cronograma en SVG propio.
 *
 * No hay librería de Gantt porque no hace falta ninguna: el cálculo está en
 * `src/domain/plan/gantt.ts` (probado aparte, sin montar nada) y el dibujo son
 * rectángulos. Una dependencia traería su modelo de datos, su CSS y su peso al
 * bundle para resolver un problema que ya está resuelto, y en un sitio alojado
 * en GitHub Pages el tamaño del bundle lo paga el usuario en cada visita.
 *
 * Las columnas van en dos mitades: los nombres a la izquierda, fijos, y la
 * escala temporal a la derecha, con desplazamiento horizontal. Las dos usan la
 * misma altura de fila, que es lo que mantiene alineado el nombre con su barra.
 */

const ESCALAS = [
  { label: 'Año', pxPerDay: 3 },
  { label: 'Mes', pxPerDay: 8 },
  { label: 'Semana', pxPerDay: 22 },
] as const

const RELLENO: Record<string, string> = {
  PENDIENTE: 'fill-slate-400',
  EN_CURSO: 'fill-blue-500',
  BLOQUEADA: 'fill-red-500',
  EN_REVISION: 'fill-amber-500',
  COMPLETADA: 'fill-emerald-500',
}

/**
 * Ancho de la columna de nombres. En un teléfono, 200 px de los ~360 útiles se
 * los comían los títulos y al cronograma —que es lo que se viene a ver— le
 * quedaban 160. El nombre se recorta (sigue completo en el `title`) y las
 * barras recuperan la mitad del ancho.
 */
const NOMBRES = 200
const NOMBRES_MOVIL = 104

export function GanttChart({
  tasks, milestones, dependencies, estados, anchoNombres: anchoPedido,
}: {
  tasks: GanttInput[]
  milestones: MilestoneRow[]
  dependencies: Dep[]
  /**
   * Ancho de la columna de nombres, en píxeles. Lo usa la vista a pantalla
   * completa: con el ancho de la ventana entera, 200 px recortan títulos que
   * ya caben de sobra. En el móvil se ignora, que es donde el recorte tiene
   * sentido.
   */
  anchoNombres?: number
  /**
   * Estados de TODAS las tareas del trabajo, subtareas incluidas.
   *
   * El cronograma dibuja solo las de primer nivel, pero una de ellas puede
   * esperar a una subtarea de otra. `blockedByDependencies` trata como «no
   * visible» —y por tanto como no bloqueante— cualquier dependencia cuyo estado
   * no conozca, así que sin esta lista una tarea realmente bloqueada se
   * dibujaría normal y nadie se enteraría. Si no se pasa, se usan las dibujadas.
   */
  estados?: { id: string; status: string }[]
}) {
  const anchoNombres = useIsPhone() ? NOMBRES_MOVIL : (anchoPedido ?? NOMBRES)
  const [escala, setEscala] = React.useState(1)
  const pxPerDay = ESCALAS[escala]!.pxPerDay

  /**
   * EL PANEL DEL TIEMPO SE DESLIZA, Y HAY QUE DECIRLO.
   *
   * Un plan de más de un año no cabe en ninguna pantalla: a 8 px por día, doce
   * meses son casi tres mil píxeles. El panel siempre tuvo `overflow-x-auto`,
   * o sea que se podía arrastrar, pero no había ni un indicio de que se
   * pudiera, así que el cronograma «se veía incompleto»: lo que no entraba no
   * existía. Ahora hay dos flechas y un «Hoy», y un aviso que solo sale cuando
   * de verdad sobra cronograma por los lados.
   *
   * `desbordado` se MIDE, no se calcula: comparar `layout.width` con un ancho
   * supuesto sería adivinar, y este dibujo se usa en la tarjeta (un tercio de
   * la ficha) y a pantalla completa. `ResizeObserver` lo vuelve a medir cuando
   * la ventana cambia o cuando se pasa a pantalla completa.
   */
  const panel = React.useRef<HTMLDivElement>(null)
  const [desbordado, setDesbordado] = React.useState(false)

  React.useEffect(() => {
    const el = panel.current
    if (!el) return
    // El margen de 4 px evita que un redondeo de medio píxel anuncie un
    // desplazamiento que no existe.
    const medir = () => setDesbordado(el.scrollWidth > el.clientWidth + 4)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pxPerDay, tasks.length, milestones.length])

  const deslizar = (sentido: 1 | -1) => {
    const el = panel.current
    if (!el) return
    el.scrollBy({ left: sentido * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  // Orden topológico: lo que hay que hacer antes aparece antes, aunque la
  // dirección haya introducido las tareas en otro orden.
  const ordenadas = React.useMemo(() => {
    const porId = new Map(tasks.map((t) => [t.id, t]))
    return topologicalOrder(tasks.map((t) => t.id), dependencies)
      .map((id) => porId.get(id)!)
      .filter(Boolean)
  }, [tasks, dependencies])

  const bloqueadas = React.useMemo(
    () => blockedByDependencies(
      estados ?? tasks.map((t) => ({ id: t.id, status: t.status })),
      dependencies,
    ),
    [estados, tasks, dependencies],
  )

  const layout = React.useMemo(
    () => buildGantt(ordenadas, milestones.map((m) => ({
      id: m.id, name: m.name, due_date: m.due_date, is_met: m.is_met,
    })), { pxPerDay }),
    [ordenadas, milestones, pxPerDay],
  )

  // Al entrar, el cronograma se coloca en HOY y no en el principio: en un plan
  // de año y medio el extremo izquierdo es el pasado, y lo que se viene a ver
  // es esta semana. Se recoloca también al cambiar de escala, porque con otros
  // píxeles por día la posición anterior ya no significa lo mismo.
  React.useEffect(() => {
    const el = panel.current
    if (!el || layout.todayX === null) return
    el.scrollLeft = Math.max(0, layout.todayX - el.clientWidth / 2)
  }, [layout.todayX])

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        El cronograma se dibuja a partir de las fechas de las tareas. Todavía no hay ninguna.
      </p>
    )
  }

  const posiciones = new Map(layout.bars.map((b) => [b.id, b]))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarRange className="size-3.5" />
          {format(layout.from, 'd MMM yyyy', { locale: es })} – {format(layout.to, 'd MMM yyyy', { locale: es })}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {/* Deslizar por los lados. Solo aparece si hay algo fuera de la
              vista: un par de flechas que no llevan a ninguna parte son peor
              que no tenerlas. En un móvil son además la única forma cómoda,
              porque arrastrar dentro del panel compite con el gesto de
              desplazar la página. */}
          {desbordado && (
            <div className="flex items-center gap-1" role="group" aria-label="Desplazar el cronograma">
              <Button size="icon" variant="ghost" className="size-7" onClick={() => deslizar(-1)} aria-label="Ver antes">
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => deslizar(1)} aria-label="Ver después">
                <ChevronRight className="size-4" />
              </Button>
              {layout.todayX !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const el = panel.current
                    if (!el || layout.todayX === null) return
                    el.scrollTo({ left: Math.max(0, layout.todayX - el.clientWidth / 2), behavior: 'smooth' })
                  }}
                >
                  Hoy
                </Button>
              )}
            </div>
          )}
          <div className="flex gap-1" role="group" aria-label="Escala del cronograma">
            {ESCALAS.map((e, i) => (
              <Button
                key={e.label}
                size="sm"
                variant={i === escala ? 'secondary' : 'ghost'}
                aria-pressed={i === escala}
                onClick={() => setEscala(i)}
              >
                {e.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex rounded-lg border">
        {/* Nombres */}
        <div className="shrink-0 border-r" style={{ width: anchoNombres }}>
          <div className="border-b bg-muted/40" style={{ height: HEADER_HEIGHT }} />
          {layout.bars.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-1 overflow-hidden px-2 text-xs"
              style={{ height: ROW_HEIGHT }}
              title={b.title}
            >
              {b.isSubtask && <span className="text-muted-foreground" aria-hidden>↳</span>}
              <span className={cn('truncate', bloqueadas.has(b.id) && 'text-red-600 dark:text-red-400')}>
                {b.title}
              </span>
            </div>
          ))}
        </div>

        {/* Escala temporal */}
        <div ref={panel} className="min-w-0 flex-1 overflow-x-auto">
          <svg
            width={Math.max(layout.width, 320)}
            height={layout.height}
            role="img"
            aria-label={`Cronograma con ${layout.bars.length} tareas`}
          >
            {/* Rejilla y encabezado */}
            <rect x={0} y={0} width="100%" height={HEADER_HEIGHT} className="fill-muted/40" />
            {layout.ticks.map((t) => (
              <g key={`${t.x}-${t.label}`}>
                <line
                  x1={t.x} y1={0} x2={t.x} y2={layout.height}
                  className={cn('stroke-border', t.isMonthStart ? 'opacity-100' : 'opacity-40')}
                />
                <text
                  x={t.x + 3} y={HEADER_HEIGHT - 9}
                  className={cn('fill-muted-foreground text-[9px]', t.isMonthStart && 'font-medium')}
                >
                  {t.label}
                </text>
              </g>
            ))}

            {/* Dependencias: de donde acaba la tarea previa a donde empieza la
                siguiente. Una línea quebrada en lugar de una curva, porque a
                tres píxeles por día una curva es una mancha. */}
            {dependencies.map((d) => {
              const desde = posiciones.get(d.depends_on_task_id)
              const hasta = posiciones.get(d.task_id)
              if (!desde || !hasta) return null
              const x1 = desde.x + desde.width
              const y1 = desde.y + ROW_HEIGHT / 2
              const x2 = hasta.x
              const y2 = hasta.y + ROW_HEIGHT / 2
              const medio = Math.max(x1 + 4, x2 - 6)
              return (
                <polyline
                  key={`${d.task_id}-${d.depends_on_task_id}`}
                  points={`${x1},${y1} ${medio},${y1} ${medio},${y2} ${x2},${y2}`}
                  className="fill-none stroke-muted-foreground opacity-60"
                  strokeWidth={1}
                />
              )
            })}

            {/* Barras */}
            {layout.bars.map((b) => (
              <g key={b.id}>
                <rect
                  x={b.x}
                  y={b.y + 5}
                  width={b.width}
                  height={ROW_HEIGHT - 12}
                  rx={3}
                  className={cn(RELLENO[b.status] ?? 'fill-slate-400', b.isSubtask && 'opacity-70')}
                />
                {bloqueadas.has(b.id) && (
                  <rect
                    x={b.x} y={b.y + 5} width={b.width} height={ROW_HEIGHT - 12} rx={3}
                    className="fill-none stroke-red-500" strokeWidth={1.5} strokeDasharray="3 2"
                  />
                )}
              </g>
            ))}

            {/* Hitos: un rombo en su fecha, de arriba abajo. */}
            {layout.marks.map((m) => (
              <g key={m.id}>
                <line
                  x1={m.x} y1={HEADER_HEIGHT} x2={m.x} y2={layout.height}
                  className={cn('stroke-violet-500', m.isMet ? 'opacity-40' : 'opacity-80')}
                  strokeDasharray="4 3"
                />
                <polygon
                  points={`${m.x},${HEADER_HEIGHT - 14} ${m.x + 5},${HEADER_HEIGHT - 9} ${m.x},${HEADER_HEIGHT - 4} ${m.x - 5},${HEADER_HEIGHT - 9}`}
                  className={cn(m.isMet ? 'fill-violet-400 opacity-60' : 'fill-violet-600')}
                />
              </g>
            ))}

            {/* Hoy */}
            {layout.todayX !== null && (
              <line
                x1={layout.todayX} y1={0} x2={layout.todayX} y2={layout.height}
                className="stroke-primary" strokeWidth={1.5}
              />
            )}
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {desbordado && (
          <span>
            El plan no cabe de una vez: desliza el cronograma o usa las flechas. «Año» lo comprime.
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm bg-primary" /> hoy
        </span>
        <span className="flex items-center gap-1">
          <Flag className="size-3 text-violet-600" /> hito
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm border border-dashed border-red-500" />
          esperando a otra tarea
        </span>
      </div>

      {layout.undated.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <strong>{layout.undated.length} tarea(s) sin fechas</strong> no se dibujan en el
          cronograma: {layout.undated.map((t) => t.title).join(', ')}. Ponles fecha de inicio o de
          vencimiento para que aparezcan.
        </p>
      )}

      {milestones.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Hitos: {milestones.map((m) => `${m.name} (${format(parseISO(m.due_date), 'd MMM', { locale: es })})`).join(' · ')}
        </p>
      )}
    </div>
  )
}
