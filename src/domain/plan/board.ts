import type { BoardColumnRow, TaskStatus } from '@/data/types/database'

/**
 * EL TABLERO DE TAREAS: columnas configurables sin perder el significado.
 *
 * El tablero dibujaba una columna por cada valor de `tasks.status`
 * —PENDIENTE, EN_CURSO, BLOQUEADA, EN_REVISION, COMPLETADA—, que es lo que la
 * aplicación entiende, no cómo trabaja una persona. Desde la 0024 las columnas
 * son un catálogo editable (`board_columns`) con su nombre, su color y su
 * orden: «Papers», «Estudios», «Enviado a revisión».
 *
 * LO QUE SOSTIENE TODO ESTO es que cada columna DECLARA SU SIGNIFICADO
 * (`maps_to`, uno de los cinco estados), y un disparador deriva `tasks.status`
 * de la columna. Por eso el progreso del trabajo, los colores del cronograma,
 * los bloqueos por dependencia y los informes siguen funcionando sin saber que
 * este catálogo existe: siguen leyendo `status`.
 *
 * ESTE FICHERO ES PURO. Decide qué columnas se dibujan, en cuál cae cada
 * tarjeta y qué hay que escribir al arrastrar una. El componente solo pinta y
 * manda las escrituras que se le digan.
 */

/** Los cinco estados de siempre, con su nombre y su color. */
export const ESTADOS_TAREA: { value: TaskStatus; label: string; tone: string }[] = [
  { value: 'PENDIENTE', label: 'Pendiente', tone: 'slate' },
  { value: 'EN_CURSO', label: 'En curso', tone: 'blue' },
  { value: 'BLOQUEADA', label: 'Bloqueada', tone: 'red' },
  { value: 'EN_REVISION', label: 'En revisión', tone: 'amber' },
  { value: 'COMPLETADA', label: 'Completada', tone: 'green' },
]

/** Una columna ya resuelta: o viene del catálogo, o es una de las de siempre. */
export type BoardColumn = {
  /** Clave de agrupación y de React. Las de siempre no tienen fila en la base. */
  key: string
  /** `null` en las columnas de siempre: no existen como fila que apuntar. */
  id: string | null
  name: string
  color: string | null
  mapsTo: TaskStatus
  isActive: boolean
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
  /** Solo en la tarjeta que se mueve de columna. */
  board_column_id?: string | null
  /**
   * Solo cuando la columna destino es UNA DE LAS DE SIEMPRE, que no tiene fila:
   * ahí no hay `board_column_id` que guardar y lo que cambia es el estado. Con
   * una columna del catálogo no se manda, porque el estado lo deriva el
   * disparador de la 0024 y mandarlo sería tener dos opiniones sobre lo mismo.
   */
  status?: TaskStatus
}

const KEY_ESTADO = (estado: TaskStatus) => `estado:${estado}`

/** Las cinco de siempre, en forma de columna. */
export function columnasPorDefecto(): BoardColumn[] {
  return ESTADOS_TAREA.map((e) => ({
    key: KEY_ESTADO(e.value),
    id: null,
    name: e.label,
    color: e.tone,
    mapsTo: e.value,
    isActive: true,
  }))
}

/**
 * Qué columnas se dibujan.
 *
 * Sin catálogo configurado, las cinco de siempre: una organización que no
 * quiere configurar nada ve exactamente el tablero que veía, y la 0024 no
 * siembra ninguna fila para no obligar a nadie a borrarlas.
 *
 * Con catálogo, las activas por su orden… Y TAMBIÉN LAS RETIRADAS QUE AÚN
 * TIENEN TARJETAS. Esto último no es un adorno: retirar una columna con
 * tarjetas dentro las haría desaparecer de la vista sin borrarlas, que es la
 * peor combinación posible —el trabajo sigue ahí y nadie lo ve—. Mientras
 * quede una tarjeta, la columna se sigue dibujando.
 */
export function resolveBoard(catalogo: BoardColumnRow[], tarjetas: BoardCard[]): BoardColumn[] {
  if (catalogo.length === 0) return columnasPorDefecto()

  const conTarjetas = new Set(tarjetas.map((t) => t.board_column_id).filter(Boolean) as string[])
  return catalogo
    .filter((c) => c.is_active || conTarjetas.has(c.id))
    .slice()
    .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name, 'es'))
    .map((c) => ({
      key: c.id,
      id: c.id,
      name: c.name,
      color: c.color,
      mapsTo: c.maps_to,
      isActive: c.is_active,
    }))
}

/**
 * En qué columna cae una tarjeta.
 *
 * Si tiene columna asignada y esa columna se está dibujando, ahí. Si no
 * —tarea anterior al catálogo, columna borrada, o catálogo sin configurar—, en
 * la primera columna que SIGNIFIQUE su estado, que es la regla que usaba el
 * tablero antes de que hubiera catálogo. Y si ni eso, en la primera columna:
 * una tarjeta sin sitio no puede quedarse sin dibujar.
 */
export function columnKeyOf(card: BoardCard, columnas: BoardColumn[]): string {
  if (card.board_column_id) {
    const propia = columnas.find((c) => c.id === card.board_column_id)
    if (propia) return propia.key
  }
  const porEstado = columnas.find((c) => c.mapsTo === card.status)
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
 */
export function planCardMove({
  tarjetas, columnas, arrastradaId, destinoKey, antesDe,
}: {
  tarjetas: BoardCard[]
  columnas: BoardColumn[]
  arrastradaId: string
  destinoKey: string
  antesDe: string | null
}): CardMove[] {
  const destino = columnas.find((c) => c.key === destinoKey)
  const arrastrada = tarjetas.find((t) => t.id === arrastradaId)
  if (!destino || !arrastrada) return []
  if (antesDe === arrastradaId) return []

  const grupos = groupCards(tarjetas, columnas)
  const origenKey = columnKeyOf(arrastrada, columnas)
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
    if (t.id === arrastradaId) {
      const mov: CardMove = { id: t.id, order_index: i }
      if (origenKey !== destinoKey) {
        mov.board_column_id = destino.id
        // Sin fila que apuntar, lo que cambia es el estado; con fila, lo deriva
        // el disparador y mandarlo aquí sobraría.
        if (destino.id === null) mov.status = destino.mapsTo
      }
      movimientos.push(mov)
    } else if (t.order_index !== i) {
      movimientos.push({ id: t.id, order_index: i })
    }
  })
  return movimientos
}
