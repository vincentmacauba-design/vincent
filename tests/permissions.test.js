// Permission model tests: F1 (§12) + F2 roles/scope/user validation (§6, §3.2, §7) + D19 downloads + F5 approval rules (§4). Offline; no network, no data.
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const SQLP2 = ['0005_p2b_job_order_functions.sql', '0006_completion.sql', '0007_p2b_more_functions.sql'].map(f => fs.readFileSync(path.join(__dirname, '..', 'p2', 'sql', f), 'utf8')).join('\n');
const sqlFn = name => { const i = SQLP2.indexOf('create function public.' + name + '('); return i < 0 ? '' : SQLP2.slice(i, SQLP2.indexOf('end $$;', i)); };
const { sanitizedIndex } = require('./lib/sanitize');
const html = sanitizedIndex(process.argv[2]).replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const t = (n, c, info) => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'PASS ' : 'FAIL ') + n + (info !== undefined && (!c || process.env.V) ? '  -> ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); };

// ---- load the real PERMISSIONS + SCOPE blocks (pure code before sortByAssetNum) ----
const a = html.indexOf('// ─── PERMISSIONS'), b = html.indexOf('function sortByAssetNum(arr){');
t('permission/scope block present', a > 0 && b > a && html.slice(a, b).includes('// ─── SCOPE'));
const ctx = { TextEncoder, URLSearchParams }; vm.createContext(ctx);
vm.runInContext("var DESIGNATIONS = {'Admin':'Admin Designation','Senior Engineer':'SE Designation'};", ctx);   // defined earlier in index.html
vm.runInContext((html.match(/^const DATA_KEYS = .*$/m) || ['var DATA_KEYS_MISSING = 1;'])[0], ctx);              // N1: real line from index.html
vm.runInContext(html.slice(a, b) + '\nthis.X = {validatePassword, passwordProblems, PASSWORD_RULES, FORCED_CHANGE_ALLOWED, signInOutcome, signInEmailFor, normalizeEmployeeId, profileFromRow, signedInState, profileFor, AUTH_SIGNED_OUT, authAdapterFor, EMPLOYEE_ID_RE, parseRecoveryLink, notificationsFor, datasetsFor, can, ROLE_CAPS, DEPARTMENTS, canSeeAsset, canSeeJO, mayEditJO, isDeptUser, validateUserRecord, normalizeUserRecord, pickFields, JO_REQUEST_FIELDS, JO_WORK_FIELDS, isApproved, canApproveJO, canCloseJO, normWork, workChanged, withStoredFields, withoutApprover, approvalEvent, resetApprovalIfChanged, JO_CONTROL_FIELDS, isJobCardEditor, isEligibleEditor, validateNewPassword, DU_REPAIR_TYPE, JCE_SECTIONS, jceSectionAllows, planAssetImport, applyAssetPlan, isValidAuthState, mustChangePassword, authzFingerprint, planDataLoad, escHtml, stableJson, realtimeAction, circuitTraces, recoveryStep, recoveryLinkKind, RECOVERY_MESSAGES, RECOVERY_SERVICE, unreadCount, NOTIFY_EVENT_LABEL, signalSchedule, signalKeyframes, glowKeyframes};', ctx);
vm.runInContext('function sortByAssetNum(arr){return [...arr].sort((a,b)=>(parseInt(a.num)||0)-(parseInt(b.num)||0));}', ctx);
const { can, ROLE_CAPS, DEPARTMENTS, canSeeAsset, canSeeJO, mayEditJO, isDeptUser, validateUserRecord, normalizeUserRecord } = ctx.X;
const ROLES = ['Admin', 'Assistant Engineer', 'Senior Engineer', 'Job Card Editor', 'Department User'];
const R3 = ROLES.slice(0, 3);

// ---- T1: matrix transcribed independently from FEATURE_PLAN §6 [Admin, AE, SE, JCE, DU] (DU = S where scoped) ----
const EXPECT = {
  'nav.dashboard': [1,1,1,1,1], 'nav.assets': [1,1,1,1,1], 'nav.jobOrders': [1,1,1,1,1], 'nav.reports': [1,1,1,1,1],
  'nav.pm': [1,1,1,1,0], 'nav.employees': [1,1,1,1,0], 'settings.profile': [1,1,1,1,1],
  'users.admin': [1,0,0,0,0], 'data.reset': [1,0,0,0,0],
  'asset.view': [1,1,1,1,1], 'asset.create': [1,1,0,0,0], 'asset.edit': [1,1,0,0,0], 'asset.status': [1,1,0,0,0], 'asset.delete': [1,1,0,0,0],
  'asset.import': [1,1,0,0,0], 'asset.export': [1,1,1,1,0], 'asset.category.manage': [1,1,0,0,0], 'asset.clearAll': [1,0,0,0,0],
  'pm.view': [1,1,1,1,0], 'pm.edit': [1,1,0,0,0], 'pm.recordService': [1,1,0,0,0], 'pm.import': [1,1,0,0,0], 'pm.export': [1,1,1,1,0],
  'emp.view': [1,1,1,1,0], 'emp.admin': [1,0,0,0,0], 'emp.statusUpdate': [1,1,0,0,0], 'emp.export': [1,1,1,1,0], 'report.view': [1,1,1,1,1],
  'jo.view': [1,1,1,1,1], 'jo.create': [1,1,0,0,1], 'jo.edit.request': [1,1,0,0,1], 'jo.edit.work': [1,1,0,1,0], 'jo.delete': [1,1,0,0,0],
  'jo.import': [1,1,0,0,0], 'jo.export': [1,1,1,1,0], 'jo.start': [1,1,0,1,0], 'jo.complete': [1,1,0,1,0],
  'jo.approve': [1,1,1,0,0], 'jo.close': [1,1,1,0,0], 'jo.revert': [1,0,0,0,0],
  // D19 (owner decision 2026-10-10): Department Users download Job Order PDFs only
  'jo.print': [1,1,1,1,1], 'asset.print': [1,1,1,1,0], 'report.print': [1,1,1,1,0],
  // 2026-10-11: own name/email edit only Admin/AE/SE; every role may change its own password
  'profile.edit': [1,1,1,0,0], 'profile.password': [1,1,1,1,1],
};
const CAPS = Object.keys(EXPECT);
for (let i = 0; i < 5; i++) {
  const bad = CAPS.filter(cap => can({ role: ROLES[i] }, cap) !== !!EXPECT[cap][i]);
  t(`T1 ${ROLES[i]}: ${CAPS.length} caps match §6`, bad.length === 0, bad.join(','));
}
const granted = new Set(Object.values(ROLE_CAPS).flat());
t('T1b no role grants a capability outside the §6 list', [...granted].every(c => CAPS.includes(c)), [...granted].filter(c => !CAPS.includes(c)).join(','));
t('T1c exactly the six roles are defined (the five + Viewer, Phase 2B-3)', JSON.stringify(Object.keys(ROLE_CAPS).sort()) === JSON.stringify([...ROLES, 'Viewer'].sort()));
// ---- Phase 2B-3: Viewer = read-only (transcribed independently: view every page/record; nothing else but the own password) ----
const VIEWER_CAPS = ['nav.dashboard', 'nav.assets', 'nav.jobOrders', 'nav.reports', 'nav.pm', 'nav.employees', 'settings.profile',
                     'asset.view', 'pm.view', 'emp.view', 'report.view', 'jo.view', 'profile.password'];
{
  const V = { role: 'Viewer' };
  const bad = CAPS.filter(cap => can(V, cap) !== VIEWER_CAPS.includes(cap));
  t(`VIEWER ${CAPS.length} caps match the read-only grant (${VIEWER_CAPS.length} allowed)`, bad.length === 0, bad.join(','));
  const restricted = CAPS.filter(c => !VIEWER_CAPS.includes(c));
  t('VIEWER no create/edit/delete/import/status/workflow/approval/admin/reset capability', restricted.filter(c => /\.(create|edit|delete|import|status|statusUpdate|start|complete|approve|close|revert|recordService|clearAll|manage|admin|reset)/.test(c)).every(c => !can(V, c)));
  t('VIEWER no PDF download and no CSV/data export capability', ['jo.print', 'asset.print', 'report.print', 'asset.export', 'jo.export', 'pm.export', 'emp.export'].every(c => !can(V, c)));
  t('VIEWER no own-profile edit (name/email); own password change allowed', !can(V, 'profile.edit') && can(V, 'profile.password'));
  t('VIEWER sees every record (no department or section scope)', canSeeAsset(V, { plant: '03 LPG PLANT' }) && canSeeJO(V, { dept: 'HR' }) && !isDeptUser(V));
  t('VIEWER may not open any job-order edit form (mayEditJO false for every status)', ['OPEN', 'IN PROGRESS', 'COMPLETED', 'CLOSED'].every(st => !mayEditJO(V, { status: st, jobNo: 'JO-1', requesterId: 7, dept: 'HR' })));
  t('VIEWER deny by default: look-alike role names get nothing', ['viewer', 'VIEWER', 'Viewer ', ' Viewer', 'Read Only', 'Guest'].every(r => CAPS.every(c => !can({ role: r }, c))));
  t('VIEWER valid role for the account form; normalization removes department/categories/section', validateUserRecord({ role: 'Viewer' }, []) === null
    && (n => !('department' in n) && !('assignedCategories' in n) && !('section' in n))(normalizeUserRecord({ role: 'Viewer', department: 'HR', assignedCategories: ['X'], section: 'Mechanical' })));
  const appV = html.slice(html.indexOf('\nfunction App() {'));
  t('VIEWER UI: both job-order PDF buttons are shown only with jo.print; role option and badge present',
    (appV.match(/\{can\(currentUser,'jo\.print'\)&&<button[^>]*onClick=\{\(\)=>printJOPDF\(jo, currentUser\)\}/g) || []).length === 2
    && !/[^{&(]\s*<button[^>]*onClick=\{\(\)=>printJOPDF\(jo, currentUser\)\}/.test(appV.replace(/\{can\(currentUser,'jo\.print'\)&&<button/g, ''))
    && /<option>Viewer<\/option>/.test(appV) && /role==='Viewer'\?'role-viewer'/.test(appV));
}
t('T1d JCE never has approve/close/revert/delete/import/user admin/reset/create', ['jo.approve','jo.close','jo.revert','jo.delete','jo.import','asset.import','pm.import','users.admin','data.reset','jo.create','jo.edit.request'].every(c => !can({ role: 'Job Card Editor' }, c)));
t('T1e DU has no export, PM, Employees, or any status transition', ['asset.export','jo.export','pm.export','emp.export','nav.pm','nav.employees','pm.view','emp.view','jo.start','jo.complete','jo.approve','jo.close','jo.revert','jo.delete'].every(c => !can({ role: 'Department User' }, c)));

// ---- T2: unknown / malformed roles and users get nothing ----
const BAD = [undefined, null, '', 'admin', 'ADMIN', 'Senior Engineer ', ' Admin', 'department user', 'Job card editor', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 42, {}];
let t2 = 0;
for (const r of BAD) for (const cap of CAPS) if (can({ role: r }, cap)) t2++;
for (const u of [undefined, null, {}, 'Admin', 0]) for (const cap of CAPS) if (can(u, cap)) t2++;
for (const r of ROLES) for (const cap of [undefined, null, '', 'jo.*', 'JO.APPROVE', 'constructor', 'includes']) if (can({ role: r }, cap)) t2++;
t(`T2 ${BAD.length} bad roles, 5 bad users, bad cap names -> false everywhere`, t2 === 0, t2 + ' unexpected grants');

// ---- T3: five roles only — stored extraBundles (legacy/tampered) grant NOTHING (owner decision 2026-10-11) ----
const seB = { role: 'Senior Engineer', extraBundles: ['JOB_CARD_EDITOR', 'X', null, 'constructor', '__proto__'] };
t('T3a SE with a stored JOB_CARD_EDITOR bundle gains no Job Card Editor capability', !can(seB, 'jo.start') && !can(seB, 'jo.complete') && !can(seB, 'jo.edit.work'));
t('T3b SE with a stored bundle has exactly the SE capabilities', CAPS.every(c => can(seB, c) === can({ role: 'Senior Engineer' }, c)));
t('T3c DU / AE / JCE with stored bundles: exactly their role', ['Department User', 'Assistant Engineer', 'Job Card Editor'].every(r => CAPS.every(c => can({ role: r, extraBundles: ['JOB_CARD_EDITOR'] }, c) === can({ role: r }, c))));
t('T3d unknown role + bundle -> nothing', !can({ role: 'x', extraBundles: ['JOB_CARD_EDITOR'] }, 'jo.view') && !can({ role: 'Senior Engineer ', extraBundles: ['JOB_CARD_EDITOR'] }, 'jo.start'));
t('T3e bundle code removed (BUNDLES / NON_GRANTABLE / extraBundles grants)', !/\bBUNDLES\b|NON_GRANTABLE|isNonGrantable|extraBundles\.some/.test(html.slice(a, b)));
t('T3f frozen tables cannot be modified at runtime', (() => { try { vm.runInContext("ROLE_CAPS['Senior Engineer'].push('users.admin'); ROLE_CAPS.X=[1]; DEPARTMENTS.push('Z');", ctx); } catch (e) {} return !can({ role: 'Senior Engineer' }, 'users.admin') && !('X' in ROLE_CAPS) && !DEPARTMENTS.includes('Z'); })());

// ---- T4: legacy records behave like their role ----
let t4 = 0;
for (const r of ROLES) for (const cap of CAPS) {
  const base = can({ role: r }, cap);
  if (can({ id: 3, username: 'u', role: r, active: true }, cap) !== base) t4++;
  if (r !== 'Department User' && can({ role: r, department: 'HR', assignedCategories: ['A'], extraBundles: [] }, cap) !== base) t4++;
}
t('T4 legacy/extra-field records identical to T1', t4 === 0);

// ---- F1 equivalence with the previous UI checks (Admin/AE/SE) ----
const OLD = { NS: r => r !== 'Senior Engineer', AD: r => r === 'Admin', AA: r => r === 'Admin' || r === 'Assistant Engineer', ALL: () => true };
const EQ = [['asset.create','NS'],['asset.import','NS'],['asset.status','NS'],['asset.edit','NS'],['jo.create','NS'],['asset.delete','NS'],['asset.clearAll','AD'],
  ['jo.start','AA'],['jo.complete','AA'],['jo.approve','ALL'],['jo.close','ALL'],['jo.revert','AD'],['jo.delete','NS'],['jo.import','NS'],['users.admin','AD'],['data.reset','AD'],
  ['pm.edit','NS'],['pm.import','NS'],['pm.recordService','NS'],['emp.admin','AD'],['emp.statusUpdate','NS'],
  ['asset.export','ALL'],['jo.export','ALL'],['pm.export','ALL'],['emp.export','ALL'],['nav.pm','ALL'],['nav.employees','ALL']];
const eqBad = EQ.filter(([cap, o]) => R3.some(r => can({ role: r }, cap) !== OLD[o](r)));
t(`EQ ${EQ.length} UI checks identical to pre-F1 behaviour for Admin/AE/SE`, eqBad.length === 0, eqBad.map(x => x[0]).join(','));

// ---- SCOPE: Department User reads (D7) ----
const du = { id: 50, role: 'Department User', department: 'Cement Plant', assignedCategories: ['02 CEMENT PLANT', '10 Batching Plant'] };
const A = plant => ({ num: '1', plant });
t('SCOPE DU sees assets of assigned categories (case-insensitive)', canSeeAsset(du, A('02 CEMENT PLANT')) && canSeeAsset(du, A('10 BATCHING PLANT')) && canSeeAsset(du, A('02 cement plant')));
t('SCOPE DU does not see other categories, blank or missing plant', !canSeeAsset(du, A('03 LPG PLANT')) && !canSeeAsset(du, A('')) && !canSeeAsset(du, {}) && !canSeeAsset(du, null));
t('SCOPE DU sees JOs of exactly its department only', canSeeJO(du, { dept: 'Cement Plant' }) && !canSeeJO(du, { dept: 'cement plant' }) && !canSeeJO(du, { dept: 'Cement Plant ' }) && !canSeeJO(du, { dept: 'HR' }) && !canSeeJO(du, {}) && !canSeeJO(du, null));
t('SCOPE DU without department / categories sees nothing', !canSeeJO({ ...du, department: '' }, { dept: '' }) && !canSeeAsset({ ...du, assignedCategories: [] }, A('02 CEMENT PLANT')) && !canSeeAsset({ ...du, assignedCategories: 'x' }, A('x')));
t('SCOPE every other role sees everything', ROLES.slice(0, 4).every(r => canSeeAsset({ role: r }, A('03 LPG PLANT')) && canSeeJO({ role: r }, { dept: 'HR' })) && canSeeJO(null, {}) && canSeeAsset(undefined, {}));
t('SCOPE isDeptUser only for the exact role', isDeptUser(du) && !isDeptUser({ role: 'department user' }) && !isDeptUser(null));

// ---- mayEditJO (§3.2, D6, D8) ----
const J = (status, extra = {}) => ({ jobNo: 'JO-1', status, dept: 'Cement Plant', requesterId: 50, ...extra });
const ME = [
  ['Admin any non-closed', { role: 'Admin' }, J('COMPLETED'), true], ['Admin closed', { role: 'Admin' }, J('CLOSED'), false],
  ['AE in progress', { role: 'Assistant Engineer' }, J('IN PROGRESS'), true], ['SE open', { role: 'Senior Engineer' }, J('OPEN'), false],
  ['SE with stored bundle: no edit (five roles only)', { role: 'Senior Engineer', extraBundles: ['JOB_CARD_EDITOR'] }, J('IN PROGRESS'), false],
  ['JCE (Mechanical) completed, Mechanical JO', { role: 'Job Card Editor', section: 'Mechanical' }, J('COMPLETED', { section: 'Mechanical' }), true], ['JCE closed', { role: 'Job Card Editor', section: 'Mechanical' }, J('CLOSED', { section: 'Mechanical' }), false],
  ['JCE (Mechanical) on an Electrical JO', { role: 'Job Card Editor', section: 'Mechanical' }, J('IN PROGRESS', { section: 'Electrical' }), false], ['JCE on a JO without section', { role: 'Job Card Editor', section: 'Mechanical' }, J('IN PROGRESS', { section: '' }), false],
  ['JCE section match is case/space-insensitive', { role: 'Job Card Editor', section: 'Mechanical' }, J('IN PROGRESS', { section: ' mechanical ' }), true], ['JCE without own section', { role: 'Job Card Editor' }, J('IN PROGRESS', { section: 'Mechanical' }), false],
  ['DU own OPEN', du, J('OPEN'), true], ['DU own IN PROGRESS', du, J('IN PROGRESS'), false], ['DU own COMPLETED', du, J('COMPLETED'), false],
  ["DU other user's OPEN", du, J('OPEN', { requesterId: 51 }), false], ['DU legacy OPEN (no requesterId)', du, J('OPEN', { requesterId: undefined }), false],
  ['DU own OPEN, other department', du, J('OPEN', { dept: 'HR' }), false], ['unknown role', { role: 'admin' }, J('OPEN'), false], ['no JO', { role: 'Admin' }, undefined, false],
];
for (const [n, u, jo, exp] of ME) t('EDIT ' + n, mayEditJO(u, jo) === exp);

// ---- validateUserRecord / normalizeUserRecord (user form + saveUser) ----
const CATS = ['01 FUEL FARM', '02 CEMENT PLANT', '10 BATCHING PLANT'];
const DUv = { username: 'd', fullName: 'D', role: 'Department User', department: 'Cement Plant', assignedCategories: ['02 CEMENT PLANT'] };
const V = [
  ['valid DU', DUv, null], ['valid Admin', { role: 'Admin' }, null], ['SE + bundle rejected', { role: 'Senior Engineer', extraBundles: ['JOB_CARD_EDITOR'] }, 'not supported'],
  ['JCE without section', { role: 'Job Card Editor' }, 'needs one section'], ['JCE blank section', { role: 'Job Card Editor', section: '   ' }, 'needs one section'], ['valid JCE with section', { role: 'Job Card Editor', section: 'Mechanical' }, null],
  ['JCE free-text section', { role: 'Job Card Editor', section: 'Mech' }, 'needs one section'], ['JCE section wrong case', { role: 'Job Card Editor', section: 'electrical' }, 'needs one section'], ['valid JCE Electrical', { role: 'Job Card Editor', section: 'Electrical' }, null], ['valid JCE Maintenance', { role: 'Job Card Editor', section: 'Maintenance' }, null], ['valid AE empty bundles', { role: 'Assistant Engineer', extraBundles: [] }, null],
  ['DU no department', { ...DUv, department: '' }, 'department'], ['DU department not in list (case)', { ...DUv, department: 'cement plant' }, 'department'],
  ['DU no categories', { ...DUv, assignedCategories: [] }, 'category'], ['DU categories missing', { ...DUv, assignedCategories: undefined }, 'category'],
  ['DU unknown category', { ...DUv, assignedCategories: ['99 NOPE'] }, 'Unknown asset category'], ['DU duplicate category (case)', { ...DUv, assignedCategories: ['02 CEMENT PLANT', '02 cement plant'] }, 'Duplicate'],
  ['DU + editor bundle', { ...DUv, extraBundles: ['JOB_CARD_EDITOR'] }, 'not supported'], ['JCE + editor bundle', { role: 'Job Card Editor', section: 'M', extraBundles: ['JOB_CARD_EDITOR'] }, 'not supported'],
  ['unknown bundle', { role: 'Senior Engineer', extraBundles: ['ADMIN'] }, 'not supported'], ['bundles not an array', { role: 'Senior Engineer', extraBundles: 'JOB_CARD_EDITOR' }, 'not supported'],
  ['unknown role', { role: 'admin' }, 'valid role'], ['missing role', {}, 'valid role'], ['prototype role', { role: '__proto__' }, 'valid role'],
];
for (const [n, u, exp] of V) { const e = validateUserRecord(u, CATS); t('VALID ' + n, exp === null ? e === null : (typeof e === 'string' && e.includes(exp)), e); }
const nSE = normalizeUserRecord({ id: 3, role: 'Senior Engineer', department: 'HR', assignedCategories: ['X'], extraBundles: [], customField: 'keep', password: 'h' });
t('NORM non-DU: department/categories/empty bundles removed; unknown fields and password kept', !('department' in nSE) && !('assignedCategories' in nSE) && !('extraBundles' in nSE) && nSE.customField === 'keep' && nSE.password === 'h' && nSE.id === 3);
const nDU = normalizeUserRecord({ ...DUv, extra: 1 });
t('NORM DU keeps department, categories and unknown fields', nDU.department === 'Cement Plant' && nDU.assignedCategories.length === 1 && nDU.extra === 1);
t('NORM removes extraBundles for every role; section kept (trimmed) only for Job Card Editors', !('extraBundles' in normalizeUserRecord({ role: 'Senior Engineer', extraBundles: ['JOB_CARD_EDITOR'] })) && !('section' in normalizeUserRecord({ role: 'Senior Engineer', section: 'X' })) && normalizeUserRecord({ role: 'Job Card Editor', section: ' Mech ' }).section === 'Mech');
t('NORM does not mutate its input', (() => { const x = { role: 'Admin', department: 'HR' }; normalizeUserRecord(x); return x.department === 'HR'; })());

// ---- T6 (logic): every App() mutation guard, evaluated per role ----
const appA = html.indexOf('\nfunction App() {'), appB = html.indexOf('\nfunction NavItem(');
const app = html.slice(appA, appB);
const G = [...app.matchAll(/\n  (?:async )?function (\w+)\(([^)]*)\) \{\n    if \(!allow\((.*)\)\) (return[^;]*;)\n/g)];
const guardOf = Object.fromEntries(G.map(m => [m[1], { args: m[2], cond: m[3] }]));
const MUT = ['saveUser','deleteUser','resetUserPassword','updateAssetStatus','saveAsset','saveJO','updateJOStatus','deleteAsset','clearAllAssets','deleteJO','approveJO','closeJO','revertJO','saveEmployee','savePMItem','importPMFromCSV','recordPMService','updateEmployeeStatus','deleteEmployee','importEmployeesFromData','fixEmployeeStatusFromDates','resetData','addCustomPlant','renameCustomPlant','importAssetsFromCSV','importJOsFromCSV','changeOwnPassword','applyAssetImport'];
t(`T6a all ${MUT.length} mutations start with an allow() guard`, MUT.every(m => guardOf[m]), MUT.filter(m => !guardOf[m]).join(','));
t('T6b no other App() function is guarded (load-time writes untouched)', G.length === MUT.length, G.map(m => m[1]).filter(n => !MUT.includes(n)).join(','));
function g(m, role, vars = {}, jobOrders = []) {
  const u = role && typeof role === 'object' ? role : { id: 7, role };
  const env = { can, canSeeJO, canSeeAsset, isDeptUser, mayEditJO, currentUser: u, jobOrders, assets: [], ...vars };
  return Function(...Object.keys(env), 'return (' + guardOf[m].cond + ');')(...Object.values(env));
}
const ED = r => r === 'Admin' || r === 'Assistant Engineer', AD = r => r === 'Admin', NONE = () => false;
const EXP6 = [
  ['deleteUser', {}, AD], ['updateAssetStatus', {}, ED], ['saveAsset', { editNum: null }, ED], ['saveAsset', { editNum: '5001' }, ED],
  ['saveJO', { editJobNo: null }, r => ED(r) || r === 'Department User'], ['saveJO', { editJobNo: 'JO-1' }, r => ED(r) || r === 'Job Card Editor' || r === 'Department User'],
  ['updateJOStatus', { status: 'IN PROGRESS', jobNo: 'JO-1' }, r => ED(r) || r === 'Job Card Editor'], ['updateJOStatus', { status: 'COMPLETED', jobNo: 'JO-1' }, r => ED(r) || r === 'Job Card Editor'],
  ['updateJOStatus', { status: 'CLOSED', jobNo: 'JO-1' }, NONE], ['updateJOStatus', { status: 'OPEN', jobNo: 'JO-1' }, NONE], ['updateJOStatus', { status: 'BOGUS', jobNo: 'JO-1' }, NONE],
  ['deleteAsset', {}, ED], ['clearAllAssets', {}, AD], ['deleteJO', { jobNo: 'JO-1' }, ED], ['approveJO', { jobNo: 'JO-1' }, r => R3.includes(r)], ['closeJO', { jobNo: 'JO-1' }, r => R3.includes(r)], ['revertJO', { jobNo: 'JO-1' }, AD],
  ['saveEmployee', {}, AD], ['savePMItem', {}, ED], ['importPMFromCSV', {}, ED], ['recordPMService', {}, ED],
  ['updateEmployeeStatus', {}, ED], ['deleteEmployee', {}, AD], ['importEmployeesFromData', {}, AD], ['fixEmployeeStatusFromDates', {}, AD],
  ['resetData', {}, AD], ['changeOwnPassword', { FORCED_CHANGE_ALLOWED: { forcedChangeAllowed: true } }, () => true],
  ['resetUserPassword', {}, AD], ['applyAssetImport', {}, ED], ['addCustomPlant', {}, ED], ['renameCustomPlant', {}, ED], ['importAssetsFromCSV', {}, ED], ['importJOsFromCSV', {}, ED],
];
let t6 = 0;
for (const [m, vars, exp] of EXP6) for (const r of [...ROLES, 'Viewer']) if (!!g(m, r, vars) !== exp(r)) { t6++; t(`T6 ${m} ${JSON.stringify(vars)} ${r}`, false); }
t(`T6c ${EXP6.length} guard cases x 6 roles match §6 (Viewer: every guard refuses except the own password change)`, t6 === 0);
const su = (role, editId) => !!g('saveUser', { id: 7, role }, { editId });
t('T6d saveUser: Admin add/edit others ok', su('Admin', null) && su('Admin', 3));
t('T6e saveUser: AE and SE may edit only their own profile; JCE and DU may not edit their profile at all (password only)', ['Assistant Engineer', 'Senior Engineer'].every(r => su(r, 7) && !su(r, 3) && !su(r, null)) && ['Job Card Editor', 'Department User'].every(r => !su(r, 7) && !su(r, 3) && !su(r, null)));
t('T6f saveUser: unknown role cannot save any profile', !su('x', 7) && !su('x', 3) && !su('x', null));
let t6g = 0;
for (const [m, vars] of EXP6) for (const r of [undefined, '', 'admin', 'department user']) if (g(m, r, vars)) t6g++;
t('T6g unknown roles pass no mutation guard (except own-profile save)', t6g === 0);
const jos = [{ jobNo: 'JO-1', dept: 'HR', status: 'OPEN' }];
t('T6h JO guards also require the JO to be in scope (DU with another department fails, others pass)',
  !g('deleteJO', du, { jobNo: 'JO-1' }, jos) && g('deleteJO', { role: 'Admin' }, { jobNo: 'JO-1' }, jos) && !g('updateJOStatus', { ...du, role: 'Department User' }, { status: 'IN PROGRESS', jobNo: 'JO-1' }, jos));
t('T6i importEmployeesFromData denial returns {added:0, updated:0}', /return \{added:0, updated:0\};/.test(G.find(m => m[1] === 'importEmployeesFromData')[4]));
const saveJOBody = app.slice(app.indexOf('  async function saveJO('), app.indexOf('  async function updateJOStatus('));
t('T6j job order edit: the browser checks mayEditJO on the STORED record; the server (jo_update) keeps every other section from the stored record (allow-listed fields per role)', /const stored = jobOrders\.find\(j => j\.jobNo===editJobNo\);\n\s*if \(!allow\(!!stored && mayEditJO\(currentUser, stored\)\)\) return;/.test(saveJOBody)
  && /jo := f\.jo \|\| private\.pick\(p_fields, array_remove\(work, 'section'\)\);/.test(sqlFn('jo_update')) && /jo := f\.jo \|\| private\.pick\(p_fields, req\) \|\| jsonb_build_object\('requester', f\.jo -> 'requester', 'dept', f\.jo -> 'dept'\);/.test(sqlFn('jo_update')));
t('T6k job order create by DU: asset in scope + department checked in the browser AND by the server; the server sets department and requester from the profile, blank work sections, OPEN and the numeric requesterId',
  /canSeeAsset\(currentUser, a\) && DEPARTMENTS\.includes\(currentUser\.department\)/.test(saveJOBody) && /if not private\.du_asset_in_scope\(me, p_jo ->> 'assetNum'\)/.test(sqlFn('jo_create'))
  && /jsonb_build_object\('requester', me\.full_name, 'dept', me\.department, 'recvName', ''/.test(sqlFn('jo_create')) && /jsonb_build_object\('jobNo', 'JO-' \|\| n, 'status', 'OPEN', 'requesterId', me\.legacy_id\)/.test(sqlFn('jo_create')));

// ---- T8 static ----
const babel = html.slice(html.indexOf('<script type="text/babel">'));
const roleCmp = [...babel.matchAll(/[^\n]*\brole\s*(===|!==)[^\n]*/g)].map(m => m[0].trim());
const allowedRoleCmp = [/^const cls = role==='Admin'\?'role-admin'/, /^function notificationsFor\(user\) \{ return !!user && user\.role !== 'Viewer' && !mustChangePassword\(user\); \}$/,
  /^const accountFields = u => \(\{fullName: u\.fullName, role: u\.role, department: u\.role === 'Department User' \? u\.department : null,$/, /^assignedCategories: u\.role === 'Department User' \? u\.assignedCategories : null, section: u\.role === 'Job Card Editor' \? u\.section : null\}\);$/, /^if \(!user \|\| typeof user\.role !== 'string' \|\| typeof cap !== 'string'/,
  /^function isDeptUser\(user\) \{ return !!user && user\.role === 'Department User'; \}$/, /^function isJobCardEditor\(user\) \{ return !!user && user\.role === 'Job Card Editor'; \}$/,
  /^if \(u\.role === 'Department User'\) \{$/, /^if \(u\.role === 'Job Card Editor' && !JCE_SECTIONS\.includes\(u\.section\)\)/, /^if \(out\.role !== 'Department User'\) \{ delete out\.department; delete out\.assignedCategories; \}$/,
  /^if \(out\.role !== 'Job Card Editor'\) delete out\.section;/, /^\{f\.role==='Department User'&&\($/, /^\{f\.role==='Job Card Editor'&&\($/];   // helpers, validation and admin-form field display only
t('T8a no role ===/!== permission checks outside can()/scope/validation helpers', roleCmp.every(l => allowedRoleCmp.some(re => re.test(l))), roleCmp.filter(l => !allowedRoleCmp.some(re => re.test(l))).join(' | '));
t('T8b no currentUser.role comparisons', !/currentUser\.role\s*(===|!==|==|!=)/.test(babel));
t('T8c can() used throughout UI + guards', (babel.match(/can\(currentUser,/g) || []).length >= 60, (babel.match(/can\(currentUser,/g) || []).length);
t('T8d no visible*/filtered array passed to queueSave/saveNow/dbSave', !/(queueSave|saveNow|dbSave|persistUsers|persistEmployees)\([^)]*\b(visible\w*|filtered\w*)/.test(babel));
t('T8e allow() defined exactly once, inside App()', (app.match(/function allow\(ok\)/g) || []).length === 1 && (babel.match(/function allow\(ok\)/g) || []).length === 1);
t('T8f pages receive scoped arrays for display; PM/Employees/Settings never receive DU-scoped data', /<DashboardPage assets=\{visibleAssets\} jobOrders=\{visibleJobOrders\}/.test(app) && /<AssetsPage assets=\{visibleAssets\}/.test(app) && /<JobOrdersPage assets=\{visibleAssets\} jobOrders=\{visibleJobOrders\}/.test(app) && /<ReportsPage assets=\{visibleAssets\} jobOrders=\{visibleJobOrders\}/.test(app));
t('T8g exports use the scoped arrays', /exportAssetsCSV\(visibleAssets, currentUser\)/.test(app) && /exportJobOrdersCSV\(visibleJobOrders, currentUser\)/.test(app) && !/exportAssetsCSV\(assets\)|exportJobOrdersCSV\(jobOrders\)/.test(app));


// ---- D19: every download handler checks the user itself, as its first statement ----
t('D19 printJOPDF checks jo.print AND scope first', /function printJOPDF\(jo, user\) \{\n  if \(!can\(user,'jo\.print'\) \|\| !canSeeJO\(user, jo\)\)/.test(html));
t('D19 printAssetPDF checks asset.print AND scope first', /function printAssetPDF\(a, rel, user\) \{\n  if \(!can\(user,'asset\.print'\) \|\| !canSeeAsset\(user, a\)\)/.test(html));
const rp = html.slice(html.indexOf('\nfunction ReportsPage('), html.indexOf('\nfunction ', html.indexOf('\nfunction ReportsPage(') + 5));
t('D19 printReport checks report.print first; ReportsPage only calls it', /function printReport\(kind, assets, jobOrders, user\) \{\n  if \(!can\(user,'report\.print'\)\)/.test(html) && !/openPrintWindow|function dl[A-Z]/.test(rp) && /printReport\(kind, assets, jobOrders, currentUser\)/.test(rp));
t('D19 CSV export handlers check their cap first and filter to scope',
  /function exportAssetsCSV\(assets, user\) \{\n  if \(!can\(user,'asset\.export'\)\)[^\n]*\n  assets = assets\.filter\(a => canSeeAsset\(user, a\)\);/.test(html) &&
  /function exportJobOrdersCSV\(jobOrders, user\) \{\n  if \(!can\(user,'jo\.export'\)\)[^\n]*\n  jobOrders = jobOrders\.filter\(j => canSeeJO\(user, j\)\);/.test(html) &&
  /function exportPMCSV\(pm, user\) \{\n  if \(!can\(user,'pm\.export'\)\)/.test(html) && /function exportEmpsCSV\(\) \{\n    if \(!can\(currentUser,'emp\.export'\)\)/.test(html));
t('D19 every print/export call passes the current user', !/printJOPDF\((jo|previewJO)\)|printAssetPDF\(a,rel\)|export(Assets|JobOrders)CSV\(visible\w+\)|exportPMCSV\(pm\)/.test(babel));

// ---- F5: approval rules (§4) ----
const X5 = ctx.X;
const C = (extra = {}) => ({ jobNo: 'JO-1', status: 'COMPLETED', workDone: 'w', manpower: [{ empId: 'E1', name: 'N', designation: 'D', hours: '2' }], parts: [], legacy: 'keep', ...extra });
const AP = (extra = {}) => C({ approvalStatus: 'APPROVED', approvedBy: 'A', approvedById: 1, approverDesignation: 'X', approvedAt: '2026-10-10T10:00:00.000Z', approvalHistory: [{ event: 'APPROVED', by: 'A', byId: 1, designation: 'X', at: '2026-10-10T10:00:00.000Z' }], ...extra });
t('F5 isApproved only for exactly "APPROVED" (never the free-text approved column)', X5.isApproved(AP()) && !X5.isApproved(C()) && !X5.isApproved(C({ approvalStatus: 'PENDING' })) && !X5.isApproved(C({ approvalStatus: 'approved' })) && !X5.isApproved(C({ approved: 'Boss' })) && !X5.isApproved(null));
t('F5 canApproveJO: COMPLETED and not yet approved (legacy COMPLETED included)', X5.canApproveJO(C()) && X5.canApproveJO(C({ approvalStatus: 'PENDING' })) && !X5.canApproveJO(AP()) && !X5.canApproveJO(C({ status: 'IN PROGRESS' })) && !X5.canApproveJO(C({ status: 'CLOSED' })));
t('F5 canCloseJO: COMPLETED and APPROVED only', X5.canCloseJO(AP()) && !X5.canCloseJO(C()) && !X5.canCloseJO(C({ approvalStatus: 'PENDING' })) && !X5.canCloseJO(AP({ status: 'IN PROGRESS' })) && !X5.canCloseJO(AP({ status: 'CLOSED' })) && !X5.canCloseJO(C({ approved: 'Boss', closedBy: 'x' })));
t('F5 workChanged ignores blank form rows/values', !X5.workChanged({ manpower: undefined, parts: [] }, { manpower: [{ empId: '', name: '', designation: '', hours: '' }], parts: [{ itemCode: '', desc: '', qty: '', unit: '' }], workDone: '' }) && !X5.workChanged(C(), { ...C() }));
t('F5 workChanged detects real changes in sections 4-7 only', X5.workChanged(C(), C({ workDone: 'x' })) && X5.workChanged(C(), C({ manpower: [] })) && X5.workChanged(C(), C({ completionDate: '2026-10-11' })) && !X5.workChanged(C(), C({ problem: 'changed', priority: 'Low', dept: 'HR' })));
const stored5 = AP(), user5 = { id: 9, fullName: 'Editor', role: 'Admin' };
const r1 = X5.resetApprovalIfChanged(stored5, { ...stored5, workDone: 'changed' }, user5);
t('F5 reset: changed completion → PENDING, approver fields removed, RESET appended with reason, history kept', r1.approvalStatus === 'PENDING' && !('approvedBy' in r1) && !('approvedAt' in r1) && r1.approvalHistory.length === 2 && r1.approvalHistory[0].event === 'APPROVED' && r1.approvalHistory[1].event === 'RESET' && r1.approvalHistory[1].reason === 'completion details changed' && r1.approvalHistory[1].byId === 9 && r1.approvalHistory[1].designation === 'Admin Designation' && r1.legacy === 'keep');
t('F5 reset does not mutate the stored record', stored5.approvalStatus === 'APPROVED' && stored5.approvalHistory.length === 1 && stored5.approvedBy === 'A');
const r2 = X5.resetApprovalIfChanged(stored5, { ...stored5, problem: 'request text changed' }, user5);
t('F5 no reset when only sections 1-3 change', r2.approvalStatus === 'APPROVED' && r2.approvedBy === 'A' && r2.approvalHistory.length === 1);
t('F5 no reset for a PENDING or legacy JO', X5.resetApprovalIfChanged(C({ approvalStatus: 'PENDING' }), C({ approvalStatus: 'PENDING', workDone: 'z' }), user5).approvalStatus === 'PENDING' && !('approvalStatus' in X5.resetApprovalIfChanged(C(), C({ workDone: 'z' }), user5)));
const ws = X5.withStoredFields({ jobNo: 'JO-1', status: 'OPEN', approvalStatus: 'APPROVED', approvedBy: 'Forged', closedBy: 'Forged', workDone: 'new', extra: 1 }, C(), X5.JO_CONTROL_FIELDS);
t('F5 withStoredFields: status/approval/closure from the stored record; forged fields removed; other fields kept', ws.status === 'COMPLETED' && !('approvalStatus' in ws) && !('approvedBy' in ws) && !('closedBy' in ws) && ws.workDone === 'new' && ws.extra === 1 && ws.jobNo === 'JO-1');
const ae5 = X5.approvalEvent({ id: 3, fullName: 'Test SE', role: 'Senior Engineer' }, 'APPROVED');
t('F5 approvalEvent shape {event, by, byId, designation, at}', ae5.event === 'APPROVED' && ae5.by === 'Test SE' && ae5.byId === 3 && ae5.designation === 'SE Designation' && /^\d{4}-\d{2}-\d{2}T/.test(ae5.at) && !('reason' in ae5));
t('F5 approve / close / revert / step changes validate the transition in the save layer', /if \(!canApproveJO\(jobOrders\.find/.test(app) && /if \(!canCloseJO\(jobOrders\.find/.test(app) && /only a CLOSED job order can be reverted/.test(app) && /is not a valid step/.test(app));
t('F5 approve never changes status; close never approves; complete sets PENDING (server functions)', /'status', 'COMPLETED', 'approvalStatus', 'PENDING'/.test(sqlFn('jo_set_status'))
  && !/'status',/.test(sqlFn('jo_approve').replace(/f\.jo ->> 'status'/g, '')) && !/'approvalStatus',/.test(sqlFn('jo_close').replace(/f\.jo ->> 'approvalStatus'/g, '')));
t('F5 job order edit: status / closure / approval / assignment never come from the form (not in the allow-lists); a completion change after approval resets it; creates start OPEN',
  ['status', 'closedBy', 'closedDate', 'approvalStatus', 'approvedBy', 'approvalHistory', 'requesterId', 'assignedTo', 'assignedToId', 'jobNo'].every(k => !new RegExp("'" + k + "'").test(sqlFn('jo_update').slice(0, sqlFn('jo_update').indexOf('begin'))))
  && /if f\.jo ->> 'approvalStatus' = 'APPROVED' and private\.work_changed\(f\.jo, jo\) then/.test(sqlFn('jo_update')) && /'status', 'OPEN'/.test(sqlFn('jo_create')));
t('F5 CSV import: only OPEN/IN PROGRESS/COMPLETED, COMPLETED as PENDING, others rejected and listed (browser) and refused again by the server', /const IMPORTABLE = \['OPEN','IN PROGRESS','COMPLETED'\];/.test(app)
  && /if st not in \('OPEN', 'IN PROGRESS', 'COMPLETED'\) then/.test(sqlFn('jo_import')) && /case when st = 'COMPLETED' then jsonb_build_object\('approvalStatus', 'PENDING'\)/.test(sqlFn('jo_import')));

// ---- F5 finalisation: history events, CSV approver, dedicated workflow actions ----
const ceV = X5.approvalEvent({ id: 1, fullName: 'C', role: 'Admin' }, 'CLOSED', '', { closedDate: '2026-01-15' });
t('F5b approvalEvent carries extra data (CLOSED keeps the selected closedDate; at stays automatic)', ceV.event === 'CLOSED' && ceV.closedDate === '2026-01-15' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ceV.at) && ceV.at.slice(0, 10) !== '2026-01-15');
t('F5b closing appends a CLOSED event (with closedDate); revert appends a REVERTED event (server functions)', /private\.approval_event\(me, 'CLOSED', null, jsonb_build_object\('closedDate'/.test(sqlFn('jo_close'))
  && /private\.approval_event\(me, 'REVERTED', 'reverted to COMPLETED', null\)/.test(sqlFn('jo_revert')));
t('F5b approval history is never cleared or replaced (only appended via historyOf)', !/approvalHistory\s*:\s*\[\s*\]/.test(app) && (app.match(/approvalHistory:\[/g) || []).length === (app.match(/approvalHistory:\[\.\.\.historyOf\(j\)/g) || []).length);
// CSV "Approved By" = approver only: run the real export function with a stubbed download
const csvSrc = ['function csvCell(', 'function exportJobOrdersCSV('].map(sig => { const i = html.indexOf(sig); return html.slice(i, html.indexOf('\n}\n', i) + 2); }).join('\n');
const out5 = [];
vm.runInContext(csvSrc + '\nthis.EXP = exportJobOrdersCSV;', ctx); ctx.dlCSV = (c, f) => out5.push({ c, f }); ctx.alert = () => {};
vm.runInContext('var dlCSV = this.dlCSV, alert = this.alert;', ctx);
ctx.EXP([
  { jobNo: 'N1', status: 'CLOSED', approvalStatus: 'APPROVED', approvedBy: 'Real Approver', closedBy: 'The Closer', approved: 'Free Text' },
  { jobNo: 'L1', status: 'CLOSED', closedBy: 'Legacy Combined', closerDesignation: 'X', closedDate: '2026-01-01', approved: 'Imported Text' },
  { jobNo: 'I1', status: 'COMPLETED', approvalStatus: 'PENDING', approved: 'Boss' },
  { jobNo: 'R1', status: 'COMPLETED', approvalStatus: 'PENDING', closedBy: '', approvalHistory: [{ event: 'RESET' }] },
], { role: 'Admin' });
const rows5 = out5.length ? out5[0].c.split('\n') : [];
const hdr5 = (rows5[0] || '').split(','), abIdx = hdr5.indexOf('Approved By');
const col5 = no => { const r = rows5.find(l => l.startsWith('"' + no + '"')); return r ? JSON.parse('[' + r + ']')[abIdx] : undefined; };
t('F5b CSV export: header and column order unchanged ("Approved By" still column 23)', abIdx === 22 && hdr5.length === 26 && out5[0].f === 'joborders_export.csv');
t('F5b CSV "Approved By" = the actual approver; never the closer or imported free text', col5('N1') === 'Real Approver' && col5('L1') === '' && col5('I1') === '' && col5('R1') === '', [col5('N1'), col5('L1'), col5('I1'), col5('R1')]);
t('F5b dedicated workflow actions: JO_CONTROL_FIELDS covers status, closure, approval, history', ['status', 'closedBy', 'closerDesignation', 'closedDate', 'approvalStatus', 'approvedBy', 'approvedById', 'approverDesignation', 'approvedAt', 'approvalHistory'].every(k => X5.JO_CONTROL_FIELDS.includes(k)));

// ---- U1: collapsible sidebar (static) ----
t('U1 one width variable: .sidebar width and .main margin use --sidebar-w', /--sidebar-w:210px;/.test(html) && /\.sidebar\{width:var\(--sidebar-w\);/.test(html) && /\.main\{[^}]*margin-left:var\(--sidebar-w\);/.test(html));
t('U1 no hard-coded sidebar widths left (media queries only change the variable)', !/\.sidebar\{width:\d+px/.test(html) && !/\.main\{[^}]*margin-left:\d+px/.test(html) && /:root\{--sidebar-w:190px;\}/.test(html) && /:root\{--sidebar-w:165px;\}/.test(html));
t('U1 collapsed rules use --sidebar-w-collapsed and hide labels/sections only', /\.layout\.sidebar-collapsed \.sidebar\{width:var\(--sidebar-w-collapsed\);\}/.test(html) && /\.layout\.sidebar-collapsed \.main\{margin-left:var\(--sidebar-w-collapsed\);\}/.test(html) && /\.layout\.sidebar-collapsed \.nav-section,\.layout\.sidebar-collapsed \.nav-label/.test(html));
t('U1 NavItem has title + aria-label = label and a separate label span', /onClick=\{onClick\} title=\{label\} aria-label=\{label\} role="button"/.test(html) && /<span className="nav-label">\{label\}<\/span>/.test(html));
t('U1 state persisted per browser under one key, read safely', /const SIDEBAR_KEY = 'cmms_vg_sidebar';/.test(html) && /try \{ return localStorage\.getItem\(SIDEBAR_KEY\) === '1'; \} catch\(e\) \{ return false; \}/.test(html) && /try \{ localStorage\.setItem\(SIDEBAR_KEY, n \? '1' : '0'\); \} catch\(e\) \{\}/.test(html));


// ---- 2026-10-11: five roles, profile/password, DU repair type, work assignment, scope-lookup fix ----
const Y = ctx.X;
t('R2/2B-3 exactly six roles (five + Viewer); no combined "Senior Engineer + Editor"', JSON.stringify(Object.keys(ROLE_CAPS).sort()) === JSON.stringify(['Admin', 'Assistant Engineer', 'Department User', 'Job Card Editor', 'Senior Engineer', 'Viewer']) && !/Senior Engineer \+ Editor|SE\+bundle/.test(html));
t('R2/2B-3 user form offers exactly the six roles (five + Viewer) and no capability checkbox', (() => { const f = html.slice(html.indexOf('\nfunction UserFormModal('), html.indexOf('\nfunction ', html.indexOf('\nfunction UserFormModal(') + 5)); const opts = [...f.matchAll(/<option>([^<]+)<\/option>/g)].map(m => m[1]); return JSON.stringify(opts) === JSON.stringify(['Admin', 'Assistant Engineer', 'Senior Engineer', 'Job Card Editor', 'Department User', 'Viewer']) && !/Job Card Editor capability|extraBundles/.test(f); })());
t('R2 isEligibleEditor: active Job Card Editor with one of the three sections only', Y.isEligibleEditor({ role: 'Job Card Editor', section: 'Mechanical' }) && Y.isEligibleEditor({ role: 'Job Card Editor', section: 'Electrical', active: true })
  && !Y.isEligibleEditor({ role: 'Job Card Editor', section: 'Mechanical', active: false }) && !Y.isEligibleEditor({ role: 'Job Card Editor', section: ' ' }) && !Y.isEligibleEditor({ role: 'Job Card Editor' }) && !Y.isEligibleEditor({ role: 'Job Card Editor', section: 'Mech' })
  && !Y.isEligibleEditor({ role: 'Assistant Engineer', section: 'Mechanical' }) && !Y.isEligibleEditor({ role: 'Senior Engineer', section: 'Mechanical', extraBundles: ['JOB_CARD_EDITOR'] }) && !Y.isEligibleEditor(undefined) && !Y.isEligibleEditor({ role: 'job card editor', section: 'Mechanical' }));
t('R2/2B-2 validateNewPassword: policy (≥8, upper, lower, number, special), ≤72 BYTES (Supabase Auth limit; refused, never shortened), not 64-hex, differs from current', Y.validateNewPassword('Abcdef1!', 'old') === null && !!Y.validateNewPassword('Abcdefgh', 'old') && !!Y.validateNewPassword('Abcdef1', 'old') && !!Y.validateNewPassword('Abcdefg', 'old') && !!Y.validateNewPassword('short', 'old') && !!Y.validateNewPassword('x'.repeat(129), 'old') && !!Y.validateNewPassword('a'.repeat(64), 'old') && !!Y.validateNewPassword('SamePass1', 'SamePass1') && !!Y.validateNewPassword(undefined, 'x'));
t('R2 DU repair type constant is Unplanned', Y.DU_REPAIR_TYPE === 'Unplanned');
t('R2 assignment fields are workflow-only (edit/create cannot set them)', ['assignedTo', 'assignedToId'].every(k => Y.JO_CONTROL_FIELDS.includes(k)));
const sj = app.slice(app.indexOf('  async function saveJO('), app.indexOf('  async function updateJOStatus('));
t('R2 saveJO rejects a Department User repair type other than Unplanned, on create AND on edit', (sj.match(/if \(jo\.repairType !== DU_REPAIR_TYPE\) \{ addToast\('Department Users can only raise Unplanned repairs\.', true\); return; \}/g) || []).length === 2);
const us = app.slice(app.indexOf('  async function updateJOStatus('), app.indexOf('\n  }\n', app.indexOf('  async function updateJOStatus(')));
t('R2 updateJOStatus: start requires an eligible editor (the own server profile for a JCE, a listed active editor for Admin/AE)', /if \(isJobCardEditor\(currentUser\)\) \{\n\s*if \(!isEligibleEditor\(currentUser\)\)/.test(us) && /const ed = assignment && users\.find\(u => u\.id === assignment\.assigneeId\);\n\s*if \(!isEligibleEditor\(ed\)\)/.test(us));
t('R2 updateJOStatus: assignment and status change are ONE server step (jo_set_status) and nothing else', (us.match(/serverChange\('jo_set_status', \{p_job_no: jobNo, p_status: status, p_assignee_legacy_id: assigneeId\}, \['jobOrders'\]/g) || []).length === 1 && !/queueSave\(|dbSave\(|setJobOrders\(/.test(us));
t('R2 server jo_set_status: Admin/AE: assignee = editor, Received By = acting user, section = editor section; JCE: all self', /'assignedTo', ed\.full_name, 'assignedToId', ed\.legacy_id,\s+'recvName', case when me\.role = 'Job Card Editor' then ed\.full_name else me\.full_name end,/.test(sqlFn('jo_set_status')) && /if me\.role = 'Job Card Editor' then ed := me;/.test(sqlFn('jo_set_status')));
t('R2 BUG FIX: every JO guard looks up the TARGET job order (j.jobNo===jobNo)', !/jobOrders\.find\(j => j\.jobNo\)/.test(app) && (app.match(/canSeeJO\(currentUser, \(jobOrders\.find\(j => j\.jobNo===jobNo\)\)\)/g) || []).length >= 5);
const cp = app.slice(app.indexOf('  async function changeOwnPassword('), app.indexOf('  function deleteUser('));
t('R2 changeOwnPassword: allowed during a forced change; rules checked first; the SERVER verifies the current password, stores the new one and clears the flag; no hash in the browser',
  /if \(!allow\(!!currentUser && can\(currentUser,'profile\.password'\) && FORCED_CHANGE_ALLOWED\)\) return false;/.test(cp) && /const err = validateNewPassword\(newPw, currentPw\);/.test(cp)
  && /await serverFunction\('complete-password-change', \{currentPassword: currentPw, newPassword: newPw\}\)/.test(cp) && !/sha256|dbSave|setUsers/i.test(cp));
t('R2 saveUser self-edit needs profile.edit (Admin/AE/SE)', /editId === currentUser\.id && can\(currentUser,'profile\.edit'\)\)\)\) return null;/.test(app));

// ---- R3: Job Card Editor sections (Electrical, Mechanical, Maintenance) ----
const Z = ctx.X;
t('R3 exactly three sections', JSON.stringify([...Z.JCE_SECTIONS]) === JSON.stringify(['Electrical', 'Mechanical', 'Maintenance']));
const jM = { role: 'Job Card Editor', section: 'Mechanical' }, jE = { role: 'Job Card Editor', section: 'Electrical' };
t('R3 start: OPEN with no section → any editor may start; OPEN with a section → only that section', Z.jceSectionAllows(jM, { status: 'OPEN', section: '' }, 'start') && Z.jceSectionAllows(jE, { status: 'OPEN' }, 'start') && Z.jceSectionAllows(jM, { status: 'OPEN', section: 'Mechanical' }, 'start') && !Z.jceSectionAllows(jM, { status: 'OPEN', section: 'Electrical' }, 'start'));
t('R3 progress/edit: section must match; no section → not theirs', Z.jceSectionAllows(jM, { status: 'IN PROGRESS', section: 'mechanical' }) && !Z.jceSectionAllows(jM, { status: 'IN PROGRESS', section: 'Electrical' }) && !Z.jceSectionAllows(jM, { status: 'IN PROGRESS', section: '' }) && !Z.jceSectionAllows(jM, { status: 'OPEN', section: '' }) && !Z.jceSectionAllows(jE, { status: 'IN PROGRESS', section: 'Maintenance' }) && !Z.jceSectionAllows(jM, null));
t('R3 non-editors are never restricted by sections (Admin, AE, SE, DU)', ['Admin', 'Assistant Engineer', 'Senior Engineer', 'Department User'].every(r => Z.jceSectionAllows({ role: r }, { status: 'IN PROGRESS', section: 'Electrical' }, 'progress')));
const usR3 = app.slice(app.indexOf('  async function updateJOStatus('), app.indexOf('\n  }\n', app.indexOf('  async function updateJOStatus(')));
t('R3 save layer: updateJOStatus checks the section before the server step; mayEditJO (used by saveJO) checks it for edits; the server refuses another section and keeps Section Assigned',
  /if \(!jceSectionAllows\(currentUser, cur, status==='IN PROGRESS' \? 'start' : 'progress'\)\)/.test(usR3) && usR3.indexOf('jceSectionAllows') < usR3.indexOf('serverChange(') && /return canSeeJO\(user, jo\) && jceSectionAllows\(user, jo\);/.test(html)
  && /if not private\.jce_allows\(me, f\.jo, 'edit'\)/.test(sqlFn('jo_update')) && /array_remove\(work, 'section'\)/.test(sqlFn('jo_update')));

// ---- R3: asset import plan (non-destructive) ----
const CATS3 = ['01 FUEL FARM', '02 CEMENT PLANT', '03 LPG PLANT'];
const EX = [{ num: '5001', plant: '01 FUEL FARM', desc: 'Pump', code: 'C1', model: 'M', cap: '', reg: '', eng: '', serial: 'S1', loc: 'Yard', status: 'OPERATIONAL', extra: 'keep-1' },
  { num: '5002', plant: '01 FUEL FARM', desc: 'Valve', code: 'C2', model: 'M', cap: '', reg: '', eng: '', serial: 'S2', loc: 'Yard', status: 'OPERATIONAL', extra: 'keep-2' },
  { num: '7001', plant: '03 LPG PLANT', desc: 'Tank', code: 'C7', model: 'M', cap: '', reg: '', eng: '', serial: 'S7', loc: 'Bay', status: 'OPERATIONAL', extra: 'keep-7' }];
const row = (num, plant, desc, extra = {}) => { const v = [num, plant, desc, extra.code || '', extra.model || '', '', '', '', extra.serial || '', extra.loc || '', extra.status || '']; return v; };
const P = Z.planAssetImport([row('5001', '01 FUEL FARM', 'Pump', { code: 'C1', serial: 'S1', loc: 'Yard', status: 'OPERATIONAL', model: 'M' }), row('05002', '01 fuel farm', 'Valve NEW'), row('5100', '02 CEMENT PLANT', 'New Mixer'), row('', '', ''), row('5101', '01 FUEL FARM', 'New Hose')], EX, CATS3);
t('IMPORT-PLAN classifies new / unchanged / update (key = asset number, leading zeros removed, category case-insensitive)', JSON.stringify(P.added.map(a => a.num)) === '["5100","5101"]' && JSON.stringify(P.unchanged) === '["5001"]' && P.updates.length === 1 && P.updates[0].num === '5002' && P.invalid.length === 0, P);
t('IMPORT-PLAN blank cells never propose erasing a value (only desc changes for 5002)', JSON.stringify(P.updates[0].changes) === JSON.stringify([{ field: 'desc', from: 'Valve', to: 'Valve NEW' }]));
const BADIMP = Z.planAssetImport([row('', '01 FUEL FARM', 'x'), row('5200', '01 FUEL FARM', ''), row('5201', '', 'x'), row('5202', '99 NOPE', 'x'), row('5203', '01 FUEL FARM', 'a'), row('5203', '01 FUEL FARM', 'b'), row('bad num!', '01 FUEL FARM', 'x')], EX, CATS3);
t('IMPORT-PLAN invalid rows: missing number/description/category, unknown category, number twice in the file, bad number', BADIMP.invalid.length === 7 && BADIMP.added.length === 0 && ['missing asset number', 'missing description', 'missing category', 'unknown category', 'more than once', 'invalid asset number'].every(r => BADIMP.invalid.some(x => x.reason.includes(r))), BADIMP.invalid.map(x => x.reason));
const A1 = Z.applyAssetPlan(EX, P, []);
t('IMPORT-APPLY with no update selected: new assets appended, every existing asset (all categories, unknown fields) identical', A1.length === 5 && EX.every(e => JSON.stringify(A1.find(a => a.num === e.num)) === JSON.stringify(e)));
const A2 = Z.applyAssetPlan(EX, P, ['5002']);
t('IMPORT-APPLY selected update changes only the proposed field of 5002; unknown field kept; others identical', A2.find(a => a.num === '5002').desc === 'Valve NEW' && A2.find(a => a.num === '5002').extra === 'keep-2' && A2.find(a => a.num === '5002').serial === 'S2' && ['5001', '7001'].every(n => JSON.stringify(A2.find(a => a.num === n)) === JSON.stringify(EX.find(e => e.num === n))));
t('IMPORT-APPLY does not mutate the input list', EX.find(e => e.num === '5002').desc === 'Valve' && EX.length === 3);
let threw = false; try { Z.applyAssetPlan([...EX, { num: '5100', plant: '02 CEMENT PLANT', desc: 'already there' }], P, []); } catch (e) { threw = /already exists/.test(e.message); }
t('IMPORT-APPLY refuses (throws, nothing returned) if a planned new asset appeared meanwhile', threw);
const imp = app.slice(app.indexOf('  function importAssetsFromCSV('), app.indexOf('  function importJOsFromCSV('));
t('IMPORT save layer: CSV parse only previews (no save); apply blocks invalid files, re-checks the plan, writes once', !/queueSave\(|dbSave\(|setAssets\(/.test(imp.slice(0, imp.indexOf('  function applyAssetImport('))) && /if \(imp\.plan\.invalid\.length\)/.test(imp) && /JSON\.stringify\(planAssetImport\(imp\.rows, assets, customPlants\)\) !== JSON\.stringify\(imp\.plan\)/.test(imp) && (imp.match(/queueSave\('assets', next\)/g) || []).length === 1 && !/queueSave\('jobOrders'/.test(imp));

// ---- AUTH (Phase 2B-1): authentication state, verification and profile, offline with synthetic records ----
(async () => {
  const { signInOutcome, signInEmailFor, normalizeEmployeeId, profileFromRow, signedInState, profileFor, AUTH_SIGNED_OUT, authAdapterFor } = ctx.X;
  const ad = authAdapterFor('staging');
  t('AUTH initial state is signed out (no subject) and frozen', AUTH_SIGNED_OUT.status === 'signed-out' && AUTH_SIGNED_OUT.subject === null && Object.isFrozen(AUTH_SIGNED_OUT));
  t('AUTH Employee ID: exactly 5 letters or digits, trimmed, upper-cased; anything else is no ID (and no request is made)',
    normalizeEmployeeId(' ab123 ') === 'AB123' && ['AB12', 'AB1234', 'AB-12', 'AB 12', 'ÄB123', '', null, undefined].every(x => normalizeEmployeeId(x) === null));
  t('AUTH sign-in address derived from the Employee ID (lower-case) and the configured domain; no domain or bad ID → none',
    signInEmailFor('ab123', 'accounts.example.invalid') === 'ab123@accounts.example.invalid' && signInEmailFor('AB123', null) === null && signInEmailFor('AB123', 'nodot') === null && signInEmailFor('x', 'a.b') === null);
  t('AUTH Supabase Auth answer → result: a session is success; any refusal reads the same ("invalid"); GoTrue text never shown',
    signInOutcome({ data: { session: { access_token: 'a' } } }).ok === true
    && [{ error: { status: 400, message: 'Invalid login credentials' } }, { error: { status: 400, message: 'Email not confirmed' } }, { error: { status: 400, message: 'User is banned' } }, { data: { session: null } }]
      .every(r => JSON.stringify(signInOutcome(r)) === JSON.stringify({ ok: false, reason: 'invalid', message: 'Invalid Employee ID or password. Please try again.' })));
  t('AUTH network / server failure → "unavailable" (connection message); too many attempts → its own message', [null, { error: { status: 0 } }, { error: { status: 503 } }, { error: { name: 'AuthRetryableFetchError' } }].every(r => signInOutcome(r).reason === 'unavailable' && /could not be reached/.test(signInOutcome(r).message))
    && /Too many sign-in attempts/.test(signInOutcome({ error: { status: 429 } }).message));
  const ROW = { user_id: 'u-1', legacy_id: 2, employee_id: 'AB123', full_name: 'Test AE', role: 'Assistant Engineer', active: true, must_change_password: false, recovery_email: 'x@example.invalid', recovery_email_verified_at: null };
  const PR = profileFromRow(ROW);
  t('PROFILE row → app record: numeric legacy id kept as id, Employee ID as sign-in name, flags typed; no password field', PR.id === 2 && PR.employeeId === 'AB123' && PR.username === 'AB123' && PR.must_change_password === false
    && PR.recoveryEmailVerified === false && !('password' in PR) && profileFromRow({ ...ROW, legacy_id: '2' }) === null && profileFromRow(null) === null);
  t('PROFILE a malformed forced-change flag fails closed', profileFromRow({ ...ROW, must_change_password: 'yes' }).must_change_password === false && profileFromRow({ ...ROW, must_change_password: true }).must_change_password === true);
  const st = signedInState(ad, PR);
  t('AUTH signed-in state holds only id/username/adapter/env/time (no role) and is frozen', st.status === 'signed-in' && JSON.stringify(Object.keys(st.subject)) === '["id","username"]' && st.adapter === 'supabase-auth' && !('role' in st) && Object.isFrozen(st));
  t('PROFILE the signed-in user is the SERVER profile of the subject; inactive / other account → none', profileFor(st, PR).role === 'Assistant Engineer' && profileFor(st, { ...PR, active: false }) === null
    && profileFor(st, { ...PR, id: 3 }) === null && profileFor(st, null) === null && profileFor(AUTH_SIGNED_OUT, PR) === null);
  t('PROFILE a state claiming a role still gets the SERVER role', profileFor({ status: 'signed-in', subject: { id: 2, username: 'AB123', role: 'Admin' } }, PR).role === 'Assistant Engineer');
  t('AUTH adapters: production and staging only (Supabase Auth); frozen; anything else none', authAdapterFor('production').name === 'supabase-auth' && authAdapterFor('staging').env === 'staging'
    && Object.isFrozen(authAdapterFor('production')) && ['blocked', undefined, null, '', 'mock', 'local', 'Production'].every(x => authAdapterFor(x) === null));
  const appSrc = html.slice(html.indexOf('function App()'));
  const hl = appSrc.slice(appSrc.indexOf('  async function handleLogin('), appSrc.indexOf('  function handleLogout('));
  t('AUTH app wiring: Supabase Auth password sign-in with the derived address; no request for a malformed ID; the server profile is read; data only without a pending forced change',
    ['const email = signInEmailFor(loginId, SIGN_IN_DOMAIN);', "if (!email || typeof password !== 'string' || !password) return {ok: false, reason: 'invalid', message: SIGN_IN_FAILED};",
     'await sb.auth.signInWithPassword({email, password})', 'const p = await loadProfile();', 'if (!mustChangePassword(p.profile)) loadAll(p.profile);'].every(x => hl.includes(x))
    && appSrc.includes(".from('profiles').select('*').eq('user_id', u.user.id).maybeSingle()") && appSrc.includes('useState(AUTH_SIGNED_OUT)')
    && hl.indexOf('loadAll(p.profile)') > hl.indexOf('const p = await loadProfile();') && hl.indexOf('const p = await loadProfile();') > hl.indexOf('signInWithPassword'));
  t('AUTH production sign-in stays unconfigured until the owner decides the domain (fails closed with a message)', html.includes('const PRODUCTION_SIGN_IN_DOMAIN = null;')
    && hl.includes("if (!SIGN_IN_DOMAIN) return {ok: false, reason: 'unavailable', message: SIGN_IN_NOT_CONFIGURED};"));
  t('AUTH no browser password check of any kind: no hashing, no users list, no hash passthrough', !/sha256|crypto\.subtle\.digest|authVerify|findLoginCandidates|hashPwd|usersFromDb/.test(html.slice(html.indexOf('<script type="text/babel">'))));
  t('AUTH an inactive / missing profile after sign-in ends the session again (no access)', /if \(!p\.profile\) \{\s+writeGate\.signedIn = false;\s+try \{ await sb\.auth\.signOut\(\{scope: 'local'\}\); \} catch\(_\) \{\}/.test(hl));
  // ---- Phase 2B-2: password policy, temporary passwords, Employee ID, forced change (offline, synthetic) ----
  const { validatePassword, passwordProblems, validateNewPassword } = ctx.X;
  const PV = [
    ['valid', 'Abcdef1!', []], ['no uppercase', 'abcdef1!', ['upper']], ['no lowercase', 'ABCDEF1!', ['lower']], ['no number', 'Abcdefg!', ['digit']],
    ['no special', 'Abcdefg1', ['special']], ['space is not special', 'Abcdef1 x', ['special']], ['7 characters', 'Abcd1!x', ['length']],
    ['only letters', 'abcdefgh', ['upper', 'digit', 'special']], ['empty', '', ['empty']], ['not a string', undefined, ['empty']], ['null', null, ['empty']],
    ['73 bytes', 'Aa1!' + 'x'.repeat(69), ['tooLong']], ['72 bytes ok', 'Aa1!' + 'x'.repeat(68), []], ['37 two-byte characters (74 bytes)', 'Aa1!' + 'é'.repeat(35), ['tooLong']], ['unicode special ok', 'Abcdef1€', []],
  ];
  for (const [n, pw, exp] of PV) t('POLICY ' + n, JSON.stringify(passwordProblems(pw)) === JSON.stringify(exp) && (exp.length ? typeof validatePassword(pw) === 'string' : validatePassword(pw) === null), passwordProblems(pw));
  t('POLICY messages name every missing rule; too short mentions "at least 8"', validatePassword('abc').includes('at least 8') && ['uppercase', 'number', 'special'].every(w => validatePassword('abcdefgh').includes(w)));
  t('POLICY change-password validation uses the policy and refuses reuse / 64-hex', validateNewPassword('abcdefgh', 'x') !== null && validateNewPassword('Abcdef1!', 'Abcdef1!') !== null && validateNewPassword('Abcdef1!', 'old') === null && validateNewPassword('a'.repeat(64), 'x') !== null);
  // Temporary passwords: generated ONLY by the server (p2/functions/_shared/policy.mjs); tested there, with the same rules.
  const { generateTempPassword, validatePassword: serverValidate } = await import(require('url').pathToFileURL(require('path').join(__dirname, '..', 'p2', 'functions', '_shared', 'policy.mjs')).href);
  const wc = require('crypto').webcrypto, rnd = n => wc.getRandomValues(new Uint32Array(n));
  const temps = Array.from({ length: 600 }, () => generateTempPassword(rnd));
  t('TEMP (server) 600 generated passwords satisfy the app policy AND the server policy, use only the allowed alphabet',
    temps.every(p => validatePassword(p) === null && serverValidate(p) === null && /^[A-HJ-NP-Za-km-z2-9!@#$%*\-_=+?]+$/.test(p)), temps.find(p => validatePassword(p) !== null) ? 'invalid sample found' : '');
  t('TEMP (server) no duplicates among 600 (secure random source)', new Set(temps).size === temps.length);
  t('TEMP (server) even a degenerate source (all zeros) yields a policy-compliant password', validatePassword(generateTempPassword(n => new Uint32Array(n))) === null);
  t('TEMP the browser generates no password and has no random source for it', !/generateTempPassword|getRandomValues/.test(html.slice(html.indexOf('<script type="text/babel">'))));
  const EU = [{ id: 1, username: 'u_admin', employeeId: 'AB123' }, { id: 2, username: 'CD456' }, { id: 3, username: 'u_three' }];
  const VU = (u, opts) => validateUserRecord({ role: 'Admin', ...u }, [], { users: EU, ...opts });
  t('EMPID required for new accounts only', /Employee ID is required/.test(VU({ username: 'n1' }, { isNew: true })) && VU({ username: 'n1' }, { editId: 3 }) === null);
  t('EMPID format: exactly 5 letters or digits', ['AB12', 'AB1234', 'AB-12', 'AB 12', 'ÄB123'].every(e => /exactly 5/.test(VU({ username: 'n1', employeeId: e }, { isNew: true }))) && VU({ username: 'n1', employeeId: 'xy789' }, { isNew: true }) === null);
  t('EMPID duplicate (case-insensitive) rejected; the account itself may keep its own ID', /already used/.test(VU({ username: 'n1', employeeId: 'ab123' }, { isNew: true })) && VU({ username: 'u_admin', employeeId: 'AB123' }, { editId: 1 }) === null);
  t('EMPID equal to another account\'s username rejected (ambiguous login)', /matches another account's username/.test(VU({ username: 'n1', employeeId: 'cd456' }, { isNew: true })));
  t('USERNAME duplicate rejected; a 5-character username equal to another account\'s Employee ID rejected (ambiguous login)',
    /username is already used/.test(VU({ username: 'u_three', employeeId: 'ZZ001' }, { isNew: true })) && /matches another account's Employee ID/.test(VU({ username: 'ab123', employeeId: 'ZZ002' }, { isNew: true })));
  t('EMPID checks run after the existing role/assignment checks (earlier messages unchanged)', /valid role/.test(validateUserRecord({ role: 'x', employeeId: 'bad' }, [], { users: EU, isNew: true })));
  const nE = normalizeUserRecord({ role: 'Admin', employeeId: ' ab123 ', must_change_password: true, id: 9 }), nB = normalizeUserRecord({ role: 'Admin', employeeId: '  ' });
  t('NORM Employee ID trimmed and upper-cased; blank removed; the forced-change flag and other fields kept', nE.employeeId === 'AB123' && nE.must_change_password === true && nE.id === 9 && !('employeeId' in nB));
  // static wiring (the real App code)
  const appS = html.slice(html.indexOf('\nfunction App() {'), html.indexOf('\nfunction NavItem('));
  const su = appS.slice(appS.indexOf('  async function saveUser('), appS.indexOf('  // ── Recovery links'));
  t('WIRING account administration only through the admin-users server function (create / update / set_active / reset_password); the browser never sets or hashes a password',
    /serverFunction\('admin-users', \{action: 'create', employeeId: user\.employeeId/.test(su) && /serverFunction\('admin-users', \{action: 'update', userId: target\.userId/.test(su)
    && /serverFunction\('admin-users', \{action: 'set_active', userId: target\.userId, active: false\}\)/.test(su) && /serverFunction\('admin-users', \{action: 'reset_password', userId: target\.userId\}\)/.test(su)
    && !/password:/.test(su.replace(/temporaryPassword/g, '')) && !/sha256|dbSave\('users'/.test(su));
  t('WIRING saveUser: Employee ID + uniqueness + role/assignment validated before the server call; the server temporary password is returned once for display',
    /validateUserRecord\(user, customPlants, \{users, editId, isNew: !editId\}\)/.test(su) && /return editId \? null : \{temporaryPassword: res\.body\.temporaryPassword, name: user\.fullName\};/.test(su));
  t('WIRING accounts are deactivated, never deleted; an Admin cannot deactivate or reset their own account', /action: 'set_active', userId: target\.userId, active: false/.test(su) && /Cannot deactivate your own account/.test(su) && /Use Change Password for your own account/.test(su));
  t('WIRING the user form has no password field; the Employee ID is fixed once created; a recovery email can be set', (f => !/type=\{generated|Set password|New Password/.test(f) && /readOnly=\{selfOnly \|\| mode==='edit'\}/.test(f) && /Recovery email \(for password reset\)/.test(f))(html.slice(html.indexOf('function UserFormModal('), html.indexOf('function UserFormModal(') + 6000)));
  t('WIRING forced change: the gate renders instead of the app, and allow() refuses everything but the own password change',
    /if \(mustChangePassword\(currentUser\)\) return \(/.test(appS) && /if \(mustChangePassword\(currentUser\) && ok !== FORCED_CHANGE_ALLOWED\)/.test(appS));
  // ---- Phase 2B-4: session lifecycle (offline, synthetic) ----
  const { isValidAuthState, mustChangePassword, authzFingerprint } = ctx.X;
  const AP = authAdapterFor('staging'), good = { status: 'signed-in', subject: { id: 2, username: 'u_ae' }, adapter: 'supabase-auth', env: 'staging', since: 'x' };
  t('SESSION a well-formed signed-in state of this environment is valid', isValidAuthState(good, AP) === true);
  const BAD = [['null', null], ['string', 'signed-in'], ['signed out', AUTH_SIGNED_OUT], ['status case', { ...good, status: 'Signed-in' }], ['status truthy', { ...good, status: true }],
    ['no subject', { ...good, subject: null }], ['subject string', { ...good, subject: 'u_ae' }], ['id object', { ...good, subject: { id: {}, username: 'u_ae' } }],
    ['id missing', { ...good, subject: { username: 'u_ae' } }], ['username empty', { ...good, subject: { id: 2, username: '' } }], ['username number', { ...good, subject: { id: 2, username: 5 } }],
    ['other env', { ...good, env: 'production' }], ['other adapter', { ...good, adapter: 'appdata' }], ['no adapter field', { ...good, adapter: undefined }], ['array', [good]]];
  for (const [n, st2] of BAD) t('SESSION malformed state denied: ' + n, isValidAuthState(st2, AP) === false);
  t('SESSION no adapter (blocked environment) → every state is invalid', isValidAuthState(good, authAdapterFor('blocked')) === false && isValidAuthState(good, null) === false);
  t('SESSION profileFor rejects a non-object subject', profileFor({ status: 'signed-in', subject: 'u_ae' }, { id: 2, username: 'u_ae', role: 'Admin', active: true }) === null);
  t('FORCED any truthy flag forces a change (fail closed); absent/false does not',
    [true, 1, 'true', 'yes', {}, []].every(v => mustChangePassword({ must_change_password: v })) && [undefined, false, 0, '', null].every(v => !mustChangePassword({ must_change_password: v })) && !mustChangePassword(null));
  const fu = { id: 2, username: 'u_ae', role: 'Assistant Engineer', password: 'h', email: 'x' };
  t('AUTHZ fingerprint changes on role, scope, status and forced-change; empty when signed out',
    authzFingerprint(null) === '' && ['role', 'department', 'section'].every(k => authzFingerprint(fu) !== authzFingerprint({ ...fu, [k]: 'Other' }))
    && authzFingerprint(fu) !== authzFingerprint({ ...fu, assignedCategories: ['A'] }) && authzFingerprint(fu) !== authzFingerprint({ ...fu, active: false })
    && authzFingerprint(fu) !== authzFingerprint({ ...fu, must_change_password: true }) && authzFingerprint(fu) !== authzFingerprint({ ...fu, id: 3 }));
  t('AUTHZ fingerprint ignores the password and contact fields (a password change does not count as a role change)',
    authzFingerprint(fu) === authzFingerprint({ ...fu, password: 'other', email: 'y' }) && !authzFingerprint(fu).includes('"h"'));
  t('STORAGE (N1) no dataset is written to browser storage: the only localStorage writes are the sidebar and theme preferences',
    (html.match(/localStorage\.setItem\(/g) || []).length === 2 && /localStorage\.setItem\(SIDEBAR_KEY,/.test(html) && /localStorage\.setItem\(THEME_KEY, v\)/.test(html));
  t('STORAGE (N1) the only localStorage reads are the theme and sidebar preferences (no dataset is ever read back)',
    (html.match(/localStorage\.getItem\(/g) || []).length === 2 && /localStorage\.getItem\('cmms_vg_theme'\)/.test(html) && /localStorage\.getItem\(SIDEBAR_KEY\)/.test(html));
  t('STORAGE (N1) every legacy data copy (session, users, assets/JOs, PM, employees, categories) is deleted on load',
    /\[SESSION_KEY, USERS_KEY, STORE_KEY, PM_KEY, EMPLOYEES_KEY, CUSTOM_PLANTS_KEY\]\.forEach\(k => localStorage\.removeItem\(k\)\)/.test(appS)
    && ["STORE_KEY = 'cmms_vg_state'", "PM_KEY = 'cmms_vg_pm'", "EMPLOYEES_KEY = 'cmms_vg_employees'", "USERS_KEY = 'cmms_vg_users'", "CUSTOM_PLANTS_KEY = 'cmms_vg_plants'"].every(k => html.includes(k)));
  t('WIRING logout ends the server session, clears every dataset and account read under it, closes every form and returns to the dashboard',
    /function handleLogout\(forced\) \{[^]*?writeGate\.signedIn = false;\s+signedInRef\.current = false;\s+pending\.finally\(\(\) => \{ if \(sb\) sb\.auth\.signOut\(\)\.catch\(\(\) => \{\}\); \}\);[^\n]*\s+setAuth\(AUTH_SIGNED_OUT\); setProfile\(null\); setUsers\(\[\]\);\s+(\/\/[^\n]*\s+)?setAssets\(\[\]\); setJobOrders\(\[\]\); setPM\(\[\]\); setEmployees\(\[\]\); setCustomPlants\(\[\]\);\s+writableKeys\.clear\(\); isLoaded\.current = false; setDbLoaded\(false\); setLoadIssue\(null\); setDeferredFix\(\{employees: false\}\);\s+setAssetModal\(null\); setJoModal\(null\); setJoViewModal\(null\); setAssetImport\(null\);[^\n]*\s+setPage\('dashboard'\);/.test(appS));
  t('WIRING a session ended on the server (expired/revoked) or a deactivated account signs the app out', /if \(event === 'SIGNED_OUT' && signedInRef\.current\) \{ handleLogout\(true\);/.test(appS) && /if \(r\.gone\) \{ handleLogout\(true\); addToast\('Your account is no longer active/.test(appS));
  t('WIRING an authorization change closes forms, leaves pages the role cannot see, and re-mounts the page area',
    /const authzKey = authzFingerprint\(currentUser\);/.test(appS) && /\}, \[authzKey\]\);/.test(appS) && /<div className="main" key=\{authzKey\}>/.test(appS));
  t('WIRING the Users tab renders only while the CURRENT user may administer users', /\{tab==='users' && canAdminUsers && \(/.test(html));
  t('WIRING no browser storage of passwords anywhere: no sessionStorage, no cookies, no IndexedDB',
    !/sessionStorage\.setItem|document\.cookie\s*=|indexedDB\.open/.test(html));
  // ---- N1: safe initialization (planDataLoad), per-dataset saves, print escaping (offline, synthetic) ----
  const { planDataLoad, escHtml } = ctx.X;
  const R = (k, v) => ({ key: k, value: v });
  const KEYS5 = ['assets', 'jobOrders', 'pm', 'employees', 'customPlants'], FULL = KEYS5.map(k => R(k, []));
  const { datasetsFor } = ctx.X;
  t('LOAD read error → fail', planDataLoad({ data: null, error: { message: 'x' } }).action === 'fail' && planDataLoad({ data: FULL, error: { message: 'x' } }).reason === 'failed');
  t('LOAD unusable responses → fail', [undefined, null, 'x', {}, { data: 'rows' }, { data: {} }].every(r => planDataLoad(r).action === 'fail'));
  t('LOAD zero rows → fail "empty"; the browser never seeds (whatever options are passed)', planDataLoad({ data: [] }).reason === 'empty' && planDataLoad({ data: [] }, { envName: 'staging', seedOptIn: true }).action === 'fail'
    && planDataLoad({ data: [R('__environment', { env: 'staging' })] }, { envName: 'staging', seedOptIn: true }).action === 'fail');
  const full = planDataLoad({ data: FULL }, { expected: KEYS5 });
  t('LOAD all five datasets → load, all writable, none missing (accounts are not a dataset)', full.action === 'load' && full.loaded.length === 5 && !full.missing.length && !full.invalid.length);
  const part = planDataLoad({ data: FULL.filter(r => r.key !== 'pm') }, { expected: KEYS5 });
  t('LOAD missing datasets → partial; only the datasets read are writable', part.action === 'partial' && JSON.stringify(part.missing) === '["pm"]' && !part.loaded.includes('pm') && part.loaded.includes('assets'));
  const bad = planDataLoad({ data: FULL.map(r => r.key === 'assets' ? R('assets', null) : r.key === 'employees' ? R('employees', { a: 1 }) : r) }, { expected: KEYS5 });
  t('LOAD malformed dataset values (null, object) → partial, reported as invalid, NOT writable', bad.action === 'partial' && JSON.stringify(bad.invalid) === '["assets","employees"]' && !bad.loaded.includes('assets'));
  t('LOAD rows with only unknown keys or only malformed values → fail "empty"', planDataLoad({ data: [R('other', [])] }).reason === 'empty' && planDataLoad({ data: [R('assets', 'x')] }).reason === 'empty');
  t('LOAD a users row is never a dataset (ignored even if a server sent one)', !planDataLoad({ data: [...FULL, R('users', [{ id: 1 }])] }, { expected: KEYS5 }).loaded.includes('users'));
  t('LOAD Department User reads assets, job orders (scoped server lists) and categories only; every other role all five', JSON.stringify(datasetsFor({ role: 'Department User' })) === '["assets","jobOrders","customPlants"]'
    && ['Admin', 'Assistant Engineer', 'Senior Engineer', 'Job Card Editor', 'Viewer'].every(r => JSON.stringify(datasetsFor({ role: r })) === JSON.stringify(KEYS5)));
  const rd = html.slice(html.indexOf('async function readDatasets('), html.indexOf('// N2: JSON with sorted object keys.'));
  t('WIRING Department Users read assets / job orders ONLY through the server scoped lists', /const scoped = \{assets: 'asset_list', jobOrders: 'jo_list'\};/.test(rd) && /sb\.rpc\(scoped\[k\]\)/.test(rd) && /sb\.from\('app_data'\)\.select\('key,value'\)\.in\('key', direct\)/.test(rd));
  const evil = '<img src=x onerror="alert(1)">&\'<script>x</script>';
  t('ESC escapes & < > " \' and leaves plain text unchanged', escHtml(evil) === '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;&lt;script&gt;x&lt;/script&gt;' && escHtml('Pump 3/4 — 25T') === 'Pump 3/4 — 25T' && escHtml(null) === '' && escHtml(0) === '0');
  // static wiring
  const dbS = html.slice(html.indexOf('async function dbSave('), html.indexOf('const MSG_NO_PERMISSION'));
  t('WIRING dbSave: only assets / PM / categories, only datasets read after this sign-in, only as an UPDATE of the existing row, "saved" only when the server returns that row',
    /if \(!DIRECT_WRITE_KEYS\.includes\(key\)\) \{[^}]*return new Error/.test(dbS) && /if \(!writableKeys\.has\(key\)\) \{[^}]*return new Error/.test(dbS)
    && /sb\.from\('app_data'\)\.update\(\{value, updated_at: new Date\(\)\.toISOString\(\)\}\)\.eq\('key', key\)\.select\('key'\)/.test(dbS) && /if \(!Array\.isArray\(data\) \|\| data\.length !== 1\)/.test(dbS) && !/upsert|insert/.test(dbS));
  t('WIRING no upsert, insert or delete of app_data anywhere in the app', !/\.upsert\(|\.insert\(|\.delete\(\)/.test(html.slice(html.indexOf('<script type="text/babel">'))));
  const ld = appS.slice(appS.indexOf('  async function loadAll('), appS.indexOf('  // Re-reads datasets after a server change'));
  t('WIRING load: a failed or empty read shows the failure screen and changes nothing', /if \(plan\.action === 'fail'\) \{ setLoadIssue\(\{kind: plan\.reason\}\);/.test(ld) && /if \(loadIssue && loadIssue\.kind !== 'partial'\) return \(/.test(appS));
  t('WIRING load: only the datasets read become changeable; unread lists are shown empty, never built-in data', /plan\.loaded\.forEach\(k => writableKeys\.add\(k\)\)/.test(ld) && /expected\.filter\(k => !plan\.loaded\.includes\(k\)\)\.forEach\(k => applyDataset\(k, \[\]\)\)/.test(ld) && !/BASE_ASSETS/.test(html));
  t('WIRING load (N2): the load path changes NOTHING; corrections are deferred; no localStorage', !/dbSave\(|saveNow\(|queueSave\(|serverChange\(|employee_apply/.test(ld)
    && /if \(stableJson\(fixed\) !== stableJson\(value\)\) setDeferredFix\(f => \(\{\.\.\.f, employees: true\}\)\);/.test(appS) && !/localStorage/.test(ld));
  // ---- N2: no writes before sign-in, deferred corrections, realtime conflicts (offline, synthetic) ----
  const { stableJson, realtimeAction } = ctx.X;
  t('STABLE key order does not matter; nested objects and arrays; undefined fields ignored like JSON',
    stableJson({ b: 1, a: [{ y: 2, x: 'é' }] }) === stableJson({ a: [{ x: 'é', y: 2 }], b: 1 }) && stableJson([1, 2]) !== stableJson([2, 1]) && stableJson({ a: 1, u: undefined }) === stableJson({ a: 1 }) && stableJson(null) === 'null');
  const mine = [{ jobNo: 'JO-1', status: 'OPEN', dept: 'X' }], recent = [stableJson(mine)];
  t('REALTIME our own write coming back (any key order) is an echo, with or without a waiting change', realtimeAction([{ dept: 'X', status: 'OPEN', jobNo: 'JO-1' }], false, recent) === 'echo' && realtimeAction(mine, true, recent) === 'echo');
  t('REALTIME another change while a local change of that dataset is waiting → conflict (the waiting change must not overwrite it)', realtimeAction([{ jobNo: 'JO-1', status: 'CLOSED' }], true, recent) === 'conflict');
  t('REALTIME another change with nothing waiting → apply; no history → apply', realtimeAction([{ jobNo: 'JO-2' }], false, recent) === 'apply' && realtimeAction([], false, undefined) === 'apply');
  const dbS2 = html.slice(html.indexOf('async function dbSave('), html.indexOf('const MSG_NO_PERMISSION'));
  t('WIRING (N2) dbSave and every server call refuse while nobody is signed in, before anything else', /if \(!writeGate\.signedIn\) \{[^}]*return new Error\('not signed in'\); \}\s+if \(!DIRECT_WRITE_KEYS\.includes\(key\)\)/.test(dbS2)
    && /const writeGate = \{signedIn: false\};/.test(html) && /async function serverCall\(fn, args\) \{\s+if \(!sb \|\| !envReady \|\| !writeGate\.signedIn\) return \{error/.test(html));
  t('WIRING (N2) the gate follows the signed-in profile, stays closed during a forced change, and is closed on every sign-out', /useEffect\(\(\) => \{ writeGate\.signedIn = signedInId !== null; \}, \[signedInId\]\);/.test(appS)
    && /const signedInId = currentUser && !mustChangePassword\(currentUser\) \? currentUser\.id : null;/.test(appS));
  t('WIRING (N2) deferred employee-status correction: only emp.statusUpdate, by the SERVER (employee_apply_date_rules), never during a forced change (signedInId is null then)',
    /if \(!currentUser \|\| !deferredFix\.employees \|\| !can\(currentUser,'emp\.statusUpdate'\) \|\| !writableKeys\.has\('employees'\)\) return;/.test(appS) && /serverCall\('employee_apply_date_rules'\)/.test(appS) && !/deferredFix\.users/.test(appS));
  t('WIRING (N2) normal sign-out writes what is waiting first; a forced sign-out (deactivated / session ended) discards it with a message',
    /if \(forced === true\) \{[^\n]*pendingSaves\.current = \{\}; if \(k\.length\) addToast\(unsavedMsg\(k\), true\); \}\s+else pending = runBatch\(\);\s+writeGate\.signedIn = false;/.test(appS) && /handleLogout\(true\); addToast\('Your account is no longer active/.test(appS));
  t('WIRING (N2) realtime: echo ignored; conflict drops the waiting change with a message, then shows the newer data',
    /const act = realtimeAction\(row\.value, row\.key in pendingSaves\.current, recentWrites\[row\.key\]\);\s+if \(act === 'echo'\) return;\s+if \(act === 'conflict'\) \{\s+delete pendingSaves\.current\[row\.key\];/.test(appS) && /\(recentWrites\[key\] = \(recentWrites\[key\] \|\| \[\]\)\.slice\(-4\)\)\.push\(stableJson\(value\)\);/.test(html));
  // ---- 2026-10-14: login redesign (circuit), recovery UI, notification UI gating (offline, synthetic) ----
  const { circuitTraces, recoveryStep, recoveryLinkKind, RECOVERY_MESSAGES, RECOVERY_SERVICE, unreadCount, NOTIFY_EVENT_LABEL, parseRecoveryLink, notificationsFor } = ctx.X;
  const inside = (p, S) => p[0] > S.l + 0.5 && p[0] < S.r - 0.5 && p[1] > S.t + 0.5 && p[1] < S.b - 0.5;
  const pts = d => { const out = []; let x = 0, y = 0; for (const m of d.matchAll(/([MHVL])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) { const c = m[1], a = +m[2], b = m[3] != null ? +m[3] : null;
    const nx = c === 'H' ? a : c === 'V' ? x : a, ny = c === 'H' ? y : c === 'V' ? a : b; if (c !== 'M') for (let k = 1; k <= 20; k++) out.push([x + (nx - x) * k / 20, y + (ny - y) * k / 20]); else out.push([nx, ny]); x = nx; y = ny; } return out; };
  const SIZES = [[1440, 900, { l: 913, t: 250, r: 1305, b: 650 }], [1920, 1080, { l: 1282, t: 320, r: 1674, b: 760 }], [1024, 768, { l: 573, t: 190, r: 965, b: 590 }], [390, 980, { l: 16, t: 300, r: 374, b: 760 }]];   // card centred in the right panel (54/46 split, panel >= 510px), as the real layout
  const lays = SIZES.map(([w, h, c]) => ({ w, h, c, L: circuitTraces(w, h, c) }));
  t('CIRCUIT traces converge on the card from every side that has room (desktop: left, top, bottom; right where the margin allows; ≥ 12 traces)', lays.slice(0, 3).every(({ w, c, L }) => L.traces.length >= 12 && ['left', 'top', 'bottom', ...(w - c.r - 16 > 50 ? ['right'] : [])].every(s => L.traces.some(x => x.side === s)) && (w - c.r - 16 > 50 || !L.traces.some(x => x.side === 'right'))), lays.map(x => x.L.traces.length));
  t('CIRCUIT every trace starts on the page edge and ends on the socket around the card (16px outside the card)',
    lays.every(({ w, h, c, L }) => L.socket.l === c.l - 16 && L.socket.r === c.r + 16 && L.traces.every(x => (x.start[0] === 0 || x.start[0] === w || x.start[1] === 0 || x.start[1] === h)
      && ((x.side === 'left' && x.pad[0] === L.socket.l) || (x.side === 'right' && x.pad[0] === L.socket.r) || (x.side === 'top' && x.pad[1] === L.socket.t) || (x.side === 'bottom' && x.pad[1] === L.socket.b)))));
  t('CIRCUIT no trace crosses the card or the socket interior, and all points stay on the page', lays.every(({ w, h, L }) => L.traces.every(x => pts(x.d).every(p => !inside(p, L.socket) && p[0] >= -0.5 && p[0] <= w + 0.5 && p[1] >= -0.5 && p[1] <= h + 0.5))));
  const segs = d => { const out = []; let x = 0, y = 0; for (const m of d.matchAll(/([MHVL])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) { const c = m[1], a = +m[2], b = m[3] != null ? +m[3] : null;
    const nx = c === 'H' ? a : c === 'V' ? x : a, ny = c === 'H' ? y : c === 'V' ? a : b; if (c !== 'M') out.push([x, y, nx, ny]); x = nx; y = ny; } return out; };
  t('CIRCUIT board routing: every segment is horizontal, vertical or exactly 45°', lays.every(({ L }) => L.traces.every(x => segs(x.d).every(([ax, ay, bx, by]) => Math.abs(ax - bx) < 0.05 || Math.abs(ay - by) < 0.05 || Math.abs(Math.abs(bx - ax) - Math.abs(by - ay)) < 0.25))));
  const cross = (p, q) => { const [a, b, c, d] = p, [e, f, g, h2] = q; const den = (c - a) * (h2 - f) - (d - b) * (g - e); if (Math.abs(den) < 1e-9) return false;
    const u = ((e - a) * (h2 - f) - (f - b) * (g - e)) / den, v = ((e - a) * (d - b) - (f - b) * (c - a)) / den; return u > 0.001 && u < 0.999 && v > 0.001 && v < 0.999; };
  const crossings = L => { let n = 0; for (let i = 0; i < L.traces.length; i++) for (let j = i + 1; j < L.traces.length; j++) for (const p of segs(L.traces[i].d)) for (const q of segs(L.traces[j].d)) if (cross(p, q)) n++; return n; };
  t('CIRCUIT no two traces cross each other (nested fan-in), at every size', lays.every(({ L }) => crossings(L) === 0), lays.map(({ L }) => crossings(L)));
  t('CIRCUIT stacked layout (topBound): no top traces and nothing above the introduction\'s bottom edge', (L => !L.traces.some(x => x.side === 'top') && L.traces.every(x => pts(x.d).every(p => p[1] >= 299.5)))(circuitTraces(820, 1000, { l: 214, t: 420, r: 606, b: 880 }, 7, { topBound: 300 })));
  // ---- light flow: in on the left, hidden behind the card, out on the right (signalSchedule / keyframes) ----
  const { signalSchedule, signalKeyframes, glowKeyframes } = ctx.X;
  const plen = d => segs(d).reduce((s, [a, b, c, e]) => s + Math.hypot(c - a, e - b), 0);
  const flows = lays.map(({ L }) => { const lens = L.traces.map(x => plen(x.d)); return { L, lens, S: signalSchedule(L.traces, lens, L.socket.r - L.socket.l) }; });
  t('FLOW every right trace continues a left trace that ends on the SAME pad row (aligned in/out), at every size with room on the right',
    flows.every(({ L, S }) => L.traces.every((x, i) => x.side !== 'right' || (S[i].dir === 'out' && S[i].pair !== null && L.traces[S[i].pair].side === 'left' && L.traces[S[i].pair].pad[1] === x.pad[1] && S[S[i].pair].pair === i)))
    && flows.slice(0, 2).every(({ L }) => L.traces.some(x => x.side === 'right')));
  t('FLOW a pair shares duration and delay (one connected flow); the light leaves the right pad exactly when it would have crossed the card',
    flows.every(({ L, S }) => S.every((s, i) => s.pair === null || (S[s.pair].duration === s.duration && S[s.pair].delay === s.delay)))
    && flows.every(({ L, S }) => S.every((s, i) => s.dir !== 'out' || s.pair === null || Math.abs((s.from - S[s.pair].to) * s.duration - (L.socket.r - L.socket.l) / s.speed) < 1e-6)));
  t('FLOW one constant speed: in-travel, hidden transit and out-travel all at the same px/s on every trace',
    flows.every(({ L, lens, S }) => S.every((s, i) => Math.abs(lens[i] / ((s.to - s.from) * s.duration) - s.speed) < 1e-6)) && new Set(flows.flatMap(f => f.S.map(s => s.speed))).size === 1);
  t('FLOW top/bottom (and left without a right partner) run in only; nothing runs in on the right', flows.every(({ L, S }) => L.traces.every((x, i) => x.side === 'right' ? S[i].dir === 'out' : S[i].dir === 'in' && S[i].from === 0)));
  const kfOk = (k, len, dash) => k.every((f, i) => i === 0 || f.offset >= k[i - 1].offset) && k[0].offset === 0 && k[k.length - 1].offset === 1;
  const hiddenAt = (off, len, dash) => (-off >= len - 0.01) || (dash - off <= 0.01);   // the dash lies entirely beyond an end of the path
  t('FLOW keyframes: ordered 0..1; outside its travel window each signal is invisible (no flash, never anything drawn over the card)',
    flows.every(({ lens, S }) => S.every((s, i) => { const k = signalKeyframes(s, lens[i], 26); return kfOk(k) && hiddenAt(k[0].strokeDashoffset, lens[i], 26) && hiddenAt(k[1].strokeDashoffset, lens[i], 26) && hiddenAt(k[2].strokeDashoffset, lens[i], 26) && hiddenAt(k[3].strokeDashoffset, lens[i], 26); })));
  t('FLOW direction: "in" moves edge → pad (offset decreases), "out" moves pad → edge (offset increases)', flows.every(({ lens, S }) => S.every((s, i) => { const k = signalKeyframes(s, lens[i]); return s.dir === 'in' ? k[2].strokeDashoffset < k[1].strokeDashoffset : k[2].strokeDashoffset > k[1].strokeDashoffset; })));
  t('FLOW pad glow peaks on arrival (left/top/bottom) and on departure (right), same base and peak brightness everywhere',
    flows.every(({ S }) => S.every(s => { const g = glowKeyframes(s); const pk = g.reduce((m, f) => f.opacity > m.opacity ? f : m); return kfOk(g) && Math.abs(pk.offset - (s.dir === 'in' ? s.to : s.from)) < 1e-9 && pk.opacity === 0.85 && g[0].opacity === 0.12; })));
  t('CIRCUIT mobile (card spans the width): no side traces where there is no room, top/bottom traces still converge', (L => !L.traces.some(x => x.side === 'left' || x.side === 'right') && L.traces.some(x => x.side === 'top') && L.traces.some(x => x.side === 'bottom'))(lays[3].L));
  t('CIRCUIT deterministic for the same size and seed (no layout jumping between renders)', JSON.stringify(circuitTraces(1440, 900, SIZES[0][2])) === JSON.stringify(lays[0].L) && JSON.stringify(circuitTraces(1440, 900, SIZES[0][2], 99)) !== JSON.stringify(lays[0].L));
  t('RECOVERY offered only where Supabase Auth sign-in is configured (no sign-in domain → no recovery service, e.g. production until decision D4)', RECOVERY_SERVICE === null && /const RECOVERY_SERVICE = typeof SIGN_IN_DOMAIN === 'string' && SIGN_IN_DOMAIN \? Object\.freeze\(\{\s+requestReset: async employeeId => \{ const r = await serverFunction\('request-recovery', \{employeeId\}\);/.test(html));
  const R0 = { phase: 'idle', message: '' };
  t('RECOVERY validation: empty and malformed Employee IDs are refused before anything else', recoveryStep(R0, { type: 'submit', employeeId: ' ' }).message === RECOVERY_MESSAGES.empty
    && ['ABCD', 'ABCDEF', 'AB-12', 't_admin'].every(id => recoveryStep(R0, { type: 'submit', employeeId: id, serviceAvailable: true }).phase === 'invalid'));
  t('RECOVERY without a backend: a valid ID gives the honest "not available yet" state (no request is made)', (r => r.phase === 'unavailable' && /not available yet/.test(r.message) && /administrator/.test(r.message))(recoveryStep(R0, { type: 'submit', employeeId: 'ab12c', serviceAvailable: false })));
  t('RECOVERY with a backend: sending, then ONE uniform message for every outcome (no enumeration); only a network failure differs',
    recoveryStep(R0, { type: 'submit', employeeId: 'AB12C', serviceAvailable: true }).phase === 'sending' && recoveryStep(R0, { type: 'result', ok: true }).message === RECOVERY_MESSAGES.sent
    && /If an account/.test(RECOVERY_MESSAGES.sent) && recoveryStep(R0, { type: 'result', ok: false }).phase === 'error' && recoveryStep({ phase: 'sent' }, { type: 'reset' }).phase === 'idle');
  t('RECOVERY links: recovery tokens, errors and verification links are recognised; ordinary fragments are not',
    recoveryLinkKind('#access_token=x&type=recovery') === 'recovery' && recoveryLinkKind('#type=recovery') === 'recovery' && recoveryLinkKind('#error_code=otp_expired') === 'recovery'
    && recoveryLinkKind('#verify-email=abc') === 'verify-email' && recoveryLinkKind('') === null && recoveryLinkKind('#section-2') === null);
  t('RECOVERY wiring: the link is read once, the fragment is removed at once (history.replaceState); tokens are never stored', /const l = parseRecoveryLink\(window\.location\.hash\); if \(l\) history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.search\);/.test(appS) && !/(localStorage|sessionStorage)\.setItem\([^)]*(hash|token|link)/i.test(html));
  t('RECOVERY link parsing: a reset link carries its tokens; an expired / errored / incomplete link is an error; a verification link carries its token; ordinary fragments are nothing',
    (r => r.kind === 'recovery' && r.error === null && r.accessToken === 'A' && r.refreshToken === 'R')(parseRecoveryLink('#access_token=A&refresh_token=R&type=recovery'))
    && parseRecoveryLink('#error=access_denied&error_code=otp_expired').error === 'expired' && parseRecoveryLink('#access_token=A&type=recovery').error === 'invalid' && parseRecoveryLink('#access_token=A&refresh_token=R&type=signup').error === 'invalid'
    && parseRecoveryLink('#verify-email=tok123').verifyToken === 'tok123' && parseRecoveryLink('#section-2') === null && parseRecoveryLink('') === null);
  const rec = appS.slice(appS.indexOf('  async function completeRecovery('), appS.indexOf('  // ── Permission guard'));
  t('RECOVERY completion: a reset link sets the password through complete-recovery (no current password, server checks the link session); the link session is ended afterwards; verification through verify-recovery-email',
    /await sb\.auth\.setSession\(\{access_token: link\.accessToken, refresh_token: link\.refreshToken\}\)/.test(rec) && /serverFunction\('complete-recovery', \{newPassword: newPw\}\)/.test(rec)
    && rec.indexOf("sb.auth.signOut({scope: 'local'})") > rec.indexOf("serverFunction('complete-recovery'") && /serverFunction\('verify-recovery-email', \{token: link\.verifyToken\}\)/.test(rec) && /const err = validatePassword\(newPw\);/.test(rec));
  t('NOTIFY UI: every signed-in role except Viewer; none during a forced change or when signed out', ['Admin', 'Assistant Engineer', 'Senior Engineer', 'Job Card Editor', 'Department User'].every(r => notificationsFor({ role: r }))
    && !notificationsFor({ role: 'Viewer' }) && !notificationsFor({ role: 'Admin', must_change_password: true }) && !notificationsFor(null));
  t('NOTIFY UI: the bell reads only the caller\'s own list and marks only its own items (no recipient is ever sent); no local mock path', /serverCall\('my_notifications', \{p_limit: 50\}\)/.test(html) && /serverCall\('notification_mark_read', \{p_ids: ids\}\)/.test(html)
    && !/local_mock_notifications|p_recipient|notificationMode|notificationsMock/.test(html) && /\{notificationsFor\(currentUser\) && <NotificationBell /.test(html));
  t('NOTIFY UI: unread count; event labels for the four lifecycle events', unreadCount([{ read: false }, { read: true }, {}, null]) === 2 && unreadCount(undefined) === 0 && Object.keys(NOTIFY_EVENT_LABEL).join() === 'OPEN,IN_PROGRESS,COMPLETED,CLOSED');
  t('LOGIN wiring: Employee ID sign-in texts; the forgot-password link and the temporary-password note exist; no "connecting to the database" before sign-in (nothing is read then)',
    /setError\('Please enter your Employee ID and password\.'\)/.test(html) && /'Invalid Employee ID or password\. Please try again\.'/.test(html) && /<label htmlFor="login-username">Employee ID<\/label>/.test(html) && /Forgot password\?/.test(html)
    && !/Connecting to the CMMS database/.test(html) && /temporary password you were given/.test(html));
  t('WIRING (N2) a change before the data is loaded is never dropped silently', /if \(!isLoaded\.current\) \{ addToast\(unsavedMsg\(\[key\]\), true\); return; \}/.test(appS));
  t('WIRING realtime never fills in a dataset that was not loaded', /if \(!isLoaded\.current \|\| !row \|\| !writableKeys\.has\(row\.key\) \|\| !Array\.isArray\(row\.value\)\) return;/.test(appS));
  const fnBody = f => appS.slice(appS.indexOf('function ' + f + '('), appS.indexOf('\n  }\n', appS.indexOf('function ' + f + '(')));
  t('WIRING no persist() left; asset edits save only the asset list; Clear All is the server function asset_clear_all', !/\bpersist\(/.test(appS)
    && ['updateAssetStatus', 'saveAsset', 'deleteAsset', 'applyAssetImport'].every(f => /queueSave\('assets'/.test(fnBody(f)) && !/queueSave\('jobOrders'/.test(fnBody(f)))
    && /serverChange\('asset_clear_all', \{p_confirm: 'DELETE ALL ASSETS'\}, \['assets'\]/.test(fnBody('clearAllAssets')));
  const JO_FN = { saveJO: ['jo_update', 'jo_create'], updateJOStatus: ['jo_set_status'], deleteJO: ['jo_delete'], approveJO: ['jo_approve'], closeJO: ['jo_close'], revertJO: ['jo_revert'], importJOsFromCSV: ['jo_import'] };
  t('WIRING every job-order action is its own checked server function (one step), never a whole-list save', Object.entries(JO_FN).every(([f, fns]) => { const b = fnBody(f);
    return fns.every(fn => new RegExp("serverChange\\('" + fn + "', [^\\n]*\\['jobOrders'\\]").test(b)) && !/queueSave\(|dbSave\(|saveNow\(|setJobOrders\(/.test(b); }));
  const EMP_FN = { saveEmployee: 'employee_save', updateEmployeeStatus: 'employee_set_status', deleteEmployee: 'employee_delete', importEmployeesFromData: 'employee_import', fixEmployeeStatusFromDates: 'employee_apply_date_rules' };
  t('WIRING every employee action is its own checked server function; the browser never saves the employee list', Object.entries(EMP_FN).every(([f, fn]) => new RegExp("serverChange\\('" + fn + "'").test(fnBody(f)) && !/saveNow\(|dbSave\(|persistEmployees/.test(fnBody(f))) && !/persistEmployees/.test(appS));
  t('WIRING Reset Data is the server function admin_reset_data (accounts untouched)', /serverChange\('admin_reset_data', \{p_confirm: 'RESET ALL DATA'\}, DATA_KEYS\.slice\(\)/.test(fnBody('resetData')) && !/dbSave\(/.test(fnBody('resetData')));
  t('WIRING category rename is ONE server step changing categories, assets, job orders and Department User categories together', /serverChange\('category_rename', \{p_old: oldName, p_new: upper\}, \['customPlants', 'assets', 'jobOrders', 'users'\]/.test(appS.slice(appS.indexOf('function renameCustomPlant('), appS.indexOf('function importAssetsFromCSV('))));
  t('WIRING account errors: 403 = no permission; a network/server failure names what did not happen (never a raw server text); a refusal shows the server reason',
    /const accountError = \(res, fallback\) => res\.status === 403 \? MSG_NO_PERMISSION : res\.status === 0 \|\| res\.status >= 500 \? fallback\s+: \(res\.body && typeof res\.body\.error === 'string' \? res\.body\.error : fallback\);/.test(appS)
    && /accountError\(res, 'The password was not reset\.'\)/.test(appS));
  t('WIRING an Admin editing the OWN record gets the name-only form (the server refuses self-changes through admin-users; nothing is silently dropped)',
    /selfOnly=\{!canAdminUsers \|\| \(userModal\.mode === 'edit' && !!userModal\.user && !!currentUser && userModal\.user\.id === currentUser\.id\)\}/.test(html)
    && /Own account \(also an Admin's own record\): only the own name may change here/.test(appS));
  t('WIRING a failed save is reported by dataset and sets "Not saved" (never "Saved"); the account is then re-read (a deactivated user is signed out)', /if \(failed\.length\) \{ addToast\(unsavedMsg\(failed\), true\); recheckProfile\(\); \}\s+else addToast\('✓ Saved'\);/.test(appS) && /setSyncStatus\(failed\.length \? 'error' : 'ok'\)/.test(appS) && /syncStatus==='error' \? '⚠ Not saved'/.test(appS));
  const pr = html.slice(html.indexOf('function printAssetPDF('), html.indexOf('// ─── CSV UTILITIES')) + html.slice(html.indexOf('function openPrintWindow('), html.indexOf('// ─── ASSET IMPORT PREVIEW'));
  t('PRINT every ${…} interpolation of a record value in the print HTML is escaped (static scan)', (() => {
    const allowed = /^(esc|escHtml)\(|^(title|now|bodyHtml|detailRows|relRows|rows|partsRows|mpRows|nb|thStyle|jsb|jsc|bg|color|jb|jc|sc|rel\.length|items\.map|l|v|content|sect\(|grid3\(|isApproved\(|jo\.approvalStatus|jo\.workDone\?|!jo\.approvalStatus|jo\.priority==='High'|j\.priority==='High'|assets\.length|jobOrders\.length|open\.length|broken\.length|\[\.\.\.new Set|assets\.filter|jobOrders\.filter|rows\|\||\[\[)/;
    // Window titles are passed as plain text: openPrintWindow escapes its title argument once, centrally (checked below).
    const body = pr.replace(/openPrintWindow\(`[^`]*`,/g, 'openPrintWindow(TITLE,');
    const bad = [...body.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1].trim()).filter(x => !allowed.test(x));
    return (bad.length === 0 || (console.log('   unescaped:', bad.slice(0, 8)), false)) && /function openPrintWindow\(title, bodyHtml\) \{[^]*?title = escHtml\(title\);[^]*?<title>\$\{title\}<\/title>/.test(pr);
  })());
  console.log(`\nPermission tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
