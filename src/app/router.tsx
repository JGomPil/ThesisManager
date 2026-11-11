import * as React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { supabaseConfigured } from '@/lib/supabase'
import { ConfigurationScreen } from '@/app/configuration-screen'
import { AppShell, PendingApprovalScreen } from '@/app/layout/app-shell'
import { DesktopSiteNotice } from '@/app/layout/desktop-site-notice'
import { useAuth } from '@/features/auth/auth-context'
import { LoadingPanel, EmptyState } from '@/components/common/states'

/**
 * QUÉ SE CARGA DE ENTRADA Y QUÉ NO.
 *
 * Estas cuatro pantallas son el camino diario —entrar, ver el panel, abrir la
 * lista y entrar en un trabajo—, así que van en el paquete principal: hacerlas
 * perezosas solo añadiría un parpadeo al arranque sin ahorrar nada a nadie.
 */
import { LoginPage } from '@/features/auth/login-page'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { WorksListPage } from '@/features/works/works-list-page'
import { WorkDetailPage } from '@/features/works/work-detail-page'

/**
 * EL RESTO SE DESCARGA AL ENTRAR EN ÉL, y no antes.
 *
 * Antes se importaban las diecisiete pantallas de golpe, de modo que un
 * estudiante que solo entra a ver su trabajo se descargaba también Catálogos,
 * Plantillas, Tipos de trabajo, Altas de usuarios y Archivados: pantallas que no
 * puede ni abrir, porque `RequireAdmin` se lo impide. En GitHub Pages ese peso
 * lo paga el visitante en cada visita, y buena parte de las visitas son desde
 * el móvil. Los gráficos ya iban aparte desde la Fase 4 (`manualChunks` en
 * `vite.config.ts`); esto hace lo mismo con la administración y los informes.
 *
 * `React.lazy` espera una exportación por omisión y aquí todo se exporta con
 * nombre, de ahí el `.then()` de cada línea. El indicador de carga mientras
 * llega el trozo lo pone el `Suspense` de `AppShell`, alrededor del `Outlet`:
 * así el menú no desaparece y solo parpadea el contenido.
 */
const ResetPasswordPage = React.lazy(() => import('@/features/auth/reset-password-page').then((m) => ({ default: m.ResetPasswordPage })))
const WorkFormPage = React.lazy(() => import('@/features/works/work-form-page').then((m) => ({ default: m.WorkFormPage })))
const PeoplePage = React.lazy(() => import('@/features/works/people-page').then((m) => ({ default: m.PeoplePage })))
const PersonPage = React.lazy(() => import('@/features/works/person-page').then((m) => ({ default: m.PersonPage })))
const ProfilePage = React.lazy(() => import('@/features/auth/profile-page').then((m) => ({ default: m.ProfilePage })))
const CalendarPage = React.lazy(() => import('@/features/calendar/calendar-page').then((m) => ({ default: m.CalendarPage })))
const ReportsPage = React.lazy(() => import('@/features/reports/reports-page').then((m) => ({ default: m.ReportsPage })))
const WorkReportPage = React.lazy(() => import('@/features/reports/work-report-page').then((m) => ({ default: m.WorkReportPage })))
const AdminHomePage = React.lazy(() => import('@/features/admin/admin-home-page').then((m) => ({ default: m.AdminHomePage })))
const WorkTypesPage = React.lazy(() => import('@/features/admin/work-types-page').then((m) => ({ default: m.WorkTypesPage })))
const InvitationsPage = React.lazy(() => import('@/features/admin/invitations-page').then((m) => ({ default: m.InvitationsPage })))
const ArchivedWorksPage = React.lazy(() => import('@/features/admin/archived-works-page').then((m) => ({ default: m.ArchivedWorksPage })))
const TemplatesPage = React.lazy(() => import('@/features/admin/templates-page').then((m) => ({ default: m.TemplatesPage })))
const CatalogsPage = React.lazy(() => import('@/features/admin/catalogs-page').then((m) => ({ default: m.CatalogsPage })))

