import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, Mail } from 'lucide-react'
import { PageHeader } from '@/app/layout/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Badge, ToneBadge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { peopleRepo, type OrgRole } from '@/data/repositories/people.repo'
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
const PAPELES: Record<OrgRole, string> = {
  OWNER: 'Propietario',
  ADMIN: 'Administrador',
  MEMBER: 'Miembro',
}

export function PersonPage() {
  const { id = '' } = useParams()
  const { userId, isOrgAdmin, organizationId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  const person = useQuery({
    queryKey: qk.people.detail(id),
    queryFn: () => peopleRepo.byId(id),
    enabled: id.length > 0,
  })
  const works = useQuery({ queryKey: qk.works.list({}), queryFn: () => worksRepo.list({}) })

  // Solo lo pide la administración: es la única que puede cambiar esto, y el
  // resto de la ficha no lo necesita para dibujarse.
  const orgMembers = useQuery({
    queryKey: qk.people.orgMembers(organizationId ?? ''),
    queryFn: () => peopleRepo.orgMembers(organizationId!),
    enabled: isOrgAdmin && organizationId !== null,
  })

  const cambiarPapel = useMutation({
    mutationFn: (role: OrgRole) => peopleRepo.setOrgRole(organizationId!, id, role),
    onSuccess: (_d, role) => {
      void qc.invalidateQueries({ queryKey: qk.people.orgMembers(organizationId ?? '') })
      // Si uno se lo cambia a sí mismo, lo que decide qué menús se dibujan es
      // `memberships` del contexto de autenticación: sin invalidarlo, la
      // pantalla seguiría comportándose como administradora hasta recargar.
      void qc.invalidateQueries({ queryKey: qk.myMemberships })
      toast.push('success', `Papel actualizado: ${PAPELES[role].toLowerCase()}.`)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

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

  // `OWNER` y `ADMIN` son hoy lo mismo: `app.is_org_admin` pregunta
  // `role in ('OWNER','ADMIN')`. Para contar administradores, lo que importa es
  // «no es MEMBER».
  const miembros = orgMembers.data ?? []
  const suMembresia = miembros.find((m) => m.user_id === p.id)
  const administran = miembros.filter((m) => m.role !== 'MEMBER')
  const esUltimoAdmin = administran.length === 1 && administran[0]?.user_id === p.id

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

        {/* EL PAPEL ADMINISTRATIVO, aquí y no en una pantalla de administración
            aparte: se busca mirando a la persona. Solo lo ve y lo cambia la
            administración, pero eso no lo garantiza esta tarjeta —lo garantiza
            `org_members_write`—, igual que el resto de la ficha. */}
        {isOrgAdmin && organizationId !== null && (
          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Papel en el grupo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0 text-sm">
              {orgMembers.isLoading ? (
                <p className="text-muted-foreground">Cargando…</p>
              ) : suMembresia === undefined ? (
                <p className="text-muted-foreground">
                  Esta persona no pertenece al grupo: tiene cuenta y no ve nada. Se autoriza desde{' '}
                  <Link to="/admin" className="text-primary hover:underline">Administración</Link>,
                  en la tarjeta de cuentas pendientes.
                </p>
              ) : (
                <>
                  <div className="max-w-xs">
                    <Label htmlFor="org-role">Papel administrativo</Label>
                    <Select
                      id="org-role"
                      className="mt-1.5"
                      value={suMembresia.role}
                      disabled={cambiarPapel.isPending}
                      onChange={(e) => cambiarPapel.mutate(e.target.value as OrgRole)}
                    >
                      {/* Quitarle el papel al único administrador no se ofrece,
                          y además lo impide el disparador de la 0023: la
                          pantalla avisa, la base de datos protege. */}
                      <option value="MEMBER" disabled={esUltimoAdmin}>Miembro</option>
                      <option value="ADMIN">Administrador</option>
                      <option value="OWNER">Propietario</option>
                    </Select>
                  </div>

                  <p className="text-muted-foreground">
                    Administrar el grupo <strong>no es</strong> dirigir trabajos: son dos cosas
                    independientes. Quien administra da de alta cuentas, gestiona los catálogos y
                    las plantillas y ve todos los trabajos del grupo; las funciones académicas se
                    asignan trabajo a trabajo. Podéis ser varios administradores sin problema.
                  </p>

                  <p className="text-xs text-muted-foreground">
                    «Propietario» y «Administrador» tienen hoy exactamente las mismas capacidades:
                    todo el sistema pregunta por los dos juntos. La diferencia es solo una etiqueta.
                  </p>

                  {esUltimoAdmin && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
                      {esUnoMismo ? 'Eres el único administrador' : 'Es la única administración'} del
                      grupo, así que ese papel no se puede retirar todavía: nombra antes a otra
                      persona. El papel de administrador solo lo concede un administrador, de modo
                      que un grupo sin ninguno no tendría forma de recuperarlo desde la aplicación.
                      No es solo este aviso: la base de datos lo rechaza (migración 0023).
                    </p>
                  )}

                  {esUnoMismo && !esUltimoAdmin && suMembresia.role !== 'MEMBER' && (
                    <p className="text-xs text-muted-foreground">
                      Si te quitas el papel a ti mismo, solo podrá devolvértelo otro administrador.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
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
      <span className="break-words text-right">{valor || '—'}</span>
    </div>
  )
}
