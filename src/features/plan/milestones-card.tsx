import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag, Plus, Trash2 } from 'lucide-react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { ErrorPanel, Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/supabase'
import { milestonesRepo } from '@/data/repositories/milestones.repo'
import type { WorkCapabilities } from '@/domain/permissions/work-capabilities'

/**
 * Hitos del trabajo: las fechas que no son tareas sino compromisos (depósito,
 * defensa, entrega de un artículo).
 *
 * `met_at` no se envía nunca desde aquí: la pone el disparador
 * `milestones_met_at`. Ver `milestonesRepo.setMet`.
 */
export function MilestonesCard({
  workId, caps,
}: {
  workId: string
  caps: WorkCapabilities
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [nombre, setNombre] = React.useState('')
  const [fecha, setFecha] = React.useState('')

  const hitos = useQuery({
    queryKey: qk.milestones.byWork(workId),
    queryFn: () => milestonesRepo.byWork(workId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.milestones.byWork(workId) })

  const crear = useMutation({
    mutationFn: () => milestonesRepo.create({ work_id: workId, name: nombre.trim(), due_date: fecha }),
    onSuccess: () => { void invalidate(); setNombre(''); setFecha('') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const marcar = useMutation({
    mutationFn: ({ id, met }: { id: string; met: boolean }) => milestonesRepo.setMet(id, met),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const borrar = useMutation({
    mutationFn: (id: string) => milestonesRepo.remove(id),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const rows = hitos.data ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Flag className="size-4 text-muted-foreground" /> Hitos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {hitos.isLoading ? (
          <Spinner />
        ) : hitos.isError ? (
          <ErrorPanel error={hitos.error} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin hitos.{' '}
            {caps.canManagePlan
              ? 'Un hito es una fecha que hay que cumplir: depósito, defensa, envío de un artículo.'
              : 'La dirección los fija; aquí los verás con su fecha.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((h) => {
              const dias = differenceInCalendarDays(parseISO(h.due_date), new Date())
              const vencido = !h.is_met && dias < 0
              return (
                <li key={h.id} className="flex items-start gap-2 text-sm">
                  <input
                    id={`hito-${h.id}`}
                    type="checkbox"
                    className="mt-0.5 size-4 rounded border-input"
                    checked={h.is_met}
                    disabled={!caps.canManagePlan || marcar.isPending}
                    onChange={(e) => marcar.mutate({ id: h.id, met: e.target.checked })}
                  />
                  <label htmlFor={`hito-${h.id}`} className="min-w-0 flex-1">
                    <span className={cn('block', h.is_met && 'text-muted-foreground line-through')}>
                      {h.name}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {format(parseISO(h.due_date), "d 'de' MMMM yyyy", { locale: es })}
                      {h.is_met && h.met_at && (
                        <ToneBadge tone="green">
                          cumplido el {format(parseISO(h.met_at), 'd MMM', { locale: es })}
                        </ToneBadge>
                      )}
                      {vencido && <ToneBadge tone="red">vencido</ToneBadge>}
                      {!h.is_met && dias >= 0 && dias <= 30 && (
                        <ToneBadge tone="amber">en {dias} día(s)</ToneBadge>
                      )}
                    </span>
                  </label>
                  {caps.canManagePlan && (
                    <Button
                      variant="ghost" size="icon" className="size-7"
                      onClick={() => borrar.mutate(h.id)} aria-label={`Borrar el hito ${h.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {caps.canManagePlan && (
          <form
            className="flex flex-wrap gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (nombre.trim().length >= 2 && fecha) crear.mutate()
            }}
          >
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Depósito de la memoria"
              aria-label="Nombre del hito"
              className="min-w-[8rem] flex-1"
            />
            <Input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              aria-label="Fecha del hito"
              className="w-[9.5rem]"
            />
            <Button
              type="submit" size="sm" variant="outline"
              loading={crear.isPending}
              disabled={nombre.trim().length < 2 || !fecha}
            >
              <Plus /> Añadir
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
