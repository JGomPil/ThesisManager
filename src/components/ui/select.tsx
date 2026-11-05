import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Select nativo. Decisión deliberada frente al de Radix: en formularios
 * académicos largos el select del sistema es más rápido de usar con teclado,
 * funciona mejor en móvil y no arrastra estado de portales. Donde haga falta
 * búsqueda (asignar persona entre cientos), se usará un combobox específico.
 */
export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)
Select.displayName = 'Select'
