import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AtSign, Check, Pencil, Send, Trash2, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { MarkupEditor } from '@/components/common/markup-editor'
import { TextoConFormato } from '@/components/common/rich-text'
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
  /** Qué comentario se está editando, y con qué texto. */
  const [editando, setEditando] = React.useState<{ id: string; texto: string } | null>(null)

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

  const editar = useMutation({
    mutationFn: ({ id, texto }: { id: string; texto: string }) => commentsRepo.update(id, texto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.comments(workId, entityType, entityId) })
      setEditando(null)
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
              {/* Antes era un círculo gris con una sola letra. Con foto se
                  reconoce a quien escribe sin leer, que en un hilo largo es la
                  diferencia entre seguirlo y releerlo. */}
              <Avatar
                name={c.author?.full_name}
                src={c.author?.avatar_url}
                size="sm"
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.author?.full_name ?? '—'}</span>
                  <span>{format(parseISO(c.created_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}</span>
                  {/* «Editado», y CUÁNDO. Un hilo de seguimiento se cita en un
                      informe y en una reunión: saber que una frase no es la
                      que se leyó en su día importa más que el adorno. La fecha
                      la pone la base de datos (disparador de la 0029), no esta
                      pantalla. */}
                  {c.updated_at !== c.created_at && (
                    <span title={format(parseISO(c.updated_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}>
                      · editado
                    </span>
                  )}
                </p>

                {editando?.id === c.id ? (
                  /* Se edita EN SU SITIO, con la misma barra de formato con la
                     que se escribió. Un diálogo aparte sacaría el texto de la
                     conversación justo cuando se está corrigiendo por lo que
                     dice el resto del hilo. */
                  <form
                    className="mt-1 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const texto = editando.texto.trim()
                      if (texto.length >= 2 && texto !== c.content) {
                        editar.mutate({ id: c.id, texto })
                      } else {
                        setEditando(null)
                      }
                    }}
                  >
                    <MarkupEditor
                      rows={4}
                      value={editando.texto}
                      onChange={(texto) => setEditando({ id: c.id, texto })}
                      aria-label="Editar el comentario"
                      autoFocus
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault()
                          e.currentTarget.form?.requestSubmit()
                        }
                        // `Esc` cancela. Dentro de un diálogo hay que pararlo:
                        // si no, el que se cierra es el diálogo entero y se
                        // pierde la edición sin preguntar.
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          e.stopPropagation()
                          setEditando(null)
                        }
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <Button type="submit" size="sm" loading={editar.isPending}>
                        <Check /> Guardar
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(null)}>
                        <X /> Cancelar
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    {/* Con formato: negrita, cursiva, subrayado y listas. Lo
                        que se guardó es texto con marcas (`**así**`), y lo de
                        antes de que esto existiera es texto sin ninguna marca,
                        que sale igual que salía. Aquí no se monta HTML en
                        ningún momento: ver `rich-text.tsx`. */}
                    <TextoConFormato texto={c.content} className="mt-0.5" />
                    {c.mentions.length > 0 && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <AtSign className="size-3" />
                        avisó a {c.mentions.map(nameOf).join(', ')}
                      </p>
                    )}
                  </>
                )}
              </div>
              {/* SOLO EL AUTOR, y no es esta comprobación la que manda: la
                  política `comments_update` y el disparador de la 0029 lo
                  impiden en la base de datos. Esconder los botones a quien no
                  puede es cortesía; quien lo prohíbe está más abajo. */}
              {c.author_id === userId && editando === null && (
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost" size="icon" className="size-7"
                    onClick={() => setEditando({ id: c.id, texto: c.content })}
                    aria-label="Editar mi comentario"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="size-7"
                    onClick={() => remove.mutate(c.id)} aria-label="Borrar comentario"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
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
          <MarkupEditor
            rows={3}
            value={text}
            onChange={setText}
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
