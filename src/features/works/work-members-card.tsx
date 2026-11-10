import * as React from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, UserMinus, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, ToneBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { FieldError } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { worksRepo, type WorkWithRelations } from '@/data/repositories/works.repo'
import { useAuth } from '@/features/auth/auth-context'
import { peopleRepo, type PersonFound } from '@/data/repositories/people.repo'
import { useWorkRoles } from '@/hooks/use-catalogs'
import { avisoDeDireccion } from '@/domain/works/direccion'
import { memberFormSchema, type MemberFormValues } from '@/schemas/work'
import type { WorkCapabilities } from '@/domain/permissions/work-capabilities'

export function WorkMembersCard({ work, caps }: { work: WorkWithRelations; caps: WorkCapabilities }) {
  const [open, setOpen] = React.useState(false)
  const qc = useQueryClient()
  const toast = useToast()

  const remove = useMutation({
    mutationFn: (memberId: string) => worksRepo.removeMember(memberId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.works.detail(work.id) })
      toast.push('success', 'Participante retirado.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const { userId } = useAuth()
  const roles = useWorkRoles()

  // Atajo para el caso más común al crear un trabajo: el director se asigna a
  // sí mismo. Sin esto había que abrir el diálogo y buscarse en una lista que,
  // al principio, solo contiene a una persona.
  const addSelf = useMutation({
    mutationFn: (roleId: string) =>
      worksRepo.addMember({ work_id: work.id, user_id: userId!, work_role_id: roleId, is_primary: true }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.works.detail(work.id) })
      void qc.invalidateQueries({ queryKey: qk.works.all })
      toast.push('success', 'Te has asignado como dirección de este trabajo.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const primarySupervisorRole = (roles.data ?? []).find((r) => r.is_supervisory && r.can_manage_members)
  const iAmMember = userId !== null && work.members.some((m) => m.user_id === userId && m.status === 'ACTIVE')

  const active = work.members.filter((m) => m.status === 'ACTIVE')
  const students = active.filter((m) => m.role?.is_student)
  const supervisors = active.filter((m) => m.role?.is_supervisory)
  const others = active.filter((m) => !m.role?.is_student && !m.role?.is_supervisory)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">Participantes</CardTitle>
        {caps.canManageMembers && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}><UserPlus /> Añadir</Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        <Group label="Estudiantes" members={students} caps={caps} onRemove={(id) => remove.mutate(id)} />
        <Group label="Dirección" members={supervisors} caps={caps} onRemove={(id) => remove.mutate(id)} />
        {/* Se enseña aunque nadie esté añadiendo a nadie: un trabajo puede
            venir pasado de antes, o alguien pudo bajar el número del catálogo
            después. Si solo apareciera en el formulario de añadir, ese caso no
            se veria nunca. */}
        {avisoDeDireccion(
          work.members, work.work_type?.max_supervisors ?? null, work.work_type?.short_name ?? null, false,
        ) && (
          <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
            {avisoDeDireccion(
              work.members, work.work_type?.max_supervisors ?? null, work.work_type?.short_name ?? null, false,
            )}
          </p>
        )}
        {others.length > 0 && (
          <Group label="Otros" members={others} caps={caps} onRemove={(id) => remove.mutate(id)} />
        )}

        {active.length === 0 && (
          /* Un trabajo recién creado no tiene participantes, y sin ellos no hay
             nada que seguir: ni progreso, ni tareas asignadas, ni permisos
             académicos. Antes esto era una línea de texto gris y el único
             acceso a la acción era un botón pequeño en la cabecera, que pasaba
             desapercibido. Ahora el camino está aquí, donde se nota el hueco. */
          <div className="rounded-lg border border-dashed p-4 text-center">
            <p className="text-sm font-medium">Todavía no hay participantes</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              Un trabajo sin participantes no aparece en el panel de nadie y no puede tener tareas
              asignadas. Añade al menos a la dirección y al estudiante.
            </p>
            {caps.canManageMembers && (
              <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
                {!iAmMember && primarySupervisorRole && (
                  <Button
                    size="sm"
                    loading={addSelf.isPending}
                    onClick={() => addSelf.mutate(primarySupervisorRole.id)}
                  >
                    <UserPlus /> Añadirme como dirección
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                  <Plus /> Añadir otra persona
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AddMemberDialog open={open} onOpenChange={setOpen} work={work} />
    </Card>
  )
}

function Group({
  label, members, caps, onRemove,
}: {
  label: string
  members: WorkWithRelations['members']
  caps: WorkCapabilities
  onRemove: (id: string) => void
}) {
  if (members.length === 0) return null
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="space-y-1.5">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <Avatar name={m.profile?.full_name} src={m.profile?.avatar_url} size="sm" />
            <span className="min-w-0 flex-1 truncate">
              {m.profile?.full_name ?? '—'}
              {m.is_primary && <Badge variant="secondary" className="ml-1.5">principal</Badge>}
            </span>
            <ToneBadge tone={m.role?.is_student ? 'sky' : 'violet'}>{m.role?.name}</ToneBadge>
            {caps.canManageMembers && (
              <Button variant="ghost" size="icon" className="size-7" onClick={() => onRemove(m.id)} aria-label="Retirar participante">
                <UserMinus />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AddMemberDialog({
  open, onOpenChange, work,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  work: WorkWithRelations
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const roles = useWorkRoles()
  const people = useQuery({ queryKey: qk.people.directory, queryFn: peopleRepo.directory })

  /**
   * El desplegable ya NO es el grupo entero (migración 0016): son las personas
   * con las que quien mira comparte algún trabajo. Para los demás hay búsqueda
   * por correo exacto, y lo que se encuentra se añade a la lista de esta
   * ventana —no al directorio— hasta cerrarla.
   */
  const [correo, setCorreo] = React.useState('')
  const [encontradas, setEncontradas] = React.useState<PersonFound[]>([])

  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: { user_id: '', work_role_id: '', is_primary: false },
  })

  const buscar = useMutation({
    mutationFn: () => peopleRepo.findByEmail(correo),
    onSuccess: (persona) => {
      if (!persona) {
        toast.push(
          'error',
          'Ninguna cuenta con ese correo. Comprueba la dirección o invítala desde Administración → Invitaciones.',
        )
        return
      }
      setEncontradas((previas) =>
        previas.some((p) => p.id === persona.id) ? previas : [...previas, persona])
      form.setValue('user_id', persona.id, { shouldValidate: true })
      setCorreo('')
      toast.push('success', `${persona.full_name} seleccionada.`)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const add = useMutation({
    mutationFn: (values: MemberFormValues) =>
      worksRepo.addMember({
        work_id: work.id,
        user_id: values.user_id,
        work_role_id: values.work_role_id,
        is_primary: values.is_primary,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.works.detail(work.id) })
      void qc.invalidateQueries({ queryKey: qk.works.all })
      toast.push('success', 'Participante añadido.')
      form.reset()
      onOpenChange(false)
    },
    onError: (e) => {
      const msg = errorMessage(e)
      toast.push(
        'error',
        msg.includes('duplicate key')
          ? 'Esa persona ya tiene esa misma función en este trabajo.'
          : msg.includes('work_members_one_primary')
            ? 'Ya existe un participante principal con esa función. Desmárcalo antes.'
            : msg,
      )
    },
  })

  const selectedRole = (roles.data ?? []).find((r) => r.id === form.watch('work_role_id'))

  // Directorio visible + lo que se haya localizado por correo, sin repetir.
  const directorio = people.data ?? []
  const opciones = [
    ...directorio,
    ...encontradas.filter((e) => !directorio.some((p) => p.id === e.id)),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Añadir participante</DialogTitle>
          <DialogDescription>
            Los permisos se definen por trabajo. Una misma persona puede tener funciones distintas
            en trabajos distintos, e incluso dos funciones en este mismo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => add.mutate(v))} className="space-y-3" noValidate>
          <div>
            <Label htmlFor="member-user">Persona</Label>
            <Select id="member-user" className="mt-1.5" {...form.register('user_id')}>
              <option value="">Elige una persona…</option>
              {opciones.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name} · {p.email}</option>
              ))}
            </Select>
            <FieldError>{form.formState.errors.user_id?.message}</FieldError>

            {/* Buscar por correo: la única forma de llegar a alguien con quien
                todavía no se comparte ningún trabajo. Exige la dirección
                completa a propósito —no hay búsqueda por nombre— para que la
                lista de personas del grupo no se pueda reconstruir desde aquí. */}
            <div className="mt-2 flex gap-2">
              <Input
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  if (correo.includes('@')) buscar.mutate()
                }}
                type="email"
                placeholder="¿No está en la lista? Busca su correo…"
                aria-label="Buscar una persona por su correo"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={buscar.isPending}
                disabled={!correo.includes('@')}
                onClick={() => buscar.mutate()}
              >
                <Search /> Buscar
              </Button>
            </div>

            {/* Solo se puede asignar a personas que ya tienen cuenta, porque
                `profiles.id` referencia a `auth.users`. Si la lista está casi
                vacía no es un error de la pantalla: es que todavía no hay a
                quién asignar, y conviene decirlo en lugar de dejar un
                desplegable mudo. */}
            <p className="mt-1.5 text-xs text-muted-foreground">
              En la lista aparecen las personas con las que ya compartes algún trabajo. Para
              cualquier otra, escribe su correo completo. Si todavía no tiene cuenta, dale de alta
              en{' '}
              <Link to="/admin/invitaciones" className="font-medium underline underline-offset-2">
                Administración → Invitaciones
              </Link>
              .
            </p>
          </div>

          <div>
            <Label htmlFor="member-role">Función</Label>
            <Select id="member-role" className="mt-1.5" {...form.register('work_role_id')}>
              <option value="">Elige una función…</option>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
            <FieldError>{form.formState.errors.work_role_id?.message}</FieldError>
            {selectedRole && (
              <p className="mt-1 text-xs text-muted-foreground">
                {[
                  selectedRole.can_manage_plan ? 'gestiona el plan' : null,
                  selectedRole.can_see_private_notes ? 've notas privadas' : null,
                  selectedRole.can_validate_deliverables ? 'valida entregas' : null,
                  selectedRole.can_manage_members ? 'gestiona participantes' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'solo consulta'}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 rounded border-input" {...form.register('is_primary')} />
            Marcar como participante principal de esa función
          </label>

          {/* AVISA, NO IMPIDE. El número del catálogo dice lo NORMAL, no lo
              permitido: una codirección externa o un relevo a mitad de curso
              son casos legítimos, y una regla tajante estorbaría justo ahí.
              Mismo trato que el aviso de «este tipo es individual» de abajo,
              que lleva funcionando así desde la primera versión. */}
          {selectedRole?.is_supervisory && avisoDeDireccion(
            work.members, work.work_type?.max_supervisors ?? null, work.work_type?.short_name ?? null, true,
          ) && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
              {avisoDeDireccion(
                work.members, work.work_type?.max_supervisors ?? null, work.work_type?.short_name ?? null, true,
              )}
            </p>
          )}

          {!work.work_type?.allows_multiple_students && (
            <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              Este tipo de trabajo ({work.work_type?.short_name}) está configurado como individual.
              Si necesitas varios estudiantes, cámbialo en el catálogo de tipos de trabajo.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" loading={add.isPending}><Plus /> Añadir</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
