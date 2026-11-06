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
        'fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4',
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
