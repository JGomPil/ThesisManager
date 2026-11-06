# Thesis Manager

Plataforma web para la gestión y supervisión de trabajos académicos del
**Grupo de Ingeniería Biomédica de la Universidad de Valladolid (GIB-UVa)**.

Gestiona TFG, TFM, tesis doctorales, **Academia de Alumnos Internos** y cualquier otro tipo de
trabajo que el grupo necesite: los tipos son un **catálogo configurable**, no una lista fija en el
código.

> **Estado: Fase 1 en curso.** Fase 0 aprobada el 5 de noviembre de 2026.
>
> - Aplicación publicada en **https://jgompil.github.io/ThesisManager/**
> - Pendiente de conectar con un proyecto de Supabase: hasta entonces la web muestra una
>   pantalla que indica qué variables faltan.
> - Progreso detallado en [`ROADMAP.md`](ROADMAP.md); decisiones técnicas en
>   [`docs/FASE_0.md`](docs/FASE_0.md).

## Arquitectura

| Capa | Tecnología | Coste |
|---|---|--:|
Frontend | React + TypeScript + Vite + Tailwind + shadcn/ui, en **GitHub Pages** | 0 € |
Backend y datos | **Supabase Free**: PostgreSQL, Auth, REST, Row Level Security | 0 € |
Automatización | **GitHub Actions**: despliegue y mantenimiento periódico | 0 € |

Sin servidor propio, sin SSR, sin servicios de pago. Toda la autorización vive en PostgreSQL
mediante RLS: el frontend es código público y no protege nada por sí mismo.

## Ideas rectoras

- **Una persona, una cuenta.** Los roles no son excluyentes: el mismo investigador puede dirigir
  un TFG, codirigir un TFM y ser doctorando de su propia tesis. Los permisos se definen **por
  trabajo**, en `work_members`, nunca con un rol global.
- **Los tipos de trabajo son datos, no código.** Añadir «Prácticas de empresa» o «Estancia de
  investigación» es una fila nueva desde la interfaz de administración, con sus propias reglas
  (duración, defensa, depósito, plantilla de tareas).
- **RLS es la única frontera de seguridad.** Ocultar un botón es usabilidad, no protección.
- **Honestidad sobre los límites.** Lo que el plan gratuito no garantiza está escrito, no
  escondido: [`FREE_TIER.md`](FREE_TIER.md).

## Documentación

| Documento | Contenido |
|---|---|
[`docs/PUESTA_EN_MARCHA.md`](docs/PUESTA_EN_MARCHA.md) | **Instalación paso a paso**: Supabase, migraciones, primer usuario |
[`docs/FASE_0.md`](docs/FASE_0.md) | Propuesta técnica, decisiones y riesgos |
[`ARCHITECTURE.md`](ARCHITECTURE.md) | Estructura del proyecto y decisiones técnicas |
[`DATABASE.md`](DATABASE.md) | Modelo de datos, catálogos y estimación de volumen |
[`SECURITY.md`](SECURITY.md) | Roles, permisos, RLS, RGPD y pruebas obligatorias |
[`DEPLOYMENT.md`](DEPLOYMENT.md) | Despliegue en GitHub Pages y configuración de Supabase |
[`FREE_TIER.md`](FREE_TIER.md) | Límites, condiciones, riesgos y costes reales |
[`BACKUP.md`](BACKUP.md) | Copias de seguridad, restauración y exportación |
[`ROADMAP.md`](ROADMAP.md) | Fases y criterios de aceptación |
[`supabase/tests/README.md`](supabase/tests/README.md) | Pruebas de seguridad del modelo de datos |

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # rellenar con los datos del proyecto de Supabase
npm run dev
```

Comprobaciones disponibles:

```bash
npm run typecheck        # tipos de todo el proyecto
npm run lint
npm test                 # pruebas unitarias del dominio (permisos, progreso, estados)
npm run test:rls         # pruebas de seguridad en PostgreSQL desechable (requiere Docker)
npm run check:secrets    # verifica que dist/ no publica credenciales privilegiadas
```

Base de datos: aplicar `supabase/migrations/0001…0012` y después
`supabase/seed/0001_catalogs.sql`. Detalle en [`DEPLOYMENT.md`](DEPLOYMENT.md) §5.

Pruebas de seguridad del modelo de datos, sin necesidad de proyecto en Supabase (requiere Docker):

```bash
./scripts/test-rls.sh          # 24 comprobaciones de RLS, catálogos y keepalive
```

## Aviso sobre datos

Este repositorio es **público** (requisito de GitHub Pages gratuito). **No debe contener nunca
datos personales ni académicos reales**: ni en *seeds*, ni en capturas, ni en *issues*, ni en
artefactos de Actions. Los datos de demostración son completamente ficticios.
