import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, BookOpen, ChevronDown, ChevronUp, ChevronsUpDown, Plus, Search } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ToneBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, ErrorPanel, LoadingPanel } from '@/components/common/states'
import { useRowLink } from '@/components/common/row-link'
import { cn, toneEdgeClass } from '@/lib/utils'
import { qk } from '@/lib/query-keys'
import { worksRepo } from '@/data/repositories/works.repo'
import { errorMessage } from '@/lib/supabase'
import { useAcademicYears, useWorkStatuses, useWorkTypes } from '@/hooks/use-catalogs'
import { useAuth } from '@/features/auth/auth-context'
import { resolveWorkCapabilities } from '@/domain/permissions/work-capabilities'
import { daysUntil } from '@/domain/works/progress'
import { alPulsar, leeOrden, ordena } from '@/domain/works/list-order'
import type { ColumnaOrden, Orden } from '@/domain/works/list-order'

export function WorksListPage() {
  const [params, setParams] = useSearchParams()
  const { userId, isOrgAdmin } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  // La fila entera abre el trabajo, no solo el título. Ver `useRowLink`.
  const rowLink = useRowLink()
  const [toArchive, setToArchive] = React.useState<{ id: string; title: string } | null>(null)

  const archive = useMutation({
    mutationFn: (id: string) => worksRepo.archive(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.works.all })
      void qc.invalidateQueries({ queryKey: qk.works.archived })
      toast.push('success', 'Trabajo archivado. Está en Administración → Trabajos archivados.')
      setToArchive(null)
    },
    onError: (e) => { toast.push('error', errorMessage(e)); setToArchive(null) },
  })

  const tipo = params.get('tipo') ?? ''
  const estado = params.get('estado') ?? ''
  const curso = params.get('curso') ?? ''
  const contexto = params.get('contexto') ?? ''
  const q = params.get('q') ?? ''
  /**
   * EL ORDEN VIVE EN LA URL, como los filtros de al lado y por lo mismo: el
   * enlace que se pega en un correo lleva lo que se estaba mirando, y recargar
   * no deshace el orden elegido. `leeOrden` valida, porque una dirección la
   * escribe cualquiera.
   */
  const orden = leeOrden(params.get('orden'), params.get('dir'))

  const ordenarPor = (columna: ColumnaOrden) => {
    const siguiente = alPulsar(orden, columna)
    const next = new URLSearchParams(params)
    next.set('orden', siguiente.columna)
    next.set('dir', siguiente.sentido)
    setParams(next, { replace: true })
  }

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

  /**
   * Lo derivado de cada fila, UNA sola vez: lo consumen la tabla (escritorio) y
   * las tarjetas (móvil). Calcularlo en cada vista era la forma segura de que
   * un día dijeran cosas distintas.
   */
  const filas = rows.map((w) => {
    const estudiantes = w.members
      .filter((m) => m.status === 'ACTIVE' && m.role?.is_student)
      .map((m) => m.profile?.full_name)
      .filter(Boolean)
      .join(', ')
    /**
     * TODA la dirección, no solo quien figure como principal.
     *
     * Un trabajo codirigido mostraba un único nombre y el del codirector no
     * aparecía en ninguna parte de esta pantalla: para saber quién más lo
     * dirigía había que abrir la ficha. El informe de un trabajo ya los
     * nombraba todos, así que las dos pantallas decían cosas distintas del
     * mismo trabajo.
     *
     * El principal va primero, que es el orden en que se nombra una dirección.
     * Y los nombres se deduplican porque una misma persona puede tener VARIAS
     * funciones en el mismo trabajo (codirectora y colaboradora, por ejemplo):
     * son dos filas de `work_members` y una sola persona.
     */
    const supervisores = w.members.filter((m) => m.status === 'ACTIVE' && m.role?.is_supervisory)
    const direccion = [
      ...new Set(
        supervisores
          .slice()
          .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
          .map((m) => m.profile?.full_name)
          .filter((n): n is string => Boolean(n)),
      ),
    ].join(', ')
    const dias = daysUntil(w.expected_end_date)
    return {
      w,
      estudiantes: estudiantes || '—',
      direccion: direccion || '—',
      dias,
      vencido: dias !== null && dias < 0 && !w.status?.is_terminal,
    }
  })

  /**
   * SE ORDENAN LAS FILAS DERIVADAS, no las de la consulta: dos de las seis
   * columnas —«Estudiante» y «Dirección»— no existen en la base de datos, se
   * arman aquí arriba. Y se ordena una sola vez, de modo que la tabla del
   * escritorio y las tarjetas del móvil enseñan lo mismo en el mismo orden.
   *
   * Sin orden elegido se respeta el de la consulta (`created_at` descendente,
   * lo más nuevo primero), que es lo que había antes de que esto existiera.
   */
  const filasOrdenadas = orden === null ? filas : ordena(
    filas,
    (f) => ({
      titulo: f.w.title,
      tipo: f.w.work_type?.short_name ?? '',
      estado: f.w.status?.name ?? '',
      estadoOrden: f.w.status?.display_order ?? 0,
      estudiante: f.estudiantes,
      direccion: f.direccion,
      fin: f.w.expected_end_date,
    }),
    orden,
  )

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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
        <>
          {/* MÓVIL: tarjetas. Una tabla de siete columnas en una pantalla de
              390 px se convierte en un carrusel horizontal donde la primera
              columna —el título, lo único que identifica la fila— es lo
              primero que se va. Aquí cada trabajo es una tarjeta pulsable
              entera, con lo que de verdad se busca: título, tipo, estado,
              quién y para cuándo.

              Se renderiza DOS veces el mismo dato y una de las dos está
              siempre oculta. Es deliberado: lo derivado (`filas`) se calcula
              una sola vez arriba, así que las dos vistas no pueden discrepar,
              y el coste es markup, no consultas. */}
          <Card className="divide-y sm:hidden">
            {filasOrdenadas.map(({ w, estudiantes, direccion, dias, vencido }) => (
              <div
                key={w.id}
                className={cn('cursor-pointer border-l-4 p-3 active:bg-accent', toneEdgeClass(w.work_type?.color))}
                {...rowLink(`/trabajos/${w.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/trabajos/${w.id}`} className="min-w-0 font-medium hover:underline">
                    <span className="line-clamp-2">{w.title}</span>
                  </Link>
                  {isOrgAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-mr-1 -mt-1 shrink-0"
                      aria-label={`Archivar ${w.title}`}
                      loading={archive.isPending && archive.variables === w.id}
                      onClick={() => setToArchive({ id: w.id, title: w.title })}
                    >
                      <Archive />
                    </Button>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <ToneBadge tone={w.work_type?.color ?? null}>{w.work_type?.short_name}</ToneBadge>
                  <ToneBadge tone={w.status?.color ?? null}>{w.status?.name}</ToneBadge>
                </div>

                <dl className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                  <div className="flex gap-1.5">
                    <dt className="shrink-0">Estudiante:</dt>
                    <dd className="min-w-0 break-words text-foreground">{estudiantes}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="shrink-0">Dirección:</dt>
                    <dd className="min-w-0 break-words">{direccion}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="shrink-0">Fin previsto:</dt>
                    <dd className={vencido ? 'font-medium text-destructive' : undefined}>
                      {w.expected_end_date
                        ? format(parseISO(w.expected_end_date), 'd MMM yyyy', { locale: es })
                        : '—'}
                      {vencido && dias !== null && ` · ${Math.abs(dias)} días de retraso`}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </Card>

          <Card className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <Cabecera columna="titulo" orden={orden} onOrdenar={ordenarPor}>Título</Cabecera>
                <Cabecera columna="tipo" orden={orden} onOrdenar={ordenarPor}>Tipo</Cabecera>
                <Cabecera columna="estado" orden={orden} onOrdenar={ordenarPor}>Estado</Cabecera>
                <Cabecera columna="estudiante" orden={orden} onOrdenar={ordenarPor}>Estudiante</Cabecera>
                <Cabecera columna="direccion" orden={orden} onOrdenar={ordenarPor}>Dirección</Cabecera>
                <Cabecera columna="fin" orden={orden} onOrdenar={ordenarPor}>Fin previsto</Cabecera>
                {isOrgAdmin && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filasOrdenadas.map(({ w, estudiantes, direccion, vencido }) => {
                return (
                  <TableRow key={w.id} className="cursor-pointer" {...rowLink(`/trabajos/${w.id}`)}>
                    {/* La franja del tipo, al principio de la fila: es lo que
                        permite ver de un golpe cuántos TFG y cuántas tesis hay
                        en un listado de cuarenta trabajos. */}
                    <TableCell className={cn('max-w-[22rem] border-l-4', toneEdgeClass(w.work_type?.color))}>
                      <Link to={`/trabajos/${w.id}`} className="font-medium hover:underline">
                        <span className="line-clamp-2">{w.title}</span>
                      </Link>
                    </TableCell>
                    <TableCell><ToneBadge tone={w.work_type?.color ?? null}>{w.work_type?.short_name}</ToneBadge></TableCell>
                    <TableCell><ToneBadge tone={w.status?.color ?? null}>{w.status?.name}</ToneBadge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{estudiantes}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{direccion}</TableCell>
                    <TableCell className="text-sm">
                      {w.expected_end_date ? (
                        <span className={vencido ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                          {format(parseISO(w.expected_end_date), 'd MMM yyyy', { locale: es })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {/* Archivar también desde el listado: es donde se busca,
                        no dentro de la ficha. Lo que de verdad lo impide a
                        quien no es administrador es el disparador
                        app.enforce_soft_delete_scope() (migración 0008). */}
                    {isOrgAdmin && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Archivar ${w.title}`}
                          title="Archivar"
                          loading={archive.isPending && archive.variables === w.id}
                          onClick={() => setToArchive({ id: w.id, title: w.title })}
                        >
                          <Archive />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </Card>
        </>
      )}

      <Dialog open={toArchive !== null} onOpenChange={(v) => { if (!v) setToArchive(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Archivar «{toArchive?.title}»?</DialogTitle>
            <DialogDescription>
              Desaparece de los listados y de la vista de sus participantes, pero{' '}
              <strong>no se borra</strong>. Podrás restaurarlo desde{' '}
              <strong>Administración → Trabajos archivados</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToArchive(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              loading={archive.isPending}
              onClick={() => { if (toArchive) archive.mutate(toArchive.id) }}
            >
              <Archive /> Archivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Una cabecera que ordena al pulsarla.
 *
 * `aria-sort` EN EL `<th>` Y NO EN EL BOTÓN: es el atributo con el que un
 * lector de pantalla anuncia «ordenado de forma ascendente» al entrar en la
 * columna, y solo lo entiende sobre la celda de cabecera. Sin él, quien no ve
 * la flecha no tiene forma de saber por dónde está ordenada la tabla.
 *
 * La flecha se dibuja SIEMPRE, también en las columnas inactivas (ahí, doble y
 * apagada): una cabecera que solo parece pulsable cuando ya la has pulsado no
 * se descubre nunca.
 */
function Cabecera({
  columna, orden, onOrdenar, children,
}: {
  columna: ColumnaOrden
  orden: Orden | null
  onOrdenar: (columna: ColumnaOrden) => void
  children: React.ReactNode
}) {
  const activa = orden?.columna === columna
  const ascendente = activa && orden.sentido === 'asc'

  return (
    <TableHead
      aria-sort={activa ? (ascendente ? 'ascending' : 'descending') : 'none'}
      className={cn('p-0', activa && 'text-foreground')}
    >
      {/* El botón ocupa la celda entera (`w-full`, el relleno aquí y no en el
          `<th>`): el sitio al que se apunta para ordenar es la cabecera, no
          las letras. */}
      <button
        type="button"
        onClick={() => onOrdenar(columna)}
        title={`Ordenar por ${String(children).toLowerCase()}`}
        className={cn(
          'flex h-10 w-full items-center gap-1 px-3 text-left uppercase tracking-wide transition-colors',
          'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
      >
        {children}
        {activa ? (
          ascendente ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
        )}
      </button>
    </TableHead>
  )
}
