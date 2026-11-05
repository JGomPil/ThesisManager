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
  },

  works: {
    all: ['works'] as const,
    list: (filters: unknown) => ['works', 'list', filters] as const,
    detail: (id: string) => ['works', 'detail', id] as const,
    members: (id: string) => ['works', id, 'members'] as const,
  },

  tasks: {
    byWork: (workId: string) => ['tasks', 'work', workId] as const,
    mine: ['tasks', 'mine'] as const,
  },

  people: {
    directory: ['people', 'directory'] as const,
  },

  invitations: ['invitations'] as const,

  maintenance: ['maintenance', 'keepalive'] as const,
}
