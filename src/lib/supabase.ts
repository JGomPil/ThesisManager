import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/data/types/database'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * ¿Hay configuración de Supabase?
 *
 * Si falta, NO se lanza una excepción al importar este módulo: eso dejaría la
 * página en blanco con el error solo en la consola, que es la peor forma
 * posible de contar un problema de configuración. En su lugar se expone esta
 * bandera y la aplicación muestra una pantalla que explica qué falta.
 */
export const supabaseConfigured = Boolean(url && anonKey)

// Valores inertes para que createClient no falle cuando no hay configuración.
// Nunca se llega a usar la red: la interfaz se detiene en la pantalla de
// configuración antes de cualquier consulta.
const safeUrl = url || 'http://localhost:54321'
const safeKey = anonKey || 'sin-configurar'

/**
 * ÚNICO punto de creación del cliente de Supabase en toda la aplicación.
 * Ningún componente debe importar @supabase/supabase-js directamente.
 *
 * Solo se usa la clave anon/publishable. Es pública por diseño: la protección
 * real la ejerce Row Level Security en PostgreSQL, no el secreto de la clave.
 */
export const supabase = createClient<Database>(safeUrl, safeKey, {
  auth: {
    // PKCE devuelve el código en la query (?code=), no en el fragmento (#),
    // que es lo que evita el conflicto con el router en GitHub Pages.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: { headers: { 'x-client-info': 'thesis-manager' } },
})

/** Mensaje de error legible en español a partir de un error de Supabase. */
/**
 * Convierte el `details` de un error de PostgREST en algo que se pueda leer.
 *
 * Puede llegar como cadena, como array de objetos (PGRST201) o como objeto.
 * Se serializa con `JSON.stringify` y se recorta, porque un detalle de tres
 * líneas en un aviso es un detalle que nadie lee; el completo sigue en la
 * consola del navegador para quien lo necesite.
 */
function detalleLegible(details: unknown): string {
  if (details === null || details === undefined) return ''
  if (typeof details === 'string') return details
  try {
    const texto = JSON.stringify(details)
    return texto.length > 300 ? `${texto.slice(0, 300)}…` : texto
  } catch {
    return ''
  }
}

export function errorMessage(error: unknown): string {
  if (!error) return 'Error desconocido.'
  const raw = typeof error === 'string' ? error : ((error as { message?: string }).message ?? '')

  const map: Record<string, string> = {
    'Invalid login credentials': 'Correo o contraseña incorrectos.',
    'Email not confirmed': 'Tienes que confirmar tu correo antes de entrar.',
    'User already registered': 'Ya existe una cuenta con ese correo.',
    'Email rate limit exceeded':
      'Se ha superado el límite de correos por hora de Supabase. Inténtalo más tarde: ' +
      'el plan gratuito permite solo unos pocos envíos cada hora.',
    'over_email_send_rate_limit':
      'Se ha superado el límite de correos por hora de Supabase. Inténtalo más tarde.',
  }
  for (const [needle, message] of Object.entries(map)) {
    if (raw.includes(needle)) return message
  }
  if (raw.includes('Failed to fetch')) {
    return 'No se ha podido contactar con el servidor. Puede que el proyecto de Supabase esté pausado.'
  }

  // Detalle técnico que PostgREST sí envía y que antes se tiraba a la basura.
  // Los errores de PostgreSQL llegan con `code`, `details` y `hint`, y sin
  // ellos un fallo de permisos es indistinguible de otro: «No tienes permiso»
  // no dice si falta un privilegio, si lo ha rechazado una política o si una
  // migración está sin aplicar. Esa ambigüedad costó un rato de diagnóstico el
  // 6 de noviembre de 2026, con un archivado que fallaba porque la política de
  // la migración 0008 todavía no estaba en el proyecto.
  const e = error as { code?: string; details?: unknown; hint?: string }

  // `details` NO SIEMPRE ES UNA CADENA. En el error PGRST201 de un embed
  // ambiguo, PostgREST manda un array de objetos describiendo cada relación
  // candidata, y concatenarlo sin más produce «[object Object],[object
  // Object]», que es exactamente lo contrario de un detalle técnico útil: ocupa
  // el sitio del mensaje y no dice nada. Se vio en pantalla el 6 de noviembre
  // de 2026 con el embed de `templates` y `work_types`.
  const detalle = detalleLegible(e.details)
  const extra = [detalle, e.hint].filter(Boolean).join(' ')
  const codigo = e.code ? ` [${e.code}]` : ''

  if (raw.includes('new row violates row-level security')) {
    return (
      'La base de datos ha rechazado el cambio: tu cuenta no puede dejar esa fila en ese estado. ' +
      'Si deberías poder, lo más probable es que falte aplicar alguna migración de supabase/migrations/.' +
      codigo
    )
  }
  if (e.code === '42501' || raw.includes('permission denied')) {
    // 42501 lo usan dos cosas distintas: un privilegio de tabla o función que
    // falta, y los `raise ... using errcode = 'insufficient_privilege'` de
    // nuestros disparadores, que traen un mensaje propio ya en castellano y
    // mucho más útil. Si hay mensaje propio, manda él.
    if (raw && !raw.includes('permission denied')) return raw
    return `Permiso denegado por la base de datos.${codigo} ${extra}`.trim()
  }
  if (raw.includes('violates row-level security')) {
    return `La política de seguridad ha rechazado la operación.${codigo} ${extra}`.trim()
  }

  // PGRST116: se pidió UNA fila de vuelta y han venido cero. Casi nunca es lo
  // que el código dice —«no se puede convertir a un objeto JSON»— y casi
  // siempre es una de estas dos: la fila ya no existe, o era un UPDATE cuyas
  // filas descartó una política, que en PostgreSQL no da error. Apareció así,
  // literal y sin traducir, al editar un tipo de trabajo global (migración
  // 0022). Los repositorios que esperan una fila lo dicen mejor porque saben
  // de qué fila hablan; esto es la red para los que no.
  if (e.code === 'PGRST116') {
    return (
      'La base de datos no ha devuelto la fila esperada: o ya no existe, o una política de ' +
      'seguridad ha descartado la operación sin dar error.' + codigo
    )
  }

  // Cualquier otro error: el mensaje tal cual, más el detalle si lo hay. Es
  // menos bonito y mucho más útil que un texto genérico.
  if (raw) return extra ? `${raw}${codigo} ${extra}` : `${raw}${codigo}`
  return 'Error desconocido.'
}
