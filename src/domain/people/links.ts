/**
 * Las direcciones que una persona pega en su perfil.
 *
 * POR QUÉ HACE FALTA NORMALIZAR
 * LinkedIn enseña la dirección de un perfil sin el esquema
 * —`www.linkedin.com/in/alguien`—, y es lo que se copia de la barra del
 * navegador o de la propia página. El formulario la rechazaba por «le falta
 * https://», que es verdad y no le importa a nadie: se da por supuesto. Un
 * campo que exige a mano lo que puede poner solo es un campo que dice no por
 * un detalle de sintaxis.
 *
 * Y no se puede guardar sin el esquema: un `href` que empieza por
 * `www.linkedin.com` es una dirección RELATIVA, así que el enlace de la ficha
 * llevaría a `…/ThesisManager/www.linkedin.com/in/alguien`, que no existe. No
 * da error: lleva a una página en blanco del propio sitio.
 */

/**
 * Deja la dirección lista para guardar, o `null` si está vacía.
 *
 * Añade `https://` si falta y asciende `http://` a `https://`. No inventa el
 * resto: si lo pegado no lleva el dominio, esto no lo arregla y la validación
 * del formulario lo rechaza, que es lo correcto —fabricar la dirección a partir
 * de un nombre de usuario es apostar a que LinkedIn no cambie nunca la forma de
 * sus URLs—.
 */
export function normalizaUrl(valor: string | null | undefined): string | null {
  const limpio = (valor ?? '').trim()
  if (limpio === '') return null
  if (/^https:\/\//i.test(limpio)) return limpio
  if (/^http:\/\//i.test(limpio)) return `https://${limpio.slice('http://'.length)}`
  return `https://${limpio}`
}

/**
 * ¿Es una dirección de LinkedIn? Se mira DESPUÉS de normalizar.
 *
 * Se exige el dominio porque el enlace de la ficha se rotula «LinkedIn»: uno
 * que diga una cosa y lleve a otra, en la ficha que miran los demás, es peor
 * que no tenerlo. Se admiten los subdominios de país (`es.linkedin.com`), que
 * son los que reparte LinkedIn según desde dónde se copie el enlace.
 */
export function esUrlDeLinkedin(valor: string | null | undefined): boolean {
  const url = normalizaUrl(valor)
  if (url === null) return true // vacío es válido: el campo es opcional
  return /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i.test(url)
}
