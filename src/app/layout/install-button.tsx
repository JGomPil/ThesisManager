import * as React from 'react'
import { MonitorDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * «Instalar la aplicación», pero solo cuando el navegador de verdad lo ofrece.
 *
 * EL PROBLEMA QUE RESUELVE, QUE ES DE SITIO Y NO DE CAPACIDAD
 * En Android, Chrome ofrece instalar con un aviso que aparece solo. En el
 * escritorio no: cumple los requisitos exactamente igual, pero la opción vive
 * escondida en un icono del cuadro de direcciones o en el menú de tres puntos
 * («Guardar y compartir» → «Instalar página como aplicación»). O sea que la
 * aplicación era instalable y parecía que no.
 *
 * CÓMO FUNCIONA
 * El navegador dispara `beforeinstallprompt` cuando considera que la página se
 * puede instalar. Se guarda ese evento y se enseña el botón; al pulsarlo se
 * llama a su `prompt()`, que es la única forma de abrir el diálogo nativo —no
 * se puede invocar por iniciativa propia, y está bien que sea así.
 *
 * POR QUÉ ES UN BOTÓN QUE APARECE Y DESAPARECE
 * Si el evento no llega, el botón NO se dibuja, y eso es información: significa
 * que este navegador no la instala (Safari no implementa el evento; en iOS se
 * usa «Añadir a pantalla de inicio») o que ya está instalada. Un botón
 * permanente que a veces no hiciera nada sería peor que no tenerlo: mandaría a
 * buscar el fallo donde no está.
 *
 * `preventDefault()` no es opcional: sin él, Chrome muestra además su propio
 * aviso y el evento se consume, así que el botón quedaría inservible.
 */

type PromptEvent = Event & { prompt: () => Promise<void> }

export function InstallButton({ className }: { className?: string }) {
  const [evento, setEvento] = React.useState<PromptEvent | null>(null)

  React.useEffect(() => {
    const alPoder = (e: Event) => {
      e.preventDefault()
      setEvento(e as PromptEvent)
    }
    // Ya instalada: se retira el botón sin esperar a recargar.
    const alInstalar = () => setEvento(null)

    window.addEventListener('beforeinstallprompt', alPoder)
    window.addEventListener('appinstalled', alInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', alPoder)
      window.removeEventListener('appinstalled', alInstalar)
    }
  }, [])

  if (!evento) return null

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      title="Instalar la aplicación"
      aria-label="Instalar la aplicación"
      onClick={() => {
        // El evento sirve UNA vez: se suelta antes de esperar la respuesta,
        // porque dejarlo puesto deja un botón que ya no abre nada.
        const e = evento
        setEvento(null)
        void e.prompt()
      }}
    >
      <MonitorDown />
    </Button>
  )
}
