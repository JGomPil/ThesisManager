import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Tokens de color admitidos en los catálogos (ver globals.css). */
export const TONES = [
  'slate', 'sky', 'cyan', 'blue', 'violet', 'amber',
  'orange', 'emerald', 'green', 'red', 'pink', 'teal',
] as const

export type Tone = (typeof TONES)[number]

/**
 * LOS NOMBRES COMPLETOS, ESCRITOS A MANO, Y NO `tone-${t}`.
 *
 * POR QUÉ ESTA REPETICIÓN NO ES GRATUITA
 * Tailwind no ejecuta el código: rastrea los ficheros buscando cadenas que
 * parezcan nombres de clase y **borra del CSS final todo lo que no encuentra**.
 * Una clase compuesta al vuelo no la ve, así que `.tone-blue` no llegaba al CSS
 * publicado: la pastilla del TFG salía con una clase sin ninguna regla detrás,
 * es decir, sin fondo. Blanca. Con cualquier color del catálogo.
 *
 * Once de los doce tonos no habían pintado nunca. El duodécimo, `tone-slate`,
 * sobrevivía solo porque estaba escrito como valor por defecto, y eso hacía el
 * fallo aún más difícil de ver: el color por omisión funcionaba. Se descubrió el
 * 7 de noviembre de 2026 mirando el CSS que servía el sitio, después de que
 * cambiar el color de un tipo de trabajo no cambiara nada en pantalla.
 *
 * `scripts/check-tones.sh` comprueba sobre `dist/` que las veinticuatro clases
 * siguen en el CSS compilado. Hace falta un guion porque esto no da ningún
 * error: no hay excepción, no hay aviso en la consola y la pantalla se dibuja
 * entera. Solo deja de haber color.
 */
const TONE_CLASS: Record<Tone, string> = {
  slate: 'tone-slate',
  sky: 'tone-sky',
  cyan: 'tone-cyan',
  blue: 'tone-blue',
  violet: 'tone-violet',
  amber: 'tone-amber',
  orange: 'tone-orange',
  emerald: 'tone-emerald',
  green: 'tone-green',
  red: 'tone-red',
  pink: 'tone-pink',
  teal: 'tone-teal',
}

/** El mismo catálogo, en versión saturada, para pintar un borde. */
const EDGE_CLASS: Record<Tone, string> = {
  slate: 'edge-slate',
  sky: 'edge-sky',
  cyan: 'edge-cyan',
  blue: 'edge-blue',
  violet: 'edge-violet',
  amber: 'edge-amber',
  orange: 'edge-orange',
  emerald: 'edge-emerald',
  green: 'edge-green',
  red: 'edge-red',
  pink: 'edge-pink',
  teal: 'edge-teal',
}

function esTono(t: string): t is Tone {
  return (TONES as readonly string[]).includes(t)
}

/** Fondo y color de texto del tono: para una pastilla con letras dentro. */
export function toneClass(tone: string | null | undefined) {
  const t = tone ?? 'slate'
  return esTono(t) ? TONE_CLASS[t] : TONE_CLASS.slate
}

/**
 * El mismo tono, saturado, para pintar una FRANJA de color.
 *
 * Se usa junto a `border-l-4`, que pone el ancho. Existe porque el color del
 * tipo de trabajo solo llegaba a la pastilla («TFG») y las tarjetas del resumen
 * y del listado eran todas blancas: cambiar el color del catálogo se notaba en
 * un recuadro de dos centímetros y en ningún otro sitio.
 *
 * Un tono desconocido cae en `slate`, como en `toneClass`: una fila con un
 * color que ya no existe en el catálogo pinta gris, no rompe la pantalla.
 */
export function toneEdgeClass(tone: string | null | undefined) {
  const t = tone ?? 'slate'
  return esTono(t) ? EDGE_CLASS[t] : EDGE_CLASS.slate
}
