/** Claves de TanStack Query centralizadas: evita invalidaciones que no casan. */
export const qk = {
  session: ['session'] as const,
  me: ['me'] as const,
  myMemberships: ['me', 'memberships'] as const,

  catalogs: {
    workTypes: ['catalogs', 'work-types'] as const,
    workStatuses: ['catalogs', 'work-statuses'] as const,
    workTypeStatuses: ['catalogs', 'work-type-statuses'] as const,
    workRoles: ['catalogs', 'work-roles'] as const,
    academicLevels: ['catalogs', 'academic-levels'] as const,
    academicYears: ['catalogs', 'academic-years'] as const,
    programs: ['catalogs', 'programs'] as const,
    researchLines: ['catalogs', 'research-lines'] as const,
    documentTypes: ['catalogs', 'document-types'] as const,
    /** Listas de administración: incluyen lo desactivado. */
    allResearchLines: ['catalogs', 'research-lines', 'all'] as const,
    allPrograms: ['catalogs', 'programs', 'all'] as const,
    allAcademicYears: ['catalogs', 'academic-years', 'all'] as const,
    allWorkStatuses: ['catalogs', 'work-statuses', 'all'] as const,
    allWorkRoles: ['catalogs', 'work-roles', 'all'] as const,
    allDocumentTypes: ['catalogs', 'document-types', 'all'] as const,
    documentTypeUsage: ['catalogs', 'usage', 'document-types'] as const,
    statusRoleUsage: ['catalogs', 'usage', 'statuses-roles'] as const,
    usage: ['catalogs', 'usage'] as const,
  },

  works: {
    all: ['works'] as const,
    list: (filters: unknown) => ['works', 'list', filters] as const,
    detail: (id: string) => ['works', 'detail', id] as const,
    members: (id: string) => ['works', id, 'members'] as const,
    archived: ['works', 'archived'] as const,
  },

  tasks: {
    /**
     * TODO lo que depende de las tareas, para invalidar de una vez.
     *
     * react-query casa por prefijo, así que esta clave alcanza a `byWork`, a
     * `mine` y a `summary`. Se usa en los sitios que CAMBIAN tareas, y existe
     * por un fallo concreto: al añadir `summary` para el resumen hubo que
     * acordarse de invalidarla en los seis sitios que crean o mueven tareas, y
     * no se acordó nadie. Resultado: se planificaba un trabajo, se volvía al
     * resumen y seguía diciendo «Sin planificación» hasta recargar a mano.
     *
     * Con el prefijo, la próxima consulta de tareas que se añada queda cubierta
     * sin tocar ninguna pantalla. Lo que se paga es marcar como caducadas las
     * tareas de otros trabajos, que solo se vuelven a pedir si alguien las mira.
     */
    all: ['tasks'] as const,
    byWork: (workId: string) => ['tasks', 'work', workId] as const,
    mine: ['tasks', 'mine'] as const,
    summary: ['tasks', 'summary'] as const,
    /**
     * Las columnas del tablero de un trabajo (0024). Van bajo `tasks` a
     * propósito: son parte del plan de trabajo, y así `tasks.all` —que se
     * invalida al mover una tarjeta— también las alcanza.
     */
    boardColumns: (workId: string) => ['tasks', 'board-columns', workId] as const,
    /** La papelera de un trabajo (0025): lo archivado, que no sale en `byWork`. */
    archived: (workId: string) => ['tasks', 'archived', workId] as const,
  },

  people: {
    directory: ['people', 'directory'] as const,
    detail: (id: string) => ['people', 'detail', id] as const,
    pending: ['people', 'pending'] as const,
    orgMembers: (organizationId: string) => ['people', 'org-members', organizationId] as const,
  },

  documents: {
    byWork: (workId: string) => ['documents', 'work', workId] as const,
    comments: (versionId: string) => ['documents', 'comments', versionId] as const,
    commentCounts: (workId: string) => ['documents', 'comment-counts', workId] as const,
  },

  meetings: {
    byWork: (workId: string) => ['meetings', 'work', workId] as const,
    privateNotes: (meetingId: string) => ['meetings', meetingId, 'private-notes'] as const,
  },

  comments: (workId: string, entityType: string, entityId: string) =>
    ['comments', workId, entityType, entityId] as const,

  notifications: {
    list: ['notifications', 'list'] as const,
    unread: ['notifications', 'unread'] as const,
    dispositivos: ['notifications', 'dispositivos'] as const,
    prefs: ['notifications', 'prefs'] as const,
  },

  milestones: {
    byWork: (workId: string) => ['milestones', 'work', workId] as const,
  },

  dependencies: {
    byTasks: (workId: string) => ['dependencies', 'work', workId] as const,
  },

  templates: {
    all: ['templates'] as const,
    forWorkType: (workTypeId: string) => ['templates', 'work-type', workTypeId] as const,
    /** Material de referencia de una tarea de plantilla, visto desde la tarea real. */
    taskFiles: (templateTaskId: string) => ['templates', 'task-files', templateTaskId] as const,
  },

  reports: {
    snapshot: (filters: unknown) => ['reports', 'snapshot', filters] as const,
    work: (workId: string) => ['reports', 'work', workId] as const,
  },

  calendar: (from: string, to: string) => ['calendar', from, to] as const,

  invitations: ['invitations'] as const,

  maintenance: ['maintenance', 'keepalive'] as const,
  planUsage: ['maintenance', 'plan-usage'] as const,
}
