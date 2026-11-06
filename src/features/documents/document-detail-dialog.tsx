import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, MessageSquare, Send, Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ToneBadge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/supabase'
import {
  REVIEW_STATUSES, documentsRepo,
  type DocumentVersionWithPeople, type DocumentWithVersions,
} from '@/data/repositories/documents.repo'
import type { DocumentReviewStatus } from '@/data/types/database'
import type { WorkCapabilities } from '@/domain/permissions/work-capabilities'

/**
 * Ficha de un documento: su historia de versiones y, en cada una, su hilo de
 * comentarios.
 *
 * POR QUÉ EL COMENTARIO VA EN LA VERSIÓN Y NO EN EL DOCUMENTO. «Falta la
 * justificación del tamaño de muestra» es verdad sobre la v2 y puede dejar de
 * serlo en la v3. Un comentario colgado del documento entero obliga a leer
 * todo el hilo y adivinar a qué borrador se refería cada frase; colgado de la
 * versión, se queda donde tiene sentido y la v3 empieza limpia. Eso es también
 * lo que hace útil mirar atrás: se ve qué se pidió en cada entrega.
 *
 * LO QUE NO HACE: anclar a una página o a un párrafo. Haría falta guardar una
 * posición dentro del fichero, y el fichero puede ser un PDF, un .docx o un
 * enlace al Drive de la universidad. Una referencia que no se puede resolver es
 * peor que ninguna.
 *
 * LOS COMENTARIOS NO SE EDITAN, solo se retiran por su autor (política
 * `doccomments_modify`/`doccomments_delete`). En una revisión académica importa
 * lo que se dijo: un comentario que cambia después de haber sido leído y
 * contestado deja la conversación sin sentido.
 */
