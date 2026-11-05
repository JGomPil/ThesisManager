import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase, errorMessage } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldError } from '@/components/common/states'

const schema = z
  .object({
    password: z.string().min(10, 'Usa al menos 10 caracteres'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Las contraseñas no coinciden', path: ['confirm'] })

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  })

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: values.password })
    if (error) setError(errorMessage(error))
    else navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">Nueva contraseña</CardTitle>
          <CardDescription>Elige una contraseña para tu cuenta.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" autoComplete="new-password" className="mt-1.5" {...form.register('password')} />
              <FieldError>{form.formState.errors.password?.message}</FieldError>
            </div>
            <div>
              <Label htmlFor="confirm">Repítela</Label>
              <Input id="confirm" type="password" autoComplete="new-password" className="mt-1.5" {...form.register('confirm')} />
              <FieldError>{form.formState.errors.confirm?.message}</FieldError>
            </div>
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
              Guardar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
