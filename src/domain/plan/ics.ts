import { addDays, addMinutes, format, parseISO } from 'date-fns'
import { KIND_LABELS, type CalendarEvent, type EventKind } from '@/domain/plan/calendar'

/**
 * Las fechas del trabajo, en el calendario de cada cual (iCalendar, RFC 5545).
 *
 * POR QUÉ EXISTE ESTO
 * La pantalla de Calendario enseña vencimientos, hitos y reuniones, pero solo
 * si alguien entra a mirarla. Un vencimiento que hay que ir a buscar no avisa
 * de nada: el aviso tiene que aparecer donde ya se mira la semana, que es el
 * calendario del correo. Es la misma idea que la papelera —que la herramienta
 * no dependa de que te acuerdes de ella—, en la otra dirección.
 *
 * ES UNA FOTO, NO UNA SUSCRIPCIÓN. Un `.ics` descargado es el estado de hoy:
 * si una fecha cambia, el calendario de destino no se enterará. Una dirección
 * a la que suscribirse exigiría un servidor que la sirviera con un identifi-
 * cador por persona —la aplicación es estática— y eso no está hecho. Se dice
 * en la propia pantalla, porque una copia desactualizada que se cree viva es
 * peor que no tener nada.
 *
 * LO QUE TIENE QUE SALIR BIEN, Y POR QUÉ ES FÁCIL QUE NO
 * 1. Las líneas acaban en CRLF y se PLIEGAN a 75 **octetos**, no caracteres.
 *    Una tilde son dos bytes en UTF-8, así que contar caracteres deja líneas
 *    largas en un título con acentos —y lo que pasa entonces no es un error:
 *    el calendario importa el fichero y se come el final del título—.
 * 2. Los caracteres `\`, `;`, `,` y el salto de línea van escapados, y la
 *    barra invertida SE ESCAPA PRIMERO; al revés se escaparían las barras que
 *    uno mismo acaba de meter.
 * 3. En un evento de día completo, `DTEND` es EXCLUSIVO: un vencimiento del
 *    día 8 se escribe como 8 → 9. Poniendo 8 → 8 hay calendarios que no
 *    pintan nada en absoluto.
 * 4. El `UID` es estable (el del evento en la base de datos). Así, al volver a
 *    descargar, el calendario ACTUALIZA el evento en lugar de duplicarlo.
 */

/** Lo que `collectEvents` ya sabe de cada evento, más lo que solo tiene sentido aquí. */
export type IcsOptions = {
  /** Para `DTSTAMP`. Se pasa en lugar de leer el reloj: así es comprobable. */
  ahora: Date
  /** Raíz absoluta de la aplicación, con la barra final. */
  baseUrl: string
  /** Nombre del calendario que verá quien lo importe. */
  nombre: string
}

const PRODID = '-//GIB-UVa//Thesis Manager//ES'
const MINUTOS_POR_DEFECTO = 60

/** Prefijo del título: en un calendario mezclado con el propio, «Vence» es la mitad del aviso. */
const PREFIJO: Record<EventKind, string> = {
  TASK_DUE: 'Vence',
  TASK_START: 'Empieza',
  MILESTONE: 'Hito',
  MEETING: 'Reunión',
}