export function DocumentDetailDialog({
  doc, open, onOpenChange, caps, userId, workId,
}: {
  doc: DocumentWithVersions | null
  open: boolean
  onOpenChange: (v: boolean) => void
  caps: WorkCapabilities
  userId: string | null
  workId: string
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [versionId, setVersionId] = React.useState<string | null>(null)

  // `doc.versions` viene de más reciente a más antigua: la que interesa al abrir
  // es la primera. Se recalcula si cambia el documento o llega una versión nueva.
  const elegida = versionId && doc?.versions.some((v) => v.id === versionId)
    ? versionId
    : doc?.versions[0]?.id ?? null

  const review = useMutation({
    mutationFn: ({ id, status }: { id: string; status: DocumentReviewStatus }) =>
      documentsRepo.setReviewStatus(id, status, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.documents.byWork(workId) })
      toast.push('success', 'Estado de revisión actualizado.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const descargar = async (v: DocumentVersionWithPeople) => {
    try {
      if (v.external_url) { window.open(v.external_url, '_blank', 'noopener,noreferrer'); return }
      const url = await documentsRepo.downloadUrl(v.storage_path!)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.push('error', errorMessage(e))
    }
  }

  if (!doc) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{doc.name}</DialogTitle>
          <DialogDescription>
            {doc.document_type?.name ?? 'Documento'}
            {doc.versions.length > 0 && ` · ${doc.versions.length} versión(es)`}
            {doc.description ? ` · ${doc.description}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {doc.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este documento no tiene ninguna versión todavía.
            </p>
          ) : (
            <>
              <ul className="divide-y rounded-lg border">
                {doc.versions.map((v) => {
                  const estado = REVIEW_STATUSES.find((s) => s.value === v.review_status)
                  const activa = v.id === elegida
                  return (
                    <li key={v.id} className={cn('p-2.5', activa && 'bg-muted/50')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setVersionId(v.id)}
                          aria-pressed={activa}
                        >
                          <span className="text-sm font-medium">{v.version_label}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {v.author?.full_name ?? 'autoría desconocida'} ·{' '}
                            {format(parseISO(v.submitted_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}
                          </span>
                        </button>
                        {estado && <ToneBadge tone={estado.tone}>{estado.label}</ToneBadge>}
                        <Button
                          variant="ghost" size="icon" className="size-8"
                          onClick={() => void descargar(v)}
                          aria-label={`Abrir ${v.version_label}`}
                          title={v.external_url ? 'Abrir el enlace' : 'Descargar'}
                        >
                          {v.external_url ? <ExternalLink /> : <Download />}
                        </Button>
                      </div>

                      {/* El estado lo cambia quien valida entregables. Quien
                          entrega no puede aprobarse a sí mismo: lo impide la
                          política `versions_update`, no este condicional. */}
                      {activa && caps.canValidateDeliverables && (
                        <Select
                          className="mt-2 h-8 w-auto text-xs"
                          value={v.review_status}
                          onChange={(e) => review.mutate({ id: v.id, status: e.target.value as DocumentReviewStatus })}
                          aria-label="Estado de revisión"
                        >
                          {REVIEW_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </Select>
                      )}

                      {activa && v.notes && (
                        <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-background p-2 text-xs text-muted-foreground">
                          Nota de la revisión: {v.notes}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>

              {elegida && (
                <VersionComments
                  versionId={elegida}
                  workId={workId}
                  userId={userId}
                  /* `caps.isMember` ya incluye a la administración del grupo
                     (ver `resolveWorkCapabilities`), que es exactamente a quien
                     la 0015 añadió a `doccomments_insert`. */
                  canComment={caps.isMember}
                />
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VersionComments({
  versionId, workId, userId, canComment,
}: {
  versionId: string
  workId: string
  userId: string | null
  canComment: boolean
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [texto, setTexto] = React.useState('')

  const hilo = useQuery({
    queryKey: qk.documents.comments(versionId),
    queryFn: () => documentsRepo.comments(versionId),
  })

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: qk.documents.comments(versionId) })
    void qc.invalidateQueries({ queryKey: qk.documents.commentCounts(workId) })
  }

  const enviar = useMutation({
    mutationFn: () => documentsRepo.addComment(versionId, userId!, texto.trim()),
    onSuccess: () => { invalidar(); setTexto('') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const quitar = useMutation({
    mutationFn: (id: string) => documentsRepo.removeComment(id),
    onSuccess: invalidar,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const filas = hilo.data ?? []

  return (
    <section className="rounded-lg border p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="size-3.5" /> Comentarios sobre esta versión
        {filas.length > 0 && <span className="tabular-nums normal-case">{filas.length}</span>}
      </h4>

      {hilo.isLoading && <LoadingPanel label="Cargando comentarios…" />}
      {hilo.isError && <ErrorPanel error={hilo.error} />}

      {hilo.data && filas.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Sin comentarios en esta versión. Los de las demás versiones siguen en las suyas.
        </p>
      )}

      {filas.length > 0 && (
        <ul className="space-y-2.5">
          {filas.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="flex items-center gap-2">
                <Avatar name={c.author?.full_name} src={c.author?.avatar_url} size="xs" />
                <span className="font-medium">{c.author?.full_name ?? 'Alguien'}</span>
                <span className="text-xs text-muted-foreground">
                  {format(parseISO(c.created_at), "d MMM yyyy, HH:mm", { locale: es })}
                </span>
                {c.author_id === userId && (
                  <Button
                    variant="ghost" size="icon" className="ml-auto size-6"
                    aria-label="Retirar mi comentario"
                    onClick={() => { if (confirm('¿Retirar tu comentario?')) quitar.mutate(c.id) }}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words">{c.content}</p>
            </li>
          ))}
        </ul>
      )}

      {canComment ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (texto.trim().length >= 2 && userId) enviar.mutate()
          }}
        >
          <Textarea
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Qué hay que corregir en esta versión…"
            aria-label="Nuevo comentario"
            onKeyDown={(e) => {
              // Ctrl/⌘+Enter envía, como en el resto de los hilos de la aplicación.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && texto.trim().length >= 2 && userId) {
                e.preventDefault()
                enviar.mutate()
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Se avisa a quien subió la versión, a quien ya haya comentado y a quien valide entregables.
            </p>
            <Button type="submit" size="sm" loading={enviar.isPending} disabled={texto.trim().length < 2}>
              <Send /> Comentar
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Solo pueden comentar quienes participan en el trabajo y la administración del grupo.
        </p>
      )}
    </section>
  )
}
