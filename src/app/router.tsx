import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { supabaseConfigured } from '@/lib/supabase'
import { ConfigurationScreen } from '@/app/configuration-screen'
import { AppShell, PendingApprovalScreen } from '@/app/layout/app-shell'
import { DesktopSiteNotice } from '@/app/layout/desktop-site-notice'
import { useAuth } from '@/features/auth/auth-context'
import { LoginPage } from '@/features/auth/login-page'
import { ResetPasswordPage } from '@/features/auth/reset-password-page'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { WorksListPage } from '@/features/works/works-list-page'
import { WorkFormPage } from '@/features/works/work-form-page'
import { WorkDetailPage } from '@/features/works/work-detail-page'
import { PeoplePage } from '@/features/works/people-page'
import { AdminHomePage } from '@/features/admin/admin-home-page'
import { InvitationsPage } from '@/features/admin/invitations-page'
import { ProfilePage } from '@/features/auth/profile-page'
import { WorkTypesPage } from '@/features/admin/work-types-page'
import { ArchivedWorksPage } from '@/features/admin/archived-works-page'
import { TemplatesPage } from '@/features/admin/templates-page'
import { CatalogsPage } from '@/features/admin/catalogs-page'
import { CalendarPage } from '@/features/calendar/calendar-page'
import { ReportsPage } from '@/features/reports/reports-page'
import { WorkReportPage } from '@/features/reports/work-report-page'
import { LoadingPanel, EmptyState } from '@/components/common/states'

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
          <Route path="/restablecer" element={<ResetPasswordPage />} />

          <Route element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="trabajos" element={<WorksListPage />} />
            <Route path="trabajos/nuevo" element={<RequireAdmin><WorkFormPage /></RequireAdmin>} />
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
