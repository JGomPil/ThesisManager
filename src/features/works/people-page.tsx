import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/app/layout/app-shell'
import { Card } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { qk } from '@/lib/query-keys'
import { peopleRepo } from '@/data/repositories/people.repo'
import { worksRepo } from '@/data/repositories/works.repo'

/**
 * Directorio de personas con sus relaciones académicas.
 *
 * Una sola fila por persona, aunque tenga cinco funciones distintas en cinco
 * trabajos: no se duplican cuentas para representar papeles.
 */
export function PeoplePage() {
  const people = useQuery({ queryKey: qk.people.directory, queryFn: peopleRepo.directory })
  const works = useQuery({ queryKey: qk.works.list({}), queryFn: () => worksRepo.list({}) })

  if (people.isLoading || works.isLoading) return <LoadingPanel />
  if (people.isError) return <ErrorPanel error={people.error} />
  if (works.isError) return <ErrorPanel error={works.error} />

  const rows = people.data ?? []
  const allWorks = works.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Personas"
        description="Cada persona tiene una única cuenta. Sus funciones se definen trabajo a trabajo."
      />

      {rows.length === 0 ? (
        <EmptyState title="Sin personas visibles" description="Solo ves a quienes comparten organización contigo." />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Departamento</TableHead>
                <TableHead>Relaciones académicas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const relations = allWorks.flatMap((w) =>
                  w.members
                    .filter((m) => m.user_id === p.id && m.status === 'ACTIVE')
                    .map((m) => ({ work: w, role: m.role })),
                )
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.full_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.department ?? '—'}</TableCell>
                    <TableCell>
                      {relations.length === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {relations.map(({ work, role }, i) => (
                            <Link key={`${work.id}-${i}`} to={`/trabajos/${work.id}`} title={work.title}>
                              <ToneBadge tone={role?.is_student ? 'sky' : 'violet'}>
                                {role?.name} · {work.work_type?.short_name}
                              </ToneBadge>
                            </Link>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
