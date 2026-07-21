-- Password resets are handled by Supabase Auth's recovery flow.
-- Remove the legacy SECURITY DEFINER RPC so passwords cannot be changed by
-- calling a public database function and so the schema no longer depends on
-- pgcrypto functions that are unavailable on the configured search path.
do $$
declare
  function_signature regprocedure;
begin
  for function_signature in
    select procedure.oid::regprocedure
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'reset_user_password'
  loop
    execute format('drop function %s', function_signature);
  end loop;
end;
$$;
