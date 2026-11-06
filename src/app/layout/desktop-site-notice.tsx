import * as React from 'react'
import { Smartphone, X } from 'lucide-react'

/**
 * Aviso cuando el navegador del móvil está pidiendo «sitio para ordenador».
 *
 * POR QUÉ EXISTE
 * Con ese ajuste puesto, el navegador declara un ancho de unos 980 px y después
 * ENCOGE la página entera para que quepa en los 390 reales. El resultado es que
 * todo se ve diminuto y, peor, que **nada de lo responsive se aplica**: las
 * reglas miran el ancho declarado, así que el teléfono se considera un
 * escritorio y sale la tabla en lugar de las tarjetas.
 *
 * Es un ajuste del navegador, por sitio, que sobrevive a cualquier despliegue:
 * la aplicación no puede deshacerlo, solo puede decirlo. Nos costó un buen rato
 * averiguarlo teniéndolo delante; alguien sin a quién preguntar concluiría que
 * la plataforma está mal hecha.
 *
 * CÓMO SE DETECTA, Y POR QUÉ NO BASTA UN SOLO INDICIO
 *  - `(pointer: coarse)`: se maneja con el dedo. Descarta cualquier escritorio.
 *  - ancho declarado ≥ 700 px: el diseño cree estar en un escritorio.
 *  - y, además, UNA de estas dos:
 *      · la pantalla del aparato mide menos de 700 px → el ancho declarado es
 *        inventado;
 *      · la escala del viewport visual es < 0,9 → la página se está mostrando
 *        reducida para caber, que es exactamente el síntoma.
 *
 * Los dos últimos indicios van en «o» porque algunos navegadores también
 * falsean `screen.width` en modo escritorio, y entonces el único rastro que
 * queda es la escala. Un iPad de 1024 px no cumple ninguno de los dos: ancho
 * declarado real y escala 1, así que no ve este aviso. Ese era el falso
 * positivo que había que evitar.
 */
function pideVersionDeEscritorio(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  if (!window.matchMedia('(pointer: coarse)').matches) return false
  if (window.innerWidth < 700) return false

  const pantallaEstrecha = typeof window.screen?.width === 'number' && window.screen.width < 700
  const escala = window.visualViewport?.scale
  const reducida = typeof escala === 'number' && escala < 0.9

  return pantallaEstrecha || reducida
}

export function DesktopSiteNotice() {
  const [activo, setActivo] = React.useState(pideVersionDeEscritorio)
  const [oculto, setOculto] = React.useState(false)

  React.useEffect(() => {
    // Se reevalúa al girar el móvil y al cambiar el zoom: si el usuario
    // desactiva el ajuste, el aviso tiene que desaparecer sin recargar.
    const revisar = () => setActivo(pideVersionDeEscritorio())
    window.addEventListener('resize', revisar)
    window.addEventListener('orientationchange', revisar)
    window.visualViewport?.addEventListener('resize', revisar)
    return () => {
      window.removeEventListener('resize', revisar)
      window.removeEventListener('orientationchange', revisar)
      window.visualViewport?.removeEventListener('resize', revisar)
    }
  }, [])

  if (!activo || oculto) return null

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm print:hidden">
      <div className="mx-auto flex max-w-7xl items-start gap-2">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1">
          <strong className="font-medium">Tu navegador está pidiendo la versión de escritorio</strong>,
          y por eso se ve todo pequeño. Desactívalo para este sitio y verás la versión para móvil:
          en Chrome, menú ⋮ → desmarcar «Sitio para ordenador»; en Safari, el botón{' '}
          <span className="font-medium">aA</span> → «Solicitar sitio web para móvil».
        </p>
        <button
          type="button"
          onClick={() => setOculto(true)}
          aria-label="Ocultar el aviso"
          className="-mr-1 shrink-0 rounded p-1 opacity-70 hover:bg-amber-500/15 hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
