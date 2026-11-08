import { describe, expect, it } from 'vitest'
import { construirIcs, escaparTexto, nombreFicheroIcs, plegarLinea } from '../ics'
import type { CalendarEvent } from '../calendar'

const AHORA = new Date('2026-11-08T10:00:00Z')
const O = { ahora: AHORA, baseUrl: 'https://jgompil.github.io/ThesisManager/', nombre: 'Thesis Manager' }

const vencimiento: CalendarEvent = {
  id: 'abc-fin', day: '2026-12-15', kind: 'TASK_DUE', title: 'Entregar el borrador',
  workId: 'w1', workTitle: 'TFM de Ana', time: null, at: null, minutes: null, location: null,
  done: false, href: '/trabajos/w1',
}
const reunion: CalendarEvent = {
  id: 'r1', day: '2026-12-16', kind: 'MEETING', title: 'Seguimiento',
  workId: 'w1', workTitle: 'TFM de Ana', time: '16:30', at: '2026-12-16T15:30:00Z',
  minutes: 45, location: 'Despacho 102', done: false, href: '/trabajos/w1',
}

const lineas = (ics: string) => ics.split('\r\n')

describe('construirIcs', () => {
  it('envuelve los eventos en un calendario válido y acaba en CRLF', () => {
    const ics = construirIcs([vencimiento], O)
    expect(lineas(ics)[0]).toBe('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('PRODID:-//GIB-UVa//Thesis Manager//ES')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    // Ni un solo salto suelto: la norma exige CRLF en todas las líneas.
    expect(/[^\r]\n/.test(ics)).toBe(false)
  })

  it('un calendario sin eventos sigue siendo un fichero correcto', () => {
    const ics = construirIcs([], O)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('el día completo lleva DTEND EXCLUSIVO: el 15 se escribe 15 → 16', () => {
    const ics = construirIcs([vencimiento], O)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261215')
    expect(ics).toContain('DTEND;VALUE=DATE:20261216')
  })

  it('el final de mes no se desborda al sumar el día', () => {
    const ics = construirIcs([{ ...vencimiento, day: '2026-12-31' }], O)
    expect(ics).toContain('DTEND;VALUE=DATE:20270101')
  })

  // Los valores esperados son absolutos a propósito: la salida debe ser la
  // misma en cualquier zona horaria. Esta prueba ya cazó una vez que se
  // escribía la hora local con una «Z» pegada detrás.
  it('la reunión lleva instante en UTC y su duración', () => {
    const ics = construirIcs([reunion], O)
    expect(ics).toContain('DTSTART:20261216T153000Z')
    expect(ics).toContain('DTEND:20261216T161500Z')
    expect(ics).toContain('LOCATION:Despacho 102')
  })

  it('sin duración conocida, una hora', () => {
    const ics = construirIcs([{ ...reunion, minutes: null }], O)
    expect(ics).toContain('DTEND:20261216T163000Z')
  })

  it('el UID es el del evento: al reimportar se actualiza, no se duplica', () => {
    expect(construirIcs([vencimiento], O)).toContain('UID:abc-fin@thesis-manager.gib-uva')
  })

  it('el título dice qué es, y marca lo ya hecho', () => {
    expect(construirIcs([vencimiento], O)).toContain('SUMMARY:Vence: Entregar el borrador')
    expect(construirIcs([{ ...vencimiento, done: true }], O)).toContain('(hecho)')
    expect(construirIcs([reunion], O)).toContain('SUMMARY:Reunión: Seguimiento')
  })

  it('el enlace apunta a la aplicación publicada, sin barra doble', () => {
    const ics = construirIcs([vencimiento], O)
    expect(ics).toContain('URL:https://jgompil.github.io/ThesisManager/trabajos/w1')
    expect(ics).not.toContain('ThesisManager//trabajos')
  })

  it('un punto y coma en el título no parte el campo', () => {
    const ics = construirIcs([{ ...vencimiento, title: 'Revisar; corregir' }], O)
    expect(ics).toContain('SUMMARY:Vence: Revisar\\; corregir')
  })

  it('el fichero entero respeta la norma: líneas de 75 octetos y bloques cerrados', () => {
    const largo = 'Título larguísimo con muchísimas tildes y eñes para forzar el plegado ' .repeat(3)
    const ics = construirIcs(
      [{ ...vencimiento, title: largo }, { ...reunion, location: largo }],
      O,
    )
    const todas = ics.split('\r\n').filter((l) => l !== '')
    for (const l of todas) {
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
    }
    expect(todas.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2)
    expect(todas.filter((l) => l === 'END:VEVENT')).toHaveLength(2)
    expect(todas[0]).toBe('BEGIN:VCALENDAR')
    expect(todas[todas.length - 1]).toBe('END:VCALENDAR')
  })

  it('no inventa hora para lo que no la tiene', () => {
    expect(construirIcs([vencimiento], O)).not.toMatch(/DTSTART:\d{8}T/)
  })
})

describe('escaparTexto', () => {
  it('escapa la barra PRIMERO, y luego los separadores', () => {
    expect(escaparTexto('a\\b;c,d')).toBe('a\\\\b\\;c\\,d')
  })

  it('el salto de línea se convierte en \\n literal', () => {
    expect(escaparTexto('uno\ndos')).toBe('uno\\ndos')
    expect(escaparTexto('uno\r\ndos')).toBe('uno\\ndos')
  })

  it('un título con coma no parte el campo en dos', () => {
    const ics = construirIcs([{ ...vencimiento, title: 'Métodos, resultados' }], O)
    expect(ics).toContain('SUMMARY:Vence: Métodos\\, resultados')
  })
})

describe('plegarLinea', () => {
  it('deja en paz lo que cabe', () => {
    expect(plegarLinea('SUMMARY:corto')).toBe('SUMMARY:corto')
  })

  it('pliega por octetos, no por caracteres', () => {
    // 80 tildes son 160 octetos en UTF-8: contando caracteres parecería que
    // caben, y el calendario se comería el final del título.
    const plegada = plegarLinea(`SUMMARY:${'á'.repeat(80)}`)
    for (const trozo of plegada.split('\r\n')) {
      expect(new TextEncoder().encode(trozo).length).toBeLessThanOrEqual(75)
    }
  })

  it('las continuaciones empiezan por espacio y no parten un carácter', () => {
    const plegada = plegarLinea(`DESCRIPTION:${'é'.repeat(100)}`)
    const trozos = plegada.split('\r\n')
    expect(trozos.length).toBeGreaterThan(1)
    for (const t of trozos.slice(1)) expect(t.startsWith(' ')).toBe(true)
    // Al desplegar (quitar CRLF + espacio) se recupera el original exacto.
    expect(plegada.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'é'.repeat(100)}`)
  })
})

describe('nombreFicheroIcs', () => {
  it('sin acentos ni espacios, y con la fecha', () => {
    expect(nombreFicheroIcs('TFM de Ana Rodríguez', AHORA)).toBe('tfm-de-ana-rodriguez-2026-11-08.ics')
  })

  it('un título que se queda sin letras no deja un nombre vacío', () => {
    expect(nombreFicheroIcs('¿¿??', AHORA)).toBe('calendario-2026-11-08.ics')
  })
})
