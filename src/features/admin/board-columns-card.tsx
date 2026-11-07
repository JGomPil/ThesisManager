import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ToneBadge } from '@/components/ui/badge'
import { ErrorPanel, Spinner } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { TONES } from '@/lib/utils'
import { errorMessage } from '@/lib/supabase'
import { catalogsRepo } from '@/data/repositories/catalogs.repo'
import { ESTADOS_TAREA } from '@/domain/plan/board'
import { moveItem, reorderWrites } from '@/domain/plan/reorder'
import { useAuth } from '@/features/auth/auth-context'
import type { BoardColumnRow, TaskStatus } from '@/data/types/database'

/**
 * Las columnas del tablero de tareas (migración 0024).
 *
 * CADA COLUMNA DICE DOS COSAS: cómo se llama —«Papers», «Estudios», lo que
 * haga falta— y QUÉ SIGNIFICA para la aplicación. Lo segundo no es burocracia:
 * de ahí salen el progreso del trabajo, el color de la barra del cronograma,
 * qué tarea bloquea a otra y los informes. Una columna llamada «Hecho» que
 * significara «en curso» dejaría el progreso del trabajo mintiendo sin que
 * nada diera error.
 *
 * NO USA `FilaCatalogo`, que es la fila de los otros catálogos, por dos
 * motivos: estas filas no tienen código, y necesitan reordenarse —el orden de
 * las columnas ES la información—. Lo que sí comparte es el criterio: borrar
 * solo se ofrece si no hay tarjetas dentro, porque la clave ajena es
 * `on delete restrict` y el botón únicamente serviría para dar un error.
 */
