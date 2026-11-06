import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileText, Flag, GraduationCap, Microscope, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/supabase'
import { catalogsRepo } from '@/data/repositories/catalogs.repo'
import { useAcademicLevels } from '@/hooks/use-catalogs'
import { useAuth } from '@/features/auth/auth-context'
import {
  AVISO_CATALOGOS_GLOBALES, WorkRolesCard, WorkStatusesCard,
} from '@/features/admin/statuses-roles-cards'
import { DocumentTypesCard } from '@/features/admin/document-types-card'

/**
 * Catálogos planos de la organización: líneas de investigación, titulaciones y
 * cursos académicos.
 *
 * Los tipos de trabajo tienen su propia pantalla porque llevan reglas
 * (duración, defensa, depósito, número de directores). Estos tres son listas, y
 * se gestionan igual: nombre, activo o retirado, y poco más.
 *
 * RETIRAR Y BORRAR NO SON LO MISMO, Y LA DIFERENCIA IMPORTA.
 *
 * Las tres columnas de `academic_works` que apuntan aquí son `on delete set
 * null`. Borrar una línea **no da error**: deja en blanco la línea de todos los
 * trabajos que la usaban, y no queda rastro de cuál era. En un grupo de
 * investigación eso es perder información histórica sin enterarse, y el plan
 * gratuito de Supabase no tiene copias automáticas (`BACKUP.md`).
 *
 * Por eso lo que se ofrece de primeras es **retirar** (`is_active = false`):
 * desaparece de los formularios de alta y se conserva en los trabajos que ya la
 * tenían. El borrado está disponible, porque el usuario pidió poder borrar,
 * pero dice a cuántos trabajos va a afectar y pide confirmación. Si no afecta a
 * ninguno, es inofensivo y se borra sin ceremonia.
 *
 * Nada de esto es seguridad: las políticas `lines_write`, `programs_write` y
 * `years_write` ya exigen `app.is_org_admin`. Es cuidado del dato.
 */
export function CatalogsPage() {
  const { organizationId } = useAuth()
  const qc = useQueryClient()

  const lineas = useQuery({
    queryKey: qk.catalogs.allResearchLines,
    queryFn: catalogsRepo.listAllResearchLines,
  })
  const programas = useQuery({
    queryKey: qk.catalogs.allPrograms,
    queryFn: catalogsRepo.listAllPrograms,
  })
  const cursos = useQuery({
    queryKey: qk.catalogs.allAcademicYears,
    queryFn: catalogsRepo.listAllAcademicYears,
  })
  const uso = useQuery({ queryKey: qk.catalogs.usage, queryFn: catalogsRepo.catalogUsage })

  // Al tocar un catálogo hay que invalidar también la lista «activa», que es la
  // que alimenta los selectores de alta de trabajos.
  const refrescar = (clave: readonly unknown[], activa: readonly unknown[]) => () => {
    void qc.invalidateQueries({ queryKey: clave })
    void qc.invalidateQueries({ queryKey: activa })
    void qc.invalidateQueries({ queryKey: qk.catalogs.usage })
  }

  if (lineas.isLoading || programas.isLoading || cursos.isLoading) return <LoadingPanel />
  if (lineas.isError) return <ErrorPanel error={lineas.error} />
  if (programas.isError) return <ErrorPanel error={programas.error} />
  if (cursos.isError) return <ErrorPanel error={cursos.error} />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Catálogos"
        description="Líneas de investigación, titulaciones, cursos, estados de los trabajos, roles y tipos de documento."
        breadcrumb={[{ label: 'Administración', to: '/admin' }, { label: 'Catálogos' }]}
      />

      <ResearchLines
        rows={lineas.data ?? []}
        usage={uso.data?.lines ?? {}}
        organizationId={organizationId}
        onChanged={refrescar(qk.catalogs.allResearchLines, qk.catalogs.researchLines)}
      />

      <Programs
        rows={programas.data ?? []}
        usage={uso.data?.programs ?? {}}
        organizationId={organizationId}
        onChanged={refrescar(qk.catalogs.allPrograms, qk.catalogs.programs)}
      />

      <AcademicYears
        rows={cursos.data ?? []}
        usage={uso.data?.years ?? {}}
        organizationId={organizationId}
        onChanged={refrescar(qk.catalogs.allAcademicYears, qk.catalogs.academicYears)}
      />

      {/* Estos dos catálogos no son como los tres de arriba: son GLOBALES, sin
          `organization_id`, y los roles llevan dentro el modelo de permisos.
          Viven aquí porque es donde se los busca, y cada tarjeta explica en su
          pie lo que no se puede cambiar y por qué. Ver migración 0020. */}
      <SectionCard
        title="Estados de los trabajos"
        icon={<Flag className="size-4 text-muted-foreground" />}
        hint={`El ciclo de vida: de «Propuesta» a «Finalizado». ${AVISO_CATALOGOS_GLOBALES}`}
      >
        <WorkStatusesCard />
      </SectionCard>

      <SectionCard
        title="Roles académicos"
        icon={<Users className="size-4 text-muted-foreground" />}
        hint={`Cómo participa cada persona en un trabajo. ${AVISO_CATALOGOS_GLOBALES}`}
      >
        <WorkRolesCard />
      </SectionCard>

      <SectionCard
        title="Tipos de documento"
        icon={<FileText className="size-4 text-muted-foreground" />}
        hint="Qué clases de entregable existen. Los que trae el catálogo son comunes a todo el grupo; los que se añadan aquí, propios."
      >
        <DocumentTypesCard />
      </SectionCard>
    </div>
  )
}

