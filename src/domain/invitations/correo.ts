/**
 * El correo de invitación, escrito para que lo mande una persona.
 *
 * LA APLICACIÓN NO ENVÍA CORREOS Y NO VA A ENVIARLOS: hacerlo exige la clave
 * `service_role` de Supabase, que salta RLS entera y no puede vivir en un
 * frontend servido desde un repositorio público (SECURITY.md §7). Lo que sí se
 * puede hacer es dejar el correo escrito y abrirlo en el programa de correo de
 * quien invita, que es quien lo firma y lo envía. El envío sale de su buzón, con
 * su nombre, y no hay ninguna credencial de por medio.
 *
 * POR QUÉ ESTÁ AQUÍ Y NO EN LA PANTALLA. El texto tiene dos datos que no se
 * pueden olvidar, y en una plantilla dentro del JSX se olvidan:
 *
 *  1. **La dirección exacta con la que hay que entrar.** El alta automática
 *     (migración 0005) busca la invitación por `email = lower(new.email)`: si
 *     la persona se registra con otra dirección —la personal en vez de la de la
 *     universidad— la invitación no se encuentra, la cuenta queda sin
 *     organización y no ve absolutamente nada. Es el fallo más probable de todo
 *     el proceso y el que peor se diagnostica.
 *  2. **Cómo conseguir la contraseña.** El registro público está deshabilitado,
 *     así que no hay «crear cuenta»: o se le da una contraseña temporal, o usa
 *     «He olvidado mi contraseña» en la pantalla de acceso. Sin esa frase, el
 *     correo lleva a una pantalla donde no se puede hacer nada.
 */
export type DatosDeInvitacion = {
  /** A quién se escribe. Vacío o nulo: se saluda sin nombre. */
  nombre?: string | null
  /** La dirección con la que tendrá que entrar. */
  correo: string
  /** Quien invita, para la firma. */
  quienInvita?: string | null
  /** La dirección de la aplicación, con su ruta base. */
  url: string
}

export type CorreoRedactado = {
  asunto: string
  cuerpo: string
}

export function correoDeInvitacion(d: DatosDeInvitacion): CorreoRedactado {
  const nombre = (d.nombre ?? '').trim()
  const firma = (d.quienInvita ?? '').trim()

  const cuerpo = [
    nombre ? `Hola ${nombre}:` : 'Hola:',
    '',
    'Te he dado de alta en Thesis Manager, la aplicación con la que llevamos el seguimiento de los trabajos académicos del grupo: tareas, reuniones, entregas y fechas.',
    '',
    `Se entra aquí: ${d.url}`,
    '',
    `Importante: entra con esta dirección de correo, ${d.correo}. Si usas otra, la aplicación no te reconocerá y no verás nada.`,
    '',
    'Si todavía no tienes contraseña, pulsa «He olvidado mi contraseña» en la pantalla de acceso y te llegará un enlace para ponerla.',
    '',
    firma ? `Un saludo,\n${firma}` : 'Un saludo.',
  ].join('\n')

  return { asunto: 'Acceso a Thesis Manager', cuerpo }
}

/**
 * El enlace `mailto:` que abre el programa de correo con todo escrito.
 *
 * `encodeURIComponent` y no `encodeURI`: hay que escapar los saltos de línea,
 * los dos puntos y, sobre todo, el `&`. Sin escapar, un `&` en el nombre de
 * alguien («Marta & co.») corta el cuerpo del mensaje por la mitad, porque el
 * programa de correo lo lee como el principio de otro parámetro.
 *
 * La dirección va SIN escapar en la ruta: ahí la arroba es legal y escaparla
 * (`%40`) hace que algunos clientes la metan tal cual en el campo «Para».
 */
export function enlaceMailto(d: DatosDeInvitacion): string {
  const { asunto, cuerpo } = correoDeInvitacion(d)
  return `mailto:${d.correo}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`
}
