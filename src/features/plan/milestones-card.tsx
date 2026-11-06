import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Flag, Pencil, Plus, Trash2, X } from 'lucide-react'
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
 *
 * EL MISMO FORMULARIO AÑADE Y CORRIGE. Un hito tiene dos campos, nombre y
 * fecha, y hasta ahora solo se podían escribir al crearlo: una fecha mal puesta
 * obligaba a borrar el hito y rehacerlo, perdiendo su marca de cumplido. En una
 * tarjeta estrecha como esta, un segundo juego de campos dentro de cada fila
 * cabría mal y sería la misma validación escrita dos veces; así que al editar se
 * carga el hito en el formulario de abajo, que cambia de rótulo y lo dice.
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
  const [editandoId, setEditandoId] = React.useState<string | null>(null)
  const campoNombre = React.useRef<HTMLInputElement>(null)

  const hitos = useQuery({
    queryKey: qk.milestones.byWork(workId),
    queryFn: () => milestonesRepo.byWork(workId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.milestones.byWork(workId) })

  const guardar = useMutation({
    mutationFn: () =>
      editandoId
        ? milestonesRepo.update(editandoId, { name: nombre.trim(), due_date: fecha })
        : milestonesRepo.create({ work_id: workId, name: nombre.trim(), due_date: fecha }),
    onSuccess: () => {
      void invalidate()
      setNombre('')
      setFecha('')
      setEditandoId(null)
    },
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
  const editando = rows.find((h) => h.id === editandoId) ?? null

  // Se lleva el hito al formulario y se pone el foco donde se va a escribir: en
  // una tarjeta con varios hitos, cambiar los campos de abajo sin mover el foco
  // parece que no ha pasado nada.
  const empezarEdicion = (h: { id: string; name: string; due_date: string }) => {
    setEditandoId(h.id)
    setNombre(h.name)
    setFecha(h.due_date)
    campoNombre.current?.focus()
  }

  const cancelar = () => {
    setEditandoId(null)
    setNombre('')
    setFecha('')
  }

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
                    <>
                      <Button
                        variant="ghost" size="icon" className="size-7"
                        onClick={() => empezarEdicion(h)} aria-label={`Editar el hito ${h.name}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="size-7"
                        onClick={() => borrar.mutate(h.id)} aria-label={`Borrar el hito ${h.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {caps.canManagePlan && (
          <form
            className="space-y-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (nombre.trim().length >= 2 && fecha) guardar.mutate()
            }}
          >
            {editando && (
              <p className="text-xs text-muted-foreground">
                Editando «{editando.name}». Se conserva si estaba cumplido.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Input
                ref={campoNombre}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Depósito de la memoria"
                aria-label={editando ? 'Nombre del hito que se edita' : 'Nombre del hito'}
                className="min-w-[8rem] flex-1"
              />
              <Input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                aria-label="Fecha del hito"
                className="w-[9.5rem]"
              />
              {editando && (
                <Button type="button" size="sm" variant="ghost" onClick={cancelar}>
                  <X /> Cancelar
                </Button>
              )}
              <Button
                type="submit" size="sm" variant="outline"
                loading={guardar.isPending}
                disabled={nombre.trim().length < 2 || !fecha}
              >
                {editando ? <><Check /> Guardar</> : <><Plus /> Añadir</>}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
