-- supabase/migrations/20261020000011_cop_format.sql
-- Align the record with the Colegio Odontologico del Peru "Formato de Historia Clinica":
-- extra identification fields and the "alta del paciente" entry.
alter type clinical_entry_kind add value if not exists 'alta';

alter table patients
  add column religion text,
  add column race text,
  add column origin_place text;