/**
 * Botones comunes de una fila de catálogo.
 *
 * `onToggle` y `onEdit` son opcionales, y el botón correspondiente NO se pinta
 * si no se pasan. Un curso académico, por ejemplo, no se «retira» (no tiene
 * `is_active`) ni se edita en línea: se define por sus fechas, y si están mal
 * lo que procede es borrarlo y crearlo. Un botón que solo sirve para avisar de
 * que no hace nada es peor que no tenerlo.
 */
function RowActions({
  activa, enUso, nombre, onToggle, onEdit, onDelete, pendiente,
}: {
  activa: boolean
  enUso: number
  nombre: string
  onToggle?: () => void
  onEdit?: () => void
  onDelete: () => void
  pendiente: boolean
}) {
  const [confirmando, setConfirmando] = React.useState(false)

  if (confirmando) {
    return (
      <span className="flex flex-wrap items-center justify-end gap-2 text-xs">
        <span className="text-muted-foreground">
          {enUso > 0
            ? `Se quedarán sin este dato ${enUso} trabajo(s), y no se podrá recuperar cuál era.`
            : 'No lo usa ningún trabajo.'}
        </span>
        <Button size="sm" variant="destructive" loading={pendiente} onClick={onDelete}>
          Borrar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)}>No</Button>
      </span>
    )
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      {onToggle && (
        <Button size="sm" variant="ghost" onClick={onToggle} disabled={pendiente}>
          {activa ? 'Retirar' : 'Reactivar'}
        </Button>
      )}
      {onEdit && (
        <Button size="icon" variant="ghost" className="size-7" onClick={onEdit} aria-label={`Editar ${nombre}`}>
          <Pencil className="size-3.5" />
        </Button>
      )}
      <Button
        size="icon" variant="ghost" className="size-7 text-destructive"
        onClick={() => setConfirmando(true)} aria-label={`Borrar ${nombre}`}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </span>
  )
}

