import { describe, expect, it } from 'vitest'
import { resolveWorkCapabilities, type MemberLike } from '../work-capabilities'

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
