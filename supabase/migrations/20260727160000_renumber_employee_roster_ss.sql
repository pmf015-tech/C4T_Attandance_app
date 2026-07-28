-- ══════════════════════════════════════════════════════════════
-- Renumber employee_roster to the Sunspeed (SS) numbering scheme
--
-- The roster was seeded with provisional C4T-* numbers. Sunspeed
-- has no pre-existing employee IDs, so these are assigned by us:
--   C4T-001 .. C4T-005 -> SS-001 .. SS-005   (employees)
--   C4T-ADM-001        -> SS-ADM-001         (admin)
--
-- Staff names are intentionally not written here: this repository
-- is public, the roster rows are not.
--
-- `department` stays NULL: Sunspeed has no departments yet.
-- Writes an audit event per row (BACKEND-CONTRACT rule 6).
-- ══════════════════════════════════════════════════════════════

do $$
declare
  v_map constant jsonb := jsonb_build_object(
    'C4T-001',     'SS-001',
    'C4T-002',     'SS-002',
    'C4T-003',     'SS-003',
    'C4T-004',     'SS-004',
    'C4T-005',     'SS-005',
    'C4T-ADM-001', 'SS-ADM-001'
  );
  v_old text;
  v_new text;
begin
  for v_old, v_new in select key, value #>> '{}' from jsonb_each(v_map) loop
    -- Idempotent: skip if already renumbered on a previous run.
    if not exists (select 1 from public.employee_roster where employee_number = v_old) then
      continue;
    end if;

    if exists (select 1 from public.employee_roster where employee_number = v_new) then
      raise exception 'Target employee_number % already exists', v_new;
    end if;

    update public.employee_roster
    set employee_number = v_new
    where employee_number = v_old;

    insert into public.attendance_audit_events (
      actor_id, action, resource_type, resource_key,
      previous_value, next_value, note
    ) values (
      null,
      'employee_number.reassign',
      'employee_roster',
      v_new,
      jsonb_build_object('employee_number', v_old),
      jsonb_build_object('employee_number', v_new),
      'Migrated to Sunspeed (SS) numbering; performed as a schema migration, no interactive actor.'
    );
  end loop;
end;
$$;
