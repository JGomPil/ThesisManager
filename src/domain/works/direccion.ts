/**
 * Cuánta dirección lleva un trabajo, y si eso cuadra con su tipo.
 *
 * POR QUÉ EXISTE ESTO. `work_types.max_supervisors` está en el catálogo desde
 * la primera migración: al definir un tipo de trabajo se puede escribir cuántas
 * personas admite en la dirección. **No la comprobaba nadie.** Se podía poner
 * un 2 en el TFG y añadirle cinco directores sin que nada dijera ni pistío, de
 * modo que la casilla daba a entender que decidía algo y no decidía nada. Lo
 * destapó `scripts/check-columnas-huerfanas.sh`.
 *
 * AVISA, NO IMPIDE, y es una decisión tomada a propósito (dirección, 10-11-2026).
 * Los casos raros existen y son legítimos —una codirección externa, un relevo a
 * mitad de curso, un tribunal que entra un mes—, y una regla tajante estorbaría
 * justo ahí, que es donde menos falta hace pelearse con la aplicación. El
 * número del catálogo es lo NORMAL, no lo permitido.
 *
 * Y POR ESO ESTO NO ES SEGURIDAD y no va en una migración: es una ayuda para no
 * equivocarse sin querer. Si alguna vez hiciera falta impedirlo de verdad, el
 * sitio sería un disparador sobre `work_members`, no este fichero.
 *
 * CUENTA PERSONAS, NO FILAS. Alguien puede tener dos funciones de supervisión
 * en el mismo trabajo —director y, además, miembro del comité—, y son dos filas
 * de `work_members` de la misma persona. Contarlas por separado diría que la
 * dirección es más grande de lo que es, y el aviso saltaría solo.
 */

export type MiembroDireccion = {
  user_id: string
  status: 'ACTIVE' | 'INACTIVE'
  role: { is_supervisory: boolean } | null
}

/** Personas distintas con alguna función de supervisión ACTIVA. */
export function cuentaDireccion(miembros: MiembroDireccion[]): number {
  const personas = new Set(
    miembros
      .filter((m) => m.status === 'ACTIVE' && m.role?.is_supervisory === true)
      .map((m) => m.user_id),
  )
  return personas.size
}

/**
 * El aviso que se enseña, o `null` si no hay nada que avisar.
 *
 * `anade` distingue las dos situaciones, que dicen cosas distintas: estás a
 * punto de pasarte, o ya estabas pasado desde antes (datos viejos, o el número
 * del catálogo que alguien bajó después).
 */
export function avisoDeDireccion(
  miembros: MiembroDireccion[],
  maximo: number | null,
  tipo: string | null,
  anade: boolean,
): string | null {
  // Sin número en el catálogo no hay nada que comparar, que es el caso por
  // omisión: la columna es nullable y casi todos los tipos la tienen vacía.
  if (maximo === null || maximo < 1) return null

  const actuales = cuentaDireccion(miembros)
  const total = anade ? actuales + 1 : actuales
  if (total <= maximo) return null

  const nombre = tipo === null || tipo === '' ? 'Este tipo de trabajo' : `El tipo «${tipo}»`
  const personas = (n: number) => (n === 1 ? '1 persona' : `${n} personas`)

  return anade
    ? `${nombre} suele llevar ${personas(maximo)} en la dirección, y con esta serían ${total}. `
      + 'Puedes añadirla igualmente.'
    : `Este trabajo tiene ${personas(actuales)} en la dirección y ${nombre.toLowerCase()} `
      + `suele llevar ${personas(maximo)}.`
}
