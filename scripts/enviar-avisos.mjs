/* =============================================================================
 * El cartero: lleva al movil y al ordenador lo que ya esta en la campana.
 *
 * Lo ejecuta `.github/workflows/avisos.yml` cada media hora. Hace cuatro cosas,
 * en este orden:
 *
 *   1. pide a la base que mire las fechas       (public.encolar_avisos)
 *   2. coge lo pendiente de las ultimas 72 h    (public.avisos_por_enviar)
 *   3. lo manda cifrado a cada dispositivo      (web-push, con VAPID)
 *   4. marca lo entregado y olvida los aparatos que ya no existen
 *
 * NO LLEVA LA CLAVE `service_role`, y es la decision de fondo de la 0032
 * (SECURITY.md §5.2.tertricies). Entra con la clave anon -la publica, la misma
 * que el keepalive- y un TOKEN que solo abre esas cuatro puertas. Si este
 * workflow se filtrara entero, lo peor que se podria hacer con el es leer el
 * texto de los avisos pendientes de las ultimas 72 horas.
 *
 * NO SE REGISTRA NI UN TITULO NI UN ENDPOINT. El repositorio es publico, y con
 * el los registros de Actions: todo lo que se imprime aqui son numeros. Un log
 * que dijera «Enviado: Revisa el capitulo de metodos» seria publicar el trabajo
 * del grupo en una pagina web.
 *
 * CUANDO SE MARCA UN AVISO COMO ENTREGADO: cuando TODOS los aparatos de esa
 * persona lo han recibido o han resultado estar muertos. Si a uno le falla el
 * servicio de push por un rato, el aviso se queda pendiente y se reintenta en
 * la pasada siguiente; el `tag` del aviso hace que al que ya lo recibio se le
 * sustituya el mismo aviso en vez de apilarsele otro igual.
 * ========================================================================== */
import webpush from 'web-push'

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  AVISOS_TOKEN,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT,
  AVISOS_LIMITE,
} = process.env

const faltan = Object.entries({
  SUPABASE_URL, SUPABASE_ANON_KEY, AVISOS_TOKEN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
}).filter(([, v]) => !v || String(v).trim() === '').map(([k]) => k)

if (faltan.length > 0) {
  console.error(`Faltan secretos: ${faltan.join(', ')}`)
  process.exit(1)
}

// `mailto:` es lo que exige el estandar VAPID para que el servicio de push
// sepa a quien escribir si algo va mal. No es un secreto.
webpush.setVapidDetails(
  VAPID_SUBJECT && VAPID_SUBJECT.trim() !== '' ? VAPID_SUBJECT : 'mailto:no-reply@uva.es',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
)

const base = SUPABASE_URL.replace(/\/+$/, '')

