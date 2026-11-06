import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ListChecks, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/supabase'
import { templatesRepo, type TemplateWithTasks } from '@/data/repositories/templates.repo'
import { TASK_PRIORITIES } from '@/data/repositories/tasks.repo'
import { useWorkTypes } from '@/hooks/use-catalogs'
import { useAuth } from '@/features/auth/auth-context'
import type { TaskPriority } from '@/data/types/database'

/**
 * Plantillas de plan de trabajo.
 *
 * Es lo que convierte «teclear veinte tareas cada vez que empieza un TFG» en un
 * clic. Las fechas de la plantilla son RELATIVAS (`offset_days` desde el día
 * cero, `duration_days` de duración), de modo que la misma plantilla sirva para
 * un trabajo que empieza en octubre y para otro que empieza en febrero.
 *
 * LA JERARQUÍA SE EXPRESA CON UNA CASILLA, NO CON UN NÚMERO. En la base de
 * datos, `template_tasks.parent_index` apunta al `order_index` del padre dentro
 * de la plantilla; pedir ese número en un formulario sería pedirle al usuario
 * que lleve la contabilidad de los índices, y un número mal puesto produce una
 * plantilla que falla al aplicarse (y que `app.apply_template` rechaza entera,
 * prueba `[87]`). Aquí se marca «es subapartado del anterior» y el índice se
 * calcula solo, que además garantiza que el padre va siempre antes que el hijo.
 */
