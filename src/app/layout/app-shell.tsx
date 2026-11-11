import * as React from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3, BookOpen, CalendarDays, ChevronDown, GraduationCap, LayoutDashboard, LogOut, Menu,
  Moon, Settings, Sun, Users, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { useAuth } from '@/features/auth/auth-context'
import { useTheme } from '@/hooks/use-theme'
import { KeepaliveBanner } from '@/features/admin/keepalive-banner'
import { NotificationsMenu } from '@/features/notifications/notifications-menu'
import { InstallButton } from '@/app/layout/install-button'
import { LoadingPanel } from '@/components/common/states'

const NAV = [
  { to: '/', label: 'Resumen', icon: LayoutDashboard, end: true },
  { to: '/trabajos', label: 'Trabajos', icon: BookOpen, end: false },
  { to: '/calendario', label: 'Calendario', icon: CalendarDays, end: false },
  { to: '/informes', label: 'Informes', icon: BarChart3, end: false },
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
    <div className="min-h-dvh bg-muted/30 print:bg-white">
      {/* Barra superior */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur print:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          {/* El icono cambia al abrirse. Antes ponía <Menu /> en las dos ramas:
              el botón que cierra el cajón tenía el mismo dibujo que el que lo
              abre, y en un móvil el único indicio de que se puede cerrar es
              justamente ese dibujo. */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Cerrar el menú' : 'Abrir el menú'}
            aria-expanded={open}
          >
            {open ? <X /> : <Menu />}
          </Button>

          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="size-4" />
            </span>
            <span className="font-semibold tracking-tight">Thesis Manager</span>
          </Link>

          <span className="hidden truncate text-sm text-muted-foreground sm:inline">· {orgName}</span>

          <div className="ml-auto flex items-center gap-1">
            {/* Solo se dibuja si el navegador ofrece instalar. Ver
                `InstallButton`: en el escritorio la opción existe pero está
                escondida en el menú del navegador. */}
            <InstallButton />
            <NotificationsMenu />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Cambiar tema">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            <Link
              to="/perfil"
              className="hidden max-w-[14rem] items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent sm:flex"
              title="Mi perfil"
            >
              <Avatar name={profile?.full_name} src={profile?.avatar_url} size="sm" />
              <span className="min-w-0 truncate">{profile?.full_name ?? '—'}</span>
            </Link>
            <Button variant="ghost" size="icon" onClick={() => void signOut()} aria-label="Salir">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Navegación lateral. EN ESCRITORIO SE QUEDA QUIETA. Era `lg:static`, así que el menú
            formaba parte del flujo de la página y se iba hacia arriba con el
            scroll: en una ficha de trabajo larga o en el tablero de tareas
            había que volver arriba del todo para cambiar de sección. Con
            `lg:sticky` y una altura igual a la ventana menos la barra superior
            (3.5rem = h-14), el menú se mantiene a la vista y, si algún día
            tiene más entradas de las que caben, se desplaza por dentro gracias
            al `overflow-y-auto` que ya estaba.

            `lg:inset-y-auto` es imprescindible: `inset-y-14` fija arriba Y
            abajo, y un elemento `sticky` con las dos cosas no se pega. En el
            móvil no se toca nada: ahí sigue siendo un cajón `fixed` que entra y
            sale con `translate-x`. */}
        <aside
          className={cn(
            'fixed inset-y-14 left-0 z-30 w-60 shrink-0 overflow-y-auto border-r bg-background p-3',
            'transition-transform lg:translate-x-0 print:hidden',
            'lg:sticky lg:inset-y-auto lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:self-start',
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

          {/* En el móvil, la barra superior no tiene sitio para el nombre ni
              para «Mi perfil» (están en `sm:block`), así que el cajón es el
              único sitio donde pueden estar. En escritorio sobra: lo de arriba
              ya se ve. */}
          <div className="mt-3 border-t pt-3 sm:hidden">
            <Link
              to="/perfil"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Avatar name={profile?.full_name} src={profile?.avatar_url} size="sm" />
              <span className="min-w-0 truncate">{profile?.full_name ?? 'Mi perfil'}</span>
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <LogOut className="size-4 shrink-0" />
              Salir
            </button>
          </div>
        </aside>

        {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

        {/* `overflow-x-clip` ES UNA RED, NO LA SOLUCIÓN. Cada desbordamiento se
            arregla donde nace —una fila que envuelve, un `select` con ancho,
            un panel con su propio desplazamiento— y para eso están los
            comentarios de cada sitio. Esto es lo que impide que el siguiente
            descuadre la pantalla entera: en un móvil, un solo elemento más
            ancho que la ventana ensancha el lienzo, y entonces se mueve TODO,
            incluidos los diálogos `fixed`, que aparecen descentrados y salidos
            por la derecha sin que les pase nada a ellos. Síntoma del 11 de
            noviembre de 2026: la ficha de una tarea «no queda centrada».
            `clip` y no `hidden` a propósito: `hidden` crearía un contenedor de
            desplazamiento y rompería los `position: sticky` de dentro. */}
        <main className="min-w-0 flex-1 overflow-x-clip p-4 lg:p-6 print:p-0">
          <div className="mx-auto max-w-7xl space-y-4">
            {isOrgAdmin && <KeepaliveBanner />}
            {/* La mayoría de las pantallas se cargan al entrar en ellas
                (`React.lazy` en `router.tsx`). El `Suspense` va aquí dentro, y
                no alrededor del enrutador, para que mientras llega el trozo
                sigan a la vista el menú y la cabecera: así se ve que la
                aplicación responde, en lugar de quedarse la ventana en blanco. */}
            <React.Suspense fallback={<LoadingPanel />}>
              <Outlet />
            </React.Suspense>
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
        {/* `break-words` y no `truncate`: este título es casi siempre el
            nombre de un trabajo, y en un teléfono no cabe en una línea. Antes
            se cortaba justo donde empieza lo que distingue un TFG de otro. */}
        <h1 className="break-words text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {/* `flex-wrap` Y NO `shrink-0` EN MÓVIL. Una cabecera con tres acciones
          —«Editar», «Dar por terminado», «Archivar» son unos 400 px— no cabe
          en un teléfono, y sin envolver la última se salía por la derecha:
          inalcanzable, y además ensanchando la página, que es lo que descoloca
          los diálogos (ver `DialogContent`). Desde `sm` la cabecera ya es una
          fila y ahí `shrink-0` sigue siendo lo correcto, para que las acciones
          no se estrujen contra un título largo. */}
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      )}
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
