import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, FileText, ListChecks, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ToneBadge } from '@/components/ui/badge'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/supabase'
import { templatesRepo, type TemplateWithTasks } from '@/data/repositories/templates.repo'
import { TASK_PRIORITIES } from '@/data/repositories/tasks.repo'
import { useWorkRoles, useWorkTypes } from '@/hooks/use-catalogs'
import { useAuth } from '@/features/auth/auth-context'
import { TemplateFilesCard } from '@/features/admin/template-files-card'
import { TemplateDocumentsCard } from '@/features/admin/template-documents-card'
import type { TaskPriority, TemplateTaskRow } from '@/data/types/database'

/**
 * Plantillas de plan de trabajo.
 *
 * Es lo que convierte «teclear veinte tareas cada vez que empieza un TFG» en un
 * clic. Las fechas de la plantilla son RELATIVAS (`offset_days` desde el día
 * cero, `duration_days` de duración), de modo que la misma plantilla sirva para
 * un trabajo que empieza en octubre y para otro que empieza en febrero.
 *
 * UNA PLANTILLA GUARDA LA TAREA COMPLETA, no solo su título: en qué consiste,
 * quién la hace —por función, que es lo único que se puede saber de antemano— y
 * con qué material. Sin eso, aplicar la plantilla dejaba veinte títulos vacíos
 * que había que rellenar a mano en cada trabajo.
 *
 * LA JERARQUÍA SE ELIGE POR TÍTULO, NO POR NÚMERO. En la base de datos,
 * `template_tasks.parent_index` apunta al `order_index` del padre dentro de la
 * plantilla; pedir ese número en un formulario sería pedirle al usuario que
 * lleve la contabilidad de los índices, y un número mal puesto produce una
 * plantilla que falla al aplicarse entera (prueba `[87]`). Aquí se elige la
 * tarea por su título y solo entre las ANTERIORES, que es la condición que
 * `app.apply_template` necesita para resolver la jerarquía.
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
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
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
                      {p.files.length > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="size-3" /> {p.files.length}
                        </span>
                      )}
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
                  <TemplateBody template={p} onChanged={invalidate} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Contenido de una plantilla: su material general y sus tareas.
 *
 * La lista de tareas no es editable en línea a propósito. Antes el formulario
 * era una tira de campos al pie de la lista, y con ella no se podía escribir en
 * qué consiste la tarea, decir quién la hace ni adjuntar nada: salían veinte
 * títulos vacíos que había que rellenar a mano en cada trabajo, o sea la mitad
 * del trabajo que la plantilla venía a ahorrar. Ahora cada tarea se abre en su
 * propia ficha, con sitio para todo.
 */
