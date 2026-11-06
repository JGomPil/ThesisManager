import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Archive, Layers, ListChecks, Mail, Microscope, ShieldCheck, Users } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { PageHeader } from '@/app/layout/app-shell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { qk } from '@/lib/query-keys'
import { keepaliveHealth, maintenanceRepo } from '@/data/repositories/maintenance.repo'
import { cn } from '@/lib/utils'
import { PendingAccountsCard } from '@/features/admin/pending-accounts-card'
import { BackupCard } from '@/features/admin/backup-card'

const SECTIONS = [
  {
    to: '/admin/tipos',
    icon: Layers,
    title: 'Tipos de trabajo',
    description:
      'TFG, TFM, tesis, Academia de Alumnos Internos y los que necesites. Crear un tipo nuevo no requiere tocar el código.',
  },
  {
    to: '/admin/invitaciones',
    icon: Mail,
    title: 'Invitaciones',
    description:
      'Alta de usuarios en cola. El registro público está deshabilitado: nadie entra sin figurar aquí.',
  },
  {
    to: '/personas',
    icon: Users,
    title: 'Personas',
    description: 'Perfiles del grupo y sus relaciones académicas con cada trabajo.',
  },
  {
    to: '/admin/catalogos',
    icon: Microscope,
    title: 'Catálogos',
    description:
      'Líneas de investigación, titulaciones y cursos académicos: crear, editar, retirar y borrar.',
  },
  {
    to: '/admin/plantillas',
    icon: ListChecks,
    title: 'Plantillas de plan',
    description:
      'Planes de tareas reutilizables con fechas relativas. Aplicar una a un trabajo nuevo crea el plan completo de una vez.',
  },
  {
    to: '/admin/archivados',
    icon: Archive,
    title: 'Trabajos archivados',
    description:
      'Archivar un trabajo lo retira de los listados sin borrar nada. Desde aquí se restaura.',
  },
]

export function AdminHomePage() {
  const { data } = useQuery({ queryKey: qk.maintenance, queryFn: maintenanceRepo.status, retry: false })
  const health = keepaliveHealth(data)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Administración"
        description="Configuración del grupo. Los permisos administrativos son independientes de las funciones académicas."
      />

      {/* Lo que pide acción, antes del menú: una cuenta creada a mano no la ve
          nadie hasta que se autoriza. */}
      <PendingAccountsCard />

      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map(({ to, icon: Icon, title, description }) => (
          <Link key={to} to={to} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Icon className="size-4 text-muted-foreground" /> {title}
                </CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <BackupCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4 text-muted-foreground" /> Mantenimiento de la infraestructura
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Último mantenimiento registrado</span>
            <span
              className={cn(
                'font-medium',
                health.level === 'critical' && 'text-destructive',
                health.level === 'warning' && 'text-amber-600',
              )}
            >
              {data?.last_ping_at
                ? formatDistanceToNow(parseISO(data.last_ping_at), { addSuffix: true, locale: es })
                : 'sin registro'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{health.message}</p>
          <p className="border-t pt-2 text-xs text-muted-foreground">
            El proyecto de Supabase se mantiene activo con una consulta automática cada 8 horas
            desde GitHub Actions. GitHub desactiva esos workflows tras 60 días sin actividad del
            repositorio, y entrar en esta web no cuenta como actividad del repositorio: para eso
            hay un commit mensual automático. Procedimiento completo en <code>FREE_TIER.md</code>.
          </p>
        </CardContent>
      </Card>

    </div>
  )
}
