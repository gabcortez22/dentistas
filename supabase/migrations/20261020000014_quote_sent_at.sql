-- supabase/migrations/20261020000014_quote_sent_at.sql
-- Remember when a quote was marked as sent, so follow-ups count from the real send date.
alter table quotes add column sent_at timestamptz;
update quotes set sent_at = created_at where status in ('sent', 'accepted', 'rejected', 'expired');

create function stamp_quote_sent() returns trigger language plpgsql as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    new.sent_at = now();
  end if;
  return new;
end $$;
create trigger quotes_stamp_sent before update of status on quotes
  for each row execute function stamp_quote_sent();
