import { describe, expect, it } from 'vitest'
import { buildGantt, ganttRange, HEADER_HEIGHT, ROW_HEIGHT, type GanttInput } from '../gantt'

const tarea = (o: Partial<GanttInput> = {}): GanttInput => ({
  id: 'T', title: 'Tarea', start_date: null, due_date: null,
  status: 'PENDIENTE', parent_task_id: null, ...o,
})

describe('ganttRange', () => {
  it('se centra en hoy si no hay ninguna fecha, en lugar de dar anchura cero', () => {
    const hoy = new Date('2027-05-10T00:00:00Z')
    const { from, to } = ganttRange([], hoy)
    expect(from < hoy).toBe(true)
    expect(to > hoy).toBe(true)
  })

  it('garantiza una semana de ancho mínimo con un plan de un solo día', () => {
    const { from, to } = ganttRange([{ start_date: '2027-05-10', due_date: '2027-05-10' }])
    expect((to.getTime() - from.getTime()) / 86_400_000).toBeGreaterThanOrEqual(7)
  })

  it('abarca de la fecha más temprana a la más tardía', () => {
    const { from, to } = ganttRange([
      { start_date: '2027-03-01', due_date: '2027-03-20' },
      { start_date: '2027-06-01', due_date: '2027-06-10' },
    ])
    expect(from.getMonth()).toBe(1) // febrero, por el margen de tres días
    expect(to.getMonth()).toBe(5)
  })
})

describe('buildGantt', () => {
  it('coloca cada tarea en su propia fila', () => {
    const l = buildGantt(
      [
        tarea({ id: 'A', start_date: '2027-01-01', due_date: '2027-01-10' }),
        tarea({ id: 'B', start_date: '2027-01-05', due_date: '2027-01-20' }),
      ],
      [],
    )
    expect(l.bars.map((b) => b.y)).toEqual([HEADER_HEIGHT, HEADER_HEIGHT + ROW_HEIGHT])
  })

  it('la barra empieza más a la derecha si la tarea empieza más tarde', () => {
    const l = buildGantt(
      [
        tarea({ id: 'A', start_date: '2027-01-01', due_date: '2027-01-10' }),
        tarea({ id: 'B', start_date: '2027-01-05', due_date: '2027-01-20' }),
      ],
      [],
    )
    expect(l.bars[1]!.x).toBeGreaterThan(l.bars[0]!.x)
  })

  it('una tarea con una sola fecha se dibuja como un bloque mínimo, no se omite', () => {
    const l = buildGantt([tarea({ id: 'A', due_date: '2027-01-10' })], [])
    expect(l.bars).toHaveLength(1)
    expect(l.bars[0]!.width).toBeGreaterThan(0)
    expect(l.undated).toHaveLength(0)
  })

  it('las tareas sin ninguna fecha se listan aparte, no desaparecen', () => {
    const l = buildGantt([tarea({ id: 'A' })], [])
    expect(l.bars).toHaveLength(0)
    expect(l.undated.map((t) => t.id)).toEqual(['A'])
  })

  it('marca hoy solo si cae dentro de la ventana dibujada', () => {
    const dentro = buildGantt(
      [tarea({ start_date: '2027-01-01', due_date: '2027-12-01' })],
      [],
      { today: new Date('2027-06-01T00:00:00Z') },
    )
    const fuera = buildGantt(
      [tarea({ start_date: '2027-01-01', due_date: '2027-02-01' })],
      [],
      { today: new Date('2030-01-01T00:00:00Z') },
    )
    expect(dentro.todayX).not.toBeNull()
    expect(fuera.todayX).toBeNull()
  })

  it('sitúa los hitos en la misma escala que las barras', () => {
    const l = buildGantt(
      [tarea({ start_date: '2027-01-01', due_date: '2027-03-01' })],
      [{ id: 'H', name: 'Depósito', due_date: '2027-02-01', is_met: false }],
      { pxPerDay: 10 },
    )
    expect(l.marks[0]!.x).toBeGreaterThan(l.bars[0]!.x)
    expect(l.marks[0]!.x).toBeLessThan(l.bars[0]!.x + l.bars[0]!.width)
  })

  it('etiqueta por semanas en planes cortos y solo por meses en los largos', () => {
    const corto = buildGantt([tarea({ start_date: '2027-01-01', due_date: '2027-02-15' })], [])
    const largo = buildGantt([tarea({ start_date: '2027-01-01', due_date: '2029-01-01' })], [])
    expect(corto.ticks.some((t) => !t.isMonthStart)).toBe(true)
    expect(largo.ticks.every((t) => t.isMonthStart)).toBe(true)
  })
})
