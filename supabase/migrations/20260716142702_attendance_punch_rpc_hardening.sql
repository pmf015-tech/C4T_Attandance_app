revoke all on function public.punch_attendance(numeric, numeric, numeric) from anon;
revoke all on function public.punch_attendance(numeric, numeric, numeric) from public;
grant execute on function public.punch_attendance(numeric, numeric, numeric) to authenticated;
