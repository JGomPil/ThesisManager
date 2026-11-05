import { Settings2 } from 'lucide-react'

/**
 * Pantalla que se muestra cuando faltan las variables de entorno de Supabase.
 * Aparece, por ejemplo, en el primer despliegue en GitHub Pages: el sitio ya
 * está publicado pero los secretos del repositorio todavía no existen.
 */
export function ConfigurationScreen() {
  const isProduction = import.meta.env.PROD

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-xl space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <Settings2 className="size-5" />
          </span>
          <div>
            <h1 className="font-semibold">Falta la configuración de Supabase</h1>
            <p className="text-sm text-muted-foreground">
              La aplicación está desplegada, pero todavía no sabe a qué base de datos conectarse.
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Variables necesarias</p>
          <ul className="space-y-1 font-mono text-xs">
            <li>
              VITE_SUPABASE_URL{' '}
              {import.meta.env.VITE_SUPABASE_URL ? (
                <span className="font-sans text-emerald-600">definida</span>
              ) : (
                <span className="font-sans text-destructive">ausente</span>
              )}
            </li>
            <li>
              VITE_SUPABASE_ANON_KEY{' '}
              {import.meta.env.VITE_SUPABASE_ANON_KEY ? (
                <span className="font-sans text-emerald-600">definida</span>
              ) : (
                <span className="font-sans text-destructive">ausente</span>
              )}
            </li>
          </ul>
        </div>

        {isProduction ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Crea el proyecto en Supabase, en <strong>región de la Unión Europea</strong>.</li>
            <li>
              En el repositorio: <em>Settings → Secrets and variables → Actions</em>, añade{' '}
              <code>SUPABASE_URL</code> y <code>SUPABASE_ANON_KEY</code>.
            </li>
            <li>Vuelve a lanzar el workflow <em>Deploy to GitHub Pages</em>.</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Copia <code>.env.example</code> a <code>.env.local</code>.</li>
            <li>Rellena la URL del proyecto y la clave anon/publishable.</li>
            <li>Reinicia <code>npm run dev</code>.</li>
          </ol>
        )}

        <p className="border-t pt-3 text-xs text-muted-foreground">
          La clave que hace falta es la <strong>anon / publishable</strong>, que es pública por
          diseño. La clave <code>service_role</code> no se usa en ningún punto de este proyecto y no
          debe copiarse aquí: saltaría todas las políticas de seguridad.
          Detalle en <code>DEPLOYMENT.md</code> §6.
        </p>
      </div>
    </div>
  )
}
