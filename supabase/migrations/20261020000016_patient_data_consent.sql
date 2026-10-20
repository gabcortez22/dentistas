-- Ley 29733: record when a patient consented to the processing of their personal data
-- and which version of the privacy policy they were shown. Nullable: patients created
-- before this migration, or by the WhatsApp agent, have no consent on file yet.
alter table patients
  add column data_consent_at timestamptz,
  add column data_consent_version text,
  add constraint patients_data_consent_complete
    check ((data_consent_at is null) = (data_consent_version is null));
