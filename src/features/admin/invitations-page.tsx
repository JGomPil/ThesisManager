import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, Mail, Trash2, Undo2, UserPlus } from 'lucide-react'
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
import { PendingAccountsCard } from '@/features/admin/pending-accounts-card'
import { enlaceMailto } from '@/domain/invitations/correo'
import type { InvitationRow } from '@/data/types/database'

/**
 * Altas de usuarios: quién puede entrar.
 *
 * ESTA PANTALLA NO INVITA A NADIE, Y ANTES DECÍA QUE SÍ. Se llamaba
 * «Invitaciones», tenía un sobre por icono y hablaba de enviar; lo único que
 * hace es AUTORIZAR. El alta de verdad son tres pasos manuales (DEPLOYMENT.md)
 * y dos de ellos están en el panel de Supabase. La diferencia no es de estilo:
 * mientras la pantalla parecía un buzón de salida, la conclusión natural al no
 * recibir nada era «el correo se ha perdido», cuando lo que faltaba era crear
 * la cuenta. Eso le pasó al grupo el 11 de noviembre de 2026, dos veces: la
 * primera porque no existía la cuenta, la segunda porque existía sin confirmar.
 *
 * Tampoco hay botón de envío masivo, y no es por falta de ganas: el plan
 * gratuito de Supabase permite 2–4 correos por hora, compartidos con los de
 * recuperación de contraseña. Un formulario masivo haría creer a quien
 * administra que ha dado de alta a treinta personas cuando solo habrían salido
 * tres, que es la peor forma posible de fallar: en silencio y creyendo que no.
 */
