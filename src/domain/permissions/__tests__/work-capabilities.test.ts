import { describe, expect, it } from 'vitest'
import { canEditTask, resolveWorkCapabilities, type MemberLike } from '../work-capabilities'

const SUPERVISOR = {
  is_student: false, is_supervisory: true,
  can_manage_plan: true, can_see_private_notes: true,
  can_validate_deliverables: true, can_manage_members: true,
}
const CO_SUPERVISOR = { ...SUPERVISOR, can_manage_members: false }
const STUDENT = {
  is_student: true, is_supervisory: false,
  can_manage_plan: false, can_see_private_notes: false,
  can_validate_deliverables: false, can_manage_members: false,
}
const COLLABORATOR = {
  is_student: false, is_supervisory: true,
  can_manage_plan: false, can_see_private_notes: false,
  can_validate_deliverables: false, can_manage_members: false,
}

const m = (user_id: string, role: MemberLike['role'], extra: Partial<MemberLike> = {}): MemberLike => ({
  user_id, role, status: 'ACTIVE', ...extra,
})

describe('resolveWorkCapabilities', () => {
  it('un director tiene todas las capacidades de supervisión', () => {
    const caps = resolveWorkCapabilities([m('u1', SUPERVISOR)], 'u1', false)
    expect(caps).toMatchObject({
      isSupervisor: true, isStudent: false,
      canManagePlan: true, canSeePrivateNotes: true, canManageMembers: true,
    })
  })

  it('un estudiante no puede gestionar el plan ni ver notas privadas', () => {
    const caps = resolveWorkCapabilities([m('u2', STUDENT)], 'u2', false)
    expect(caps.canManagePlan).toBe(false)
    expect(caps.canSeePrivateNotes).toBe(false)
    expect(caps.isStudent).toBe(true)
  })

  it('quien no participa no es miembro', () => {
    const caps = resolveWorkCapabilities([m('u1', SUPERVISOR)], 'u3', false)
    expect(caps.isMember).toBe(false)
    expect(caps.canManagePlan).toBe(false)
  })

  it('une capacidades cuando hay varias funciones: tener más nunca resta', () => {
    const caps = resolveWorkCapabilities([m('u1', COLLABORATOR), m('u1', CO_SUPERVISOR)], 'u1', false)
    expect(caps.canManagePlan).toBe(true)
    expect(caps.canValidateDeliverables).toBe(true)
  })

  it('REGLA CRÍTICA: siendo también estudiante del trabajo, no ve las notas privadas', () => {
    // El doctorando que además co-dirige formalmente su propio trabajo.
    const caps = resolveWorkCapabilities([m('u1', STUDENT), m('u1', CO_SUPERVISOR)], 'u1', false)
    expect(caps.isStudent).toBe(true)
    expect(caps.isSupervisor).toBe(true)
    expect(caps.canManagePlan).toBe(true)        // sí gestiona el plan
    expect(caps.canSeePrivateNotes).toBe(false)  // pero NUNCA las notas sobre él
  })

  it('ni siquiera el rol de administrador rompe la protección del estudiante', () => {
    const caps = resolveWorkCapabilities([m('u1', STUDENT)], 'u1', true)
    expect(caps.canSeePrivateNotes).toBe(false)
  })

  it('un administrador sin relación académica ve y gestiona, pero no es supervisor', () => {
    const caps = resolveWorkCapabilities([m('u1', SUPERVISOR)], 'admin', true)
    expect(caps.isMember).toBe(true)
    expect(caps.canManagePlan).toBe(true)
    expect(caps.isSupervisor).toBe(false)
  })

  it('permissions deniega explícitamente una capacidad del rol', () => {
    const caps = resolveWorkCapabilities(
      [m('u1', SUPERVISOR, { permissions: { can_manage_members: false } })], 'u1', false,
    )
    expect(caps.canManageMembers).toBe(false)
    expect(caps.canManagePlan).toBe(true)
  })

  it('permissions concede una capacidad que el rol no da', () => {
    const caps = resolveWorkCapabilities(
      [m('u1', COLLABORATOR, { permissions: { can_manage_plan: true } })], 'u1', false,
    )
    expect(caps.canManagePlan).toBe(true)
  })

  it('una relación inactiva no concede nada', () => {
    const caps = resolveWorkCapabilities([m('u1', SUPERVISOR, { status: 'INACTIVE' })], 'u1', false)
    expect(caps.isMember).toBe(false)
    expect(caps.canManagePlan).toBe(false)
  })

  it('sin sesión no hay capacidades', () => {
    const caps = resolveWorkCapabilities([m('u1', SUPERVISOR)], null, false)
    expect(caps.isMember).toBe(false)
  })
})

