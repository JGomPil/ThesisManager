import * as React from 'react'
import { cn } from '@/lib/utils'
import { analiza } from '@/domain/comments/markup'
import type { Bloque, Inline } from '@/domain/comments/markup'

/**
 * Pinta un texto con el formato de `domain/comments/markup`.
 *
 * NO HAY `dangerouslySetInnerHTML` AQUÍ, Y NO PUEDE HABERLO. Lo que entra lo
 * ha escrito una persona y lo lee todo el mundo con acceso al trabajo; si
 * esto montara HTML, un comentario con `<img onerror=…>` se ejecutaría en la
 * sesión de quien lo leyera. Lo que se recorre es un árbol de nodos y lo que
 * se devuelve son elementos de React, así que el texto va SIEMPRE escapado:
 * quien escriba `<script>` verá escrito `<script>`. Esa garantía la da este
 * fichero por construcción, no por revisarlo cada vez.
 *
 * El texto sin marcas —los comentarios de antes de que esto existiera— sale
 * igual que salía: un párrafo con sus saltos de línea.
 */
export function TextoConFormato({ texto, className }: { texto: string; className?: string }) {
  const bloques = React.useMemo(() => analiza(texto), [texto])

  return (
    <div className={cn('space-y-2 break-words text-sm leading-relaxed', className)}>
      {bloques.map((b, i) => (
        <BloqueDeTexto key={i} bloque={b} />
      ))}
    </div>
  )
}

function BloqueDeTexto({ bloque }: { bloque: Bloque }) {
  if (bloque.tipo === 'lista') {
    const Etiqueta = bloque.ordenada ? 'ol' : 'ul'
    return (
      // `ml-5` y no `pl-5`: el punto o el número se pintan FUERA de la caja, y
      // con relleno en vez de margen se salen por la izquierda de la tarjeta.
      <Etiqueta className={cn('ml-5 space-y-0.5', bloque.ordenada ? 'list-decimal' : 'list-disc')}>
        {bloque.puntos.map((p, i) => (
          <li key={i}>
            <Trozos nodos={p} />
          </li>
        ))}
      </Etiqueta>
    )
  }

  return (
    <p>
      {bloque.lineas.map((linea, i) => (
        <React.Fragment key={i}>
          {i > 0 && <br />}
          <Trozos nodos={linea} />
        </React.Fragment>
      ))}
    </p>
  )
}

function Trozos({ nodos }: { nodos: Inline[] }) {
  return (
    <>
      {nodos.map((n, i) => {
        if (n.tipo === 'texto') return <React.Fragment key={i}>{n.texto}</React.Fragment>
        if (n.tipo === 'negrita') {
          return (
            <strong key={i} className="font-semibold">
              <Trozos nodos={n.hijos} />
            </strong>
          )
        }
        if (n.tipo === 'cursiva') {
          return (
            <em key={i}>
              <Trozos nodos={n.hijos} />
            </em>
          )
        }
        return (
          // `underline-offset-2`: pegado a la letra, el subrayado se come los
          // descendentes de las jotas y las ges.
          <u key={i} className="underline underline-offset-2">
            <Trozos nodos={n.hijos} />
          </u>
        )
      })}
    </>
  )
}
