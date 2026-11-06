import { useQuery } from '@tanstack/react-query'
import { BookOpen, Link2, Paperclip } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { ErrorPanel } from '@/components/common/states'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { templatesRepo } from '@/data/repositories/templates.repo'
import type { TemplateFileRow } from '@/data/types/database'

/**
 * Material de referencia de la tarea: lo que la dirección dejó adjunto en la
 * plantilla de la que sale esta tarea (migración 0014).
 *
 * NO ES UNA COPIA. La tarea guarda `template_task_id` y el material se lee de
 * la plantilla, así que corregir una rúbrica la corrige en todos los trabajos,
 * también en los que ya están en marcha. Es deliberado: un documento común que
 * se copia treinta veces deja de ser común en cuanto se toca una de las copias.
 *
 * Lo ve todo el que pueda ver la tarea, estudiantes incluidos: es material
 * pensado para que lo lean. Lo garantiza `tfiles_select` (prueba [103]), no
 * esta pantalla.
 *
 * SOLO LECTURA. Quitarlo o cambiarlo se hace en la plantilla, donde se ve a
 * cuántos trabajos afecta; desde una tarea suelta, borrar material común sería
 * un estropicio silencioso en los demás trabajos.
 */
export function TaskReferenceMaterial({ templateTaskId }: { templateTaskId: string }) {
  const toast = useToast()
  const material = useQuery({
    queryKey: qk.templates.taskFiles(templateTaskId),
    queryFn: () => templatesRepo.filesForTemplateTask(templateTaskId),
    staleTime: 5 * 60 * 1000,
  })

  const abrir = async (f: TemplateFileRow) => {
    try {
      if (f.external_url) { window.open(f.external_url, '_blank', 'noopener,noreferrer'); return }
      const url = await templatesRepo.downloadUrl(f.storage_path!)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.push('error', errorMessage(e))
    }
  }

  // Mientras carga no se anuncia nada: la mayoría de las tareas no traen
  // material y un hueco vacío con «cargando» en cada ficha sería ruido.
  if (material.isLoading) return null
  if (material.isError) return <ErrorPanel error={material.error} />
  const rows = material.data ?? []
  if (rows.length === 0) return null

  return (
    <section className="border-t pt-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <BookOpen className="size-3.5" /> Material de referencia
      </h3>
      <ul className="space-y-1">
        {rows.map((f) => (
          <li key={f.id} className="flex items-start gap-2 text-sm">
            {f.external_url
              ? <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              : <Paperclip className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1">
              <button type="button" className="text-left hover:underline" onClick={() => void abrir(f)}>
                {f.title}
              </button>
              {f.description && (
                <span className="block text-xs text-muted-foreground">{f.description}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Viene de la plantilla del plan: es el mismo material para todos los trabajos de este tipo.
      </p>
    </section>
  )
}