function TemplateBody({
  template, onChanged,
}: {
  template: TemplateWithTasks
  onChanged: () => void
}) {
  const toast = useToast()
  const roles = useWorkRoles()
  const [creando, setCreando] = React.useState(false)
  // Se guarda el IDENTIFICADOR, no la fila: tras cada cambio la plantilla se
  // vuelve a cargar y una copia de la fila quedaría obsoleta (el material
  // adjunto, en particular, dejaría de aparecer al añadirlo).
  const [editandoId, setEditandoId] = React.useState<string | null>(null)

  const editando = template.tasks.find((t) => t.id === editandoId) ?? null
  const general = template.files.filter((f) => f.template_task_id === null)
  const materialDe = (id: string) => template.files.filter((f) => f.template_task_id === id)
  const hijosDe = (t: TemplateTaskRow) =>
    template.tasks.filter((h) => h.parent_index === t.order_index)

  const quitar = useMutation({
    mutationFn: (id: string) => templatesRepo.removeTask(id),
    onSuccess: () => { onChanged(); toast.push('success', 'Tarea quitada de la plantilla.') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  return (
    <div className="space-y-4">
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Paperclip className="size-3.5" /> Material general de la plantilla
        </h4>
        <TemplateFilesCard
          templateId={template.id}
          templateTaskId={null}
          files={general}
          onChanged={onChanged}
        />
      </section>

      {/* Entregables ANTES de las tareas: es la lista corta y la que se decide
          primero («esto hay que entregar»); las tareas son el camino para
          llegar a ella. */}
      <section className="border-t pt-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <FileText className="size-3.5" /> Documentos previstos
        </h4>
        <TemplateDocumentsCard
          templateId={template.id}
          documents={template.documents}
          onChanged={onChanged}
        />
      </section>

      <section className="border-t pt-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <ListChecks className="size-3.5" /> Tareas del plan
        </h4>

        {template.tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin tareas. Una plantilla vacía no se puede aplicar.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {template.tasks.map((t) => {
              const rol = (roles.data ?? []).find((r) => r.id === t.assignee_role_id)
              const adjuntos = materialDe(t.id).length
              const prioridad = TASK_PRIORITIES.find((p) => p.value === t.priority)
              return (
                <li key={t.id} className="flex items-start gap-2 py-2">
                  <div className={cn('min-w-0 flex-1', t.parent_index !== null && 'pl-5')}>
                    <p className="truncate font-medium">
                      {t.parent_index !== null && <span className="text-muted-foreground" aria-hidden>↳ </span>}
                      {t.title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>día +{t.offset_days} · {t.duration_days} día(s)</span>
                      {prioridad && <ToneBadge tone={prioridad.tone}>{prioridad.label}</ToneBadge>}
                      {rol && <span>responsable: {rol.name}</span>}
                      {adjuntos > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="size-3" /> {adjuntos}
                        </span>
                      )}
                      {t.description && <span className="italic">con descripción</span>}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditandoId(t.id)}>
                    <Pencil className="size-3.5" /> Editar
                  </Button>
                  <Button
                    size="icon" variant="ghost" className="size-8 text-destructive"
                    aria-label={`Quitar ${t.title}`}
                    onClick={() => {
                      // El aviso no es formulario: `tasks.template_task_id` es
                      // `on delete set null`, así que las tareas YA creadas desde
                      // esta plantilla se quedan sin material y nadie se entera
                      // (prueba [108]).
                      const extra = adjuntos > 0
                        ? ` Su material (${adjuntos}) dejará de estar disponible en los trabajos que ya la usan.`
                        : ''
                      if (confirm(`¿Quitar «${t.title}» de la plantilla?${extra}`)) quitar.mutate(t.id)
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        <Button className="mt-3" size="sm" variant="outline" onClick={() => setCreando(true)}>
          <Plus /> Añadir tarea
        </Button>
      </section>

      <TemplateTaskDialog
        key={editando?.id ?? 'nueva'}
        template={template}
        task={editando}
        open={creando || editando !== null}
        hijos={editando ? hijosDe(editando).length : 0}
        onOpenChange={(v) => { if (!v) { setCreando(false); setEditandoId(null) } }}
        onCreated={(id) => { setCreando(false); setEditandoId(id) }}
        onChanged={onChanged}
      />
    </div>
  )
}

/**
 * Ficha de una tarea de plantilla: todo lo que la tarea real podrá tener.
 *
 * EL RESPONSABLE SE ELIGE POR FUNCIÓN, no por persona: la plantilla sirve para
 * trabajos que todavía no existen. Al aplicarla, `app.apply_template` busca a
 * quien ejerce esa función en ese trabajo —el principal primero— y le asigna la
 * tarea; si nadie la ejerce, la tarea queda sin responsable en lugar de impedir
 * que se cree el plan (pruebas [106] y [107]).
 *
 * EL MATERIAL SOLO APARECE CON LA TAREA YA GUARDADA, porque un adjunto necesita
 * una fila a la que colgarse. Para que eso no obligue a abrir la ficha dos
 * veces, al crear la tarea la ficha se queda abierta sobre la tarea nueva.
 */
function TemplateTaskDialog({
  template, task, hijos, open, onOpenChange, onCreated, onChanged,
}: {
  template: TemplateWithTasks
  /** Nulo = tarea nueva. */
  task: TemplateTaskRow | null
  /** Cuántos subapartados tiene: con hijos no puede volverse hija de otra. */
  hijos: number
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (id: string) => void
  onChanged: () => void
}) {
  const toast = useToast()
  const roles = useWorkRoles()
  const [titulo, setTitulo] = React.useState(task?.title ?? '')
  const [descripcion, setDescripcion] = React.useState(task?.description ?? '')
  const [desplazamiento, setDesplazamiento] = React.useState(String(task?.offset_days ?? 0))
  const [duracion, setDuracion] = React.useState(String(task?.duration_days ?? 7))
  const [prioridad, setPrioridad] = React.useState<TaskPriority>(task?.priority ?? 'MEDIA')
  const [rolId, setRolId] = React.useState(task?.assignee_role_id ?? '')
  const [padre, setPadre] = React.useState(
    task?.parent_index === null || task?.parent_index === undefined ? '' : String(task.parent_index),
  )

  /**
   * Candidatas a contener esta tarea: las de primer nivel que van ANTES. El
   * orden importa de verdad: `app.apply_template` recorre la plantilla por
   * `order_index` y necesita que el padre ya esté creado, así que una tarea que
   * apuntara hacia adelante haría fallar la aplicación entera (prueba [87]).
   * No se ofrece lo que no se puede elegir.
   */
  const posicion = task?.order_index ?? template.tasks.length
  const candidatas = template.tasks.filter(
    (t) => t.parent_index === null && t.order_index < posicion && t.id !== task?.id,
  )

  const guardar = useMutation({
    mutationFn: async () => {
      const campos = {
        title: titulo.trim(),
        description: descripcion.trim() || null,
        offset_days: Number(desplazamiento) || 0,
        duration_days: Math.max(Number(duracion) || 0, 0),
        priority: prioridad,
        assignee_role_id: rolId || null,
        parent_index: padre === '' ? null : Number(padre),
      }
      if (task) {
        await templatesRepo.updateTask(task.id, campos)
        return task.id
      }
      const creada = await templatesRepo.addTask({
        ...campos,
        template_id: template.id,
        order_index: template.tasks.length,
      })
      return creada.id
    },
    onSuccess: (id) => {
      onChanged()
      if (task) {
        toast.push('success', 'Tarea de la plantilla guardada.')
      } else {
        toast.push('success', 'Tarea creada. Ya puedes adjuntarle material.')
        onCreated(id)
      }
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const material = task ? template.files.filter((f) => f.template_task_id === task.id) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{task ? 'Tarea de la plantilla' : 'Nueva tarea de la plantilla'}</DialogTitle>
          <DialogDescription>
            Las fechas son relativas al inicio de cada trabajo, de modo que la misma
            plantilla sirva para uno que empieza en octubre y otro en febrero.
          </DialogDescription>
        </DialogHeader>

        <form
          id="ficha-tarea-plantilla"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (titulo.trim().length >= 2) guardar.mutate()
          }}
        >
          <div className="sm:col-span-2">
            <Label htmlFor="tp-titulo">Tarea</Label>
            <Input
              id="tp-titulo" className="mt-1.5" placeholder="Revisión de la memoria"
              value={titulo} onChange={(e) => setTitulo(e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="tp-desc">En qué consiste</Label>
            <Textarea
              id="tp-desc" rows={3} className="mt-1.5"
              placeholder="Leer la memoria completa y rellenar la rúbrica adjunta."
              value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Esto aparece en la ficha de la tarea de cada trabajo. Es lo que evita
              tener que explicarlo una vez por estudiante.
            </p>
          </div>

          <div>
            <Label htmlFor="tp-off">Empieza el día</Label>
            <Input
              id="tp-off" type="number" min="0" className="mt-1.5"
              value={desplazamiento} onChange={(e) => setDesplazamiento(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="tp-dur">Dura (días)</Label>
            <Input
              id="tp-dur" type="number" min="0" className="mt-1.5"
              value={duracion} onChange={(e) => setDuracion(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="tp-pri">Prioridad</Label>
            <Select
              id="tp-pri" className="mt-1.5"
              value={prioridad} onChange={(e) => setPrioridad(e.target.value as TaskPriority)}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="tp-rol">Quién la hace</Label>
            <Select id="tp-rol" className="mt-1.5" value={rolId} onChange={(e) => setRolId(e.target.value)}>
              <option value="">Sin responsable fijo</option>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Por función, no por persona: al aplicar la plantilla se asigna a quien
              la ejerza en ese trabajo.
            </p>
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="tp-padre">Subapartado de</Label>
            {hijos > 0 ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                Esta tarea tiene {hijos} subapartado(s), así que no puede ser a su vez
                subapartado de otra.
              </p>
            ) : candidatas.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                No hay ninguna tarea anterior de la que pueda depender.
              </p>
            ) : (
              <>
                <Select id="tp-padre" className="mt-1.5" value={padre} onChange={(e) => setPadre(e.target.value)}>
                  <option value="">Tarea independiente</option>
                  {candidatas.map((c) => (
                    <option key={c.id} value={String(c.order_index)}>{c.title}</option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Los subapartados se convierten en la lista de comprobación de la
                  tarea que los contiene.
                </p>
              </>
            )}
          </div>
        </form>

        <section className="border-t pt-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Paperclip className="size-3.5" /> Material de esta tarea
          </h4>
          {task ? (
            <TemplateFilesCard
              templateId={template.id}
              templateTaskId={task.id}
              files={material}
              onChanged={onChanged}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Guarda la tarea y podrás adjuntarle el guion, la rúbrica o el formato
              que deba usar todo el mundo.
            </p>
          )}
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {task ? 'Cerrar' : 'Cancelar'}
          </Button>
          <Button
            type="submit" form="ficha-tarea-plantilla"
            loading={guardar.isPending} disabled={titulo.trim().length < 2}
          >
            {task ? 'Guardar cambios' : 'Crear tarea'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
