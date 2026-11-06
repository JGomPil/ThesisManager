import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AtSign, Send, Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { commentsRepo } from '@/data/repositories/comments.repo'
import type { CommentEntityType } from '@/data/types/database'
import type { WorkMemberWithRole } from '@/data/repositories/works.repo'

/**
 * Hilo de comentarios de una entidad del trabajo (trabajo, tarea, documento o
 * reunión).
 *
 * LAS MENCIONES SE ELIGEN, NO SE ESCRIBEN. `comments.mentions` es un `uuid[]`,
 * y el disparador `comments_notify_mentions` avisa a cada identificador de esa
 * lista comprobando antes que sea miembro activo del trabajo. Se podría haber
 * puesto a buscar «@Nombre» dentro del texto, pero eso falla en silencio en los
 * tres casos que más importan: dos personas con el mismo nombre, un nombre con
 * espacios, y una errata. El usuario creería haber avisado a alguien que nunca
 * recibió nada. Aquí se marca a quién se avisa con un botón y lo que se guarda
 * es el identificador, así que la mención o es correcta o no existe.
 *
 * Quien no es miembro del trabajo no puede comentar (`comments_insert` exige
 * `app.is_work_member`). Un administrador de la organización que no participe
 * en el trabajo lo lee pero no escribe: ver el trabajo de otros no es lo mismo
 * que intervenir en su seguimiento.
 */
export function CommentsThread({
  workId, entityType, entityId, members, userId, canComment,
}: {
  workId: string
  entityType: CommentEntityType
  entityId: string
  members: WorkMemberWithRole[]
  userId: string | null
  canComment: boolean
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [text, setText] = React.useState('')
  const [mentions, setMentions] = React.useState<string[]>([])

  const comments = useQuery({
    queryKey: qk.comments(workId, entityType, entityId),
    queryFn: () => commentsRepo.byEntity(workId, entityType, entityId),
  })

  const create = useMutation({
    mutationFn: () =>
      commentsRepo.create({
        work_id: workId,
        entity_type: entityType,
        entity_id: entityId,
        author_id: userId!,
        content: text.trim(),
        mentions,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.comments(workId, entityType, entityId) })
      setText('')
      setMentions([])
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => commentsRepo.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.comments(workId, entityType, entityId) }),
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const nameOf = (id: string) =>
    members.find((m) => m.user_id === id)?.profile?.full_name ?? 'alguien'

  const rows = comments.data ?? []
  const mentionables = members.filter((m) => m.user_id !== userId)

  return (
    <div className="space-y-3">
      {comments.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin comentarios.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
                aria-hidden
              >
                {(c.author?.full_name ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.author?.full_name ?? '—'}</span>
                  <span>{format(parseISO(c.created_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}</span>
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {c.content}
                </p>
                {c.mentions.length > 0 && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <AtSign className="size-3" />
                    avisó a {c.mentions.map(nameOf).join(', ')}
                  </p>
                )}
              </div>
              {c.author_id === userId && (
                <Button
                  variant="ghost" size="icon" className="size-7 shrink-0"
                  onClick={() => remove.mutate(c.id)} aria-label="Borrar comentario"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canComment ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim().length >= 2 && userId) create.mutate()
          }}
        >
          <Textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribir un comentario…"
            aria-label="Nuevo comentario"
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter envía; Enter solo salta de línea, porque aquí se
              // escriben observaciones de varios párrafos, no mensajería rápida.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                if (text.trim().length >= 2 && userId) create.mutate()
              }
            }}
          />

          {mentionables.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <AtSign className="size-3" /> Avisar a:
              </span>
              {mentionables.map((m) => {
                const on = mentions.includes(m.user_id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setMentions((prev) =>
                        on ? prev.filter((x) => x !== m.user_id) : [...prev, m.user_id],
                      )
                    }
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs transition-colors',
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {m.profile?.full_name ?? '—'}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Lo lee cualquiera con acceso al trabajo, el estudiante incluido.
            </p>
            <Button
              type="submit" size="sm"
              loading={create.isPending}
              disabled={text.trim().length < 2}
            >
              <Send /> Comentar
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          Solo los participantes del trabajo pueden comentar.
        </p>
      )}
    </div>
  )
}
