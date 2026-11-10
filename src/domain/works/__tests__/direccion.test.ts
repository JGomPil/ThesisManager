import { describe, expect, it } from 'vitest'
import { avisoDeDireccion, cuentaDireccion, type MiembroDireccion } from '@/domain/works/direccion'

const dir = (user_id: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'): MiembroDireccion =>
  ({ user_id, status, role: { is_supervisory: true } })
const alumno = (user_id: string): MiembroDireccion =>
  ({ user_id, status: 'ACTIVE', role: { is_supervisory: false } })

describe('cuántas personas dirigen un trabajo', () => {
  it('cuenta solo las funciones de supervisión', () => {
    expect(cuentaDireccion([dir('a'), alumno('b'), dir('c')])).toBe(2)
  })

  it('no cuenta a quien ya no participa', () => {
    expect(cuentaDireccion([dir('a'), dir('b', 'INACTIVE')])).toBe(1)
  })

  it('CUENTA PERSONAS, NO FILAS: dos funciones de la misma persona son una', () => {
    // Caso real: alguien figura como director y además en el comité. Son dos
    // filas de `work_members` del mismo usuario; si se contaran por separado,
    // el aviso saltaría él solo en trabajos perfectamente normales.
    expect(cuentaDireccion([dir('a'), dir('a'), dir('b')])).toBe(2)
  })

  it('una fila sin función no cuenta ni rompe', () => {
    expect(cuentaDireccion([{ user_id: 'a', status: 'ACTIVE', role: null }])).toBe(0)
  })
})

describe('el aviso de dirección', () => {
  it('sin número en el catálogo no avisa de nada', () => {
    // Es el caso por omisión: la columna es nullable y casi ningún tipo la usa.
    expect(avisoDeDireccion([dir('a'), dir('b'), dir('c')], null, 'TFG', true)).toBeNull()
  })

  it('no avisa mientras se cabe en el número', () => {
    expect(avisoDeDireccion([dir('a')], 2, 'TFG', true)).toBeNull()
  })

  it('el que hace justo el número tampoco avisa', () => {
    // El límite es «hasta N», no «menos de N»: con 1 dentro y máximo 2, la
    // segunda persona es normal y avisar ahí sería ruido.
    expect(avisoDeDireccion([dir('a')], 2, 'TFG', true)).toBeNull()
    expect(avisoDeDireccion([dir('a'), dir('b')], 2, 'TFG', false)).toBeNull()
  })

  it('avisa al añadir la que sobra, y deja claro que se puede seguir', () => {
    const aviso = avisoDeDireccion([dir('a'), dir('b')], 2, 'TFG', true)
    expect(aviso).toContain('serían 3')
    expect(aviso).toContain('igualmente')
  })

  it('avisa también cuando ya se estaba pasado de antes', () => {
    // Datos viejos, o alguien que bajó el número del catálogo después. El aviso
    // es distinto porque la situación es distinta: no estás a punto de nada.
    const aviso = avisoDeDireccion([dir('a'), dir('b'), dir('c')], 2, 'TFG', false)
    expect(aviso).toContain('3 personas')
    expect(aviso).not.toContain('igualmente')
  })

  it('dice «1 persona» y no «1 personas»', () => {
    expect(avisoDeDireccion([dir('a')], 1, 'TFG', true)).toContain('1 persona en la dirección')
  })

  it('se apaña sin el nombre del tipo', () => {
    const aviso = avisoDeDireccion([dir('a'), dir('b')], 1, null, false)
    expect(aviso).toContain('Este trabajo tiene 2 personas')
    expect(aviso).not.toContain('«»')
  })

  it('un cero o un negativo en el catálogo se ignoran en vez de avisar siempre', () => {
    // Un 0 significaría «ninguna dirección», que no es una regla que nadie
    // quiera: avisaría en todos los trabajos del mundo.
    expect(avisoDeDireccion([dir('a')], 0, 'TFG', true)).toBeNull()
    expect(avisoDeDireccion([dir('a')], -1, 'TFG', true)).toBeNull()
  })
})
