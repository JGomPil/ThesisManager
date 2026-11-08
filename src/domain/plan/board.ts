import type { BoardColumnRow, TaskStatus } from '@/data/types/database'

/**
 * EL TABLERO DE TAREAS: columnas con el nombre que haga falta, estilo Trello.
 *
 * Cada trabajo tiene SUS columnas (`board_columns`, migración 0024), con su
 * nombre, su color y su orden: «Papers», «Estudios», «Enviado a revista». Las
 * administra quien dirige el trabajo, y no significan nada para la aplicación:
 * son una clasificación más, la que quiera quien planifica.
 *
 * EL ESTADO DE LA TAREA ES OTRA COSA, y sigue en `tasks.status`: se ve y se
 * cambia en la propia tarjeta. Mover una tarjeta NO cambia el estado, y cambiar
 * el estado NO mueve la tarjeta. Por eso el progreso del trabajo, los colores
 * del cronograma, los bloqueos por dependencia y los informes siguen leyendo
 * `status` sin saber que estas columnas existen.
 *
 * MIENTRAS UN TRABAJO NO TENGA COLUMNAS, el tablero agrupa por estado como
 * siempre: ningún trabajo nace con columnas y la migración no siembra ninguna,
 * así que esto no obliga a nadie a configurar nada.
 *
 * ESTE FICHERO ES PURO. Decide qué columnas se dibujan, en cuál cae cada
 * tarjeta y qué hay que escribir al arrastrar una. El componente solo pinta y
 * manda las escrituras que se le digan.
 */

/** Los cinco estados de una tarea, con su nombre y su color. */
export const ESTADOS_TAREA: { value: TaskStatus; label: string; tone: string }[] = [
  { value: 'PENDIENTE', label: 'Pendiente', tone: 'slate' },
  { value: 'EN_CURSO', label: 'En curso', tone: 'blue' },
  { value: 'BLOQUEADA', label: 'Bloqueada', tone: 'red' },
  { value: 'EN_REVISION', label: 'En revisión', tone: 'amber' },
  { value: 'COMPLETADA', label: 'Completada', tone: 'green' },
]

/** Una columna ya resuelta: o es del trabajo, o es el tablero por estado. */
export type BoardColumn = {
  /** Clave de agrupación y de React. */
  key: string
  /** `null` en el tablero por estado: esas columnas no son filas de nada. */
  id: string | null
  name: string
  color: string | null
  /** Solo en el tablero por estado: el estado que agrupa esa columna. */
  estado: TaskStatus | null
}

/** Lo que el tablero necesita de una tarea para colocarla. */
export type BoardCard = {
  id: string
  order_index: number
  board_column_id: string | null
  status: TaskStatus
}

/** Una escritura que hay que mandar a la base de datos al mover una tarjeta. */
export type CardMove = {
  id: string
  order_index: number
  /** Solo en la tarjeta que cambia de columna. */
  board_column_id?: string | null
  /**
   * Solo en el tablero POR ESTADO, que es el que se dibuja mientras el trabajo
   * no tenga columnas: allí la columna de destino es un estado y moverla es
   * cambiarlo. Con columnas de verdad nunca se manda: el estado es un dato
   * aparte y moverla no lo toca.
   */
  status?: TaskStatus
}

const KEY_ESTADO = (estado: TaskStatus) => `estado:${estado}`

/** El tablero de siempre: una columna por estado. */
export function columnasPorEstado(): BoardColumn[] {
  return ESTADOS_TAREA.map((e) => ({
    key: KEY_ESTADO(e.value),
    id: null,
    name: e.label,
    color: e.tone,
    estado: e.value,
  }))
}

/**
 * Las columnas con las que empieza un tablero cuando se crean por primera vez,
 * y en cuál se coloca cada tarea que ya existía.
 *
 * La colocación inicial mira el estado UNA VEZ Y NUNCA MÁS: es lo único
 * sensato que se puede hacer con las tareas que ya están —dejarlas todas en la
 * primera columna sería tirar información que ya se tenía—, y a partir de ahí
 * las dos clasificaciones viven separadas. No es un «significado» de la
 * columna: nadie volverá a leerlo, y renombrar «Hecho» no cambia nada.
 */
export function columnasIniciales(): { name: string; color: string; estados: TaskStatus[] }[] {
  return [
    { name: 'Por hacer', color: 'slate', estados: ['PENDIENTE', 'BLOQUEADA'] },
    { name: 'En curso', color: 'blue', estados: ['EN_CURSO', 'EN_REVISION'] },
    { name: 'Hecho', color: 'green', estados: ['COMPLETADA'] },
  ]
}

/**
 * Qué columnas se dibujan: las del trabajo, por su orden, o el tablero por
 * estado si no tiene ninguna.
 */
export function resolveBoard(columnas: BoardColumnRow[]): BoardColumn[] {
  if (columnas.length === 0) return columnasPorEstado()
  return columnas
    .slice()
    .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, 'es'))
    .map((c) => ({ key: c.id, id: c.id, name: c.name, color: c.color, estado: null }))
}

/**
 * En qué columna cae una tarjeta.
 *
 * Con su columna asignada y dibujándose, ahí. En el tablero por estado, en la
 * columna de su estado. Y si tiene columna pero no se está dibujando —la han
 * borrado, o la tarea viene de antes de que existieran—, en la PRIMERA: una
 * tarjeta sin sitio no puede quedarse sin dibujar, que sería trabajo invisible.
 */
