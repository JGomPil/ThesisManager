import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { GraduationCap } from 'lucide-react'
import { supabase, errorMessage } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldError } from '@/components/common/states'

const loginSchema = z.object({
  email: z.string().min(1, 'Indica tu correo').email('Correo no válido'),
  password: z.string().min(1, 'Indica tu contraseña'),
})
type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<'login' | 'recover'>('login')

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: LoginValues) => {
    setError(null)
    setNotice(null)
    const { error } = await supabase.auth.signInWithPassword(values)
    if (error) setError(errorMessage(error))
  }

  const onRecover = async () => {
    setError(null)
    setNotice(null)
    const email = form.getValues('email')
    if (!email) {
      setError('Escribe tu correo para poder enviarte el enlace.')
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}restablecer`,
    })
    if (error) setError(errorMessage(error))
    else
      setNotice(
        'Si ese correo tiene cuenta, recibirás un enlace para cambiar la contraseña. ' +
          'Puede tardar: el plan gratuito de Supabase limita los envíos a unos pocos por hora.',
      )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Thesis Manager</h1>
          <p className="text-sm text-muted-foreground">Supervisión de trabajos académicos · GIB-UVa</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">
              {mode === 'login' ? 'Acceder' : 'Recuperar contraseña'}
            </CardTitle>
            <CardDescription>
              {mode === 'login'
                ? 'El acceso es por invitación del administrador del grupo.'
                : 'Te enviaremos un enlace para establecer una contraseña nueva.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="email">Correo institucional</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  className="mt-1.5"
                  {...form.register('email')}
                />
                <FieldError>{form.formState.errors.email?.message}</FieldError>
              </div>

              {mode === 'login' && (
                <div>
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    className="mt-1.5"
                    {...form.register('password')}
                  />
                  <FieldError>{form.formState.errors.password?.message}</FieldError>
                </div>
              )}

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
                  {error}
                </p>
              )}
              {notice && (
                <p className="rounded-md border bg-muted/50 p-2.5 text-sm text-muted-foreground">{notice}</p>
              )}

              {mode === 'login' ? (
                <>
                  <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
                    Entrar
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setMode('recover'); setError(null); setNotice(null) }}
                    className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    He olvidado mi contraseña
                  </button>
                </>
              ) : (
                <>
                  <Button type="button" className="w-full" onClick={onRecover}>
                    Enviar enlace
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError(null); setNotice(null) }}
                    className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Volver al acceso
                  </button>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
