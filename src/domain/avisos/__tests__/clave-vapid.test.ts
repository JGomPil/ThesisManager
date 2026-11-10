import { describe, expect, it } from 'vitest'
import { claveVapidABytes } from '@/domain/avisos/clave-vapid'

describe('la clave publica VAPID, de texto a bytes', () => {
  it('traduce base64 normal', () => {
    // 'Hola' -> SG9sYQ==
    expect(Array.from(claveVapidABytes('SG9sYQ=='))).toEqual([72, 111, 108, 97])
  })

  it('LE DEVUELVE EL RELLENO que base64url quita', () => {
    // El mismo valor sin los '=' del final, que es como se publica la clave.
    expect(Array.from(claveVapidABytes('SG9sYQ'))).toEqual([72, 111, 108, 97])
  })

  it('traduce los dos caracteres que base64url cambia', () => {
    // 0xFB 0xFF -> '+/8=' en base64 normal, '-_8' en base64url.
    expect(Array.from(claveVapidABytes('-_8'))).toEqual([251, 255])
    expect(Array.from(claveVapidABytes('+/8='))).toEqual([251, 255])
  })

  it('tolera espacios alrededor, que es como llega de un copiar y pegar', () => {
    expect(Array.from(claveVapidABytes('  SG9sYQ  '))).toEqual([72, 111, 108, 97])
  })

  it('una clave vacia se dice, no se intenta', () => {
    // Sin esto, el navegador contesta «Subscription failed» sin motivo y el
    // fallo parece del servidor.
    expect(() => claveVapidABytes('')).toThrow(/clave publica/)
    expect(() => claveVapidABytes('   ')).toThrow(/clave publica/)
  })
})
