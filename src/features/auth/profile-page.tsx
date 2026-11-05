import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FieldError, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage, supabase } from '@/lib/supabase'
import { peopleRepo } from '@/data/repositories/people.repo'
import { useAuth } from '@/features/auth/auth-context'

const profileSchema = z.object({
  full_name: z.string().trim().min(3, 'Indica tu nombre y apellidos').max(150),
  department: z.string().trim().max(150).optional(),
  position: z.string().trim().max(150).optional(),
  orcid: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{4}-\d{4}-\d{3}[\dX])?$/, 'Formato: 0000-0000-0000-0000')
    .optional(),
  bio: z.string().trim().max(1000).optional(),
})
type ProfileValues = z.infer<typeof profileSchema>

const passwordSchema = z
  .object({ password: z.string().min(10, 'Usa al menos 10 caracteres'), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'No coinciden', path: ['confirm'] })

export function ProfilePage() {
  const { profile, userId, memberships, loading } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: '', department: '', position: '', orcid: '', bio: '' },
  })

  React.useEffect(() => {
    if (!profile) return
    form.reset({
      full_name: profile.full_name,
      department: profile.department ?? '',
      position: profile.position ?? '',
      orcid: profile.orcid ?? '',
      bio: profile.bio ?? '',
    })
  }, [profile, form])

  const save = useMutation({
    mutationFn: (values: ProfileValues) =>
      peopleRepo.updateMe(userId!, {
        full_name: values.full_name,
        department: values.department || null,
        position: values.position || null,
        orcid: values.orcid || null,
        bio: values.bio || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.me })
      void qc.invalidateQueries({ queryKey: qk.people.directory })
      toast.push('success', 'Perfil actualizado.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const pwForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '', confirm: '' },
  })

  const changePassword = useMutation({
    mutationFn: async (values: z.infer<typeof passwordSchema>) => {
      const { error } = await supabase.auth.updateUser({ password: values.password })
      if (error) throw error
    },
    onSuccess: () => { toast.push('success', 'Contraseña actualizada.'); pwForm.reset() },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (loading) return <LoadingPanel />

  const membership = memberships[0]

  return (
    <div className="space-y-4">
      <PageHeader title="Mi perfil" description="Una sola cuenta para todas tus funciones académicas." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Datos personales</CardTitle>
            <CardDescription>
              Se almacena lo mínimo necesario para la gestión académica. No se pide DNI, teléfono
              ni dirección.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="full_name">Nombre y apellidos</Label>
                <Input id="full_name" className="mt-1.5" {...form.register('full_name')} />
                <FieldError>{form.formState.errors.full_name?.message}</FieldError>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="department">Departamento</Label>
                  <Input id="department" className="mt-1.5" {...form.register('department')} />
                </div>
                <div>
                  <Label htmlFor="position">Puesto o situación académica</Label>
                  <Input id="position" className="mt-1.5" placeholder="Profesor, doctorando…" {...form.register('position')} />
                </div>
              </div>

              <div>
                <Label htmlFor="orcid">ORCID</Label>
                <Input id="orcid" className="mt-1.5 font-mono" placeholder="0000-0000-0000-0000" {...form.register('orcid')} />
                <FieldError>{form.formState.errors.orcid?.message}</FieldError>
              </div>

              <div>
                <Label htmlFor="bio">Información académica</Label>
                <Textarea id="bio" rows={3} className="mt-1.5" {...form.register('bio')} />
              </div>

              <div className="flex justify-end">
                <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
                  Guardar cambios
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Cuenta</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0 text-sm">
              <Row label="Correo" value={profile?.email ?? '—'} />
              <Row
                label="Grupo"
                value={membership?.organization?.name ?? 'Sin asignar'}
              />
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Permisos</span>
                <Badge variant={membership?.role === 'MEMBER' ? 'secondary' : 'default'}>
                  {membership?.role === 'ADMIN' ? 'Administrador'
                    : membership?.role === 'OWNER' ? 'Propietario'
                    : 'Miembro'}
                </Badge>
              </div>
              <p className="border-t pt-2 text-xs text-muted-foreground">
                El correo no se cambia desde aquí: identifica la cuenta. Pídeselo al administrador
                del grupo.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Cambiar contraseña</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <form onSubmit={pwForm.handleSubmit((v) => changePassword.mutate(v))} className="space-y-3" noValidate>
                <div>
                  <Label htmlFor="pw">Nueva contraseña</Label>
                  <Input id="pw" type="password" autoComplete="new-password" className="mt-1.5" {...pwForm.register('password')} />
                  <FieldError>{pwForm.formState.errors.password?.message}</FieldError>
                </div>
                <div>
                  <Label htmlFor="pw2">Repítela</Label>
                  <Input id="pw2" type="password" autoComplete="new-password" className="mt-1.5" {...pwForm.register('confirm')} />
                  <FieldError>{pwForm.formState.errors.confirm?.message}</FieldError>
                </div>
                <Button type="submit" variant="outline" className="w-full" loading={changePassword.isPending}>
                  Actualizar contraseña
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  )
}
