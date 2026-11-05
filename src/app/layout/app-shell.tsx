import * as React from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BookOpen, ChevronDown, GraduationCap, LayoutDashboard, LogOut, Menu,
  Moon, Settings, Sun, Users, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { useTheme } from '@/hooks/use-theme'
import { KeepaliveBanner } from '@/features/admin/keepalive-banner'

const NAV = [
  { to: '/', label: 'Resumen', icon: LayoutDashboard, end: true },
  { to: '/trabajos', label: 'Trabajos', icon: BookOpen, end: false },
  { to: '/personas', label: 'Personas', icon: Users, end: false },
]

const ADMIN_NAV = [{ to: '/admin', label: 'Administración', icon: Settings, end: false }]

export function AppShell() {
  const { profile, isOrgAdmin, signOut, memberships } = useAuth()
  const [open, setOpen] = React.useState(false)
  const { theme, toggle } = useTheme()
  const location = useLocation()

  React.useEffect(() => setOpen(false), [location.pathname])

  const items = isOrgAdmin ? [...NAV, ...ADMIN_NAV] : NAV
  const orgName = memberships[0]?.organization?.name ?? 'Grupo de investigación'

  return (
    <div className="min-h-dvh bg-muted/30">
      {/* Barra superior */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menú">
            {open ? <Menu /> : <Menu />}
          </Button>

          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="size-4" />
            </span>
            <span className="font-semibold tracking-tight">Thesis Manager</span>
          </Link>

          <span className="hidden truncate text-sm text-muted-foreground sm:inline">· {orgName}</span>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Cambiar tema">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            <Link
              to="/perfil"
              className="hidden max-w-[12rem] truncate rounded-md px-2 py-1 text-sm hover:bg-accent sm:block"
              title="Mi perfil"
            >
              {profile?.full_name ?? '—'}
            </Link>
            <Button variant="ghost" size="icon" onClick={() => void signOut()} aria-label="Salir">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Navegación lateral */}
        <aside
          className={cn(
            'fixed inset-y-14 left-0 z-30 w-60 shrink-0 border-r bg-background p-3 transition-transform lg:static lg:translate-x-0',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <nav className="flex flex-col gap-1">
            {items.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <div className="mx-auto max-w-7xl space-y-4">
            {isOrgAdmin && <KeepaliveBanner />}
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  breadcrumb?: { label: string; to?: string }[]
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((b, i) => (
              <React.Fragment key={`${b.label}-${i}`}>
                {i > 0 && <ChevronDown className="size-3 -rotate-90" />}
                {b.to ? (
                  <Link to={b.to} className="hover:text-foreground hover:underline">{b.label}</Link>
                ) : (
                  <span>{b.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function PendingApprovalScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4">
      <div className="max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <X className="size-5" />
        </div>
        <h1 className="text-lg font-semibold">Cuenta pendiente de autorización</h1>
        <p className="text-sm text-muted-foreground">
          Tu cuenta existe, pero todavía no está asignada a ningún grupo de investigación. El
          administrador debe autorizarte antes de que puedas ver nada. Es intencionado: el registro
          por sí solo no concede ningún acceso.
        </p>
        <Button variant="outline" onClick={onSignOut}>Salir</Button>
      </div>
    </div>
  )
}