async function rpc(nombre, cuerpo) {
  const respuesta = await fetch(`${base}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  })

  if (!respuesta.ok) {
    // El cuerpo del error de PostgREST no lleva datos de nadie: es el mensaje
    // de la excepcion. Se imprime porque sin el no hay forma de distinguir un
    // token mal copiado de una migracion sin aplicar.
    const texto = await respuesta.text()
    throw new Error(`${nombre}: HTTP ${respuesta.status} ${texto.slice(0, 300)}`)
  }
  return respuesta.json()
}

/* -----------------------------------------------------------------------------
 * 1 y 2: que mire las fechas, y traer lo pendiente
 * -------------------------------------------------------------------------- */
const creados = await rpc('encolar_avisos', { p_token: AVISOS_TOKEN })
const limite = Number.parseInt(AVISOS_LIMITE ?? '200', 10)
const filas = await rpc('avisos_por_enviar', { p_token: AVISOS_TOKEN, p_limite: limite })

console.log(`Recordatorios de fecha creados: ${creados ?? 0}`)
console.log(`Envios por hacer (aviso x dispositivo): ${filas.length}`)

if (filas.length === 0) {
  console.log('Nada que repartir.')
  process.exit(0)
}

/* -----------------------------------------------------------------------------
 * 3: mandarlo
 *
 * Una fila es «este aviso, a este aparato». Se agrupa por aviso porque la marca
 * de entregado es del aviso, no del aparato.
 * -------------------------------------------------------------------------- */
const porAviso = new Map()
for (const f of filas) {
  if (!porAviso.has(f.aviso_id)) porAviso.set(f.aviso_id, [])
  porAviso.get(f.aviso_id).push(f)
}

const entregados = []        // avisos que se pueden marcar
const sellados = new Set()   // endpoints que han recibido algo
const muertos = new Set()    // endpoints que ya no existen
// Los fallos se cuentan POR MOTIVO, no en total. Un numero suelto no se puede
// depurar: el fallo clasico del primer dia es un 403, que significa que la
// clave VAPID del secreto no es la que uso el navegador al suscribirse, y se
// arregla en un minuto SI SE SABE. El motivo no lleva datos de nadie: es el
// codigo HTTP del servicio de push, o el mensaje de la libreria.
const motivos = new Map()

for (const [avisoId, destinos] of porAviso) {
  // El `tag` es el id del aviso: si este mismo aviso se reintenta, el
  // dispositivo sustituye el que ya tenia en vez de apilar otro igual.
  const carga = JSON.stringify({
    title: destinos[0].titulo,
    body: destinos[0].cuerpo ?? '',
    url: destinos[0].enlace ?? './',
    tag: avisoId,
  })

  let todosResueltos = true

  for (const d of destinos) {
    if (muertos.has(d.endpoint)) continue
    try {
      await webpush.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth_key } },
        carga,
        // 72 horas: lo mismo que la ventana de la base. Un aviso que el
        // servicio de push no ha podido entregar en tres dias ya no sirve.
        { TTL: 60 * 60 * 72, urgency: 'normal' },
      )
      sellados.add(d.endpoint)
    } catch (e) {
      const codigo = e?.statusCode ?? 0
      if (codigo === 404 || codigo === 410) {
        // Aplicacion desinstalada o permiso retirado: esa suscripcion esta
        // muerta para siempre. Si no se borrara, se reintentaria en cada
        // pasada hasta el fin de los tiempos.
        muertos.add(d.endpoint)
      } else {
        // Un fallo pasajero (429, 5xx, red). El aviso se queda pendiente y se
        // reintenta en la pasada siguiente, dentro de la ventana de 72 h.
        todosResueltos = false
        const motivo = codigo !== 0
          ? `HTTP ${codigo}${codigo === 403 ? ' (la clave VAPID no coincide con la suscripcion)' : ''}`
          : String(e?.message ?? 'desconocido').slice(0, 160)
        motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1)
      }
    }
  }

  if (todosResueltos) entregados.push(avisoId)
}

/* -----------------------------------------------------------------------------
 * 4: marcar y limpiar
 * -------------------------------------------------------------------------- */
for (const endpoint of muertos) {
  try {
    await rpc('suscripcion_muerta', { p_token: AVISOS_TOKEN, p_endpoint: endpoint })
  } catch (e) {
    console.error(`No se ha podido olvidar un dispositivo muerto: ${e.message}`)
  }
}

let marcados = 0
if (entregados.length > 0) {
  marcados = await rpc('avisos_entregados', {
    p_token: AVISOS_TOKEN,
    p_ids: entregados,
    p_endpoints: [...sellados],
  })
}

console.log(`Avisos entregados: ${marcados}`)
console.log(`Dispositivos olvidados por no existir: ${muertos.size}`)
const fallos = [...motivos.values()].reduce((a, b) => a + b, 0)
console.log(`Envios con fallo pasajero (se reintentan): ${fallos}`)
for (const [motivo, veces] of motivos) console.log(`  · ${motivo}: ${veces}`)

// Un fallo pasajero NO tumba el workflow: se reintenta solo en la pasada
// siguiente, y un rojo en Actions por algo que se arregla en media hora solo
// ensena a no mirar los rojos.
process.exit(0)
