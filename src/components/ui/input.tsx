import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * TAMAÑO DE LETRA 16 px EN MÓVIL, 14 px DESDE `sm:`
 *
 * No es estética: Safari en iOS **hace zoom automático** al enfocar un campo
 * cuya letra mida menos de 16 px, y al salir del campo no lo deshace. El
 * resultado es que tocar un buscador deja la página ampliada y descolocada, y
 * hay que pellizcar para volver. Con `text-base` (16 px) por debajo de `sm:` no
 * hay zoom; en escritorio sigue siendo `text-sm`, que es lo que pide el diseño.
 */

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base shadow-sm transition-colors sm:text-sm',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm sm:text-sm',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
