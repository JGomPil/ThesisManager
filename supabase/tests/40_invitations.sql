\echo '================ COLA DE INVITACIONES ================'
-- Idempotente: 10_roles_and_privacy.sql ya puede haber creado estas filas.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','admin@test.invalid')
on conflict (id) do nothing;
insert into organizations (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001','GIB-UVa','gib-uva')
on conflict (id) do nothing;
insert into organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','ADMIN')
on conflict (organization_id, user_id) do nothing;

-- Permisos que Supabase concede de serie y el arnés debe imitar.
grant usage on schema public, app, auth to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
grant execute on function auth.uid() to anon, authenticated;

set role authenticated;
set session "test.uid" = '11111111-1111-1111-1111-111111111111';

\echo '[25] El admin registra una invitación'
insert into invitations (organization_id, email, full_name, intended_role, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000001','nuevo@test.invalid','Nuevo Ficticio','MEMBER',
        '11111111-1111-1111-1111-111111111111')
returning email, status;

\echo '[26] No se puede duplicar una invitación viva para el mismo correo'
do $$
begin
  insert into invitations (organization_id, email) values
    ('aaaaaaaa-0000-0000-0000-000000000001','nuevo@test.invalid');
  raise notice 'FALLO: invitacion duplicada permitida';
exception when unique_violation then
  raise notice 'CORRECTO: el indice unico impide duplicar la invitacion';
end $$;

\echo '[27] Un correo en mayúsculas se rechaza (se normaliza en la aplicación)'
do $$
begin
  insert into invitations (organization_id, email) values
    ('aaaaaaaa-0000-0000-0000-000000000001','MAYUS@test.invalid');
  raise notice 'FALLO: correo sin normalizar aceptado';
exception when check_violation then
  raise notice 'CORRECTO: el check exige el correo en minusculas';
end $$;

\echo '[28] El admin la marca como enviada'
update invitations set status = 'SENT', sent_at = now() where email = 'nuevo@test.invalid'
returning status;

reset role;
\echo '[29] La persona entra por primera vez: la invitación se cierra Y queda de alta'
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555','nuevo@test.invalid');
select i.status, i.accepted_user_id = '55555555-5555-5555-5555-555555555555' as usuario_vinculado,
       om.role as alta_en_organizacion
from invitations i
left join organization_members om on om.user_id = i.accepted_user_id
where i.email = 'nuevo@test.invalid';

\echo '[30] Alguien SIN invitación entra: no obtiene pertenencia ninguna'
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666','intruso@test.invalid');
select p.email,
       (select count(*) from organization_members where user_id = p.id) as pertenencias
from profiles p where p.email = 'intruso@test.invalid';

\echo '[31] Un usuario NO administrador no ve las invitaciones'
insert into organization_members (organization_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','66666666-6666-6666-6666-666666666666','MEMBER');
set role authenticated;
set session "test.uid" = '66666666-6666-6666-6666-666666666666';
select count(*) as invitaciones_visibles from invitations;
