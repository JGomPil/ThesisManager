import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArchiveRestore, Trash2, Undo2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ToneBadge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { worksRepo, type WorkWithRelations } from '@/data/repositories/works.repo'
import * as React from 'react'

/**
 * Trabajos archivados, con restauración.
 *
 * Esta pantalla existe porque sin ella el archivado sería un borrado: un
 * trabajo archivado no aparece en ningún listado. La política de SELECT de
 * `academic_works` deja ver lo archivado únicamente a la administración
 * (migración 0008), así que para cualquier otro usuario esta consulta devuelve
 * cero filas aunque llegase a abrir la ruta a mano.
 */
export function ArchivedWorksPage() {
  const qc = useQueryClient()
  const toast = useToast()

  const works = useQuery({ queryKey: qk.works.archived, queryFn: worksRepo.listArchived })

  const [toDestroy, setToDestroy] = React.useState<WorkWithRelations | null>(null)

  const destroy = useMutation({
    mutationFn: (id: string) => worksRepo.destroy(id),
    onSuccess: ({ removedFiles }) => {
      void qc.invalidateQueries({ queryKey: qk.works.archived })
      void qc.invalidateQueries({ queryKey: qk.works.all })
      toast.push(
        'success',
        removedFiles > 0
          ? `Trabajo eliminado definitivamente, junto con ${removedFiles} fichero(s).`
          : 'Trabajo eliminado definitivamente.',
      )
      setToDestroy(null)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const restore = useMutation({
    mutationFn: (id: string) => worksRepo.restore(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.works.archived })
      void qc.invalidateQueries({ queryKey: qk.works.all })
      toast.push('success', 'Trabajo restaurado. Vuelve a estar visible para sus participantes.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (works.isLoading) return <LoadingPanel />
  if (works.isError) return <ErrorPanel error={works.error} />

  const rows = works.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trabajos archivados"
        breadcrumb={[{ label: 'Administración', to: '/admin' }, { label: 'Archivados' }]}
        description="Archivar no borra nada. Desde aquí puedes devolver un trabajo a la circulación."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No hay trabajos archivados"
          description="Cuando archives un trabajo aparecerá aquí, y podrás restaurarlo."
          action={<Button asChild variant="outline"><Link to="/trabajos">Ver trabajos activos</Link></Button>}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trabajo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Archivado</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.title}</TableCell>
                    <TableCell>
                      {w.work_type && (
                        <ToneBadge tone={w.work_type.color}>{w.work_type.short_name}</ToneBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {w.deleted_at
                        ? format(parseISO(w.deleted_at), "d MMM yyyy 'a las' HH:mm", { locale: es })
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          loading={restore.isPending && restore.variables === w.id}
                          onClick={() => restore.mutate(w.id)}
                        >
                          <Undo2 /> Restaurar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10"
                          onClick={() => setToDestroy(w)}
                        >
                          <Trash2 /> Eliminar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ArchiveRestore className="mt-0.5 size-3.5 shrink-0" />
        Archivar conserva el historial íntegro (tareas, reuniones y documentos) y es reversible.
        <strong className="font-medium">Eliminar</strong> no lo es: borra el trabajo y todo lo que
        contiene, incluidos los ficheros. Reservado a la administración.
      </p>

      <DestroyDialog
        work={toDestroy}
        onCancel={() => setToDestroy(null)}
        onConfirm={(id) => destroy.mutate(id)}
        pending={destroy.isPending}
      />
    </div>
  )
}

/**
 * Confirmación del borrado definitivo.
 *
 * Exige escribir el título del trabajo. No es por ceremonia: la operación
 * arrastra en cascada los participantes, las fases, los hitos, las tareas, las
 * reuniones con sus actas y notas privadas, los documentos con sus versiones y
 * sus ficheros, los comentarios, las notificaciones y el registro de actividad.
 * Un clic de más en una fila equivocada borraría el trabajo de un alumno sin
 * posibilidad de recuperarlo: no hay copias automáticas en el plan gratuito
 * (ver BACKUP.md). Escribir el título obliga a mirar qué fila se ha elegido.
 */
function DestroyDialog({
  work, onCancel, onConfirm, pending,
}: {
  work: WorkWithRelations | null
  onCancel: () => void
  onConfirm: (id: string) => void
  pending: boolean
}) {
  const [typed, setTyped] = React.useState('')

  React.useEffect(() => { setTyped('') }, [work?.id])

  if (!work) return null
  const matches = typed.trim() === work.title.trim()

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive">Eliminar definitivamente</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                Se borrarán <strong>«{work.title}»</strong> y todo lo que contiene:
                participantes, fases, hitos, tareas, reuniones con sus actas y notas privadas,
                documentos con todas sus versiones y sus ficheros, comentarios, notificaciones
                y el registro de actividad.
              </p>
              <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                <span>
                  <strong>No se puede deshacer</strong> y el plan gratuito no tiene copias de
                  seguridad automáticas. Si solo quieres quitarlo de la vista, cancela y déjalo
                  archivado: ocupa prácticamente nada.
                </span>
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="confirm-title">
            Escribe el título del trabajo para confirmar
          </Label>
          <Input
            id="confirm-title"
            className="mt-1.5"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={work.title}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={!matches}
            loading={pending}
            onClick={() => onConfirm(work.id)}
          >
            <Trash2 /> Eliminar para siempre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
