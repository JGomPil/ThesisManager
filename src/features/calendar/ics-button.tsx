import { useMutation } from '@tanstack/react-query'
import { CalendarPlus } from 'lucide-react'
import { addMonths, format, subMonths } from 'date-fns'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { errorMessage } from '@/lib/supabase'
import { descargarTexto } from '@/lib/download'
import { calendarRepo } from '@/data/repositories/calendar.repo'
import { construirIcs, nombreFicheroIcs } from '@/domain/plan/ics'
import type { CalendarEvent } from '@/domain/plan/calendar'

/**
 * «Descargar al calendario»: las fechas, en el calendario donde ya se mira la
 * semana.
 *
 * DÓNDE ESTÁ Y POR QUÉ: en la pantalla de Calendario y en la tarjeta «Fechas»
 * de un trabajo, que son los dos sitios donde alguien va a buscar sus fechas.
 * Una exportación escondida en Administración no la usaría nadie.
 *
 * QUÉ VENTANA SE LLEVA: tres meses atrás y dos años adelante. Lo pasado
 * también, porque un vencimiento que se incumplió sigue siendo información
 * —y el calendario de destino es donde se ve el histórico—; y dos años porque
 * una tesis dura eso o más, así que una ventana «del mes que se está mirando»
 * dejaría fuera justo la planificación que interesa. No se reutiliza la
 * consulta de la pantalla, que pide solo el mes a la vista.
 *
 * ES UNA FOTO, NO UNA SUSCRIPCIÓN, y se dice al lado del botón: ver la
 * cabecera de `src/domain/plan/ics.ts`.
 */
export function DescargarIcs({
  etiqueta,
  nombre,
  filtrar,
  size = 'sm',
}: {
  /** Base del nombre del fichero: el título del trabajo, o algo genérico. */
  etiqueta: string
  /** Nombre del calendario tal como lo verá quien lo importe. */
  nombre: string
  /** Recorte adicional: un trabajo concreto, o los filtros de la pantalla. */
  filtrar?: (e: CalendarEvent) => boolean
  size?: 'sm' | 'default'
}) {
  const toast = useToast()

  const descargar = useMutation({
    mutationFn: async () => {
      const hoy = new Date()
      const eventos = await calendarRepo.events(
        format(subMonths(hoy, 3), 'yyyy-MM-dd'),
        format(addMonths(hoy, 24), 'yyyy-MM-dd'),
      )
      const elegidos = filtrar ? eventos.filter(filtrar) : eventos
      if (elegidos.length === 0) return 0

      const ics = construirIcs(elegidos, {
        ahora: hoy,
        // Raíz absoluta de la aplicación publicada: el enlace de cada evento
        // se abre desde un calendario ajeno, donde una ruta relativa no lleva
        // a ningún sitio. `BASE_URL` acaba en barra.
        baseUrl: `${window.location.origin}${import.meta.env.BASE_URL}`,
        nombre,
      })
      descargarTexto(nombreFicheroIcs(etiqueta, hoy), ics, 'text/calendar;charset=utf-8')
      return elegidos.length
    },
    onSuccess: (cuantos) => {
      if (cuantos === 0) toast.push('info', 'No hay fechas que exportar en este periodo.')
      else toast.push('success', `${cuantos} ${cuantos === 1 ? 'fecha' : 'fechas'} en el fichero. Ábrelo para añadirlas a tu calendario.`)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  return (
    <Button
      variant="outline"
      size={size}
      loading={descargar.isPending}
      onClick={() => descargar.mutate()}
      title="Descarga un fichero .ics con las fechas de los próximos dos años. Es una foto del estado de hoy: si una fecha cambia, vuelve a descargarlo."
    >
      <CalendarPlus /> Descargar al calendario
    </Button>
  )
}