export function BoardColumnsCard() {
  const { organizationId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  const [editando, setEditando] = React.useState<BoardColumnRow | null>(null)
  const [nombre, setNombre] = React.useState('')
  const [color, setColor] = React.useState('slate')
  const [significado, setSignificado] = React.useState<TaskStatus>('EN_CURSO')
  const campoNombre = React.useRef<HTMLInputElement>(null)

  const columnas = useQuery({
    queryKey: qk.catalogs.boardColumns(organizationId ?? ''),
    queryFn: () => catalogsRepo.listBoardColumns(organizationId!),
    enabled: organizationId !== null,
  })
  const uso = useQuery({ queryKey: qk.catalogs.boardColumnUsage, queryFn: catalogsRepo.boardColumnUsage })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.catalogs.boardColumns(organizationId ?? '') })
    void qc.invalidateQueries({ queryKey: qk.catalogs.boardColumnUsage })
    // El tablero de cada trabajo lee estas columnas: si no se invalidan las
    // tareas, seguiría dibujando las de antes hasta que caducase la caché.
    void qc.invalidateQueries({ queryKey: qk.tasks.all })
  }

  const limpiar = () => { setEditando(null); setNombre(''); setColor('slate'); setSignificado('EN_CURSO') }

  const filas = columnas.data ?? []
  const cuenta = uso.data ?? {}

  const guardar = useMutation({
    mutationFn: async () => {
      const campos = { name: nombre.trim(), color, maps_to: significado }
      if (editando) return catalogsRepo.updateBoardColumn(editando.id, campos)
      if (!organizationId) throw new Error('No hay organización en la sesión.')
      return catalogsRepo.createBoardColumn({
        ...campos,
        organization_id: organizationId,
        // Al final del tablero, que es donde se espera que aparezca.
        display_order: filas.reduce((max, c) => Math.max(max, c.display_order), -1) + 1,
      })
    },
    onSuccess: () => { invalidate(); limpiar() },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const retirar = useMutation({
    mutationFn: (c: BoardColumnRow) => catalogsRepo.updateBoardColumn(c.id, { is_active: !c.is_active }),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const borrar = useMutation({
    mutationFn: (id: string) => catalogsRepo.removeBoardColumn(id),
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  /**
   * Reordenar. Se reutiliza el cálculo de la lista de comprobación
   * (`domain/plan/reorder.ts`): mover una columna un puesto son DOS
   * escrituras, no el catálogo entero.
   */
  const reordenar = useMutation({
    mutationFn: (orden: BoardColumnRow[]) => {
      const cambios = reorderWrites(orden.map((c) => ({ id: c.id, order_index: c.display_order })))
      return Promise.all(
        cambios.map((c) => catalogsRepo.updateBoardColumn(c.id, { display_order: c.order_index })),
      )
    },
    onSuccess: invalidate,
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const sembrar = useMutation({
    mutationFn: () => catalogsRepo.seedBoardColumns(organizationId!),
    onSuccess: () => {
      invalidate()
      toast.push('success', 'Columnas creadas. Ya puedes renombrarlas, reordenarlas o añadir otras.')
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  const mover = (desde: number, hasta: number) => {
    const orden = moveItem(filas, desde, hasta)
    if (orden !== filas) reordenar.mutate(orden)
  }

  const empezar = (c: BoardColumnRow) => {
    setEditando(c); setNombre(c.name); setColor(c.color); setSignificado(c.maps_to)
    campoNombre.current?.focus()
  }

  if (columnas.isLoading) return <Spinner />
  if (columnas.isError) return <ErrorPanel error={columnas.error} />

  // Sin filas, el tablero dibuja las cinco de siempre. Se ofrece crearlas como
  // punto de partida en lugar de empezar con un tablero vacío: la migración no
  // las siembra para no obligar a borrarlas a quien no las quiere.
  if (filas.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          El tablero de tareas está usando las <strong>cinco columnas por defecto</strong>:{' '}
          {ESTADOS_TAREA.map((e) => e.label).join(', ')}. Funciona, pero no se puede renombrar
          nada.
        </p>
        <p className="text-sm text-muted-foreground">
          Al crearlas como columnas propias podrás cambiarles el nombre, el color y el orden, y
          añadir las que necesites. Las tareas que ya existen no se mueven: cada una se coloca en
          la columna que significa su estado actual.
        </p>
        <Button size="sm" variant="outline" loading={sembrar.isPending} onClick={() => sembrar.mutate()}>
          <Plus /> Crear las columnas por defecto
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        El orden de esta lista es el orden de las columnas en el tablero: la
        primera de aquí es la de más a la izquierda.
      </p>
      <ul className="space-y-1.5">
        {filas.map((c, i) => {
          const dentro = cuenta[c.id] ?? 0
          const sentido = ESTADOS_TAREA.find((e) => e.value === c.maps_to)
          return (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              <span className="min-w-0 flex-1">
                <ToneBadge tone={c.color} className={c.is_active ? undefined : 'line-through'}>
                  {c.name}
                </ToneBadge>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>significa «{sentido?.label ?? c.maps_to}»</span>
                  {dentro > 0 && <span>· {dentro} tarea(s) dentro</span>}
                  {!c.is_active && <span>· retirada</span>}
                </span>
              </span>
              <span className="flex shrink-0 items-start">
                <Button
                  variant="ghost" size="icon" className="size-7"
                  disabled={i === 0 || reordenar.isPending}
                  onClick={() => mover(i, i - 1)}
                  aria-label={`Mover «${c.name}» antes`}
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="size-7"
                  disabled={i === filas.length - 1 || reordenar.isPending}
                  onClick={() => mover(i, i + 1)}
                  aria-label={`Mover «${c.name}» después`}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </span>
              <Button
                variant="ghost" size="icon" className="size-7 shrink-0"
                onClick={() => empezar(c)} aria-label={`Editar ${c.name}`}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost" size="sm" className="shrink-0 px-2 text-xs"
                onClick={() => retirar.mutate(c)}
              >
                {c.is_active ? 'Retirar' : 'Reactivar'}
              </Button>
              {/* Borrar solo si está vacía: con tarjetas dentro, la clave ajena
                  lo rechaza (`on delete restrict`). */}
              {dentro === 0 && (
                <Button
                  variant="ghost" size="icon" className="size-7 shrink-0"
                  onClick={() => borrar.mutate(c.id)} aria-label={`Borrar ${c.name}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      <form
        className="space-y-2 border-t pt-3"
        onSubmit={(e) => { e.preventDefault(); if (nombre.trim().length >= 2) guardar.mutate() }}
      >
        <p className="text-xs text-muted-foreground">
          {editando ? `Editando «${editando.name}».` : 'Columna nueva, al final del tablero.'}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1 space-y-1">
            <Label htmlFor="col-nombre">Nombre</Label>
            <Input
              id="col-nombre" ref={campoNombre} value={nombre}
              onChange={(e) => setNombre(e.target.value)} placeholder="Papers"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="col-significado">Significa</Label>
            <Select
              id="col-significado"
              value={significado}
              onChange={(e) => setSignificado(e.target.value as TaskStatus)}
              className="w-[10rem]"
            >
              {ESTADOS_TAREA.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="col-color">Color</Label>
            <Select id="col-color" value={color} onChange={(e) => setColor(e.target.value)} className="w-[7.5rem]">
              {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          {editando && (
            <Button type="button" size="sm" variant="ghost" onClick={limpiar}><X /> Cancelar</Button>
          )}
          <Button type="submit" size="sm" variant="outline" loading={guardar.isPending} disabled={nombre.trim().length < 2}>
            {editando ? <><Check /> Guardar</> : <><Plus /> Añadir</>}
          </Button>
        </div>
        <div className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
          <p>
            Vista previa: <ToneBadge tone={color}>{nombre.trim() || 'Nombre de la columna'}</ToneBadge>
          </p>
          <p className="mt-1.5">
            <strong>«Significa» es lo que la aplicación entiende</strong>, y no se puede deducir del
            nombre: de ahí salen el progreso del trabajo, el color de la barra en el cronograma y
            qué tarea deja de bloquear a otra. Una columna llamada «Hecho» que signifique «en
            curso» dejaría el progreso mintiendo, sin dar ningún error. Lo que se ve en el tablero
            es siempre el nombre.
          </p>
          <p className="mt-1.5">
            Mover una tarjeta a una columna cambia el estado de la tarea al significado de esa
            columna. Y al contrario: marcar una tarea como completada mueve su tarjeta a la primera
            columna que signifique «completada». Si cambias el significado de una columna que ya
            tiene tarjetas, <strong>esas tareas cambian de estado con ella</strong>: no se quedan
            con el anterior.
          </p>
        </div>
      </form>
    </div>
  )
}
