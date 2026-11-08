import * as React from 'react'
import { Bold, Italic, List, ListOrdered, Underline } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/input'
import { aplicaFormato } from '@/domain/comments/markup-edit'
import type { Formato } from '@/domain/comments/markup-edit'

/**
 * Un campo de texto con barra de formato: negrita, cursiva, subrayado, puntos
 * y numeración.
 *
 * SIGUE SIENDO UN `<textarea>`, y eso es la decisión importante. La
 * alternativa —un `contentEditable`— trae tres problemas que no se ven hasta
 * que está hecho: produce HTML (que hay que sanear antes de guardarlo y de
 * pintarlo), se apoya en `document.execCommand`, que está retirado del
 * estándar, y pegar desde Word mete estilos del propio Word. Con un
 * `textarea`, lo que se guarda es lo que se escribió, el móvil se comporta
 * como en cualquier otro campo y lo que pinta el resultado
 * (`TextoConFormato`) no toca HTML en ningún momento.
 *
 * LO QUE SE VE MIENTRAS SE ESCRIBE SON LAS MARCAS (`**así**`), igual que en
 * GitHub. No es una limitación escondida: el botón enseña dónde ha puesto qué
 * y el resultado se ve al publicar.
 *
 * El trabajo de verdad —qué texto y qué selección quedan tras pulsar un
 * botón— está en `domain/comments/markup-edit`, que es puro y tiene pruebas.
 * Aquí solo queda leer la selección del elemento y devolvérsela después.
 */
export function MarkupEditor({
  value, onChange, onKeyDown, className, ...props
}: Omit<React.ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string
  onChange: (valor: string) => void
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  /** Dónde hay que dejar el cursor cuando React haya pintado el texto nuevo. */
  const pendiente = React.useRef<{ inicio: number; fin: number } | null>(null)

  // `useLayoutEffect` y no `useEffect`: hay que recolocar el cursor ANTES de
  // que el navegador pinte. Con `useEffect` se ve un parpadeo del cursor al
  // final del texto, y en Safari a veces se queda ahí.
  React.useLayoutEffect(() => {
    const destino = pendiente.current
    if (destino === null || ref.current === null) return
    pendiente.current = null
    ref.current.focus()
    ref.current.setSelectionRange(destino.inicio, destino.fin)
  })

  const pulsa = (formato: Formato) => {
    const el = ref.current
    if (el === null) return
    const nuevo = aplicaFormato(
      { texto: value, inicio: el.selectionStart, fin: el.selectionEnd },
      formato,
    )
    pendiente.current = { inicio: nuevo.inicio, fin: nuevo.fin }
    onChange(nuevo.texto)
  }

  return (
    <div className="space-y-1">
      {/* `role="group"` y no `toolbar`: una barra de herramientas de verdad
          obliga a moverse por ella con las flechas, y aquí son cinco botones
          dentro de un formulario donde el tabulador es lo que se espera. */}
      <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Formato del texto">
        <BotonDeFormato icono={Bold} rotulo="Negrita" atajo="⌘B" onClick={() => pulsa('negrita')} />
        <BotonDeFormato icono={Italic} rotulo="Cursiva" atajo="⌘I" onClick={() => pulsa('cursiva')} />
        <BotonDeFormato icono={Underline} rotulo="Subrayado" atajo="⌘U" onClick={() => pulsa('subrayado')} />
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <BotonDeFormato icono={List} rotulo="Lista de puntos" onClick={() => pulsa('lista')} />
        <BotonDeFormato icono={ListOrdered} rotulo="Lista numerada" onClick={() => pulsa('numerada')} />
      </div>

      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        onKeyDown={(e) => {
          // Los atajos de toda la vida. Quien escribe a teclado no baja al
          // ratón para poner una palabra en negrita.
          if ((e.metaKey || e.ctrlKey) && !e.altKey) {
            const atajo: Record<string, Formato> = { b: 'negrita', i: 'cursiva', u: 'subrayado' }
            const formato = atajo[e.key.toLowerCase()]
            if (formato !== undefined) {
              // `preventDefault` es imprescindible: ⌘U abre el código fuente
              // de la página en Chrome y Firefox.
              e.preventDefault()
              pulsa(formato)
              return
            }
          }
          onKeyDown?.(e)
        }}
        {...props}
      />
    </div>
  )
}

function BotonDeFormato({
  icono: Icono, rotulo, atajo, onClick,
}: {
  icono: React.ComponentType<{ className?: string }>
  rotulo: string
  atajo?: string
  onClick: () => void
}) {
  return (
    // `<button>` a pelo y no `<Button>`: el de la biblioteca mide 36 px y cinco
    // seguidos pesan más que el campo que decoran. Y `type="button"`, que sin
    // él un botón dentro de un formulario lo ENVÍA: pulsar «negrita» habría
    // publicado el comentario a medio escribir.
    <button
      type="button"
      onClick={onClick}
      title={atajo === undefined ? rotulo : `${rotulo} (${atajo})`}
      aria-label={rotulo}
      className={cn(
        'flex size-7 items-center justify-center rounded text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <Icono className="size-4" />
    </button>
  )
}
