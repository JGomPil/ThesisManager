-- =============================================================================
-- 0027 · El correo se cambia, y el perfil sigue siendo el mismo
--
-- POR QUE
-- Quien pierde su correo institucional —cambia de centro, se le acaba el
-- contrato, le renombran el dominio— no puede entrar. La salida que quedaba era
-- crear otra cuenta, y eso ROMPE EL HISTORIAL: la identidad de esta aplicacion
-- es el perfil (`profiles.id`), y de el cuelgan las relaciones academicas, las
-- tareas, los comentarios, las actas y el registro de actividad. Una cuenta
-- nueva es otra persona para la base de datos, y el trabajo de la anterior se
-- queda a nombre de un perfil que ya no usa nadie.
--
-- Asi que el correo tiene que poder cambiar SIN cambiar el perfil. El cambio de
-- verdad lo hace Supabase Auth (`auth.updateUser({ email })`, con confirmacion
-- por enlace), que es quien manda sobre las credenciales. Lo que falta, y es lo
-- que hace esta migracion, son las dos mitades que no estaban:
--
--   1. QUE EL PERFIL SIGA A LA CUENTA. `profiles.email` es la copia que lee la
--      aplicacion —el directorio, la ficha de la persona, los avisos—. Nadie la
--      actualizaba al cambiar el correo en auth: la persona entraba con el
--      nuevo y el grupo seguia viendo el viejo. Sin ningun error.
--
--   2. QUE EL PERFIL NO PUEDA DESVIARSE. `profiles_update_self` (0003) deja a
--      cada cual escribir su propia fila ENTERA, columna de correo incluida. O
--      sea que cualquiera podia poner en su perfil un correo que no es el de su
--      cuenta: seguiria entrando con el suyo, y en el directorio del grupo
--      apareceria el de otra persona. Es una suplantacion barata y silenciosa.
--
-- Las dos se resuelven con el mismo criterio: el correo del perfil NO es un dato
-- editable, es el reflejo de `auth.users.email`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. El perfil sigue a la cuenta
-- -----------------------------------------------------------------------------
-- `security definer` porque escribe `public.profiles` desde un disparador de
-- `auth.users`: la sesion que confirma un cambio de correo no es la de nadie que
-- tenga permiso sobre esa fila.
--
-- Vale para las dos vias, y eso es justamente lo que se busca: la persona lo
-- cambia desde «Mi perfil», o la administracion se lo cambia desde el panel de
-- Supabase cuando el enlace no llega. En los dos casos el perfil se entera.
create or replace function app.sync_profile_email()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
     set email = new.email, updated_at = now()
   where id = new.id;
  return new;
end;
$$;
revoke all on function app.sync_profile_email() from public;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function app.sync_profile_email();

-- -----------------------------------------------------------------------------
-- 2. El perfil no se desvia de la cuenta
-- -----------------------------------------------------------------------------
-- Un cambio de `profiles.email` solo se admite si deja la fila diciendo lo que
-- dice `auth.users`. El disparador de arriba cumple la condicion —escribe
-- exactamente el correo nuevo de la cuenta—; una peticion a PostgREST con otro
-- valor, no.
--
-- `security definer` para poder leer `auth.users`, que no es legible para
-- `authenticated`. Si no lo fuera, el `select` no devolveria fila, el correo de
-- la cuenta se leeria como nulo y la comprobacion rechazaria TODO cambio,
-- incluido el legitimo: fallaria cerrada, que es menos grave que lo contrario
-- pero deja el cambio de correo sin funcionar y sin motivo visible.
create or replace function app.enforce_profile_email_matches_auth()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_cuenta text;
begin
  if new.email is distinct from old.email then
    select email into v_cuenta from auth.users where id = new.id;
    if new.email is distinct from v_cuenta then
      raise exception 'El correo del perfil es el de la cuenta: se cambia desde «Mi perfil» y se confirma por correo'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.enforce_profile_email_matches_auth() from public;

drop trigger if exists enforce_profile_email on profiles;
create trigger enforce_profile_email
  before update of email on profiles
  for each row execute function app.enforce_profile_email_matches_auth();

-- -----------------------------------------------------------------------------
-- Autocomprobaciones
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgname = 'on_auth_user_email_changed' and p.prosecdef
  ) then
    raise exception '0027: falta on_auth_user_email_changed (o no es security definer): el perfil seguiria diciendo el correo viejo';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgname = 'enforce_profile_email' and p.prosecdef
  ) then
    raise exception '0027: falta enforce_profile_email (o no es security definer): cualquiera podria poner en su perfil el correo de otro';
  end if;
  raise notice 'CORRECTO: 0027 el correo se cambia en la cuenta y el perfil lo sigue';
end $$;