export function columnKeyOf(card: BoardCard, columnas: BoardColumn[]): string {
  if (card.board_column_id) {
    const propia = columnas.find((c) => c.id === card.board_column_id)
    if (propia) return propia.key
  }
  const porEstado = columnas.find((c) => c.estado === card.status)
  return (porEstado ?? columnas[0])?.key ?? KEY_ESTADO(card.status)
}

/**
 * Reparte las tarjetas por columna, conservando el orden en que llegan (la
 * consulta las pide `order by order_index, created_at`).
 */
export function groupCards<T extends BoardCard>(
  tarjetas: T[], columnas: BoardColumn[],
): Map<string, T[]> {
  const mapa = new Map<string, T[]>(columnas.map((c) => [c.key, [] as T[]]))
  for (const t of tarjetas) {
    const key = columnKeyOf(t, columnas)
    const lista = mapa.get(key)
    if (lista) lista.push(t)
    else mapa.set(key, [t])
  }
  return mapa
}

/**
 * Qué hay que escribir para dejar una tarjeta donde se ha soltado.
 *
 * `antesDe` es la tarjeta sobre la que se suelta (la arrastrada se coloca
 * ANTES de ella), o `null` para el final de la columna. Devuelve solo las
 * filas que cambian: la arrastrada siempre, y de las demás únicamente aquellas
 * cuyo `order_index` deja de coincidir con su posición. Cada escritura es una
 * petición contra un proyecto gratuito.
 *
 * Soltar una tarjeta donde ya estaba no devuelve nada, y entonces no se manda
 * nada: ni petición, ni invalidación, ni parpadeo del tablero.
 *
 * `puedeOrdenar` distingue a quien planifica de quien solo informa de lo suyo.
 * Sin ese permiso, RLS únicamente le deja escribir SUS tareas, así que renumerar
 * las vecinas no daría error: la política le descartaría esas filas en silencio
 * y el tablero quedaría a medio ordenar. Por eso, en ese caso, la tarjeta se va
 * al final de la columna de destino con una sola escritura, que es la suya.
 */
export function planCardMove({
  tarjetas, columnas, arrastradaId, destinoKey, antesDe, puedeOrdenar = true,
}: {
  tarjetas: BoardCard[]
  columnas: BoardColumn[]
  arrastradaId: string
  destinoKey: string
  antesDe: string | null
  puedeOrdenar?: boolean
}): CardMove[] {
  const destino = columnas.find((c) => c.key === destinoKey)
  const arrastrada = tarjetas.find((t) => t.id === arrastradaId)
  if (!destino || !arrastrada) return []
  if (antesDe === arrastradaId) return []

  const grupos = groupCards(tarjetas, columnas)
  const origenKey = columnKeyOf(arrastrada, columnas)

  /** Lo que cambia de la tarjeta movida, aparte de su sitio. */
  const traslado = (): Partial<CardMove> => {
    if (origenKey === destinoKey) return {}
    // En el tablero por estado no hay fila que apuntar: lo que cambia es el
    // estado. Con columnas de verdad, el estado no se toca.
    return destino.id === null
      ? { status: destino.estado ?? arrastrada.status }
      : { board_column_id: destino.id }
  }

  if (!puedeOrdenar) {
    if (origenKey === destinoKey) return []
    const lista = grupos.get(destinoKey) ?? []
    const ultimo = lista.reduce((max, t) => Math.max(max, t.order_index), -1)
    return [{ id: arrastradaId, order_index: ultimo + 1, ...traslado() }]
  }

  const lista = (grupos.get(destinoKey) ?? []).filter((t) => t.id !== arrastradaId)
  const posicion = antesDe === null ? lista.length : lista.findIndex((t) => t.id === antesDe)
  const indice = posicion < 0 ? lista.length : posicion
  lista.splice(indice, 0, arrastrada)

  // Misma columna y misma posición: no hay nada que escribir.
  if (origenKey === destinoKey) {
    const original = grupos.get(destinoKey) ?? []
    if (original.length === lista.length && original.every((t, i) => t.id === lista[i]!.id)) return []
  }

  // LA COLUMNA DE ORIGEN NO SE RENUMERA, a propósito: al sacar una tarjeta, las
  // que quedan conservan su `order_index` con un hueco (0, 2, 3), y un hueco no
  // cambia el orden porque la lista se pide `order by order_index`. Renumerarla
  // serían tantas escrituras más como tarjetas tenga la columna, para que nada
  // se vea distinto.
  const movimientos: CardMove[] = []
  lista.forEach((t, i) => {
    if (t.id === arrastradaId) movimientos.push({ id: t.id, order_index: i, ...traslado() })
    else if (t.order_index !== i) movimientos.push({ id: t.id, order_index: i })
  })
  return movimientos
}

/** El siguiente `display_order` de un tablero: la columna nueva, al final. */
export function siguienteOrden(columnas: BoardColumnRow[]): number {
  return columnas.reduce((max, c) => Math.max(max, c.display_order), -1) + 1
}

/**
 * Los colores que de verdad se están usando en un plan, en el orden del
 * catálogo.
 *
 * Es lo que decide qué pastillas de filtro se enseñan. Enseñar los doce tonos
 * sería ofrecer once filtros que no devuelven nada, y el filtro perdería su
 * sentido: lo que se quiere saber es «cuántos grupos de color hay aquí».
 *
 * El orden es el del catálogo que se le pase —no el de aparición en la lista—
 * para que la fila de pastillas no baile al mover una tarjeta.
 */
export function coloresEnUso(
  tareas: { color: string | null }[], catalogo: readonly string[],
): string[] {
  const usados = new Set(tareas.map((t) => t.color).filter((c): c is string => c !== null))
  return catalogo.filter((c) => usados.has(c))
}
