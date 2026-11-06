import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListPlus } from 'lucide-react'
import { addDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { templatesRepo } from '@/data/repositories/templates.repo'

/**
 * Aplicar una plantilla a un trabajo.
 *
 * Es una sola llamada a `public.apply_template`, no N inserciones desde aquí:
 * o se crea el plan entero o no se crea nada. Antes de confirmar se muestra la
 * previsión de fechas ya calculada con el día cero elegido, porque un plan de
 * veinte tareas con las fechas mal puestas cuesta más de deshacer que de
 * revisar. El cálculo de la previsión repite la fórmula del servidor
 * (`inicio + offset_days`, duración `duration_days`); si alguna vez dejaran de
 * coincidir, lo que vale es lo que haga la base de datos.
 */
export function ApplyTemplateDialog({
  open, onOpenChange, workId, workTypeId, workStartDate,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  workId: string
  workTypeId: string
  workStartDate: string | null
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [plantillaId, setPlantillaId] = React.useState('')
  const [inicio, setInicio] = React.useState(workStartDate ?? format(new Date(), 'yyyy-MM-dd'))

  const plantillas = useQuery({
    queryKey: qk.templates.forWorkType(workTypeId),
    queryFn: () => templatesRepo.forWorkType(workTypeId),
    enabled: open,
  })

  const elegida = (plantillas.data ?? []).find((p) => p.id === plantillaId) ?? null

  React.useEffect(() => {
    if (open && !plantillaId && plantillas.data?.[0]) setPlantillaId(plantillas.data[0].id)
  }, [open, plantillaId, plantillas.data])

  const aplicar = useMutation({
    mutationFn: () => templatesRepo.apply(workId, plantillaId, inicio),
    onSuccess: (creadas) => {
      void qc.invalidateQueries({ queryKey: qk.tasks.byWork(workId) })
      void qc.invalidateQueries({ queryKey: qk.works.detail(workId) })
      toast.push('success', `Plan creado: ${creadas} tarea(s).`)
      onOpenChange(false)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const rows = plantillas.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Aplicar una plantilla de plan</DialogTitle>
          <DialogDescription>
            Crea las tareas de la plantilla con fechas calculadas a partir del día que elijas.
            No borra ni modifica las tareas que ya existan.
          </DialogDescription>
        </DialogHeader>

        {plantillas.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay plantillas activas para este tipo de trabajo. Las crea la administración del
            grupo en Administración → Plantillas de plan.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="tpl">Plantilla</Label>
              <Select
                id="tpl" className="mt-1.5"
                value={plantillaId}
                onChange={(e) => setPlantillaId(e.target.value)}
              >
                {rows.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.tasks.length} tarea(s)
                    {p.files.length > 0 ? ` · ${p.files.length} material(es)` : ''}
                    {p.work_type ? ` · ${p.work_type.short_name}` : ' · cualquier tipo'}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="tpl-inicio">Día cero del plan</Label>
              <Input
                id="tpl-inicio" type="date" className="mt-1.5"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {workStartDate
                  ? 'Por defecto, la fecha de inicio del trabajo.'
                  : 'El trabajo no tiene fecha de inicio, así que se propone hoy.'}
              </p>
            </div>

            {elegida && elegida.tasks.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Previsión
                </p>
                <ul className="space-y-1 text-sm">
                  {elegida.tasks.map((t) => {
                    const ini = addDays(parseISO(inicio || format(new Date(), 'yyyy-MM-dd')), t.offset_days)
                    const fin = addDays(ini, Math.max(t.duration_days, 0))
                    return (
                      <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
                        {t.parent_index !== null && <span className="text-muted-foreground" aria-hidden>↳</span>}
                        <span>{t.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(ini, 'd MMM yyyy', { locale: es })} – {format(fin, 'd MMM yyyy', { locale: es })}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            loading={aplicar.isPending}
            disabled={!plantillaId || !inicio || rows.length === 0}
            onClick={() => aplicar.mutate()}
          >
            <ListPlus /> Crear el plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
