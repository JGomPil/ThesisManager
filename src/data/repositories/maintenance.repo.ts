import { supabase } from '@/lib/supabase'
import type { KeepaliveRow } from '@/data/types/database'

/**
 * Estado del mantenimiento periódico.
 *
 * Es la ÚNICA detección del fallo de los cron de GitHub que no depende de que
 * GitHub siga ejecutando algo: si los workflows se desactivan por inactividad
 * del repositorio, `last_ping_at` se queda atrás y el panel lo avisa.
 * Ver FREE_TIER.md §5.1.
 */
export const maintenanceRepo = {
  status: async (): Promise<KeepaliveRow | null> => {
    const { data, error } = await supabase.from('keepalive').select('*').eq('id', 1).maybeSingle()
    if (error) throw error
    return data
  },
}

export function keepaliveHealth(row: KeepaliveRow | null | undefined) {
  if (!row?.last_ping_at) {
    return { level: 'unknown' as const, hours: null, message: 'Sin registro de mantenimiento todavía.' }
  }
  const hours = (Date.now() - new Date(row.last_ping_at).getTime()) / 36e5
  if (hours <= 24) {
    return { level: 'ok' as const, hours, message: 'El mantenimiento automático funciona.' }
  }
  if (hours <= 24 * 6) {
    return {
      level: 'warning' as const,
      hours,
      message:
        'Hace más de 24 h del último mantenimiento. Comprueba en GitHub que el workflow ' +
        '«Keepalive Supabase» sigue activo: GitHub lo desactiva tras 60 días sin actividad del repositorio.',
    }
  }
  return {
    level: 'critical' as const,
    hours,
    message:
      'Hace casi una semana del último mantenimiento. Supabase pausa los proyectos gratuitos tras ' +
      '7 días sin actividad de base de datos. Reactiva el workflow en GitHub ahora mismo ' +
      '(Actions → Keepalive Supabase → Enable workflow).',
  }
}
