-- =============================================================================
-- CMMS STAGING SETUP — schema + synthetic test data
-- =============================================================================
-- STATUS: DRAFT FOR OWNER REVIEW. NOT EXECUTED.
--
-- Run ONLY in the SQL Editor of a NEW, EMPTY, SEPARATE Supabase staging project.
-- NEVER run in production. Built-in safety: the script aborts before changing
-- anything if public.app_data already exists (production has it).
--
-- Contains: no secrets, no production data, no real people, NO USER ACCOUNTS.
-- `users` is seeded as an empty array: nobody can log in to staging until a
-- separately approved account step (docs/FEATURE_PLAN.md §13.6).
--
-- The table is deliberately never left empty: if app_data had zero rows, the
-- app's first-load seeding would create the publicly known default accounts.
-- =============================================================================

begin;

-- 0. Safety guards (abort before ANY change; the whole transaction rolls back) -
--    a) app_data must not exist (production has it). to_regclass is
--       privilege-independent, unlike information_schema.
--    b) the public schema must hold no tables or views at all (a new project's
--       public schema is empty), so the script never runs in a used database.
do $$
begin
  if to_regclass('public.app_data') is not null then
    raise exception 'public.app_data already exists. Refusing to run: this script is for a NEW, EMPTY staging project only.';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')) then
    raise exception 'The public schema is not empty. Refusing to run: use a NEW, EMPTY staging project.';
  end if;
end $$;

