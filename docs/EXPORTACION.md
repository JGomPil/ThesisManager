# EXPORTACIÓN — consultas con los catálogos ya resueltos

Las tablas guardan identificadores: `work_type_id`, `status_id`, `work_role_id`. Exportar una
tabla en crudo desde el *Table Editor* de Supabase produce un CSV lleno de UUID que no sirve para
entregar nada a nadie. Aquí están las consultas con los `JOIN` hechos, pensadas para pegar en el
**SQL Editor** de Supabase y descargar el resultado, o para volcarlas a CSV desde `psql`.

Las tres vías de exportación, y para qué sirve cada una:

| Vía | Qué da | Cuándo |
|---|---|---|
**Informes → CSV** (en la aplicación) | Una fila por trabajo, con las dos cifras de progreso | El día a día, y para una comisión |
**Administración → Copia de los datos académicos** | JSON con todo lo legible, para reconstruir | Antes de un cambio gordo; al cerrar un curso |
**Estas consultas** | Lo que haga falta, con los nombres en claro | Una entrega concreta: el historial de alguien, un listado para la secretaría |

> **Ninguna de las tres incluye `meeting_private_notes`**, y es deliberado: ver `SECURITY.md`
> §5.2.sexdecies. Si alguna vez hiciera falta exportarlas, es una decisión consciente de quien
> administra, no el comportamiento por omisión de una consulta copiada de aquí.

> **Protección de datos.** Todo lo de abajo contiene datos personales. Destino: unidad
> institucional de la UVa o disco cifrado; nunca un servicio personal ni el repositorio.
> `SECURITY.md` §8.

## 1. Todos los trabajos, con catálogos y personas en claro

```sql
select
  w.title                                as "Título",
  wt.name                                as "Tipo",
  ws.name                                as "Estado",
  ay.code                                as "Curso",
  p.name                                 as "Titulación",
  rl.name                                as "Línea de investigación",
  w.start_date                           as "Inicio",
  w.expected_end_date                    as "Fin previsto",
  w.actual_end_date                      as "Fin real",
  w.defense_date                         as "Defensa",
  w.progress_override                    as "Progreso académico (%)",
  (select string_agg(pr.full_name, ' / ' order by pr.full_name)
     from work_members m
     join work_roles r  on r.id = m.work_role_id
     join profiles  pr  on pr.id = m.user_id
    where m.work_id = w.id and m.status = 'ACTIVE' and r.is_student)      as "Estudiante(s)",
  (select pr.full_name
     from work_members m
     join work_roles r  on r.id = m.work_role_id
     join profiles  pr  on pr.id = m.user_id
    where m.work_id = w.id and m.status = 'ACTIVE' and r.is_supervisory
    order by m.is_primary desc, m.created_at
    limit 1)                                                             as "Dirección principal",
  (select count(*) from tasks t
    where t.work_id = w.id and t.parent_task_id is null)                  as "Tareas",
  (select count(*) from tasks t
    where t.work_id = w.id and t.parent_task_id is null
      and t.status = 'COMPLETADA')                                        as "Tareas completadas"
from academic_works w
join work_types     wt on wt.id = w.work_type_id
join work_statuses  ws on ws.id = w.status_id
left join academic_years ay on ay.id = w.academic_year_id
left join programs       p  on p.id  = w.program_id
left join research_lines rl on rl.id = w.research_line_id
where w.deleted_at is null
order by ay.code desc nulls last, wt.display_order, w.title;
```

**Las subtareas no se cuentan** (`parent_task_id is null`): son los puntos de las listas de
comprobación, y contarlas haría que una tarea con diez puntos pesara diez veces más que una sin
lista. Es la misma regla que aplica la aplicación.

## 2. Historial de una persona

Para entregarle a alguien su propio expediente de seguimiento, o para un informe de tutoría.

```sql
select
  w.title            as "Trabajo",
  wt.short_name      as "Tipo",
  r.name             as "Su función",
  ws.name            as "Estado",
  ay.code            as "Curso",
  w.start_date       as "Inicio",
  w.expected_end_date as "Fin previsto",
  w.defense_date     as "Defensa"
from work_members m
join profiles       pr on pr.id = m.user_id
join work_roles     r  on r.id  = m.work_role_id
join academic_works w  on w.id  = m.work_id
join work_types     wt on wt.id = w.work_type_id
join work_statuses  ws on ws.id = w.status_id
left join academic_years ay on ay.id = w.academic_year_id
where pr.email = 'persona@uva.es'      -- ← cambiar
  and w.deleted_at is null
order by w.start_date desc nulls last;
```

