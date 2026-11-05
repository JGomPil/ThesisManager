import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addMonths, format, parseISO } from 'date-fns'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorPanel, FieldError, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { worksRepo } from '@/data/repositories/works.repo'
import {
  useAcademicYears, usePrograms, useResearchLines, useWorkStatuses, useWorkTypeStatuses, useWorkTypes,
} from '@/hooks/use-catalogs'
import { statusesForWorkType } from '@/domain/works/statuses'
import { workFormSchema, type WorkFormValues } from '@/schemas/work'
import { useAuth } from '@/features/auth/auth-context'

export function WorkFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const { organizationId, userId } = useAuth()

  const workTypes = useWorkTypes()
  const statuses = useWorkStatuses()
  const typeStatuses = useWorkTypeStatuses()
  const programs = usePrograms()
  const years = useAcademicYears()
  const lines = useResearchLines()

  const existing = useQuery({
    queryKey: qk.works.detail(id ?? ''),
    queryFn: () => worksRepo.get(id!),
    enabled: isEdit,
  })

  const form = useForm<WorkFormValues>({
    resolver: zodResolver(workFormSchema),
    defaultValues: {
      title: '', work_type_id: '', status_id: '', program_id: '', academic_year_id: '',
      research_line_id: '', start_date: '', expected_end_date: '',
      description: '', objectives: '', methodology: '', keywords: '',
    },
  })

  // Al cargar un trabajo existente, poblar el formulario.
  React.useEffect(() => {
    const w = existing.data
    if (!w) return
    form.reset({
      title: w.title,
      work_type_id: w.work_type_id,
      status_id: w.status_id,
      program_id: w.program_id ?? '',
      academic_year_id: w.academic_year_id ?? '',
      research_line_id: w.research_line_id ?? '',
      start_date: w.start_date ?? '',
      expected_end_date: w.expected_end_date ?? '',
      description: w.description ?? '',
      objectives: w.objectives ?? '',
      methodology: w.methodology ?? '',
      keywords: w.keywords.join(', '),
    })
  }, [existing.data, form])

  const selectedTypeId = form.watch('work_type_id')
  const startDate = form.watch('start_date')
  const selectedType = (workTypes.data ?? []).find((t) => t.id === selectedTypeId)

  // Estados ofrecidos SEGÚN EL TIPO: la Academia de Alumnos Internos no
  // ofrecerá «Pendiente de depósito» ni «Defendido».
  const availableStatuses = statusesForWorkType(selectedTypeId, statuses.data ?? [], typeStatuses.data ?? [])

  // Si el estado elegido ya no aplica al tipo seleccionado, se limpia.
  React.useEffect(() => {
    const current = form.getValues('status_id')
    if (current && availableStatuses.length > 0 && !availableStatuses.some((s) => s.id === current)) {
      form.setValue('status_id', '')
    }
  }, [availableStatuses, form])

  // Propuesta de fecha de fin a partir de la duración del tipo.
  React.useEffect(() => {
    if (isEdit) return
    const months = selectedType?.default_duration_months
    if (!months || !startDate) return
    if (form.getValues('expected_end_date')) return
    form.setValue('expected_end_date', format(addMonths(parseISO(startDate), months), 'yyyy-MM-dd'))
  }, [selectedType, startDate, isEdit, form])

  const save = useMutation({
    mutationFn: async (values: WorkFormValues) => {
      const payload = {
        title: values.title,
        work_type_id: values.work_type_id,
        status_id: values.status_id,
        program_id: values.program_id || null,
        academic_year_id: values.academic_year_id || null,
        research_line_id: values.research_line_id || null,
        start_date: values.start_date || null,
        expected_end_date: values.expected_end_date || null,
        description: values.description || null,
        objectives: values.objectives || null,
        methodology: values.methodology || null,
        keywords: (values.keywords ?? '')
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      }
      if (isEdit) return worksRepo.update(id!, payload)
      if (!organizationId) throw new Error('No tienes una organización activa.')
      return worksRepo.create({ ...payload, organization_id: organizationId, created_by: userId })
    },
    onSuccess: (work) => {
      void qc.invalidateQueries({ queryKey: qk.works.all })
      toast.push('success', isEdit ? 'Trabajo actualizado.' : 'Trabajo creado.')
      navigate(`/trabajos/${work.id}`)
    },
    onError: (e) => toast.push('error', errorMessage(e)),
  })

  if (isEdit && existing.isLoading) return <LoadingPanel />
  if (isEdit && existing.isError) return <ErrorPanel error={existing.error} />

  const programRequired = selectedType?.requires_program ?? false

  return (
    <div className="space-y-4">
      <PageHeader
        title={isEdit ? 'Editar trabajo' : 'Nuevo trabajo académico'}
        breadcrumb={[{ label: 'Trabajos', to: '/trabajos' }, { label: isEdit ? 'Editar' : 'Nuevo' }]}
      />

      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Datos principales</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="title">Título</Label>
              <Input id="title" className="mt-1.5" {...form.register('title')} />
              <FieldError>{form.formState.errors.title?.message}</FieldError>
            </div>

            <div>
              <Label htmlFor="work_type_id">Tipo de trabajo</Label>
              <Select id="work_type_id" className="mt-1.5" {...form.register('work_type_id')}>
                <option value="">Elige un tipo…</option>
                {(workTypes.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
              <FieldError>{form.formState.errors.work_type_id?.message}</FieldError>
              {selectedType && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    selectedType.requires_defense ? 'con defensa' : 'sin defensa',
                    selectedType.requires_deposit ? 'con depósito' : 'sin depósito',
                    selectedType.default_duration_months ? `${selectedType.default_duration_months} meses` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="status_id">Estado</Label>
              <Select id="status_id" className="mt-1.5" {...form.register('status_id')}>
                <option value="">Elige un estado…</option>
                {availableStatuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              <FieldError>{form.formState.errors.status_id?.message}</FieldError>
            </div>

            <div>
              <Label htmlFor="program_id">
                Titulación o programa {!programRequired && <span className="text-muted-foreground">(opcional)</span>}
              </Label>
              <Select id="program_id" className="mt-1.5" {...form.register('program_id')}>
                <option value="">Sin titulación asociada</option>
                {(programs.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="academic_year_id">Curso académico</Label>
              <Select id="academic_year_id" className="mt-1.5" {...form.register('academic_year_id')}>
                <option value="">Sin curso</option>
                {(years.data ?? []).map((y) => (
                  <option key={y.id} value={y.id}>{y.code}</option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="start_date">Fecha de inicio</Label>
              <Input id="start_date" type="date" className="mt-1.5" {...form.register('start_date')} />
            </div>

            <div>
              <Label htmlFor="expected_end_date">Fecha prevista de fin</Label>
              <Input id="expected_end_date" type="date" className="mt-1.5" {...form.register('expected_end_date')} />
              <FieldError>{form.formState.errors.expected_end_date?.message}</FieldError>
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="research_line_id">Línea de investigación</Label>
              <Select id="research_line_id" className="mt-1.5" {...form.register('research_line_id')}>
                <option value="">Sin línea asignada</option>
                {(lines.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Contenido académico</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="description">Descripción</Label>
              <Textarea id="description" className="mt-1.5" rows={3} {...form.register('description')} />
            </div>
            <div>
              <Label htmlFor="objectives">Objetivos</Label>
              <Textarea id="objectives" className="mt-1.5" rows={3} {...form.register('objectives')} />
            </div>
            <div>
              <Label htmlFor="methodology">Metodología</Label>
              <Textarea id="methodology" className="mt-1.5" rows={3} {...form.register('methodology')} />
            </div>
            <div>
              <Label htmlFor="keywords">Palabras clave</Label>
              <Input id="keywords" className="mt-1.5" placeholder="separadas por comas" {...form.register('keywords')} />
            </div>
            <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              No incluyas datos clínicos ni información identificativa de pacientes en ningún campo
              de texto libre.
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button type="submit" loading={save.isPending}>
            {isEdit ? 'Guardar cambios' : 'Crear trabajo'}
          </Button>
        </div>
      </form>
    </div>
  )
}
