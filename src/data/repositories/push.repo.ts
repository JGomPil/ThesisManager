import { supabase } from '@/lib/supabase'
import { claveVapidABytes } from '@/domain/avisos/clave-vapid'
import type { NotificationPrefsRow, PushSubscriptionRow } from '@/data/types/database'

/**
 * Los avisos que salen al dispositivo (migración 0032).
 *
 * LA CLAVE PÚBLICA ES PÚBLICA. `VITE_VAPID_PUBLIC_KEY` acaba en el bundle y es
 * correcto que acabe ahí: sirve para que el navegador acepte mensajes firmados
 * por nosotros, no para firmarlos. La privada vive en los secretos de GitHub y
 * no entra en el repositorio ni en el navegador.
 *
 * EL SERVICE WORKER SOLO SE REGISTRA EN PRODUCCIÓN (ver `main.tsx`), así que en
 * desarrollo esto no puede funcionar y lo dice en vez de quedarse colgado:
 * `navigator.serviceWorker.ready` no resuelve NUNCA si no hay ninguno
 * registrado, y una promesa que no vuelve deja el botón girando para siempre.
 */
const CLAVE_PUBLICA: string = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export const avisosConfigurados = CLAVE_PUBLICA.trim() !== ''

function bytesABase64(bytes: ArrayBuffer | null): string {
  if (bytes === null) return ''
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

export const pushRepo = {
  /** Soporte del navegador. En iOS es `false` hasta instalar la aplicación. */
  soporta: (): boolean =>
    typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window,

  permiso: (): NotificationPermission =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default',

  /** El `endpoint` de este aparato, o `null` si no hay suscripción viva. */
  endpointActual: async (): Promise<string | null> => {
    if (!pushRepo.soporta()) return null
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return null
    const sub = await reg.pushManager.getSubscription()
    return sub?.endpoint ?? null
  },

  /**
   * Pide permiso, se suscribe en el navegador y guarda el aparato.
   *
   * EL ORDEN IMPORTA y es el contrario del intuitivo: primero el permiso del
   * navegador y después la fila. Si se guardara antes, una negativa dejaría un
   * dispositivo registrado al que no se puede avisar, y el reparto lo
   * intentaría una y otra vez.
   *
   * Es `upsert` por `endpoint` porque reinstalar o volver a dar permiso produce
   * el mismo endpoint: tiene que actualizar la fila, no chocar con ella.
   */
  suscribir: async (userId: string): Promise<void> => {
    if (!pushRepo.soporta()) throw new Error('Este navegador no puede recibir avisos')

    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) {
      throw new Error(
        'Falta el service worker. En desarrollo no se registra a propósito; '
        + 'esto funciona en la aplicación publicada.',
      )
    }

    const permiso = await Notification.requestPermission()
    if (permiso !== 'granted') throw new Error('No se ha dado permiso para los avisos')

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: claveVapidABytes(CLAVE_PUBLICA),
    })

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: bytesABase64(sub.getKey('p256dh')),
        auth_key: bytesABase64(sub.getKey('auth')),
        user_agent: navigator.userAgent.slice(0, 300),
      },
      { onConflict: 'endpoint' },
    )
    if (error) throw error
  },

  /**
   * Deja de avisar a ESTE aparato y a ninguno más.
   *
   * Se borra la fila ANTES de cancelar la suscripción del navegador. Al
   * revés, si el borrado fallara, quedaría una fila a la que ya no se puede
   * avisar y sin forma de llegar a ella desde esta pantalla, porque el
   * `endpoint` se habría perdido.
   */
  desuscribir: async (): Promise<void> => {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) {
      const { error } = await supabase
        .from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      if (error) throw error
      await sub.unsubscribe()
    }
  },

  /** Mis aparatos. RLS no deja ver los de nadie más. */
  /**
   * Un aviso que NO SALE DE ESTE APARATO.
   *
   * PARA QUE SIRVE: la cadena de un aviso tiene tres tramos -la base de datos
   * lo encola, el reparto lo firma y lo entrega al servicio de push, y el
   * aparato lo ensena-, y cuando no suena nada los tres parecen iguales desde
   * fuera. El reparto ya dice lo suyo: cuenta los envios y los codigos HTTP, y
   * un `201` significa que Google o Apple se quedaron el mensaje. Lo que no
   * decia nadie era si ESTE aparato sabe ensenar un aviso.
   *
   * Esto lo contesta sin red: se lo pide al propio service worker, que es el
   * mismo codigo que atiende los avisos de verdad. Si aparece, el navegador y
   * el sistema operativo estan en orden y lo que falla esta en el camino; si
   * no aparece aunque el permiso este dado, el problema es del sistema -en
   * macOS, Chrome y Safari necesitan ADEMAS permiso en Ajustes del sistema, y
   * el «No molestar» silencia sin avisar de que silencia-.
   */
  avisoDePrueba: async (): Promise<void> => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Este navegador no tiene service worker, asi que no puede recibir avisos')
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      throw new Error('Este navegador todavia no tiene permiso para avisarte')
    }
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification('Aviso de prueba', {
      body: 'Si ves esto, este aparato sabe ensenarte los avisos de Thesis Manager.',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'prueba',
      data: { url: '/perfil' },
    })
  },

  misDispositivos: async (): Promise<PushSubscriptionRow[]> => {
    const { data, error } = await supabase
      .from('push_subscriptions').select('*').order('created_at')
    if (error) throw error
    return data ?? []
  },

  /** Olvidar un aparato concreto desde cualquier otro (un móvil que se perdió). */
  olvidarDispositivo: async (id: string): Promise<void> => {
    const { error } = await supabase.from('push_subscriptions').delete().eq('id', id)
    if (error) throw error
  },

  /**
   * Las dos casillas. `null` significa que no hay fila, o sea «no he dicho
   * nada», que la 0032 interpreta como todo encendido.
   */
  prefs: async (): Promise<NotificationPrefsRow | null> => {
    const { data, error } = await supabase
      .from('notification_prefs').select('*').maybeSingle()
    if (error) throw error
    return data ?? null
  },

  guardarPrefs: async (
    userId: string,
    valores: { on_dates: boolean; on_comments: boolean; days_before: number },
  ): Promise<void> => {
    const { error } = await supabase
      .from('notification_prefs')
      .upsert({ user_id: userId, ...valores }, { onConflict: 'user_id' })
    if (error) throw error
  },
}
