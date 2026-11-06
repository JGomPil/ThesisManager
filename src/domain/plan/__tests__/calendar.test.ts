import { describe, expect, it } from 'vitest'
import { collectEvents, groupByDay, monthGrid, weekDays } from '../calendar'

describe('collectEvents', () => {
  const tarea = {
    id: 'T1', title: 'Redactar', work_id: 'W1', status: 'PENDIENTE',
    start_date: '2027-04-01', due_date: '2027-04-20', work: { title: 'TFG-01' },
  }

  it('genera dos eventos por tarea: cuándo empieza y cuándo vence', () => {
    const e = collectEvents({ tasks: [tarea] })
    expect(e.map((x) => x.kind).sort()).toEqual(['TASK_DUE', 'TASK_START'])
    expect(e.find((x) => x.kind === 'TASK_START')!.day).toBe('2027-04-01')
    expect(e.find((x) => x.kind === 'TASK_DUE')!.day).toBe('2027-04-20')
  })

  it('no inventa eventos para las fechas que faltan', () => {
    const e = collectEvents({ tasks: [{ ...tarea, start_date: null }] })
    expect(e).toHaveLength(1)
    expect(e[0]!.kind).toBe('TASK_DUE')
  })

  it('marca como hecho lo completado y lo cumplido', () => {
    const e = collectEvents({
      tasks: [{ ...tarea, status: 'COMPLETADA' }],
      milestones: [{ id: 'H', name: 'Depósito', work_id: 'W1', due_date: '2027-05-01', is_met: true }],
    })
    expect(e.every((x) => x.done)).toBe(true)
  })

  it('extrae el día y la hora de una reunión en una sola pasada', () => {
    const e = collectEvents({
      meetings: [{ id: 'M', title: 'Seguimiento', work_id: 'W1', scheduled_at: '2027-04-10T09:30:00Z' }],
    })
    expect(e[0]!.day).toBe('2027-04-10')
    expect(e[0]!.time).toMatch(/^\d{2}:\d{2}$/)
  })

  it('ordena por día y, dentro del día, la reunión antes que la tarea', () => {
    const e = collectEvents({
      tasks: [{ ...tarea, start_date: '2027-04-10', due_date: null }],
      meetings: [{ id: 'M', title: 'Reunión', work_id: 'W1', scheduled_at: '2027-04-10T09:00:00Z' }],
      milestones: [{ id: 'H', name: 'Hito', work_id: 'W1', due_date: '2027-04-10', is_met: false }],
    })
    expect(e.map((x) => x.kind)).toEqual(['MEETING', 'MILESTONE', 'TASK_START'])
  })
})

describe('groupByDay', () => {
  it('agrupa sin perder ningún evento', () => {
    const e = collectEvents({
      tasks: [
        { id: 'A', title: 'A', work_id: 'W', status: 'PENDIENTE', start_date: '2027-04-01', due_date: '2027-04-01' },
        { id: 'B', title: 'B', work_id: 'W', status: 'PENDIENTE', start_date: '2027-04-02', due_date: null },
      ],
    })
    const g = groupByDay(e)
    expect(g.get('2027-04-01')).toHaveLength(2)
    expect(g.get('2027-04-02')).toHaveLength(1)
  })
})

describe('monthGrid', () => {
  it('devuelve semanas completas de siete días', () => {
    const g = monthGrid(new Date('2027-04-15T00:00:00Z'))
    expect(g.every((semana) => semana.length === 7)).toBe(true)
  })

  it('empieza en lunes', () => {
    const g = monthGrid(new Date('2027-04-15T00:00:00Z'))
    // 1 de abril de 2027 es jueves: la rejilla debe arrancar el lunes 29/03.
    expect(g[0]![0]!.day).toBe('2027-03-29')
    expect(g[0]![0]!.inMonth).toBe(false)
  })

  it('marca qué días son del mes pedido', () => {
    const g = monthGrid(new Date('2027-04-15T00:00:00Z'))
    const delMes = g.flat().filter((d) => d.inMonth)
    expect(delMes).toHaveLength(30)
  })
})

describe('weekDays', () => {
  it('da los siete días de lunes a domingo', () => {
    const s = weekDays(new Date('2027-04-15T00:00:00Z')) // jueves
    expect(s).toHaveLength(7)
    expect(s[0]).toBe('2027-04-12')
    expect(s[6]).toBe('2027-04-18')
  })
})
