import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, FileText, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ToneBadge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { errorMessage } from '@/lib/supabase'
import { templatesRepo } from '@/data/repositories/templates.repo'
import { useDocumentTypes } from '@/hooks/use-catalogs'
import type { TemplateDocumentRow } from '@/data/types/database'

/**
 * Lo que hay que ENTREGAR en todos los trabajos de este tipo.
 *
 * NO ES MATERIAL DE REFERENCIA, y la distinción es la que da sentido a las dos
 * secciones vecinas:
 *  · el material de plantilla se LEE y vive en la plantilla (una rúbrica
 *    corregida se corrige para todos los trabajos en curso);
 *  · un documento previsto se ENTREGA, así que al aplicar la plantilla nace una
 *    ficha en el trabajo y deja de depender de ella.
 *
 * Por eso corregir aquí un nombre no renombra nada en los trabajos ya creados,
 * y el texto del pie lo dice: es la clase de cosa que, si no se avisa, se
 * descubre tarde.
 *
 * El formulario de abajo añade Y corrige, como en los hitos: dos juegos de
 * campos serían la misma validación escrita dos veces.
 */
export function TemplateDocumentsCard({
  templateId, documents, onChanged,
}: {
  templateId: string
  documents: TemplateDocumentRow[]
  onChanged: () => void
}) {
  const toast = useToast()
  const tipos = useDocumentTypes()

  const [nombre, setNombre] = React.useState('')
  const [tipo, setTipo] = React.useState('')
  const [obligatorio, setObligatorio] = React.useState(true)
  const [descripcion, setDescripcion] = React.useState('')
  const [editandoId, setEditandoId] = React.useState<string | null>(null)
  const campoNombre = React.useRef<HTMLInputElement>(null)

  const editando = documents.find((d) => d.id === editandoId) ?? null

  const limpiar = () => {
    setEditandoId(null)
    setNombre('')
    setTipo('')
    setObligatorio(true)
    setDescripcion('')
  }

  const guardar = useMutation({
    mutationFn: () => {
      const campos = {
        name: nombre.trim(),
        document_type_id: tipo || null,
        description: descripcion.trim() || null,
        is_required: obligatorio,
      }
      return editandoId
        ? templatesRepo.updateDocument(editandoId, campos)
        : templatesRepo.addDocument({
            ...campos,
            template_id: templateId,
            // Al final de la lista, que es donde se espera que caiga lo nuevo.
            order_index: documents.reduce((max, d) => Math.max(max, d.order_index), -1) + 1,
          })
    },
    onSuccess: () => { onChanged(); limpiar() },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const borrar = useMutation({
    mutationFn: (id: string) => templatesRepo.removeDocument(id),
    onSuccess: () => { onChanged(); if (editandoId) limpiar() },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const empezarEdicion = (d: TemplateDocumentRow) => {
    setEditandoId(d.id)
    setNombre(d.name)
    setTipo(d.document_type_id ?? '')
    setObligatorio(d.is_required)
    setDescripcion(d.description ?? '')
    campoNombre.current?.focus()
  }

  return (
    <div className="space-y-3">
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin documentos previstos. Al aplicar la plantilla, el panel de documentos del trabajo
          empieza en blanco y nadie sabe qué falta hasta que es tarde.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {documents.map((d) => {
            const tipoNombre = (tipos.data ?? []).find((t) => t.id === d.document_type_id)?.name
            return (
              <li key={d.id} className="flex items-start gap-2 py-2 first:pt-0">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{d.name}</span>
                    {tipoNombre && <ToneBadge tone="slate">{tipoNombre}</ToneBadge>}
                    <ToneBadge tone={d.is_required ? 'amber' : 'slate'}>
                      {d.is_required ? 'obligatorio' : 'opcional'}
                    </ToneBadge>
                  </p>
                  {d.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{d.description}</p>
                  )}
                </div>
                <Button
                  variant="ghost" size="icon" className="size-7"
                  onClick={() => empezarEdicion(d)} aria-label={`Editar ${d.name}`}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="size-7"
                  onClick={() => borrar.mutate(d.id)} aria-label={`Quitar ${d.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <form
        className="space-y-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (nombre.trim().length >= 2) guardar.mutate()
        }}
      >
        {editando && (
          <p className="text-xs text-muted-foreground">
            Editando «{editando.name}». No cambia nada en los trabajos ya creados.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Input
            ref={campoNombre}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Memoria final"
            aria-label="Nombre del documento previsto"
            className="min-w-[8rem] flex-1"
          />
          <Select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipo de documento"
            className="w-auto"
          >
            <option value="">Sin clasificar</option>
            {(tipos.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
        <Textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={2}
          placeholder="Qué se espera exactamente (formato, extensión, idioma…)"
          aria-label="Descripción del documento previsto"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              checked={obligatorio}
              onChange={(e) => setObligatorio(e.target.checked)}
            />
            Obligatorio
          </label>
          <div className="flex gap-2">
            {editando && (
              <Button type="button" size="sm" variant="ghost" onClick={limpiar}>
                <X /> Cancelar
              </Button>
            )}
            <Button
              type="submit" size="sm" variant="outline"
              loading={guardar.isPending}
              disabled={nombre.trim().length < 2}
            >
              {editando ? <><Check /> Guardar</> : <><Plus /> Añadir</>}
            </Button>
          </div>
        </div>
      </form>

      <p className="text-xs text-muted-foreground">
        Al aplicar la plantilla, cada uno de estos aparece en el trabajo como «pendiente de
        entregar», sin ninguna versión. Marcar algo como obligatorio sirve para que se vea que
        falta: no impide cerrar nada.
      </p>
    </div>
  )
}
