import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { HardDrive, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/ui/badge'
import { ErrorPanel, Spinner } from '@/components/common/states'
import { cn } from '@/lib/utils'
import { qk } from '@/lib/query-keys'
import { planUsage, type UsoDeCubo } from '@/data/repositories/maintenance.repo'
import {
  LIMITE_FICHEROS_BYTES, contrastar, formatearBytes, nivelOcupacion, porcentajeOcupado,
  type Contraste,
} from '@/domain/admin/plan-usage'

/**
 * Cuánto se lleva gastado del plan gratuito en ficheros.
 *
 * POR QUÉ HACE FALTA. El gigabyte de Storage es el límite que de verdad
 * aprieta en este proyecto: cada versión de un documento es un fichero nuevo y
 * las versiones no se borran. Hasta ahora nada lo decía, así que la forma
 * normal de enterarse era que a alguien le fallara una subida con el documento
 * delante.
 *
 * SE CALCULA CUANDO SE PIDE, no al abrir la pantalla. La API de Storage no
 * lista de forma recursiva: hay una petición por carpeta, y las rutas de los
 * documentos tienen tres niveles. Lanzar eso en cada visita a Administración
 * sería docenas de peticiones para una cifra que cambia despacio.
 *
 * NO FINGE MEDIR LO QUE NO MIDE. Mide ficheros, no base de datos, y cuenta lo
 * que esta cuenta puede ver. Las dos cosas están escritas en la tarjeta,
 * porque una cifra con aire de total es peor que ninguna.
 */

const CARTEL: Record<Exclude<Contraste, 'COINCIDE'>, (d: number) => string> = {
  NADA_VISIBLE: (esperados) =>
    `La base de datos dice que aquí hay ${esperados} fichero(s) y el cubo no devuelve ninguno. ` +
    'Eso NO significa «está vacío»: la API de Storage responde igual —200 y lista vacía— cuando ' +
    'las políticas no dejan ver nada. Hay que comprobarlo antes de dar la cifra por buena.',
  FALTAN: (diferencia) =>
    `Faltan ${diferencia} fichero(s) respecto a las filas que los reclaman. Lo habitual es una ` +
    'subida que se cortó a medias: la fila quedó escrita y el fichero no llegó.',
  HUERFANOS: (diferencia) =>
    `Hay ${diferencia} fichero(s) de más, sin ninguna fila que los reclame. Ocupan sitio del ` +
    'gigabyte gratuito y nadie los va a abrir.',
}

function FilaCubo({ cubo }: { cubo: UsoDeCubo }) {
  const estado = contrastar({ enStorage: cubo.ficheros, esperados: cubo.esperados })
  const diferencia = Math.abs(cubo.ficheros - cubo.esperados)

  return (
    <div className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-muted-foreground">{cubo.etiqueta}</span>
        <span className="font-medium">
          {formatearBytes(cubo.bytes)}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {cubo.ficheros} fichero(s){cubo.truncado && ' o más'}
          </span>
        </span>
      </div>
      {estado !== 'COINCIDE' && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          {CARTEL[estado](estado === 'NADA_VISIBLE' ? cubo.esperados : diferencia)}
        </p>
      )}
    </div>
  )
}

export function PlanUsageCard() {
  const [pedido, setPedido] = React.useState(false)
  const uso = useQuery({
    queryKey: qk.planUsage,
    queryFn: planUsage,
    enabled: pedido,
    retry: false,
    staleTime: 5 * 60_000,
  })

  const bytes = uso.data?.bytes ?? 0
  const nivel = nivelOcupacion(bytes)
  const pct = porcentajeOcupado(bytes)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardDrive className="size-4 text-muted-foreground" /> Consumo del plan gratuito
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-sm">
        {!pedido && (
          <>
            <p className="text-muted-foreground">
              Espacio ocupado por los ficheros de los tres cubos privados —documentos de los
              trabajos, material de las plantillas y fotos de perfil— frente al gigabyte que da el
              plan gratuito de Supabase.
            </p>
            <Button variant="outline" onClick={() => setPedido(true)}>
              <HardDrive /> Calcular el espacio ocupado
            </Button>
            <p className="text-xs text-muted-foreground">
              Se calcula a petición: la API de Storage no lista de forma recursiva, así que hay una
              consulta por carpeta y son unas cuantas.
            </p>
          </>
        )}

        {pedido && uso.isLoading && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner /> Recorriendo los cubos…
          </p>
        )}

        {uso.isError && <ErrorPanel error={uso.error} />}

        {uso.data && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-2xl font-semibold tabular-nums">
                {formatearBytes(uso.data.bytes)}
              </span>
              <span className="text-xs text-muted-foreground">
                de {formatearBytes(LIMITE_FICHEROS_BYTES)} · {pct} %
              </span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full transition-[width]',
                  nivel === 'ok' && 'bg-primary',
                  nivel === 'aviso' && 'bg-amber-500',
                  nivel === 'critico' && 'bg-destructive',
                )}
                style={{ width: `${pct}%` }}
              />
            </div>

            {nivel !== 'ok' && (
              <p className={cn('text-xs', nivel === 'critico' ? 'text-destructive' : 'text-amber-700 dark:text-amber-500')}>
                {nivel === 'critico'
                  ? 'Queda menos del 10 % del espacio. Mueve los documentos antiguos a la unidad institucional antes de que falle una subida.'
                  : 'Pasado el 70 %. Liberar sitio aquí significa mover documentos a la unidad institucional, y eso lleva tiempo: conviene empezar a planearlo.'}
              </p>
            )}

            <div className="space-y-2">
              {uso.data.cubos.map((c) => <FilaCubo key={c.bucket} cubo={c} />)}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <Button
                variant="ghost" size="sm"
                loading={uso.isFetching}
                onClick={() => void uso.refetch()}
              >
                <RefreshCw /> Volver a calcular
              </Button>
              <ToneBadge tone={uso.data.esperados === uso.data.ficheros ? 'emerald' : 'amber'}>
                {uso.data.ficheros} fichero(s) · {uso.data.esperados} según la base
              </ToneBadge>
            </div>

            <p className="text-xs text-muted-foreground">
              Las dos cifras se comparan a propósito. Un recuento de ficheros no demuestra nada por
              sí solo: la API de Storage devuelve «correcto, ninguno» tanto si el cubo está vacío
              como si las políticas no dejan ver su contenido, de modo que la única manera de saber
              si la cifra es cierta es contrastarla con las filas que dicen que esos ficheros
              existen.
            </p>
            <p className="text-xs text-muted-foreground">
              Cuenta <strong>lo que esta cuenta puede ver</strong> y mide <strong>solo
              ficheros</strong>: el tamaño de la base de datos no se puede consultar desde el
              navegador. El total exacto del proyecto, con la base incluida, está en el panel de
              Supabase (Settings → Usage).
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
