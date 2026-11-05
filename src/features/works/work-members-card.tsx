import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, UserMinus, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, ToneBadge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { FieldError } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { worksRepo, type WorkWithRelations } from '@/data/repositories/works.repo'
import { peopleRepo } from '@/data/repositories/people.repo'
import { useWorkRoles } from '@/hooks/use-catalogs'
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
        {others.length > 0 && (
          <Group label="Otros" members={others} caps={caps} onRemove={(id) => remove.mutate(id)} />
        )}

        {active.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Sin participantes. {caps.canManageMembers && 'Añade al estudiante y a la dirección.'}
          </p>
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

  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: { user_id: '', work_role_id: '', is_primary: false },
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
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name} · {p.email}</option>
              ))}
            </Select>
            <FieldError>{form.formState.errors.user_id?.message}</FieldError>
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
