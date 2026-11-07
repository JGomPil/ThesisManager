import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, ListChecks, Pencil, Plus } from 'lucide-react'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { Badge, ToneBadge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ErrorPanel, FieldError, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { TONES } from '@/lib/utils'
import { catalogsRepo } from '@/data/repositories/catalogs.repo'
import { useAcademicLevels, useWorkTypeStatuses, useWorkTypes } from '@/hooks/use-catalogs'
import { useAuth } from '@/features/auth/auth-context'
import { WorkTypeStatusesDialog } from '@/features/admin/work-type-statuses-dialog'
import { workTypeFormSchema, type WorkTypeFormValues } from '@/schemas/work'
import type { WorkTypeRow } from '@/data/types/database'

/**
 * Catálogo de tipos de trabajo.
 *
 * Esta pantalla es la razón de que TFG, TFM, tesis y Academia de Alumnos
 * Internos no estén codificados en ningún sitio: cualquier tipo futuro
 * («Prácticas de empresa», «Estancia de investigación», «Beca de colaboración»)
 * se crea aquí y queda disponible al instante en los formularios y el
 * dashboard, sin migración ni despliegue.
 */
export function WorkTypesPage() {
  const [editing, setEditing] = React.useState<WorkTypeRow | null>(null)
  const [creating, setCreating] = React.useState(false)
  // El tipo cuyo ciclo de vida se está editando. Ver `WorkTypeStatusesDialog`:
  // un tipo sin filas admite todos los estados, y eso se dice en el diálogo.
  const [ciclo, setCiclo] = React.useState<WorkTypeRow | null>(null)
  // El tipo que se va a retirar, pendiente de confirmación. Retirar no borra
  // nada, pero quita el tipo de los formularios de alta y del resumen: es un
  // cambio que se ve en pantallas que no son esta, así que se pregunta.
  const [aRetirar, setARetirar] = React.useState<WorkTypeRow | null>(null)
  const types = useWorkTypes(true)
  const mapeos = useWorkTypeStatuses()
  const qc = useQueryClient()
  const toast = useToast()

  const deactivate = useMutation({
    mutationFn: (id: string) => catalogsRepo.deactivateWorkType(id),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: qk.catalogs.workTypes })
      setARetirar(null)
      toast.push(
        'success',
        `«${t.name}» retirado. Los trabajos que ya lo usan lo conservan, y puedes reactivarlo aquí mismo.`,
      )
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const activate = useMutation({
    mutationFn: (id: string) => catalogsRepo.activateWorkType(id),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: qk.catalogs.workTypes })
      toast.push('success', `«${t.name}» vuelve a estar disponible al crear un trabajo.`)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (types.isLoading) return <LoadingPanel />
  if (types.isError) return <ErrorPanel error={types.error} />

  const rows = types.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tipos de trabajo"
        breadcrumb={[{ label: 'Administración', to: '/admin' }, { label: 'Tipos de trabajo' }]}
        description="Catálogo configurable. Añadir un tipo nuevo no requiere ningún cambio en el código."
        actions={<Button onClick={() => setCreating(true)}><Plus /> Nuevo tipo</Button>}
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Nivel</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Defensa</TableHead>
              <TableHead>Depósito</TableHead>
              <TableHead>Titulación</TableHead>
              <TableHead>Estados</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id} className={t.is_active ? '' : 'opacity-55'}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ToneBadge tone={t.color}>{t.short_name}</ToneBadge>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.code}</p>
                    </div>
                    {!t.is_active && <Badge variant="secondary">inactivo</Badge>}
                    {t.organization_id === null && <Badge variant="outline">global</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.academic_level ?? '—'}</TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">
                  {t.default_duration_months ? `${t.default_duration_months} meses` : '—'}
                </TableCell>
                <TableCell><Flag on={t.requires_defense} /></TableCell>
                <TableCell><Flag on={t.requires_deposit} /></TableCell>
                <TableCell><Flag on={t.requires_program} /></TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {(() => {
                    const n = (mapeos.data ?? []).filter((m) => m.work_type_id === t.id).length
                    return n === 0
                      ? <span title="Sin restricciones: le aplican todos los estados activos">todos</span>
                      : <span className="tabular-nums">{n}</span>
                  })()}
                </TableCell>
                <TableCell>
                  {/* CADA ACCIÓN CON SU PALABRA, no tres dibujos.
                      Eran tres iconos sin una letra al lado, y el de retirar se
                      pulsó para ver qué hacía: con razón, porque un ojo tachado
                      no dice «quitarlo de los formularios de alta». El texto
                      solo se esconde en pantalla estrecha, donde no cabe; la
                      tabla ya se desplaza en horizontal. */}
                  <div className="flex justify-end gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => setEditing(t)} aria-label={`Editar ${t.name}`}>
                      <Pencil /> <span className="hidden lg:inline">Editar</span>
                    </Button>
                    <Button
                      variant="outline" size="sm" onClick={() => setCiclo(t)}
                      aria-label={`Estados aplicables a ${t.name}`}
                      title="Qué estados se pueden elegir en este tipo"
                    >
                      <ListChecks /> <span className="hidden lg:inline">Estados</span>
                    </Button>
                    {t.is_active ? (
                      <Button
                        variant="outline" size="sm"
                        onClick={() => setARetirar(t)}
                        aria-label={`Retirar ${t.name}`}
                        title="Dejar de ofrecerlo al crear trabajos. Reversible"
                      >
                        <EyeOff /> <span className="hidden lg:inline">Retirar</span>
                      </Button>
                    ) : (
                      <Button
                        variant="outline" size="sm"
                        loading={activate.isPending && activate.variables === t.id}
                        onClick={() => activate.mutate(t.id)}
                        aria-label={`Reactivar ${t.name}`}
                        title="Volver a ofrecerlo al crear trabajos"
                      >
                        <Eye /> <span className="hidden lg:inline">Reactivar</span>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <p className="text-xs text-muted-foreground">
        Los tipos no se borran: se retiran. Un trabajo histórico debe conservar su tipo, y la
        base de datos lo impone con <code>ON DELETE RESTRICT</code>. Un tipo retirado se queda en
        esta lista, atenuado, con su botón <strong>Reactivar</strong>: retirar siempre tiene
        vuelta. Los tipos marcados como
        «global» vienen precargados: su nombre, su color, sus reglas y su ciclo de vida{' '}
        <strong>sí</strong> se editan desde aquí, y también se pueden retirar, pero no borrar,
        porque no son de ninguna organización en particular. Esos cambios los ven todas las
        organizaciones (hoy solo hay una). El código no se cambia nunca: el catálogo inicial y
        las migraciones casan por código.
      </p>

      <WorkTypeDialog
        open={creating || editing !== null}
        workType={editing}
        onClose={() => { setCreating(false); setEditing(null) }}
      />
      <WorkTypeStatusesDialog
        type={ciclo}
        open={ciclo !== null}
        onOpenChange={(v) => { if (!v) setCiclo(null) }}
      />

      <Dialog open={aRetirar !== null} onOpenChange={(v) => { if (!v) setARetirar(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Retirar «{aRetirar?.name}»?</DialogTitle>
            <DialogDescription>
              Dejará de ofrecerse al crear un trabajo y su tarjeta desaparecerá del resumen.{' '}
              <strong>No se borra nada</strong>: los trabajos que ya son de este tipo lo
              conservan, y aquí mismo te quedará el botón <strong>Reactivar</strong> para
              deshacerlo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setARetirar(null)}>Cancelar</Button>
            <Button
              loading={deactivate.isPending}
              onClick={() => aRetirar && deactivate.mutate(aRetirar.id)}
            >
              <EyeOff /> Retirar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Flag({ on }: { on: boolean }) {
  return (
    <span className={on ? 'text-sm font-medium text-emerald-600' : 'text-sm text-muted-foreground'}>
      {on ? 'Sí' : 'No'}
    </span>
  )
}

function WorkTypeDialog({
  open, workType, onClose,
}: {
  open: boolean
  workType: WorkTypeRow | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const levels = useAcademicLevels()
  const { organizationId } = useAuth()
  const isEdit = workType !== null

  const form = useForm<WorkTypeFormValues>({
    resolver: zodResolver(workTypeFormSchema),
    defaultValues: {
      code: '', name: '', short_name: '', academic_level: 'GRADO', color: 'blue',
      display_order: 10, default_duration_months: 9,
      requires_defense: true, requires_deposit: true, requires_program: true,
      allows_multiple_students: false, counts_toward_workload: true, notes: '',
    },
  })

  React.useEffect(() => {
    if (!open) return
    if (workType) {
      form.reset({
        code: workType.code,
        name: workType.name,
        short_name: workType.short_name,
        academic_level: workType.academic_level ?? 'GRADO',
        color: workType.color,
        display_order: workType.display_order,
        default_duration_months: workType.default_duration_months,
        requires_defense: workType.requires_defense,
        requires_deposit: workType.requires_deposit,
        requires_program: workType.requires_program,
        allows_multiple_students: workType.allows_multiple_students,
        counts_toward_workload: workType.counts_toward_workload,
        notes: workType.notes ?? '',
      })
    } else {
      form.reset()
    }
  }, [open, workType, form])

  const save = useMutation({
    mutationFn: (values: WorkTypeFormValues) => {
      const payload = { ...values, notes: values.notes || null }
      if (isEdit) return catalogsRepo.updateWorkType(workType.id, payload)
      if (!organizationId) throw new Error('No tienes una organización activa.')
      return catalogsRepo.createWorkType({ ...payload, organization_id: organizationId })
    },
    onSuccess: (t) => {
      // Invalidar hace que el tipo nuevo aparezca de inmediato en los
      // selectores de trabajo y en las tarjetas del dashboard.
      void qc.invalidateQueries({ queryKey: qk.catalogs.workTypes })
      toast.push('success', isEdit ? 'Tipo actualizado.' : `Tipo «${t.name}» creado y disponible ya.`)
      onClose()
    },
    onError: (e) => {
      const msg = errorMessage(e)
      toast.push(
        'error',
        msg.includes('duplicate key') || msg.includes('work_types_code')
          ? 'Ya existe un tipo con ese código.'
          : msg,
      )
    },
  })

  const isGlobal = workType?.organization_id === null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Editar «${workType.name}»` : 'Nuevo tipo de trabajo'}</DialogTitle>
          <DialogDescription>
            Las reglas que marques aquí gobiernan el comportamiento de la aplicación para este tipo:
            qué estados ofrece, qué fechas pide y si computa en la carga de supervisión.
          </DialogDescription>
        </DialogHeader>

        {isGlobal && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
            Este es un tipo global precargado. Si lo editas, el cambio afecta a todas las
            organizaciones de esta instalación. Con un solo grupo, no hay problema.
          </p>
        )}

        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="wt-name">Nombre completo</Label>
              <Input id="wt-name" className="mt-1.5" placeholder="Academia de Alumnos Internos" {...form.register('name')} />
              <FieldError>{form.formState.errors.name?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="wt-short">Abreviatura</Label>
              <Input id="wt-short" className="mt-1.5" placeholder="Academia" {...form.register('short_name')} />
              <FieldError>{form.formState.errors.short_name?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="wt-code">Código</Label>
              <Input id="wt-code" className="mt-1.5 font-mono uppercase" placeholder="ACADEMIA" disabled={isEdit} {...form.register('code')} />
              <FieldError>{form.formState.errors.code?.message}</FieldError>
              {isEdit && <p className="mt-1 text-xs text-muted-foreground">El código no se cambia: puede estar referenciado.</p>}
            </div>
            <div>
              <Label htmlFor="wt-level">Nivel académico</Label>
              <Select id="wt-level" className="mt-1.5" {...form.register('academic_level')}>
                {(levels.data ?? []).map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="wt-color">Color</Label>
              <Select id="wt-color" className="mt-1.5" {...form.register('color')}>
                {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
              <div className="mt-1.5"><ToneBadge tone={form.watch('color')}>{form.watch('short_name') || 'Vista previa'}</ToneBadge></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="wt-months">Duración (meses)</Label>
                <Input id="wt-months" type="number" min={1} max={120} className="mt-1.5" {...form.register('default_duration_months')} />
                <FieldError>{form.formState.errors.default_duration_months?.message}</FieldError>
              </div>
              <div>
                <Label htmlFor="wt-order">Orden</Label>
                <Input id="wt-order" type="number" min={0} className="mt-1.5" {...form.register('display_order')} />
              </div>
            </div>
          </div>

          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Reglas de este tipo
            </legend>
            <Check name="requires_defense" form={form} label="Tiene acto de defensa" hint="Habilita el estado «Defendido» y la fecha de defensa" />
            <Check name="requires_deposit" form={form} label="Requiere depósito oficial" hint="Habilita el estado «Pendiente de depósito»" />
            <Check name="requires_program" form={form} label="Exige titulación o programa asociado" />
            <Check name="allows_multiple_students" form={form} label="Admite varios estudiantes" hint="Trabajos compartidos" />
            <Check name="counts_toward_workload" form={form} label="Computa en la carga de supervisión" />
          </fieldset>

          <div>
            <Label htmlFor="wt-notes">Notas internas</Label>
            <Textarea id="wt-notes" rows={2} className="mt-1.5" {...form.register('notes')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={save.isPending}>{isEdit ? 'Guardar' : 'Crear tipo'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Check({
  name, form, label, hint,
}: {
  name: keyof WorkTypeFormValues
  form: ReturnType<typeof useForm<WorkTypeFormValues>>
  label: string
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 rounded border-input"
        {...form.register(name as 'requires_defense')}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}
