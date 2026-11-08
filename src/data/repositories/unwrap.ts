/**
 * Dos ayudas para leer la respuesta de PostgREST. Viven aparte porque las usan
 * varios repositorios: estaban en `catalogs.repo.ts`, y las columnas del
 * tablero —que son del plan de trabajo, no un catálogo del grupo— las
 * necesitaban igual.
 */

export function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw error
  if (data === null) throw new Error('Respuesta vacía del servidor.')
  return data
}

/**
 * Como `unwrap`, pero para un UPDATE del que se espera que vuelva LA fila.
 *
 * POR QUÉ NO BASTA `.single()`
 * PostgreSQL no da error cuando una política de RLS descarta las filas de un
 * UPDATE: no cambia nada y no dice nada, igual que la casilla de la lista de
 * comprobación que cerró la migración 0009. Con `.single()`, esos cero filas
 * llegaban a la pantalla convertidos en «Cannot coerce the result to a single
 * JSON object [PGRST116] The result contains 0 rows», que es verdad y no
 * significa nada para quien está delante. Fue el aviso que apareció el 7 de
 * noviembre de 2026 al editar un TFG, y debajo había un tipo de trabajo global
 * que ninguna política permitía editar (lo abrió la 0022).
 *
 * Así que `.maybeSingle()` y el caso se dice con palabras. No sobra con la
 * 0022 aplicada: queda para el próximo catálogo al que le falte su política, y
 * para una instalación que vaya por detrás en las migraciones.
 */
export function unwrapUpdated<T>(
  { data, error }: { data: T | null; error: { message: string } | null },
  queEra: string,
): T {
  if (error) throw error
  if (data === null) {
    throw new Error(
      `La base de datos no ha modificado ${queEra}. O ya no existe, o ninguna política de ` +
        'seguridad permite a tu cuenta cambiar esa fila. Si deberías poder, lo más probable es ' +
        'que falte aplicar alguna migración de supabase/migrations/.',
    )
  }
  return data
}
