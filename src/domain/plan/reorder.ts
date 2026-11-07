/**
 * Reordenar una lista de hermanos (los puntos de una lista de comprobación).
 *
 * El orden vive en `tasks.order_index`, que ya existía y lo usaba solo la
 * aplicación de plantillas: las listas creadas a mano nacían todas con
 * `order_index = 0` y se veían en el orden en que se habían escrito
 * (`order by order_index, created_at`). O sea que el orden era el de llegada y
 * no había manera de cambiarlo, que es justo lo que hacía falta: una lista de
 * comprobación se piensa escribiéndola y casi nunca sale ordenada.
 *
 * Las dos funciones son PURAS y viven aquí, no en la pantalla, porque son la
 * parte con aritmética: mover un elemento de una posición a otra y decidir
 * qué filas hay que escribir de verdad. Lo demás (botones, arrastrar) es
 * pintura.
 */

/**
 * Devuelve una lista nueva con el elemento de `desde` colocado en `hasta`.
 *
 * Fuera de rango o sin movimiento, devuelve la lista tal cual. No muta la
 * original: la pantalla compara la nueva con la vieja para saber qué guardar.
 */
export function moveItem<T>(items: T[], desde: number, hasta: number): T[] {
  if (desde === hasta) return items
  if (desde < 0 || desde >= items.length) return items
  if (hasta < 0 || hasta >= items.length) return items
  const copia = [...items]
  const [movido] = copia.splice(desde, 1)
  copia.splice(hasta, 0, movido!)
  return copia
}

/**
 * Qué filas hay que actualizar para que el orden guardado sea el de la lista.
 *
 * Recibe la lista YA en el orden deseado, con el `order_index` que cada fila
 * tiene ahora mismo en la base de datos, y devuelve solo las que no coinciden
 * con su posición. Mover un punto una fila arriba son dos escrituras, no la
 * lista entera: cada escritura es una petición contra un proyecto gratuito.
 *
 * El `order_index` resultante es la POSICIÓN (0, 1, 2…), sin huecos. Numerar de
 * diez en diez para «dejar sitio» ahorraría escrituras en algunos casos y
 * obligaría a renumerar en otros; con listas de comprobación de media docena de
 * puntos, la cuenta sencilla gana.
 */
export function reorderWrites(
  deseado: { id: string; order_index: number }[],
): { id: string; order_index: number }[] {
  const cambios: { id: string; order_index: number }[] = []
  deseado.forEach((fila, i) => {
    if (fila.order_index !== i) cambios.push({ id: fila.id, order_index: i })
  })
  return cambios
}
