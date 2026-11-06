/**
 * Lo PURO de las fotos de perfil: iniciales y color.
 *
 * POR QUÉ VIVE EN `domain/` Y NO JUNTO AL COMPONENTE
 * Porque tiene pruebas, y una prueba no debe arrastrar el cliente de Supabase.
 * Estaba en `components/ui/avatar.tsx`, que importa `lib/avatars`, que importa
 * `lib/supabase`, que **crea el cliente al cargar el módulo**. El resultado: la
 * tanda de pruebas levantaba un cliente real para comprobar que «Javier Gómez
 * Pilar» da «JP», y en Actions —con una versión de Node sin WebSocket nativo—
 * reventó entera. Aquí no se importa nada.
 */

/** Tonos del catálogo (`.tone-*` de globals.css), ya probados en claro y oscuro. */
const TONOS = ['sky', 'violet', 'emerald', 'amber', 'teal', 'pink', 'blue', 'cyan'] as const

/**
 * Color derivado del nombre, NO de una lista cíclica.
 *
 * Así la misma persona tiene el mismo color en todas las pantallas, que es lo
 * único que permite reconocerla de un vistazo —el motivo por el que existen las
 * fotos—. Con una lista cíclica, el color dependería del orden de la lista y
 * cambiaría al filtrar.
 *
 * El hash no necesita ser criptográfico, solo repetible.
 */
export function tonoDe(texto: string): string {
  let h = 0
  for (let i = 0; i < texto.length; i += 1) h = (h * 31 + texto.charCodeAt(i)) % 100000
  return TONOS[h % TONOS.length] ?? 'sky'
}

/** Primera letra del nombre y del último apellido: «Javier Gómez Pilar» → «JP». */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  const primera = partes[0]
  const ultima = partes[partes.length - 1]
  if (primera === undefined || ultima === undefined) return '?'
  if (partes.length === 1) return primera.slice(0, 2).toUpperCase()
  return (primera.slice(0, 1) + ultima.slice(0, 1)).toUpperCase()
}

/**
 * `profiles.avatar_url` guarda, pese a su nombre, la RUTA dentro del cubo
 * privado (`<user_id>/<fichero>`): la URL de un cubo privado va firmada y
 * caduca, así que guardarla sería guardar algo que mañana no funciona
 * (migración 0017). Se admite además una URL `http(s)` por si algún perfil
 * tuviera ya una externa, y esa no hay que firmarla.
 */
export const esUrlExterna = (valor: string): boolean => /^https?:\/\//i.test(valor)
