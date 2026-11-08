import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check, ChevronLeft, ChevronRight, KanbanSquare, List, ListChecks, Pencil, Plus, RotateCcw,
  Trash2, X,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState, ErrorPanel, FieldError, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import {
  TASK_PRIORITIES, TASK_STATUSES, tasksRepo, type TaskWithAssignee,
} from '@/data/repositories/tasks.repo'
import {
  coloresEnUso, columnKeyOf, groupCards, planCardMove, resolveBoard, siguienteOrden,
  type BoardColumn,
} from '@/domain/plan/board'
import { moveItem, reorderWrites } from '@/domain/plan/reorder'
import type { WorkWithRelations } from '@/data/repositories/works.repo'
import type { BoardColumnRow, TaskStatus } from '@/data/types/database'
import { taskFormSchema, type TaskFormValues } from '@/schemas/work'
import { canUpdateTaskStatus, type WorkCapabilities } from '@/domain/permissions/work-capabilities'
import { daysUntil } from '@/domain/works/progress'
import { cn, toneClass, toneEdgeClass, TONES } from '@/lib/utils'
import { TaskDetailDialog } from '@/features/tasks/task-detail-dialog'
import { propsDeApertura } from '@/components/common/row-link'
import { useIsPhone } from '@/hooks/use-media-query'
import { useScrollX } from '@/hooks/use-scroll-x'

