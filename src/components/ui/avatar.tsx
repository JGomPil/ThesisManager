import * as React from 'react'
import { cn } from '@/lib/utils'
import { useAvatarUrl } from '@/lib/avatars'
import { iniciales, tonoDe } from '@/domain/people/avatar'

/**
 * Cara o iniciales. Nunca un hueco.
 *
 * POR QUÉ SIEMPRE HAY ALGO QUE PINTAR
 * La foto es opcional —y debe seguir siéndolo: es un dato personal que nadie
 * está obligado a dar—, así que las iniciales no son un estado de carga, son la
 * mitad de los casos. Y un círculo vacío donde debería haber una persona se lee
 * como un error de la aplicación.
 *
 * EL COLOR SALE DEL NOMBRE, no de una lista cíclica. Así la misma persona tiene
 * siempre el mismo color en todas las pantallas, que es lo que permite
 * reconocerla de un vistazo —el único motivo por el que esto existe—. Eso y las
 * iniciales viven en `domain/people/avatar.ts`, puro y con pruebas.
 */
const TAMANOS = {
  xs: 'size-6 text-[10px]',
  sm: 'size-7 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-16 text-xl',
  xl: 'size-24 text-3xl',
} as const

export function Avatar({
  name,
  src,
  size = 'sm',
  className,
  title,
}: {
  name: string | null | undefined
  /** `profiles.avatar_url`: la RUTA en el cubo privado, o una URL externa. */
  src?: string | null
  size?: keyof typeof TAMANOS
  className?: string
  title?: string
}) {
  const nombre = name?.trim() || 'Sin nombre'
  const url = useAvatarUrl(src)
  const [falla, setFalla] = React.useState(false)

  // Si cambia la foto, se vuelve a intentar: el `false` anterior era de la otra.
  React.useEffect(() => setFalla(false), [url])

  const base = cn(
    'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium',
    TAMANOS[size],
    className,
  )

  if (url && !falla) {
    return (
      <span className={base} title={title ?? nombre}>
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFalla(true)}
          className="size-full object-cover"
        />
      </span>
    )
  }

  // Tres iniciales (nombre y dos apellidos, como se nombra en España) van justas
  // en el círculo pequeño, así que se aprietan. Dos no necesitan apretarse, y
  // apretarlas se nota.
  const letras = iniciales(nombre)

  return (
    <span
      className={cn(base, `tone-${tonoDe(nombre)}`, letras.length > 2 && 'tracking-tighter')}
      title={title ?? nombre}
      // El nombre va siempre al lado en texto, así que las iniciales son
      // decoración: anunciarlas a un lector de pantalla sería repetir.
      aria-hidden
    >
      {letras}
    </span>
  )
}

/**
 * Varias caras juntas, con tope. Para «quién participa» en una fila de listado,
 * donde no caben cinco nombres pero sí cinco caras.
 */
export function AvatarGroup({
  people,
  max = 4,
  size = 'sm',
}: {
  people: { id: string; full_name: string; avatar_url?: string | null }[]
  max?: number
  size?: keyof typeof TAMANOS
}) {
  const visibles = people.slice(0, max)
  const resto = people.length - visibles.length

  return (
    <span className="flex items-center">
      {visibles.map((p) => (
        <Avatar
          key={p.id}
          name={p.full_name}
          src={p.avatar_url}
          size={size}
          className="-ml-1.5 ring-2 ring-card first:ml-0"
        />
      ))}
      {resto > 0 && (
        <span
          className={cn(
            'relative -ml-1.5 inline-flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-card',
            TAMANOS[size],
          )}
          title={people.slice(max).map((p) => p.full_name).join(', ')}
        >
          +{resto}
        </span>
      )}
    </span>
  )
}