export function SectionCard({
  title, icon, hint, children,
}: {
  title: string
  icon: React.ReactNode
  hint: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">{icon} {title}</CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">{children}</CardContent>
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Líneas de investigación
// -----------------------------------------------------------------------------
function ResearchLines({
  rows, usage, organizationId, onChanged,
}: {
  rows: { id: string; name: string; description: string | null; is_active: boolean }[]
  usage: Record<string, number>
  organizationId: string | null
  onChanged: () => void
}) {
  const toast = useToast()
  const [nombre, setNombre] = React.useState('')
  const [descripcion, setDescripcion] = React.useState('')
  const [editando, setEditando] = React.useState<string | null>(null)
  const [borrador, setBorrador] = React.useState({ name: '', description: '' })

  const fallo = (e: unknown) => toast.push('error', errorMessage(e))

  const crear = useMutation({
    mutationFn: () =>
      catalogsRepo.createResearchLine({
        organization_id: organizationId!,
        name: nombre.trim(),
        description: descripcion.trim() || null,
      }),
    onSuccess: () => { onChanged(); setNombre(''); setDescripcion('') },
    onError: fallo,
  })

  const guardar = useMutation({
    mutationFn: (id: string) =>
      catalogsRepo.updateResearchLine(id, {
        name: borrador.name.trim(),
        description: borrador.description.trim() || null,
      }),
    onSuccess: () => { onChanged(); setEditando(null) },
    onError: fallo,
  })

  const alternar = useMutation({
    mutationFn: ({ id, activa }: { id: string; activa: boolean }) =>
      catalogsRepo.updateResearchLine(id, { is_active: activa }),
    onSuccess: onChanged,
    onError: fallo,
  })

  const borrar = useMutation({
    mutationFn: (id: string) => catalogsRepo.removeResearchLine(id),
    onSuccess: () => { onChanged(); toast.push('success', 'Línea borrada.') },
    onError: fallo,
  })

  return (
    <SectionCard
      title="Líneas de investigación"
      icon={<Microscope className="size-4 text-muted-foreground" />}
      hint="Retirar una línea la quita de los formularios y la conserva en los trabajos que ya la tenían. Borrarla la elimina también de ellos."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ninguna línea.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              {editando === l.id ? (
                <form
                  className="flex w-full flex-wrap items-start gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (borrador.name.trim().length >= 2) guardar.mutate(l.id)
                  }}
                >
                  <Input
                    value={borrador.name}
                    onChange={(e) => setBorrador((b) => ({ ...b, name: e.target.value }))}
                    aria-label="Nombre de la línea"
                    className="min-w-[12rem] flex-1"
                    autoFocus
                  />
                  <Input
                    value={borrador.description}
                    onChange={(e) => setBorrador((b) => ({ ...b, description: e.target.value }))}
                    placeholder="Descripción (opcional)"
                    aria-label="Descripción"
                    className="min-w-[12rem] flex-1"
                  />
                  <Button type="submit" size="sm" loading={guardar.isPending}>
                    <Check /> Guardar
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(null)}>
                    <X /> Cancelar
                  </Button>
                </form>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className={cn('text-sm', !l.is_active && 'text-muted-foreground')}>
                      {l.name}
                      {!l.is_active && <ToneBadge tone="amber" className="ml-2">retirada</ToneBadge>}
                      {(usage[l.id] ?? 0) > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {usage[l.id]} trabajo(s)
                        </span>
                      )}
                    </p>
                    {l.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{l.description}</p>
                    )}
                  </div>
                  <RowActions
                    activa={l.is_active}
                    enUso={usage[l.id] ?? 0}
                    nombre={l.name}
                    pendiente={borrar.isPending || alternar.isPending}
                    onToggle={() => alternar.mutate({ id: l.id, activa: !l.is_active })}
                    onEdit={() => {
                      setEditando(l.id)
                      setBorrador({ name: l.name, description: l.description ?? '' })
                    }}
                    onDelete={() => borrar.mutate(l.id)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (nombre.trim().length >= 2 && organizationId) crear.mutate()
        }}
      >
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="linea-nombre">Nueva línea</Label>
          <Input
            id="linea-nombre" className="mt-1.5" placeholder="Análisis de señales biomédicas"
            value={nombre} onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="linea-desc">Descripción</Label>
          <Textarea
            id="linea-desc" rows={1} className="mt-1.5"
            value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" loading={crear.isPending} disabled={nombre.trim().length < 2}>
          <Plus /> Añadir
        </Button>
      </form>
    </SectionCard>
  )
}

