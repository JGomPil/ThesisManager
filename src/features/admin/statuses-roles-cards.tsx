import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ToneBadge } from '@/components/ui/badge'
import { ErrorPanel, Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { catalogsRepo } from '@/data/repositories/catalogs.repo'
import type { WorkRoleRow, WorkStatusRow } from '@/data/types/database'
import { FilaCatalogo } from '@/features/admin/catalog-row'

/**
 * Estados de un trabajo y roles académicos: administrarlos sin una migración.
 *
 * POR QUÉ EXISTEN ESTAS DOS TARJETAS
 * Cambiar «Director principal» por «Director» hubo que hacerlo con la migración
 * 0018: un portátil con Docker, un fichero y un despliegue para corregir una
 * palabra. Desproporcionado para un nombre.
 *
 * LO QUE AQUÍ NO SE PUEDE TOCAR, Y NO ES UN DESCUIDO
 *
 *  · El CÓDIGO de un estado. El cronograma colorea por código y el dominio casa
 *    por código: renombrarlo rompe pantallas sin dar ningún error. Se escribe al
 *    crear y después es inmutable (disparador `work_statuses_code_inmutable`).
 *
 *  · Las CAPACIDADES de un rol —can_manage_plan, can_see_private_notes,
 *    can_validate_deliverables, can_manage_members—. Las lee
 *    `app.has_work_capability`, que es lo que invocan las políticas de RLS de
 *    tareas, hitos, documentos, reuniones y perfiles. O sea: son el modelo de
 *    permisos. Un interruptor aquí sería un interruptor que edita la seguridad
 *    en caliente, y marcar «ve notas privadas» en el rol «Estudiante»
 *    publicaría, en ese instante y en todos los trabajos, lo que la dirección
 *    escribió creyéndolo privado. Sin aviso: la siguiente consulta devolvería
 *    más filas.
 *
 * Y no se queda en no pintar los interruptores, que no protegería de nada:
 * quien tenga sesión puede llamar a PostgREST directamente. Lo impiden las
 * políticas y los disparadores de la migración 0020, con las pruebas [143]–[149].
 *
 * UNA LIMITACIÓN QUE SE DICE EN PANTALLA: estos dos catálogos son globales, sin
 * `organization_id`. Sus nombres los comparten todas las organizaciones. Hoy hay
 * una —el grupo—, y por eso es aceptable.
 */

/** Los tonos que de verdad existen en `globals.css`; ofrecer otro no pinta nada. */
const TONOS = [
  'slate', 'sky', 'cyan', 'blue', 'violet', 'teal',
  'emerald', 'green', 'amber', 'orange', 'pink', 'red',
] as const

/** Código a partir del nombre: mayúsculas, sin tildes y con guiones bajos. */
function codigoDesde(nombre: string): string {
  return nombre
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
    .slice(0, 40)
}

// -----------------------------------------------------------------------------
// Estados del trabajo
// -----------------------------------------------------------------------------
export function WorkStatusesCard() {
  const qc = useQueryClient()
  const toast = useToast()
  const [editando, setEditando] = React.useState<WorkStatusRow | null>(null)
  const [nombre, setNombre] = React.useState('')
  const [color, setColor] = React.useState<string>('slate')
  const [orden, setOrden] = React.useState('')
  const [terminal, setTerminal] = React.useState(false)
  const campoNombre = React.useRef<HTMLInputElement>(null)

  const estados = useQuery({ queryKey: qk.catalogs.allWorkStatuses, queryFn: catalogsRepo.listAllWorkStatuses })
  const uso = useQuery({ queryKey: qk.catalogs.statusRoleUsage, queryFn: catalogsRepo.statusRoleUsage })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.catalogs.allWorkStatuses })
    void qc.invalidateQueries({ queryKey: qk.catalogs.workStatuses })
    void qc.invalidateQueries({ queryKey: qk.catalogs.statusRoleUsage })
  }

  const limpiar = () => {
    setEditando(null); setNombre(''); setColor('slate'); setOrden(''); setTerminal(false)
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const campos = {
        name: nombre.trim(),
        color,
        display_order: orden === '' ? 0 : Number(orden),
        is_terminal: terminal,
      }
      if (editando) return catalogsRepo.updateWorkStatus(editando.id, campos)
      return catalogsRepo.createWorkStatus({ ...campos, code: codigoDesde(nombre) })
    },
    onSuccess: () => { invalidate(); limpiar() },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const retirar = useMutation({
    mutationFn: (s: WorkStatusRow) => catalogsRepo.updateWorkStatus(s.id, { is_active: !s.is_active }),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const borrar = useMutation({
    mutationFn: (id: string) => catalogsRepo.removeWorkStatus(id),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const empezar = (s: WorkStatusRow) => {
    setEditando(s); setNombre(s.name); setColor(s.color)
    setOrden(String(s.display_order)); setTerminal(s.is_terminal)
    campoNombre.current?.focus()
  }

  const filas = estados.data ?? []
  const cuenta = uso.data?.statuses ?? {}

  return (
    <div className="space-y-3">
      {estados.isLoading ? <Spinner /> : estados.isError ? <ErrorPanel error={estados.error} /> : (
        <ul className="space-y-1.5">
          {filas.map((s) => (
            <FilaCatalogo
              key={s.id}
              nombre={s.name}
              codigo={s.code}
              retirado={!s.is_active}
              enUso={cuenta[s.id] ?? 0}
              badges={
                <>
                  <ToneBadge tone={s.color}>{s.color}</ToneBadge>
                  {s.is_terminal && <ToneBadge tone="green">final</ToneBadge>}
                </>
              }
              onEditar={() => empezar(s)}
              onRetirar={() => retirar.mutate(s)}
              onBorrar={() => borrar.mutate(s.id)}
            />
          ))}
        </ul>
      )}

      <form
        className="space-y-2 border-t pt-3"
        onSubmit={(e) => { e.preventDefault(); if (nombre.trim().length >= 2) guardar.mutate() }}
      >
        <p className="text-xs text-muted-foreground">
          {editando
            ? `Editando «${editando.name}». Su código (${editando.code}) no se puede cambiar: el cronograma y los informes casan por código.`
            : `Nuevo estado. Su código se genera del nombre${nombre.trim() ? ` (${codigoDesde(nombre)})` : ''} y después ya no se puede cambiar.`}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1 space-y-1">
            <Label htmlFor="estado-nombre">Nombre</Label>
            <Input id="estado-nombre" ref={campoNombre} value={nombre}
              onChange={(e) => setNombre(e.target.value)} placeholder="Pendiente de depósito" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="estado-color">Color</Label>
            <Select id="estado-color" value={color} onChange={(e) => setColor(e.target.value)} className="w-[8rem]">
              {TONOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="estado-orden">Orden</Label>
            <Input id="estado-orden" type="number" value={orden}
              onChange={(e) => setOrden(e.target.value)} className="w-[5.5rem]" />
          </div>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <input type="checkbox" className="size-4 rounded border-input"
              checked={terminal} onChange={(e) => setTerminal(e.target.checked)} />
            Estado final
          </label>
          {editando && (
            <Button type="button" size="sm" variant="ghost" onClick={limpiar}>
              <X /> Cancelar
            </Button>
          )}
          <Button type="submit" size="sm" variant="outline"
            loading={guardar.isPending} disabled={nombre.trim().length < 2}>
            {editando ? <><Check /> Guardar</> : <><Plus /> Añadir</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          «Estado final» significa que un trabajo en ese estado está terminado: deja de contarse
          como activo y no se avisa de que va con retraso.
        </p>
      </form>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Roles académicos
// -----------------------------------------------------------------------------
export function WorkRolesCard() {
  const qc = useQueryClient()
  const toast = useToast()
  const [editando, setEditando] = React.useState<WorkRoleRow | null>(null)
  const [nombre, setNombre] = React.useState('')
  const [orden, setOrden] = React.useState('')
  const [clase, setClase] = React.useState<'NINGUNA' | 'ESTUDIANTE' | 'SUPERVISION'>('NINGUNA')
  const campoNombre = React.useRef<HTMLInputElement>(null)

  const roles = useQuery({ queryKey: qk.catalogs.allWorkRoles, queryFn: catalogsRepo.listAllWorkRoles })
  const uso = useQuery({ queryKey: qk.catalogs.statusRoleUsage, queryFn: catalogsRepo.statusRoleUsage })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.catalogs.allWorkRoles })
    void qc.invalidateQueries({ queryKey: qk.catalogs.workRoles })
    void qc.invalidateQueries({ queryKey: qk.catalogs.statusRoleUsage })
  }

  const limpiar = () => { setEditando(null); setNombre(''); setOrden(''); setClase('NINGUNA') }

  const guardar = useMutation({
    mutationFn: async () => {
      if (editando) {
        return catalogsRepo.updateWorkRole(editando.id, {
          name: nombre.trim(),
          display_order: orden === '' ? 0 : Number(orden),
        })
      }
      return catalogsRepo.createWorkRole({
        code: codigoDesde(nombre),
        name: nombre.trim(),
        display_order: orden === '' ? 0 : Number(orden),
        is_student: clase === 'ESTUDIANTE',
        is_supervisory: clase === 'SUPERVISION',
      })
    },
    onSuccess: () => { invalidate(); limpiar() },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const retirar = useMutation({
    mutationFn: (r: WorkRoleRow) => catalogsRepo.updateWorkRole(r.id, { is_active: !r.is_active }),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const borrar = useMutation({
    mutationFn: (id: string) => catalogsRepo.removeWorkRole(id),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const empezar = (r: WorkRoleRow) => {
    setEditando(r); setNombre(r.name); setOrden(String(r.display_order))
    setClase(r.is_student ? 'ESTUDIANTE' : r.is_supervisory ? 'SUPERVISION' : 'NINGUNA')
    campoNombre.current?.focus()
  }

  const filas = roles.data ?? []
  const cuenta = uso.data?.roles ?? {}

  /** Lo que un rol puede hacer, en palabras. Se LEE, no se edita. */
  const capacidades = (r: WorkRoleRow) => {
    const lista = [
      r.can_manage_plan && 'dirige el plan',
      r.can_see_private_notes && 've notas privadas',
      r.can_validate_deliverables && 'valida entregas',
      r.can_manage_members && 'gestiona participantes',
    ].filter(Boolean) as string[]
    return lista.length === 0 ? 'sin capacidades especiales' : lista.join(', ')
  }

  return (
    <div className="space-y-3">
      {roles.isLoading ? <Spinner /> : roles.isError ? <ErrorPanel error={roles.error} /> : (
        <ul className="space-y-1.5">
          {filas.map((r) => (
            <FilaCatalogo
              key={r.id}
              nombre={r.name}
              codigo={r.code}
              retirado={!r.is_active}
              enUso={cuenta[r.id] ?? 0}
              badges={
                <>
                  {r.is_student && <ToneBadge tone="sky">estudiante</ToneBadge>}
                  {r.is_supervisory && <ToneBadge tone="violet">supervisión</ToneBadge>}
                  <span>· {capacidades(r)}</span>
                </>
              }
              onEditar={() => empezar(r)}
              onRetirar={() => retirar.mutate(r)}
              onBorrar={() => borrar.mutate(r.id)}
            />
          ))}
        </ul>
      )}

      <form
        className="space-y-2 border-t pt-3"
        onSubmit={(e) => { e.preventDefault(); if (nombre.trim().length >= 2) guardar.mutate() }}
      >
        <p className="text-xs text-muted-foreground">
          {editando
            ? `Editando «${editando.name}». Se cambian el nombre y el orden; su código (${editando.code}), su clasificación y sus capacidades, no.`
            : `Nuevo rol. Nace SIN capacidades${nombre.trim() ? ` y con código ${codigoDesde(nombre)}` : ''}.`}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1 space-y-1">
            <Label htmlFor="rol-nombre">Nombre</Label>
            <Input id="rol-nombre" ref={campoNombre} value={nombre}
              onChange={(e) => setNombre(e.target.value)} placeholder="Tutor externo" />
          </div>
          {!editando && (
            <div className="space-y-1">
              <Label htmlFor="rol-clase">Clasificación</Label>
              <Select id="rol-clase" value={clase}
                onChange={(e) => setClase(e.target.value as typeof clase)} className="w-[11rem]">
                <option value="NINGUNA">Ninguna</option>
                <option value="ESTUDIANTE">Estudiante</option>
                <option value="SUPERVISION">Supervisión</option>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="rol-orden">Orden</Label>
            <Input id="rol-orden" type="number" value={orden}
              onChange={(e) => setOrden(e.target.value)} className="w-[5.5rem]" />
          </div>
          {editando && (
            <Button type="button" size="sm" variant="ghost" onClick={limpiar}>
              <X /> Cancelar
            </Button>
          )}
          <Button type="submit" size="sm" variant="outline"
            loading={guardar.isPending} disabled={nombre.trim().length < 2}>
            {editando ? <><Check /> Guardar</> : <><Plus /> Añadir</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Las capacidades de un rol —dirigir el plan, ver notas privadas, validar entregas,
          gestionar participantes— son el modelo de permisos: las lee Row Level Security en
          PostgreSQL. No se cambian desde aquí, ni siquiera por la administración; hace falta una
          migración, que queda escrita, revisable y con sus pruebas. La «clasificación» no concede
          acceso a nada: sirve para contar cuántos directores tiene un trabajo y si tiene estudiante.
        </p>
        <p className="text-xs text-muted-foreground">
          El «orden» es solo la posición: de menor a mayor, decide en qué sitio sale cada rol
          en los desplegables donde se elige uno —al añadir un participante a un trabajo y al
          asignar un rol a una tarea de plantilla—. No concede acceso a nada y no ordena la
          lista de participantes de un trabajo, que va por orden de incorporación. Tiene un
          efecto menos visible: al crear un trabajo, el rol que recibe la persona marcada como
          estudiante es el PRIMERO con clasificación «estudiante» según este orden, y el de la
          dirección, el primero con capacidad para gestionar participantes. Si algún día hay dos
          roles de estudiante, este número decide cuál se usa.
        </p>
      </form>
    </div>
  )
}

export const AVISO_CATALOGOS_GLOBALES =
  'Estos dos catálogos son comunes a todo el grupo: no son por organización, así que un cambio aquí lo ve todo el mundo.'
