import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ToneBadge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { catalogsRepo } from '@/data/repositories/catalogs.repo'
import { useWorkStatuses, useWorkTypeStatuses } from '@/hooks/use-catalogs'
import type { WorkTypeRow } from '@/data/types/database'

/**
 * Qué estados aplican a un tipo de trabajo.
 *
 * ESTA ES LA REGLA, Y ES RARA DE LA PRIMERA VEZ: un tipo SIN ninguna fila en
 * `work_type_statuses` admite **todos** los estados activos; con filas, solo
 * esas (DATABASE.md §3.2). Es lo que permite que la Academia de Alumnos
 * Internos no pase por «Pendiente de depósito» ni por «Defendido» sin que eso
 * esté escrito en el código, y lo que hace que un tipo nuevo funcione desde el
 * minuto uno sin configurar nada.
 *
 * Por eso «nada marcado» no es un estado vacío que haya que evitar: es el valor
 * por omisión y el diálogo lo dice en voz alta. Marcar los diez estados y no
 * marcar ninguno **no son lo mismo** —el primero congela la lista y el segundo
 * la deja seguir el catálogo—, así que también se explica.
 *
 * El guardado borra las filas del tipo y vuelve a insertar las marcadas. No es
 * elegante, pero es exactamente lo que se quiere: el orden de la lista es el
 * orden en que se verán en el desplegable del trabajo, y reconstruirla evita
 * tener que razonar sobre qué cambió respecto de antes.
 */
export function WorkTypeStatusesDialog({
  type, open, onOpenChange,
}: {
  type: WorkTypeRow | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const estados = useWorkStatuses()
  const mapeos = useWorkTypeStatuses()
  const [marcados, setMarcados] = React.useState<string[]>([])

  // Al abrir se parte de lo que hay guardado. El efecto depende del tipo y de
  // los mapeos: si se abre antes de que lleguen, hay que rellenar al llegar.
  React.useEffect(() => {
    if (!open || !type) return
    const suyos = (mapeos.data ?? [])
      .filter((m) => m.work_type_id === type.id)
      .sort((a, b) => a.display_order - b.display_order)
      .map((m) => m.status_id)
    setMarcados(suyos)
  }, [open, type, mapeos.data])

  const guardar = useMutation({
    mutationFn: () => catalogsRepo.setWorkTypeStatuses(type!.id, marcados),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.catalogs.workTypeStatuses })
      toast.push(
        'success',
        marcados.length === 0
          ? 'Sin restricciones: a este tipo le aplicarán todos los estados activos.'
          : `${marcados.length} estado(s) para este tipo.`,
      )
      onOpenChange(false)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const filas = estados.data ?? []
  const cargando = estados.isLoading || mapeos.isLoading

  const alternar = (id: string) =>
    setMarcados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Estados de «{type?.name}»</DialogTitle>
          <DialogDescription>
            El ciclo de vida de este tipo de trabajo: qué estados se podrán elegir en su ficha.
          </DialogDescription>
        </DialogHeader>

        {cargando ? <Spinner /> : (
          <div className="space-y-3">
            <ul className="space-y-1.5">
              {filas.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input"
                      checked={marcados.includes(s.id)}
                      onChange={() => alternar(s.id)}
                    />
                    <span className="min-w-0 flex-1 break-words">{s.name}</span>
                    <ToneBadge tone={s.color}>{s.code}</ToneBadge>
                    {s.is_terminal && <ToneBadge tone="green">final</ToneBadge>}
                  </label>
                </li>
              ))}
            </ul>

            <p className="text-xs text-muted-foreground">
              {marcados.length === 0
                ? 'Nada marcado: a este tipo le aplicarán TODOS los estados activos, también los que se añadan en el futuro. Es lo normal y no hay que tocar nada.'
                : `Solo esos ${marcados.length} estados se podrán elegir. Un estado nuevo del catálogo NO aparecerá en este tipo hasta que se marque aquí.`}
            </p>
            <p className="text-xs text-muted-foreground">
              Los trabajos que ya estén en un estado que aquí se quite lo conservan: esto decide
              lo que se puede elegir de ahora en adelante, no reescribe lo pasado.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {marcados.length > 0 && (
            <Button variant="outline" onClick={() => setMarcados([])}>
              Quitar restricciones
            </Button>
          )}
          <Button onClick={() => guardar.mutate()} loading={guardar.isPending} disabled={!type}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
