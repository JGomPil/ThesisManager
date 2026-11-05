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
  if (raw.includes('new row violates row-level security')) {
    return 'No tienes permiso para realizar esta acción.'
  }
  if (raw.includes('Failed to fetch')) {
    return 'No se ha podido contactar con el servidor. Puede que el proyecto de Supabase esté pausado.'
  }
  return raw || 'Error desconocido.'
}
