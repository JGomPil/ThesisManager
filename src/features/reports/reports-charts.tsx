import type * as React from 'react'
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTheme } from '@/hooks/use-theme'
import { useIsPhone } from '@/hooks/use-media-query'
import type { Bucket } from '@/domain/reports/aggregate'

/**
 * Gráficos de los informes. En un módulo aparte y cargado con `React.lazy`
 * desde la pantalla: Recharts pesa más que cualquier otra dependencia del
 * proyecto y no debe viajar en el paquete inicial, que paga toda la gente que
 * entra a ver sus tareas y nunca abre un informe.
 *
 * TODAS LAS BARRAS SON HORIZONTALES, y no por gusto: las etiquetas son nombres
 * de estado, de tipo y de personas («Director principal», «Pendiente de
 * depósito»). En vertical habría que girarlas o recortarlas, que son las dos
 * formas de hacer ilegible un eje.
 *
 * UN SOLO TONO POR SERIE, nunca una barra de cada color: el nombre está al lado
 * de la barra, así que un color por categoría no añadiría información y haría
 * creer que el color significa algo. Donde hay dos colores significan estado —a
 * tiempo / con retraso— y van siempre con leyenda y con el número escrito al
 * final de la barra, de modo que la lectura no dependa de distinguir colores.
 *
 * La pareja de colores está validada para daltonismo y contraste en los dos
 * temas (ΔE protan 19.4, tritan 35.8; contraste ≥ 3:1 sobre las dos
 * superficies), y es la misma en claro y en oscuro justamente porque pasa las
 * dos. Lo que cambia con el tema es la tinta de los ejes y el hueco entre
 * segmentos, que debe ser del color de la tarjeta.
 */

const A_TIEMPO = '#0284c7'
const CON_RETRASO = '#ef4444'
/** Tercer tono, solo para el progreso académico frente al de tareas. Validado
 *  contra el primero en los dos temas (ΔE protan 23.4, tritan 28.6). */
const ACADEMICO = '#d97706'

export type ChartBucket = Bucket

function useColores() {
  const { theme } = useTheme()
  return theme === 'dark'
    ? { tinta: '#94a3b8', rejilla: '#1f2937', hueco: '#0e1526' }
    : { tinta: '#64748b', rejilla: '#e2e8f0', hueco: '#ffffff' }
}

const ALTO_FILA = 30

/**
 * Ancho reservado a las etiquetas del eje de categorías.
 *
 * En un teléfono la tarjeta mide unos 310 px útiles: con los 140-160 px de
 * escritorio, a la barra le quedaban 150 px y todas parecían igual de largas,
 * que es exactamente lo contrario de para qué sirve un gráfico de barras. Se
 * recorta la etiqueta (sigue entera en el tooltip) y la barra recupera sitio.
 *
 * Es un número que Recharts recibe como propiedad, así que no se puede resolver
 * con una clase de Tailwind: de ahí el hook.
 */
function useAnchoEje(escritorio: number): number {
  return useIsPhone() ? 84 : escritorio
}

function Marco({ datos, children }: { datos: unknown[]; children: React.ReactNode }) {
  if (datos.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Sin datos que representar.</p>
  }
  return (
    <ResponsiveContainer width="100%" height={datos.length * ALTO_FILA + 44}>
      {children as React.ReactElement}
    </ResponsiveContainer>
  )
}

/** Ejes recesivos: la rejilla y los números no deben competir con las barras. */
function ejes(tinta: string, rejilla: string, anchoEje: number) {
  return (
    <>
      <CartesianGrid horizontal={false} stroke={rejilla} />
      <XAxis
        type="number" allowDecimals={false}
        tick={{ fill: tinta, fontSize: 11 }} stroke={rejilla}
      />
      <YAxis
        type="category" dataKey="label" width={anchoEje}
        tick={{ fill: tinta, fontSize: 11 }} stroke={rejilla}
      />
    </>
  )
}

const ESTILO_TOOLTIP = {
  contentStyle: {
    borderRadius: 8,
    border: '1px solid rgba(100,116,139,.3)',
    fontSize: 12,
    background: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
  },
} as const

/** Una serie, un tono. El nombre de la categoría ya está en el eje. */
export function BarrasSimples({ datos, nombre }: { datos: ChartBucket[]; nombre: string }) {
  const { tinta, rejilla } = useColores()
  const anchoEje = useAnchoEje(140)
  return (
    <Marco datos={datos}>
      <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
        {ejes(tinta, rejilla, anchoEje)}
        <Tooltip {...ESTILO_TOOLTIP} />
        <Bar dataKey="total" name={nombre} fill={A_TIEMPO} radius={[0, 4, 4, 0]} barSize={14}>
          <LabelList dataKey="total" position="right" fill={tinta} fontSize={11} />
        </Bar>
      </BarChart>
    </Marco>
  )
}

/**
 * Dos segmentos que suman el total: a tiempo y con retraso. Son excluyentes a
 * propósito —un trabajo está en uno o en otro— porque apilar «total» y
 * «retrasados» contaría los retrasados dos veces y la barra mentiría.
 */
export function BarrasPorRetraso({ datos }: { datos: ChartBucket[] }) {
  const { tinta, rejilla, hueco } = useColores()
  const anchoEje = useAnchoEje(140)
  const filas = datos.map((d) => ({ ...d, aTiempo: d.total - d.late }))
  return (
    <Marco datos={filas}>
      <BarChart data={filas} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
        {ejes(tinta, rejilla, anchoEje)}
        <Tooltip {...ESTILO_TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12, color: tinta }} />
        {/* `stroke` del color de la tarjeta: es el hueco de 2 px entre los dos
            segmentos, que evita que los colores se toquen y se lean como uno. */}
        <Bar dataKey="aTiempo" name="A tiempo" stackId="t" fill={A_TIEMPO} barSize={14} stroke={hueco} strokeWidth={1} />
        <Bar dataKey="late" name="Con retraso" stackId="t" fill={CON_RETRASO} radius={[0, 4, 4, 0]} barSize={14} stroke={hueco} strokeWidth={1}>
          <LabelList dataKey="total" position="right" fill={tinta} fontSize={11} />
        </Bar>
      </BarChart>
    </Marco>
  )
}

/** Progreso de cada trabajo: las dos cifras, en dos barras separadas y etiquetadas. */
export function BarrasDeProgreso({
  datos,
}: {
  datos: { label: string; tareas: number | null; academico: number | null }[]
}) {
  const { tinta, rejilla } = useColores()
  const anchoEje = useAnchoEje(160)
  return (
    <Marco datos={datos}>
      <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke={rejilla} />
        <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fill: tinta, fontSize: 11 }} stroke={rejilla} />
        <YAxis type="category" dataKey="label" width={anchoEje} tick={{ fill: tinta, fontSize: 11 }} stroke={rejilla} />
        <Tooltip {...ESTILO_TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12, color: tinta }} />
        {/* Dos barras y no una: el porcentaje de tareas y el progreso académico
            son cifras distintas y el proyecto exige no fundirlas nunca. */}
        <Bar dataKey="tareas" name="% tareas completadas" fill={A_TIEMPO} radius={[0, 4, 4, 0]} barSize={10}>
          <LabelList dataKey="tareas" position="right" fill={tinta} fontSize={10} />
        </Bar>
        <Bar dataKey="academico" name="Progreso académico" fill={ACADEMICO} radius={[0, 4, 4, 0]} barSize={10}>
          <LabelList dataKey="academico" position="right" fill={tinta} fontSize={10} />
        </Bar>
      </BarChart>
    </Marco>
  )
}
