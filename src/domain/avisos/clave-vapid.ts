/**
 * La clave publica VAPID, de texto a bytes.
 *
 * `pushManager.subscribe` exige la clave en `Uint8Array`, y lo que se publica
 * (y lo que devuelve `web-push`) es base64 **URL-safe y sin relleno**: `-` en
 * vez de `+`, `_` en vez de `/`, y sin los `=` del final. `atob` no entiende
 * ninguna de las tres cosas.
 *
 * ESTO ESTA AQUI, PROBADO Y APARTE, porque cuando se hace mal el sintoma es
 * absurdo: el navegador responde `InvalidCharacterError` o, peor,
 * `InvalidStateError: Subscription failed` sin decir por que, y se pierde la
 * tarde buscando el fallo en el servidor o en el service worker, que estan bien.
 */
/**
 * El tipo de vuelta lleva `<ArrayBuffer>` a proposito. Desde TypeScript 5.7
 * `Uint8Array` es generico y `new Uint8Array(n)` se infiere como
 * `Uint8Array<ArrayBufferLike>`, que incluye `SharedArrayBuffer` y por tanto no
 * encaja en el `BufferSource` que pide `pushManager.subscribe`. Se construye el
 * `ArrayBuffer` a mano para que el tipo sea el estrecho.
 */
export function claveVapidABytes(clave: string): Uint8Array<ArrayBuffer> {
  const limpia = clave.trim()
  if (limpia === '') throw new Error('No hay clave publica de avisos configurada')

  // El relleno que base64url quita hay que devolverlo: la longitud tiene que
  // ser multiplo de 4.
  const relleno = '='.repeat((4 - (limpia.length % 4)) % 4)
  const base64 = (limpia + relleno).replace(/-/g, '+').replace(/_/g, '/')

  const crudo = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(crudo.length))
  for (let i = 0; i < crudo.length; i += 1) bytes[i] = crudo.charCodeAt(i)
  return bytes
}
