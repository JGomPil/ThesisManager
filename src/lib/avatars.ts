import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** Cubo privado creado por la migración 0017. */
export const AVATARS_BUCKET = 'avatars'

/** Duración de la URL firmada. Una hora: la pantalla se mira, no se guarda. */
const VIGENCIA = 3600

// `esUrlExterna` es pura y vive en el dominio (lo importan las pruebas, que no
// deben arrastrar el cliente de Supabase). Se reexporta para que quien ya la
// importaba de aquí no tenga que cambiar.
export { esUrlExterna } from '@/domain/people/avatar'
import { esUrlExterna } from '@/domain/people/avatar'

// -----------------------------------------------------------------------------
// Firma AGRUPADA
//
// POR QUÉ NO UNA PETICIÓN POR CARA
// En el listado de trabajos hay veinte filas con dos personas cada una. Firmar
// una a una serían ~25 peticiones a Storage en cada carga, y el plan gratuito se
// mide en peticiones. Aquí se acumulan las rutas que piden los componentes que
// se están montando y se resuelven TODAS en una sola llamada
// (`createSignedUrls`), en el siguiente tick.
//
// Cómo funciona: el primer componente que pide una ruta programa el vaciado con
// una microtarea; todos los que se monten en ese mismo ciclo de renderizado
// entran en el mismo lote. No hay temporizadores ni esperas artificiales: el
// lote se cierra en cuanto React termina de montar.
// -----------------------------------------------------------------------------

type Pendiente = { resolver: (v: string | null) => void }

let pendientes = new Map<string, Pendiente[]>()
let programado = false

async function vaciar(): Promise<void> {
  const lote = pendientes
  pendientes = new Map()
  programado = false

  const rutas = [...lote.keys()]
  if (rutas.length === 0) return

  try {
    const { data, error } = await supabase.storage
      .from(AVATARS_BUCKET)
      .createSignedUrls(rutas, VIGENCIA)
    if (error) throw error

    // `createSignedUrls` responde una entrada por ruta, con su propio error si
    // esa concreta no se pudo firmar (no existe, o la política la deniega). Una
    // ruta fallida NO debe tumbar el lote: esa cara se queda en iniciales.
    const porRuta = new Map((data ?? []).map((d) => [d.path ?? '', d.signedUrl]))
    for (const [ruta, esperando] of lote) {
      const url = porRuta.get(ruta) ?? null
      for (const p of esperando) p.resolver(url)
    }
  } catch {
    // Fallo de red o de permisos en bloque: iniciales para todos. Una foto que
    // no carga no es un error que haya que enseñar; el nombre ya está al lado.
    for (const esperando of lote.values()) {
      for (const p of esperando) p.resolver(null)
    }
  }
}

export function firmarAvatar(ruta: string): Promise<string | null> {
  return new Promise((resolver) => {
    const cola = pendientes.get(ruta)
    if (cola) cola.push({ resolver })
    else pendientes.set(ruta, [{ resolver }])

    if (!programado) {
      programado = true
      void Promise.resolve().then(vaciar)
    }
  })
}

/**
 * URL lista para un `<img>`, o `null` si no hay foto o no se pudo firmar.
 *
 * Se cachea 50 minutos frente a los 60 de vigencia de la firma: así nunca se
 * entrega una URL a punto de caducar, que daría una foto rota al azar.
 */
export function useAvatarUrl(valor: string | null | undefined): string | null {
  const externa = typeof valor === 'string' && esUrlExterna(valor)
  const ruta = typeof valor === 'string' && valor.length > 0 && !externa ? valor : null

  const { data } = useQuery({
    queryKey: ['avatar', ruta],
    queryFn: () => firmarAvatar(ruta!),
    enabled: ruta !== null,
    staleTime: 50 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  })

  if (externa) return valor as string
  return data ?? null
}

/**
 * Reduce la imagen a un cuadrado de 256 px y la devuelve en WebP, EN EL
 * NAVEGADOR, antes de subirla.
 *
 * NO es una optimización prescindible: una foto de móvil son 4-6 MB y el plan
 * gratuito da 1 GB de Storage. Cuarenta personas subiendo la suya se comerían
 * un cuarto del cubo para pintar círculos de 40 px. Así son ~20 kB.
 *
 * Recorta al cuadrado central en lugar de deformar: una cara estirada se nota
 * más que una cara un poco recortada.
 */
export async function reducirImagen(file: File, lado = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const corte = Math.min(bitmap.width, bitmap.height)
    const x = (bitmap.width - corte) / 2
    const y = (bitmap.height - corte) / 2

    const lienzo = document.createElement('canvas')
    lienzo.width = lado
    lienzo.height = lado
    const ctx = lienzo.getContext('2d')
    if (!ctx) throw new Error('El navegador no permite procesar la imagen.')
    ctx.drawImage(bitmap, x, y, corte, corte, 0, 0, lado, lado)

    const blob = await new Promise<Blob | null>((res) => lienzo.toBlob(res, 'image/webp', 0.85))
    if (!blob) throw new Error('No se ha podido convertir la imagen.')
    return blob
  } finally {
    bitmap.close()
  }
}
