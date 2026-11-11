/**
 * En que situacion esta ESTE aparato respecto a los avisos.
 *
 * POR QUE ES UNA FUNCION PURA Y NO UN PUNADO DE `if` EN LA TARJETA. Porque la
 * respuesta depende de cinco datos del navegador que se combinan de forma poco
 * intuitiva, y uno de ellos —iOS— invierte el significado de otro:
 *
 * EN IPHONE Y IPAD NO EXISTE `PushManager` HASTA QUE LA APLICACION ESTA
 * INSTALADA en la pantalla de inicio. O sea que la comprobacion normal de
 * «¿soporta avisos este navegador?» responde NO en el iPhone de cualquiera, y
 * si se creyera, la pantalla diria «tu navegador no puede recibir avisos»
 * cuando la verdad es «anade la aplicacion a la pantalla de inicio y podra».
 * Es el unico caso en que decir la verdad tecnica es dar una respuesta
 * equivocada, y por eso esa rama va PRIMERO.
 *
 * Y tampoco sirve mirar Chrome en el iPhone: por debajo es WebKit igual, asi
 * que el remedio es el mismo.
 */

export type EntornoDeAvisos = {
  /** El navegador tiene `Notification`, `serviceWorker` y `PushManager`. */
  soporta: boolean
  /** Lo que ha respondido la persona a la pregunta del navegador. */
  permiso: 'default' | 'granted' | 'denied'
  /** Hay suscripcion guardada para este aparato. */
  suscrito: boolean
  /** iPhone o iPad (incluido el iPad que se hace pasar por Mac). */
  esIOS: boolean
  /** Abierta como aplicacion instalada, no como pestana del navegador. */
  instalada: boolean
}

export type EstadoDeAvisos = {
  estado: 'instalar-primero' | 'no-soportado' | 'bloqueado' | 'apagado' | 'encendido'
  titulo: string
  explicacion: string
  /** Que boton tiene sentido ofrecer, o `null` si ninguno sirve de nada. */
  accion: 'encender' | 'apagar' | null
}

export function estadoDeAvisos(e: EntornoDeAvisos): EstadoDeAvisos {
  // Primero el iPhone, por lo dicho arriba: aqui `soporta` dice NO y no es que
  // no pueda, es que todavia no.
  if (e.esIOS && !e.instalada) {
    return {
      estado: 'instalar-primero',
      titulo: 'Instala antes la aplicacion',
      explicacion:
        'En iPhone y iPad los avisos solo llegan si la aplicacion esta en la pantalla de inicio. '
        + 'Abre el menu de compartir y pulsa «Anadir a pantalla de inicio»; despues vuelve aqui.',
      accion: null,
    }
  }

  if (!e.soporta) {
    return {
      estado: 'no-soportado',
      titulo: 'Este navegador no puede recibir avisos',
      explicacion:
        'Prueba con Chrome, Edge o Firefox actualizados. Los avisos seguiran en la campana de '
        + 'arriba, que funciona en cualquier navegador.',
      accion: null,
    }
  }

  // «Denegado» no se puede arreglar desde aqui: el navegador no vuelve a
  // preguntar, y un boton que no puede funcionar es peor que no tener boton.
  if (e.permiso === 'denied') {
    return {
      estado: 'bloqueado',
      titulo: 'Los avisos estan bloqueados en este navegador',
      explicacion:
        'Se dijo que no en su momento y el navegador ya no vuelve a preguntar. Se cambia en el '
        + 'candado de la barra de direcciones, en los permisos de este sitio.',
      accion: null,
    }
  }

  if (e.suscrito) {
    return {
      estado: 'encendido',
      titulo: 'Este dispositivo recibe avisos',
      explicacion: 'Puedes dejar de recibirlos aqui mismo, sin tocar los demas aparatos.',
      accion: 'apagar',
    }
  }

  return {
    estado: 'apagado',
    titulo: 'Este dispositivo no recibe avisos',
    explicacion:
      'Los avisos que ya te salen en la campana sonaran tambien aqui. Cada aparato se activa por '
      + 'separado.',
    accion: 'encender',
  }
}

/**
 * ¿Tiene sentido INVITAR a encenderlos, o solo ofrecer los ajustes?
 *
 * Lo usa el pie de la campana. «Que me avise también aquí» es una invitación, y
 * en un aparato que ya recibe avisos no invita a nada: deja pensando que la
 * aplicación no se ha enterado de que ya se dijo que sí. Solo se invita cuando
 * hay algo que encender; con los avisos bloqueados en el navegador tampoco, por
 * mucho que estén apagados, porque desde la aplicación no se puede hacer nada.
 */
export function invitaAEncender(e: EstadoDeAvisos): boolean {
  return e.estado === 'apagado' || e.estado === 'instalar-primero'
}
