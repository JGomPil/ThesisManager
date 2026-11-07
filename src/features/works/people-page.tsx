import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/app/layout/app-shell'
import { Card } from '@/components/ui/card'
import { Badge, ToneBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useRowLink } from '@/components/common/row-link'
import { qk } from '@/lib/query-keys'
import { peopleRepo } from '@/data/repositories/people.repo'
import { worksRepo } from '@/data/repositories/works.repo'
import { useAuth } from '@/features/auth/auth-context'

/**
 * Directorio de personas con sus relaciones académicas.
 *
 * Una sola fila por persona, aunque tenga cinco funciones distintas en cinco
 * trabajos: no se duplican cuentas para representar papeles.
 *
 * QUIÉN SALE AQUÍ no lo decide esta pantalla: lo decide `profiles_select`
 * (migración 0016). Antes bastaba compartir organización, y como el despliegue
 * es UNA organización, cualquiera con cuenta tenía aquí el nombre y el correo
 * de todo el grupo. Ahora se ve a quien participa en algún trabajo visible, y
 * la administración ve a todos. La pantalla no filtra nada: si filtrara, el
 * límite dependería de que ella acertara, y la lista completa seguiría estando
 * a una petición de distancia.
 */
export function PeoplePage() {
  const { isOrgAdmin, organizationId } = useAuth()
  // La fila entera abre la ficha de la persona. Las insignias de trabajo que
  // hay dentro siguen llevando a su trabajo: `useRowLink` no navega cuando el
  // clic cae sobre un enlace.
  const rowLink = useRowLink()
  const people = useQuery({ queryKey: qk.people.directory, queryFn: peopleRepo.directory })
  const works = useQuery({ queryKey: qk.works.list({}), queryFn: () => worksRepo.list({}) })
  // Quién administra el grupo. Va aparte del directorio porque no es un dato
  // del perfil: administrar el grupo y participar en un trabajo son los dos
  // ejes independientes de SECURITY.md §2.
  const orgMembers = useQuery({
    queryKey: qk.people.orgMembers(organizationId ?? ''),
    queryFn: () => peopleRepo.orgMembers(organizationId!),
    enabled: organizationId !== null,
  })

  if (people.isLoading || works.isLoading) return <LoadingPanel />
  if (people.isError) return <ErrorPanel error={people.error} />
  if (works.isError) return <ErrorPanel error={works.error} />

  const rows = people.data ?? []
  const allWorks = works.data ?? []
  // `OWNER` y `ADMIN` son hoy lo mismo en todo el sistema: `app.is_org_admin`
  // pregunta `role in ('OWNER','ADMIN')`. Se muestran con la misma insignia
  // porque mostrar dos nombres para la misma capacidad engaña.
  const administran = new Set(
    (orgMembers.data ?? []).filter((m) => m.role !== 'MEMBER').map((m) => m.user_id),
  )

  // Las relaciones de cada persona, una sola vez para las dos vistas.
  const filas = rows.map((p) => ({
    p,
    relaciones: allWorks.flatMap((w) =>
      w.members
        .filter((m) => m.user_id === p.id && m.status === 'ACTIVE')
        .map((m) => ({ work: w, role: m.role })),
    ),
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Personas"
        description="Cada persona tiene una única cuenta. Sus funciones se definen trabajo a trabajo."
      />

      {/* Decirlo evita la lectura equivocada: una lista corta no es un error
          de datos ni «falta gente», es el alcance de quien mira. */}
      <p className="text-sm text-muted-foreground">
        {isOrgAdmin
          ? 'Como administración, ves a todas las personas del grupo.'
          : 'Ves a las personas con las que compartes algún trabajo. Quien no tiene relación contigo no aparece aquí.'}{' '}
        La insignia <strong>Administración</strong> señala a quien administra el grupo: quien da de
        alta a otras personas y gestiona los catálogos.
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="Sin personas visibles"
          description="Aparecerán aquí las personas con las que compartas algún trabajo."
        />
      ) : (
        <>
          {/* MÓVIL: una ficha por persona. En la tabla, «Relaciones
              académicas» es la columna más ancha y la última, o sea la que
              nunca se ve en un teléfono sin arrastrar hasta el final; y es
              justamente lo que se viene a consultar. */}
          <Card className="divide-y sm:hidden">
            {filas.map(({ p, relaciones }) => (
              <div
                key={p.id}
                className="flex cursor-pointer gap-3 p-3 active:bg-accent"
                {...rowLink(`/personas/${p.id}`)}
              >
                <Avatar name={p.full_name} src={p.avatar_url} size="md" />
                <div className="min-w-0 flex-1">
                <p className="font-medium">
                  <Link to={`/personas/${p.id}`} className="hover:underline">{p.full_name}</Link>
                  {administran.has(p.id) && (
                    <Badge variant="secondary" className="ml-1.5 align-middle">Administración</Badge>
                  )}
                </p>
                {/* El correo, entero: recortado no se puede ni leer ni copiar,
                    y `break-words` parte también una palabra larga sin
                    espacios, que es exactamente lo que es un correo. */}
                <p className="break-words text-sm text-muted-foreground">
                  <a href={`mailto:${p.email}`} className="hover:underline">{p.email}</a>
                </p>
                {p.department && <p className="text-sm text-muted-foreground">{p.department}</p>}
                {relaciones.length === 0 ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">Sin relaciones académicas contigo.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {relaciones.map(({ work, role }, i) => (
                      <Link key={`${work.id}-${i}`} to={`/trabajos/${work.id}`} title={work.title}>
                        <ToneBadge tone={role?.is_student ? 'sky' : 'violet'}>
                          {role?.name} · {work.work_type?.short_name}
                        </ToneBadge>
                      </Link>
                    ))}
                  </div>
                )}
                </div>
              </div>
            ))}
          </Card>

          <Card className="hidden sm:block">
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
              {filas.map(({ p, relaciones }) => {
                return (
                  <TableRow key={p.id} className="cursor-pointer" {...rowLink(`/personas/${p.id}`)}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Avatar name={p.full_name} src={p.avatar_url} size="sm" />
                        <Link to={`/personas/${p.id}`} className="min-w-0 truncate hover:underline">
                          {p.full_name}
                        </Link>
                        {administran.has(p.id) && (
                          <Badge variant="secondary" className="shrink-0">Administración</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.department ?? '—'}</TableCell>
                    <TableCell>
                      {relaciones.length === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {relaciones.map(({ work, role }, i) => (
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
        </>
      )}
    </div>
  )
}
