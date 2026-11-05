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
