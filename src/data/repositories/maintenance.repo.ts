import { supabase } from '@/lib/supabase'
import type { KeepaliveRow } from '@/data/types/database'
import { DOCS_BUCKET } from '@/data/repositories/documents.repo'
import { TEMPLATE_BUCKET } from '@/data/repositories/templates.repo'
import { AVATARS_BUCKET } from '@/lib/avatars'

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

// -----------------------------------------------------------------------------
// Consumo del plan gratuito
// -----------------------------------------------------------------------------

export type UsoDeCubo = {
  bucket: string
  etiqueta: string
  ficheros: number
  bytes: number
  /** Filas de la base que apuntan a un fichero de ese cubo. */
  esperados: number
  /** El recorrido se detuvo por profundidad: la cifra es un mínimo. */
  truncado: boolean
}

export type UsoDelPlan = {
  cubos: UsoDeCubo[]
  bytes: number
  ficheros: number
  esperados: number
  truncado: boolean
}

/** Un paso de paginación. 100 es el techo que usa la propia API por omisión. */
const PAGINA = 100

/**
 * Las rutas más profundas del proyecto tienen tres niveles
 * (`<trabajo>/<documento>/<fichero>`), así que con cuatro hay margen de sobra.
 * El tope existe para que una estructura inesperada no deje el navegador
 * recorriendo carpetas hasta agotarse; si se alcanza, la cifra se marca como
 * mínimo en lugar de presentarse como total.
 */
const PROFUNDIDAD_MAXIMA = 4

async function recorrerCubo(
  bucket: string, prefijo = '', profundidad = 1,
): Promise<{ ficheros: number; bytes: number; truncado: boolean }> {
  let ficheros = 0
  let bytes = 0
  let truncado = false
  let desplazamiento = 0

  for (;;) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefijo, { limit: PAGINA, offset: desplazamiento })
    if (error) throw error
    const entradas = data ?? []

    for (const e of entradas) {
      // En la API de Storage una CARPETA viene con `id` nulo y sin metadatos.
      if (e.id === null) {
        if (profundidad >= PROFUNDIDAD_MAXIMA) { truncado = true; continue }
        const dentro = await recorrerCubo(bucket, prefijo ? `${prefijo}/${e.name}` : e.name, profundidad + 1)
        ficheros += dentro.ficheros
        bytes += dentro.bytes
        truncado = truncado || dentro.truncado
        continue
      }
      ficheros += 1
      // `size` llega en los metadatos del objeto. Si faltara, se cuenta el
      // fichero y no se inventa su tamaño.
      const tamano = (e.metadata as { size?: unknown } | null)?.size
      if (typeof tamano === 'number' && Number.isFinite(tamano)) bytes += tamano
    }

    if (entradas.length < PAGINA) break
    desplazamiento += PAGINA
  }

  return { ficheros, bytes, truncado }
}

/** Filas que apuntan a un fichero de Storage. `head: true` no trae datos. */
async function contar(
  tabla: 'document_versions' | 'template_files',
): Promise<number> {
  const { count, error } = await supabase
    .from(tabla)
    .select('id', { count: 'exact', head: true })
    .not('storage_path', 'is', null)
  if (error) throw error
  return count ?? 0
}

/**
 * Las fotos de perfil pueden ser una ruta del cubo o una dirección externa
 * (Gravatar, la ficha institucional). Solo las primeras ocupan sitio, así que
 * las que empiezan por `http` no se cuentan.
 *
 * `ilike` y no `like`: la regla del dominio es `/^https?:\/\//i`, sin
 * distinguir mayúsculas, y las dos tienen que decir lo mismo. Con `like`, un
 * `HTTPS://…` escrito a mano contaría como fichero del cubo y la tarjeta
 * avisaría de que «falta un fichero» que nunca existió.
 */
async function contarAvatares(): Promise<number> {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .not('avatar_url', 'is', null)
    .not('avatar_url', 'ilike', 'http%')
  if (error) throw error
  return count ?? 0
}

/**
 * Lo que ocupan los ficheros, cubo por cubo, y lo que la base de datos dice
 * que debería haber en cada uno.
 *
 * CUENTA LO QUE ESTA CUENTA PUEDE VER, que es lo que Row Level Security y las
 * políticas de los cubos le devuelven. Para la administración son todos, pero
 * la pantalla lo dice en lugar de presentarlo como el total del proyecto: ese
 * total solo lo da el panel de Supabase.
 */
export async function planUsage(): Promise<UsoDelPlan> {
  const [docs, plantillas, avatares, nDocs, nPlantillas, nAvatares] = await Promise.all([
    recorrerCubo(DOCS_BUCKET),
    recorrerCubo(TEMPLATE_BUCKET),
    recorrerCubo(AVATARS_BUCKET),
    contar('document_versions'),
    contar('template_files'),
    contarAvatares(),
  ])

  const cubos: UsoDeCubo[] = [
    { bucket: DOCS_BUCKET, etiqueta: 'Documentos de los trabajos', esperados: nDocs, ...docs },
    { bucket: TEMPLATE_BUCKET, etiqueta: 'Material de las plantillas', esperados: nPlantillas, ...plantillas },
    { bucket: AVATARS_BUCKET, etiqueta: 'Fotos de perfil', esperados: nAvatares, ...avatares },
  ]

  return {
    cubos,
    bytes: cubos.reduce((a, c) => a + c.bytes, 0),
    ficheros: cubos.reduce((a, c) => a + c.ficheros, 0),
    esperados: cubos.reduce((a, c) => a + c.esperados, 0),
    truncado: cubos.some((c) => c.truncado),
  }
}
