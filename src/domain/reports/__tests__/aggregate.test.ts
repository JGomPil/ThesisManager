import { describe, expect, it } from 'vitest'
import { ATTENTION_LABELS } from '@/domain/works/progress'
import {
  buildWorkReports, byPerson, isLate, summarize, toCsv,
  type ReportMilestone, type ReportTask, type ReportWork,
} from '../aggregate'

const HOY = new Date('2027-03-15T10:00:00Z')

const persona = (id: string, nombre: string) => ({ id, full_name: nombre })

const miembro = (
  id: string, nombre: string,
  papel: 'student' | 'supervisor',
  extra: { is_primary?: boolean; status?: string } = {},
) => ({
  user_id: id,
  status: extra.status ?? 'ACTIVE',
  is_primary: extra.is_primary ?? false,
  role: { is_student: papel === 'student', is_supervisory: papel === 'supervisor' },
  profile: persona(id, nombre),
})

const trabajo = (o: Partial<ReportWork> = {}): ReportWork => ({
  id: 'W1',
  title: 'TFG de prueba',
  start_date: '2027-01-01',
  expected_end_date: '2027-06-30',
  actual_end_date: null,
  defense_date: null,
  progress_override: null,
  work_type: { name: 'Trabajo Fin de Grado', short_name: 'TFG' },
  status: { name: 'En desarrollo', color: 'sky', is_terminal: false },
  academic_year: { code: '2026/2027' },
  program: { name: 'Grado en Ingeniería Biomédica' },
  research_line: { name: 'Neuroimagen' },
  members: [miembro('E1', 'Estudiante Uno', 'student'), miembro('D1', 'Directora Una', 'supervisor', { is_primary: true })],
  ...o,
})

const tarea = (o: Partial<ReportTask> = {}): ReportTask => ({
  work_id: 'W1', status: 'PENDIENTE', due_date: null, parent_task_id: null, ...o,
})

const hito = (o: Partial<ReportMilestone> = {}): ReportMilestone => ({
  work_id: 'W1', due_date: '2027-02-01', is_met: false, ...o,
})

describe('buildWorkReports', () => {
  it('arrastra las DOS cifras de progreso por separado y nunca las funde', () => {
    const [fila] = buildWorkReports(
      [trabajo({ progress_override: 40 })],
      [tarea({ status: 'COMPLETADA' }), tarea(), tarea({ status: 'COMPLETADA' }), tarea({ status: 'COMPLETADA' })],
      [],
      HOY,
    )
    expect(fila!.progress.taskCompletion).toBe(75)
    expect(fila!.progress.academicProgress).toBe(40)
  })

  it('no cuenta las subtareas: son puntos de una lista, no tareas del plan', () => {
    const [fila] = buildWorkReports(
      [trabajo()],
      [tarea(), tarea({ parent_task_id: 'X', status: 'COMPLETADA' })],
      [], HOY,
    )
    expect(fila!.progress.totalTasks).toBe(1)
    expect(fila!.progress.taskCompletion).toBe(0)
  })

  it('reparte las tareas por trabajo y no las mezcla', () => {
    const filas = buildWorkReports(
      [trabajo(), trabajo({ id: 'W2', title: 'Tesis' })],
      [tarea({ work_id: 'W1' }), tarea({ work_id: 'W2', status: 'COMPLETADA' })],
      [], HOY,
    )
    expect(filas.find((f) => f.id === 'W1')!.progress.taskCompletion).toBe(0)
    expect(filas.find((f) => f.id === 'W2')!.progress.taskCompletion).toBe(100)
  })

  it('un hito sin cumplir con fecha pasada está vencido; uno futuro, no', () => {
    const [fila] = buildWorkReports(
      [trabajo()],
      [],
      [hito({ due_date: '2027-02-01' }), hito({ due_date: '2027-12-01' }), hito({ due_date: '2027-01-01', is_met: true })],
      HOY,
    )
    expect(fila!.totalMilestones).toBe(3)
    expect(fila!.metMilestones).toBe(1)
    expect(fila!.overdueMilestones).toBe(1)
  })

  it('ignora a los participantes inactivos: el informe es de quien está', () => {
    const [fila] = buildWorkReports(
      [trabajo({
        members: [
          miembro('E1', 'Estudiante Uno', 'student'),
          miembro('E2', 'Se fue', 'student', { status: 'INACTIVE' }),
        ],
      })],
      [], [], HOY,
    )
    expect(fila!.students.map((s) => s.name)).toEqual(['Estudiante Uno'])
  })

  it('la dirección principal es la marcada como principal, no la primera de la lista', () => {
    const [fila] = buildWorkReports(
      [trabajo({
        members: [
          miembro('D2', 'Codirector', 'supervisor'),
          miembro('D1', 'Directora Una', 'supervisor', { is_primary: true }),
        ],
      })],
      [], [], HOY,
    )
    expect(fila!.primarySupervisor!.name).toBe('Directora Una')
    expect(fila!.supervisors).toHaveLength(2)
  })

  it('un trabajo terminado no acumula señales de atención aunque se le pasara la fecha', () => {
    const [fila] = buildWorkReports(
      [trabajo({
        expected_end_date: '2026-01-01',
        status: { name: 'Defendido', color: 'green', is_terminal: true },
      })],
      [], [], HOY,
    )
    expect(fila!.attention).toEqual([])
    expect(isLate(fila!)).toBe(false)
  })
})

