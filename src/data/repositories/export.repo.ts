import { supabase } from '@/lib/supabase'

/**
 * Copia de los datos académicos desde la propia aplicación.
 *
 * QUÉ ES Y QUÉ NO ES. No sustituye al volcado de `BACKUP.md`: ese incluye el
 * esquema, los usuarios de autenticación y todo lo demás, y es el que permite
 * levantar la plataforma entera en otro proyecto. Esto es la red de seguridad
 * de en medio: un fichero que cualquiera con permisos de administración puede
 * descargar en diez segundos, sin la CLI de Supabase y sin la contraseña de la
 * base de datos. Entre dos volcados trimestrales, es la diferencia entre
 * perder un trimestre de seguimiento y perder nada.
 *
 * LO QUE DELIBERADAMENTE NO SE LLEVA
 *  · `meeting_private_notes`. Es la tabla más sensible del sistema y este
 *    fichero acaba en un portátil. La política ya se las niega a quien no
 *    corresponde, pero aquí se le niegan TAMBIÉN a quien sí puede leerlas, por
 *    la misma razón que el informe imprimible no las lleva: cambiar de soporte
 *    cambia quién acaba leyéndolo. El volcado completo sí las incluye, y ese se
 *    guarda en la unidad institucional.
 *  · `notifications` y `activity_logs`: ruido para reconstruir nada, y el
 *    segundo se purga a los 24 meses por diseño.
 *  · Los ficheros de Storage. Son enlaces y documentos que, por diseño, viven
 *    en la nube institucional (`FREE_TIER.md` §5.6).
 *
 * CADA TABLA SE PIDE CON `count: 'exact'` y un techo. Si el techo recorta, el
 * fichero lo dice en `_meta.incompletas` y la pantalla avisa: una copia a la
 * que le falta la mitad sin avisar es peor que no tener copia, porque se
 * descubre el día que hay que usarla.
 */

const TABLAS = [
  'organizations', 'organization_members', 'profiles',
  'work_types', 'work_statuses', 'work_type_statuses', 'work_roles',
  'academic_levels', 'academic_years', 'programs', 'research_lines', 'document_types',
  'research_groups', 'research_group_members',
  'academic_works', 'work_members', 'work_phases',
  'tasks', 'task_dependencies', 'milestones',
  'documents', 'document_versions', 'document_comments',
  'meetings', 'meeting_participants', 'meeting_agreements',
  'comments',
  'templates', 'template_tasks', 'template_files',
  'invitations',
] as const

const TECHO = 10000

export type ExportResult = {
  json: string
  totalFilas: number
  incompletas: string[]
  fallidas: { tabla: string; motivo: string }[]
}

export const exportRepo = {
  /**
   * Devuelve el JSON ya serializado, además del resumen que la pantalla
   * necesita para poder decir la verdad sobre lo que se ha descargado.
   *
   * Las tablas se piden una a una y en serie a propósito: son treinta y una
   * peticiones de una acción manual, y hacerlas en paralelo solo serviría para
   * acercarse a los límites de un plan gratuito por ahorrar dos segundos en
   * algo que se hace una vez al trimestre.
   */
  everything: async (quien: string | null): Promise<ExportResult> => {
    const datos: Record<string, unknown[]> = {}
    const recuentos: Record<string, number> = {}
    const incompletas: string[] = []
    const fallidas: { tabla: string; motivo: string }[] = []
    let totalFilas = 0

    for (const tabla of TABLAS) {
      const { data, error, count } = await supabase
        .from(tabla)
        .select('*', { count: 'exact' })
        .limit(TECHO)
      if (error) {
        // Una tabla que falla no debe tirar la copia entera: se anota y se
        // sigue. Mejor una copia con una laguna señalada que ninguna copia.
        fallidas.push({ tabla, motivo: error.message })
        continue
      }
      const filas = data ?? []
      datos[tabla] = filas
      recuentos[tabla] = filas.length
      totalFilas += filas.length
      if (count !== null && count > filas.length) incompletas.push(tabla)
    }

    const contenido = {
      _meta: {
        aplicacion: 'Thesis Manager · GIB-UVa',
        generado: new Date().toISOString(),
        generado_por: quien ?? 'desconocido',
        filas_por_tabla: recuentos,
        total_filas: totalFilas,
        incompletas,
        fallidas,
        alcance:
          'Solo lo que la base de datos permite leer a esta cuenta (RLS). Un administrador '
          + 'del grupo obtiene los datos del grupo; cualquier otra persona, los de sus trabajos.',
        no_incluye: [
          'meeting_private_notes (deliberado: es la tabla mas sensible y este fichero sale de la plataforma)',
          'notifications y activity_logs',
          'los ficheros de Storage y el esquema de la base de datos',
          'los usuarios de autenticacion (auth.users)',
        ],
        aviso_rgpd:
          'Contiene datos personales (nombres y correos institucionales). Guardalo en la unidad '
          + 'institucional de la UVa o en un disco cifrado, nunca en un servicio personal, y '
          + 'borralo cuando deje de hacer falta.',
        copia_completa: 'Ver BACKUP.md: supabase db dump + scripts/restore-drill.sh para comprobarla.',
      },
      datos,
    }

    return { json: JSON.stringify(contenido, null, 2), totalFilas, incompletas, fallidas }
  },
}
