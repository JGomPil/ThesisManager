/**
 * Consumo del plan gratuito: lo que se puede medir y lo que no.
 *
 * QUÉ SE MIDE. El espacio que ocupan los ficheros de los tres cubos privados
 * de Storage, sumando el tamaño que la propia API devuelve en los metadatos de
 * cada objeto. Ese es el límite que de verdad aprieta en este proyecto: cada
 * versión de un documento es un fichero más, y las versiones no se borran.
 *
 * QUÉ NO SE MIDE, Y SE DICE. El tamaño de la base de datos. Desde el navegador
 * no hay manera de saberlo: `pg_database_size` necesita una función en el
 * servidor, y meter una función nueva en el esquema `app` para enseñar una
 * cifra informativa no compensa. La tarjeta lo dice en voz alta en lugar de
 * dejar entender que mide el plan entero.
 *
 * POR QUÉ SE COMPARA CON LA BASE DE DATOS. Lección de `backup-storage.py`: la
 * API de Storage devuelve 200 y una lista vacía tanto cuando el cubo está
 * vacío como cuando las políticas no dejan ver nada. «0 ficheros» no demuestra
 * «no hay ficheros», así que la cifra sola no vale: hay que contrastarla con
 * una fuente independiente, y aquí la hay —las filas que dicen que ese fichero
 * existe—. De paso sale gratis una comprobación que importa: los ficheros
 * HUÉRFANOS, los que quedaron en el cubo sin fila que los reclame, que ocupan
 * sitio del gigabyte gratuito para siempre y que nadie vería de otro modo.
 */

/**
 * Límite de ficheros del plan gratuito de Supabase: 1 GiB.
 *
 * Es una cifra de su lista de precios, no algo que se pueda consultar desde la
 * aplicación, así que la pantalla la presenta como referencia documentada y
 * remite al panel. Si algún día cambia, se cambia aquí.
 */
export const LIMITE_FICHEROS_BYTES = 1024 ** 3

export type NivelOcupacion = 'ok' | 'aviso' | 'critico'

/** Tamaño legible. Sin decimales por debajo del mega: «834 kB» basta. */
export function formatearBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} kB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

/** Porcentaje ocupado, acotado a [0, 100] para que la barra no se salga. */
export function porcentajeOcupado(bytes: number, limite = LIMITE_FICHEROS_BYTES): number {
  if (limite <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((bytes / limite) * 100)))
}

/**
 * Niveles. El aviso entra al 70 % y no al 90 %: liberar sitio aquí significa
 * mover documentos a la unidad institucional y eso no se hace en diez minutos,
 * así que avisar cuando ya no hay margen no sirve de nada.
 */
export function nivelOcupacion(bytes: number, limite = LIMITE_FICHEROS_BYTES): NivelOcupacion {
  const p = (bytes / limite) * 100
  if (p >= 90) return 'critico'
  if (p >= 70) return 'aviso'
  return 'ok'
}

export type Contraste = 'COINCIDE' | 'NADA_VISIBLE' | 'FALTAN' | 'HUERFANOS'

/**
 * Contraste entre lo que hay en los cubos y lo que la base de datos dice que
 * debería haber. `esperados` son las filas con `storage_path` —las que
 * apuntan a un fichero de verdad, no a un enlace externo—.
 */
export function contrastar({
  enStorage, esperados,
}: { enStorage: number; esperados: number }): Contraste {
  if (enStorage === 0 && esperados > 0) return 'NADA_VISIBLE'
  if (enStorage < esperados) return 'FALTAN'
  if (enStorage > esperados) return 'HUERFANOS'
  return 'COINCIDE'
}
