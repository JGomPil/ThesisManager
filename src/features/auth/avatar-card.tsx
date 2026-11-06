import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { peopleRepo } from '@/data/repositories/people.repo'

const TIPOS = 'image/jpeg,image/png,image/webp'

/**
 * Subir, cambiar o quitar la foto de perfil.
 *
 * QUÉ SE LE DICE AL USUARIO, Y POR QUÉ
 * Que es opcional y quién la verá. Una foto es un dato personal más revelador
 * que un nombre, y el consentimiento solo significa algo si se sabe el alcance:
 * aquí, exactamente quien ya ve tu nombre —la gente con la que compartes algún
 * trabajo, y la administración—. No es un detalle legal de adorno: es la
 * diferencia entre «subo mi foto al grupo» y «subo mi foto a internet».
 */
export function AvatarCard({ userId, name, avatarUrl }: {
  userId: string
  name: string
  avatarUrl: string | null
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const input = React.useRef<HTMLInputElement>(null)

  const refrescar = () => {
    void qc.invalidateQueries({ queryKey: qk.me })
    void qc.invalidateQueries({ queryKey: qk.people.directory })
    void qc.invalidateQueries({ queryKey: qk.works.all })
    void qc.invalidateQueries({ queryKey: ['avatar'] })
  }

  const subir = useMutation({
    mutationFn: (file: File) => peopleRepo.uploadAvatar(userId, file),
    onSuccess: () => { refrescar(); toast.push('success', 'Foto actualizada.') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const quitar = useMutation({
    mutationFn: () => peopleRepo.removeAvatar(userId, avatarUrl),
    onSuccess: () => { refrescar(); toast.push('success', 'Foto retirada.') },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Foto</CardTitle>
        <CardDescription>
          Es opcional. La verá exactamente quien ya ve tu nombre: las personas con las que
          compartes algún trabajo y la administración del grupo. No es pública.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <Avatar name={name} src={avatarUrl} size="xl" />

        <div className="min-w-0 space-y-2">
          <input
            ref={input}
            type="file"
            accept={TIPOS}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Se limpia el valor para que elegir el MISMO fichero otra vez
              // vuelva a disparar el cambio (si no, el navegador lo ignora).
              e.target.value = ''
              if (file) subir.mutate(file)
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={subir.isPending}
              onClick={() => input.current?.click()}
            >
              <Camera /> {avatarUrl ? 'Cambiar la foto' : 'Subir una foto'}
            </Button>
            {avatarUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={quitar.isPending}
                onClick={() => quitar.mutate()}
              >
                <Trash2 /> Quitar
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Se recorta al cuadrado central y se reduce a 256 px en tu propio navegador antes de
            subirla, así que da igual que la original pese varios megas.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
