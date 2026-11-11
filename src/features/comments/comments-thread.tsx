import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AtSign, Check, Pencil, Reply, Send, Trash2, X } from 'lucide-react'
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
import { agruparEnHilos, raizDeLaRespuesta } from '@/domain/comments/hilos'
import type { CommentWithAuthor } from '@/data/repositories/comments.repo'

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
 *
 * SE RESPONDE A UN COMENTARIO CONCRETO (0036), y el hilo tiene DOS NIVELES: de
 * una respuesta no cuelga nada, y responder a una respuesta sigue la misma
 * conversación. No es una simplificación de esta pantalla —la base de datos lo
 * rechaza—, y la razón es que una conversación anidada sin fin no cabe en la
 * columna de una ficha y deja de decir a qué contesta cada cosa, que es lo que
 * se venía a arreglar. El agrupamiento y la regla de «¿de quién cuelga esto?»
 * viven en `@/domain/comments/hilos` con sus pruebas, incluida la que decide el
 * diseño: una respuesta cuyo padre se borró **se enseña igual**, como un
 * comentario más, porque hacer desaparecer de la pantalla lo que alguien
 * escribió es lo peor que puede hacer un hilo que se cita en informes.
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
  /** A qué comentario raíz se está respondiendo, y con qué texto. */
  const [respondiendo, setRespondiendo] = React.useState<{ raiz: string; texto: string } | null>(null)

  const comments = useQuery({
    queryKey: qk.comments(workId, entityType, entityId),
    queryFn: () => commentsRepo.byEntity(workId, entityType, entityId),
  })

  /**
   * Un solo alta para el comentario y para la respuesta.
   *
   * Dos mutaciones separadas habrían acabado con dos validaciones distintas de
   * lo mismo —el mínimo de dos caracteres, el `trim`, qué se limpia al
   * terminar— y con el campo `parent_comment_id` puesto en un sitio y olvidado
   * en el otro. Lo que cambia entre las dos es un parámetro.
   */
  const create = useMutation({
    mutationFn: (v: { texto: string; menciones: string[]; padre: string | null }) =>
      commentsRepo.create({
        work_id: workId,
        entity_type: entityType,
        entity_id: entityId,
        author_id: userId!,
        content: v.texto.trim(),
        mentions: v.menciones,
        parent_comment_id: v.padre,
      }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.comments(workId, entityType, entityId) })
      if (v.padre === null) {
        setText('')
        setMentions([])
      } else {
        setRespondiendo(null)
      }
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
  const hilos = agruparEnHilos(rows)
  const mentionables = members.filter((m) => m.user_id !== userId)

  return (
    <div className="space-y-3">
      {comments.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin comentarios.</p>
      ) : (
        <ul className="space-y-3">
          {hilos.map((h) => (
            <li key={h.comentario.id}>
              <Comentario
                c={h.comentario}
                userId={userId}
                nameOf={nameOf}
                editando={editando}
                setEditando={setEditando}
                editar={editar}
                remove={remove}
                puedeResponder={canComment}
                onResponder={() => setRespondiendo({ raiz: raizDeLaRespuesta(h.comentario), texto: '' })}
              />

              {/* LAS RESPUESTAS, SANGRADAS Y CON LINEA A LA IZQUIERDA. La
                  sangria solo a partir de `sm`: en un telefono, restarle 2rem
                  de ancho a un texto que ya va en una columna estrecha deja la
                  conversacion en tres palabras por linea, que es exactamente lo
                  que se queria evitar al limitar el hilo a dos niveles. La
                  linea vertical se queda en los dos tamanos: es lo que dice
                  que esto cuelga de aquello. */}
              {(h.respuestas.length > 0 || respondiendo?.raiz === h.comentario.id) && (
                <ul className="mt-2 space-y-3 border-l pl-3 sm:ml-8">
                  {h.respuestas.map((r) => (
                    <li key={r.id}>
                      <Comentario
                        c={r}
                        userId={userId}
                        nameOf={nameOf}
                        editando={editando}
                        setEditando={setEditando}
                        editar={editar}
                        remove={remove}
                        puedeResponder={canComment}
                        /* Responder a una respuesta sigue EL MISMO hilo: la raiz
                           la decide `raizDeLaRespuesta`, no esta pantalla. Un
                           tercer nivel lo rechazaria la base de datos. */
                        onResponder={() => setRespondiendo({ raiz: raizDeLaRespuesta(r), texto: '' })}
                      />
                    </li>
                  ))}

                  {respondiendo?.raiz === h.comentario.id && (
                    <li>
                      <form
                        className="space-y-2"
                        onSubmit={(e) => {
                          e.preventDefault()
                          const texto = respondiendo.texto.trim()
                          if (texto.length >= 2 && userId) {
                            create.mutate({ texto, menciones: [], padre: respondiendo.raiz })
                          }
                        }}
                      >
                        {/* SIN CHINCHETAS DE MENCION en una respuesta, y no es
                            un olvido: al autor del comentario contestado le
                            avisa ya la propia respuesta -«ha respondido a tu
                            comentario», 0036-, y al resto del hilo tambien.
                            Ofrecer ademas la lista de personas seria pedir dos
                            veces lo mismo. Para avisar a alguien que no esta en
                            el hilo esta el comentario de abajo. */}
                        <MarkupEditor
                          rows={2}
                          value={respondiendo.texto}
                          onChange={(texto) => setRespondiendo({ raiz: respondiendo.raiz, texto })}
                          placeholder="Responder…"
                          aria-label="Respuesta al comentario"
                          autoFocus
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                              e.preventDefault()
                              e.currentTarget.form?.requestSubmit()
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              e.stopPropagation()
                              setRespondiendo(null)
                            }
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            type="submit" size="sm"
                            loading={create.isPending}
                            disabled={respondiendo.texto.trim().length < 2}
                          >
                            <Reply /> Responder
                          </Button>
                          <Button
                            type="button" size="sm" variant="ghost"
                            onClick={() => setRespondiendo(null)}
                          >
                            <X /> Cancelar
                          </Button>
                        </div>
                      </form>
                    </li>
                  )}
                </ul>
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
            if (text.trim().length >= 2 && userId) {
              create.mutate({ texto: text, menciones: mentions, padre: null })
            }
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
                if (text.trim().length >= 2 && userId) {
                  create.mutate({ texto: text, menciones: mentions, padre: null })
                }
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


/**
 * Un comentario del hilo: el mismo dibujo para un comentario y para una
 * respuesta.
 *
 * ESTA EXTRAIDO PORQUE SE PINTA EN DOS SITIOS, y de haberlo copiado habrian
 * acabado diferentes: el boton de editar en uno y no en el otro, o la marca
 * de «editado» solo en los de primer nivel. Lo que cambia entre los dos no es
 * el comentario, es donde se coloca.
 */
function Comentario({
  c, userId, nameOf, editando, setEditando, editar, remove, puedeResponder, onResponder,
}: {
  c: CommentWithAuthor
  userId: string | null
  nameOf: (id: string) => string
  editando: { id: string; texto: string } | null
  setEditando: (v: { id: string; texto: string } | null) => void
  editar: { mutate: (v: { id: string; texto: string }) => void; isPending: boolean }
  remove: { mutate: (id: string) => void }
  puedeResponder: boolean
  onResponder: () => void
}) {
  return (
    <div className="flex gap-2">
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
                  {/* RESPONDER ES UN ENLACE DE TEXTO Y NO UN ICONO al lado de
                      editar y borrar: esos dos son del autor y van a la
                      derecha, y este lo tiene cualquiera que pueda comentar.
                      Un tercer icono en ese grupo diría que es del mismo
                      tipo, y en móvil se aplastarían los tres. */}
                  {puedeResponder && (
                    <button
                      type="button"
                      onClick={onResponder}
                      className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <Reply className="size-3" aria-hidden /> Responder
                    </button>
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
    </div>
  )
}
