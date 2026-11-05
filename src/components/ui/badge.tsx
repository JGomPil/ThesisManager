import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn, toneClass } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap',
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
        'inline-flex items-center rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneClass(tone),
        className,
      )}
    >
      {children}
    </span>
  )
}
