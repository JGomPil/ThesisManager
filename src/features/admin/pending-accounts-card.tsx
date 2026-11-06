import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserCheck } from 'lucide-react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorPanel, Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { peopleRepo } from '@/data/repositories/people.repo'
import { useAuth } from '@/features/auth/auth-context'

/**
 * Cuentas que existen en Supabase pero no pertenecen a ninguna organización.
 *
 * Es el hueco que dejaba la cola de invitaciones: cubre el camino previsto
 * —invitar y que el alta se haga sola al aceptar—, pero no el de crear el
 * usuario directamente en Authentication → Users del panel de Supabase. En ese
 * caso el disparador le crea el perfil y nada más, y como la pertenencia a la
 * organización es un acto administrativo explícito, la cuenta no comparte
 * organización con nadie y por tanto NO LA VE NADIE: ni el directorio de
 * Personas, ni el propio administrador que acaba de crearla.
 *
 * La tarjeta solo aparece si hay alguna: no tiene sentido ocupar sitio para
 * decir que no hay nada pendiente.
 */
export function PendingAccountsCard() {
  const { organizationId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  const pendientes = useQuery({
    queryKey: qk.people.pending,
    queryFn: peopleRepo.pendingAccounts,
  })

  const autorizar = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'MEMBER' | 'ADMIN' }) =>
      peopleRepo.authorize(organizationId!, userId, role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.people.pending })
      void qc.invalidateQueries({ queryKey: qk.people.directory })
      toast.push('success', 'Cuenta autorizada. Ya aparece en Personas y puede participar en trabajos.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const rows = pendientes.data ?? []

  // Un error aquí sí se muestra: si la migración 0013 no estuviera aplicada,
  // callarlo dejaría al administrador sin entender por qué no ve la cuenta que
  // acaba de crear, que es justo el problema que esto resuelve.
  if (pendientes.isError) return <ErrorPanel error={pendientes.error} />
  if (pendientes.isLoading) return <Spinner />
  if (rows.length === 0) return null

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UserCheck className="size-4 text-amber-600" />
          Cuentas pendientes de autorizar ({rows.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Existen en Supabase pero no pertenecen al grupo, así que todavía no ven nada y no
          aparecen en Personas. Pasa cuando la cuenta se crea a mano en Authentication → Users en
          lugar de por invitación.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.email} · creada {formatDistanceToNow(parseISO(p.created_at), { locale: es, addSuffix: true })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  loading={autorizar.isPending && autorizar.variables?.userId === p.id}
                  onClick={() => autorizar.mutate({ userId: p.id, role: 'MEMBER' })}
                >
                  Autorizar
                </Button>
                <Button
                  size="sm" variant="outline"
                  onClick={() => autorizar.mutate({ userId: p.id, role: 'ADMIN' })}
                >
                  Como administrador
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          «Autorizar» da acceso al grupo, no a ningún trabajo: las funciones académicas se asignan
          después, trabajo por trabajo. Son dos cosas independientes a propósito.
        </p>
      </CardContent>
    </Card>
  )
}
