import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addMonths, format, parseISO } from 'date-fns'
import { PageHeader } from '@/app/layout/app-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarkupEditor } from '@/components/common/markup-editor'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorPanel, FieldError, LoadingPanel } from '@/components/common/states'
import { useToast } from '@/components/ui/toast'
import { qk } from '@/lib/query-keys'
import { errorMessage } from '@/lib/supabase'
import { worksRepo } from '@/data/repositories/works.repo'
import {
  useAcademicYears, usePrograms, useResearchLines, useWorkRoles, useWorkStatuses,
  useWorkTypeStatuses, useWorkTypes,
} from '@/hooks/use-catalogs'
import { peopleRepo } from '@/data/repositories/people.repo'
import { templatesRepo } from '@/data/repositories/templates.repo'
import { plantillaAlCambiarDeTipo } from '@/domain/works/plantilla-por-omision'
import { statusesForWorkType } from '@/domain/works/statuses'
import { workFormSchema, type WorkFormValues } from '@/schemas/work'
import { useAuth } from '@/features/auth/auth-context'
import { resolveWorkCapabilities } from '@/domain/permissions/work-capabilities'

export function WorkFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const { organizationId, userId, isOrgAdmin } = useAuth()

  const workTypes = useWorkTypes()
  const statuses = useWorkStatuses()
  const typeStatuses = useWorkTypeStatuses()
  const programs = usePrograms()
  const years = useAcademicYears()
  const lines = useResearchLines()
  const roles = useWorkRoles()
  const people = useQuery({ queryKey: qk.people.directory, queryFn: peopleRepo.directory, enabled: !isEdit })

  // Las funciones se eligen por sus PROPIEDADES, no por un código fijo: son un
  // catálogo editable y el usuario puede renombrarlas o añadir otras. Aquí solo
  // sirve para NOMBRAR lo que va a pasar («se asigna como directora»): quien
  // elige de verdad la función es `app.crear_trabajo`, con esta misma regla, y
  // así la frase de la pantalla y la fila que se escribe no pueden discrepar.
  const rolDeDireccion = (roles.data ?? []).find((r) => r.is_supervisory && r.can_manage_members)

  const existing = useQuery({
    queryKey: qk.works.detail(id ?? ''),
    queryFn: () => worksRepo.get(id!),
    enabled: isEdit,
  })

  /**
   * SOLO EL CONTENIDO ACADÉMICO cuando quien edita es el alumno del trabajo.
   *
   * Desde la 0030 el alumno puede cambiar descripción, objetivos, metodología
   * y palabras clave de SU trabajo, y nada más: el expediente —título, tipo,
   * estado, fechas y el progreso «a juicio de la dirección»— lo frena el
   * disparador `enforce_work_update_scope`.
   *
   * Por eso aquí no basta con esconder las tarjetas que no le tocan: el envío
   * tiene que llevar SOLO esos campos. Mandar el resto «tal como estaban»
   * parece inofensivo y no lo es —una fecha que el navegador normaliza
   * distinto, o un catálogo que cambió de valor por defecto, bastan para que
   * el disparador vea una columna cambiada y rechace la edición entera—, y el
   * alumno recibiría un error de permisos por un campo que ni ha visto.
   */
  const caps = resolveWorkCapabilities(existing.data?.members ?? [], userId, isOrgAdmin)
  const soloContenido = isEdit && !caps.canEditWork && caps.canEditAcademicContent

  const form = useForm<WorkFormValues>({
    resolver: zodResolver(workFormSchema),
    defaultValues: {
      title: '', work_type_id: '', status_id: '', program_id: '', academic_year_id: '',
      research_line_id: '', start_date: '', expected_end_date: '',
      actual_end_date: '', defense_date: '', progress_override: '',
      description: '', objectives: '', hypothesis: '', methodology: '', keywords: '',
      supervisor_id: '', student_id: '', template_id: '',
    },
  })

  // Al crear, la dirección por defecto es quien está creando el trabajo. Es lo
  // que ocurre casi siempre, y evita el paso de crearlo y volver a asignarse.
  React.useEffect(() => {
    if (isEdit || !userId) return
    if (!form.getValues('supervisor_id')) form.setValue('supervisor_id', userId)
  }, [isEdit, userId, form])

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
      actual_end_date: w.actual_end_date ?? '',
      defense_date: w.defense_date ?? '',
      // `null` es «sin valorar» y `0` es «valorado en cero»: dos cosas
      // distintas que un `?? ''` descuidado convertiría en la misma.
      progress_override: w.progress_override === null ? '' : String(w.progress_override),
      description: w.description ?? '',
      objectives: w.objectives ?? '',
      hypothesis: w.hypothesis ?? '',
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

  // Plantillas aplicables al tipo que está elegido ahora mismo en el
  // formulario. Se piden solo al crear, y ESTE ES EL ÚNICO SITIO donde se
  // aplica una plantilla: en la edición el plan ya existe y aplicar una
  // encima sumaría tareas en lugar de sustituirlas, que no es lo que esperaría
  // nadie. El cronograma de la ficha tuvo un botón para hacerlo y se quitó por
  // eso mismo: o se aplica al crear el trabajo, o se planifica a mano.
  const plantillas = useQuery({
    queryKey: qk.templates.forWorkType(selectedTypeId),
    queryFn: () => templatesRepo.forWorkType(selectedTypeId),
    enabled: !isEdit && Boolean(selectedTypeId),
  })

  /**
   * Al elegir un tipo, su plantilla normal viene ya puesta.
   *
   * SE PRESELECCIONA, NO SE APLICA SOLA: el botón sigue siendo de quien crea
   * el trabajo. Y si la marcada en el catálogo no está entre las aplicables
   * —la retiraron, o es de otro tipo— se queda en «Empezar sin plan», porque
   * `app.apply_template` la rechazaría al guardar (prueba [86]).
   *
   * EL `ref` NO SOBRA. Esto tiene que correr UNA VEZ POR TIPO, no cada vez que
   * la consulta devuelve datos: sin él, a quien eligiera «Empezar sin plan» le
   * reaparecería la plantilla sola en cuanto se refrescara la lista, y no
   * habría forma de crear un trabajo sin plan.
   */
  const preseleccionadaPara = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (isEdit || !selectedTypeId || plantillas.data === undefined) return
    if (preseleccionadaPara.current === selectedTypeId) return
    preseleccionadaPara.current = selectedTypeId
    form.setValue(
      'template_id',
      plantillaAlCambiarDeTipo(plantillas.data, selectedType?.default_template_id ?? null),
    )
  }, [plantillas.data, selectedTypeId, selectedType, isEdit, form])

  // Y aparte de lo anterior: si la plantilla ELEGIDA A MANO deja de ser
  // aplicable, desaparece. Una plantilla de TFG no se puede aplicar a una
  // tesis, y `app.apply_template` la rechazaría al guardar. Mejor que se
  // quite de la vista que ofrecer algo que va a fallar.
  React.useEffect(() => {
    if (isEdit) return
    const elegida = form.getValues('template_id')
    if (!elegida) return
    if (!(plantillas.data ?? []).some((t) => t.id === elegida)) form.setValue('template_id', '')
  }, [plantillas.data, isEdit, form])

  const plantillaElegida =
    (plantillas.data ?? []).find((t) => t.id === form.watch('template_id')) ?? null

  const save = useMutation({
    mutationFn: async (values: WorkFormValues) => {
      const contenidoAcademico = {
        description: values.description || null,
        objectives: values.objectives || null,
        hypothesis: values.hypothesis || null,
        methodology: values.methodology || null,
        keywords: (values.keywords ?? '')
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      }
      // El alumno manda SOLO lo suyo. Ver `soloContenido`, arriba.
      if (soloContenido) return worksRepo.update(id!, contenidoAcademico)

      const payload = {
        title: values.title,
        work_type_id: values.work_type_id,
        status_id: values.status_id,
        program_id: values.program_id || null,
        academic_year_id: values.academic_year_id || null,
        research_line_id: values.research_line_id || null,
        start_date: values.start_date || null,
        expected_end_date: values.expected_end_date || null,
        actual_end_date: values.actual_end_date || null,
        defense_date: values.defense_date || null,
        // Esto funciona porque el valor es TEXTO: `'0'` es una cadena no
        // vacía, así que un progreso de cero se guarda como 0. Si el campo
        // fuese numérico, este mismo `? :` convertiría el cero en «sin
        // valorar», que es una afirmación bien distinta.
        progress_override: values.progress_override ? Number(values.progress_override) : null,
        ...contenidoAcademico,
      }
      if (isEdit) return worksRepo.update(id!, payload)
      if (!organizationId) throw new Error('No tienes una organización activa.')

      // EL TRABAJO Y SU DIRECCIÓN, DE UNA VEZ (migración 0034). Antes esto
      // eran dos pasos —insertar el trabajo y añadir después a los
      // participantes— y el comentario de aquí decía que hacerlo atómico
      // exigiría una función en la base de datos. Hizo falta: `works_select`
      // solo enseña los trabajos de los que eres miembro, así que un trabajo
      // sin participantes es invisible para quien lo acaba de crear, y a quien
      // no administra el grupo el segundo paso le fallaría siempre.
      const workId = await worksRepo.crear({
        ...payload,
        organization_id: organizationId,
        supervisor_id: values.supervisor_id || null,
        student_id: values.student_id || null,
      })

      // El plan, al final y a propósito: después de la dirección, para que el
      // trabajo ya tenga a quien planifica, y después de todo lo demás porque
      // es lo único que se puede repetir sin consecuencias desde la ficha. La
      // llamada en sí SÍ es atómica —o el plan entero o nada, prueba [87]—, de
      // modo que aquí no puede quedar medio plan.
      const failed: string[] = []
      let creadas = 0
      if (values.template_id) {
        try {
          creadas = await templatesRepo.apply(
            workId, values.template_id, values.start_date || undefined,
          )
        } catch (e) {
          failed.push(errorMessage(e))
        }
      }
      return { work: { id: workId }, failed, creadas }
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: qk.works.all })
      if (isEdit) {
        toast.push('success', 'Trabajo actualizado.')
        navigate(`/trabajos/${id!}`)
        return
      }
      const { work, failed, creadas } = result as {
        work: { id: string }; failed: string[]; creadas: number
      }
      void qc.invalidateQueries({ queryKey: qk.works.detail(work.id) })
      void qc.invalidateQueries({ queryKey: qk.tasks.all })
      if (failed.length > 0) {
        toast.push(
          'error',
          `Trabajo creado, pero algo no se ha podido completar: ${failed[0]}. Termínalo desde la ficha.`,
        )
      } else if (creadas > 0) {
        toast.push('success', `Trabajo creado con ${creadas} tarea(s) del plan.`)
      } else {
        toast.push('success', 'Trabajo creado.')
      }
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

      {/* Se dice lo que NO se puede cambiar, y por qué. Un formulario con
          cuatro campos donde antes había veinte, sin explicación, se lee como
          una pantalla a medio cargar. */}
      {soloContenido && (
        <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
          Esto es lo que escribes tú. El título, el tipo, el estado, las fechas y el progreso
          los lleva la dirección del trabajo.
        </p>
      )}

      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        {!soloContenido && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Datos principales</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        )}

        {/* Seguimiento. SOLO AL EDITAR, y no por capricho: al crear un trabajo
            no hay nada que valorar todavía y una fecha de fin real recién
            nacida solo puede ser un error. Al editar son justo los dos campos
            que la ficha enseñaba sin dejar cambiarlos. El progreso se puede
            tocar además desde la propia ficha, que es donde se mira. */}
        {isEdit && !soloContenido && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Seguimiento</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="progress_override">Progreso académico (%)</Label>
                <Input
                  id="progress_override"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  className="mt-1.5"
                  {...form.register('progress_override')}
                />
                <FieldError>{form.formState.errors.progress_override?.message}</FieldError>
                <p className="mt-1 text-xs text-muted-foreground">
                  A juicio de la dirección, con independencia de las tareas completadas. Déjalo
                  vacío para dejarlo «sin valorar»: no es lo mismo que un 0 %.
                </p>
              </div>

              <div>
                <Label htmlFor="actual_end_date">Fecha de fin real</Label>
                <Input id="actual_end_date" type="date" className="mt-1.5" {...form.register('actual_end_date')} />
                <FieldError>{form.formState.errors.actual_end_date?.message}</FieldError>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cuándo terminó de verdad, que casi nunca coincide con la fecha prevista.
                </p>
              </div>

              {/* LA DEFENSA, solo para los tipos que la tienen. El catálogo de
                  tipos de trabajo ya decide eso con `requires_defense` —es la
                  misma condición con la que la ficha enseña la fila «Defensa»
                  y con la que se habilita el estado «Defendido»—, así que un
                  informe interno o una estancia no ven un campo que en su caso
                  no significa nada.

                  Si el tipo del trabajo cambia a uno sin defensa, la fecha que
                  hubiera guardada se queda donde está y deja de verse. Es a
                  propósito: borrarla sola, al vuelo y sin decirlo, es perder
                  un dato por un cambio de catálogo. */}
              {selectedType?.requires_defense && (
                <div>
                  <Label htmlFor="defense_date">Fecha de defensa</Label>
                  <Input id="defense_date" type="date" className="mt-1.5" {...form.register('defense_date')} />
                  <FieldError>{form.formState.errors.defense_date?.message}</FieldError>
                  <p className="mt-1 text-xs text-muted-foreground">
                    El día del acto. Sale en la ficha y en el informe del trabajo.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Participantes iniciales. Solo al crear: en la edición los gestiona la
            tarjeta de la ficha, que admite funciones múltiples y permisos por
            trabajo. Aquí están las dos que casi siempre se conocen de entrada,
            para no obligar a crear el trabajo y volver a entrar en él. */}
        {!isEdit && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Participantes</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="supervisor_id">Dirección</Label>
                <Select id="supervisor_id" className="mt-1.5" {...form.register('supervisor_id')}>
                  <option value="">Sin asignar todavía</option>
                  {(people.data ?? []).map((pe) => (
                    <option key={pe.id} value={pe.id}>
                      {pe.id === userId ? `${pe.full_name} (yo)` : pe.full_name}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Se asigna como {rolDeDireccion?.name.toLowerCase() ?? 'dirección'} del trabajo.
                  Los codirectores se añaden después, desde la ficha.
                </p>
              </div>

              <div>
                <Label htmlFor="student_id">Estudiante</Label>
                <Select id="student_id" className="mt-1.5" {...form.register('student_id')}>
                  <option value="">Sin asignar todavía</option>
                  {(people.data ?? [])
                    .filter((pe) => pe.id !== form.watch('supervisor_id'))
                    .map((pe) => (
                      <option key={pe.id} value={pe.id}>{pe.full_name}</option>
                    ))}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(people.data ?? []).length <= 1
                    ? 'Aquí solo aparecen personas con cuenta. Da de alta al estudiante en Administración → Invitaciones y asígnalo luego desde la ficha.'
                    : 'Puedes dejarlo sin asignar y completarlo cuando se confirme.'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Plan inicial. Solo al crear, por la misma razón que los
            participantes: es lo que se sabe de entrada y obligar a crear el
            trabajo, entrar en él y buscar un botón en otra tarjeta era el
            camino largo para algo que se decide aquí. */}
        {!isEdit && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Plan de trabajo</CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="template_id">Plantilla</Label>
              <Select
                id="template_id"
                className="mt-1.5"
                disabled={!selectedTypeId}
                {...form.register('template_id')}
              >
                <option value="">Empezar sin plan</option>
                {(plantillas.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.tasks.length} tarea(s)
                    {t.files.length > 0 ? ` · ${t.files.length} material(es)` : ''}
                    {t.work_type ? '' : ' · cualquier tipo'}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {!selectedTypeId
                  ? 'Elige antes el tipo de trabajo: las plantillas se ofrecen según el tipo.'
                  : plantillas.isLoading
                    ? 'Buscando plantillas…'
                    : (plantillas.data ?? []).length === 0
                      ? 'No hay plantillas activas para este tipo. Se crean en Administración → Plantillas de plan.'
                      : plantillaElegida
                        ? `Las tareas se crearán con fechas contadas desde ${
                            startDate
                              ? `el ${format(parseISO(startDate), 'd/MM/yyyy')}`
                              : 'hoy, porque el trabajo no tiene fecha de inicio'
                          }. Puedes cambiarlas después una a una.`
                        : 'Si eliges una, el plan se crea con el trabajo. Es el único momento en que se aplica una plantilla: después, las tareas se añaden a mano desde el plan de trabajo.'}
              </p>

              {/*
                Por qué aparece algo ya elegido sin haberlo tocado. Encontrarse
                una plantilla puesta sin explicacion desconcierta, y lo primero
                que se piensa es que ya se ha aplicado. Se dice de donde viene y
                que se puede quitar.
              */}
              {plantillaElegida && plantillaElegida.id === selectedType?.default_template_id && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Viene puesta porque es la plantilla habitual de
                  {selectedType?.name ? ` «${selectedType.name}»` : ' este tipo'}. Puedes cambiarla
                  o dejarlo en «Empezar sin plan»; nada se crea hasta que guardes.
                </p>
              )}

              {plantillaElegida && plantillaElegida.tasks.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {plantillaElegida.tasks.slice(0, 6).map((t) => (
                    <li key={t.id}>
                      {t.parent_index !== null && <span aria-hidden>↳ </span>}
                      {t.title}
                      <span className="ml-1">
                        (día +{t.offset_days}, {t.duration_days} día(s))
                      </span>
                    </li>
                  ))}
                  {plantillaElegida.tasks.length > 6 && (
                    <li>…y {plantillaElegida.tasks.length - 6} más.</li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Contenido académico</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* CON BARRA DE FORMATO, como los comentarios: estos tres campos
                son los únicos del formulario donde se escribe prosa larga, y
                la metodología es casi siempre una lista de pasos.
                `Controller` y no `register` porque `MarkupEditor` no expone
                un `ref` de formulario: trabaja con `value`/`onChange` para
                poder recolocar el cursor después de aplicar una marca. De
                paso, aísla el repintado a este campo en vez de repintar el
                formulario entero en cada tecla. */}
            <div>
              <Label htmlFor="description">Descripción</Label>
            <Controller
              control={form.control}
              name="description"
              render={({ field }) => (
                <MarkupEditor
                  id="description"
                  className="mt-1.5"
                  rows={3}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            </div>
            <div>
              <Label htmlFor="objectives">Objetivos</Label>
            <Controller
              control={form.control}
              name="objectives"
              render={({ field }) => (
                <MarkupEditor
                  id="objectives"
                  className="mt-1.5"
                  rows={3}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            </div>
            <div>
              {/* LA HIPÓTESIS existía en `academic_works` desde la 0002 y no
                  había ningún campo que la escribiera: el dato estaba en la
                  base, la `0030` ya se lo permitía al alumno, y no se podía
                  teclear en ninguna parte. Es el mismo descuido que tuvieron
                  la fecha de defensa y el progreso académico. Va entre los
                  objetivos y la metodología porque ese es el orden en que se
                  piensa un trabajo: qué quiero conseguir, qué sospecho, cómo
                  lo compruebo. Opcional, porque un TFG de desarrollo puede no
                  tener ninguna. */}
              <Label htmlFor="hypothesis">Hipótesis</Label>
            <Controller
              control={form.control}
              name="hypothesis"
              render={({ field }) => (
                <MarkupEditor
                  id="hypothesis"
                  className="mt-1.5"
                  rows={3}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            </div>
            <div>
              <Label htmlFor="methodology">Metodología</Label>
            <Controller
              control={form.control}
              name="methodology"
              render={({ field }) => (
                <MarkupEditor
                  id="methodology"
                  className="mt-1.5"
                  rows={3}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
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