export function escaparTexto(valor: string): string {
  return valor
    .replace(/\\/g, '\\\\') // primero la barra: ver el punto 2 de la cabecera
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Plegado de una línea a 75 octetos, con una continuación por espacio.
 *
 * Se mide en bytes de UTF-8 y no se parte un carácter por la mitad: medio
 * carácter deja el fichero mal codificado y hay calendarios que lo rechazan
 * entero, no solo ese evento.
 */
export function plegarLinea(linea: string): string {
  const bytes = new TextEncoder().encode(linea)
  if (bytes.length <= 75) return linea

  const trozos: string[] = []
  let actual = ''
  let usados = 0
  let limite = 75
  for (const caracter of linea) {
    const ancho = new TextEncoder().encode(caracter).length
    if (usados + ancho > limite) {
      trozos.push(actual)
      actual = ''
      usados = 0
      limite = 74 // la continuación gasta un octeto en el espacio inicial
    }
    actual += caracter
    usados += ancho
  }
  if (actual !== '') trozos.push(actual)
  return trozos.join('\r\n ')
}

/**
 * Instante en UTC, en el formato de la norma (`20261216T153000Z`).
 *
 * NO se usa `format` de date-fns aquí, y es una trampa que estuvo puesta: esa
 * función escribe la hora LOCAL de quien ejecuta, así que un patrón con la `Z`
 * literal produce «16:30:00Z» para una reunión de las 15:30 UTC si el reloj
 * está en Madrid. No falla, no avisa: pone todas las reuniones una hora más
 * tarde en el calendario de destino —dos en verano—. Lo descubrió la prueba
 * «la reunión lleva instante en UTC y su duración», que fallaba por una hora.
 */
const utc = (d: Date) => `${d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`
const dia = (d: string) => d.replace(/-/g, '')

function vevento(e: CalendarEvent, o: IcsOptions): string[] {
  const titulo = `${PREFIJO[e.kind]}: ${e.title}${e.done ? ' (hecho)' : ''}`
  const url = `${o.baseUrl}${e.href.replace(/^\//, '')}`
  const descripcion = [KIND_LABELS[e.kind], e.workTitle, url].filter(Boolean).join('\n')

  const lineas = [
    'BEGIN:VEVENT',
    `UID:${e.id}@thesis-manager.gib-uva`,
    `DTSTAMP:${utc(o.ahora)}`,
    `SUMMARY:${escaparTexto(titulo)}`,
  ]

  if (e.at) {
    // Reuniones: hora exacta en UTC. La `Z` no es un adorno —sin ella la hora
    // es «flotante» y cada calendario la interpreta en su propia zona, así que
    // la misma reunión aparecería a las 15:30 aquí y a las 15:30 en Chile.
    const inicio = parseISO(e.at)
    lineas.push(
      `DTSTART:${utc(inicio)}`,
      `DTEND:${utc(addMinutes(inicio, e.minutes ?? MINUTOS_POR_DEFECTO))}`,
    )
  } else {
    // Vencimientos, inicios e hitos: día completo. No tienen hora en la base
    // de datos, y ponerles una inventada (las 9:00) sería dato falso.
    lineas.push(
      `DTSTART;VALUE=DATE:${dia(e.day)}`,
      `DTEND;VALUE=DATE:${dia(format(addDays(parseISO(e.day), 1), 'yyyy-MM-dd'))}`,
    )
  }

  if (e.location) lineas.push(`LOCATION:${escaparTexto(e.location)}`)
  lineas.push(`DESCRIPTION:${escaparTexto(descripcion)}`, `URL:${escaparTexto(url)}`, 'END:VEVENT')
  return lineas
}

/** El fichero completo. Devuelve texto con CRLF, listo para descargar. */
export function construirIcs(eventos: CalendarEvent[], o: IcsOptions): string {
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escaparTexto(o.nombre)}`,
    ...eventos.flatMap((e) => vevento(e, o)),
    'END:VCALENDAR',
  ]
  // El fichero acaba en CRLF: la norma lo pide y hay importadores que se dejan
  // el último evento si la línea final no está terminada.
  return `${lineas.map(plegarLinea).join('\r\n')}\r\n`
}

/**
 * Nombre del fichero. Sin acentos ni espacios: viaja por correo y por sistemas
 * de ficheros ajenos, donde un nombre con tildes se convierte en basura.
 */
export function nombreFicheroIcs(etiqueta: string, hoy: Date): string {
  const limpio = etiqueta
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
  return `${limpio === '' ? 'calendario' : limpio}-${format(hoy, 'yyyy-MM-dd')}.ics`
}
