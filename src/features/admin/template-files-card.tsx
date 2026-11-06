import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { ExternalLink, Link2, Paperclip, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { errorMessage } from '@/lib/supabase'
import { templatesRepo } from '@/data/repositories/templates.repo'
import type { TemplateFileRow } from '@/data/types/database'

/**
 * Material de referencia de una plantilla: el guion, la rúbrica, el formato de
 * portada. Sirve igual para la plantilla entera y para una de sus tareas; la
 * diferencia es `templateTaskId`.
 *
 * NO SE COPIA NADA AL APLICAR LA PLANTILLA. La tarea creada guarda de qué tarea
 * de plantilla sale y lee este mismo material (migración 0014). Por eso cambiar
 * la rúbrica aquí la cambia en todos los trabajos, incluidos los que ya están
 * en marcha, que es justo lo que se quiere de un documento común; y por eso
 * quitarla de aquí la quita de todos.
 *
 * DOS ORÍGENES, como en los documentos de un trabajo: fichero subido al cubo
 * privado, o enlace externo (Drive institucional, web del departamento). El
 * enlace no sube nada y no cuenta para el gigabyte del plan gratuito, así que
 * para un documento que ya vive en la nube de la universidad es la mejor
 * opción.
 */
export function TemplateFilesCard({
  templateId, templateTaskId, files, onChanged,
}: {
  templateId: string
  /** Nulo = material de la plantilla entera. */
  templateTaskId: string | null
  files: TemplateFileRow[]
  onChanged: () => void
}) {
  const toast = useToast()
  const [origen, setOrigen] = React.useState<'FILE' | 'LINK'>('FILE')
  const [titulo, setTitulo] = React.useState('')
  const [enlace, setEnlace] = React.useState('')
  const [fichero, setFichero] = React.useState<File | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const limpiar = () => {
    setTitulo(''); setEnlace(''); setFichero(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const anadir = useMutation({
    mutationFn: async () => {
      // El identificador lo pone el cliente para que la carpeta del objeto y la
      // fila coincidan: si la fila no llegara a crearse, el fichero queda en una
      // carpeta que nadie referencia, localizable y limpiable.
      const id = crypto.randomUUID()
      if (origen === 'FILE') {
        if (!fichero) throw new Error('Elige un fichero.')
        const path = await templatesRepo.uploadFile(fichero, templateId, id)
        return templatesRepo.addFile({
          id,
          template_id: templateId,
          template_task_id: templateTaskId,
          title: titulo.trim() || fichero.name,
          storage_path: path,
          mime_type: fichero.type || null,
          size_bytes: fichero.size,
        })
      }
      const url = enlace.trim()
      if (!/^https?:\/\//i.test(url)) throw new Error('El enlace debe empezar por http:// o https://')
      return templatesRepo.addFile({
        id,
        template_id: templateId,
        template_task_id: templateTaskId,
        title: titulo.trim() || url,
        external_url: url,
      })
    },
    onSuccess: () => { onChanged(); limpiar(); toast.push('success', 'Material añadido.') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const quitar = useMutation({
    mutationFn: (f: TemplateFileRow) => templatesRepo.removeFile(f),
    onSuccess: () => { onChanged(); toast.push('success', 'Material retirado.') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const descargar = async (f: TemplateFileRow) => {
    try {
      if (f.external_url) { window.open(f.external_url, '_blank', 'noopener,noreferrer'); return }
      const url = await templatesRepo.downloadUrl(f.storage_path!)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.push('error', errorMessage(e))
    }
  }

  return (
    <div className="space-y-2">
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin material. Lo que adjuntes aquí lo verán todos los trabajos que usen esta plantilla.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 py-1.5">
              {f.external_url
                ? <Link2 className="size-4 shrink-0 text-muted-foreground" />
                : <Paperclip className="size-4 shrink-0 text-muted-foreground" />}
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left hover:underline"
                onClick={() => void descargar(f)}
                title={f.external_url ?? f.storage_path ?? ''}
              >
                {f.title}
              </button>
              {f.size_bytes !== null && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.max(1, Math.round(f.size_bytes / 1024))} KB
                </span>
              )}
              <Button
                size="icon" variant="ghost" className="size-7"
                onClick={() => {
                  if (confirm(`¿Retirar «${f.title}»? Dejará de estar disponible en todos los trabajos que usen esta plantilla.`)) {
                    quitar.mutate(f)
                  }
                }}
                aria-label={`Retirar ${f.title}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-2 border-t pt-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          anadir.mutate()
        }}
      >
        <div>
          <Label htmlFor={`origen-${templateTaskId ?? templateId}`}>Origen</Label>
          <Select
            id={`origen-${templateTaskId ?? templateId}`}
            className="mt-1.5"
            value={origen}
            onChange={(e) => setOrigen(e.target.value as 'FILE' | 'LINK')}
          >
            <option value="FILE">Subir el fichero aquí</option>
            <option value="LINK">Enlace externo (no ocupa espacio)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`tit-${templateTaskId ?? templateId}`}>Nombre visible</Label>
          <Input
            id={`tit-${templateTaskId ?? templateId}`}
            className="mt-1.5" placeholder="Rúbrica de evaluación"
            value={titulo} onChange={(e) => setTitulo(e.target.value)}
          />
        </div>
        {origen === 'FILE' ? (
          <div className="sm:col-span-2">
            <Label htmlFor={`fich-${templateTaskId ?? templateId}`}>Fichero</Label>
            <input
              id={`fich-${templateTaskId ?? templateId}`}
              ref={inputRef}
              type="file"
              className="mt-1.5 block w-full rounded-md border border-input bg-background p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm"
              onChange={(e) => setFichero(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Máximo 10 MB. Material común, nunca datos de ninguna persona concreta.
            </p>
          </div>
        ) : (
          <div className="sm:col-span-2">
            <Label htmlFor={`url-${templateTaskId ?? templateId}`}>Enlace</Label>
            <Input
              id={`url-${templateTaskId ?? templateId}`}
              className="mt-1.5" placeholder="https://uva-my.sharepoint.com/…"
              value={enlace} onChange={(e) => setEnlace(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              No se sube nada: se guarda el enlace. Quien lo abra necesitará permiso en ese servicio.
            </p>
          </div>
        )}
        <div className="sm:col-span-2">
          <Button
            type="submit" size="sm" variant="outline" loading={anadir.isPending}
            disabled={origen === 'FILE' ? !fichero : enlace.trim().length === 0}
          >
            {origen === 'FILE' ? <Upload /> : <ExternalLink />} Añadir material
          </Button>
        </div>
      </form>
    </div>
  )
}
