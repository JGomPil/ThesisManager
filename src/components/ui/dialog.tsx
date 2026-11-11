import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // CENTRADO CON MÁRGENES, NO CON `100vw` NI `translateX`.
        //
        // Era `left-1/2 w-[calc(100vw-2rem)] -translate-x-1/2`, y en un móvil
        // la ficha de una tarea se salía por la derecha. La culpa la reparten
        // dos cosas: `100vw` NO es el ancho que queda —incluye la barra de
        // desplazamiento donde la hay— y, sobre todo, en cuanto algo de la
        // página de debajo se desborda a lo ancho, el navegador del móvil
        // ensancha el lienzo y un elemento `fixed` centrado al 50 % se va con
        // él. El ancho del diálogo quedaba bien y su posición no.
        //
        // `inset-x-4` + `mx-auto` + `max-w-lg` dice lo mismo sin medir la
        // ventana: ocupa lo que queda entre dos márgenes de 1 rem, nunca más
        // de 32 rem, y se centra con márgenes automáticos. Eso no depende de
        // `vw` ni de ninguna transformación, así que no hay nada que se
        // descuadre. Quien necesite otro ancho pasa su `inset-x-*` y su
        // `max-w-*`: `tailwind-merge` sustituye el de aquí (lo hace
        // `FullscreenPanel`).
        'fixed inset-x-4 top-1/2 z-50 mx-auto grid max-w-lg -translate-y-1/2 gap-4',
        // `[&>*]:min-w-0` tiene más fondo del que parece: los hijos de un grid
        // valen `min-width: auto`, o sea que NO se encogen por debajo de su
        // contenido. Un nombre largo sin espacios, una tabla o una fila de
        // botones empujan al hijo más allá del ancho del diálogo —que es fijo—
        // y lo que se sale por el lado no se puede alcanzar.
        '[&>*]:min-w-0',
        // `dvh`, no `vh`: en iOS Safari `100vh` cuenta la barra de direcciones
        // como si no estuviera, así que el diálogo se salía por abajo y su
        // último botón quedaba debajo de la barra, inalcanzable. `dvh` es la
        // altura que de verdad se ve en cada momento.
        'max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg border bg-background p-4 shadow-lg sm:p-6',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
        <X className="size-4" />
        <span className="sr-only">Cerrar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DialogContent.displayName = 'DialogContent'

export const DialogHeader = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
)

/**
 * `flex-wrap` no es decorativo: el diálogo tiene ancho FIJO
 * (`w-[calc(100vw-2rem)] max-w-lg`) y `overflow-y-auto`, o sea que lo que se
 * sale por los lados no se puede ni alcanzar. Con cuatro acciones —«Marcar como
 * completada», «Editar», «Eliminar», «Cerrar»— la fila se salía del recuadro y
 * en un teléfono se comía la ficha entera. Que envuelvan es la diferencia entre
 * una fila de dos alturas y unos botones inalcanzables.
 */
export const DialogFooter = ({ className, ...props }: React.ComponentProps<'div'>) => (
  <div
    className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end', className)}
    {...props}
  />
)

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  // `break-words`: el título suele ser algo que ha escrito una persona (el
  // nombre de una tarea, de un documento), y una palabra larga sin espacios
  // —una URL, un nombre de fichero— ensancharía el diálogo entero.
  <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight break-words', className)} {...props} />
))
DialogTitle.displayName = 'DialogTitle'

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
DialogDescription.displayName = 'DialogDescription'