export function TaskBoard({
  work,
  caps,
  userId,
}: {
  work: WorkWithRelations
  caps: WorkCapabilities
  userId: string | null
}) {
  /**
   * En el móvil arranca en LISTA, igual que el calendario arranca en «agenda».
   *
   * Un tablero kanban son columnas en paralelo, y en una pantalla de 360 px no
   * hay sitio para dos: o se aprietan hasta no leerse o hay que arrastrar a lo
   * ancho buscando la columna, que es lo que de verdad pasaba. La lista es la
   * misma información en vertical, que es por donde se desplaza un móvil.
   *
   * Es el valor INICIAL, no una imposición: los dos botones siguen ahí y girar
   * el móvil no cambia la vista que se haya elegido a mano.
   */
  const esMovil = useIsPhone()
  const [view, setView] = React.useState<'kanban' | 'list'>(esMovil ? 'list' : 'kanban')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)
  // La tarea que se está editando. Es un identificador y no la tarea entera a
  // propósito: así el formulario siempre arranca con lo que hay en la caché
  // recién invalidada, y no con una copia de hace tres pantallas.
  const [editTaskId, setEditTaskId] = React.useState<string | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const tasks = useQuery({ queryKey: qk.tasks.byWork(work.id), queryFn: () => tasksRepo.byWork(work.id) })

  /**
   * Las columnas de ESTE tablero (migración 0024). Son del trabajo, como los
   * hitos, y las administra quien lo dirige. Mientras no haya ninguna, el
   * tablero agrupa por estado igual que siempre; lo decide `resolveBoard`.
   */
  const columnas = useQuery({
    queryKey: qk.tasks.boardColumns(work.id),
    queryFn: () => tasksRepo.boardColumns(work.id),
  })

  // Qué columna se está renombrando, y el formulario de la columna nueva.
  const [editando, setEditando] = React.useState<string | null>(null)
  const [anadiendo, setAnadiendo] = React.useState(false)

  // El tablero se desliza a lo ancho: puede haber tantas columnas como haga
  // falta. Mismo comportamiento —y mismo código— que el cronograma.
  const { panel, desbordado, deslizar, acompanarArrastre } = useScrollX(
    (columnas.data ?? []).length,
  )

  /**
   * Filtro por color. Vacío = todas.
   *
   * Un color que no se puede filtrar es decoración: sirve para reconocer una
   * tarjeta de un vistazo, pero no para contestar «¿qué me queda de esto?».
   * Filtra las dos vistas, el tablero y la lista, porque es la misma pregunta.
   */
  const [filtroColor, setFiltroColor] = React.useState<string | null>(null)

  // Qué COLUMNA se arrastra y sobre cuál está. Es un arrastre distinto del de
  // las tarjetas y con su propio estado: los dos gestos conviven en el mismo
  // sitio, y cada manejador comprueba cuál está en marcha antes de hacer nada.
  // Si compartieran estado, soltar una tarjeta movería una columna.
  const [colArrastrada, setColArrastrada] = React.useState<string | null>(null)
  const [colDestino, setColDestino] = React.useState<string | null>(null)

  // Qué tarjeta se arrastra y dónde caería. Solo sirve para pintar la pista;
  // el movimiento lo calcula `planCardMove` con los datos de la consulta, así
  // que no hay copia local del tablero que pueda discrepar de la real.
  const [arrastrada, setArrastrada] = React.useState<string | null>(null)
  const [destino, setDestino] = React.useState<{ columna: string; antesDe: string | null } | null>(null)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.tasks.all })
  }

  const mover = useMutation({
    mutationFn: tasksRepo.applyBoardMoves,
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  /**
   * El estado de la tarea, que es un dato SUYO y no la columna donde está.
   * Desde que las columnas tienen el nombre que quiera quien dirige el trabajo,
   * «Papers» no dice si eso está pendiente o en curso: lo dice esto, en la
   * tarjeta, que es donde se mira.
   */
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => tasksRepo.setStatus(id, status),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const invalidarColumnas = () => {
    void qc.invalidateQueries({ queryKey: qk.tasks.boardColumns(work.id) })
  }

  const crearColumna = useMutation({
    mutationFn: (campos: { name: string; color: string }) =>
      tasksRepo.createBoardColumn({
        work_id: work.id,
        ...campos,
        display_order: siguienteOrden(columnas.data ?? []),
      }),
    onSuccess: () => { invalidarColumnas(); setAnadiendo(false) },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const editarColumna = useMutation({
    mutationFn: ({ id, ...campos }: { id: string; name: string; color: string }) =>
      tasksRepo.updateBoardColumn(id, campos),
    onSuccess: () => { invalidarColumnas(); setEditando(null) },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const borrarColumna = useMutation({
    mutationFn: (id: string) => tasksRepo.removeBoardColumn(id),
    onSuccess: invalidarColumnas,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  // Reordenar reutiliza el cálculo de la lista de comprobación: mover una
  // columna un puesto son DOS escrituras, no el tablero entero.
  const reordenarColumnas = useMutation({
    mutationFn: (orden: BoardColumnRow[]) =>
      tasksRepo.reorderBoardColumns(
        reorderWrites(orden.map((c) => ({ id: c.id, order_index: c.display_order })))
          .map((c) => ({ id: c.id, display_order: c.order_index })),
      ),
    onSuccess: invalidarColumnas,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const crearTablero = useMutation({
    mutationFn: () => tasksRepo.seedBoardColumns(work.id, (tasks.data ?? []).filter((t) => t.parent_task_id === null)),
    onSuccess: () => {
      invalidate()
      invalidarColumnas()
      toast.push('success', 'Tablero creado. Renombra las columnas y arrastra las tarjetas a tu gusto.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  /**
   * LA PAPELERA DE LA TARJETA ARCHIVA, no borra (0025).
   *
   * Antes era `delete from tasks`: definitivo, en cascada sobre las subtareas,
   * de un clic y sin preguntar. Una tarea borrada sin querer no se podía
   * recuperar de ninguna manera. Y no basta con poner un «¿seguro?» delante:
   * un icono que está al lado del resto se pulsa sin leer, y la pregunta
   * acaba contestada sola. Así que lo que se pulsa es reversible, y el borrado
   * de verdad se decide después, mirando la papelera.
   */
  const archivar = useMutation({
    mutationFn: (id: string) => tasksRepo.archive(id),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: qk.tasks.archived(work.id) })
      toast.push('success', 'Tarea a la papelera. Está al final del plan de trabajo, con «Restaurar».')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const papelera = useQuery({
    queryKey: qk.tasks.archived(work.id),
    queryFn: () => tasksRepo.archived(work.id),
    // Solo quien planifica ve lo archivado: a los demás la política de la 0025
    // no les devuelve ni una fila, así que la consulta sobra.
    enabled: caps.canManagePlan,
  })

  const restaurar = useMutation({
    mutationFn: (id: string) => tasksRepo.restore(id),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: qk.tasks.archived(work.id) })
      toast.push('success', 'Tarea restaurada.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const borrarDeVerdad = useMutation({
    mutationFn: (id: string) => tasksRepo.destroy(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.tasks.archived(work.id) })
      toast.push('success', 'Tarea borrada definitivamente.')
    },
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
  const principales = all.filter((t) => t.parent_task_id === null)
  const coloresDisponibles = coloresEnUso(principales, TONES)
  // Si el único color del filtro deja de existir en el plan, el filtro se
  // ignora: más valdría eso que un tablero vacío sin explicación.
  const filtroVivo = filtroColor !== null && coloresDisponibles.includes(filtroColor)
    ? filtroColor : null
  const rows = filtroVivo === null ? principales : principales.filter((t) => t.color === filtroVivo)
  const subtasksOf = (id: string) => all.filter((t) => t.parent_task_id === id)

  const filasColumnas = columnas.data ?? []
  const tablero = resolveBoard(filasColumnas)
  const porColumna = groupCards(rows, tablero)
  /** Sin columnas propias, el tablero es el de siempre: una por estado. */
  const porEstado = filasColumnas.length === 0

  /**
   * Quién puede arrastrar una tarjeta: quien planifica, cualquiera; y quien
   * solo informa de lo suyo, la suya. Sin permiso para ordenar, la tarjeta se
   * va al final de la columna de destino y no se renumera ninguna vecina: RLS
   * le descartaría esas filas en silencio y el tablero quedaría a medias.
   */
  const puedeArrastrar = (t: TaskWithAssignee) =>
    caps.canManagePlan || canUpdateTaskStatus(caps, t, userId)

  /** Suelta la tarjeta arrastrada en una columna, delante de `antesDe`. */
  const soltar = (columna: string, antesDe: string | null) => {
    if (arrastrada === null) return
    const movimientos = planCardMove({
      tarjetas: rows, columnas: tablero, arrastradaId: arrastrada, destinoKey: columna, antesDe,
      puedeOrdenar: caps.canManagePlan,
    })
    setArrastrada(null)
    setDestino(null)
    // Ni petición ni invalidación si la tarjeta vuelve a su sitio: el tablero
    // no debe parpadear por un arrastre que no cambia nada.
    if (movimientos.length > 0) mover.mutate(movimientos)
  }

  /** Mover sin arrastrar: el desplegable de la tarjeta y de la lista. */
  const moverA = (tareaId: string, columnaKey: string) => {
    const movimientos = planCardMove({
      tarjetas: rows, columnas: tablero, arrastradaId: tareaId, destinoKey: columnaKey, antesDe: null,
      puedeOrdenar: caps.canManagePlan,
    })
    if (movimientos.length > 0) mover.mutate(movimientos)
  }
  /**
   * Soltar la columna arrastrada sobre otra: se coloca en el sitio de esa.
   *
   * El cálculo es el mismo `moveItem` de la lista de comprobación, y las
   * escrituras las mismas que las flechas: solo las columnas cuyo orden deja de
   * coincidir con su posición.
   */
  const soltarColumna = (sobreId: string) => {
    const desde = filasColumnas.findIndex((c) => c.id === colArrastrada)
    const hasta = filasColumnas.findIndex((c) => c.id === sobreId)
    setColArrastrada(null)
    setColDestino(null)
    if (desde < 0 || hasta < 0 || desde === hasta) return
    const orden = moveItem(filasColumnas, desde, hasta)
    if (orden !== filasColumnas) reordenarColumnas.mutate(orden)
  }

  /** Mover una columna un puesto a la izquierda o a la derecha. */
  const moverColumna = (desde: number, hasta: number) => {
    const orden = moveItem(filasColumnas, desde, hasta)
    if (orden !== filasColumnas) reordenarColumnas.mutate(orden)
  }

  const openTask = rows.find((t) => t.id === openTaskId) ?? null
  const editTask = rows.find((t) => t.id === editTaskId) ?? null

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

      {/* Las pastillas de color que SE ESTÁN usando, y solo esas: ofrecer los
          doce tonos serían once filtros que no devuelven nada. */}
      {coloresDisponibles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por color">
          <Button
            size="sm"
            variant={filtroVivo === null ? 'secondary' : 'ghost'}
            className="h-7 px-2 text-xs"
            onClick={() => setFiltroColor(null)}
          >
            Todas
          </Button>
          {coloresDisponibles.map((c) => {
            const cuantas = principales.filter((t) => t.color === c).length
            return (
              <button
                key={c}
                type="button"
                onClick={() => setFiltroColor(filtroVivo === c ? null : c)}
                aria-pressed={filtroVivo === c}
                aria-label={`Ver solo las tareas de este color (${cuantas})`}
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs tabular-nums',
                  toneClass(c),
                  filtroVivo === c && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                )}
              >
                {cuantas}
              </button>
            )
          })}
        </div>
      )}

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
        <>
          {/* SIN COLUMNAS PROPIAS el tablero agrupa por estado, que es lo que
              hacía antes de la 0024. No se siembra nada por sorpresa: el
              tablero propio se crea cuando alguien lo pide. */}
          {porEstado && caps.canManagePlan && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              <p className="min-w-0 flex-1">
                Este tablero agrupa las tarjetas <strong>por estado</strong>. Puedes crear tus
                propias columnas y ponerles el nombre que quieras —«Papers», «Estudios»—: las
                tareas que ya existen se reparten según el estado que tengan ahora, y a partir de
                ahí las mueves tú.
              </p>
              <Button
                size="sm" variant="outline" className="shrink-0"
                loading={crearTablero.isPending}
                onClick={() => crearTablero.mutate()}
              >
                <Plus /> Crear mis columnas
              </Button>
            </div>
          )}

          {/* Deslizar el tablero por los lados, cuando sobra tablero. Lo mismo
              que el cronograma, y por el mismo motivo: un panel que se puede
              arrastrar y no lo dice es un panel que «está incompleto». */}
          {desbordado && (
            <div className="flex items-center justify-end gap-1" role="group" aria-label="Desplazar el tablero">
              <span className="mr-auto text-xs text-muted-foreground">
                {tablero.length} columnas: desliza el tablero o usa las flechas.
              </span>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => deslizar(-1)} aria-label="Ver columnas anteriores">
                <ChevronLeft className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => deslizar(1)} aria-label="Ver columnas siguientes">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}

          {/* UNA COLUMNA POR FILA DEL TRABAJO, en su orden, EN UNA FILA QUE SE
              DESLIZA. Antes era una rejilla, y una rejilla reparte el ancho
              disponible: con seis columnas, las dos últimas caían a una segunda
              fila y el tablero dejaba de ser un tablero. Columnas de ancho fijo
              y desplazamiento horizontal es lo que hace Trello, y es lo único
              que no pone un tope a cuántas puede haber.

              Las tarjetas van en el orden guardado (`order_index`) y no
              agrupadas por estado: una pendiente puede estar debajo de una en
              curso, porque el orden dentro de la columna lo decide quien
              planifica. */}
          <div
            ref={panel}
            className="flex min-w-0 gap-3 overflow-x-auto pb-2"
            // Arrastrando una tarjeta cerca de un borde, el tablero acompaña:
            // el navegador no desplaza un panel con `overflow` por su cuenta, y
            // sin esto habría que soltar la tarjeta en medio, desplazar a mano y
            // volver a cogerla.
            onDragOver={(e) => { if (arrastrada !== null) acompanarArrastre(e.clientX) }}
          >
            {tablero.map((col, indice) => {
              const colTasks = porColumna.get(col.key) ?? []
              const esDestino = destino?.columna === col.key
              return (
                <div
                  key={col.key}
                  className={cn(
                    // Ancho fijo: una columna que se encoge con el número de
                    // columnas acaba sin sitio para el título de una tarjeta.
                    //
                    // EL FONDO DE LA COLUMNA NO ES ADORNO. El tablero se dibuja
                    // dentro de una tarjeta blanca (`bg-card`) y cada tarea es
                    // otra tarjeta blanca: sin este escalón de tono son blanco
                    // sobre blanco separados por un borde de 1 px al 91 % de
                    // luminosidad. En un teléfono apenas se nota —una tarjeta
                    // llena la pantalla—, pero en un monitor se ven quince a la
                    // vez y el tablero entero parece translúcido, «poco nítido».
                    // Con la columna en `muted` la jerarquía se lee de un
                    // vistazo: página → columna → tarjeta, que es lo que hacen
                    // Trello y Jira por el mismo motivo. Y funciona en los dos
                    // temas: en claro la columna es más oscura que la tarjeta y
                    // en oscuro más clara, pero en ambos hay un escalón.
                    'flex w-[17.5rem] shrink-0 flex-col gap-2 rounded-lg bg-muted p-2 transition-colors',
                    // Sobre un fondo que ya tiene tono, el 5 % no se distinguía:
                    // la columna de destino tiene que cantar mientras se arrastra.
                    esDestino && 'bg-primary/10 ring-1 ring-primary/40',
                    colArrastrada === col.id && 'opacity-50',
                    // La columna entera se va a colocar aquí: la barra va en el
                    // lado, porque el tablero se lee de izquierda a derecha.
                    colDestino === col.id && colArrastrada !== col.id
                      && 'border-l-2 border-primary pl-1',
                  )}
                  // Soltar sobre el hueco de la columna = al final de la
                  // columna. `onDragOver` con `preventDefault` es lo que
                  // convierte un elemento en zona donde se puede soltar; sin
                  // él, el navegador rechaza el gesto sin decir nada.
                  onDragOver={(e) => {
                    // Una columna arrastrada manda sobre una tarjeta: si no se
                    // distinguieran, soltar la columna dejaría además una
                    // tarjeta movida donde nadie la puso.
                    if (colArrastrada !== null && col.id !== null) {
                      e.preventDefault()
                      setColDestino(col.id)
                      return
                    }
                    if (arrastrada === null) return
                    e.preventDefault()
                    setDestino({ columna: col.key, antesDe: null })
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (colArrastrada !== null && col.id !== null) {
                      soltarColumna(col.id)
                      return
                    }
                    soltar(col.key, destino?.columna === col.key ? destino.antesDe : null)
                  }}
                >
                  {editando === col.id && col.id !== null ? (
                    <ColumnForm
                      inicial={{ name: col.name, color: col.color ?? 'slate' }}
                      pendiente={editarColumna.isPending}
                      onCancel={() => setEditando(null)}
                      onSave={(campos) => editarColumna.mutate({ id: col.id!, ...campos })}
                    />
                  ) : (
                    <div
                      className={cn(
                        // `flex-wrap`: en un teléfono la columna mide 280 px, y
                        // un nombre largo más los cuatro botones no caben en
                        // una línea. Sin esto los botones se salían de la
                        // columna, que es la razón de que en el móvil
                        // «no estuvieran»: en un escritorio sí caben.
                        'flex flex-wrap items-start gap-1 rounded px-1',
                        // El asa es la CABECERA, como en Trello, y no la columna
                        // entera: si lo fuera, empezar a arrastrar desde un hueco
                        // movería la columna cuando se quería mover una tarjeta.
                        caps.canManagePlan && col.id !== null && 'cursor-grab active:cursor-grabbing',
                      )}
                      draggable={caps.canManagePlan && col.id !== null}
                      title={
                        caps.canManagePlan && col.id !== null
                          ? 'Arrastra la cabecera para mover la columna entera'
                          : undefined
                      }
                      onDragStart={(e) => {
                        if (col.id === null) return
                        // Firefox no empieza ningún arrastre sin `setData`.
                        e.dataTransfer.setData('text/plain', col.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setColArrastrada(col.id)
                      }}
                      onDragEnd={() => { setColArrastrada(null); setColDestino(null) }}
                    >
                      {/* El nombre se parte en varias líneas si hace falta:
                          lo escribe una persona y en el móvil hay 280 px. */}
                      <ToneBadge tone={col.color} className="min-w-0 whitespace-normal break-words">
                        {col.name}
                      </ToneBadge>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {colTasks.length}
                      </span>
                      {/* Las acciones de la columna, en la columna: es donde se
                          buscan. Solo las tienen las columnas de verdad; el
                          tablero por estado no se puede renombrar porque esos
                          cinco nombres los lee el resto de la aplicación.

                          Van con `draggable={false}`: la cabecera es el asa de
                          la columna, y sin esto arrastrar desde un icono movería
                          la columna en lugar de pulsarlo. */}
                      {caps.canManagePlan && col.id !== null && (
                        <span className="ml-auto flex shrink-0 items-start" draggable={false}>
                          <Button
                            variant="ghost" size="icon" className="size-7"
                            disabled={indice === 0 || reordenarColumnas.isPending}
                            onClick={() => moverColumna(indice, indice - 1)}
                            aria-label={`Mover «${col.name}» a la izquierda`}
                          >
                            <ChevronLeft className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="size-7"
                            disabled={indice === tablero.length - 1 || reordenarColumnas.isPending}
                            onClick={() => moverColumna(indice, indice + 1)}
                            aria-label={`Mover «${col.name}» a la derecha`}
                          >
                            <ChevronRight className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="size-7"
                            onClick={() => { setAnadiendo(false); setEditando(col.id) }}
                            aria-label={`Renombrar «${col.name}»`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {/* Borrar, solo si está vacía: con tarjetas dentro la
                              clave ajena lo rechaza (`on delete restrict`), así
                              que el botón únicamente daría un error. */}
                          {colTasks.length === 0 && (
                            <Button
                              variant="ghost" size="icon" className="size-7"
                              onClick={() => borrarColumna.mutate(col.id!)}
                              aria-label={`Borrar «${col.name}»`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex min-h-8 flex-col gap-2">
                    {colTasks.map((t) => (
                      <div
                        key={t.id}
                        draggable={puedeArrastrar(t)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', t.id)
                          e.dataTransfer.effectAllowed = 'move'
                          setArrastrada(t.id)
                        }}
                        onDragEnd={() => { setArrastrada(null); setDestino(null) }}
                        onDragOver={(e) => {
                          if (arrastrada === null) return
                          e.preventDefault()
                          e.stopPropagation()
                          setDestino({ columna: col.key, antesDe: t.id })
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          soltar(col.key, t.id)
                        }}
                        className={cn(
                          'rounded-lg',
                          arrastrada === t.id && 'opacity-50',
                          // La barra de inserción: se verá por encima de la
                          // tarjeta delante de la que se va a soltar.
                          esDestino && destino?.antesDe === t.id && arrastrada !== t.id
                            && 'border-t-2 border-primary pt-1',
                        )}
                      >
                        <TaskCard
                          task={t}
                          subtasks={subtasksOf(t.id)}
                          caps={caps}
                          userId={userId}
                          columnas={porEstado ? [] : tablero}
                          columnaActual={columnKeyOf(t, tablero)}
                          onOpen={() => setOpenTaskId(t.id)}
                          onStatus={(status) => setStatus.mutate({ id: t.id, status })}
                          onMover={(key) => moverA(t.id, key)}
                          onRemove={() => archivar.mutate(t.id)}
                          arrastrable={puedeArrastrar(t)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* La columna nueva va al final del tablero, como en Trello: es el
                sitio donde se busca, y no un botón escondido en otra pantalla. */}
            {caps.canManagePlan && !porEstado && (
              <div className="w-[17.5rem] shrink-0 self-start rounded-lg border border-dashed p-2">
                {anadiendo ? (
                  <ColumnForm
                    inicial={{ name: '', color: 'slate' }}
                    pendiente={crearColumna.isPending}
                    onCancel={() => setAnadiendo(false)}
                    onSave={(campos) => crearColumna.mutate(campos)}
                  />
                ) : (
                  <Button
                    variant="ghost" size="sm" className="w-full justify-start text-muted-foreground"
                    onClick={() => { setEditando(null); setAnadiendo(true) }}
                  >
                    <Plus /> Añadir columna
                  </Button>
                )}
              </div>
            )}
          </div>

          {caps.canManagePlan && !porEstado && (
            <p className="text-xs text-muted-foreground">
              Con ratón: arrastra las tarjetas para ordenarlas o cambiarlas de columna, y la{' '}
              <strong>cabecera de una columna</strong> para mover la columna entera con sus
              tarjetas. <strong>Con el dedo no se puede arrastrar</strong> —el navegador no manda
              esos gestos—, así que en un teléfono se usa el desplegable «columna» de cada tarjeta
              y las flechas ‹ › de cada cabecera, que hacen lo mismo. El nombre
              de una columna es tuyo: no significa nada para la aplicación, y el estado de cada
              tarea se ve y se cambia en su tarjeta.
            </p>
          )}
        </>
      ) : (
        <>
          {/* MÓVIL: tarjetas. Esta lista es la que más se mira desde el
              teléfono —un estudiante marcando el estado de lo suyo—, y en una
              tabla de seis columnas el desplegable de estado quedaba fuera de
              la pantalla. Aquí el estado es lo más ancho y está debajo del
              título, que es el orden en que se usa. */}
          <Card className="divide-y sm:hidden">
            {rows.map((t) => {
              const late = t.due_date !== null && t.status !== 'COMPLETADA' && (daysUntil(t.due_date) ?? 0) < 0
              const priority = TASK_PRIORITIES.find((p) => p.value === t.priority)
              const puntos = subtasksOf(t.id)
              return (
                <div
                  key={t.id}
                  className="cursor-pointer space-y-2 p-3 active:bg-accent"
                  {...propsDeApertura(() => setOpenTaskId(t.id))}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setOpenTaskId(t.id)}
                      className="min-w-0 text-left font-medium underline-offset-2 hover:underline"
                    >
                      {t.color !== null && (
                        <span
                          className={cn('mr-1.5 inline-block size-2.5 shrink-0 rounded-full align-middle', toneClass(t.color))}
                          aria-hidden
                        />
                      )}
                      {t.title}
                    </button>
                    {caps.canManagePlan && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-1 -mt-1 shrink-0"
                        onClick={() => archivar.mutate(t.id)}
                        aria-label={`Mandar «${t.title}» a la papelera`}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    <ToneBadge tone={priority?.tone ?? null}>{priority?.label}</ToneBadge>
                    <span className={cn(late && 'font-medium text-destructive')}>
                      {t.due_date ? format(parseISO(t.due_date), 'd MMM yyyy', { locale: es }) : 'Sin fecha'}
                    </span>
                    {t.assignee ? (
                      <span className="flex min-w-0 items-center gap-1">
                        <Avatar name={t.assignee.full_name} src={t.assignee.avatar_url} size="xs" />
                        <span className="min-w-0 truncate">{t.assignee.full_name}</span>
                      </span>
                    ) : (
                      <span>· Sin responsable</span>
                    )}
                    {puntos.length > 0 && (
                      <span className="flex items-center gap-1">
                        <ListChecks className="size-3" />
                        {puntos.filter((x) => x.status === 'COMPLETADA').length}/{puntos.length}
                      </span>
                    )}
                  </div>

                  {/* Desde el teléfono, que es donde más se usa esta lista:
                      el estado de lo mío y, si el tablero tiene columnas, a
                      cuál lo muevo. Arrastrar con el dedo compite con el gesto
                      de desplazar la página, así que aquí no se arrastra. */}
                  <StatusSelect
                    task={t}
                    caps={caps}
                    userId={userId}
                    onChange={(status) => setStatus.mutate({ id: t.id, status })}
                  />
                  <ColumnSelect
                    task={t}
                    caps={caps}
                    userId={userId}
                    columnas={porEstado ? [] : tablero}
                    columnaActual={columnKeyOf(t, tablero)}
                    onMover={(key) => moverA(t.id, key)}
                  />
                </div>
              )
            })}
          </Card>

          <Card className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarea</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Fecha límite</TableHead>
                <TableHead>Estado</TableHead>
                {!porEstado && <TableHead>Columna</TableHead>}
                {caps.canManagePlan && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const late = t.due_date !== null && t.status !== 'COMPLETADA' && (daysUntil(t.due_date) ?? 0) < 0
                const priority = TASK_PRIORITIES.find((p) => p.value === t.priority)
                return (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    {...propsDeApertura(() => setOpenTaskId(t.id))}
                  >
                    <TableCell className="max-w-[20rem]">
                      <button
                        type="button"
                        onClick={() => setOpenTaskId(t.id)}
                        className="text-left font-medium underline-offset-2 hover:underline"
                      >
                        {t.color !== null && (
                          <span
                            className={cn('mr-1.5 inline-block size-2.5 shrink-0 rounded-full align-middle', toneClass(t.color))}
                            aria-hidden
                          />
                        )}
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
                    <TableCell className="text-sm text-muted-foreground">
                      {t.assignee ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={t.assignee.full_name} src={t.assignee.avatar_url} size="sm" />
                          <span className="min-w-0 truncate">{t.assignee.full_name}</span>
                        </span>
                      ) : '—'}
                    </TableCell>
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
                        ancho="w-[10.5rem]"
                      />
                    </TableCell>
                    {!porEstado && (
                      <TableCell>
                        <ColumnSelect
                          task={t}
                          caps={caps}
                          userId={userId}
                          columnas={tablero}
                          columnaActual={columnKeyOf(t, tablero)}
                          onMover={(key) => moverA(t.id, key)}
                          ancho="w-[10.5rem]"
                        />
                      </TableCell>
                    )}
                    {caps.canManagePlan && (
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => archivar.mutate(t.id)} aria-label="Mandar la tarea a la papelera">
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
        </>
      )}

      {/* LA PAPELERA, al final del plan de trabajo y solo si hay algo dentro.
          Aquí, y no en otra pantalla: lo que se busca después de borrar algo
          sin querer es el sitio donde se borró. Vacía no ocupa ni una línea. */}
      {caps.canManagePlan && (papelera.data ?? []).length > 0 && (
        <details className="rounded-lg border bg-muted/30 p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Papelera ({(papelera.data ?? []).length})
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            Lo que se borra del plan de trabajo espera aquí. Restaurar una tarea devuelve también
            los puntos de su lista de comprobación. Borrar definitivamente no tiene vuelta atrás:
            se lleva sus subtareas, sus dependencias y sus comentarios.
          </p>
          <ul className="mt-2 divide-y">
            {(papelera.data ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 break-words">
                  {t.title}
                  {t.parent_task_id !== null && (
                    <span className="text-xs text-muted-foreground"> · punto de una lista</span>
                  )}
                  {t.deleted_at && (
                    <span className="block text-xs text-muted-foreground">
                      borrada el {format(parseISO(t.deleted_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}
                    </span>
                  )}
                </span>
                <Button
                  size="sm" variant="outline" className="shrink-0"
                  loading={restaurar.isPending && restaurar.variables === t.id}
                  onClick={() => restaurar.mutate(t.id)}
                >
                  <RotateCcw /> Restaurar
                </Button>
                <Button
                  size="sm" variant="ghost" className="shrink-0 text-destructive"
                  loading={borrarDeVerdad.isPending && borrarDeVerdad.variables === t.id}
                  onClick={() => {
                    if (confirm(`¿Borrar «${t.title}» definitivamente? Esto no se puede deshacer.`)) {
                      borrarDeVerdad.mutate(t.id)
                    }
                  }}
                >
                  <Trash2 /> Borrar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <TaskDetailDialog
        task={openTask}
        subtasks={openTask ? subtasksOf(openTask.id) : []}
        // TODAS las tareas, subtareas incluidas: también se puede esperar a
        // un punto de la lista de comprobación de otra tarea.
        tasks={all}
        open={openTaskId !== null}
        onOpenChange={(v) => { if (!v) setOpenTaskId(null) }}
        onEdit={() => { setEditTaskId(openTaskId); setOpenTaskId(null) }}
        caps={caps}
        userId={userId}
        workId={work.id}
        members={work.members.filter((m) => m.status === 'ACTIVE')}
        columna={openTask ? (tablero.find((c) => c.key === columnKeyOf(openTask, tablero)) ?? null) : null}
      />


      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        work={work}
        onSaved={invalidate}
      />

      {/* El MISMO formulario para crear y para editar, montado dos veces con
          `task` distinto. Dos formularios separados se habrían separado también
          en los campos y en las validaciones: el de edición acabaría sin la
          regla de «la fecha límite no puede ser anterior al inicio». */}
      <TaskDialog
        open={editTask !== null}
        onOpenChange={(v) => { if (!v) setEditTaskId(null) }}
        work={work}
        task={editTask}
        onSaved={invalidate}
        // Al guardar se vuelve a la ficha, que es de donde se venía.
        onDone={() => { const id = editTaskId; setEditTaskId(null); setOpenTaskId(id) }}
      />
    </div>
  )
}

/**
 * El formulario de una columna: nombre y color, y nada más.
 *
 * No hay ningún campo de «significado», y es la decisión de fondo de todo
 * esto: una columna se llama «Papers» porque a quien dirige el trabajo le
 * sirve, y la aplicación no tiene que entenderlo. El estado de cada tarea
 * —pendiente, en curso, completada— vive en su tarjeta, se ve ahí y se cambia
 * ahí, y es lo que leen el progreso del trabajo, el cronograma y los informes.
 *
 * Se usa igual para crear y para renombrar: dos formularios separados habrían
 * acabado con dos listas de colores distintas.
 */
function ColumnForm({
  inicial, pendiente, onSave, onCancel,
}: {
  inicial: { name: string; color: string }
  pendiente: boolean
  onSave: (campos: { name: string; color: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = React.useState(inicial.name)
  const [color, setColor] = React.useState(inicial.color)
  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => { e.preventDefault(); if (name.trim().length > 0) onSave({ name: name.trim(), color }) }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Papers"
        aria-label="Nombre de la columna"
        className="h-8 text-xs"
        autoFocus
      />
      <div className="flex items-center gap-1">
        <Select
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="Color de la columna"
          className="h-8 min-w-0 flex-1 text-xs"
        >
          {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Button type="submit" variant="ghost" size="icon" className="size-8" loading={pendiente} aria-label="Guardar la columna">
          <Check className="size-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onCancel} aria-label="Cancelar">
          <X className="size-3.5" />
        </Button>
      </div>
      <p className="text-[0.7rem] leading-tight text-muted-foreground">
        El nombre es tuyo. El estado de cada tarea se cambia en su tarjeta.
      </p>
    </form>
  )
}

/**
 * El ESTADO de la tarea: pendiente, en curso, completada…
 *
 * Es un dato de la tarea y no la columna donde está la tarjeta. De aquí salen
 * el progreso del trabajo, el color de la barra del cronograma, los bloqueos
 * por dependencia y los informes, así que sigue estando a la vista en la
 * tarjeta aunque el tablero se organice de otra manera.
 *
 * Quien no puede cambiarlo ve la pastilla, no un desplegable muerto.
 */
function StatusSelect({
  task, caps, userId, onChange, ancho,
}: {
  task: TaskWithAssignee
  caps: WorkCapabilities
  userId: string | null
  onChange: (status: TaskStatus) => void
  ancho?: string
}) {
  if (!canUpdateTaskStatus(caps, task, userId)) {
    const s = TASK_STATUSES.find((x) => x.value === task.status)
    return <ToneBadge tone={s?.tone ?? null}>{s?.label}</ToneBadge>
  }
  return (
    <Select
      value={task.status}
      onChange={(e) => onChange(e.target.value as TaskStatus)}
      className={cn('h-8 min-w-0 text-xs', ancho ?? 'w-full')}
      aria-label="Estado de la tarea"
    >
      {TASK_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </Select>
  )
}

/**
 * Mover una tarjeta SIN arrastrar.
 *
 * Arrastrar es cómodo con ratón y malo con el dedo: en un móvil compite con el
 * gesto de desplazar la página, y con el teclado no existe. Este desplegable es
 * la misma operación por la vía de siempre, y es además lo que ve quien solo
 * puede informar del avance de su tarea.
 *
 * Quien no puede tocarla ve el nombre de su columna, que es lo que antes era
 * la pastilla del estado.
 */
function ColumnSelect({
  task, caps, userId, columnas, columnaActual, onMover, ancho,
}: {
  task: TaskWithAssignee
  caps: WorkCapabilities
  userId: string | null
  columnas: BoardColumn[]
  columnaActual: string
  onMover: (columnaKey: string) => void
  /** La tabla tiene sitio para un ancho fijo; la tarjeta del tablero, no. */
  ancho?: string
}) {
  // Sin columnas propias no hay nada que elegir: el tablero agrupa por estado
  // y el desplegable de estado ya es el que mueve la tarjeta.
  if (columnas.length === 0) return null
  const actual = columnas.find((c) => c.key === columnaActual)
  if (!canUpdateTaskStatus(caps, task, userId)) {
    return <ToneBadge tone={actual?.color ?? null}>{actual?.name ?? '—'}</ToneBadge>
  }
  return (
    <Select
      value={columnaActual}
      onChange={(e) => onMover(e.target.value)}
      className={cn('h-8 min-w-0 text-xs', ancho ?? 'w-full')}
      aria-label="Columna del tablero"
    >
      {columnas.map((c) => (
        <option key={c.key} value={c.key}>{c.name}</option>
      ))}
    </Select>
  )
}

function TaskCard({
  task, subtasks, caps, userId, columnas, columnaActual,
  onOpen, onStatus, onMover, onRemove, arrastrable,
}: {
  task: TaskWithAssignee
  subtasks: TaskWithAssignee[]
  caps: WorkCapabilities
  userId: string | null
  onOpen: () => void
  /** Vacío cuando el tablero agrupa por estado: entonces no hay que elegir. */
  columnas: BoardColumn[]
  columnaActual: string
  onStatus: (status: TaskStatus) => void
  onMover: (columnaKey: string) => void
  arrastrable: boolean
  onRemove: () => void
}) {
  const late = task.due_date !== null && task.status !== 'COMPLETADA' && (daysUntil(task.due_date) ?? 0) < 0
  const priority = TASK_PRIORITIES.find((p) => p.value === task.priority)

  return (
    <Card
      className={cn(
        'cursor-pointer active:bg-accent',
        arrastrable && 'cursor-grab active:cursor-grabbing',
        // La franja del color, en el borde izquierdo: se reconoce de un vistazo
        // en una columna de quince tarjetas y no le quita sitio a nada.
        task.color !== null && `border-l-4 ${toneEdgeClass(task.color)}`,
      )}
      title={arrastrable ? 'Arrástrala para cambiarla de columna o de orden' : undefined}
      {...propsDeApertura(onOpen)}
    >
      <CardContent className="space-y-2 p-3">
        {/* La tarjeta ENTERA abre la ficha, pero el título sigue siendo un
            <button> de verdad: es la parada del tabulador y lo que anuncia un
            lector de pantalla. El clic en el resto es un añadido, no el único
            camino. El desplegable de estado y el botón de eliminar que hay
            dentro se quedan con su clic (ver `propsDeApertura`). */}
        <button
          type="button"
          onClick={onOpen}
          className="block w-full break-words text-left text-sm font-medium leading-snug underline-offset-2 hover:underline"
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
        {/* Estilo Trello: la cara identifica de un vistazo quién tiene la
            tarea en un tablero con veinte tarjetas. El nombre se queda al
            lado: una cara sin nombre obliga a adivinar, y quien acaba de
            entrar en el grupo todavía no conoce ninguna. */}
        {task.assignee && (
          <div className="flex min-w-0 items-center gap-1.5">
            <Avatar name={task.assignee.full_name} src={task.assignee.avatar_url} size="xs" />
            {/* `min-w-0` además de `truncate`: sin él, un elemento `flex` con
                `white-space: nowrap` NO se encoge por debajo de su texto —su
                `min-width` vale `auto`— y el nombre se sale de la tarjeta por
                la derecha en lugar de recortarse. */}
            <p className="min-w-0 truncate text-xs text-muted-foreground">{task.assignee.full_name}</p>
          </div>
        )}
        {/* El ESTADO de la tarea, siempre; y debajo, la columna, solo si el
            tablero tiene columnas propias. Son dos cosas distintas: «Papers»
            no dice si eso está hecho. */}
        <div className="flex items-center gap-1">
          <StatusSelect task={task} caps={caps} userId={userId} onChange={onStatus} />
          {caps.canManagePlan && (
            <Button variant="ghost" size="icon" className="size-8" onClick={onRemove} aria-label="Mandar la tarea a la papelera">
              <Trash2 />
            </Button>
          )}
        </div>
        <ColumnSelect
          task={task}
          caps={caps}
          userId={userId}
          columnas={columnas}
          columnaActual={columnaActual}
          onMover={onMover}
        />
      </CardContent>
    </Card>
  )
}

/**
 * Alta y edición de una tarea, en el mismo formulario.
 *
 * POR QUÉ NO HAY DOS
 * Porque los campos y las validaciones se habrían separado. La regla «la fecha
 * límite no puede ser anterior al inicio» vive en `taskFormSchema`, y un
 * formulario de edición escrito aparte habría acabado sin ella —o con una copia
 * que deja de parecerse a la otra en el primer cambio—. `task` nulo significa
 * crear; con tarea, editar.
 *
 * LO QUE SE PUEDE CAMBIAR es título, descripción, responsable, prioridad y las
 * dos fechas. Antes solo se podían fijar al crear la tarea, que en un plan
 * académico es tanto como no poder fijarlas: las fechas son justamente lo que
 * se mueve. El estado NO está aquí: se cambia desde el tablero y desde la
 * ficha, porque es la acción frecuente y no merece abrir un formulario.
 *
 * El trigger `app.enforce_task_update_scope` (migración 0003) ya decide quién
 * puede tocar qué: sin `can_manage_plan` solo se permite mover el estado. Este
 * formulario únicamente evita ofrecer lo que la base de datos va a rechazar.
 */
function TaskDialog({
  open, onOpenChange, work, task = null, onSaved, onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  work: WorkWithRelations
  /** Nulo: alta. Con tarea: edición de esa tarea. */
  task?: TaskWithAssignee | null
  onSaved: () => void
  /** Se llama tras guardar, para que el llamante decida dónde deja al usuario. */
  onDone?: () => void
}) {
  const toast = useToast()
  const editando = task !== null
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { title: '', description: '', assignee_id: '', priority: 'MEDIA', start_date: '', due_date: '' },
  })

  // Al abrirse se vuelca la tarea en el formulario, y al cerrarse se limpia.
  // Sin esto, editar una tarea y abrir después «Nueva tarea» ofrecería los
  // datos de la anterior ya escritos, y se crearía un duplicado sin querer.
  React.useEffect(() => {
    if (!open) return
    form.reset({
      title: task?.title ?? '',
      description: task?.description ?? '',
      assignee_id: task?.assignee_id ?? '',
      priority: task?.priority ?? 'MEDIA',
      start_date: task?.start_date ?? '',
      due_date: task?.due_date ?? '',
    })
  }, [open, task, form])

  const guardar = useMutation({
    mutationFn: (values: TaskFormValues) => {
      const campos = {
        title: values.title,
        description: values.description || null,
        assignee_id: values.assignee_id || null,
        priority: values.priority,
        start_date: values.start_date || null,
        due_date: values.due_date || null,
      }
      return editando
        ? tasksRepo.update(task.id, campos)
        : tasksRepo.create({ work_id: work.id, ...campos })
    },
    onSuccess: () => {
      onSaved()
      toast.push('success', editando ? 'Tarea actualizada.' : 'Tarea creada.')
      form.reset()
      onOpenChange(false)
      onDone?.()
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const candidates = work.members.filter((m) => m.status === 'ACTIVE' && m.profile)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar tarea' : 'Nueva tarea'}</DialogTitle>
          <DialogDescription>
            {editando ? 'Los cambios se guardan en el plan del trabajo.' : `Se añadirá al plan de «${work.title}».`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => guardar.mutate(v))} className="space-y-3" noValidate>
          <div>
            <Label htmlFor="task-title">Título</Label>
            <Input id="task-title" className="mt-1.5" {...form.register('title')} />
            <FieldError>{form.formState.errors.title?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="task-desc">Descripción</Label>
            <Textarea id="task-desc" rows={2} className="mt-1.5" {...form.register('description')} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <Button type="submit" loading={guardar.isPending}>
              {editando ? 'Guardar cambios' : 'Crear tarea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
