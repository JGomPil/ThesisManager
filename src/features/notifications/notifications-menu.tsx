import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/common/states'
import { cn } from '@/lib/utils'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { notificationsRepo } from '@/data/repositories/notifications.repo'
import { useToast } from '@/components/ui/toast'

/**
 * Buzón de notificaciones.
 *
 * NO HAY SUSCRIPCIÓN EN TIEMPO REAL, A PROPÓSITO. Se consulta el número de no
 * leídas cada minuto con una petición `head` que solo devuelve el recuento, sin
 * filas. Una suscripción de Realtime mantendría abierto un websocket por
 * pestaña durante toda la sesión, y el plan gratuito de Supabase limita las
 * conexiones concurrentes: con el grupo entero trabajando sería el primer
 * límite en tocarse, y a cambio de ganar unos segundos en un aviso que no es
 * urgente. La lista completa solo se pide al abrir el panel.
 *
 * Las notificaciones las crean disparadores de la base de datos (migración
 * 0011). El cliente solo las lee, las marca leídas y las borra: `notifications`
 * no tiene política de INSERT, así que nadie puede escribir en el buzón de otro.
 */
export function NotificationsMenu() {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()

  const unread = useQuery({
    queryKey: qk.notifications.unread,
    queryFn: () => notificationsRepo.unreadCount(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const list = useQuery({
    queryKey: qk.notifications.list,
    queryFn: () => notificationsRepo.list(),
    enabled: open,
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.notifications.list })
    void qc.invalidateQueries({ queryKey: qk.notifications.unread })
  }

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsRepo.markRead(id),
    onSuccess: refresh,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const markAll = useMutation({
    mutationFn: () => notificationsRepo.markAllRead(),
    onSuccess: refresh,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => notificationsRepo.remove(id),
    onSuccess: refresh,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const count = unread.data ?? 0
  const rows = list.data ?? []

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost" size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `Notificaciones (${count} sin leer)` : 'Notificaciones'}
        aria-expanded={open}
      >
        <span className="relative">
          <Bell />
          {count > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </span>
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-medium">Notificaciones</p>
            {count > 0 && (
              <Button size="sm" variant="ghost" loading={markAll.isPending} onClick={() => markAll.mutate()}>
                <CheckCheck /> Marcar todo
              </Button>
            )}
          </div>

          {/*
            El atajo a los ajustes va EN LA CAMPANA porque es donde se busca:
            quien quiere que le avisen al movil esta mirando los avisos, no su
            perfil. Los ajustes viven en el perfil porque no los decide la
            direccion, los decide cada uno para si.
          */}
          <div className="max-h-[22rem] overflow-y-auto">
            {list.isLoading ? (
              <div className="p-4"><Spinner /></div>
            ) : rows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No tienes notificaciones. Aquí aparecen las tareas que te asignan, las reuniones
                convocadas, las entregas nuevas, los comentarios en tus hilos y las fechas que se
                acercan.
              </p>
            ) : (
              <ul className="divide-y">
                {rows.map((n) => (
                  <li
                    key={n.id}
                    className={cn('flex gap-2 px-3 py-2', n.read_at === null && 'bg-primary/5')}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        if (n.read_at === null) markRead.mutate(n.id)
                        if (n.link) { setOpen(false); navigate(n.link) }
                      }}
                    >
                      <span className="flex items-start gap-1.5">
                        {n.read_at === null && (
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{n.title}</span>
                          {n.body && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                          )}
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {formatDistanceToNow(parseISO(n.created_at), { locale: es, addSuffix: true })}
                          </span>
                        </span>
                      </span>
                    </button>
                    <Button
                      variant="ghost" size="icon" className="size-7 shrink-0"
                      onClick={() => remove.mutate(n.id)}
                      aria-label="Borrar notificación"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t px-3 py-2">
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => { setOpen(false); navigate('/perfil') }}
            >
              Que me avise también en el móvil y el ordenador
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