-- 1. Schema: identical to the setup comment in index.html:30-36 ---------------
create table public.app_data (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

-- 2. Access: the app uses only the anon key (select + upsert; never delete) ---
--    Permissive by design for SYNTHETIC data. This does NOT describe or change
--    production, whose RLS/grants remain UNVERIFIED.
alter table public.app_data enable row level security;

revoke all on table public.app_data from anon, authenticated;
grant select, insert, update on table public.app_data to anon;

create policy staging_anon_select on public.app_data
  for select to anon using (true);

-- The environment marker row cannot be inserted or changed through the API.
create policy staging_anon_insert on public.app_data
  for insert to anon with check (key <> '__environment');

create policy staging_anon_update on public.app_data
  for update to anon using (key <> '__environment') with check (key <> '__environment');

-- 3. Realtime: the app subscribes to postgres_changes on app_data -------------
alter publication supabase_realtime add table public.app_data;

-- 4. Environment marker (read by the proposed config switch; ignored by the
--    current app, which reads only its known keys) ------------------------------
insert into public.app_data (key, value) values
('__environment', '{"env":"staging","note":"Synthetic test data only. Not production."}'::jsonb);

-- 5. Categories: exactly the 10 strings of PLANTS (index.html:170), sorted ----
insert into public.app_data (key, value) values
('customPlants', '["01 FUEL FARM","02 CEMENT PLANT","03 LPG PLANT","04 POWER HOUSE","05 ROOFING PLANT","06 OXYGEN PLANT","07 MOBILE MACHINERY","08 VEHICLES","09 FIRE PUMP SYSTEM","10 BATCHING PLANT"]'::jsonb);

-- 6. Users: EMPTY. No accounts are created by this script. --------------------
insert into public.app_data (key, value) values ('users', '[]'::jsonb);

-- 7. Assets: synthetic, 2 per category; includes known edge cases ------------
--    (mixed-case plant, non-canonical statuses). No number starts with 0.
insert into public.app_data (key, value) values ('assets', $json$[
 {"num":"5001","plant":"01 FUEL FARM","desc":"TEST FUEL TANK A","code":"T-FF-01","model":"","cap":"10000L","reg":"","eng":"","serial":"TST-0001","loc":"TEST YARD 1","status":"OPERATIONAL"},
 {"num":"5002","plant":"01 FUEL FARM","desc":"TEST FUEL PUMP A","code":"T-FF-02","model":"","cap":"","reg":"","eng":"","serial":"TST-0002","loc":"TEST YARD 1","status":"BREAKDOWN"},
 {"num":"5003","plant":"02 CEMENT PLANT","desc":"TEST CEMENT MIXER","code":"T-CP-01","model":"","cap":"","reg":"","eng":"","serial":"TST-0003","loc":"TEST BAY 2","status":"OPERATIONAL"},
 {"num":"5004","plant":"02 CEMENT PLANT","desc":"TEST SILO CONVEYOR","code":"T-CP-02","model":"","cap":"","reg":"","eng":"","serial":"TST-0004","loc":"TEST BAY 2","status":"UNDER MAINTENANCE"},
 {"num":"5005","plant":"03 LPG PLANT","desc":"TEST LPG COMPRESSOR","code":"T-LP-01","model":"","cap":"","reg":"","eng":"","serial":"TST-0005","loc":"TEST BAY 3","status":"OPERATIONAL"},
 {"num":"5006","plant":"03 LPG PLANT","desc":"TEST LPG FILLING UNIT","code":"T-LP-02","model":"","cap":"","reg":"","eng":"","serial":"TST-0006","loc":"TEST BAY 3","status":"idle"},
 {"num":"5007","plant":"04 POWER HOUSE","desc":"TEST GENERATOR 1","code":"T-PH-01","model":"","cap":"500KVA","reg":"","eng":"","serial":"TST-0007","loc":"TEST POWER ROOM","status":"OPERATIONAL"},
 {"num":"5008","plant":"04 POWER HOUSE","desc":"TEST GENERATOR 2","code":"T-PH-02","model":"","cap":"500KVA","reg":"","eng":"","serial":"TST-0008","loc":"TEST POWER ROOM","status":"IDLE"},
 {"num":"5009","plant":"05 ROOFING PLANT","desc":"TEST ROLL FORMER","code":"T-RP-01","model":"","cap":"","reg":"","eng":"","serial":"TST-0009","loc":"TEST BAY 5","status":"OPERATIONAL"},
 {"num":"5010","plant":"05 ROOFING PLANT","desc":"TEST SHEAR","code":"T-RP-02","model":"","cap":"","reg":"","eng":"","serial":"TST-0010","loc":"TEST BAY 5","status":"Inactive"},
 {"num":"5011","plant":"06 OXYGEN PLANT","desc":"TEST OXYGEN GENERATOR","code":"T-OX-01","model":"","cap":"","reg":"","eng":"","serial":"TST-0011","loc":"TEST BAY 6","status":"OPERATIONAL"},
 {"num":"5012","plant":"06 OXYGEN PLANT","desc":"TEST CYLINDER MANIFOLD","code":"T-OX-02","model":"","cap":"","reg":"","eng":"","serial":"TST-0012","loc":"TEST BAY 6","status":""},
 {"num":"5013","plant":"07 MOBILE MACHINERY","desc":"TEST FORKLIFT","code":"T-MM-01","model":"","cap":"3T","reg":"TEST-REG-01","eng":"","serial":"TST-0013","loc":"TEST YARD 7","status":"OPERATIONAL"},
 {"num":"5014","plant":"07 MOBILE MACHINERY","desc":"TEST CRANE","code":"T-MM-02","model":"","cap":"25T","reg":"TEST-REG-02","eng":"","serial":"TST-0014","loc":"TEST YARD 7","status":"BREAKDOWN"},
 {"num":"5015","plant":"08 VEHICLES","desc":"TEST PICKUP","code":"T-VH-01","model":"","cap":"","reg":"TEST-REG-03","eng":"","serial":"TST-0015","loc":"TEST GARAGE","status":"OPERATIONAL"},
 {"num":"5016","plant":"08 VEHICLES","desc":"TEST VAN","code":"T-VH-02","model":"","cap":"","reg":"TEST-REG-04","eng":"","serial":"TST-0016","loc":"TEST GARAGE","status":"TRANSFERRED"},
 {"num":"5017","plant":"09 Fire Pump System","desc":"TEST FIRE PUMP (mixed-case category)","code":"T-FP-01","model":"","cap":"","reg":"","eng":"","serial":"TST-0017","loc":"TEST PUMP HOUSE","status":"OPERATIONAL"},
 {"num":"5018","plant":"09 FIRE PUMP SYSTEM","desc":"TEST JOCKEY PUMP","code":"T-FP-02","model":"","cap":"","reg":"","eng":"","serial":"TST-0018","loc":"TEST PUMP HOUSE","status":"OPERATIONAL"},
 {"num":"5019","plant":"10 BATCHING PLANT","desc":"TEST BATCHER","code":"T-BP-01","model":"","cap":"","reg":"","eng":"","serial":"TST-0019","loc":"TEST BAY 10","status":"OPERATIONAL"},
 {"num":"5020","plant":"10 BATCHING PLANT","desc":"TEST AGGREGATE BIN","code":"T-BP-02","model":"","cap":"","reg":"","eng":"","serial":"TST-0020","loc":"TEST BAY 10","status":"NEW"}
]$json$::jsonb);

-- 8. Employees: synthetic (fake names); covers each status path --------------
insert into public.app_data (key, value) values ('employees', $json$[
 {"empId":"TST-E001","name":"Test Technician One","designation":"Test Mechanic","section":"Test Section A","nationality":"Test","siteStatus":"ON DUTY","leaveType":"","leaveStart":"","leaveEnd":"","offsiteStart":"","offsiteEnd":"","exitDate":"","leaveHistory":[]},
 {"empId":"TST-E002","name":"Test Technician Two","designation":"Test Electrician","section":"Test Section A","nationality":"Test","siteStatus":"ON DUTY","leaveType":"","leaveStart":"","leaveEnd":"","offsiteStart":"","offsiteEnd":"","exitDate":"","leaveHistory":[]},
 {"empId":"TST-E003","name":"Test Technician Three","designation":"Test Welder","section":"Test Section B","nationality":"Test","siteStatus":"ON LEAVE","leaveType":"AL","leaveStart":"2026-10-01","leaveEnd":"2027-12-31","offsiteStart":"","offsiteEnd":"","exitDate":"","leaveHistory":[{"type":"AL","start":"2026-10-01","end":"2027-12-31","remarks":"synthetic","savedOn":"2026-10-01"}]},
 {"empId":"TST-E004","name":"Test Technician Four","designation":"Test Fitter","section":"Test Section B","nationality":"Test","siteStatus":"OFF SITE","leaveType":"","leaveStart":"","leaveEnd":"","offsiteStart":"2026-09-01","offsiteEnd":"","exitDate":"","leaveHistory":[]},
 {"empId":"TST-E005","name":"Test Technician Five","designation":"Test Helper","section":"Test Section C","nationality":"Test","siteStatus":"ON DUTY","leaveType":"","leaveStart":"","leaveEnd":"","offsiteStart":"","offsiteEnd":"","exitDate":"2027-12-31","leaveHistory":[]},
 {"empId":"TST-E006","name":"Test Technician Six","designation":"Test Helper","section":"Test Section C","nationality":"Test","siteStatus":"OD","leaveType":"","leaveStart":"","leaveEnd":"","offsiteStart":"","offsiteEnd":"","exitDate":"2025-01-31","leaveHistory":[]}
]$json$::jsonb);

-- 9. PM schedule: synthetic ----------------------------------------------------
insert into public.app_data (key, value) values ('pm', $json$[
 {"id":"pm-001","assetNum":"5007","assetDesc":"TEST GENERATOR 1","category":"04 POWER HOUSE","location":"TEST POWER ROOM","frequency":"Monthly","lastService":"2026-01-01","nextService":"2026-02-01","notes":"synthetic: overdue","serviceHistory":[{"date":"2026-01-01","notes":"synthetic","jobNo":null}]},
 {"id":"pm-002","assetNum":"5013","assetDesc":"TEST FORKLIFT","category":"07 MOBILE MACHINERY","location":"TEST YARD 7","frequency":"Quarterly","lastService":"2026-09-01","nextService":"2026-12-01","notes":"synthetic","serviceHistory":[]},
 {"id":"pm-003","assetNum":"5003","assetDesc":"TEST CEMENT MIXER","category":"02 CEMENT PLANT","location":"TEST BAY 2","frequency":"Yearly","lastService":"","nextService":"","notes":"synthetic: not set","serviceHistory":[]}
]$json$::jsonb);

-- 10. Job Orders: synthetic; every status; legacy shapes; varied free-text dept
--     (exact list value, case variant, abbreviations, blank, '&'); no approval
--     fields anywhere (legacy state before the planned F5 feature).
insert into public.app_data (key, value) values ('jobOrders', $json$[
 {"jobNo":"JO-1001","date":"2026-10-01","requester":"Test Requester A","dept":"Cement Plant","assetNum":"5003","assetDesc":"TEST CEMENT MIXER","assetCategory":"02 CEMENT PLANT","location":"TEST BAY 2","eqcode":"T-CP-01","problem":"Synthetic: mixer noise","priority":"High","repairType":"Unplanned","recvName":"","section":"","target":"","manpower":[{"empId":"","name":"","designation":"","hours":""}],"parts":[{"itemCode":"","desc":"","qty":"","unit":""}],"workDone":"","workStatus":"","eval":"","downtime":"","accept":"Accepted","status":"OPEN","completionDate":""},
 {"jobNo":"JO-1002","date":"2026-10-02","requester":"Test Requester B","dept":"cement plant","assetNum":"5004","assetDesc":"TEST SILO CONVEYOR","assetCategory":"02 CEMENT PLANT","location":"TEST BAY 2","eqcode":"T-CP-02","problem":"Synthetic: belt slip (lower-case dept)","priority":"Low","repairType":"Planned","recvName":"","section":"","target":"","manpower":[],"parts":[],"workDone":"","workStatus":"","eval":"","downtime":"","accept":"Accepted","status":"OPEN","completionDate":""},
 {"jobNo":"JO-1003","date":"2026-09-20","requester":"Test Requester C","dept":"LPG","assetNum":"5005","assetDesc":"TEST LPG COMPRESSOR","assetCategory":"03 LPG PLANT","location":"TEST BAY 3","eqcode":"T-LP-01","problem":"Synthetic: pressure drop (abbreviated dept)","priority":"High","repairType":"Unplanned","recvName":"Test Receiver","section":"Test Section A","target":"2026-09-21","manpower":[{"empId":"TST-E001","name":"Test Technician One","designation":"Test Mechanic","hours":"4"}],"parts":[{"itemCode":"TP-01","desc":"Test seal","qty":"2","unit":"pcs"}],"workDone":"","workStatus":"","eval":"","downtime":"","accept":"Accepted","status":"IN PROGRESS","completionDate":""},
 {"jobNo":"JO-1004","date":"2026-09-10","requester":"Test Requester D","dept":"Fuel Farm","assetNum":"5002","assetDesc":"TEST FUEL PUMP A","assetCategory":"01 FUEL FARM","location":"TEST YARD 1","eqcode":"T-FF-02","problem":"Synthetic: pump trips (legacy COMPLETED, no approval fields)","priority":"High","repairType":"Unplanned","recvName":"Test Receiver","section":"Test Section B","target":"2026-09-11","manpower":[{"empId":"TST-E002","name":"Test Technician Two","designation":"Test Electrician","hours":"6"}],"parts":[],"workDone":"Synthetic: replaced relay","workStatus":"Work Completed Successful","eval":"Good","downtime":"6","accept":"Accepted","status":"COMPLETED","completionDate":"2026-09-12"},
 {"jobNo":"JO-1005","date":"2026-08-01","requester":"Test Requester E","dept":"Roofing","assetNum":"5009","assetDesc":"TEST ROLL FORMER","assetCategory":"05 ROOFING PLANT","location":"TEST BAY 5","eqcode":"T-RP-01","problem":"Synthetic: misalignment (legacy CLOSED)","priority":"Low","repairType":"Planned","recvName":"Test Receiver","section":"Test Section C","target":"2026-08-02","manpower":[{"empId":"TST-E005","name":"Test Technician Five","designation":"Test Helper","hours":"3"}],"parts":[],"workDone":"Synthetic: realigned","workStatus":"Work Completed Successful","eval":"Very Good","downtime":"3","accept":"Accepted","status":"CLOSED","completionDate":"2026-08-03","closedBy":"Test Approver One","closerDesignation":"Technical Operations Supervisor","closedDate":"2026-08-04"},
 {"jobNo":"JO-1006","date":"2026-07-15","requester":"Test Requester F","dept":"","assetNum":"5014","assetDesc":"TEST CRANE","assetCategory":"07 MOBILE MACHINERY","location":"TEST YARD 7","eqcode":"T-MM-02","priority":"High","repairType":"Unplanned","problem":"Synthetic: CSV-import style record (blank dept)","status":"CLOSED","target":"2026-07-16","section":"Test Section A","tech1":"TST-E001","tech1h":"5","tech2":"TST-E002","tech2h":"5","workDone":"Synthetic: hydraulic hose","workStatus":"Work Completed Successful","eval":"Satisfied","downtime":"10","accept":"Accepted","completionDate":"2026-07-17","recvName":"Test Receiver","approved":"Test Approver Two","parts":[]},
 {"jobNo":"JO-1007","date":"2026-09-25","requester":"Test Requester G","dept":"Stores","assetNum":"5015","assetDesc":"TEST PICKUP","assetCategory":"08 VEHICLES","location":"TEST GARAGE","eqcode":"T-VH-01","problem":"Synthetic: brake check (dept 'Stores')","priority":"Low","repairType":"Planned","recvName":"Test Receiver","section":"Test Section C","target":"2026-09-26","manpower":[],"parts":[],"workDone":"Synthetic: pads replaced","workStatus":"Temporary Repaired","eval":"Satisfied","downtime":"2","accept":"Accepted","status":"COMPLETED","completionDate":"2026-09-27"},
 {"jobNo":"JO-1008","date":"2026-10-03","requester":"Test Requester H","dept":"F&B","assetNum":"5007","assetDesc":"TEST GENERATOR 1","assetCategory":"04 POWER HOUSE","location":"TEST POWER ROOM","eqcode":"T-PH-01","problem":"Synthetic: dept containing '&' (escaping test)","priority":"High","repairType":"Unplanned","recvName":"Test Receiver","section":"Test Section B","target":"2026-10-03","manpower":[],"parts":[],"workDone":"","workStatus":"","eval":"","downtime":"","accept":"Accepted","status":"IN PROGRESS","completionDate":""},
 {"jobNo":"JO-1009","date":"2026-10-04","requester":"Test Requester I","dept":"Accounts","assetNum":"5016","assetDesc":"TEST VAN","assetCategory":"08 VEHICLES","location":"TEST GARAGE","eqcode":"T-VH-02","problem":"Synthetic: department differs from category","priority":"Low","repairType":"Planned","recvName":"","section":"","target":"","manpower":[],"parts":[],"workDone":"","workStatus":"","eval":"","downtime":"","accept":"Accepted","status":"OPEN","completionDate":""},
 {"jobNo":"JO-1010","date":"2026-10-05","requester":"Test Requester J","dept":"Housekeeping","assetNum":"5999","assetDesc":"TEST ORPHAN ASSET","assetCategory":"10 BATCHING PLANT","location":"TEST BAY 10","eqcode":"","problem":"Synthetic: references a non-existent asset","priority":"Low","repairType":"Planned","recvName":"","section":"","target":"","manpower":[],"parts":[],"workDone":"","workStatus":"","eval":"","downtime":"","accept":"Accepted","status":"OPEN","completionDate":""}
]$json$::jsonb);

commit;

-- 11. Verification (metadata only; run after the commit above) ----------------
--     Expected: __environment object; assets 20; customPlants 10; employees 6;
--     jobOrders 10; pm 3; users 0.
select key,
       jsonb_typeof(value) as type,
       case when jsonb_typeof(value) = 'array' then jsonb_array_length(value) end as items
from public.app_data
order by key;
