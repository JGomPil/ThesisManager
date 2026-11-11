import * as React from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/query-keys'
import { peopleRepo, type Membership } from '@/data/repositories/people.repo'
import type { ProfileRow } from '@/data/types/database'

type AuthValue = {
  session: Session | null
  userId: string | null
  profile: ProfileRow | null
  memberships: Membership[]
  /** Organización activa. Con una sola organización, la única que hay. */
  organizationId: string | null
  /** OWNER o ADMIN en la organización activa. Independiente de lo académico. */
  isOrgAdmin: boolean
  /**
   * ¿Puede crear trabajos académicos? (migración 0034)
   *
   * NO ES LO MISMO QUE ADMINISTRAR, y de eso iba la migración: administrar el
   * grupo abre todos los trabajos y todas las notas privadas de supervisión,
   * así que repartir la carga de dar de alta los trabajos no puede costar la
   * privacidad de las tutorías ajenas. Quien administra puede, además de quien
   * tenga la casilla encendida en su pertenencia.
   */
  canCreateWorks: boolean
  /** Autenticado pero sin fila en organization_members: no ve nada todavía. */
  isPendingApproval: boolean
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = React.createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [initialising, setInitialising] = React.useState(true)

  React.useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setInitialising(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setInitialising(false)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id ?? null

  const profileQuery = useQuery({
    queryKey: [...qk.me, userId],
    queryFn: () => peopleRepo.me(userId!),
    enabled: userId !== null,
  })

  const membershipsQuery = useQuery({
    queryKey: [...qk.myMemberships, userId],
    queryFn: () => peopleRepo.myMemberships(userId!),
    enabled: userId !== null,
  })

  const memberships = membershipsQuery.data ?? []
  const active = memberships[0] ?? null

  const value: AuthValue = {
    session,
    userId,
    profile: profileQuery.data ?? null,
    memberships,
    organizationId: active?.organization_id ?? null,
    isOrgAdmin: active?.role === 'OWNER' || active?.role === 'ADMIN',
    canCreateWorks:
      active?.role === 'OWNER' || active?.role === 'ADMIN' || active?.can_create_works === true,
    isPendingApproval:
      userId !== null && !membershipsQuery.isLoading && !membershipsQuery.isError && memberships.length === 0,
    loading: initialising || (userId !== null && (profileQuery.isLoading || membershipsQuery.isLoading)),
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
