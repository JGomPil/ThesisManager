import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToneBadge } from '@/components/ui/badge'
import { ErrorPanel, Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { catalogsRepo } from '@/data/repositories/catalogs.repo'
import { FilaCatalogo } from '@/features/admin/catalog-row'
import { useAuth } from '@/features/auth/auth-context'
import type { DocumentTypeRow } from '@/data/types/database'

/**
 * Tipos de documento: qué clases de entregable existen.
 *
 * DOS CLASES DE FILA, Y LA DIFERENCIA SE VE
 * Las que trae el catálogo inicial (memoria, plan, estado del arte…) son
 * GLOBALES: `organization_id` nulo, compartidas por todas las organizaciones.
 * Las que se crean aquí son de la organización. Las globales se pueden
 * renombrar y retirar, **pero no borrar**: `documents.document_type_id` es
 * `on delete set null`, así que borrar una no da error, deja en blanco el tipo
 * de todos los documentos que la usaban y no queda rastro de cuál era. En un
 * catálogo compartido eso sería perder el dato de otra organización, y para eso
 * no hay deshacer.
 *
 * Los propios sí se borran, y solo si no los usa nadie: con uso, el botón no
 * aparece. La prohibición de verdad está en la migración 0021 —las políticas y
 * el disparador `doctypes_org_inmutable`— y no en que este formulario no pinte
 * un botón.
 */
export function DocumentTypesCard() {
  const { organizationId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [editando, setEditando] = React.useState<DocumentTypeRow | null>(null)
  const [nombre, setNombre] = React.useState('')
  const [orden, setOrden] = React.useState('')
  const campoNombre = React.useRef<HTMLInputElement>(null)

  const tipos = useQuery({ queryKey: qk.catalogs.allDocumentTypes, queryFn: catalogsRepo.listAllDocumentTypes })
  const uso = useQuery({ queryKey: qk.catalogs.documentTypeUsage, queryFn: catalogsRepo.documentTypeUsage })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.catalogs.allDocumentTypes })
    void qc.invalidateQueries({ queryKey: qk.catalogs.documentTypes })
    void qc.invalidateQueries({ queryKey: qk.catalogs.documentTypeUsage })
  }

  const limpiar = () => { setEditando(null); setNombre(''); setOrden('') }

  const codigoDesde = (texto: string) =>
    texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)

  const guardar = useMutation({
    mutationFn: async () => {
      const campos = { name: nombre.trim(), display_order: orden === '' ? 0 : Number(orden) }
      if (editando) return catalogsRepo.updateDocumentType(editando.id, campos)
      if (!organizationId) throw new Error('No hay organización en la sesión.')
      return catalogsRepo.createDocumentType({
        ...campos,
        organization_id: organizationId,
        code: codigoDesde(nombre),
      })
    },
    onSuccess: () => { invalidate(); limpiar() },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const retirar = useMutation({
    mutationFn: (t: DocumentTypeRow) => catalogsRepo.updateDocumentType(t.id, { is_active: !t.is_active }),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const borrar = useMutation({
    mutationFn: (id: string) => catalogsRepo.removeDocumentType(id),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const empezar = (t: DocumentTypeRow) => {
    setEditando(t); setNombre(t.name); setOrden(String(t.display_order))
    campoNombre.current?.focus()
  }

  const filas = tipos.data ?? []
  const cuenta = uso.data ?? {}

  return (
    <div className="space-y-3">
      {tipos.isLoading ? <Spinner /> : tipos.isError ? <ErrorPanel error={tipos.error} /> : (
        <ul className="space-y-1.5">
          {filas.map((t) => {
            const global = t.organization_id === null
            return (
              <FilaCatalogo
                key={t.id}
                nombre={t.name}
                codigo={t.code}
                retirado={!t.is_active}
                enUso={cuenta[t.id] ?? 0}
                badges={global
                  ? <ToneBadge tone="slate">común a todo el grupo</ToneBadge>
                  : <ToneBadge tone="sky">propio</ToneBadge>}
                onEditar={() => empezar(t)}
                onRetirar={() => retirar.mutate(t)}
                // Un tipo común no se borra: se retira. Ver la cabecera.
                onBorrar={global ? undefined : () => borrar.mutate(t.id)}
              />
            )
          })}
        </ul>
      )}

      <form
        className="space-y-2 border-t pt-3"
        onSubmit={(e) => { e.preventDefault(); if (nombre.trim().length >= 2) guardar.mutate() }}
      >
        <p className="text-xs text-muted-foreground">
          {editando
            ? `Editando «${editando.name}»${editando.organization_id === null ? ', que es común a todo el grupo' : ''}. Su código (${editando.code}) no se cambia.`
            : `Nuevo tipo propio del grupo${nombre.trim() ? `, con código ${codigoDesde(nombre)}` : ''}.`}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1 space-y-1">
            <Label htmlFor="doctipo-nombre">Nombre</Label>
            <Input id="doctipo-nombre" ref={campoNombre} value={nombre}
              onChange={(e) => setNombre(e.target.value)} placeholder="Póster de congreso" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="doctipo-orden">Orden</Label>
            <Input id="doctipo-orden" type="number" value={orden}
              onChange={(e) => setOrden(e.target.value)} className="w-[5.5rem]" />
          </div>
          {editando && (
            <Button type="button" size="sm" variant="ghost" onClick={limpiar}>
              <X /> Cancelar
            </Button>
          )}
          <Button type="submit" size="sm" variant="outline"
            loading={guardar.isPending} disabled={nombre.trim().length < 2}>
            {editando ? <><Check /> Guardar</> : <><Plus /> Añadir</>}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Los tipos «comunes a todo el grupo» se pueden renombrar y retirar, pero no borrar: al
          borrar uno, los documentos que lo usaban se quedarían sin tipo y sin rastro de cuál era.
          Retirar lo quita de los formularios y conserva lo ya escrito.
        </p>
      </form>
    </div>
  )
}
