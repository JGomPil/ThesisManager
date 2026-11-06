import * as React from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Una fila de catálogo: nombre, código, distintivos, y los tres gestos.
 *
 * Vive aparte porque la usan las tres tarjetas de catálogo global (estados,
 * roles y tipos de documento) y porque el criterio de cuándo se ofrece BORRAR
 * no debe divergir entre ellas: se ofrece solo si no lo usa nadie. Con uso, el
 * botón únicamente serviría para provocar un error de clave ajena —o, peor, en
 * los catálogos con `on delete set null`, para vaciar un dato histórico sin
 * dejar rastro.
 */
export function FilaCatalogo({
  nombre, codigo, badges, enUso, onEditar, onRetirar, onBorrar, retirado,
}: {
  nombre: string
  codigo: string
  badges?: React.ReactNode
  enUso: number
  onEditar: () => void
  onRetirar: () => void
  /** Sin esto no se ofrece borrar nunca: hay catálogos donde no debe poderse. */
  onBorrar?: () => void
  retirado: boolean
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className="min-w-0 flex-1">
        <span className={cn('block break-words', retirado && 'text-muted-foreground line-through')}>
          {nombre}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1 py-0.5">{codigo}</code>
          {badges}
          {enUso > 0 && <span>· lo usan {enUso}</span>}
        </span>
      </span>
      <Button variant="ghost" size="icon" className="size-7 shrink-0"
        onClick={onEditar} aria-label={`Editar ${nombre}`}>
        <Pencil className="size-3.5" />
      </Button>
      <Button variant="ghost" size="sm" className="shrink-0 px-2 text-xs"
        onClick={onRetirar}>
        {retirado ? 'Reactivar' : 'Retirar'}
      </Button>
      {/* Borrar solo si no lo usa nadie. Con uso, la clave ajena lo rechaza
          (`on delete restrict`): el botón solo serviría para dar un error. */}
      {enUso === 0 && onBorrar && (
        <Button variant="ghost" size="icon" className="size-7 shrink-0"
          onClick={onBorrar} aria-label={`Borrar ${nombre}`}>
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </li>
  )
}

