-- supabase/migrations/20261020000015_lock_functions.sql
-- Supabase exposes public functions over /rest/v1/rpc. Only the RLS helpers and next_quote_number are meant
-- to be called by users; trigger and internal SECURITY DEFINER functions are not callable by anyone but the owner.
revoke execute on function
  advance_prospect(uuid, uuid, prospect_stage, prospect_stage[], text),
  prospects_on_appointment(),
  prospects_on_quote(),
  sync_appointment_reminders()
  from public, anon, authenticated;

revoke execute on function
  current_clinic_ids(),
  current_role_in(uuid),
  is_clinic_admin(uuid),
  next_quote_number(uuid)
  from public, anon;
grant execute on function
  current_clinic_ids(),
  current_role_in(uuid),
  is_clinic_admin(uuid),
  next_quote_number(uuid)
  to authenticated;

alter function touch_updated_at() set search_path = public;
alter function forbid_mutation() set search_path = public;
alter function guard_quote_status() set search_path = public;
alter function stamp_quote_sent() set search_path = public;
