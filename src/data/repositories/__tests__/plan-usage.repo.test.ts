import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pruebas del recorrido de los cubos de Storage con un cliente FALSO.
 *
 * POR QUÉ ESTA PRUEBA EXISTE, siendo la primera del proyecto que simula el
 * cliente de Supabase. Las tres cosas que pueden hacer que esta cifra salga
 * mal no se ven leyendo el código ni probando a mano con los pocos ficheros
 * que hay hoy en el proyecto real:
 *
 *  1. La API de Storage NO lista de forma recursiva. Si el recorrido no entra
 *     en las carpetas, el resultado es «0 ficheros, 0 bytes»… que es
 *     exactamente lo que devuelve un cubo vacío. Un fallo así se presenta como
 *     una buena noticia.
 *  2. La paginación. Con 150 ficheros en una carpeta, una implementación sin
 *     segunda página informa de 100 y nadie lo nota hasta que el gigabyte se
 *     llena «antes de tiempo».
 *  3. El tope de profundidad. Tiene que cortar sin mentir: la cifra se marca
 *     como mínimo en lugar de darse por total.
 *
 * El cubo falso se construye a partir de rutas y tamaños, y el `list` imita lo
 * que hace el de verdad: devuelve solo el nivel inmediato, las carpetas con
 * `id` nulo y sin metadatos, y como mucho `limit` entradas desde `offset`.
 */

type Arbol = Record<string, number>

/** Un cubo falso: rutas completas con su tamaño en bytes. */
const CUBOS: Record<string, Arbol> = {
  'work-documents': {
    'w1/d1/v1.pdf': 1000,
    'w1/d1/v2.pdf': 2000,
    'w1/d2/v1.pdf': 4000,
    'w2/d3/v1.pdf': 8000,
  },
  // 150 ficheros en una sola carpeta: dos páginas de 100.
  'template-files': Object.fromEntries(
    Array.from({ length: 150 }, (_, i) => [`t1/f${i}/fichero.docx`, 10]),
  ),
  avatars: {
    'u1/1699999999.webp': 500,
  },
}

function listar(bucket: string, prefijo: string, limit: number, offset: number) {
  const arbol = CUBOS[bucket]
  if (!arbol) return { data: [], error: null }

  const dentro = prefijo === '' ? '' : `${prefijo}/`
  const ficheros = new Set<string>()
  const carpetas = new Set<string>()

  for (const ruta of Object.keys(arbol)) {
    if (!ruta.startsWith(dentro)) continue
    const resto = ruta.slice(dentro.length)
    const corte = resto.indexOf('/')
    if (corte === -1) ficheros.add(resto)
    else carpetas.add(resto.slice(0, corte))
  }

  const entradas = [
    ...[...carpetas].sort().map((name) => ({ name, id: null, metadata: null })),
    ...[...ficheros].sort().map((name) => ({
      name, id: `id-${dentro}${name}`, metadata: { size: arbol[`${dentro}${name}`] },
    })),
  ]
  return { data: entradas.slice(offset, offset + limit), error: null }
}

/** Filas que la base de datos dice que existen, por tabla. */
const FILAS: Record<string, number> = {
  document_versions: 4,
  template_files: 150,
  profiles: 1,
}

const peticiones: { bucket: string; prefijo: string }[] = []

vi.mock('@/lib/supabase', () => {
  const consulta = (tabla: string) => {
    const encadenable = {
      not: () => encadenable,
      then: (resolver: (v: { count: number; error: null }) => unknown) =>
        resolver({ count: FILAS[tabla] ?? 0, error: null }),
    }
    return encadenable
  }

  return {
    supabase: {
      from: (tabla: string) => ({ select: () => consulta(tabla) }),
      storage: {
        from: (bucket: string) => ({
          list: (prefijo: string, opciones: { limit: number; offset: number }) => {
            peticiones.push({ bucket, prefijo })
            return Promise.resolve(listar(bucket, prefijo, opciones.limit, opciones.offset))
          },
        }),
      },
    },
    supabaseConfigured: true,
    errorMessage: (e: unknown) => String(e),
  }
})

const { planUsage } = await import('../maintenance.repo')

describe('planUsage', () => {
  beforeEach(() => { peticiones.length = 0 })

  it('entra en las carpetas: no se queda en el primer nivel', async () => {
    const uso = await planUsage()
    const docs = uso.cubos.find((c) => c.bucket === 'work-documents')!
    expect(docs.ficheros).toBe(4)
    expect(docs.bytes).toBe(15000)
    // Si no recorriera, aquí habría 0 y 0, que es lo mismo que devuelve un
    // cubo vacío: de ahí que esta comprobación sea la importante.
    expect(peticiones.some((p) => p.prefijo === 'w1/d1')).toBe(true)
  })

  it('pagina: 150 ficheros son 150, no 100', async () => {
    const uso = await planUsage()
    const plantillas = uso.cubos.find((c) => c.bucket === 'template-files')!
    expect(plantillas.ficheros).toBe(150)
    expect(plantillas.bytes).toBe(1500)
  })

  it('suma los tres cubos y trae lo que dice la base para contrastar', async () => {
    const uso = await planUsage()
    expect(uso.ficheros).toBe(4 + 150 + 1)
    expect(uso.bytes).toBe(15000 + 1500 + 500)
    expect(uso.esperados).toBe(4 + 150 + 1)
    expect(uso.truncado).toBe(false)
  })

  it('no inventa el tamaño de un fichero sin metadatos', async () => {
    CUBOS['avatars'] = { 'u1/sin-metadatos.webp': Number.NaN }
    const uso = await planUsage()
    const avatares = uso.cubos.find((c) => c.bucket === 'avatars')!
    expect(avatares.ficheros).toBe(1)
    expect(avatares.bytes).toBe(0)
    CUBOS['avatars'] = { 'u1/1699999999.webp': 500 }
  })

  it('corta por profundidad y lo dice, en vez de dar la cifra por total', async () => {
    CUBOS['work-documents'] = { 'a/b/c/d/e/muy-hondo.pdf': 123 }
    const uso = await planUsage()
    const docs = uso.cubos.find((c) => c.bucket === 'work-documents')!
    expect(docs.truncado).toBe(true)
    expect(uso.truncado).toBe(true)
    CUBOS['work-documents'] = {
      'w1/d1/v1.pdf': 1000, 'w1/d1/v2.pdf': 2000, 'w1/d2/v1.pdf': 4000, 'w2/d3/v1.pdf': 8000,
    }
  })
})
