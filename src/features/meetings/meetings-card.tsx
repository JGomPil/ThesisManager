import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock, CheckSquare, Lock, MapPin, Plus, Trash2, Users, Video,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ErrorPanel, FieldError, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/supabase'
import {
  MEETING_MODALITIES, meetingsRepo, type MeetingWithDetail,
} from '@/data/repositories/meetings.repo'
import { tasksRepo } from '@/data/repositories/tasks.repo'
import { meetingFormSchema, type MeetingFormValues } from '@/schemas/work'
import type { WorkWithRelations } from '@/data/repositories/works.repo'
import type { WorkCapabilities } from '@/domain/permissions/work-capabilities'
import { CommentsThread } from '@/features/comments/comments-thread'

/**
 * Reuniones de seguimiento, con acta estructurada.
 *
 * EL ACTA TIENE DOS MITADES Y NO SE MEZCLAN NUNCA:
 *
 *  · `topics` y `summary` son el acta COMPARTIDA. La lee todo el que tiene
 *    acceso al trabajo, el estudiante incluido. Es el registro de lo acordado.
 *
 *  · Las notas privadas son otra tabla, `meeting_private_notes`, y aquí se
 *    piden en una consulta aparte que solo se lanza si el usuario puede verlas.
 *    La frontera real es la política de RLS, no este condicional; pero tampoco
 *    hay razón para pedirle al servidor algo que no se va a poder usar.
 *
 * La separación es de diseño: si la nota privada fuese una columna más de
 * `meetings`, viajaría en el JSON de cualquier consulta de la reunión y
 * bastaría un descuido para pintarla.
 *
 * SOBRE EL PERMISO DE ESCRITURA: se usa `caps.canEditWork`, no
 * `caps.canManagePlan`. Es lo que refleja exactamente `meetings_write`,
 * `mparts_write` y `agreements_write`: supervisión del trabajo o
 * administración de la organización. `can_manage_plan` es otra cosa —un
 * colaborador puede tenerlo sin ser dirección— y usarlo aquí pintaría botones
 * que la base de datos rechazaría.
 */
