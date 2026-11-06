import { z } from 'zod'

/** Esquema del formulario de trabajo. Compartido con la validación de dominio. */
export const workFormSchema = z
  .object({
    title: z.string().trim().min(5, 'El título debe tener al menos 5 caracteres').max(300),
    work_type_id: z.string().uuid('Elige un tipo de trabajo'),
    status_id: z.string().uuid('Elige un estado'),
    program_id: z.string().uuid().or(z.literal('')).optional(),
    academic_year_id: z.string().uuid().or(z.literal('')).optional(),
    research_line_id: z.string().uuid().or(z.literal('')).optional(),
    start_date: z.string().optional(),
    expected_end_date: z.string().optional(),
    description: z.string().max(5000).optional(),
    objectives: z.string().max(5000).optional(),
    methodology: z.string().max(5000).optional(),
    keywords: z.string().optional(),
    // Participantes iniciales. Solo se usan al CREAR: en la edición los
    // gestiona la tarjeta de participantes de la ficha, que admite funciones
    // múltiples por persona y permisos por trabajo. Aquí se cubre únicamente
    // el caso común de alta, para no tener que crear el trabajo y volver.
    supervisor_id: z.string().uuid().or(z.literal('')).optional(),
    student_id: z.string().uuid().or(z.literal('')).optional(),
    /** Plantilla de plan que se aplica justo después de crear el trabajo. */
    template_id: z.string().uuid().or(z.literal('')).optional(),
  })
  .refine(
    (v) => !v.start_date || !v.expected_end_date || v.expected_end_date >= v.start_date,
    { message: 'La fecha prevista de fin no puede ser anterior al inicio', path: ['expected_end_date'] },
  )

export type WorkFormValues = z.infer<typeof workFormSchema>

/** Esquema del catálogo de tipos de trabajo (pantalla de administración). */
export const workTypeFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(30)
    .regex(/^[A-Za-z0-9_]+$/, 'Solo letras, números y guion bajo')
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(3, 'Indica el nombre completo').max(120),
  short_name: z.string().trim().min(1, 'Indica una abreviatura').max(20),
  academic_level: z.string().min(1, 'Elige un nivel académico'),
  color: z.string().min(1),
  display_order: z.coerce.number().int().min(0).max(999),
  default_duration_months: z.coerce.number().int().min(1).max(120).nullable(),
  requires_defense: z.boolean(),
  requires_deposit: z.boolean(),
  requires_program: z.boolean(),
  allows_multiple_students: z.boolean(),
  counts_toward_workload: z.boolean(),
  notes: z.string().max(1000).optional(),
})

export type WorkTypeFormValues = z.infer<typeof workTypeFormSchema>

export const taskFormSchema = z
  .object({
    title: z.string().trim().min(3, 'Indica un título').max(300),
    description: z.string().max(3000).optional(),
    assignee_id: z.string().uuid().or(z.literal('')).optional(),
    priority: z.enum(['BAJA', 'MEDIA', 'ALTA', 'URGENTE']),
    start_date: z.string().optional(),
    due_date: z.string().optional(),
  })
  .refine((v) => !v.start_date || !v.due_date || v.due_date >= v.start_date, {
    message: 'La fecha límite no puede ser anterior al inicio',
    path: ['due_date'],
  })

export type TaskFormValues = z.infer<typeof taskFormSchema>

export const memberFormSchema = z.object({
  user_id: z.string().uuid('Elige una persona'),
  work_role_id: z.string().uuid('Elige una función'),
  is_primary: z.boolean(),
})

export type MemberFormValues = z.infer<typeof memberFormSchema>

export const invitationFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Indica el correo')
    .email('Correo no válido')
    .transform((v) => v.toLowerCase()),
  full_name: z.string().trim().max(150).optional(),
  intended_role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  notes: z.string().max(500).optional(),
})

export type InvitationFormValues = z.infer<typeof invitationFormSchema>

/**
 * Alta de documento. El origen decide qué campo es obligatorio: un fichero
 * subido o un enlace externo. El esquema de la base de datos ya exige que haya
 * al menos uno de los dos (`check` de `document_versions`), y esta validación
 * lo adelanta al formulario para no hacer un viaje en balde.
 */
export const documentFormSchema = z
  .object({
    name: z.string().trim().min(3, 'Indica un nombre').max(300),
    document_type_id: z.string().uuid().or(z.literal('')).optional(),
    description: z.string().max(2000).optional(),
    task_id: z.string().uuid().or(z.literal('')).optional(),
    source: z.enum(['FILE', 'LINK']),
    external_url: z.string().trim().url('Escribe una URL completa, con https://').or(z.literal('')).optional(),
    version_label: z.string().trim().min(1, 'Indica la versión').max(40),
  })
  .refine((v) => v.source !== 'LINK' || Boolean(v.external_url), {
    message: 'Escribe el enlace al documento',
    path: ['external_url'],
  })

export type DocumentFormValues = z.infer<typeof documentFormSchema>

/**
 * Subir una versión a un documento que YA existe.
 *
 * Es `documentFormSchema` sin lo que describe el documento (nombre, tipo,
 * descripción, tarea): eso ya está decidido y no se vuelve a preguntar. Se
 * deriva con `pick` en lugar de escribirse a mano para que la regla «si es un
 * enlace, escribe el enlace» no exista en dos versiones.
 */
export const versionFormSchema = documentFormSchema.innerType()
  .pick({ source: true, external_url: true, version_label: true })
  .refine((v) => v.source !== 'LINK' || Boolean(v.external_url), {
    message: 'Escribe el enlace al documento',
    path: ['external_url'],
  })

export type VersionFormValues = z.infer<typeof versionFormSchema>

export const meetingFormSchema = z
  .object({
    title: z.string().trim().min(3, 'Indica un título').max(300),
    scheduled_at: z.string().min(1, 'Indica la fecha y la hora'),
    duration_min: z.string().optional(),
    modality: z.enum(['PRESENCIAL', 'ONLINE', 'HIBRIDA']),
    location: z.string().max(300).optional(),
    topics: z.string().max(5000).optional(),
    /** Acta compartida: la lee también el estudiante. */
    summary: z.string().max(10000).optional(),
    next_meeting_at: z.string().optional(),
  })
  .refine(
    (v) => !v.next_meeting_at || v.next_meeting_at > v.scheduled_at,
    { message: 'La próxima reunión debe ser posterior a esta', path: ['next_meeting_at'] },
  )

export type MeetingFormValues = z.infer<typeof meetingFormSchema>
