import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, Undo2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { worksRepo } from '@/data/repositories/works.repo'

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
                      <Button
                        size="sm"
                        variant="outline"
                        loading={restore.isPending && restore.variables === w.id}
                        onClick={() => restore.mutate(w.id)}
                      >
                        <Undo2 /> Restaurar
                      </Button>
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
        Los trabajos no se borran nunca de la base de datos: tienen valor académico y su historial
        (tareas, reuniones y documentos) se conserva íntegro mientras están archivados.
      </p>
    </div>
  )
}
