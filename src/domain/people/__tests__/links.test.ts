import { describe, expect, it } from 'vitest'
import { esUrlDeLinkedin, normalizaUrl } from '@/domain/people/links'

describe('normalizaUrl', () => {
  it('añade el https:// que nadie escribe', () => {
    expect(normalizaUrl('www.linkedin.com/in/alguien')).toBe('https://www.linkedin.com/in/alguien')
    expect(normalizaUrl('linkedin.com/in/alguien')).toBe('https://linkedin.com/in/alguien')
  })

  it('no lo duplica si ya está, ni cambia nada más', () => {
    expect(normalizaUrl('https://es.linkedin.com/in/alguien/')).toBe('https://es.linkedin.com/in/alguien/')
    expect(normalizaUrl('HTTPS://www.linkedin.com/in/Alguien')).toBe('HTTPS://www.linkedin.com/in/Alguien')
  })

  it('asciende http a https: el enlace va a un sitio que solo sirve https', () => {
    expect(normalizaUrl('http://www.linkedin.com/in/alguien')).toBe('https://www.linkedin.com/in/alguien')
  })

  it('vacío, espacios o nada es null, que es «no tengo»', () => {
    expect(normalizaUrl('')).toBeNull()
    expect(normalizaUrl('   ')).toBeNull()
    expect(normalizaUrl(null)).toBeNull()
    expect(normalizaUrl(undefined)).toBeNull()
  })

  it('recorta los espacios de pegar desde otra pantalla', () => {
    expect(normalizaUrl('  www.linkedin.com/in/alguien  ')).toBe('https://www.linkedin.com/in/alguien')
  })
})

describe('esUrlDeLinkedin', () => {
  it('acepta lo que se pega de verdad, con esquema o sin él', () => {
    expect(esUrlDeLinkedin('www.linkedin.com/in/alguien')).toBe(true)
    expect(esUrlDeLinkedin('https://es.linkedin.com/in/alguien/')).toBe(true)
    expect(esUrlDeLinkedin('linkedin.com/company/gib-uva')).toBe(true)
  })

  it('el campo vacío es válido: es opcional', () => {
    expect(esUrlDeLinkedin('')).toBe(true)
  })

  it('rechaza otro sitio, y el dominio a secas sin perfil', () => {
    expect(esUrlDeLinkedin('https://twitter.com/alguien')).toBe(false)
    expect(esUrlDeLinkedin('www.linkedin.com')).toBe(false)
    // Un nombre de usuario suelto no se completa a mano: fabricar la dirección
    // es apostar a que LinkedIn no cambie nunca la forma de sus URLs.
    expect(esUrlDeLinkedin('javier-gomez-pilar')).toBe(false)
  })

  it('no se cuela un dominio que solo CONTIENE linkedin.com', () => {
    expect(esUrlDeLinkedin('https://linkedin.com.phishing.example/in/alguien')).toBe(false)
  })
})
