/**
 * LO QUE HACEN LOS BOTONES DE LA BARRA DE FORMATO, como función pura.
 *
 * Entra el texto del campo con su selección, sale el texto nuevo con la
 * selección nueva. Ni `document`, ni el elemento, ni React: así se puede
 * probar, que es justo lo que hace falta aquí. Las diez reglas de abajo
 * —qué pasa sin selección, qué pasa si ya estaba en negrita, dónde queda el
 * cursor después— son exactamente el tipo de detalle que se rompe al tocar
 * cualquier otra cosa y que nadie vuelve a comprobar a mano.
 *
 * EL CURSOR IMPORTA TANTO COMO EL TEXTO. Un botón de negrita que escribe los
 * asteriscos pero deja el cursor al final obliga a volver con el ratón: el
 * formato se aplica mientras se escribe, no después.
 *
 * Las marcas y su significado están en `markup.ts`; esto solo las pone y las
 * quita.
 */

export type Formato = 'negrita' | 'cursiva' | 'subrayado' | 'lista' | 'numerada'

/** El estado de un campo de texto: lo que pone y qué hay seleccionado. */
export type Seleccion = { texto: string; inicio: number; fin: number }

const MARCA: Record<'negrita' | 'cursiva' | 'subrayado', string> = {
  negrita: '**',
  cursiva: '*',
  subrayado: '__',
}

/** Prefijos de lista, para reconocerlos y para quitarlos. */
const PREFIJO_PUNTO = /^(\s{0,3})[-*]\s+/
const PREFIJO_NUMERO = /^(\s{0,3})\d{1,9}[.)]\s+/

/** Aplica (o quita) un formato. Es la única entrada de este módulo. */
export function aplicaFormato(sel: Seleccion, formato: Formato): Seleccion {
  return formato === 'lista' || formato === 'numerada'
    ? aplicaLista(sel, formato === 'numerada')
    : aplicaMarca(sel, MARCA[formato])
}

/**
 * ¿El texto ya está envuelto en esta marca?
 *
 * El caso que obliga a mirar dos veces es `**negrita**` con el botón de
 * CURSIVA: empieza y acaba por `*`, así que la comprobación ingenua diría que
 * sí y quitaría un asterisco de cada lado, convirtiendo una negrita en
 * cursiva sin que nadie lo haya pedido.
 */
function envuelto(texto: string, marca: string): boolean {
  if (texto.length < marca.length * 2 + 1) return false
  if (!texto.startsWith(marca) || !texto.endsWith(marca)) return false
  if (marca === '*' && texto.startsWith('**') && texto.endsWith('**')) return false
  return true
}

function aplicaMarca(sel: Seleccion, marca: string): Seleccion {
  const { texto, inicio, fin } = sel
  const dentro = texto.slice(inicio, fin)
  const n = marca.length

  // 1. Sin nada seleccionado: se escriben las dos marcas y el cursor se queda
  //    EN MEDIO, listo para escribir ya en negrita.
  if (dentro === '') {
    return {
      texto: `${texto.slice(0, inicio)}${marca}${marca}${texto.slice(inicio)}`,
      inicio: inicio + n,
      fin: inicio + n,
    }
  }

  // 2. La selección incluye las marcas (se seleccionó `**esto**`): se quitan.
  if (envuelto(dentro, marca)) {
    const limpio = dentro.slice(n, -n)
    return {
      texto: texto.slice(0, inicio) + limpio + texto.slice(fin),
      inicio,
      fin: inicio + limpio.length,
    }
  }

  // 3. Las marcas están JUSTO FUERA de la selección (se seleccionó `esto` y lo
  //    de alrededor ya era negrita, que es lo que pasa al volver a pulsar el
  //    botón sin tocar el ratón): también se quitan.
  if (texto.slice(inicio - n, inicio) === marca && texto.slice(fin, fin + n) === marca) {
    const fuera = marca === '*'
      && texto.slice(inicio - 2, inicio) === '**'
      && texto.slice(fin, fin + 2) === '**'
    if (!fuera) {
      return {
        texto: texto.slice(0, inicio - n) + dentro + texto.slice(fin + n),
        inicio: inicio - n,
        fin: fin - n,
      }
    }
  }

  // 4. El caso normal: envolver, y dejar seleccionado lo de dentro —no las
  //    marcas—, para que se pueda encadenar negrita y cursiva sin volver a
  //    seleccionar.
  return {
    texto: `${texto.slice(0, inicio)}${marca}${dentro}${marca}${texto.slice(fin)}`,
    inicio: inicio + n,
    fin: fin + n,
  }
}

function aplicaLista(sel: Seleccion, ordenada: boolean): Seleccion {
  const { texto, inicio, fin } = sel

  // Una lista se aplica a LÍNEAS ENTERAS, así que la selección se estira hasta
  // los bordes de las líneas que toca. Seleccionar media palabra y pulsar
  // «puntos» tiene que convertir esa línea, no partirla.
  const iniLinea = texto.lastIndexOf('\n', inicio - 1) + 1
  const finBuscado = texto.indexOf('\n', fin)
  const finLinea = finBuscado === -1 ? texto.length : finBuscado

  const lineas = texto.slice(iniLinea, finLinea).split('\n')
  const prefijo = ordenada ? PREFIJO_NUMERO : PREFIJO_PUNTO
  const conTexto = lineas.filter((l) => l.trim() !== '')

  // Si TODAS las líneas con texto ya lo tienen, el botón lo quita: es un
  // interruptor, como la negrita.
  const yaEsLista = conTexto.length > 0 && conTexto.every((l) => prefijo.test(l))

  let numero = 0
  const nuevas = lineas.map((linea) => {
    if (linea.trim() === '') return linea
    // Se quita el prefijo que hubiera, del tipo que fuera: pasar de puntos a
    // numerada es cambiar la lista, no añadirle un número a cada guion.
    const desnuda = linea.replace(PREFIJO_PUNTO, '$1').replace(PREFIJO_NUMERO, '$1')
    if (yaEsLista) return desnuda
    numero += 1
    const sangria = /^\s{0,3}/.exec(desnuda)?.[0] ?? ''
    const cuerpo = desnuda.slice(sangria.length)
    return `${sangria}${ordenada ? `${numero}. ` : '- '}${cuerpo}`
  })

  const bloque = nuevas.join('\n')
  return {
    texto: texto.slice(0, iniLinea) + bloque + texto.slice(finLinea),
    inicio: iniLinea,
    fin: iniLinea + bloque.length,
  }
}
