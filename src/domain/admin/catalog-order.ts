/**
 * «Otros» va al final de un catálogo, nunca en medio.
 *
 * POR QUÉ HACE FALTA UNA FUNCIÓN PARA ESTO
 * `research_lines` no tiene columna de orden —a diferencia de `work_types` o
 * `document_types`, que llevan `display_order`—, así que la lista se pide
 * ordenada por nombre. Y por nombre, «Otros» cae en su sitio alfabético: en
 * mitad de la lista, entre dos líneas de investigación de verdad. Pero «Otros»
 * no es una línea más, es la casilla de descarte, y una casilla de descarte se
 * busca al final. Es la convención que ya siguen los catálogos que sí tienen
 * orden: en el catálogo inicial, «Otros» de los tipos de documento lleva el
 * `display_order` 9, el último de los nueve.
 *
 * SE DECIDE POR EL NOMBRE, no por un código, porque estas filas no tienen
 * código: lo que escribe la administración es el nombre y nada más. Entran
 * «Otros», «Otras», «Otras líneas», «Otro»; no entra «Otorrinolaringología»,
 * que empieza parecido y es una línea de investigación como cualquier otra.
 *
 * Y va aquí, en el dominio, en lugar de en la consulta: PostgreSQL ordenaría
 * por `name` con su propio criterio de idioma, que depende de la configuración
 * regional del servidor, mientras que esto es una regla nuestra, en castellano
 * y con una prueba al lado.
 */
const DESCARTE = /^otr[oa]s?\b/i

/** ¿Es la fila de descarte de un catálogo? */
export function esDescarte(nombre: string): boolean {
  return DESCARTE.test(nombre.trim())
}

/**
 * Ordena alfabéticamente, en castellano, dejando «Otros» al final.
 *
 * No modifica la lista recibida: devuelve otra. Una función del dominio que
 * reordenase su argumento cambiaría la caché de react-query por la espalda.
 */
export function ordenarConOtrosAlFinal<T extends { name: string }>(filas: T[]): T[] {
  return filas.slice().sort((a, b) => {
    const da = esDescarte(a.name) ? 1 : 0
    const db = esDescarte(b.name) ? 1 : 0
    if (da !== db) return da - db
    // `localeCompare` en castellano: así «Ñ» va donde debe y los acentos no
    // mandan a «Álgebra» al final de la lista.
    return a.name.localeCompare(b.name, 'es')
  })
}
