import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { GanttChartSquare, ListPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorPanel, Spinner } from '@/components/common/states'
import { EnPantallaCompleta, ExpandButton, FullscreenPanel } from '@/components/common/fullscreen'
import { qk } from '@/lib/query-keys'
import { milestonesRepo } from '@/data/repositories/milestones.repo'
import { tasksRepo, type TaskWithAssignee } from '@/data/repositories/tasks.repo'
import { GanttChart } from '@/features/plan/gantt-chart'
import { ApplyTemplateDialog } from '@/features/plan/apply-template-dialog'
import type { WorkCapabilities } from '@/domain/permissions/work-capabilities'

/**
 * Cronograma del trabajo: el Gantt con sus hitos y sus dependencias.
 *
 * Reúne aquí las tres consultas que necesita el dibujo para que la ficha del
 * trabajo no cargue con ellas. Las tareas se reciben ya cargadas desde la
 * ficha: pedirlas otra vez daría dos listas que pueden discrepar durante unos
 * milisegundos, y el progreso del trabajo se calcula con la primera.
 */
export function ScheduleCard({
  workId, workTypeId, workStartDate, tasks, caps,
}: {
  workId: string
  workTypeId: string
  workStartDate: string | null
  tasks: TaskWithAssignee[]
  caps: WorkCapabilities
}) {
  const [plantillaAbierta, setPlantillaAbierta] = React.useState(false)
  const [expandido, setExpandido] = React.useState(false)

  const principales = React.useMemo(() => tasks.filter((t) => t.parent_task_id === null), [tasks])

  // TODAS las tareas, no solo las de primer nivel: desde que una tarea puede
  // esperar a una subtarea, preguntar solo por las principales dejaría aristas
  // fuera del grafo, y el Gantt ordenaría y marcaría bloqueos con un grafo
  // incompleto sin que nada lo delate.
  const ids = React.useMemo(() => tasks.map((t) => t.id), [tasks])

  const hitos = useQuery({
    queryKey: qk.milestones.byWork(workId),
    queryFn: () => milestonesRepo.byWork(workId),
  })

  const deps = useQuery({
    queryKey: qk.dependencies.byTasks(workId),
    queryFn: () => tasksRepo.dependencies(ids),
    enabled: ids.length > 0,
  })

  // El dibujo se arma UNA vez y se enseña en la tarjeta o a pantalla completa,
  // nunca en los dos sitios a la vez. A pantalla completa la columna de
  // nombres va más ancha: ahí el ancho ya no es lo que escasea.
  const grafico = hitos.isError ? (
    <ErrorPanel error={hitos.error} />
  ) : deps.isError ? (
    <ErrorPanel error={deps.error} />
  ) : hitos.isLoading ? (
    <Spinner />
  ) : (
    <GanttChart
      tasks={principales.map((t) => ({
        id: t.id,
        title: t.title,
        start_date: t.start_date,
        due_date: t.due_date,
        status: t.status,
        parent_task_id: t.parent_task_id,
      }))}
      milestones={hitos.data ?? []}
      dependencies={deps.data ?? []}
      estados={tasks.map((t) => ({ id: t.id, status: t.status }))}
      anchoNombres={expandido ? 340 : undefined}
    />
  )

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <GanttChartSquare className="size-4 text-muted-foreground" /> Cronograma
        </CardTitle>
        <div className="flex shrink-0 items-center gap-2">
          <ExpandButton
            label="Ver el cronograma a pantalla completa"
            onClick={() => setExpandido(true)}
          />
          {caps.canManagePlan && (
            <Button size="sm" variant="outline" onClick={() => setPlantillaAbierta(true)}>
              <ListPlus /> Aplicar plantilla
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {expandido ? <EnPantallaCompleta /> : grafico}
      </CardContent>

      <FullscreenPanel open={expandido} onOpenChange={setExpandido} title="Cronograma del trabajo">
        {expandido && grafico}
      </FullscreenPanel>

      <ApplyTemplateDialog
        open={plantillaAbierta}
        onOpenChange={setPlantillaAbierta}
        workId={workId}
        workTypeId={workTypeId}
        workStartDate={workStartDate}
      />
    </Card>
  )
}