export function InvitationsPage() {
  const [open, setOpen] = React.useState(false)
  // Para firmar el correo con el nombre de quien invita, y no con un «Un
  // saludo» anónimo que parece automático: el correo lo manda una persona.
  const { profile } = useAuth()
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
        title="Altas de usuarios"
        breadcrumb={[{ label: 'Administración', to: '/admin' }, { label: 'Altas de usuarios' }]}
        description="Quién puede entrar. El registro público está deshabilitado: nadie entra sin figurar aquí. De esta pantalla no sale ningún correo."
        actions={<Button onClick={() => setOpen(true)}><UserPlus /> Autorizar a alguien</Button>}
      />

      {/* Primero lo que requiere acción: una cuenta creada a mano no la ve
          nadie hasta que se autoriza, ni siquiera quien la creó. */}
      <PendingAccountsCard />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Falta crear su cuenta" value={pending.length} tone="amber" />
        <Stat label="Avisadas, sin cuenta" value={sent.length} tone="sky" />
        <Stat label="Con cuenta y de alta" value={accepted.length} tone="green" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Dar de alta a alguien: los tres pasos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 text-sm text-muted-foreground">
          <p className="text-foreground">
            <strong>De aquí no sale ningún correo, y no va a salir.</strong> Enviarlo exige una
            clave privilegiada de Supabase que no puede vivir en una aplicación servida desde un
            repositorio público. El alta es manual, siempre, y esta pantalla es solo el primer paso
            de tres.
          </p>
          <p>
            Eso sí: es el paso que <strong>autoriza</strong>. Registrar aquí a alguien es lo que
            hace que su cuenta, en cuanto exista, quede de alta en el grupo con la función que le
            pongas. Sin fila, una cuenta nueva entra y no ve absolutamente nada.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              <strong>Autorízala aquí</strong>, con el correo exacto con el que va a entrar. Si
              luego se registra con otro, la aplicación no la reconoce.
            </li>
            <li>
              <strong>Crea su cuenta en Supabase</strong>: <em>Authentication → Users → Add user</em>,
              con una contraseña temporal y <strong>«Auto Confirm User» marcado</strong>. Si no lo
              marcas, la cuenta queda sin confirmar y no puede entrar aunque tenga la contraseña:
              crear la cuenta a mano no envía ningún correo de confirmación, así que no hay nada que
              pulsar, y «He olvidado mi contraseña» tampoco la saca de ahí. Si ya ha pasado, se
              arregla en su fila de Supabase: menú <em>⋯ → Confirm email</em>.
            </li>
            <li>
              <strong>Avísala</strong> con «Escribir el correo»: abre tu programa de correo con el
              mensaje ya redactado —dirección con la que entrar incluida— y lo mandas tú, con tu
              nombre.
            </li>
          </ol>
          <p>
            <strong>La fila pasa sola a «Cuenta creada y de alta»</strong> en el momento en que
            creas la cuenta, no cuando la persona entra. Es el único indicador fiable de esta
            pantalla: mientras no cambie, esa cuenta todavía no existe en Supabase.
          </p>
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
            <strong>La alternativa, con su letra pequeña:</strong> <em>Invite user</em> sí manda un
            correo —el de Supabase, no el tuyo— y la cuenta queda confirmada cuando la persona pulsa
            el enlace, que ahorra el paso de la contraseña temporal. Pero el plan gratuito permite
            2–4 correos por hora, compartidos con los de recuperación de contraseña, y ese mensaje
            acaba en la carpeta de spam con mucha facilidad. Para dar de alta a una persona
            concreta, el camino de arriba es más rápido y no depende de que llegue nada.
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
          title="Nadie autorizado todavía"
          description="Autoriza a quien deba tener acceso. En cuanto le crees la cuenta en Supabase, quedará de alta en el grupo con la función que indiques."
          action={<Button size="sm" onClick={() => setOpen(true)}><UserPlus /> Autorizar a alguien</Button>}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Correo</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Función prevista</TableHead>
                <TableHead title="«Cuenta creada y de alta» la pone la base de datos en cuanto la cuenta existe; los otros dos estados los pones tú">
                  Estado
                </TableHead>
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
                    <TableCell>
                      <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
                      {/* LA PISTA VA EN LAS DOS FILAS SIN CUENTA, no solo en
                          las avisadas: en ambas falta exactamente lo mismo, y
                          es lo que nadie adivina desde aquí. Mientras la fila
                          no pase sola a «Cuenta creada», esa persona no puede
                          entrar aunque haya recibido el correo. */}
                      {r.status !== 'ACCEPTED' && r.status !== 'CANCELLED' && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          créala en Supabase con «Auto Confirm User» marcado
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(parseISO(r.accepted_at ?? r.sent_at ?? r.created_at), 'd MMM yyyy', { locale: es })}
                    </TableCell>
                    {/*
                      BOTONES CON TEXTO, Y NO SOLO ICONOS. Tenian `title` y
                      `aria-label`, que es lo que lee un lector de pantalla,
                      pero el `title` del navegador solo aparece si dejas el
                      raton quieto un segundo y EN UNA TABLET O UN MOVIL NO
                      EXISTE: no hay «pasar por encima». Tres iconos seguidos
                      sin rotulo, en una pantalla que se usa dos veces al ano,
                      son tres adivinanzas. El texto cuesta ancho y lo vale.
                    */}
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        {r.status !== 'ACCEPTED' && (
                          <Button variant="outline" size="sm" asChild>
                            {/*
                              EL CORREO LO MANDA UNA PERSONA, no la aplicacion:
                              esto abre el programa de correo con el mensaje ya
                              escrito. Sale del buzon de quien invita, con su
                              nombre, y sin ninguna credencial de por medio. El
                              texto vive en `domain/invitations/correo.ts` con
                              sus pruebas, porque lleva dos datos que no se
                              pueden olvidar: la direccion exacta con la que hay
                              que entrar y como conseguir la contrasena.
                            */}
                            <a
                              href={enlaceMailto({
                                nombre: r.full_name,
                                correo: r.email,
                                quienInvita: profile?.full_name ?? null,
                                url: direccionDeLaAplicacion(),
                              })}
                            >
                              <Mail /> Escribir el correo
                            </a>
                          </Button>
                        )}
                        <CopyButton value={r.email} />
                        {r.status === 'PENDING' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Marcar como enviada"
                            onClick={() => setStatus.mutate({ id: r.id, status: 'SENT' })}
                          >
                            <Check /> Ya la he enviado
                          </Button>
                        )}
                        {r.status === 'SENT' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Volver a pendiente"
                            onClick={() => setStatus.mutate({ id: r.id, status: 'PENDING' })}
                          >
                            <Undo2 /> Volver a pendiente
                          </Button>
                        )}
                        {r.status !== 'ACCEPTED' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Quitar la autorización"
                            onClick={() => remove.mutate(r.id)}
                          >
                            <Trash2 /> Quitar
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

/**
 * La dirección de la aplicación, tal y como hay que teclearla.
 *
 * `BASE_URL` es la ruta base que inyecta Vite —«/ThesisManager/» en Pages, «/»
 * en local—, y sin ella el enlace del correo llevaría a la raíz del dominio,
 * que en GitHub Pages es la página de otra cosa. No va en el dominio puro
 * porque mira `window`.
 */
function direccionDeLaAplicacion(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href
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
    <Button variant="ghost" size="sm" onClick={() => void copy()} title="Copiar la dirección al portapapeles">
      {done ? <><Check className="text-emerald-600" /> Copiado</> : <><Copy /> Copiar correo</>}
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
      toast.push(
        'success',
        'Autorizada. Ahora crea su cuenta en Supabase: Authentication → Users → Add user, ' +
          'con «Auto Confirm User» marcado.',
      )
      form.reset()
      onOpenChange(false)
    },
    onError: (e) => {
      const msg = errorMessage(e)
      toast.push(
        'error',
        msg.includes('duplicate key') || msg.includes('invitations_unique_live')
          ? 'Esa dirección ya está autorizada.'
          : msg,
      )
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Autorizar a alguien</DialogTitle>
          <DialogDescription>
            Esto no crea la cuenta ni envía ningún correo: autoriza. En cuanto le crees la cuenta en
            Supabase con este mismo correo, quedará de alta en el grupo con la función que indiques.
            Sus funciones académicas se asignan después, trabajo a trabajo.
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
            <Button type="submit" loading={create.isPending}>Autorizar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
