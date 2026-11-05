import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Plus, Search } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ToneBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { qk } from '@/lib/query-keys'
import { worksRepo } from '@/data/repositories/works.repo'
import { useAcademicYears, useWorkStatuses, useWorkTypes } from '@/hooks/use-catalogs'
import { useAuth } from '@/features/auth/auth-context'
import { resolveWorkCapabilities } from '@/domain/permissions/work-capabilities'
import { daysUntil } from '@/domain/works/progress'

export function WorksListPage() {
  const [params, setParams] = useSearchParams()
  const { userId, isOrgAdmin } = useAuth()

  const tipo = params.get('tipo') ?? ''
  const estado = params.get('estado') ?? ''
  const curso = params.get('curso') ?? ''
  const contexto = params.get('contexto') ?? ''
  const q = params.get('q') ?? ''

  const workTypes = useWorkTypes()
  const statuses = useWorkStatuses()
  const years = useAcademicYears()

  const filters = {
    workTypeId: tipo || undefined,
    statusId: estado || undefined,
    academicYearId: curso || undefined,
    search: q || undefined,
  }
  const works = useQuery({ queryKey: qk.works.list(filters), queryFn: () => worksRepo.list(filters) })

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const rows = (works.data ?? []).filter((w) => {
    if (!contexto) return true
    const caps = resolveWorkCapabilities(w.members, userId, false)
    if (contexto === 'supervisor') return caps.isSupervisor
    if (contexto === 'estudiante') return caps.isStudent
    return true
  })

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trabajos académicos"
        description={
          contexto === 'supervisor'
            ? 'Trabajos en los que tienes función de supervisión.'
            : contexto === 'estudiante'
              ? 'Trabajos en los que participas como estudiante.'
              : 'Todos los trabajos a los que tienes acceso.'
        }
        actions={
          isOrgAdmin && (
            <Button asChild>
              <Link to="/trabajos/nuevo"><Plus /> Nuevo trabajo</Link>
            </Button>
          )
        }
      />

      <Card className="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por título…"
              className="pl-8"
              defaultValue={q}
              onChange={(e) => setParam('q', e.target.value)}
            />
          </div>

          <Select value={tipo} onChange={(e) => setParam('tipo', e.target.value)} aria-label="Tipo de trabajo">
            <option value="">Todos los tipos</option>
            {(workTypes.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>

          <Select value={estado} onChange={(e) => setParam('estado', e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            {(statuses.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>

          <Select value={curso} onChange={(e) => setParam('curso', e.target.value)} aria-label="Curso académico">
            <option value="">Todos los cursos</option>
            {(years.data ?? []).map((y) => (
              <option key={y.id} value={y.id}>{y.code}</option>
            ))}
          </Select>
        </div>
      </Card>

      {works.isLoading && <LoadingPanel />}
      {works.isError && <ErrorPanel error={works.error} />}

      {works.data && rows.length === 0 && (
        <EmptyState
          icon={BookOpen}
          title="No hay trabajos que mostrar"
          description={
            isOrgAdmin
              ? 'Crea el primer trabajo o ajusta los filtros.'
              : 'Cuando te asignen a un trabajo, aparecerá aquí.'
          }
          action={
            isOrgAdmin && (
              <Button asChild size="sm"><Link to="/trabajos/nuevo"><Plus /> Nuevo trabajo</Link></Button>
            )
          }
        />
      )}

      {rows.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Estudiante</TableHead>
                <TableHead>Dirección</TableHead>
                <TableHead>Fin previsto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((w) => {
                const students = w.members.filter((m) => m.status === 'ACTIVE' && m.role?.is_student)
                const supervisors = w.members.filter((m) => m.status === 'ACTIVE' && m.role?.is_supervisory)
                const days = daysUntil(w.expected_end_date)
                return (
                  <TableRow key={w.id}>
                    <TableCell className="max-w-[22rem]">
                      <Link to={`/trabajos/${w.id}`} className="font-medium hover:underline">
                        <span className="line-clamp-2">{w.title}</span>
                      </Link>
                    </TableCell>
                    <TableCell><ToneBadge tone={w.work_type?.color ?? null}>{w.work_type?.short_name}</ToneBadge></TableCell>
                    <TableCell><ToneBadge tone={w.status?.color ?? null}>{w.status?.name}</ToneBadge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {students.map((s) => s.profile?.full_name).filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {supervisors.find((s) => s.is_primary)?.profile?.full_name ??
                        supervisors[0]?.profile?.full_name ??
                        '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {w.expected_end_date ? (
                        <span className={days !== null && days < 0 && !w.status?.is_terminal ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                          {format(parseISO(w.expected_end_date), 'd MMM yyyy', { locale: es })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
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
