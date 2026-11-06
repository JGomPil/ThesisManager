import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, Download, ExternalLink, FileText, Link2, MessageSquare, Paperclip, Plus,
  ShieldAlert, Upload,
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
import { errorMessage } from '@/lib/supabase'
import {
  REVIEW_STATUSES, documentsRepo, type DocumentWithVersions,
} from '@/data/repositories/documents.repo'
import { tasksRepo } from '@/data/repositories/tasks.repo'
import { useDocumentTypes } from '@/hooks/use-catalogs'
import { DocumentDetailDialog } from '@/features/documents/document-detail-dialog'
import { documentFormSchema, type DocumentFormValues } from '@/schemas/work'
import type { DocumentReviewStatus } from '@/data/types/database'
import type { WorkCapabilities } from '@/domain/permissions/work-capabilities'

/**
 * Documentos del trabajo, con versiones y estado de revisión.
 *
 * DOS ORÍGENES, UNA MISMA FICHA. Una versión puede ser un fichero alojado en el
 * cubo privado de Supabase (`storage_path`) o un enlace a un fichero que vive
 * fuera (`external_url`), por ejemplo en el Drive institucional. Lo previó el
 * esquema de la Fase 0 con un `check` de que haya al menos uno de los dos, y es
 * deliberado: hay material que no conviene duplicar aquí, y para ese caso basta
 * con registrar el enlace, la versión y su estado de revisión.
 *
 * LOS DOCUMENTOS CUELGAN DEL TRABAJO, no de la tarea: una memoria o un artículo
 * pertenecen al trabajo entero. El vínculo con una tarea es opcional y sirve
 * para decir «este borrador es el entregable de esto».
 */
export function DocumentsCard({
  workId, caps, userId, taskId,
}: {
  workId: string
  caps: WorkCapabilities
  userId: string | null
  /** Si se indica, se muestran solo los documentos vinculados a esa tarea. */
  taskId?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [abierto, setAbierto] = React.useState<string | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const docs = useQuery({
    queryKey: qk.documents.byWork(workId),
    queryFn: () => documentsRepo.byWork(workId),
  })

  /**
   * Cuántos comentarios tiene cada versión, en UNA consulta para todo el
   * trabajo. Sin esto no habría forma de saber que hay algo escrito sin abrir
   * cada documento, y un comentario que no se ve es un comentario perdido.
   *
   * Si falla —por ejemplo porque la migración 0015 no está aplicada— se queda
   * en un objeto vacío y el resto de la tarjeta sigue funcionando: el recuento
   * es un adorno, los documentos no.
   */
  const comentarios = useQuery({
    queryKey: qk.documents.commentCounts(workId),
    queryFn: () => documentsRepo.commentCounts(workId),
  })

  const archive = useMutation({
    mutationFn: (id: string) => documentsRepo.archive(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.documents.byWork(workId) })
      toast.push('success', 'Documento archivado. No se ha borrado nada.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const review = useMutation({
    mutationFn: ({ versionId, status }: { versionId: string; status: DocumentReviewStatus }) =>
      documentsRepo.setReviewStatus(versionId, status, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.documents.byWork(workId) })
      toast.push('success', 'Estado de revisión actualizado.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const download = async (storagePath: string) => {
    try {
      const url = await documentsRepo.downloadUrl(storagePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.push('error', errorMessage(e))
    }
  }

  if (docs.isLoading) return <LoadingPanel label="Cargando documentos…" />
  if (docs.isError) return <ErrorPanel error={docs.error} />

  const all = docs.data ?? []
  const rows = taskId ? all.filter((d) => d.task_id === taskId) : all

  const body = (
    <>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {taskId
            ? 'No hay documentos vinculados a esta tarea.'
            : 'Todavía no hay documentos. Sube una memoria, un artículo o registra el enlace a uno que viva fuera.'}
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((d) => (
            <DocumentRowItem
              key={d.id}
              doc={d}
              caps={caps}
              userId={userId}
              showTask={!taskId}
              comentarios={comentarios.data ?? {}}
              onOpen={() => setAbierto(d.id)}
              onDownload={download}
              onArchive={() => archive.mutate(d.id)}
              onReview={(versionId, status) => review.mutate({ versionId, status })}
            />
          ))}
        </ul>
      )}

      {caps.isMember && (
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen(true)}>
          <Plus /> Añadir documento
        </Button>
      )}

      <DocumentDetailDialog
        doc={rows.find((d) => d.id === abierto) ?? null}
        open={abierto !== null}
        onOpenChange={(v) => { if (!v) setAbierto(null) }}
        caps={caps}
        userId={userId}
        workId={workId}
      />

      <NewDocumentDialog
        open={open}
        onOpenChange={setOpen}
        workId={workId}
        userId={userId}
        fixedTaskId={taskId}
      />
    </>
  )

  // Dentro de la ficha de una tarea no se envuelve en otra tarjeta.
  if (taskId) return <div>{body}</div>

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="size-4 text-muted-foreground" /> Documentos
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{body}</CardContent>
    </Card>
  )
}