// -----------------------------------------------------------------------------
// Titulaciones y programas de doctorado
// -----------------------------------------------------------------------------
function Programs({
  rows, usage, organizationId, onChanged,
}: {
  rows: { id: string; code: string; name: string; academic_level: string | null; is_active: boolean }[]
  usage: Record<string, number>
  organizationId: string | null
  onChanged: () => void
}) {
  const toast = useToast()
  const niveles = useAcademicLevels()
  const [codigo, setCodigo] = React.useState('')
  const [nombre, setNombre] = React.useState('')
  const [nivel, setNivel] = React.useState('')
  const [editando, setEditando] = React.useState<string | null>(null)
  const [borrador, setBorrador] = React.useState({ code: '', name: '' })

  const fallo = (e: unknown) => toast.push('error', errorMessage(e))

  const crear = useMutation({
    mutationFn: () =>
      catalogsRepo.createProgram({
        organization_id: organizationId!,
        code: codigo.trim(),
        name: nombre.trim(),
        academic_level: nivel || null,
      }),
    onSuccess: () => { onChanged(); setCodigo(''); setNombre(''); setNivel('') },
    onError: fallo,
  })

  const guardar = useMutation({
    mutationFn: (id: string) =>
      catalogsRepo.updateProgram(id, { code: borrador.code.trim(), name: borrador.name.trim() }),
    onSuccess: () => { onChanged(); setEditando(null) },
    onError: fallo,
  })

  const alternar = useMutation({
    mutationFn: ({ id, activa }: { id: string; activa: boolean }) =>
      catalogsRepo.updateProgram(id, { is_active: activa }),
    onSuccess: onChanged,
    onError: fallo,
  })

  const borrar = useMutation({
    mutationFn: (id: string) => catalogsRepo.removeProgram(id),
    onSuccess: () => { onChanged(); toast.push('success', 'Titulación borrada.') },
    onError: fallo,
  })

  return (
    <SectionCard
      title="Titulaciones y programas"
      icon={<GraduationCap className="size-4 text-muted-foreground" />}
      hint="Grados, másteres y programas de doctorado. Hay tipos de trabajo que no cuelgan de ninguna titulación, así que el campo es opcional en el trabajo."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ninguna titulación.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              {editando === p.id ? (
                <form
                  className="flex w-full flex-wrap items-start gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (borrador.name.trim().length >= 2 && borrador.code.trim()) guardar.mutate(p.id)
                  }}
                >
                  <Input
                    value={borrador.code}
                    onChange={(e) => setBorrador((b) => ({ ...b, code: e.target.value }))}
                    aria-label="Código" className="w-28" autoFocus
                  />
                  <Input
                    value={borrador.name}
                    onChange={(e) => setBorrador((b) => ({ ...b, name: e.target.value }))}
                    aria-label="Nombre" className="min-w-[12rem] flex-1"
                  />
                  <Button type="submit" size="sm" loading={guardar.isPending}><Check /> Guardar</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(null)}>
                    <X /> Cancelar
                  </Button>
                </form>
              ) : (
                <>
                  <div className="min-w-0">
                    <p className={cn('text-sm', !p.is_active && 'text-muted-foreground')}>
                      <span className="font-mono text-xs text-muted-foreground">{p.code}</span>{' '}
                      {p.name}
                      {!p.is_active && <ToneBadge tone="amber" className="ml-2">retirada</ToneBadge>}
                      {(usage[p.id] ?? 0) > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {usage[p.id]} trabajo(s)
                        </span>
                      )}
                    </p>
                    {p.academic_level && (
                      <p className="mt-0.5 text-xs text-muted-foreground">Nivel: {p.academic_level}</p>
                    )}
                  </div>
                  <RowActions
                    activa={p.is_active}
                    enUso={usage[p.id] ?? 0}
                    nombre={p.name}
                    pendiente={borrar.isPending || alternar.isPending}
                    onToggle={() => alternar.mutate({ id: p.id, activa: !p.is_active })}
                    onEdit={() => { setEditando(p.id); setBorrador({ code: p.code, name: p.name }) }}
                    onDelete={() => borrar.mutate(p.id)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (nombre.trim().length >= 2 && codigo.trim() && organizationId) crear.mutate()
        }}
      >
        <div className="w-28">
          <Label htmlFor="prog-codigo">Código</Label>
          <Input
            id="prog-codigo" className="mt-1.5" placeholder="GIB"
            value={codigo} onChange={(e) => setCodigo(e.target.value)}
          />
        </div>
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="prog-nombre">Nombre</Label>
          <Input
            id="prog-nombre" className="mt-1.5" placeholder="Grado en Ingeniería Biomédica"
            value={nombre} onChange={(e) => setNombre(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Label htmlFor="prog-nivel">Nivel</Label>
          <Select id="prog-nivel" className="mt-1.5" value={nivel} onChange={(e) => setNivel(e.target.value)}>
            <option value="">Sin especificar</option>
            {(niveles.data ?? []).map((n) => (
              <option key={n.code} value={n.code}>{n.name}</option>
            ))}
          </Select>
        </div>
        <Button
          type="submit" variant="outline" loading={crear.isPending}
          disabled={nombre.trim().length < 2 || !codigo.trim()}
        >
          <Plus /> Añadir
        </Button>
      </form>
    </SectionCard>
  )
}

