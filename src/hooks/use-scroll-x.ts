import * as React from 'react'

/**
 * Un panel que se desliza a lo ancho, y que DICE que se desliza.
 *
 * `overflow-x-auto` basta para que se pueda arrastrar, pero no para que nadie
 * sepa que se puede: fue el problema del cronograma —«lo veo incompleto»— y el
 * del tablero, donde las columnas que no entraban en la pantalla simplemente no
 * existían. Así que lo que no cabe se anuncia con dos flechas.
 *
 * `desbordado` se MIDE, no se calcula: comparar un ancho supuesto con el de la
 * pantalla sería adivinar, y estos paneles se usan en una tarjeta, a pantalla
 * completa y en un móvil. `ResizeObserver` lo vuelve a medir cuando la ventana
 * cambia o cuando se pasa a pantalla completa.
 *
 * `clave` es lo que, al cambiar, obliga a medir otra vez: el número de columnas
 * del tablero, la escala del cronograma. Es un valor y no una lista de
 * dependencias para que la regla de los hooks siga comprobándola de verdad.
 */
export function useScrollX(clave: unknown) {
  const panel = React.useRef<HTMLDivElement>(null)
  const [desbordado, setDesbordado] = React.useState(false)

  React.useEffect(() => {
    const el = panel.current
    if (!el) return
    // El margen de 4 px evita que un redondeo de medio píxel anuncie un
    // desplazamiento que no existe.
    const medir = () => setDesbordado(el.scrollWidth > el.clientWidth + 4)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [clave])

  /** Un paso de casi una pantalla, que deja a la vista por dónde se iba. */
  const deslizar = (sentido: 1 | -1) => {
    const el = panel.current
    if (!el) return
    el.scrollBy({ left: sentido * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  /**
   * Mientras se arrastra una tarjeta cerca de un borde, el panel acompaña.
   *
   * Sin esto, un tablero de diez columnas obliga a soltar la tarjeta en medio,
   * desplazar a mano y volver a arrastrarla. El navegador no lo hace por su
   * cuenta dentro de un panel con `overflow`.
   */
  const acompanarArrastre = (clientX: number) => {
    const el = panel.current
    if (!el) return
    const caja = el.getBoundingClientRect()
    const margen = 72
    if (clientX > caja.right - margen) el.scrollBy({ left: 28 })
    else if (clientX < caja.left + margen) el.scrollBy({ left: -28 })
  }

  return { panel, desbordado, deslizar, acompanarArrastre }
}
