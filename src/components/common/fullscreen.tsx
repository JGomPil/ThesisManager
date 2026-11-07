import * as React from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog'

/**
 * Ver una tarjeta a pantalla completa, y volver.
 *
 * POR QUÉ
 * El tablero de tareas vive en los dos tercios izquierdos de la ficha del
 * trabajo, y sus cinco columnas (`xl:grid-cols-5`) se reparten ese ancho: con
 * seis tareas por columna no se lee nada. Lo mismo le pasa al cronograma, que
 * encima tiene una escala temporal que solo gana con el ancho. La alternativa
 * —una pantalla aparte para el tablero— duplicaría una ruta y un estado para
 * enseñar exactamente lo mismo.
 *
 * CÓMO
 * Es el `Dialog` de siempre, al que se le quita el ancho máximo y se le da el
 * de la ventana. Dos consecuencias buenas que vienen de regalo: `Esc` cierra y
 * el foco se queda dentro mientras está abierto, porque las dos cosas las hace
 * ya Radix.
 *
 * LO QUE SE VE DENTRO NO SE DIBUJA DOS VECES. Quien use esto debe mover el
 * contenido aquí mientras esté abierto y dejar un aviso en la tarjeta, no
 * pintarlo en los dos sitios: el tablero y el cronograma tienen estado propio
 * (diálogos abiertos, escala elegida) y dos copias vivas a la vez son dos
 * copias que se contradicen.
 */
export function FullscreenPanel({
  open, onOpenChange, title, children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `max-w-none` anula el `max-w-lg` del diálogo normal; `flex` sustituye
          a su `grid` para que el contenido pueda crecer y desplazarse dentro.
          `dvh` y no `vh` por lo de siempre: en iOS la barra de direcciones. */}
      <DialogContent className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-3 p-3 sm:p-4">
        {/* `pr-10`: la «✕» del diálogo va en posición absoluta en la esquina
            (`right-4 top-4`), así que sin este hueco se le montaría encima el
            botón de salir. */}
        <div className="flex items-start justify-between gap-2 pr-10">
          {/* `break-words`: el título lleva el nombre del trabajo, que lo
              escribe una persona y puede ser largo. */}
          <DialogTitle className="min-w-0 break-words text-base">{title}</DialogTitle>
          {/* Botón CON TEXTO, además de la «✕» de la esquina: la aspa sola no
              dice de qué se sale, y de una pantalla completa hay que poder
              salir sin adivinar nada. */}
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => onOpenChange(false)}>
            <Minimize2 /> Salir de pantalla completa
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * El botón que abre lo anterior. Va en la cabecera de la tarjeta.
 *
 * Oculto en el móvil A PROPÓSITO: allí la tarjeta ya ocupa todo el ancho, así
 * que no hay nada que ganar, y el tablero abre diálogos propios —la ficha de
 * una tarea— que quedarían apilados sobre este, que es la forma más rápida de
 * dejar media pantalla inservible en un teléfono.
 */
export function ExpandButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="hidden shrink-0 sm:inline-flex"
      onClick={onClick}
      title={label}
    >
      <Maximize2 /> Pantalla completa
    </Button>
  )
}

/**
 * Lo que queda en la tarjeta mientras su contenido está en pantalla completa.
 *
 * Se ve por detrás de la cortina del diálogo, y no sobra: sin él la tarjeta se
 * queda vacía y lo que se adivina al fondo es una ficha a medio cargar. No
 * lleva ningún botón porque nada de aquí se puede pulsar mientras el diálogo
 * está abierto; para volver están su botón, la «✕» y `Esc`.
 */
export function EnPantallaCompleta() {
  return (
    <p className="text-sm text-muted-foreground">Se está viendo a pantalla completa.</p>
  )
}
