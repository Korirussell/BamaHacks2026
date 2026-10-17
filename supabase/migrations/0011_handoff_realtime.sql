-- Live meetup updates go out on private Supabase Realtime channels named `handoff:{id}`
-- (events handoff.updated / handoff.presence / handoff.tap / handoff.completed, sent by the API).
-- Private channels need an RLS policy on realtime.messages: only the two parties of a handoff
-- may receive its messages. Clients never send on these channels; the API broadcasts with the
-- service role.

create policy handoff_parties_receive on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'handoff:%'
    and exists (
      select 1 from public.handoffs h
      where 'handoff:' || h.id::text = realtime.topic()
        and auth.uid() in (h.giver_id, h.receiver_id)
    )
  );
