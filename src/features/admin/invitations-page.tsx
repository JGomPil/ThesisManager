import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, Plus, Trash2, Undo2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState, ErrorPanel, FieldError, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import {
  INVITATION_STATUS_LABELS, invitationsRepo,
} from '@/data/repositories/invitations.repo'
import { invitationFormSchema, type InvitationFormValues } from '@/schemas/work'
import { useAuth } from '@/features/auth/auth-context'
import type { InvitationRow } from '@/data/types/database'

/**
 * Cola de invitaciones.
 *
 * Es una lista de trabajo, no un botón de envío masivo, y la razón es doble:
 *
 *  1. Enviar la invitación requiere la clave `service_role`, que no puede
 *     existir en un frontend público. El envío se hace desde el panel de
 *     Supabase.
 *  2. El plan gratuito permite solo 2–4 correos por hora, compartidos con la
 *     recuperación de contraseña. Con 30 altas en septiembre, el administrador
 *     necesita saber por dónde iba; un formulario masivo le haría creer que ha
 *     invitado a 30 personas cuando solo habrían salido tres.
 */
export function InvitationsPage() {
  const [open, setOpen] = React.useState(false)
  const invitations = useQuery({ queryKey: qk.invitations, queryFn: invitationsRepo.list })
  const qc = useQueryClient()
  const toast = useToast()

  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.invitations })

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: InvitationRow['status'] }) =>
      invitationsRepo.setStatus(id, status),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => invitationsRepo.remove(id),
    onSuccess: () => { invalidate(); toast.push('success', 'Invitación eliminada.') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (invitations.isLoading) return <LoadingPanel />
  if (invitations.isError) return <ErrorPanel error={invitations.error} />

  const rows = invitations.data ?? []
  const pending = rows.filter((r) => r.status === 'PENDING')
  const sent = rows.filter((r) => r.status === 'SENT')
  const accepted = rows.filter((r) => r.status === 'ACCEPTED')

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invitaciones"
        breadcrumb={[{ label: 'Administración', to: '/admin' }, { label: 'Invitaciones' }]}
        description="El registro público está deshabilitado: nadie entra sin figurar aquí."
        actions={<Button onClick={() => setOpen(true)}><Plus /> Nueva invitación</Button>}
      />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Pendientes de enviar" value={pending.length} tone="amber" />
        <Stat label="Enviadas, sin aceptar" value={sent.length} tone="sky" />
        <Stat label="Aceptadas" value={accepted.length} tone="green" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Cómo enviar las invitaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 text-sm text-muted-foreground">
          <p>
            La aplicación no puede enviar los correos por sí misma: hacerlo requiere una clave
            privilegiada de Supabase, que no puede vivir en un frontend público. El envío se hace
            desde el panel de Supabase, y aquí se lleva la cuenta.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Copia el correo de una fila pendiente con el botón de copiar.</li>
            <li>
              En Supabase: <em>Authentication → Users → Invite user</em>. Pega el correo y envía.
            </li>
            <li>Vuelve aquí y marca la fila como enviada.</li>
          </ol>
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
            <strong>Límite del plan gratuito:</strong> 2–4 correos por hora, compartidos con los de
            recuperación de contraseña. Con 30 altas, reparte los envíos en varias tandas. Si una
            persona no recibe el correo, puedes crearle la cuenta con contraseña temporal desde
            <em> Authentication → Users → Add user</em>.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href="https://supabase.com/dashboard/project/_/auth/users" target="_blank" rel="noreferrer noopener">
              Abrir usuarios en Supabase <ExternalLink />
            </a>
          </Button>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="Sin invitaciones registradas"
          description="Añade a quien deba tener acceso. Al entrar por primera vez quedará de alta automáticamente con la función que indiques."
          action={<Button size="sm" onClick={() => setOpen(true)}><Plus /> Nueva invitación</Button>}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Función prevista</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const status = INVITATION_STATUS_LABELS[r.status]
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.email}</TableCell>
                    <TableCell className="text-sm">{r.full_name ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.intended_role === 'MEMBER' ? 'Miembro' : r.intended_role === 'ADMIN' ? 'Administrador' : 'Propietario'}
                    </TableCell>
                    <TableCell><ToneBadge tone={status.tone}>{status.label}</ToneBadge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(parseISO(r.accepted_at ?? r.sent_at ?? r.created_at), 'd MMM yyyy', { locale: es })}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <CopyButton value={r.email} />
                        {r.status === 'PENDING' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Marcar como enviada"
                            onClick={() => setStatus.mutate({ id: r.id, status: 'SENT' })}
                            aria-label="Marcar como enviada"
                          >
                            <Check />
                          </Button>
                        )}
                        {r.status === 'SENT' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Volver a pendiente"
                            onClick={() => setStatus.mutate({ id: r.id, status: 'PENDING' })}
                            aria-label="Volver a pendiente"
                          >
                            <Undo2 />
                          </Button>
                        )}
                        {r.status !== 'ACCEPTED' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Eliminar"
                            onClick={() => remove.mutate(r.id)}
                            aria-label="Eliminar invitación"
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <InvitationDialog open={open} onOpenChange={setOpen} onCreated={invalidate} />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <ToneBadge tone={tone} className="mb-1.5">{label}</ToneBadge>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = React.useState(false)
  const toast = useToast()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      window.setTimeout(() => setDone(false), 2000)
    } catch {
      // El portapapeles puede estar bloqueado (permisos, contexto no seguro).
      toast.push('info', `Copia manualmente: ${value}`)
    }
  }

  return (
    <Button variant="ghost" size="icon" onClick={() => void copy()} title="Copiar correo" aria-label="Copiar correo">
      {done ? <Check className="text-emerald-600" /> : <Copy />}
    </Button>
  )
}

function InvitationDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}) {
  const toast = useToast()
  const { organizationId, userId } = useAuth()

  const form = useForm<InvitationFormValues>({
    resolver: zodResolver(invitationFormSchema),
    defaultValues: { email: '', full_name: '', intended_role: 'MEMBER', notes: '' },
  })

  const create = useMutation({
    mutationFn: (values: InvitationFormValues) => {
      if (!organizationId) throw new Error('No tienes una organización activa.')
      return invitationsRepo.create({
        organization_id: organizationId,
        email: values.email,
        full_name: values.full_name || null,
        intended_role: values.intended_role,
        notes: values.notes || null,
        created_by: userId,
      })
    },
    onSuccess: () => {
      onCreated()
      toast.push('success', 'Invitación registrada. Ahora envíala desde el panel de Supabase.')
      form.reset()
      onOpenChange(false)
    },
    onError: (e) => {
      const msg = errorMessage(e)
      toast.push(
        'error',
        msg.includes('duplicate key') || msg.includes('invitations_unique_live')
          ? 'Ya existe una invitación activa para ese correo.'
          : msg,
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva invitación</DialogTitle>
          <DialogDescription>
            Al entrar por primera vez, la persona quedará de alta en el grupo con la función que
            indiques. Sus funciones académicas se asignan después, trabajo a trabajo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-3" noValidate>
          <div>
            <Label htmlFor="inv-email">Correo institucional</Label>
            <Input id="inv-email" type="email" className="mt-1.5" {...form.register('email')} />
            <FieldError>{form.formState.errors.email?.message}</FieldError>
          </div>
          <div>
            <Label htmlFor="inv-name">Nombre y apellidos</Label>
            <Input id="inv-name" className="mt-1.5" {...form.register('full_name')} />
          </div>
          <div>
            <Label htmlFor="inv-role">Función en el grupo</Label>
            <Select id="inv-role" className="mt-1.5" {...form.register('intended_role')}>
              <option value="MEMBER">Miembro — sin permisos administrativos</option>
              <option value="ADMIN">Administrador — gestiona usuarios, catálogos y trabajos</option>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Ser administrador no convierte a nadie en director de ningún trabajo: son dos
              sistemas de permisos independientes.
            </p>
          </div>
          <div>
            <Label htmlFor="inv-notes">Notas</Label>
            <Textarea id="inv-notes" rows={2} className="mt-1.5" {...form.register('notes')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" loading={create.isPending}>Registrar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
