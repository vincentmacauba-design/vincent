-- DRAFT — NOT EXECUTED.  Rollback of 0009 (was 0006): restore direct jobOrders and employees writes (the 0002 matrix). Run FIRST.
begin;
create or replace function private.can_write_key(k text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case k
    when 'assets'       then private.has_role(array['Admin','Assistant Engineer'])
    when 'jobOrders'    then private.has_role(array['Admin','Assistant Engineer','Senior Engineer','Job Card Editor'])
    when 'pm'           then private.has_role(array['Admin','Assistant Engineer'])
    when 'employees'    then private.has_role(array['Admin','Assistant Engineer'])
    when 'customPlants' then private.has_role(array['Admin','Assistant Engineer'])
    else false
  end
$$;
commit;
