import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { qk } from '@/lib/query-keys'
import { keepaliveHealth, maintenanceRepo } from '@/data/repositories/maintenance.repo'
import { cn } from '@/lib/utils'

/**
 * Aviso de mantenimiento. Es la única detección del fallo de los cron de
 * GitHub que NO depende de que GitHub siga ejecutando algo: si los workflows
 * se desactivan por inactividad del repositorio, esta marca se queda atrás.
 * Ver FREE_TIER.md §5.1 y §6.bis.
 *
 * Solo se muestra a los administradores, y solo cuando hay algo que decir.
 */
export function KeepaliveBanner() {
  const { data } = useQuery({
    queryKey: qk.maintenance,
    queryFn: maintenanceRepo.status,
    // Una consulta por sesión basta: además cuenta como actividad de base de
    // datos, que es justo lo que evita la pausa de Supabase.
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  const health = keepaliveHealth(data)
  if (health.level === 'ok' || health.level === 'unknown') return null

  const when = data?.last_ping_at
    ? formatDistanceToNow(parseISO(data.last_ping_at), { addSuffix: true, locale: es })
    : 'nunca'

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-sm',
        health.level === 'critical'
          ? 'border-destructive/50 bg-destructive/5'
          : 'border-amber-500/50 bg-amber-500/5',
      )}
      role="alert"
    >
      {health.level === 'critical' ? (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      ) : (
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-600" />
      )}
      <div className="min-w-0">
        <p className="font-medium">Mantenimiento automático: último registro {when}</p>
        <p className="mt-0.5 text-muted-foreground">{health.message}</p>
      </div>
    </div>
  )
}
