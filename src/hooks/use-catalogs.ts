import { useQuery } from '@tanstack/react-query'
import { qk } from '@/lib/query-keys'
import { catalogsRepo } from '@/data/repositories/catalogs.repo'

/**
 * Los catálogos cambian poco y se usan en casi todas las pantallas:
 * se cachean generosamente. Al crear o editar un tipo de trabajo se invalidan
 * explícitamente, de modo que un tipo nuevo aparece al instante en los
 * selectores y en el dashboard.
 */
const CATALOG_OPTIONS = { staleTime: 10 * 60 * 1000 } as const

export const useWorkTypes = (includeInactive = false) =>
  useQuery({
    queryKey: [...qk.catalogs.workTypes, includeInactive],
    queryFn: () => catalogsRepo.listWorkTypes({ includeInactive }),
    ...CATALOG_OPTIONS,
  })

export const useWorkStatuses = () =>
  useQuery({ queryKey: qk.catalogs.workStatuses, queryFn: catalogsRepo.listWorkStatuses, ...CATALOG_OPTIONS })

export const useWorkTypeStatuses = () =>
  useQuery({ queryKey: qk.catalogs.workTypeStatuses, queryFn: catalogsRepo.listWorkTypeStatuses, ...CATALOG_OPTIONS })

export const useWorkRoles = () =>
  useQuery({ queryKey: qk.catalogs.workRoles, queryFn: catalogsRepo.listWorkRoles, ...CATALOG_OPTIONS })

export const useAcademicLevels = () =>
  useQuery({ queryKey: qk.catalogs.academicLevels, queryFn: catalogsRepo.listAcademicLevels, ...CATALOG_OPTIONS })

export const useAcademicYears = () =>
  useQuery({ queryKey: qk.catalogs.academicYears, queryFn: catalogsRepo.listAcademicYears, ...CATALOG_OPTIONS })

export const usePrograms = () =>
  useQuery({ queryKey: qk.catalogs.programs, queryFn: catalogsRepo.listPrograms, ...CATALOG_OPTIONS })

export const useResearchLines = () =>
  useQuery({ queryKey: qk.catalogs.researchLines, queryFn: catalogsRepo.listResearchLines, ...CATALOG_OPTIONS })

export const useDocumentTypes = () =>
  useQuery({ queryKey: qk.catalogs.documentTypes, queryFn: catalogsRepo.listDocumentTypes, ...CATALOG_OPTIONS })
