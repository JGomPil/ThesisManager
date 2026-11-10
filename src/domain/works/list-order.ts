/**
 * ORDENAR EL LISTADO DE TRABAJOS POR LA COLUMNA QUE SE PULSE.
 *
 * El listado llegaba siempre en el mismo orden —el de creación, del más nuevo
 * al más viejo— y eso vale para «qué hay de nuevo» y para nada más. Las
 * preguntas que de verdad se le hacen a esta pantalla son «¿qué vence antes?»,
 * «¿cuántas tesis hay juntas?» y «¿qué lleva esta directora?», y las tres son
 * la misma tabla ordenada por otra columna.
 *
 * POR QUÉ SE ORDENA AQUÍ Y NO EN LA BASE DE DATOS
 * Porque dos de las seis columnas NO EXISTEN como columna: «Estudiante» y
 * «Dirección» se arman en el cliente juntando los miembros activos del trabajo
 * con su función académica, deduplicando a quien tiene dos papeles y poniendo
 * delante a la dirección principal. Ordenar eso en PostgreSQL pediría una
 * vista o una función, y la pantalla ya se trae la lista entera —son decenas
 * de trabajos, no millones—. Cuando deje de serlo, el sitio por donde pasa el
 * orden está aquí, en una función pura y con pruebas.
 *
 * LAS TRES REGLAS QUE NO SE VEN HASTA QUE FALTAN
 *  1. LO VACÍO, SIEMPRE AL FINAL, en los dos sentidos. Un trabajo sin fecha de
 *     fin no es «el más antiguo» ni «el más reciente»: es uno del que no se
 *     sabe. Si siguiera al sentido, al invertir el orden la mitad de la
 *     pantalla se llenaría de guiones antes de llegar a lo que se buscaba.
 *  2. EL DESEMPATE, SIEMPRE POR TÍTULO Y SIEMPRE A→Z. Ordenando por tipo hay
 *     veinte TFG seguidos, y sin desempate su orden entre sí es el que venía
 *     de antes: la misma pantalla, cargada dos veces, saldría distinta.
 *  3. COMPARACIÓN EN ESPAÑOL. `localeCompare` con `sensitivity: 'base'` para
 *     que «Álvarez» caiga junto a «Alvarez» y no detrás de la Z, y con
 *     `numeric` para que «Estudio 10» vaya después de «Estudio 9».
 */

export const COLUMNAS_ORDENABLES = [
  'titulo', 'tipo', 'estado', 'estudiante', 'direccion', 'fin',
] as const

export type ColumnaOrden = (typeof COLUMNAS_ORDENABLES)[number]
export type SentidoOrden = 'asc' | 'desc'
export type Orden = { columna: ColumnaOrden; sentido: SentidoOrden }

/** Lo que hace falta de cada fila para ordenarla; lo arma la pantalla. */
export type ClaveDeOrden = {
  titulo: string
  tipo: string
  estado: string
  /**
   * El estado se ordena por el ORDEN DEL CATÁLOGO, no por su nombre. «En
   * curso», «Depositado», «Defendido» son fases de un recorrido, y
   * alfabéticamente saldrían al revés de como ocurren.
   */
  estadoOrden: number
  estudiante: string
  direccion: string
  /** `YYYY-MM-DD`, que en ISO se ordena como texto, o `null` si no hay. */
  fin: string | null
}

/**
 * «—» cuenta como vacío: es como la pantalla escribe «no hay», y quien ordena
 * por «Estudiante» no espera un bloque de guiones delante de los nombres.
 */
const vacio = (valor: string | null): boolean => {
  const limpio = (valor ?? '').trim()
  return limpio === '' || limpio === '—'
}

const texto = (a: string, b: string): number =>
  a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true })

/**
 * Lee el orden de la URL, o `null` si no hay ninguno válido.
 *
 * SE VALIDA porque una dirección la escribe cualquiera: un `?orden=` inventado
 * tiene que dejar la pantalla en su orden de siempre, no romperla ni ordenar
 * por una columna que no existe. Y vive en la URL, como los filtros de al
 * lado, para que el enlace que se pega en un correo lleve lo que se estaba
 * mirando.
 */
export function leeOrden(columna: string | null, sentido: string | null): Orden | null {
  const c = COLUMNAS_ORDENABLES.find((x) => x === columna)
  if (c === undefined) return null
  return { columna: c, sentido: sentido === 'desc' ? 'desc' : 'asc' }
}

/**
 * Qué orden toca al pulsar una cabecera: la primera vez ascendente, y a partir
 * de ahí alterna. No hay un tercer estado «sin orden»: una cabecera que a la
 * tercera deshace lo que hizo obliga a contar clics.
 */
export function alPulsar(actual: Orden | null, columna: ColumnaOrden): Orden {
  if (actual === null || actual.columna !== columna) return { columna, sentido: 'asc' }
  return { columna, sentido: actual.sentido === 'asc' ? 'desc' : 'asc' }
}

/** El valor por el que se compara, ya elegido por columna. */
function valor(k: ClaveDeOrden, columna: ColumnaOrden): string | null {
  switch (columna) {
    case 'titulo': return k.titulo
    case 'tipo': return k.tipo
    case 'estado': return k.estado
    case 'estudiante': return k.estudiante
    case 'direccion': return k.direccion
    case 'fin': return k.fin
  }
}

/**
 * Ordena sin tocar el array de entrada: `sort` modifica en el sitio, y lo que
 * entra aquí es lo que React está pintando.
 */
export function ordena<T>(
  filas: readonly T[],
  clave: (fila: T) => ClaveDeOrden,
  { columna, sentido }: Orden,
): T[] {
  const signo = sentido === 'asc' ? 1 : -1

  return filas.slice().sort((x, y) => {
    const a = clave(x)
    const b = clave(y)
    const va = vacio(valor(a, columna))
    const vb = vacio(valor(b, columna))

    // Regla 1: lo vacío al final, pase lo que pase con el sentido.
    if (va !== vb) return va ? 1 : -1

    if (!va) {
      const comparados = columna === 'estado'
        ? a.estadoOrden - b.estadoOrden || texto(a.estado, b.estado)
        : texto(valor(a, columna) ?? '', valor(b, columna) ?? '')
      if (comparados !== 0) return comparados * signo
    }

    // Regla 2: el desempate es por título y NO se invierte.
    return texto(a.titulo, b.titulo)
  })
}
