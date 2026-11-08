/**
 * EL FORMATO DE LOS COMENTARIOS: un subconjunto diminuto de Markdown.
 *
 * QUÉ SE ADMITE, Y NADA MÁS
 *   **negrita**      *cursiva*      __subrayado__
 *   - punto          1. punto numerado
 * Una línea en blanco separa párrafos. Todo lo demás es texto literal.
 *
 * POR QUÉ MARCAS DE TEXTO Y NO UN EDITOR ENRIQUECIDO
 * Un editor de verdad (TipTap, Lexical, Quill) guarda HTML o un árbol JSON.
 * Eso obliga a tres cosas que aquí salen caras: una dependencia grande en un
 * sitio estático que se descarga entero, una MIGRACIÓN de la columna
 * `comments.content`, y —la que de verdad importa— sanear HTML escrito por
 * usuarios antes de pintarlo. Un hilo de comentarios lo lee todo el mundo con
 * acceso al trabajo, así que un `<img onerror=…>` guardado por cualquiera se
 * ejecutaría en la sesión de la directora.
 *
 * Aquí no hay HTML en ningún punto del camino. Lo que se guarda es el texto
 * tal cual lo escribió la persona, y lo que se pinta es un árbol de nodos que
 * React convierte en `<strong>`, `<em>`, `<u>`, `<ul>` y `<ol>`. Un
 * `<script>` escrito en un comentario se ve escrito, porque React escapa el
 * texto: no hay `dangerouslySetInnerHTML` en la aplicación y este módulo no lo
 * introduce. La columna sigue siendo texto, así que no hay migración y los
 * comentarios de antes se siguen leyendo igual.
 *
 * POR QUÉ `__` ES SUBRAYADO Y NO NEGRITA
 * En Markdown `__x__` es negrita, un sinónimo de `**x**`. Aquí se gasta en
 * subrayar porque Markdown NO TIENE subrayado y es uno de los cinco formatos
 * pedidos. Nadie escribe estas marcas a mano —las pone la barra de botones—,
 * así que el sinónimo no se echa en falta; lo que se perdería sin esta
 * decisión es un formato entero.
 */

/** Un trozo de línea: texto suelto, o texto marcado con un formato. */
export type Inline =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'negrita'; hijos: Inline[] }
  | { tipo: 'cursiva'; hijos: Inline[] }
  | { tipo: 'subrayado'; hijos: Inline[] }

/**
 * Un bloque del comentario. Un párrafo guarda sus líneas por separado —y no un
 * texto con `\n` dentro— porque el salto de línea suelto se pinta con `<br>`:
 * quien escribe tres líneas seguidas espera ver tres líneas.
 */
export type Bloque =
  | { tipo: 'parrafo'; lineas: Inline[][] }
  | { tipo: 'lista'; ordenada: boolean; puntos: Inline[][] }

/** `- punto` o `* punto`. El espacio es obligatorio: `*cursiva*` no es lista. */
const PUNTO = /^\s{0,3}[-*]\s+(.*)$/
/** `1. punto` o `1) punto`. Se renumera al pintar, así que da igual qué cifra. */
const PUNTO_NUMERADO = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/

/**
 * Texto escrito por una persona → bloques listos para pintar.
 *
 * Nunca falla ni tira nada: lo que no encaja con una marca se queda como
 * texto. Es deliberado —un comentario es prosa, no código—: ante la duda, se
 * enseña lo que se escribió.
 */
export function analiza(texto: string): Bloque[] {
  const bloques: Bloque[] = []
  // `\r\n` existe: hay quien pega desde Word o desde un correo de Outlook.
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n')

  let parrafo: Inline[][] = []
  let lista: { ordenada: boolean; puntos: Inline[][] } | null = null

  const cierraParrafo = () => {
    if (parrafo.length > 0) bloques.push({ tipo: 'parrafo', lineas: parrafo })
    parrafo = []
  }
  const cierraLista = () => {
    if (lista !== null) bloques.push({ tipo: 'lista', ...lista })
    lista = null
  }

  for (const linea of lineas) {
    const numerado = PUNTO_NUMERADO.exec(linea)
    const suelto = numerado ? null : PUNTO.exec(linea)
    const punto = numerado ?? suelto

    if (punto !== null) {
      const ordenada = numerado !== null
      cierraParrafo()
      // Cambiar de tipo de lista EMPIEZA OTRA. Si no, una numerada pegada a
      // una de puntos se tragaría los puntos y los numeraría.
      if (lista !== null && lista.ordenada !== ordenada) cierraLista()
      if (lista === null) lista = { ordenada, puntos: [] }
      lista.puntos.push(analizaLinea(punto[1] ?? ''))
      continue
    }

    cierraLista()
    if (linea.trim() === '') {
      cierraParrafo()
      continue
    }
    parrafo.push(analizaLinea(linea))
  }

  cierraLista()
  cierraParrafo()
  return bloques
}