export function MeetingsCard({
  work, caps, userId,
}: {
  work: WorkWithRelations
  caps: WorkCapabilities
  userId: string | null
}) {
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<MeetingWithDetail | null>(null)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const canEdit = caps.canEditWork

  const meetings = useQuery({
    queryKey: qk.meetings.byWork(work.id),
    queryFn: () => meetingsRepo.byWork(work.id),
  })

  const rows = meetings.data ?? []
  const now = new Date().toISOString()
  const upcoming = rows.filter((m) => m.scheduled_at >= now).reverse()
  const past = rows.filter((m) => m.scheduled_at < now)
  const open = rows.find((m) => m.id === openId) ?? null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="size-4 text-muted-foreground" /> Reuniones
        </CardTitle>
        {canEdit && (
          <Button
            size="sm" variant="outline"
            onClick={() => { setEditing(null); setFormOpen(true) }}
          >
            <Plus /> Convocar
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {meetings.isLoading ? (
          <LoadingPanel label="Cargando reuniones…" />
        ) : meetings.isError ? (
          <ErrorPanel error={meetings.error} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin reuniones registradas.{' '}
            {canEdit
              ? 'Convoca la primera: el acta queda como registro de lo acordado.'
              : 'Cuando la dirección convoque una, aparecerá aquí con su acta.'}
          </p>
        ) : (
          <>
            {upcoming.length > 0 && (
              <Group label="Próximas">
                {upcoming.map((m) => (
                  <MeetingRowItem key={m.id} meeting={m} onOpen={() => setOpenId(m.id)} />
                ))}
              </Group>
            )}
            {past.length > 0 && (
              <Group label="Celebradas">
                {past.map((m) => (
                  <MeetingRowItem key={m.id} meeting={m} onOpen={() => setOpenId(m.id)} />
                ))}
              </Group>
            )}
          </>
        )}
      </CardContent>

      <MeetingFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        work={work}
        meeting={editing}
        userId={userId}
      />

      <MeetingDetailDialog
        meeting={open}
        open={openId !== null}
        onOpenChange={(v) => { if (!v) setOpenId(null) }}
        work={work}
        caps={caps}
        userId={userId}
        onEdit={(m) => { setOpenId(null); setEditing(m); setFormOpen(true) }}
      />
    </Card>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="divide-y">{children}</ul>
    </div>
  )
}

function MeetingRowItem({ meeting, onOpen }: { meeting: MeetingWithDetail; onOpen: () => void }) {
  const modality = MEETING_MODALITIES.find((m) => m.value === meeting.modality)
  const sinTarea = meeting.agreements.filter((a) => a.task_id === null).length

  return (
    <li className="py-2 first:pt-0">
      <button type="button" onClick={onOpen} className="w-full text-left">
        <span className="text-sm font-medium underline-offset-2 hover:underline">{meeting.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{format(parseISO(meeting.scheduled_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}</span>
          <span className="flex items-center gap-1">
            {meeting.modality === 'PRESENCIAL' ? <MapPin className="size-3" /> : <Video className="size-3" />}
            {modality?.label}
          </span>
          {meeting.summary && <ToneBadge tone="green">con acta</ToneBadge>}
          {meeting.agreements.length > 0 && (
            <span className="flex items-center gap-1">
              <CheckSquare className="size-3" />
              {meeting.agreements.length} acuerdo(s)
              {sinTarea > 0 && `, ${sinTarea} sin tarea`}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

function MeetingDetailDialog({
  meeting, open, onOpenChange, work, caps, userId, onEdit,
}: {
  meeting: MeetingWithDetail | null
  open: boolean
  onOpenChange: (v: boolean) => void
  work: WorkWithRelations
  caps: WorkCapabilities
  userId: string | null
  onEdit: (m: MeetingWithDetail) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [newAgreement, setNewAgreement] = React.useState('')
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const canEdit = caps.canEditWork

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.meetings.byWork(work.id) })

  const addAgreement = useMutation({
    mutationFn: (description: string) =>
      meetingsRepo.addAgreement({
        meeting_id: meeting!.id,
        work_id: work.id,
        description,
        order_index: meeting!.agreements.length,
      }),
    onSuccess: () => { void invalidate(); setNewAgreement('') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const removeAgreement = useMutation({
    mutationFn: (id: string) => meetingsRepo.removeAgreement(id),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  /**
   * Un acuerdo se convierte en tarea del plan. No se copia el texto y punto: se
   * guarda el `task_id` en el acuerdo, de modo que el acta queda trazable
   * («esto se acordó aquí y se convirtió en esta tarea») y no se puede generar
   * dos veces la misma tarea por despiste.
   */
  const toTask = useMutation({
    mutationFn: async ({ id, description }: { id: string; description: string }) => {
      const task = await tasksRepo.create({
        work_id: work.id,
        title: description.slice(0, 300),
        description: `Acuerdo de la reunión «${meeting!.title}» del ${format(parseISO(meeting!.scheduled_at), 'd MMMM yyyy', { locale: es })}.`,
        created_by: userId,
      })
      await meetingsRepo.linkAgreementTask(id, task.id)
    },
    onSuccess: () => {
      void invalidate()
      void qc.invalidateQueries({ queryKey: qk.tasks.byWork(work.id) })
      toast.push('success', 'Acuerdo convertido en tarea del plan.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: () => meetingsRepo.remove(meeting!.id),
    onSuccess: () => {
      void invalidate()
      toast.push('success', 'Reunión eliminada.')
      setConfirmDelete(false)
      onOpenChange(false)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const setAttendance = useMutation({
    mutationFn: (rows: { user_id: string; attended: boolean | null }[]) =>
      meetingsRepo.setParticipants(meeting!.id, rows),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (!meeting) return null

  const activeMembers = work.members.filter((m) => m.status === 'ACTIVE')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{meeting.title}</DialogTitle>
          <DialogDescription>
            {format(parseISO(meeting.scheduled_at), "EEEE d 'de' MMMM 'de' yyyy, HH:mm", { locale: es })}
            {meeting.duration_min ? ` · ${meeting.duration_min} min` : ''}
            {meeting.location ? ` · ${meeting.location}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Section title="Temas previstos">
            {meeting.topics
              ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{meeting.topics}</p>
              : <p className="text-sm text-muted-foreground">Sin temas anotados.</p>}
          </Section>

          <Section title="Acta compartida">
            {meeting.summary
              ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{meeting.summary}</p>
              : (
                <p className="text-sm text-muted-foreground">
                  Sin acta todavía.{canEdit && ' Edita la reunión para redactarla.'}
                </p>
              )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Esta acta la ve <strong>todo el que tiene acceso al trabajo</strong>, el estudiante
              incluido.
            </p>
          </Section>

          <Section title="Asistencia" icon={<Users className="size-3.5" />}>
            {activeMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground">El trabajo no tiene participantes activos.</p>
            ) : (
              <ul className="space-y-1">
                {activeMembers.map((m) => {
                  const row = meeting.participants.find((p) => p.user_id === m.user_id)
                  return (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        id={`asis-${meeting.id}-${m.user_id}`}
                        type="checkbox"
                        className="size-4 rounded border-input"
                        disabled={!canEdit || setAttendance.isPending}
                        checked={row?.attended === true}
                        onChange={(e) => {
                          const otros = meeting.participants
                            .filter((p) => p.user_id !== m.user_id)
                            .map((p) => ({ user_id: p.user_id, attended: p.attended }))
                          setAttendance.mutate(
                            e.target.checked
                              ? [...otros, { user_id: m.user_id, attended: true }]
                              : otros,
                          )
                        }}
                      />
                      <label htmlFor={`asis-${meeting.id}-${m.user_id}`}>
                        {m.profile?.full_name ?? '—'}
                      </label>
                      <span className="text-xs text-muted-foreground">{m.role?.name}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          <Section title="Acuerdos" icon={<CheckSquare className="size-3.5" />}>
            {meeting.agreements.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin acuerdos registrados.</p>
            ) : (
              <ul className="space-y-1.5">
                {meeting.agreements.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-sm">
                    <span className="min-w-0 flex-1">{a.description}</span>
                    {a.task_id ? (
                      <ToneBadge tone="green">ya es una tarea</ToneBadge>
                    ) : (
                      canEdit && caps.canManagePlan && (
                        <Button
                          size="sm" variant="outline"
                          loading={toTask.isPending && toTask.variables?.id === a.id}
                          onClick={() => toTask.mutate({ id: a.id, description: a.description })}
                        >
                          Crear tarea
                        </Button>
                      )
                    )}
                    {canEdit && (
                      <Button
                        variant="ghost" size="icon" className="size-7"
                        onClick={() => removeAgreement.mutate(a.id)}
                        aria-label="Quitar acuerdo"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canEdit && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const t = newAgreement.trim()
                  if (t.length >= 3) addAgreement.mutate(t)
                }}
              >
                <Input
                  value={newAgreement}
                  onChange={(e) => setNewAgreement(e.target.value)}
                  placeholder="Añadir un acuerdo…"
                  aria-label="Nuevo acuerdo"
                />
                <Button type="submit" size="sm" variant="outline" loading={addAgreement.isPending}>
                  <Plus /> Añadir
                </Button>
              </form>
            )}
          </Section>

          {caps.canSeePrivateNotes && (
            <PrivateNotes meeting={meeting} workId={work.id} userId={userId} />
          )}

          <Section title="Comentarios">
            <CommentsThread
              workId={work.id}
              entityType="MEETING"
              entityId={meeting.id}
              members={activeMembers}
              userId={userId}
              canComment={activeMembers.some((m) => m.user_id === userId)}
            />
          </Section>
        </div>

        <DialogFooter className="sm:justify-between">
          {canEdit ? (
            confirmDelete ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">¿Eliminar la reunión y su acta?</span>
                <Button size="sm" variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
                  Sí, eliminar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>No</Button>
              </span>
            ) : (
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Eliminar
              </Button>
            )
          ) : <span />}
          <div className="flex gap-2">
            {canEdit && (
              <Button variant="outline" onClick={() => onEdit(meeting)}>Editar acta</Button>
            )}
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({
  title, icon, children,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-t pt-3 first:border-t-0 first:pt-0">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * Notas privadas de dirección.
 *
 * Solo se monta si `caps.canSeePrivateNotes`, de modo que la consulta ni se
 * lanza para quien no debe verlas. Eso es comodidad y ahorro, NO seguridad: la
 * puerta real es `private_notes_select`, que incluye la regla de protección del
 * estudiante —si alguien es estudiante del trabajo no ve las notas ni siendo
 * además administrador de la organización—. Y no hay disparador de
 * notificación sobre esta tabla: avisar de algo privado es filtrarlo.
 */
function PrivateNotes({
  meeting, workId, userId,
}: {
  meeting: MeetingWithDetail
  workId: string
  userId: string | null
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [text, setText] = React.useState('')

  const notes = useQuery({
    queryKey: qk.meetings.privateNotes(meeting.id),
    queryFn: () => meetingsRepo.privateNotes(meeting.id),
  })

  const add = useMutation({
    mutationFn: (content: string) =>
      meetingsRepo.addPrivateNote(meeting.id, workId, userId!, content),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.meetings.privateNotes(meeting.id) })
      setText('')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => meetingsRepo.removePrivateNote(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.meetings.privateNotes(meeting.id) }),
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const rows = notes.data ?? []

  return (
    <section className={cn('rounded-lg border border-violet-500/40 bg-violet-500/5 p-3')}>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
        <Lock className="size-3.5" /> Notas privadas de dirección
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">
        El estudiante <strong>no ve nada de esto</strong>, ni le llega ninguna notificación.
        Cada cual es dueño de sus notas: nadie más puede editarlas ni borrarlas.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin notas.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm">{n.content}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {format(parseISO(n.created_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}
                </p>
              </div>
              {n.author_id === userId && (
                <Button
                  variant="ghost" size="icon" className="size-7"
                  onClick={() => remove.mutate(n.id)} aria-label="Borrar nota"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (t.length >= 3 && userId) add.mutate(t)
        }}
      >
        <Textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Anotar algo que no debe ver el estudiante…"
          aria-label="Nueva nota privada"
        />
        <Button type="submit" size="sm" variant="outline" loading={add.isPending}>
          <Plus /> Añadir nota
        </Button>
      </form>
    </section>
  )
}

const VACIO: MeetingFormValues = {
  title: '', scheduled_at: '', duration_min: '', modality: 'PRESENCIAL',
  location: '', topics: '', summary: '', next_meeting_at: '',
}

function MeetingFormDialog({
  open, onOpenChange, work, meeting, userId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  work: WorkWithRelations
  meeting: MeetingWithDetail | null
  userId: string | null
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const isEdit = meeting !== null

  // `datetime-local` quiere 'YYYY-MM-DDTHH:mm' en hora local; la base de datos
  // guarda `timestamptz`. La conversión va en los dos sentidos aquí, en un solo
  // sitio, para no repartir errores de zona horaria por la pantalla.
  const toLocalInput = (iso: string | null) =>
    iso ? format(parseISO(iso), "yyyy-MM-dd'T'HH:mm") : ''

  const form = useForm<MeetingFormValues>({
    resolver: zodResolver(meetingFormSchema),
    defaultValues: VACIO,
  })

  React.useEffect(() => {
    if (!open) return
    form.reset(
      meeting
        ? {
            title: meeting.title,
            scheduled_at: toLocalInput(meeting.scheduled_at),
            duration_min: meeting.duration_min?.toString() ?? '',
            modality: meeting.modality,
            location: meeting.location ?? '',
            topics: meeting.topics ?? '',
            summary: meeting.summary ?? '',
            next_meeting_at: toLocalInput(meeting.next_meeting_at),
          }
        : VACIO,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, meeting?.id])

  const save = useMutation({
    mutationFn: (v: MeetingFormValues) => {
      const payload = {
        title: v.title,
        scheduled_at: new Date(v.scheduled_at).toISOString(),
        duration_min: v.duration_min ? Number(v.duration_min) : null,
        modality: v.modality,
        location: v.location || null,
        topics: v.topics || null,
        summary: v.summary || null,
        next_meeting_at: v.next_meeting_at ? new Date(v.next_meeting_at).toISOString() : null,
      }
      return isEdit
        ? meetingsRepo.update(meeting.id, payload)
        : meetingsRepo.create({ ...payload, work_id: work.id, created_by: userId })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.meetings.byWork(work.id) })
      toast.push('success', isEdit ? 'Acta guardada.' : 'Reunión convocada.')
      onOpenChange(false)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar reunión y acta' : 'Convocar reunión'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'El acta queda visible para todos los participantes, el estudiante incluido.'
              : 'Al convocarla se avisa a los participantes del trabajo.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
          <div>
            <Label htmlFor="m-title">Título</Label>
            <Input id="m-title" className="mt-1.5" placeholder="Seguimiento mensual" {...form.register('title')} />
            <FieldError>{form.formState.errors.title?.message}</FieldError>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label htmlFor="m-when">Fecha y hora</Label>
              <Input id="m-when" type="datetime-local" className="mt-1.5" {...form.register('scheduled_at')} />
              <FieldError>{form.formState.errors.scheduled_at?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="m-dur">Duración (min)</Label>
              <Input id="m-dur" type="number" min="5" step="5" className="mt-1.5" {...form.register('duration_min')} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="m-mod">Modalidad</Label>
              <Select id="m-mod" className="mt-1.5" {...form.register('modality')}>
                {MEETING_MODALITIES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="m-loc">Lugar o enlace</Label>
              <Input id="m-loc" className="mt-1.5" placeholder="Despacho 2.14 / enlace" {...form.register('location')} />
            </div>
          </div>

          <div>
            <Label htmlFor="m-topics">Temas previstos</Label>
            <Textarea id="m-topics" rows={2} className="mt-1.5" {...form.register('topics')} />
          </div>

          <div>
            <Label htmlFor="m-summary">Acta: lo tratado y lo acordado</Label>
            <Textarea id="m-summary" rows={5} className="mt-1.5" {...form.register('summary')} />
            <p className="mt-1 text-xs text-muted-foreground">
              Visible para el estudiante. Lo que no deba verse va en las notas privadas, dentro de
              la reunión.
            </p>
          </div>

          <div>
            <Label htmlFor="m-next">Próxima reunión (opcional)</Label>
            <Input id="m-next" type="datetime-local" className="mt-1.5" {...form.register('next_meeting_at')} />
            <FieldError>{form.formState.errors.next_meeting_at?.message}</FieldError>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" loading={save.isPending}>{isEdit ? 'Guardar' : 'Convocar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