describe('summarize', () => {
  const filas = buildWorkReports(
    [
      trabajo({ id: 'W1' }),
      trabajo({ id: 'W2', expected_end_date: '2027-01-01' }),            // fecha pasada
      trabajo({ id: 'W3', status: { name: 'Defendido', color: 'green', is_terminal: true } }),
      trabajo({ id: 'W4', work_type: { name: 'Tesis doctoral', short_name: 'Tesis' } }),
    ],
    [tarea({ work_id: 'W1' })],
    [], HOY,
  )

  it('cuenta activos, terminados y con retraso sin solaparlos mal', () => {
    const i = summarize(filas)
    expect(i.total).toBe(4)
    expect(i.active).toBe(3)
    expect(i.finished).toBe(1)
    expect(i.late).toBe(1)
  })

  it('«sin planificación» solo cuenta trabajos vivos: uno defendido sin tareas no es un problema', () => {
    const i = summarize(filas)
    // W2 y W4 están vivos y sin tareas; W1 tiene una; W3 está defendido.
    expect(i.withoutPlan).toBe(2)
  })

  it('agrupa por tipo y ordena de más a menos', () => {
    const i = summarize(filas)
    expect(i.byType[0]!.label).toBe('TFG')
    expect(i.byType[0]!.total).toBe(3)
    expect(i.byType[1]!).toEqual({ label: 'Tesis', total: 1, late: 0 })
  })
})

describe('byPerson', () => {
  it('la misma persona aparece como estudiante de su tesis y como directora de un TFG', () => {
    const filas = buildWorkReports(
      [
        trabajo({ id: 'W1', members: [miembro('P', 'Persona Doble', 'supervisor', { is_primary: true })] }),
        trabajo({ id: 'W2', members: [miembro('P', 'Persona Doble', 'student')] }),
      ],
      [], [], HOY,
    )
    expect(byPerson(filas, 'supervisor').map((p) => p.id)).toEqual(['P'])
    expect(byPerson(filas, 'student')[0]!.works.map((w) => w.id)).toEqual(['W2'])
  })

  it('suma las tareas atrasadas de todos los trabajos de la persona', () => {
    const filas = buildWorkReports(
      [trabajo({ id: 'W1' }), trabajo({ id: 'W2' })],
      [
        tarea({ work_id: 'W1', due_date: '2027-01-01' }),
        tarea({ work_id: 'W2', due_date: '2027-01-02' }),
        tarea({ work_id: 'W2', due_date: '2027-12-02' }),
      ],
      [], HOY,
    )
    expect(byPerson(filas, 'student')[0]!.overdueTasks).toBe(2)
  })
})

describe('toCsv', () => {
  const filas = buildWorkReports([trabajo({ title: 'Título con ; y "comillas"' })], [], [], HOY)

  it('separa con punto y coma, que es lo que espera Excel en español', () => {
    const csv = toCsv(filas, ATTENTION_LABELS)
    expect(csv.split('\r\n')[0]).toContain('Título;Tipo;Estado')
  })

  it('entrecomilla y duplica las comillas de un título que lleva el separador', () => {
    const csv = toCsv(filas, ATTENTION_LABELS)
    expect(csv).toContain('"Título con ; y ""comillas"""')
  })

  it('deja las dos cifras de progreso en columnas distintas', () => {
    const csv = toCsv(filas, ATTENTION_LABELS)
    const cabecera = csv.split('\r\n')[0]!.split(';')
    expect(cabecera).toContain('% tareas completadas')
    expect(cabecera).toContain('Progreso académico (%)')
  })

  it('una celda vacía es vacía, no «null»', () => {
    const csv = toCsv(filas, ATTENTION_LABELS)
    expect(csv).not.toContain('null')
  })
})
