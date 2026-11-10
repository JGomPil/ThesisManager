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
import { cn } from '@/lib/utils'
import { qk } from '@/lib/query-keys'
import { errorMessage, supabase } from '@/lib/supabase'
import { peopleRepo } from '@/data/repositories/people.repo'
import { esUrlDeLinkedin, normalizaUrl } from '@/domain/people/links'
import { useAuth } from '@/features/auth/auth-context'
import { AvatarCard } from '@/features/auth/avatar-card'
import { AvisosCard } from '@/features/notifications/avisos-card'

/**
 * Cuánto cabe en la información académica.
 *
 * El límite existía desde el primer día y no estaba escrito en ninguna parte:
 * se escribía de más, el formulario no guardaba y no decía por qué, porque este
 * campo era además el único del formulario sin `FieldError`. Un número que
 * gobierna lo que se puede escribir tiene que estar a la vista mientras se
 * escribe.
 */
const BIO_MAX = 1000

const profileSchema = z.object({
  full_name: z.string().trim().min(3, 'Indica tu nombre y apellidos').max(150),
  department: z.string().trim().max(150).optional(),
  position: z.string().trim().max(150).optional(),
  orcid: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{4}-\d{4}-\d{3}[\dX])?$/, 'Formato: 0000-0000-0000-0000')
    .optional(),
  /**
   * LinkedIn: se admite tal cual se pega, y se exige que sea de LinkedIn.
   *
   * Lo del esquema: LinkedIn muestra la dirección sin `https://`
   * —`www.linkedin.com/in/alguien`— y es lo que se copia. Exigirlo a mano era
   * decir no por un detalle que se da por supuesto, así que se añade solo
   * (`normalizaUrl`, en el dominio); guardarlo sin esquema no vale, porque
   * entonces el `href` es una dirección relativa de este mismo sitio.
   *
   * Lo del dominio no es celo: este campo se pinta como un enlace con el
   * rótulo «LinkedIn», así que una dirección de otro sitio sería un enlace que
   * dice una cosa y lleva a otra, en la ficha que otras personas miran.
   */
  linkedin_url: z
    .string()
    .trim()
    .max(300)
    .refine(esUrlDeLinkedin, 'Pega la dirección de tu LinkedIn (www.linkedin.com/in/…)')
    .optional(),
  bio: z.string().trim().max(BIO_MAX, `Máximo ${BIO_MAX} caracteres`).optional(),
})
type ProfileValues = z.infer<typeof profileSchema>

/**
 * El correo nuevo.
 *
 * No se valida «que sea institucional» a propósito: hay doctorandos con cuenta
 * de otra universidad y profesorado asociado con correo de su empresa, y una
 * regla de dominio los dejaría fuera justo cuando más falta les hace poder
 * cambiarlo. Lo único que se exige es que sea un correo y que no sea el que ya
 * tiene, que es el error de verdad: mandar un enlace de confirmación a la misma
 * dirección gasta uno de los 2–4 correos por hora del plan gratuito para nada.
 */
const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Escribe un correo válido'),
})

const passwordSchema = z
  .object({ password: z.string().min(10, 'Usa al menos 10 caracteres'), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'No coinciden', path: ['confirm'] })