function DocumentRowItem({
  doc, caps, userId, showTask, comentarios, onOpen, onDownload, onArchive, onReview,
}: {
  doc: DocumentWithVersions
  caps: WorkCapabilities
  userId: string | null
  showTask: boolean
  /** Recuento de comentarios por versión, para no abrir a ciegas. */
  comentarios: Record<string, number>
  onOpen: () => void
  onDownload: (path: string) => void
  onArchive: () => void
  onReview: (versionId: string, status: DocumentReviewStatus) => void
}) {
  const last = doc.versions[0]
  const status = REVIEW_STATUSES.find((s) => s.value === last?.review_status)
  const totalComentarios = doc.versions.reduce((n, v) => n + (comentarios[v.id] ?? 0), 0)

  return (
    <li className="py-2.5 first:pt-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* El nombre abre la ficha: versiones y, en cada una, su hilo de
                comentarios. Antes el nombre no llevaba a ningún sitio y las
                versiones anteriores no se podían ni ver. */}
            <button type="button" className="text-left text-sm font-medium hover:underline" onClick={onOpen}>
              {doc.name}
            </button>
            {doc.document_type && <ToneBadge tone="slate">{doc.document_type.name}</ToneBadge>}
            {status && <ToneBadge tone={status.tone}>{status.label}</ToneBadge>}
            {totalComentarios > 0 && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                onClick={onOpen}
              >
                <MessageSquare className="size-3" /> {totalComentarios}
              </button>
            )}
            {showTask && doc.task_id && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Paperclip className="size-3" /> vinculado a una tarea
              </span>
            )}
          </div>
          {doc.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{doc.description}</p>
          )}
          {last && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {last.version_label} · {last.author?.full_name ?? 'autoría desconocida'} ·{' '}
              {format(parseISO(last.submitted_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}
              {doc.versions.length > 1 && ` · ${doc.versions.length} versiones`}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {last?.storage_path && (
            <Button
              variant="ghost" size="icon" className="size-8"
              onClick={() => onDownload(last.storage_path!)}
              aria-label={`Descargar ${doc.name}`} title="Descargar"
            >
              <Download />
            </Button>
          )}
          {last?.external_url && (
            <Button asChild variant="ghost" size="icon" className="size-8" title="Abrir enlace externo">
              <a href={last.external_url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${doc.name}`}>
                <ExternalLink />
              </a>
            </Button>
          )}
          {/* Archivar: quien valida entregables, la administración, o el autor
              retirando lo suyo. Es el mismo reparto que la política
              `docs_update` de la migración 0010; aquí solo se evita mostrar un
              botón que iba a fallar. */}
          {(caps.canValidateDeliverables || doc.created_by === userId) && (
            <Button
              variant="ghost" size="icon" className="size-8" onClick={onArchive}
              aria-label={`Archivar ${doc.name}`} title={doc.created_by === userId ? 'Retirar' : 'Archivar'}
            >
              <Archive />
            </Button>
          )}
        </div>
      </div>

      {/* El estado de revisión solo lo cambia quien valida entregables. Quien
          entrega no puede aprobarse a sí mismo: lo impide la política
          `versions_update`, no este condicional. */}
      {caps.canValidateDeliverables && last && (
        <div className="mt-1.5">
          <Select
            className="h-8 w-auto text-xs"
            value={last.review_status}
            onChange={(e) => onReview(last.id, e.target.value as DocumentReviewStatus)}
            aria-label="Estado de revisión"
          >
            {REVIEW_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
      )}
    </li>
  )
}

function NewDocumentDialog({
  open, onOpenChange, workId, userId, fixedTaskId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  workId: string
  userId: string | null
  fixedTaskId?: string
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const types = useDocumentTypes()
  const [file, setFile] = React.useState<File | null>(null)

  const tasks = useQuery({
    queryKey: qk.tasks.byWork(workId),
    queryFn: () => tasksRepo.byWork(workId),
    enabled: open && !fixedTaskId,
  })

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: {
      name: '', document_type_id: '', description: '', task_id: fixedTaskId ?? '',
      source: 'FILE', external_url: '', version_label: 'v1',
    },
  })

  const source = form.watch('source')

  const save = useMutation({
    mutationFn: async (values: DocumentFormValues) => {
      if (values.source === 'FILE' && !file) throw new Error('Elige un fichero o cambia a enlace externo.')

      const doc = await documentsRepo.create({
        work_id: workId,
        task_id: values.task_id || null,
        document_type_id: values.document_type_id || null,
        name: values.name,
        description: values.description || null,
        created_by: userId,
      })

      // El fichero se sube DESPUÉS de crear la ficha porque la ruta lleva su
      // id, que es la llave de autorización del cubo. Si la subida falla, se
      // deshace la ficha para no dejar un documento sin ninguna versión: una
      // ficha vacía no significa nada y ensucia el listado.
      try {
        const storage_path = values.source === 'FILE'
          ? await documentsRepo.upload(file!, workId, doc.id)
          : null
        await documentsRepo.addVersion({
          document_id: doc.id,
          work_id: workId,
          version_label: values.version_label,
          storage_path,
          external_url: values.source === 'LINK' ? values.external_url! : null,
          author_id: userId,
        })
      } catch (e) {
        await documentsRepo.archive(doc.id).catch(() => undefined)
        throw e
      }
      return doc
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.documents.byWork(workId) })
      toast.push('success', 'Documento añadido.')
      form.reset()
      setFile(null)
      onOpenChange(false)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Añadir documento</DialogTitle>
          <DialogDescription>
            Puedes subir el fichero aquí o registrar solo el enlace a uno que viva fuera.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
          <div>
            <Label htmlFor="doc-name">Nombre</Label>
            <Input id="doc-name" className="mt-1.5" placeholder="Memoria final" {...form.register('name')} />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="doc-type">Tipo</Label>
              <Select id="doc-type" className="mt-1.5" {...form.register('document_type_id')}>
                <option value="">Sin clasificar</option>
                {(types.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="doc-version">Versión</Label>
              <Input id="doc-version" className="mt-1.5" {...form.register('version_label')} />
              <FieldError>{form.formState.errors.version_label?.message}</FieldError>
            </div>
          </div>

          {!fixedTaskId && (
            <div>
              <Label htmlFor="doc-task">Tarea vinculada (opcional)</Label>
              <Select id="doc-task" className="mt-1.5" {...form.register('task_id')}>
                <option value="">Ninguna: pertenece al trabajo</option>
                {(tasks.data ?? []).filter((t) => t.parent_task_id === null).map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="doc-source">Origen</Label>
            <Select id="doc-source" className="mt-1.5" {...form.register('source')}>
              <option value="FILE">Subir el fichero aquí</option>
              <option value="LINK">Registrar solo un enlace externo</option>
            </Select>
          </div>

          {source === 'FILE' ? (
            <div>
              <Label htmlFor="doc-file">Fichero</Label>
              <input
                id="doc-file"
                type="file"
                className="mt-1.5 block w-full rounded-md border border-input bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Máximo 25 MB por fichero.</p>
            </div>
          ) : (
            <div>
              <Label htmlFor="doc-url">Enlace</Label>
              <Input
                id="doc-url" className="mt-1.5" placeholder="https://uva-my.sharepoint.com/…"
                {...form.register('external_url')}
              />
              <FieldError>{form.formState.errors.external_url?.message}</FieldError>
              <p className="mt-1 text-xs text-muted-foreground">
                No se sube nada: se guarda el enlace, la versión y su estado de revisión.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="doc-desc">Descripción (opcional)</Label>
            <Textarea id="doc-desc" rows={2} className="mt-1.5" {...form.register('description')} />
          </div>

          {/* Advertencia explícita, no decorativa: en cuanto hay ficheros hay
              datos personales, y el repositorio de este proyecto es público
              aunque el cubo no lo sea. */}
          {source === 'FILE' && (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <span>
                Sube solo documentación académica. <strong>No subas datos clínicos
                identificativos ni información de pacientes</strong>, ni más datos personales
                de los necesarios. El fichero queda en un cubo privado, visible solo para los
                participantes de este trabajo, pero el responsable del dato sigues siendo tú:
                aplican el RGPD y las políticas de la Universidad de Valladolid.
              </span>
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" loading={save.isPending}>
              {source === 'FILE' ? <Upload /> : <Link2 />} Añadir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
