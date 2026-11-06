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

/**
 * Partículas que NO son apellido: «María de la Fuente» no se abrevia «MDL».
 *
 * Se comparan sin tildes y en minúscula. `san` y `santa` no están en la lista a
 * propósito: en «Ana San Martín Ruiz», «San Martín» ES el apellido.
 */
const PARTICULAS = new Set([
  'de', 'del', 'la', 'las', 'le', 'los', 'y', 'e', 'da', 'das', 'do', 'dos',
  'van', 'von', 'der', 'den', 'di', 'du', 'della', 'dello', 'al', 'bin', 'ben',
  'ibn', 'i',
])

const esParticula = (palabra: string) =>
  PARTICULAS.has(palabra.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())

/**
 * Nombre y LOS DOS APELLIDOS: «Javier Gómez Pilar» → «JGP».
 *
 * POR QUÉ TRES Y NO DOS
 * Dos iniciales —nombre y último apellido— es la convención anglosajona, donde
 * hay un solo apellido. En España hay dos, y el primero es el que se usa para
 * nombrar a alguien: abreviar «Javier Gómez Pilar» como «JP» se salta
 * precisamente el apellido por el que se le conoce, y deja a «Javier Gómez
 * Pilar» y «Javier García Pilar» con las mismas iniciales.
 *
 * Con un nombre compuesto («Juan Carlos Pérez Gómez») se toma la primera
 * palabra y los dos últimos apellidos: «JPG». Es una elección, no una verdad:
 * sin una base de datos de nombres no hay forma de saber si la segunda palabra
 * es parte del nombre o el primer apellido, y tres letras es el tope que cabe
 * en un círculo de 24 píxeles.
 */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  const utiles = partes.filter((p) => !esParticula(p))
  // Si todo lo que hay son partículas, mejor usarlas que devolver «?».
  const palabras = utiles.length > 0 ? utiles : partes

  const primera = palabras[0]
  if (primera === undefined) return '?'
  if (palabras.length === 1) return primera.slice(0, 2).toUpperCase()

  // Los dos últimos apellidos; con uno solo, ese. El `slice(1)` es obligatorio:
  // sin él, en «Ada Lovelace» los «dos últimos» incluyen el nombre y sale «AAL».
  const apellidos = palabras.slice(1).slice(-2)
  return (primera.slice(0, 1) + apellidos.map((a) => a.slice(0, 1)).join('')).toUpperCase()
}

/**
 * `profiles.avatar_url` guarda, pese a su nombre, la RUTA dentro del cubo
 * privado (`<user_id>/<fichero>`): la URL de un cubo privado va firmada y
 * caduca, así que guardarla sería guardar algo que mañana no funciona
 * (migración 0017). Se admite además una URL `http(s)` por si algún perfil
 * tuviera ya una externa, y esa no hay que firmarla.
 */
export const esUrlExterna = (valor: string): boolean => /^https?:\/\//i.test(valor)
