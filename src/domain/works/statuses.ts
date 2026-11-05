import type { WorkStatusRow, WorkTypeStatusRow } from '@/data/types/database'

/**
 * Estados aplicables a un tipo de trabajo.
 *
 * Regla del modelo (DATABASE.md §3.2): si un tipo NO tiene filas en
 * `work_type_statuses`, le aplican TODOS los estados activos. Si las tiene,
 * solo esos. Es lo que permite que la Academia de Alumnos Internos no pase por
 * «Pendiente de depósito» ni «Defendido» sin que nada esté codificado a mano.
 */
export function statusesForWorkType(
  workTypeId: string | null | undefined,
  allStatuses: WorkStatusRow[],
  mappings: WorkTypeStatusRow[],
): WorkStatusRow[] {
  if (!workTypeId) return allStatuses
  const allowed = mappings.filter((m) => m.work_type_id === workTypeId)
  if (allowed.length === 0) return allStatuses

  const order = new Map(allowed.map((m) => [m.status_id, m.display_order]))
  return allStatuses
    .filter((s) => order.has(s.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}
