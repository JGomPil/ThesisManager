import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { DatabaseBackup, Download, ShieldAlert } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { errorMessage } from '@/lib/supabase'
import { descargarTexto } from '@/lib/download'
import { exportRepo } from '@/data/repositories/export.repo'
import { useAuth } from '@/features/auth/auth-context'

/**
 * Copia de los datos académicos en un clic.
 *
 * POR QUÉ ESTÁ AQUÍ Y NO SOLO EN LA DOCUMENTACIÓN. El plan gratuito de Supabase
 * NO hace copias de seguridad, y el procedimiento bueno —`supabase db dump`—
 * necesita la CLI y la contraseña de la base de datos, así que en la práctica se
 * hace poco. Esta no sustituye a aquella: es la red de en medio, la que se puede
 * hacer en diez segundos antes de un cambio gordo o al cerrar un curso. Entre
 * dos volcados trimestrales, la diferencia entre perder un trimestre de
 * seguimiento y no perder nada.
 *
 * NO PROMETE MÁS DE LO QUE DA, y eso es parte de la función: el fichero lleva en
 * su propio `_meta` lo que no incluye (notas privadas de reunión, usuarios de
 * autenticación, ficheros de Storage, el esquema), y la tarjeta lo dice también
 * aquí. Una copia que se cree completa y no lo sea es peor que no tener copia.
 */
export function BackupCard() {
  const { profile } = useAuth()
  const toast = useToast()
  const [resumen, setResumen] = React.useState<string | null>(null)

  const exportar = useMutation({
    mutationFn: () => exportRepo.everything(profile?.full_name ?? null),
    onSuccess: (r) => {
      descargarTexto(
        `thesis-manager-datos-${format(new Date(), 'yyyy-MM-dd')}.json`,
        r.json,
        'application/json;charset=utf-8',
      )
      if (r.incompletas.length > 0) {
        // Un recorte silencioso haría pasar por copia algo que no lo es.
        toast.push(
          'error',
          `La copia está INCOMPLETA: el servidor ha recortado ${r.incompletas.join(', ')}. No la uses como respaldo.`,
        )
      } else if (r.fallidas.length > 0) {
        toast.push('error', `No se han podido leer: ${r.fallidas.map((f) => f.tabla).join(', ')}.`)
      } else {
        toast.push('success', `Copia descargada: ${r.totalFilas} filas.`)
      }
      setResumen(
        `${r.totalFilas} filas · ${r.incompletas.length === 0 && r.fallidas.length === 0
          ? 'sin lagunas'
          : 'CON LAGUNAS, mira el aviso'}`,
      )
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <DatabaseBackup className="size-4 text-muted-foreground" /> Copia de los datos académicos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-sm">
        <p className="text-muted-foreground">
          Descarga en un fichero JSON todo lo que esta cuenta puede leer: trabajos,
          participantes, tareas, hitos, documentos y sus versiones, reuniones, acuerdos,
          comentarios, plantillas y catálogos.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" loading={exportar.isPending} onClick={() => exportar.mutate()}>
            <Download /> Descargar la copia
          </Button>
          {resumen && <span className="text-xs text-muted-foreground">{resumen}</span>}
        </div>

        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Contiene datos personales</strong> (nombres y
            correos institucionales). Guárdalo en la unidad institucional de la UVa o en un disco
            cifrado, nunca en un servicio personal, y bórralo cuando deje de hacer falta.
          </p>
        </div>

        <p className="border-t pt-2 text-xs text-muted-foreground">
          <strong className="text-foreground">No es la copia completa.</strong> No incluye los
          usuarios de autenticación, el esquema de la base de datos, los ficheros de Storage ni las
          notas privadas de reunión —estas últimas, a propósito: son lo más sensible del sistema y
          este fichero sale de la plataforma—. La copia completa es{' '}
          <code>supabase db dump</code>, y <code>scripts/restore-drill.sh</code> comprueba que de
          verdad se puede restaurar. Procedimiento en <code>BACKUP.md</code>.
        </p>
      </CardContent>
    </Card>
  )
}
