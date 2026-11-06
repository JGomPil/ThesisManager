/**
 * Grafo de dependencias entre tareas.
 *
 * ESPEJO EN CLIENTE del disparador `app.assert_no_dependency_cycle` de la
 * migración 0012. Igual que `work-capabilities.ts`, NO es la medida que
 * protege nada: sirve para no ofrecer en un desplegable una opción que la base
 * de datos va a rechazar, y para poder decir por qué antes de ir al servidor.
 * La garantía está en PostgreSQL (pruebas [77] y [78]).
 */

export type Dep = { task_id: string; depends_on_task_id: string }

/** Lista de adyacencia: tarea -> tareas de las que depende. */
function adjacency(deps: Dep[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const d of deps) {
    const prev = m.get(d.task_id)
    if (prev) prev.push(d.depends_on_task_id)
    else m.set(d.task_id, [d.depends_on_task_id])
  }
  return m
}

/**
 * ¿Añadir «taskId depende de dependsOnId» cerraría un círculo?
 *
 * Se recorre hacia adelante desde `dependsOnId` buscando `taskId`. El conjunto
 * de visitados hace doble papel: evita el trabajo repetido y garantiza que el
 * recorrido termina aunque el grafo ya tuviera un ciclo, que es justo el caso
 * en el que un recorrido ingenuo se quedaría colgado.
 */
export function wouldCreateCycle(deps: Dep[], taskId: string, dependsOnId: string): boolean {
  if (taskId === dependsOnId) return true
  const adj = adjacency(deps)
  const visitados = new Set<string>()
  const pila = [dependsOnId]

  while (pila.length > 0) {
    const nodo = pila.pop()!
    if (nodo === taskId) return true
    if (visitados.has(nodo)) continue
    visitados.add(nodo)
    for (const siguiente of adj.get(nodo) ?? []) pila.push(siguiente)
  }
  return false
}

/**
 * Tareas que no se pueden empezar porque algo de lo que dependen no está
 * terminado.
 *
 * Es información, no una prohibición: la tarea sigue siendo editable y quien
 * dirige puede saltarse el orden si hace falta. Marcar en rojo lo que el plan
 * dice que todavía no toca es útil; impedirlo sería pelearse con la realidad
 * de un trabajo académico, donde el orden previsto cambia cada mes.
 */
export function blockedByDependencies(
  tasks: { id: string; status: string }[],
  deps: Dep[],
): Set<string> {
  const estado = new Map(tasks.map((t) => [t.id, t.status]))
  const bloqueadas = new Set<string>()
  for (const d of deps) {
    // Una dependencia hacia una tarea que no existe (o que no se puede ver) no
    // bloquea: en un grafo filtrado por RLS, tratarla como pendiente dejaría
    // media pantalla en rojo sin explicación posible.
    const st = estado.get(d.depends_on_task_id)
    if (st !== undefined && st !== 'COMPLETADA') bloqueadas.add(d.task_id)
  }
  return bloqueadas
}

/**
 * Orden topológico: primero lo que no depende de nada.
 *
 * Conserva el orden de entrada entre tareas comparables, de modo que el
 * `order_index` que fijó la dirección se respeta y el Gantt no baila entre dos
 * cargas de la página. Si hubiera un ciclo (no debería: lo impide la base de
 * datos), las tareas implicadas se devuelven al final en lugar de perderse o
 * provocar un bucle. Perder una tarea de la vista es peor que dibujarla en un
 * sitio discutible.
 */
export function topologicalOrder(ids: string[], deps: Dep[]): string[] {
  const conjunto = new Set(ids)
  const adj = adjacency(deps)
  const estado = new Map<string, 'visitando' | 'hecho'>()
  const salida: string[] = []

  const visitar = (id: string) => {
    const st = estado.get(id)
    if (st === 'hecho' || st === 'visitando') return
    estado.set(id, 'visitando')
    for (const dep of adj.get(id) ?? []) {
      if (conjunto.has(dep)) visitar(dep)
    }
    estado.set(id, 'hecho')
    salida.push(id)
  }

  for (const id of ids) visitar(id)
  // Cualquier id que quedara fuera por un ciclo se añade al final.
  for (const id of ids) if (!salida.includes(id)) salida.push(id)
  return salida
}
