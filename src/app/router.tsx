import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell, PendingApprovalScreen } from '@/app/layout/app-shell'
import { useAuth } from '@/features/auth/auth-context'
import { LoginPage } from '@/features/auth/login-page'
import { ResetPasswordPage } from '@/features/auth/reset-password-page'
import { DashboardPage } from '@/features/dashboard/dashboard-page'
import { WorksListPage } from '@/features/works/works-list-page'
import { WorkFormPage } from '@/features/works/work-form-page'
import { WorkDetailPage } from '@/features/works/work-detail-page'
import { PeoplePage } from '@/features/works/people-page'
import { AdminHomePage } from '@/features/admin/admin-home-page'
import { WorkTypesPage } from '@/features/admin/work-types-page'
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
  return (
    // basename = el subdirectorio de GitHub Pages (/ThesisManager/).
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
          <Route path="personas" element={<PeoplePage />} />
          <Route path="admin" element={<RequireAdmin><AdminHomePage /></RequireAdmin>} />
          <Route path="admin/tipos" element={<RequireAdmin><WorkTypesPage /></RequireAdmin>} />
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
  )
}