/**
 * Las marcas, DE LA MÁS LARGA A LA MÁS CORTA: `***` antes que `**`, y `**`
 * antes que `*`. El orden no es cosmético. Con `*` primero, `**negrita**` se
 * leería como una cursiva vacía seguida de texto.
 *
 * `***` sale solo en cuanto alguien pulsa negrita y luego cursiva sobre lo
 * mismo, así que tiene su propia entrada: significa las dos cosas, anidadas.
 * Sin ella, el cierre se buscaría dos asteriscos antes de donde está y la
 * frase se pintaría con un asterisco suelto a la vista.
 */
const MARCAS = [
  { marca: '***', tipos: ['negrita', 'cursiva'] },
  { marca: '**', tipos: ['negrita'] },
  { marca: '__', tipos: ['subrayado'] },
  { marca: '*', tipos: ['cursiva'] },
] as const

/**
 * Una línea → sus trozos con formato.
 *
 * LA REGLA DE LOS ESPACIOS, que es la que evita los falsos positivos: la marca
 * de apertura tiene que ir PEGADA al texto por la derecha, y la de cierre
 * pegada por la izquierda. Sin ella, «2 * 3 * 4» se pintaría con el 3 en
 * cursiva. Es la misma regla que usa Markdown, y por el mismo motivo.
 */
export function analizaLinea(linea: string): Inline[] {
  const salida: Inline[] = []
  let suelto = ''
  let i = 0

  const vuelcaSuelto = () => {
    if (suelto !== '') salida.push({ tipo: 'texto', texto: suelto })
    suelto = ''
  }

  while (i < linea.length) {
    const encontrada = MARCAS.find((m) => linea.startsWith(m.marca, i))
    if (encontrada !== undefined) {
      const desde = i + encontrada.marca.length
      const cierre = linea.indexOf(encontrada.marca, desde)
      if (cierre > desde) {
        const dentro = linea.slice(desde, cierre)
        if (!/^\s/.test(dentro) && !/\s$/.test(dentro)) {
          vuelcaSuelto()
          // Recursivo: `**negrita con *cursiva* dentro**` funciona. Y termina,
          // porque lo de dentro siempre es más corto que lo de fuera.
          // `reduceRight` anida: ['negrita','cursiva'] → negrita{cursiva{…}}.
          salida.push(
            ...encontrada.tipos.reduceRight<Inline[]>(
              (dentroDe, tipo) => [{ tipo, hijos: dentroDe }],
              analizaLinea(dentro),
            ),
          )
          i = cierre + encontrada.marca.length
          continue
        }
      }
    }
    suelto += linea[i]
    i += 1
  }

  vuelcaSuelto()
  return salida
}

/**
 * El comentario sin ninguna marca, para donde no se puede pintar formato: el
 * correo de aviso de una mención, un resumen de una línea, una exportación.
 *
 * Existe para que ningún sitio acabe enseñando `**esto**` con los asteriscos a
 * la vista por haberse olvidado de que el texto guardado los lleva.
 */
export function enTextoPlano(texto: string): string {
  const deInline = (ns: Inline[]): string =>
    ns.map((n) => (n.tipo === 'texto' ? n.texto : deInline(n.hijos))).join('')

  return analiza(texto)
    .map((b) =>
      b.tipo === 'parrafo'
        ? b.lineas.map(deInline).join('\n')
        : b.puntos.map((p, i) => `${b.ordenada ? `${i + 1}.` : '·'} ${deInline(p)}`).join('\n'),
    )
    .join('\n\n')
}
