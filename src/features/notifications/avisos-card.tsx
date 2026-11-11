import * as React from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Laptop, Smartphone, Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { errorMessage } from '@/lib/supabase'
import { qk } from '@/lib/query-keys'
import { avisosConfigurados, pushRepo } from '@/data/repositories/push.repo'
import { useEstadoDeAvisos } from '@/features/notifications/use-estado-de-avisos'
import { useAuth } from '@/features/auth/auth-context'

/**
 * Avisos: este dispositivo y lo que quiero que me avise.
 *
 * ESTA EN «MI PERFIL» Y NO EN ADMINISTRACION porque no lo decide la dirección:
 * lo decide cada uno para sí. Y hay un atajo desde la campana, que es donde se
 * busca: quien quiere que le avisen está mirando los avisos.
 *
 * LO QUE SE ENSEÑA Y POR QUÉ. El estado del aparato lo calcula
 * `estadoDeAvisos`, aparte y probado, porque en iPhone la pregunta «¿soporta
 * avisos este navegador?» responde NO hasta que la aplicación está en la
 * pantalla de inicio, y creerse esa respuesta sería mandar a la gente a
 * cambiar de navegador cuando lo que falta es instalar.
 *
 * Y SE ENSEÑA LA FECHA DEL ÚLTIMO AVISO RECIBIDO en cada aparato, que es lo
 * único que distingue «configurado» de «funcionando». Dar permiso no garantiza
 * que el reparto llegue, y sin esa fecha la única forma de saberlo sería
 * esperar a que ocurriera algo.
 */
