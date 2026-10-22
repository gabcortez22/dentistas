-- agent_turns was the only table without clinic_id. Add it, backfill from the conversation, and
-- tie it to the conversation's clinic so a turn can never point at another clinic's conversation.
alter table agent_turns add column clinic_id uuid references clinics (id) on delete restrict;
update agent_turns t set clinic_id = c.clinic_id from agent_conversations c where c.id = t.conversation_id;
alter table agent_turns alter column clinic_id set not null;

alter table agent_conversations add constraint agent_conversations_id_clinic_key unique (id, clinic_id);
alter table agent_turns add constraint agent_turns_conversation_clinic_fkey
  foreign key (conversation_id, clinic_id) references agent_conversations (id, clinic_id) on delete restrict;

drop policy agent_turns_select on agent_turns;
create policy agent_turns_select on agent_turns for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
