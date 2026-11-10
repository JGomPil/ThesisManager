/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_BASE_PATH?: string
  /**
   * Clave PUBLICA de los avisos (VAPID, migracion 0032). Es publica por
   * diseno y acaba en el bundle: con ella el navegador acepta mensajes
   * firmados por nosotros, no sirve para firmarlos. La privada vive en los
   * secretos de GitHub. Si falta, la pantalla de avisos lo dice en vez de
   * fallar al pulsar.
   */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