export function AvisosCard() {
  const { userId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  // El estado de este aparato lo da el hook, que es el mismo que usa el pie de
  // la campana: si se calculara aquí aparte, las dos pantallas podrían acabar
  // diciendo cosas distintas del mismo dispositivo.
  const { estado, endpointActual, recarga } = useEstadoDeAvisos()

  const dispositivos = useQuery({
    queryKey: qk.notifications.dispositivos,
    queryFn: () => pushRepo.misDispositivos(),
  })

  const prefs = useQuery({
    queryKey: qk.notifications.prefs,
    queryFn: () => pushRepo.prefs(),
  })

  const refresca = () => {
    recarga()
    void qc.invalidateQueries({ queryKey: qk.notifications.dispositivos })
  }

  const encender = useMutation({
    mutationFn: () => pushRepo.suscribir(userId!),
    onSuccess: () => {
      refresca()
      toast.push('success', 'Este dispositivo ya recibe avisos')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const apagar = useMutation({
    mutationFn: () => pushRepo.desuscribir(),
    onSuccess: () => {
      refresca()
      toast.push('success', 'Este dispositivo deja de recibir avisos')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const olvidar = useMutation({
    mutationFn: (id: string) => pushRepo.olvidarDispositivo(id),
    onSuccess: () => {
      refresca()
      toast.push('success', 'Dispositivo olvidado')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const guardar = useMutation({
    mutationFn: (v: { on_dates: boolean; on_comments: boolean; days_before: number }) =>
      pushRepo.guardarPrefs(userId!, v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications.prefs })
      toast.push('success', 'Guardado')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  // Sin fila, todo encendido: la 0032 entiende la ausencia como «no he dicho
  // nada», y lo razonable entonces es avisar.
  const p = prefs.data
  const onDates = p?.on_dates ?? true
  const onComments = p?.on_comments ?? true
  const dias = p?.days_before ?? 3

  const cambia = (campo: 'on_dates' | 'on_comments' | 'days_before', valor: boolean | number) =>
    guardar.mutate({
      on_dates: campo === 'on_dates' ? (valor as boolean) : onDates,
      on_comments: campo === 'on_comments' ? (valor as boolean) : onComments,
      days_before: campo === 'days_before' ? (valor as number) : dias,
    })

  /**
   * Si se llega aqui desde la campana (`/perfil#avisos`), la pagina se coloca
   * en esta tarjeta.
   *
   * NO LO HACE EL NAVEGADOR. Con rutas de cliente, cambiar de pagina no es
   * cargar un documento, asi que el `#avisos` del enlace no desplaza nada: el
   * navegador solo salta a un ancla cuando carga la pagina de verdad. Sin
   * esto, pulsar en la campana parecia no hacer nada, porque la tarjeta
   * quedaba mas abajo de lo que se ve.
   */
  const tarjeta = React.useRef<HTMLDivElement>(null)
  const { hash, key } = useLocation()
  React.useEffect(() => {
    if (hash !== '#avisos') return
    tarjeta.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // `key` en las dependencias, y no solo `hash`: si YA estabas en el perfil,
    // pulsar en la campana no cambia el hash ni vuelve a montar la pagina, asi
    // que sin el no se movia nada y parecia que el enlace estaba roto. `key`
    // cambia en cada navegacion, aunque el destino sea el mismo.
  }, [hash, key])

  return (
    <Card id="avisos" ref={tarjeta} className="scroll-mt-20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Avisos</CardTitle>
        <CardDescription>
          Los avisos de la campana pueden sonar también en el móvil y en el ordenador. Cada aparato
          se activa por separado, y nada se envía por correo.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* --- Este aparato ------------------------------------------------- */}
        <div className="rounded-md border p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <BellRing className="size-4 shrink-0" aria-hidden />
            {estado.titulo}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{estado.explicacion}</p>

          {!avisosConfigurados ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Falta configurar la clave pública de avisos (<code>VITE_VAPID_PUBLIC_KEY</code>) en el
              despliegue. Hasta entonces el botón no podría funcionar, así que no se ofrece.
            </p>
          ) : estado.accion === 'encender' ? (
            <Button
              size="sm" className="mt-2" loading={encender.isPending}
              onClick={() => encender.mutate()}
            >
              Avisarme en este dispositivo
            </Button>
          ) : estado.accion === 'apagar' ? (
            <Button
              size="sm" variant="outline" className="mt-2" loading={apagar.isPending}
              onClick={() => apagar.mutate()}
            >
              Dejar de avisarme aquí
            </Button>
          ) : null}
        </div>

        {/* --- De qué avisar ----------------------------------------------- */}
        <div className="space-y-2">
          <p className="text-sm font-medium">De qué quiero que me avise</p>

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-input"
              checked={onDates}
              disabled={prefs.isLoading || guardar.isPending}
              onChange={(e) => cambia('on_dates', e.target.checked)}
            />
            <span>
              Fechas que se acercan
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Una tarea tuya que vence, una que se ha pasado y los hitos del trabajo.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-input"
              checked={onComments}
              disabled={prefs.isLoading || guardar.isPending}
              onChange={(e) => cambia('on_comments', e.target.checked)}
            />
            <span>
              Comentarios en mis hilos
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Cuando alguien escribe en una tarjeta tuya o responde donde ya habías escrito.
              </span>
            </span>
          </label>

          <div className="pt-1">
            <Label htmlFor="dias-antes">Avisarme con esta antelación</Label>
            <Select
              id="dias-antes"
              className="mt-1.5 max-w-[14rem]"
              value={String(dias)}
              disabled={prefs.isLoading || guardar.isPending}
              onChange={(e) => cambia('days_before', Number(e.target.value))}
            >
              <option value="1">El día antes</option>
              <option value="2">Dos días antes</option>
              <option value="3">Tres días antes</option>
              <option value="7">Una semana antes</option>
              <option value="14">Dos semanas antes</option>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Las dos casillas valen para la campana y para el móvil: un recordatorio que no quieres
              tampoco pinta nada en la campana. Los avisos de que te asignan una tarea, te convocan
              a una reunión o te mencionan no se pueden apagar: no son recordatorios, es trabajo que
              te acaba de caer.
            </p>
          </div>
        </div>

        {/* --- Mis aparatos ------------------------------------------------- */}
        <div>
          <p className="text-sm font-medium">Dispositivos avisados</p>
          {dispositivos.isLoading ? (
            <div className="py-2"><Spinner /></div>
          ) : (dispositivos.data ?? []).length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Ninguno todavía. Enciéndelos uno a uno, desde cada aparato.
            </p>
          ) : (
            <ul className="mt-1.5 divide-y rounded-md border">
              {(dispositivos.data ?? []).map((d) => {
                const movil = /Mobile|Android|iPhone|iPad/.test(d.user_agent ?? '')
                const Icono = movil ? Smartphone : Laptop
                return (
                  <li key={d.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <Icono className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block">{nombreDelAparato(d.user_agent)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {d.endpoint === endpointActual ? 'Este mismo · ' : ''}
                        {d.last_ok_at
                          ? `último aviso recibido el ${format(parseISO(d.last_ok_at), "d/MM/yyyy 'a las' HH:mm")}`
                          : 'todavía no ha recibido ninguno'}
                      </span>
                    </span>
                    <Button
                      variant="ghost" size="icon" className="size-7 shrink-0"
                      onClick={() => olvidar.mutate(d.id)}
                      aria-label="Olvidar este dispositivo"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Un nombre reconocible a partir del `user-agent`.
 *
 * No se intenta acertar la versión ni el modelo: lo único que hace falta es que
 * quien mira la lista sepa CUÁL de sus aparatos es cada línea para poder
 * olvidar el que ya no usa.
 */
function nombreDelAparato(ua: string | null): string {
  if (!ua) return 'Dispositivo'
  const sistema =
    /iPhone/.test(ua) ? 'iPhone'
      : /iPad/.test(ua) ? 'iPad'
        : /Android/.test(ua) ? 'Android'
          : /Windows/.test(ua) ? 'Windows'
            : /Mac OS X/.test(ua) ? 'Mac'
              : /Linux/.test(ua) ? 'Linux'
                : 'Dispositivo'
  const navegador =
    /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari'
              : null
  return navegador ? `${sistema} · ${navegador}` : sistema
}
