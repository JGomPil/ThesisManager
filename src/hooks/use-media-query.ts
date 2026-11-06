import * as React from 'react'

/**
 * Observa una media query del navegador y devuelve si se cumple AHORA.
 *
 * POR QUÉ UN HOOK Y NO SOLO CLASES DE TAILWIND
 * El 95 % de lo responsive se resuelve con clases (`sm:`, `lg:`), y así debe
 * seguir: es CSS, no cuesta nada y no provoca repintados. Esto es para lo que
 * las clases NO pueden hacer, que es decidir **qué se renderiza**:
 *
 *  - el calendario arranca en «agenda» en un móvil y en «mes» en un escritorio;
 *  - los gráficos reservan menos ancho para las etiquetas del eje en pantalla
 *    estrecha, y eso es un número que Recharts recibe como propiedad.
 *
 * Usarlo para esconder cosas sería un error: en el servidor de ningún sitio,
 * pero sobre todo porque un `display:none` de CSS no cuesta un render y esto sí.
 *
 * SOBRE LA PRIMERA PASADA: el valor inicial se lee de forma síncrona, no en un
 * efecto. Si se leyera después, el calendario pintaría la vista de mes y
 * saltaría a agenda a la vista del usuario.
 */
export function useMediaQuery(query: string): boolean {
  const [coincide, setCoincide] = React.useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  )

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const alCambiar = (e: MediaQueryListEvent) => setCoincide(e.matches)
    setCoincide(mql.matches)
    mql.addEventListener('change', alCambiar)
    return () => mql.removeEventListener('change', alCambiar)
  }, [query])

  return coincide
}

/**
 * El mismo corte que usa Tailwind para `sm:` (640 px). Está en un solo sitio
 * para que no se desincronice de las clases: si aquí dijera 768 y la clase
 * dijera 640, habría una franja de anchos en la que la pantalla se contradice.
 */
export const CONSULTA_MOVIL = '(max-width: 639px)'

export const useIsPhone = (): boolean => useMediaQuery(CONSULTA_MOVIL)
