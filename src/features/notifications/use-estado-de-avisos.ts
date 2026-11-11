import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/lib/query-keys'
import { pushRepo } from '@/data/repositories/push.repo'
import { estadoDeAvisos, type EstadoDeAvisos } from '@/domain/avisos/estado-del-dispositivo'

/**
 * En qué situación está ESTE aparato respecto a los avisos.
 *
 * ESTÁ APARTE PORQUE LO PREGUNTAN DOS SITIOS: la tarjeta de Avisos del perfil y
 * el pie de la campana, que tiene que decir una cosa distinta según el caso —en
 * un dispositivo que ya recibe avisos, «que me avise también aquí» no invita a
 * nada—. Con el cálculo escrito dos veces, el día que cambiara una de las dos
 * copias la campana y el perfil dirían cosas distintas del mismo aparato.
 *
 * LO QUE SE LEE DEL NAVEGADOR NO ES ESTADO DE REACT: el permiso lo cambia la
 * persona en un diálogo del navegador, y la suscripción vive en el service
 * worker. Ninguna de las dos cosas avisa a React cuando cambia, así que después
 * de encender o apagar hay que volver a preguntar: eso es `recarga()`.
 */
export function useEstadoDeAvisos(): {
  estado: EstadoDeAvisos
  endpointActual: string | null
  cargando: boolean
  recarga: () => void
} {
  const [vuelta, setVuelta] = React.useState(0)

  const endpoint = useQuery({
    queryKey: [...qk.notifications.dispositivos, 'actual', vuelta],
    queryFn: () => pushRepo.endpointActual(),
  })

  const esIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent)
    // El iPad moderno se presenta como un Mac; lo delata la pantalla táctil.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  const instalada =
    window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && navigator.standalone === true)

  const estado = estadoDeAvisos({
    soporta: pushRepo.soporta(),
    permiso: pushRepo.permiso(),
    suscrito: endpoint.data !== null && endpoint.data !== undefined,
    esIOS,
    instalada,
  })

  return {
    estado,
    endpointActual: endpoint.data ?? null,
    cargando: endpoint.isLoading,
    recarga: () => setVuelta((v) => v + 1),
  }
}