export function ProfilePage() {
  const { profile, userId, memberships, loading } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { full_name: '', department: '', position: '', orcid: '', linkedin_url: '', bio: '' },
  })

  React.useEffect(() => {
    if (!profile) return
    form.reset({
      full_name: profile.full_name,
      department: profile.department ?? '',
      position: profile.position ?? '',
      orcid: profile.orcid ?? '',
      linkedin_url: profile.linkedin_url ?? '',
      bio: profile.bio ?? '',
    })
  }, [profile, form])

  // Lo que lleva escrito, para el contador. `watch` vuelve a dibujar en cada
  // pulsación, que es justo lo que se quiere aquí y nada más que aquí.
  const bioLargo = (form.watch('bio') ?? '').length

  const save = useMutation({
    mutationFn: (values: ProfileValues) =>
      peopleRepo.updateMe(userId!, {
        full_name: values.full_name,
        department: values.department || null,
        position: values.position || null,
        orcid: values.orcid || null,
        // Con `https://` delante aunque no se haya escrito: ver `normalizaUrl`.
        linkedin_url: normalizaUrl(values.linkedin_url),
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

  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  })

  /**
   * CAMBIAR EL CORREO DE LA CUENTA.
   *
   * Lo hace Supabase Auth, que es quien manda sobre las credenciales: manda un
   * enlace de confirmación al correo nuevo y —con «Secure email change», que
   * está activado de serie— otro al actual, y hacen falta los dos. Hasta que se
   * confirme, se sigue entrando con el de siempre.
   *
   * La aplicación NO escribe `profiles.email`: lo arrastra el disparador de la
   * migración 0027 cuando el cambio se confirma. Escribirlo aquí daría un
   * directorio que anuncia un correo con el que todavía no se puede entrar, y
   * ningún error.
   */
  const changeEmail = useMutation({
    mutationFn: async (values: z.infer<typeof emailSchema>) => {
      if (values.email === (profile?.email ?? '').toLowerCase()) {
        throw new Error('Ese ya es tu correo. No hace falta cambiar nada.')
      }
      const { error } = await supabase.auth.updateUser({ email: values.email })
      if (error) throw error
      return values.email
    },
    onSuccess: (nuevo) => {
      toast.push(
        'success',
        `Te hemos mandado un enlace a ${nuevo} y otro a tu correo actual. Hay que abrir los dos; hasta entonces entras con el de siempre.`,
      )
      emailForm.reset()
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (loading) return <LoadingPanel />

  const membership = memberships[0]

  return (
    <div className="space-y-4">
      <PageHeader title="Mi perfil" description="Una sola cuenta para todas tus funciones académicas." />

      <AvatarCard
        userId={userId!}
        name={profile?.full_name ?? ''}
        avatarUrl={profile?.avatar_url ?? null}
      />

      <AvisosCard />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="department">Departamento</Label>
                  <Input id="department" className="mt-1.5" {...form.register('department')} />
                </div>
                <div>
                  <Label htmlFor="position">Puesto o situación académica</Label>
                  <Input id="position" className="mt-1.5" placeholder="Profesor, doctorando…" {...form.register('position')} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="orcid">ORCID</Label>
                  <Input id="orcid" className="mt-1.5 font-mono" placeholder="0000-0000-0000-0000" {...form.register('orcid')} />
                  <FieldError>{form.formState.errors.orcid?.message}</FieldError>
                </div>
                <div>
                  <Label htmlFor="linkedin">LinkedIn</Label>
                  <Input
                    id="linkedin" inputMode="url" className="mt-1.5"
                    placeholder="www.linkedin.com/in/…"
                    {...form.register('linkedin_url')}
                  />
                  <FieldError>{form.formState.errors.linkedin_url?.message}</FieldError>
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="bio">Información académica</Label>
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      bioLargo > BIO_MAX ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {bioLargo}/{BIO_MAX}
                  </span>
                </div>
                {/* `maxLength` corta al escribir y al pegar; el contador explica
                    por qué deja de aparecer texto, que sin él parece que el
                    teclado ha dejado de funcionar. El rojo es para un texto que
                    ya venía de antes más largo que el límite: `maxLength` no
                    recorta lo que ya estaba escrito. */}
                <Textarea id="bio" rows={3} maxLength={BIO_MAX} className="mt-1.5" {...form.register('bio')} />
                <FieldError>{form.formState.errors.bio?.message}</FieldError>
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
                Tu cuenta es tu perfil, no tu correo: si cambias de correo conservas tus trabajos,
                tus tareas y todo tu historial.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Cambiar mi correo</CardTitle>
              <CardDescription>
                Para cuando cambias de centro o te cierran la cuenta institucional.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <form
                onSubmit={emailForm.handleSubmit((v) => changeEmail.mutate(v))}
                className="space-y-3"
                noValidate
              >
                <div>
                  <Label htmlFor="new-email">Correo nuevo</Label>
                  <Input
                    id="new-email" type="email" autoComplete="email" className="mt-1.5"
                    placeholder="nombre@dominio.es"
                    {...emailForm.register('email')}
                  />
                  <FieldError>{emailForm.formState.errors.email?.message}</FieldError>
                </div>
                <Button type="submit" variant="outline" className="w-full" loading={changeEmail.isPending}>
                  Mandarme el enlace de confirmación
                </Button>
              </form>
              {/* Lo que pasa después, escrito antes de que pase: este cambio se
                  hace una vez en la vida y no se sabe qué esperar. Los tres
                  párrafos contestan las tres preguntas que salen solas: ¿ya
                  está?, ¿con cuál entro ahora?, ¿y si no llega el correo? */}
              <div className="mt-3 space-y-1.5 border-t pt-2 text-xs text-muted-foreground">
                <p>
                  Se manda un enlace al correo nuevo y otro al actual, y <strong>hay que abrir los
                  dos</strong>. Hasta entonces sigues entrando con el de siempre.
                </p>
                <p>
                  Tu perfil no cambia: los trabajos, las tareas, los comentarios y las actas se
                  quedan a tu nombre, porque lo que te identifica es el perfil y no el correo.
                </p>
                <p>
                  Si no llega, es por la cuota del plan gratuito —de 2 a 4 correos por hora,
                  compartidos con las invitaciones y las contraseñas—: espera un rato o pídele a la
                  administración que te lo cambie desde el panel de Supabase, que llega al mismo
                  sitio.
                </p>
              </div>
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
      <span className="break-words text-right">{value}</span>
    </div>
  )
}