/**
 * LO QUE LA 0030 ABRE AL ALUMNO, Y LO QUE SIGUE CERRADO.
 *
 * Este bloque es el espejo en cliente de la migración, y existe para que no se
 * separen sin que nadie se entere: aquí se decide qué botones se pintan, y si
 * dijera que sí donde la base dice que no, el alumno vería un botón que da
 * error de permisos al pulsarlo.
 */
describe('el alumno en su propio trabajo (0030)', () => {
  const alumno = resolveWorkCapabilities([m('u2', STUDENT)], 'u2', false)

  it('escribe el contenido académico, sus hitos y las reuniones', () => {
    expect(alumno.canEditAcademicContent).toBe(true)
    expect(alumno.canManageMilestones).toBe(true)
    expect(alumno.canManageMeetings).toBe(true)
  })

  it('pero NO lleva el expediente ni el plan', () => {
    // `canEditWork` es lo que abre estado, fechas y progreso en la ficha.
    expect(alumno.canEditWork).toBe(false)
    expect(alumno.canManagePlan).toBe(false)
    expect(alumno.canSeePrivateNotes).toBe(false)
    expect(alumno.canManageMembers).toBe(false)
    expect(alumno.canValidateDeliverables).toBe(false)
  })

  it('edita la tarea que tiene asignada, y no la de otro', () => {
    expect(canEditTask(alumno, { assignee_id: 'u2' }, 'u2')).toBe(true)
    expect(canEditTask(alumno, { assignee_id: 'u9' }, 'u2')).toBe(false)
    expect(canEditTask(alumno, { assignee_id: null }, 'u2')).toBe(false)
  })

  it('quien planifica edita cualquiera, sea suya o no', () => {
    const director = resolveWorkCapabilities([m('u1', SUPERVISOR)], 'u1', false)
    expect(canEditTask(director, { assignee_id: 'u2' }, 'u1')).toBe(true)
    expect(canEditTask(director, { assignee_id: null }, 'u1')).toBe(true)
  })

  it('sin sesión no se edita nada, ni una tarea sin responsable', () => {
    const nadie = resolveWorkCapabilities([m('u2', STUDENT)], null, false)
    expect(canEditTask(nadie, { assignee_id: null }, null)).toBe(false)
  })

  /**
   * Quien no es alumno ni supervisión —un colaborador— no hereda nada de esto:
   * lo que abre la 0030 es ser EL ALUMNO del trabajo, no estar en él.
   */
  it('un colaborador no entra por esta puerta', () => {
    const colaborador = resolveWorkCapabilities([m('u3', COLLABORATOR)], 'u3', false)
    expect(colaborador.canManageMilestones).toBe(false)
    expect(colaborador.canEditAcademicContent).toBe(true) // por ser supervisión
  })
})

/**
 * APUNTAR UNA TAREA NUEVA (0033).
 *
 * Lo que hay que vigilar aquí es que `canCreateTasks` NO arrastre lo demás:
 * quien lo tiene por ser alumno sigue sin planificar, y eso es lo que hace que
 * el formulario le fije el responsable en vez de ofrecerle el desplegable.
 */
describe('apuntar una tarea nueva (0033)', () => {
  it('el alumno apunta tareas, y sigue sin planificar', () => {
    const alumno = resolveWorkCapabilities([m('u2', STUDENT)], 'u2', false)
    expect(alumno.canCreateTasks).toBe(true)
    expect(alumno.canManagePlan).toBe(false)
  })

  it('quien planifica, también', () => {
    expect(resolveWorkCapabilities([m('u1', SUPERVISOR)], 'u1', false).canCreateTasks).toBe(true)
  })

  it('la administración del grupo, aunque no esté en el trabajo', () => {
    expect(resolveWorkCapabilities([], 'u9', true).canCreateTasks).toBe(true)
  })

  it('un colaborador sin plan, no: el plan ajeno no se amplía desde fuera', () => {
    const colaborador = resolveWorkCapabilities([m('u3', COLLABORATOR)], 'u3', false)
    expect(colaborador.canCreateTasks).toBe(false)
  })

  it('sin sesión, nada', () => {
    expect(resolveWorkCapabilities([m('u2', STUDENT)], null, false).canCreateTasks).toBe(false)
  })
})
