import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, Mail } from 'lucide-react'
import { PageHeader } from '@/app/layout/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Badge, ToneBadge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { qk } from '@/lib/query-keys'
import { peopleRepo } from '@/data/repositories/people.repo'
import { worksRepo } from '@/data/repositories/works.repo'
import { useAuth } from '@/features/auth/auth-context'

/**
 * Ficha de una persona, de solo lectura.
 *
 * POR QUÉ EXISTE
 * En «Personas» una fila cabe en cuatro columnas, y el departamento, el puesto,
 * el ORCID y la información académica no caben en ninguna. Estaban guardados y
 * no había forma de leerlos: solo los veía cada uno de sí mismo, en su perfil.
 *
 * SOLO LECTURA, Y NO POR LA PANTALLA
 * Aquí no hay formulario porque nadie edita el perfil de otra persona, pero eso
 * no lo garantiza esta pantalla: lo garantiza `profiles_update`, que solo deja
 * escribir la fila propia. Si esta página tuviera campos editables, el guardado
 * fallaría; no al contrario.
 *
 * «NO VISIBLE» Y «NO EXISTE» SE VEN IGUAL
 * `peopleRepo.byId` no lleva filtro: `profiles_select` (0016/0017) devuelve 0
 * filas cuando quien mira no tiene relación con esa persona. El mensaje es el
 * mismo en los dos casos a propósito: distinguirlos convertiría esta dirección
 * en un comprobador de existencia de cuentas —se prueba un identificador y la
 * diferencia entre «no existe» y «no puedes verlo» ya es información.
 *
 * LAS RELACIONES SON LAS VISIBLES PARA QUIEN MIRA
 * Se derivan de `worksRepo.list({})`, o sea de los trabajos que ve el que
 * pregunta, no de todos los de esa persona. Un director ve en la ficha de su
 * estudiante los trabajos que comparten, no los que lleva con otro director.
 * Por eso el texto del pie dice «contigo»: no es una biografía completa.
 */
export function PersonPage() {
  const { id = '' } = useParams()
  const { userId, isOrgAdmin } = useAuth()

  const person = useQuery({
    queryKey: qk.people.detail(id),
    queryFn: () => peopleRepo.byId(id),
    enabled: id.length > 0,
  })
  const works = useQuery({ queryKey: qk.works.list({}), queryFn: () => worksRepo.list({}) })

  if (person.isLoading || works.isLoading) return <LoadingPanel />
  if (person.isError) return <ErrorPanel error={person.error} />
  if (works.isError) return <ErrorPanel error={works.error} />

  const p = person.data
  if (!p) {
    return (
      <div className="space-y-4">
        <PageHeader title="Persona" breadcrumb={[{ label: 'Personas', to: '/personas' }]} />
        <EmptyState
          title="Ficha no disponible"
          description="No tienes relación académica con esta persona, o la dirección no corresponde a ninguna ficha."
        />
      </div>
    )
  }

  const esUnoMismo = p.id === userId

  // Todas sus participaciones en trabajos visibles, las vigentes primero. Las
  // pasadas NO se esconden: saber quién dirigió un trabajo que ya acabó es
  // justo lo que se viene a consultar aquí.
  const relaciones = works.data
    ?.flatMap((w) => w.members.filter((m) => m.user_id === p.id).map((m) => ({ work: w, m })))
    .sort((a, b) => Number(b.m.status === 'ACTIVE') - Number(a.m.status === 'ACTIVE')) ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title={p.full_name}
        description={p.position ?? undefined}
        breadcrumb={[{ label: 'Personas', to: '/personas' }]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <Avatar name={p.full_name} src={p.avatar_url} size="xl" className="shrink-0" />
              <div className="min-w-0 space-y-1.5">
                <h2 className="text-lg font-semibold leading-tight">{p.full_name}</h2>
                {p.position && <p className="text-sm text-muted-foreground">{p.position}</p>}
                <p className="text-sm">
                  <a
                    href={`mailto:${p.email}`}
                    className="inline-flex items-center gap-1.5 break-all text-primary hover:underline"
                  >
                    <Mail className="size-3.5 shrink-0" aria-hidden />
                    {p.email}
                  </a>
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {!p.is_active && <Badge variant="secondary">Cuenta desactivada</Badge>}
                  {esUnoMismo && <Badge variant="secondary">Eres tú</Badge>}
                </div>
                {esUnoMismo && (
                  <p className="pt-1 text-sm text-muted-foreground">
                    Esto es lo que ven de ti las personas con las que trabajas.{' '}
                    <Link to="/perfil" className="text-primary hover:underline">
                      Editarlo en mi perfil
                    </Link>
                    .
                  </p>
                )}
              </div>
            </div>

            {p.bio && (
              <div className="mt-6 border-t pt-4">
                <h3 className="text-sm font-medium">Información académica</h3>
                {/* `whitespace-pre-line`: se escribió en un área de texto con
                    saltos de línea, y sin esto se leería como un párrafo único. */}
                <p className="mt-1.5 whitespace-pre-line break-words text-sm text-muted-foreground">{p.bio}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Datos</CardTitle></CardHeader>
          <CardContent className="space-y-2 pt-0 text-sm">
            <Dato label="Departamento" valor={p.department} />
            <Dato label="Puesto" valor={p.position} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">ORCID</span>
              {p.orcid ? (
                <a
                  href={`https://orcid.org/${p.orcid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                >
                  {p.orcid}
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <p className="border-t pt-2 text-xs text-muted-foreground">
              No se guardan DNI, teléfono ni dirección. Solo lo necesario para la gestión académica.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Relaciones académicas</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {relaciones.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {esUnoMismo
                ? 'Todavía no participas en ningún trabajo.'
                : isOrgAdmin
                  ? 'No participa en ningún trabajo.'
                  : 'No compartís ningún trabajo. Ves su ficha por otra vía.'}
            </p>
          ) : (
            <ul className="divide-y">
              {relaciones.map(({ work, m }) => (
                <li key={m.id} className="py-2 first:pt-0 last:pb-0">
                  <Link to={`/trabajos/${work.id}`} className="group block">
                    <p className="font-medium group-hover:underline">{work.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ToneBadge tone={work.work_type?.color ?? null}>
                        {work.work_type?.short_name}
                      </ToneBadge>
                      <ToneBadge tone={work.status?.color ?? null}>{work.status?.name}</ToneBadge>
                      <span className="text-sm text-muted-foreground">{m.role?.name}</span>
                      {m.status !== 'ACTIVE' && <Badge variant="secondary">ya no participa</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
            Se listan los trabajos que tú puedes ver. Si participa en otros sin relación contigo, no
            aparecen aquí.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right">{valor || '—'}</span>
    </div>
  )
}