/**
 * Guarda de ruta. Es USABILIDAD, no seguridad: aunque alguien manipulara el
 * router, RLS seguiría devolviendo 0 filas. La seguridad vive en PostgreSQL.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading, isPendingApproval, signOut } = useAuth()
  if (loading) return <div className="flex min-h-dvh items-center justify-center"><LoadingPanel /></div>
  if (!session) return <Navigate to="/acceso" replace />
  if (isPendingApproval) return <PendingApprovalScreen onSignOut={() => void signOut()} />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { isOrgAdmin } = useAuth()
  if (!isOrgAdmin) {
    return (
      <EmptyState
        title="Sección reservada a la administración del grupo"
        description="Tu cuenta no tiene permisos administrativos. Esto no afecta a tus funciones académicas."
      />
    )
  }
  return <>{children}</>
}

/**
 * Crear un trabajo ya no es cosa solo de la administracion (migracion 0034).
 *
 * Guardia aparte y no `RequireAdmin`: administrar el grupo abre todos los
 * trabajos y todas las notas privadas de supervision, de modo que el permiso
 * de crear tenia que poder darse sin eso. Esto no es la frontera -la frontera
 * es `app.crear_trabajo`, que comprueba el permiso por dentro-; es para no
 * ensenar un formulario que acabaria en un error de permisos.
 */
function RequirePuedeCrearTrabajos({ children }: { children: React.ReactNode }) {
  const { canCreateWorks } = useAuth()
  if (!canCreateWorks) {
    return (
      <EmptyState
        title="No puedes crear trabajos en este grupo"
        description="Quien administra el grupo puede darte permiso desde tu ficha de persona, sin hacerte administrador."
      />
    )
  }
  return <>{children}</>
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="flex min-h-dvh items-center justify-center"><LoadingPanel /></div>
  if (session) return <Navigate to="/" replace />
  return <>{children}</>
}

export function Router() {
  // Sin configuración no hay nada que enrutar: se explica el problema en vez
  // de dejar la página en blanco.
  if (!supabaseConfigured) return <ConfigurationScreen />

  return (
    <>
      {/* Fuera del enrutador a propósito: el aviso tiene que verse también en
          la pantalla de acceso, que es la primera que ve alguien que entra por
          primera vez desde el móvil —y justo cuando decide si esto funciona. */}
      <DesktopSiteNotice />
      {/* basename = el subdirectorio de GitHub Pages (/ThesisManager/). */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/acceso" element={<PublicOnly><LoginPage /></PublicOnly>} />
          {/* Fuera del `AppShell`, así que no hereda su `Suspense`. */}
          <Route
            path="/restablecer"
            element={
              <React.Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><LoadingPanel /></div>}>
                <ResetPasswordPage />
              </React.Suspense>
            }
          />

          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="trabajos" element={<WorksListPage />} />
            <Route
              path="trabajos/nuevo"
              element={<RequirePuedeCrearTrabajos><WorkFormPage /></RequirePuedeCrearTrabajos>}
            />
            <Route path="trabajos/:id" element={<WorkDetailPage />} />
            <Route path="trabajos/:id/editar" element={<WorkFormPage />} />
            <Route path="calendario" element={<CalendarPage />} />
            {/* Los informes NO llevan guarda de administración: cada cual ve los
                indicadores de sus propios trabajos, que es lo que RLS le
                devuelve. Reservarlos a la administración escondería a un director
                el seguimiento de los trabajos que dirige. */}
            <Route path="informes" element={<ReportsPage />} />
            <Route path="informes/trabajo/:id" element={<WorkReportPage />} />
            <Route path="personas" element={<PeoplePage />} />
            {/* Sin guarda: `profiles_select` decide si hay ficha que mostrar.
                Una guarda aquí tendría que repetir ese criterio en TypeScript, y
                las dos versiones se separarían en cuanto cambiara una. */}
            <Route path="personas/:id" element={<PersonPage />} />
            <Route path="perfil" element={<ProfilePage />} />
            <Route path="admin" element={<RequireAdmin><AdminHomePage /></RequireAdmin>} />
            <Route path="admin/tipos" element={<RequireAdmin><WorkTypesPage /></RequireAdmin>} />
            <Route path="admin/invitaciones" element={<RequireAdmin><InvitationsPage /></RequireAdmin>} />
            <Route path="admin/archivados" element={<RequireAdmin><ArchivedWorksPage /></RequireAdmin>} />
            <Route path="admin/plantillas" element={<RequireAdmin><TemplatesPage /></RequireAdmin>} />
            <Route path="admin/catalogos" element={<RequireAdmin><CatalogsPage /></RequireAdmin>} />
            <Route
              path="*"
              element={
                <EmptyState
                  title="Página no encontrada"
                  description="La dirección no corresponde a ninguna sección de la aplicación."
                />
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </>
  )
}