Sale **una fila por función**: quien dirige un TFG y es doctorando de su propia tesis aparece dos
veces, con funciones distintas. No es un duplicado, es el diseño de roles no excluyentes.

## 3. Plan de trabajo de un trabajo

```sql
select
  case when t.parent_task_id is null then t.title else '  ↳ ' || t.title end as "Tarea",
  t.status      as "Estado",
  t.priority    as "Prioridad",
  pr.full_name  as "Responsable",
  t.start_date  as "Inicio",
  t.due_date    as "Fecha límite",
  t.completed_at as "Completada"
from tasks t
left join profiles pr on pr.id = t.assignee_id
where t.work_id = '00000000-0000-0000-0000-000000000000'   -- ← cambiar
order by coalesce(t.parent_task_id, t.id), t.parent_task_id nulls first, t.order_index;
```

## 4. Entregas y su estado de revisión

```sql
select
  w.title            as "Trabajo",
  d.name             as "Documento",
  dt.name            as "Tipo de documento",
  v.version_label    as "Versión",
  v.review_status    as "Estado de revisión",
  autor.full_name    as "Entregado por",
  v.submitted_at     as "Entregado el",
  revisor.full_name  as "Revisado por",
  v.reviewed_at      as "Revisado el",
  (v.storage_path is not null) as "Fichero alojado aquí",
  (select count(*) from document_comments c where c.version_id = v.id) as "Comentarios"
from document_versions v
join documents       d  on d.id = v.document_id
join academic_works  w  on w.id = v.work_id
left join document_types dt     on dt.id = d.document_type_id
left join profiles       autor  on autor.id = v.author_id
left join profiles       revisor on revisor.id = v.reviewer_id
where d.deleted_at is null and w.deleted_at is null
order by w.title, d.name, v.submitted_at desc;
```

## 5. Reuniones y acuerdos (sin notas privadas)

```sql
select
  w.title           as "Trabajo",
  mt.title          as "Reunión",
  mt.scheduled_at   as "Fecha",
  mt.modality       as "Modalidad",
  mt.summary        as "Acta compartida",
  (select count(*) from meeting_participants mp where mp.meeting_id = mt.id) as "Asistentes",
  (select string_agg(a.description, ' · ' order by a.order_index)
     from meeting_agreements a where a.meeting_id = mt.id)                   as "Acuerdos"
from meetings mt
join academic_works w on w.id = mt.work_id
where w.deleted_at is null
order by mt.scheduled_at desc;
```

`summary` es el **acta compartida**, la que ve también el estudiante. Las notas privadas viven en
otra tabla y esta consulta no las toca.

## 6. Carga de dirección por persona y curso

```sql
select
  pr.full_name  as "Director/a",
  ay.code       as "Curso",
  wt.short_name as "Tipo",
  count(*)      as "Trabajos",
  count(*) filter (where not ws.is_terminal) as "En curso"
from work_members m
join work_roles     r  on r.id  = m.work_role_id and r.is_supervisory
join profiles       pr on pr.id = m.user_id
join academic_works w  on w.id  = m.work_id
join work_types     wt on wt.id = w.work_type_id
join work_statuses  ws on ws.id = w.status_id
left join academic_years ay on ay.id = w.academic_year_id
where m.status = 'ACTIVE' and w.deleted_at is null
group by pr.full_name, ay.code, wt.short_name
order by pr.full_name, ay.code desc nulls last;
```

## 7. Volcar a CSV desde `psql`

El SQL Editor de Supabase descarga el resultado en CSV con un botón, y para una consulta suelta
es lo más rápido. Para automatizarlo:

```bash
psql "postgresql://postgres:<PASS>@db.<REF>.supabase.co:5432/postgres" \
  -c "\copy (<la consulta, sin el punto y coma final>) to 'trabajos.csv' with (format csv, header, delimiter ';')"
```

**Separador `;` y no coma**: Excel en configuración regional española abre un CSV de comas metiendo
toda la fila en una celda. Y si los acentos salen mal al abrirlo en Windows, al fichero le falta el
BOM de UTF-8; se añade con:

```bash
printf '\xEF\xBB\xBF' | cat - trabajos.csv > trabajos-excel.csv
```

La exportación de **Informes → CSV** de la aplicación ya lleva las dos cosas resueltas.
