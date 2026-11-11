/**
 * De una lista plana de comentarios a hilos de dos niveles.
 *
 * `comments.parent_comment_id` existe desde la 0005 y hasta la 0036 no la
 * escribía nadie: el hilo era plano y en una tarjeta con quince comentarios no
 * se sabía a cuál contestaba cada uno.
 *
 * DOS NIVELES, Y LA BASE DE DATOS LO EXIGE (`comments_parent_valido`, 0036): de
 * una respuesta no cuelga nada. No es una simplificación de esta función: una
 * conversación anidada sin fin no cabe en la columna de una ficha —al cuarto
 * nivel el texto tiene tres palabras por línea— y, peor, deja de decir a qué
 * contesta cada cosa, que es justo lo que se venía a arreglar.
 *
 * LA REGLA QUE IMPORTA AQUÍ ES LA DE LA RESPUESTA HUÉRFANA. Una respuesta cuyo
 * padre no está en la lista —porque lo borraron, que es borrado lógico y
 * `byEntity` no lo devuelve— **se enseña como un comentario más**, en su sitio
 * cronológico. La alternativa era descartarla, y eso hace desaparecer de la
 * pantalla lo que alguien escribió sin que nada lo avise, que es lo peor que
 * puede hacer un hilo de seguimiento: se cita en informes y en reuniones.
 */
export type ComentarioEnHilo = {
  id: string
  parent_comment_id: string | null
  created_at: string
}

export type Hilo<T> = {
  comentario: T
  /** Respuestas, de la más antigua a la más reciente. */
  respuestas: T[]
}

export function agruparEnHilos<T extends ComentarioEnHilo>(comentarios: T[]): Hilo<T>[] {
  const porId = new Map(comentarios.map((c) => [c.id, c]))
  const respuestasDe = new Map<string, T[]>()

  // Una respuesta cuenta como respuesta solo si su padre está aquí; si no,
  // sube a primer nivel para que no se pierda.
  const esRespuesta = (c: T): boolean =>
    c.parent_comment_id !== null && porId.has(c.parent_comment_id)

  for (const c of comentarios) {
    if (!esRespuesta(c)) continue
    const lista = respuestasDe.get(c.parent_comment_id!) ?? []
    lista.push(c)
    respuestasDe.set(c.parent_comment_id!, lista)
  }

  const orden = (a: T, b: T) => a.created_at.localeCompare(b.created_at)

  return comentarios
    .filter((c) => !esRespuesta(c))
    .sort(orden)
    .map((c) => ({ comentario: c, respuestas: (respuestasDe.get(c.id) ?? []).sort(orden) }))
}

/**
 * ¿De qué comentario tiene que colgar una respuesta a `c`?
 *
 * Si `c` ya es una respuesta, de su mismo padre: así «responder a una
 * respuesta» sigue la conversación en lugar de abrir un tercer nivel que la
 * base de datos rechazaría. Es la misma regla, escrita una vez, y por eso la
 * pantalla no tiene que saberla.
 */
export function raizDeLaRespuesta(c: ComentarioEnHilo): string {
  return c.parent_comment_id ?? c.id
}
