-- supabase/migrations/20261020000012_rules_closure.sql
-- A weekly rule that never took effect is closed by setting valid_until = valid_from - 1 (an empty range),
-- so rules are replaced without deleting rows.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'availability_rules'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%valid_until%';
  execute format('alter table availability_rules drop constraint %I', c);
end $$;

alter table availability_rules
  add constraint availability_rules_validity check (valid_until is null or valid_until >= valid_from - 1);
