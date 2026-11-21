-- T30.3: finish_email accepts a fourth outcome, 'deferred' (SPEC §8; RESEARCH "Email budget (T30.3)").
-- send-emails uses it when Resend answers 429 daily_quota_exceeded or monthly_quota_exceeded: Resend neither queues
-- nor retries that email, and counting it as a failed attempt would drop a payment confirmation after five tries on a
-- busy day. A deferred row goes back to pending without spending the attempt claim_email_outbox counted, and waits
-- until 5 minutes past the next UTC midnight, when Resend's daily quota resets (a monthly quota defers day by day).
-- Same signature, so `create or replace` keeps the grants (service_role only, 20261019143330_email_outbox.sql).
create or replace function public.finish_email(p_id uuid, p_outcome text, p_error text default null)
returns public.email_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.email_outbox;
begin
  if p_outcome is null or p_outcome not in ('sent', 'skipped', 'failed', 'deferred') then
    raise exception 'Unknown email outcome.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  select o.* into v_row from public.email_outbox o where o.id = p_id for update;
  if not found then
    raise exception 'Email not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_row.status <> 'sending' then
    raise exception 'This email is not being sent.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  if p_outcome in ('sent', 'skipped') then
    update public.email_outbox
    set status = p_outcome::public.email_status, sent_at = now(), locked_until = null,
        last_error = case when p_outcome = 'skipped' then left(p_error, 1000) else last_error end
    where id = p_id;
    return p_outcome::public.email_status;
  end if;

  if p_outcome = 'deferred' then
    update public.email_outbox
    set status = 'pending', locked_until = null,
        attempts = greatest(v_row.attempts - 1, 0),
        last_error = left(coalesce(p_error, 'Deferred: the email quota is used up.'), 1000),
        next_attempt_at = (date_trunc('day', now() at time zone 'utc') + interval '1 day 5 minutes') at time zone 'utc'
    where id = p_id;
    return 'pending';
  end if;

  if v_row.attempts >= 5 then
    update public.email_outbox
    set status = 'failed', locked_until = null, last_error = left(coalesce(p_error, 'Send failed.'), 1000)
    where id = p_id;
    return 'failed';
  end if;

  update public.email_outbox
  set status = 'pending', locked_until = null, last_error = left(coalesce(p_error, 'Send failed.'), 1000),
      next_attempt_at = now() + case v_row.attempts
                                  when 1 then interval '1 minute'
                                  when 2 then interval '5 minutes'
                                  when 3 then interval '15 minutes'
                                  else interval '60 minutes'
                                end
  where id = p_id;
  return 'pending';
end;
$$;

comment on function public.finish_email(uuid, text, text) is
  'Worker only: sent | skipped | failed (retried with backoff, failed after 5 attempts) | deferred (quota: pending again '
  'without spending the attempt, after the next UTC midnight). T8.2, T30.3.';
