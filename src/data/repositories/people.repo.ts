import { supabase } from '@/lib/supabase'
import { AVATARS_BUCKET, esUrlExterna, reducirImagen } from '@/lib/avatars'
import type { OrganizationMemberRow, ProfileRow } from '@/data/types/database'

export type PendingAccount = {
  id: string
  full_name: string
  email: string
  created_at: string
}

/** Lo que devuelve la búsqueda por correo: lo justo para poder elegir a alguien. */
export type PersonFound = {
  id: string
  full_name: string
  email: string
  department: string | null
}

export type Membership = OrganizationMemberRow & {
  organization: { id: string; name: string; slug: string } | null
}

export type OrgRole = OrganizationMemberRow['role']

/** Lo justo para saber quién administra el grupo. */
export type OrgMemberBrief = {
  user_id: string
  role: OrgRole
  is_active: boolean
}

export const peopleRepo = {
  /** Perfil del usuario autenticado. RLS garantiza que solo pueda ser el suyo. */
  me: async (userId: string): Promise<ProfileRow | null> => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) throw error
    return data
  },

  updateMe: async (userId: string, patch: Partial<ProfileRow>): Promise<ProfileRow> => {
    const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single()
    if (error) throw error
    return data
  },

  /**
   * Una persona por su identificador, para su ficha.
   *
   * No lleva ningún filtro de autorización, y es correcto: `profiles_select`
   * (0016/0017) ya devuelve 0 filas si quien pregunta no tiene relación con
   * ella. Se usa `maybeSingle` precisamente por eso: «no visible» y «no existe»
   * deben ser el MISMO resultado, porque distinguirlos confirmaría que esa
   * persona existe a quien no puede verla.
   */
  byId: async (id: string): Promise<ProfileRow | null> => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data
  },

  /**
   * Pertenencias administrativas del usuario. Son INDEPENDIENTES de las
   * relaciones académicas: ser administrador no convierte a nadie en director.
   */
  myMemberships: async (userId: string): Promise<Membership[]> => {
    const { data, error } = await supabase
      .from('organization_members')
      .select('*, organization:organizations(id,name,slug)')
      .eq('user_id', userId)
      .eq('is_active', true)
    if (error) throw error
    return (data ?? []) as unknown as Membership[]
  },

  /**
   * Cuentas creadas a mano que todavía no pertenecen a ninguna organización.
   *
   * NO sale de `profiles`: `profiles_select` no deja ver a quien no comparte
   * organización, y eso es deliberado. Sale de `public.pending_accounts()`, que
   * comprueba por dentro que quien pregunta administra algo y devuelve solo las
   * cuentas sin pertenencia. Ver la cabecera de la migración 0013.
   */
  pendingAccounts: async (): Promise<PendingAccount[]> => {
    const { data, error } = await supabase.rpc('pending_accounts')
    if (error) throw error
    return data ?? []
  },

  /**
   * Autoriza una cuenta: la mete en la organización.
   *
   * No necesitó ninguna política nueva —`org_members_write` ya permitía a la
   * administración escribir filas de su organización—; lo que faltaba era
   * poder VER a quién autorizar.
   */
  authorize: async (
    organizationId: string, userId: string, role: OrganizationMemberRow['role'],
  ): Promise<void> => {
    const { error } = await supabase
      .from('organization_members')
      .insert({ organization_id: organizationId, user_id: userId, role })
    if (error) throw error
  },

  /**
   * Quién pertenece al grupo y con qué papel ADMINISTRATIVO.
   *
   * No es una relación académica: administrar el grupo y dirigir un trabajo son
   * los dos ejes independientes de SECURITY.md §2. Esto es el primero.
   *
   * Lo puede leer cualquier miembro, no solo la administración: `org_members_
   * select` deja ver las filas de la propia organización. Es deliberado —saber
   * a quién hay que pedir un alta es parte de poder usar la aplicación—, y en
   * la pantalla se traduce en una insignia junto al nombre.
   */
  orgMembers: async (organizationId: string): Promise<OrgMemberBrief[]> => {
    const { data, error } = await supabase
      .from('organization_members')
      .select('user_id, role, is_active')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
    if (error) throw error
    return (data ?? []) as OrgMemberBrief[]
  },

  /**
   * Cambia el papel administrativo de alguien que YA pertenece al grupo.
   *
   * DOS COSAS QUE NO DECIDE ESTA FUNCIÓN, y conviene saber dónde están:
   *
   *  a) Quién puede llamarla. La política `org_members_write` exige ser
   *     administrador de esa organización. Si no lo eres, el UPDATE no afecta a
   *     ninguna fila —y no da error, que es la trampa de siempre—, así que aquí
   *     se pide la fila de vuelta y se dice con palabras cuando no viene.
   *
   *  b) Que el grupo no se quede sin administradores. Eso lo impone el
   *     disparador `org_members_last_admin` de la migración 0023, no la
   *     pantalla: un formulario que no ofrece la opción no protege de nada,
   *     porque cualquiera con sesión puede hablar con PostgREST. La pantalla
   *     además lo avisa antes, que es otra cosa: educar, no proteger.
   */
  setOrgRole: async (organizationId: string, userId: string, role: OrgRole): Promise<void> => {
    const { data, error } = await supabase
      .from('organization_members')
      .update({ role })
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('user_id')
      .maybeSingle()
    if (error) throw error
    if (data === null) {
      throw new Error(
        'No se ha podido cambiar el papel: o esa persona ya no pertenece al grupo, o tu cuenta no ' +
          'lo administra. Si deberías poder, lo más probable es que falte aplicar alguna migración.',
      )
    }
  },

  /**
   * Directorio de personas visibles.
   *
   * «Visibles» ya no quiere decir «de mi organización» (migración 0016): son
   * las personas que participan en algún trabajo que yo puedo ver, más mi
   * propio perfil, más —si administro— los miembros de mi organización. Un
   * estudiante ve a su dirección y a sus compañeros de trabajo, y a nadie más.
   *
   * No hay NINGÚN filtro aquí que haga eso: lo hace `profiles_select`. Esta
   * función pide `*` de `profiles` y recibe lo que RLS le deja recibir, que es
   * la única forma de que el límite no dependa de que la pantalla acierte.
   */
  directory: async (): Promise<ProfileRow[]> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .order('full_name')
    if (error) throw error
    return data ?? []
  },

  /**
   * Sube la foto de perfil y deja la RUTA en `profiles.avatar_url`.
   *
   * Tres cosas que no son evidentes:
   *
   *  a) La ruta es `<user_id>/<timestamp>.webp`. El primer segmento es la llave
   *     de autorización de las políticas del cubo (migración 0017): cambiarlo
   *     sin cambiar las políticas abriría el cubo.
   *  b) El nombre lleva marca de tiempo para que cambiar de foto NO sobrescriba
   *     la anterior en la misma ruta. Si se sobrescribiera, las URL firmadas que
   *     ya estén en pantalla seguirían sirviendo la vieja desde la caché del
   *     navegador y el usuario creería que no se ha guardado.
   *  c) Se borra la anterior DESPUÉS de guardar la nueva, y si ese borrado falla
   *     no se deshace nada: quedaría un fichero huérfano de 20 kB, que es
   *     muchísimo menos grave que quedarse sin foto por un error de limpieza.
   */
  uploadAvatar: async (userId: string, file: File): Promise<string> => {
    const reducida = await reducirImagen(file)
    const ruta = `${userId}/${Date.now()}.webp`

    const { error: errSubida } = await supabase.storage
      .from(AVATARS_BUCKET)
      .upload(ruta, reducida, { contentType: 'image/webp', upsert: false, cacheControl: '3600' })
    if (errSubida) throw errSubida

    const anterior = (await peopleRepo.me(userId))?.avatar_url ?? null

    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: ruta })
      .eq('id', userId)
    if (error) throw error

    if (anterior && !esUrlExterna(anterior) && anterior !== ruta) {
      await supabase.storage.from(AVATARS_BUCKET).remove([anterior])
    }
    return ruta
  },

  /** Quita la foto: primero la referencia, después el fichero. */
  removeAvatar: async (userId: string, rutaActual: string | null): Promise<void> => {
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: null })
      .eq('id', userId)
    if (error) throw error

    if (rutaActual && !esUrlExterna(rutaActual)) {
      await supabase.storage.from(AVATARS_BUCKET).remove([rutaActual])
    }
  },

  /**
   * Localiza a UNA persona por su correo exacto.
   *
   * Existe porque el directorio ya no es el grupo entero: para añadir a un
   * codirector con el que nunca se ha coincidido hay que poder encontrarlo.
   *
   * `public.find_person_by_email` (0016) exige correo exacto —no acepta
   * comodines ni cadenas vacías— y solo contesta a quien puede añadir
   * participantes en algún trabajo. A quien no, le devuelve vacío: la lista
   * entera no se puede reconstruir dirección a dirección sin conocerlas.
   *
   * Devuelve `null` cuando no hay nadie, que es información que el usuario
   * necesita («esa persona todavía no tiene cuenta, invítala») y no un error.
   */
  findByEmail: async (email: string): Promise<PersonFound | null> => {
    const { data, error } = await supabase.rpc('find_person_by_email', { p_email: email })
    if (error) throw error
    return (data ?? [])[0] ?? null
  },
}
