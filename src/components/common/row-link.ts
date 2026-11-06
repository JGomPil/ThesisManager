import * as React from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Lo que, si recibe el clic, se queda con él: dentro de una fila o una tarjeta
 * hay botones, enlaces y desplegables, y pinchar «Eliminar» no debe además
 * abrir la ficha. Una sola lista, usada por los dos modos de apertura —ruta y
 * diálogo—, para que no se separen.
 */
const CONTROLES = 'a,button,input,select,textarea,label,[role="button"],[role="checkbox"]'

function enUnControl(e: React.MouseEvent<HTMLElement>): boolean {
  return (e.target as HTMLElement).closest(CONTROLES) !== null
}

/** Seleccionar un texto para copiarlo termina en un clic, y ese clic no abre nada. */
function hayTextoSeleccionado(): boolean {
  return (window.getSelection()?.toString() ?? '').length > 0
}

/**
 * La TARJETA entera abre algo que no es una ruta: un diálogo.
 *
 * Hermano de `useRowLink`, con la misma cortesía (controles de dentro y texto
 * seleccionado) pero sin `window.open` ni teclas modificadoras: un diálogo no
 * se puede abrir en otra pestaña, así que ofrecerlo mentiría.
 *
 * NO sustituye al título: ese sigue siendo un `<button>` de verdad, que es lo
 * que recibe el foco con el tabulador y lo que anuncia un lector de pantalla.
 * Esto solo añade el clic en el resto de la tarjeta.
 */
export function propsDeApertura(onOpen: () => void) {
  return {
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (enUnControl(e) || hayTextoSeleccionado()) return
      onOpen()
    },
  }
}

/**
 * Hace que TODA una fila (o tarjeta) lleve a su destino, no solo el título.
 *
 * EL PROBLEMA QUE RESUELVE
 * El título era el único punto de entrada al trabajo: en una fila de seis
 * columnas, cinco no hacían nada. Pinchar en el estado, en el estudiante o en
 * la fecha —que es donde cae el ratón cuando se está leyendo esa columna— no
 * abría nada, y no hay forma de adivinar que el enlace está solo en la primera
 * celda.
 *
 * POR QUÉ NO SE ENVUELVE LA FILA EN UN <a>
 * Dentro de la fila hay botones (archivar) y puede haber otros enlaces. HTML no
 * permite anidar enlaces ni un botón dentro de un enlace, y aunque el navegador
 * lo tolerase, el clic en «Archivar» navegaría además al trabajo. Así que el
 * enlace real sigue estando en el título —es el que ven los lectores de
 * pantalla, el que se puede copiar y el que recibe el foco con el tabulador— y
 * esto solo añade el clic en el resto de la fila.
 *
 * LO QUE SE RESPETA
 *  · Clic en un control de dentro (enlace, botón, campo, etiqueta): no navega,
 *    se queda con su acción. Sin esto, archivar llevaría también a la ficha.
 *  · Texto seleccionado: no navega. Seleccionar el título de un trabajo para
 *    copiarlo termina con un clic, y ese clic no debe abrir nada.
 *  · Ctrl/⌘ y el botón central: abre en una pestaña nueva, como un enlace.
 *    `BASE_URL` hace falta porque la aplicación vive en un subdirectorio de
 *    GitHub Pages y `window.open` no pasa por el enrutador.
 *
 * NO devuelve `className`: el llamante pone `cursor-pointer` en la suya. Si lo
 * devolviera, el objeto esparcido machacaría la clase de la fila (lo hizo: la
 * lista del panel perdió su maquetación entera en el primer intento).
 *
 * NO añade `tabIndex` a la fila a propósito: duplicaría cada parada del
 * tabulador (el título ya es una parada) y no mejora nada para quien navega con
 * teclado.
 */
export function useRowLink() {
  const navigate = useNavigate()

  return React.useCallback(
    (href: string) => ({
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        if (enUnControl(e) || hayTextoSeleccionado()) return
        if (e.metaKey || e.ctrlKey) {
          const base = import.meta.env.BASE_URL.replace(/\/$/, '')
          window.open(`${base}${href}`, '_blank', 'noopener')
          return
        }
        navigate(href)
      },
      onAuxClick: (e: React.MouseEvent<HTMLElement>) => {
        if (e.button !== 1) return
        if (enUnControl(e)) return
        const base = import.meta.env.BASE_URL.replace(/\/$/, '')
        window.open(`${base}${href}`, '_blank', 'noopener')
      },
    }),
    [navigate],
  )
}
