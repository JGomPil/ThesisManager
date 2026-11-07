import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn, toneClass } from '@/lib/utils'

/**
 * `whitespace-nowrap` para que la pastilla no se parta en dos líneas, y
 * `max-w-full` + recorte PARA QUE NO ENSANCHE A SU CONTENEDOR.
 *
 * Los dos nombres que van dentro los escribe la administración desde los
 * catálogos (`work_types.short_name` admite 20 caracteres, `work_statuses.name`
 * 120), así que una abreviatura larga —«PRACTICAS EMPRESA»— metida en una
 * tarjeta del resumen, que en un teléfono mide unos 160 px, empujaba la página
 * más allá del ancho de la pantalla. Y una página más ancha que la pantalla es
 * desplazamiento horizontal en todas las demás pantallas y el navegador
 * ofreciendo «ver la versión de escritorio».
 *
 * Es el único sitio donde se recorta texto a propósito: lo que dice la pastilla
 * es una abreviatura de catálogo, no información que haya que leer entera.
 */
const badgeVariants = cva(
  'inline-flex max-w-full items-center overflow-hidden text-ellipsis rounded-md border px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        destructive: 'border-transparent bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

/**
 * Insignia coloreada a partir de un token de catálogo (work_types.color,
 * work_statuses.color). Permite añadir tipos de trabajo con colores nuevos
 * sin tocar el código.
 */
export function ToneBadge({ tone, children, className }: { tone: string | null; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center overflow-hidden text-ellipsis rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClass(tone),
        className,
      )}
    >
      {children}
    </span>
  )
}