export function TemplatesPage() {
  const { organizationId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const tipos = useWorkTypes()

  const [nombre, setNombre] = React.useState('')
  const [descripcion, setDescripcion] = React.useState('')
  const [tipoId, setTipoId] = React.useState('')
  const [abierta, setAbierta] = React.useState<string | null>(null)

  const plantillas = useQuery({ queryKey: qk.templates.all, queryFn: templatesRepo.list })
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.templates.all })

  const crear = useMutation({
    mutationFn: () =>
      templatesRepo.create({
        organization_id: organizationId!,
        name: nombre.trim(),
        description: descripcion.trim() || null,
        work_type_id: tipoId || null,
      }),
    onSuccess: (t) => {
      void invalidate()
      setNombre(''); setDescripcion(''); setTipoId('')
      setAbierta(t.id)
      toast.push('success', 'Plantilla creada. Añádele tareas.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const alternar = useMutation({
    mutationFn: ({ id, activa }: { id: string; activa: boolean }) =>
      templatesRepo.update(id, { is_active: activa }),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const borrar = useMutation({
    mutationFn: (id: string) => templatesRepo.remove(id),
    onSuccess: () => { void invalidate(); toast.push('success', 'Plantilla eliminada.') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (plantillas.isLoading) return <LoadingPanel />
  if (plantillas.isError) return <ErrorPanel error={plantillas.error} />

  const rows = plantillas.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Plantillas de plan"
        description="Planes de tareas reutilizables, con fechas relativas al inicio de cada trabajo."
        breadcrumb={[{ label: 'Administración', to: '/admin' }, { label: 'Plantillas' }]}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Nueva plantilla</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (nombre.trim().length >= 3 && organizationId) crear.mutate()
            }}
          >
            <div>
              <Label htmlFor="t-nombre">Nombre</Label>
              <Input
                id="t-nombre" className="mt-1.5" placeholder="Plan estándar de TFG"
                value={nombre} onChange={(e) => setNombre(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="t-tipo">Tipo de trabajo</Label>
              <Select id="t-tipo" className="mt-1.5" value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
                <option value="">Cualquier tipo</option>
                {(tipos.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Si eliges uno, la plantilla solo podrá aplicarse a trabajos de ese tipo.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="t-desc">Descripción</Label>
              <Textarea
                id="t-desc" rows={2} className="mt-1.5"
                value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" loading={crear.isPending} disabled={nombre.trim().length < 3}>
                <Plus /> Crear plantilla
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Todavía no hay plantillas"
          description="Crea una arriba y añádele las tareas del plan típico de ese tipo de trabajo."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((p) => (
            <Card key={p.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                <button
                  type="button"
                  className="flex min-w-0 items-start gap-2 text-left"
                  onClick={() => setAbierta((v) => (v === p.id ? null : p.id))}
                  aria-expanded={abierta === p.id}
                >
                  {abierta === p.id
                    ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{p.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{p.tasks.length} tarea(s)</span>
                      <ToneBadge tone="slate">
                        {p.work_type ? p.work_type.short_name : 'cualquier tipo'}
                      </ToneBadge>
                      {!p.is_active && <ToneBadge tone="amber">desactivada</ToneBadge>}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => alternar.mutate({ id: p.id, activa: !p.is_active })}
                  >
                    {p.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button
                    size="icon" variant="ghost" className="size-8 text-destructive"
                    onClick={() => borrar.mutate(p.id)}
                    aria-label={`Borrar la plantilla ${p.name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardHeader>

              {abierta === p.id && (
                <CardContent className="pt-0">
                  {p.description && (
                    <p className="mb-3 text-sm text-muted-foreground">{p.description}</p>
                  )}
                  <TemplateTasks template={p} onChanged={invalidate} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateTasks({
  template, onChanged,
}: {
  template: TemplateWithTasks
  onChanged: () => void
}) {
  const toast = useToast()
  const [titulo, setTitulo] = React.useState('')
  const [desplazamiento, setDesplazamiento] = React.useState('0')
  const [duracion, setDuracion] = React.useState('7')
  const [prioridad, setPrioridad] = React.useState<TaskPriority>('MEDIA')
  const [esSub, setEsSub] = React.useState(false)

  const ultimaPrincipal = [...template.tasks]
    .reverse()
    .find((t) => t.parent_index === null)

  const anadir = useMutation({
    mutationFn: () =>
      templatesRepo.addTask({
        template_id: template.id,
        title: titulo.trim(),
        offset_days: Number(desplazamiento) || 0,
        duration_days: Math.max(Number(duracion) || 0, 0),
        priority: prioridad,
        order_index: template.tasks.length,
        // Se resuelve aquí el índice del padre: la casilla dice «subapartado
        // del anterior» y el número sale de la última tarea de primer nivel.
        parent_index: esSub && ultimaPrincipal ? ultimaPrincipal.order_index : null,
      }),
    onSuccess: () => {
      onChanged()
      setTitulo(''); setEsSub(false)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const quitar = useMutation({
    mutationFn: (id: string) => templatesRepo.removeTask(id),
    onSuccess: onChanged,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  return (
    <div className="space-y-3">
      {template.tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin tareas. Una plantilla vacía no se puede aplicar.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {template.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 py-1.5">
              <span className={cn('min-w-0 flex-1 truncate', t.parent_index !== null && 'pl-4')}>
                {t.parent_index !== null && <span className="text-muted-foreground" aria-hidden>↳ </span>}
                {t.title}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                día +{t.offset_days} · {t.duration_days} día(s)
              </span>
              <ToneBadge tone={TASK_PRIORITIES.find((p) => p.value === t.priority)?.tone ?? 'slate'}>
                {TASK_PRIORITIES.find((p) => p.value === t.priority)?.label}
              </ToneBadge>
              <Button
                size="icon" variant="ghost" className="size-7"
                onClick={() => quitar.mutate(t.id)}
                aria-label={`Quitar ${t.title}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (titulo.trim().length >= 2) anadir.mutate()
        }}
      >
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor={`tt-${template.id}`}>Tarea</Label>
          <Input
            id={`tt-${template.id}`} className="mt-1.5" placeholder="Revisión bibliográfica"
            value={titulo} onChange={(e) => setTitulo(e.target.value)}
          />
        </div>
        <div className="w-24">
          <Label htmlFor={`off-${template.id}`}>Empieza el día</Label>
          <Input
            id={`off-${template.id}`} type="number" min="0" className="mt-1.5"
            value={desplazamiento} onChange={(e) => setDesplazamiento(e.target.value)}
          />
        </div>
        <div className="w-24">
          <Label htmlFor={`dur-${template.id}`}>Dura (días)</Label>
          <Input
            id={`dur-${template.id}`} type="number" min="0" className="mt-1.5"
            value={duracion} onChange={(e) => setDuracion(e.target.value)}
          />
        </div>
        <div className="w-32">
          <Label htmlFor={`pri-${template.id}`}>Prioridad</Label>
          <Select
            id={`pri-${template.id}`} className="mt-1.5"
            value={prioridad} onChange={(e) => setPrioridad(e.target.value as TaskPriority)}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </div>
        {ultimaPrincipal && (
          <label className="flex items-center gap-1.5 pb-2 text-xs">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={esSub}
              onChange={(e) => setEsSub(e.target.checked)}
            />
            subapartado de «{ultimaPrincipal.title}»
          </label>
        )}
        <Button type="submit" variant="outline" loading={anadir.isPending} disabled={titulo.trim().length < 2}>
          <Plus /> Añadir
        </Button>
      </form>
    </div>
  )
}