// -----------------------------------------------------------------------------
// Cursos académicos
// -----------------------------------------------------------------------------
function AcademicYears({
  rows, usage, organizationId, onChanged,
}: {
  rows: { id: string; code: string; start_date: string; end_date: string; is_current: boolean }[]
  usage: Record<string, number>
  organizationId: string | null
  onChanged: () => void
}) {
  const toast = useToast()
  const [codigo, setCodigo] = React.useState('')
  const [inicio, setInicio] = React.useState('')
  const [fin, setFin] = React.useState('')

  const fallo = (e: unknown) => toast.push('error', errorMessage(e))

  const crear = useMutation({
    mutationFn: () =>
      catalogsRepo.createAcademicYear({
        organization_id: organizationId!,
        code: codigo.trim(),
        start_date: inicio,
        end_date: fin,
      }),
    onSuccess: () => { onChanged(); setCodigo(''); setInicio(''); setFin('') },
    onError: fallo,
  })

  /**
   * Marcar el curso actual.
   *
   * Hay un índice único parcial —`academic_years_one_current`— que impide dos
   * cursos actuales a la vez en la misma organización, así que primero se
   * desmarca el que lo estuviera. Son dos sentencias y no una transacción: si
   * la segunda fallara, quedarían cero cursos actuales, que es un estado
   * recuperable con un clic. Al revés —marcar antes de desmarcar— la propia
   * base de datos rechazaría la operación por el índice.
   */
  const marcarActual = useMutation({
    mutationFn: async (id: string) => {
      const actual = rows.find((y) => y.is_current && y.id !== id)
      if (actual) await catalogsRepo.updateAcademicYear(actual.id, { is_current: false })
      return catalogsRepo.updateAcademicYear(id, { is_current: true })
    },
    onSuccess: onChanged,
    onError: fallo,
  })

  const borrar = useMutation({
    mutationFn: (id: string) => catalogsRepo.removeAcademicYear(id),
    onSuccess: () => { onChanged(); toast.push('success', 'Curso borrado.') },
    onError: fallo,
  })

  return (
    <SectionCard
      title="Cursos académicos"
      icon={<Check className="size-4 text-muted-foreground" />}
      hint="Solo puede haber un curso marcado como actual; al marcar uno se desmarca el anterior. Un curso se define por sus fechas: si están mal, bórralo y créalo de nuevo."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay ningún curso.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((y) => (
            <li key={y.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <p className="text-sm">
                {y.code}
                {y.is_current && <ToneBadge tone="green" className="ml-2">actual</ToneBadge>}
                {(usage[y.id] ?? 0) > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">{usage[y.id]} trabajo(s)</span>
                )}
                <span className="ml-2 text-xs text-muted-foreground">
                  {y.start_date} → {y.end_date}
                </span>
              </p>
              <span className="flex items-center gap-1">
                {!y.is_current && (
                  <Button
                    size="sm" variant="ghost"
                    loading={marcarActual.isPending}
                    onClick={() => marcarActual.mutate(y.id)}
                  >
                    Marcar actual
                  </Button>
                )}
                <RowActions
                  activa
                  enUso={usage[y.id] ?? 0}
                  nombre={y.code}
                  pendiente={borrar.isPending}
                  onDelete={() => borrar.mutate(y.id)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (codigo.trim() && inicio && fin && organizationId) crear.mutate()
        }}
      >
        <div className="w-32">
          <Label htmlFor="curso-codigo">Curso</Label>
          <Input
            id="curso-codigo" className="mt-1.5" placeholder="2026/2027"
            value={codigo} onChange={(e) => setCodigo(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Label htmlFor="curso-inicio">Empieza</Label>
          <Input id="curso-inicio" type="date" className="mt-1.5" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div className="w-40">
          <Label htmlFor="curso-fin">Acaba</Label>
          <Input id="curso-fin" type="date" className="mt-1.5" value={fin} onChange={(e) => setFin(e.target.value)} />
        </div>
        <Button
          type="submit" variant="outline" loading={crear.isPending}
          disabled={!codigo.trim() || !inicio || !fin}
        >
          <Plus /> Añadir
        </Button>
      </form>
    </SectionCard>
  )
}
