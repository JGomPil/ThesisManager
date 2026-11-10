/**
 * Qué plantilla debe quedar elegida al cambiar el tipo de trabajo.
 *
 * `work_types.default_template_id` existía en el catálogo y era otra casilla
 * que no hacía nada: no se podía marcar desde ninguna pantalla y, aunque se
 * marcara, nadie la miraba. Lo destapó `check:columnas`.
 *
 * SE PRESELECCIONA, NO SE APLICA SOLA (decisión de la dirección, 10-11-2026).
 * Aplicarla sin preguntar ahorra un clic y, el día que un trabajo no siga el
 * guion, lo hace nacer con quince tareas que hay que ir borrando a mano. Así
 * que el desplegable viene con la plantilla normal puesta y el botón sigue
 * siendo tuyo.
 *
 * Si la plantilla marcada no está entre las aplicables —porque la retiraron, o
 * porque es de otro tipo— se devuelve «sin plan» en lugar de ofrecer algo que
 * `app.apply_template` rechazaría al guardar (prueba [86]).
 *
 * SOLO SE LLAMA AL CAMBIAR DE TIPO, y eso importa: si se llamara cada vez que
 * se recarga la lista, a quien eligiera «Empezar sin plan» le volvería a
 * aparecer la plantilla sola, una y otra vez.
 */
export function plantillaAlCambiarDeTipo(
  disponibles: { id: string }[],
  porOmision: string | null,
): string {
  if (porOmision === null) return ''
  return disponibles.some((t) => t.id === porOmision) ? porOmision : ''
}
