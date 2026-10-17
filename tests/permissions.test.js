// Permission model tests: F1 (§12) + F2 roles/scope/user validation (§6, §3.2, §7) + D19 downloads + F5 approval rules (§4). Offline; no network, no data.
'use strict';
const vm = require('vm');
const { sanitizedIndex } = require('./lib/sanitize');
const html = sanitizedIndex(process.argv[2]).replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const t = (n, c, info) => { c ? pass++ : fail++; if (!c || process.env.V) console.log((c ? 'PASS ' : 'FAIL ') + n + (info !== undefined && (!c || process.env.V) ? '  -> ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); };

// ---- load the real PERMISSIONS + SCOPE blocks (pure code before sortByAssetNum) ----
const a = html.indexOf('// ─── PERMISSIONS'), b = html.indexOf('function sortByAssetNum(arr){');
t('permission/scope block present', a > 0 && b > a && html.slice(a, b).includes('// ─── SCOPE'));
const ctx = { TextEncoder }; vm.createContext(ctx);
vm.runInContext("var DESIGNATIONS = {'Admin':'Admin Designation','Senior Engineer':'SE Designation'};", ctx);   // defined earlier in index.html
vm.runInContext((html.match(/^const DATA_KEYS = .*$/m) || ['var DATA_KEYS_MISSING = 1;'])[0], ctx);              // N1: real line from index.html
vm.runInContext(html.slice(a, b) + '\nthis.X = {ALL_CATEGORIES, isAllCategories, allCategories, isEmailAddress, validatePassword, pageFromHash, hashForPage, PAGE_IDS, PAGE_CAP, makeTabSession, verifyTabSession, validateNewPassword, authVerify, profileFor, AUTH_SIGNED_OUT, findLoginCandidates, authAdapterFor, can, ROLE_CAPS, DEPARTMENTS, canSeeAsset, canSeeJO, mayEditJO, isDeptUser, validateUserRecord, normalizeUserRecord, pickFields, JO_REQUEST_FIELDS, JO_WORK_FIELDS, isApproved, canApproveJO, canCloseJO, normWork, workChanged, withStoredFields, withoutApprover, approvalEvent, resetApprovalIfChanged, JO_CONTROL_FIELDS, isJobCardEditor, isEligibleEditor, DU_REPAIR_TYPE, JCE_SECTIONS, jceSectionAllows, planAssetImport, applyAssetPlan, isValidAuthState, authzFingerprint, planDataLoad, escHtml, stableJson, realtimeAction};', ctx);
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
const MUT = ['saveUser','deleteUser','updateAssetStatus','saveAsset','saveJO','updateJOStatus','deleteAsset','clearAllAssets','deleteJO','approveJO','closeJO','revertJO','saveEmployee','savePMItem','importPMFromCSV','recordPMService','updateEmployeeStatus','deleteEmployee','importEmployeesFromData','fixEmployeeStatusFromDates','resetData','addCustomPlant','renameCustomPlant','importAssetsFromCSV','importJOsFromCSV','changeOwnPassword','applyAssetImport'];
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
  ['resetData', {}, AD], ['changeOwnPassword', {}, () => true],
  ['applyAssetImport', {}, ED], ['addCustomPlant', {}, ED], ['renameCustomPlant', {}, ED], ['importAssetsFromCSV', {}, ED], ['importJOsFromCSV', {}, ED],
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
const saveJOBody = app.slice(app.indexOf('  function saveJO('), app.indexOf('  function updateJOStatus('));
t('T6j saveJO edit: checks mayEditJO on the STORED record and copies the other sections from it', /const stored = jobOrders\.find\(j => j\.jobNo===editJobNo\);\n\s*if \(!allow\(!!stored && mayEditJO\(currentUser, stored\)\)\) return;/.test(saveJOBody) && /\{\.\.\.stored, \.\.\.pickFields\(jo, JO_WORK_FIELDS\.filter\(k => k !== 'section'\)\)\}/.test(saveJOBody) && /\{\.\.\.stored, \.\.\.pickFields\(jo, JO_REQUEST_FIELDS\), requester: stored\.requester, dept: stored\.dept\}/.test(saveJOBody));
t('T6k saveJO create by DU: asset in scope, department from profile, work sections blank, OPEN; every new JO gets requesterId', /canSeeAsset\(currentUser, a\) && DEPARTMENTS\.includes\(currentUser\.department\)/.test(saveJOBody) && /\.\.\.JO_WORK_BLANK, requester: currentUser\.fullName, dept: currentUser\.department, status: 'OPEN'/.test(saveJOBody) && /requesterId: currentUser\.id/.test(saveJOBody));

// ---- T8 static ----
const babel = html.slice(html.indexOf('<script type="text/babel">'));
const roleCmp = [...babel.matchAll(/[^\n]*\brole\s*(===|!==)[^\n]*/g)].map(m => m[0].trim());
const allowedRoleCmp = [/^const cls = role==='Admin'\?'role-admin'/, /^if \(!user \|\| typeof user\.role !== 'string' \|\| typeof cap !== 'string'/,
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
t('F5 approve never changes status; close never approves; complete sets PENDING', /approvalStatus:'APPROVED', approvedBy:ev\.by/.test(app) && !/approvalStatus:'APPROVED'[^\n]*status:'CLOSED'/.test(app) && !/status:'CLOSED'[^\n]*approvalStatus/.test(app) && /status, approvalStatus:'PENDING'/.test(app));
t('F5 saveJO: control fields from the stored record, then the approval reset check; creates start clean', /jo = withStoredFields\(jo, stored, JO_CONTROL_FIELDS\);[^\n]*\n\s*jo = resetApprovalIfChanged\(stored, jo, currentUser\);/.test(app) && /jo = \{\.\.\.withStoredFields\(jo, \{\}, JO_CONTROL_FIELDS\), status: 'OPEN'/.test(app));
t('F5 CSV import: only OPEN/IN PROGRESS/COMPLETED, COMPLETED as PENDING, others rejected and listed', /const IMPORTABLE = \['OPEN','IN PROGRESS','COMPLETED'\];/.test(app) && /j\.status==='COMPLETED' \? \{\.\.\.j, approvalStatus:'PENDING'\} : j/.test(app) && /const toAdd = accepted\.filter/.test(app));

// ---- F5 finalisation: history events, CSV approver, dedicated workflow actions ----
const ceV = X5.approvalEvent({ id: 1, fullName: 'C', role: 'Admin' }, 'CLOSED', '', { closedDate: '2026-01-15' });
t('F5b approvalEvent carries extra data (CLOSED keeps the selected closedDate; at stays automatic)', ceV.event === 'CLOSED' && ceV.closedDate === '2026-01-15' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(ceV.at) && ceV.at.slice(0, 10) !== '2026-01-15');
t('F5b closeJO appends a CLOSED event (with closedDate); revertJO appends a REVERTED event', /const cev = approvalEvent\(currentUser, 'CLOSED', '', \{closedDate\}\);/.test(app) && /closedDate, approvalHistory:\[\.\.\.historyOf\(j\), cev\]\}/.test(app) && /const rev = approvalEvent\(currentUser, 'REVERTED', 'reverted to COMPLETED'\);/.test(app) && /closedDate:'', approvalHistory:\[\.\.\.historyOf\(j\), rev\]\}/.test(app));
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
t('R2 validateNewPassword: the agreed policy (8-72 bytes; upper, lower, digit, special), not 64-hex, differs from current', Y.validateNewPassword('Abcdef-1', 'old') === null && !!Y.validateNewPassword('Abcde-1', 'old') && !!Y.validateNewPassword('abcdefgh', 'old') && !!Y.validateNewPassword('Abcdefgh', 'old') && !!Y.validateNewPassword('Abcdefg1', 'old') && !!Y.validateNewPassword('A-1' + 'x'.repeat(70), 'old') && !!Y.validateNewPassword('a'.repeat(64), 'old') && !!Y.validateNewPassword('Same-Pass1', 'Same-Pass1') && !!Y.validateNewPassword(undefined, 'old'));
t('R2 DU repair type constant is Unplanned', Y.DU_REPAIR_TYPE === 'Unplanned');
t('R2 assignment fields are workflow-only (edit/create cannot set them)', ['assignedTo', 'assignedToId'].every(k => Y.JO_CONTROL_FIELDS.includes(k)));
const sj = app.slice(app.indexOf('  function saveJO('), app.indexOf('  function updateJOStatus('));
t('R2 saveJO rejects a Department User repair type other than Unplanned, on create AND on edit', (sj.match(/if \(jo\.repairType !== DU_REPAIR_TYPE\) \{ addToast\('Department Users can only raise Unplanned repairs\.', true\); return; \}/g) || []).length === 2);
const us = app.slice(app.indexOf('  function updateJOStatus('), app.indexOf('\n  }\n', app.indexOf('  function updateJOStatus(')));
t('R2 updateJOStatus: start requires an eligible editor (self for JCE, chosen for Admin/AE) checked against the stored users', /if \(isJobCardEditor\(currentUser\)\) \{\n\s*const me = users\.find/.test(us) && /if \(!isEligibleEditor\(me\)\)/.test(us) && /const ed = assignment && users\.find\(u => u\.id === assignment\.assigneeId\);\n\s*if \(!isEligibleEditor\(ed\)\)/.test(us));
t('R2 updateJOStatus: assignment and status change are one map + one save of job orders only', /\{\.\.\.j, status, \.\.\.assign\}/.test(us) && (us.match(/queueSave\('jobOrders', next\)/g) || []).length === 1 && !/queueSave\('assets'/.test(us) && (us.match(/setJobOrders\(/g) || []).length === 1);
t('R2 updateJOStatus: Admin/AE: assignee = editor, Received By = acting user, section = editor section; JCE: all self', /assign = \{assignedTo: ed\.fullName, assignedToId: ed\.id, recvName: currentUser\.fullName, section: ed\.section\};/.test(us) && /assign = \{assignedTo: me\.fullName, assignedToId: me\.id, recvName: me\.fullName, section: me\.section\};/.test(us));
t('R2 BUG FIX: every JO guard looks up the TARGET job order (j.jobNo===jobNo)', !/jobOrders\.find\(j => j\.jobNo\)/.test(app) && (app.match(/canSeeJO\(currentUser, \(jobOrders\.find\(j => j\.jobNo===jobNo\)\)\)/g) || []).length >= 5);
const cp = app.slice(app.indexOf('  async function changeOwnPassword('), app.indexOf('  function deleteUser('));
t('R2 changeOwnPassword: verifies the current password with plain SHA-256 and writes ONLY the password field of the own record, after a successful save', /\(await sha256Hex\(currentPw\)\) !== me\.password/.test(cp) && /const updatedMe = \{\.\.\.me, password: hashed\};\s+const next = users\.map\(u => u\.id === me\.id \? updatedMe : u\);\s+const saveErr = await dbSave\('users', next\);\s+if \(saveErr\) \{[^}]*return false; \}\s+setUsers\(prev => prev\.map\(u => u\.id === me\.id \? updatedMe : u\)\);/.test(cp) && /validateNewPassword\(newPw, currentPw\)/.test(cp));
t('R2 saveUser self-edit needs profile.edit (Admin/AE/SE)', /editId === currentUser\.id && can\(currentUser,'profile\.edit'\)\)\)\) return;/.test(app));

// ---- R3: Job Card Editor sections (Electrical, Mechanical, Maintenance) ----
const Z = ctx.X;
t('R3 exactly three sections', JSON.stringify([...Z.JCE_SECTIONS]) === JSON.stringify(['Electrical', 'Mechanical', 'Maintenance']));
const jM = { role: 'Job Card Editor', section: 'Mechanical' }, jE = { role: 'Job Card Editor', section: 'Electrical' };
t('R3 start: OPEN with no section → any editor may start; OPEN with a section → only that section', Z.jceSectionAllows(jM, { status: 'OPEN', section: '' }, 'start') && Z.jceSectionAllows(jE, { status: 'OPEN' }, 'start') && Z.jceSectionAllows(jM, { status: 'OPEN', section: 'Mechanical' }, 'start') && !Z.jceSectionAllows(jM, { status: 'OPEN', section: 'Electrical' }, 'start'));
t('R3 progress/edit: section must match; no section → not theirs', Z.jceSectionAllows(jM, { status: 'IN PROGRESS', section: 'mechanical' }) && !Z.jceSectionAllows(jM, { status: 'IN PROGRESS', section: 'Electrical' }) && !Z.jceSectionAllows(jM, { status: 'IN PROGRESS', section: '' }) && !Z.jceSectionAllows(jM, { status: 'OPEN', section: '' }) && !Z.jceSectionAllows(jE, { status: 'IN PROGRESS', section: 'Maintenance' }) && !Z.jceSectionAllows(jM, null));
t('R3 non-editors are never restricted by sections (Admin, AE, SE, DU)', ['Admin', 'Assistant Engineer', 'Senior Engineer', 'Department User'].every(r => Z.jceSectionAllows({ role: r }, { status: 'IN PROGRESS', section: 'Electrical' }, 'progress')));
const usR3 = app.slice(app.indexOf('  function updateJOStatus('), app.indexOf('\n  }\n', app.indexOf('  function updateJOStatus(')));
t('R3 save layer: updateJOStatus checks the section before any change; mayEditJO (used by saveJO) checks it for edits; JCE cannot change Section Assigned', /if \(!jceSectionAllows\(currentUser, cur, status==='IN PROGRESS' \? 'start' : 'progress'\)\)/.test(usR3) && usR3.indexOf('jceSectionAllows') < usR3.indexOf('setJobOrders(') && /return canSeeJO\(user, jo\) && jceSectionAllows\(user, jo\);/.test(html) && /pickFields\(jo, JO_WORK_FIELDS\.filter\(k => k !== 'section'\)\)/.test(app));

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
t('IMPORT save layer: CSV parse only previews (no save); apply blocks invalid files, re-checks the plan, writes once', !/queueSave\(|dbSave\(|setAssets\(/.test(imp.slice(0, imp.indexOf('  function applyAssetImport('))) && /if \(imp\.plan\.invalid\.length\)/.test(imp) && /JSON\.stringify\(planAssetImport\(imp\.rows, assets, categories\)\) !== JSON\.stringify\(imp\.plan\)/.test(imp) && (imp.match(/queueSave\('assets', next\)/g) || []).length === 1 && !/queueSave\('jobOrders'/.test(imp));

// ---- 2026-10-15: departments (exact owner list) and Department User "All" categories (pure functions, synthetic) ----
{
  const { ALL_CATEGORIES, isAllCategories, allCategories } = ctx.X;
  t('DEPARTMENTS exactly the ten owner-supplied names, in order',
    JSON.stringify([...DEPARTMENTS]) === JSON.stringify(['Cement Plant','LPG / Oxygen Plant','Fuel Farm','Roofing Plant','General Store','Accounts','HR','Housekeeping','F&B','Loss Prevention']));
  const du = cats => ({ role: 'Department User', department: 'Cement Plant', assignedCategories: cats });
  const A = p => ({ num: 'X', plant: p });
  t('ALL "All" = assignedCategories exactly ["*"]: every asset, including a category added later', ALL_CATEGORIES === '*' && isAllCategories(['*'])
    && canSeeAsset(du(['*']), A('01 FUEL FARM')) && canSeeAsset(du(['*']), A('99 CATEGORY ADDED LATER')));
  t('ALL individual categories stay restricted', canSeeAsset(du(['01 FUEL FARM']), A('01 FUEL FARM')) && !canSeeAsset(du(['01 FUEL FARM']), A('02 CEMENT PLANT')));
  const malformed = [undefined, null, [], '*', ['*', '01 FUEL FARM'], ['ALL'], ['all'], [['*']], ['* '], [' *'], ['*', '*']];
  t('ALL missing or malformed assignments never grant all categories', malformed.every(c => !isAllCategories(c) && !canSeeAsset(du(c), A('99 OTHER'))));
  t('ALL other roles unaffected (they see every asset regardless)', ['Admin', 'Assistant Engineer', 'Senior Engineer', 'Job Card Editor', 'Viewer'].every(r => canSeeAsset({ role: r }, A('99 OTHER'))));
  t('ALL validation: All alone is valid; All mixed with categories is refused; a department is still required',
    validateUserRecord(du(['*']), ['01 FUEL FARM']) === null && /either All or individual/.test(validateUserRecord(du(['*', '01 FUEL FARM']), ['01 FUEL FARM']) || '')
    && !!validateUserRecord({ ...du(['*']), department: 'Nowhere' }, []) && !!validateUserRecord({ ...du(['*']), department: undefined }, []));
  t('ALL "*" is reserved: never listed as a category, even if assets or the stored list contain it', JSON.stringify(allCategories([{ plant: '*' }, { plant: '01 FUEL FARM' }], ['*'])) === '["01 FUEL FARM"]');
  t('ALL a renamed category does not touch an "All" assignment (only entries equal to the old name change; "*" is never a category)', html.includes('const hit = u => Array.isArray(u.assignedCategories) && u.assignedCategories.some(c => String(c).toUpperCase() === oldName.toUpperCase());'));
}

// ---- 2026-10-15: authoritative categories and tab session (pure functions, synthetic data) ----
(async () => {
  const { allCategories, makeTabSession, verifyTabSession } = ctx.X;
  const sha256Hex = async s => require('crypto').createHash('sha256').update(String(s)).digest('hex');   // same algorithm as the app's sha256Hex
  const A = [{plant: '01 FUEL FARM'}, {plant: '12 vessel'}, {plant: ''}, {plant: '01 FUEL FARM'}, {}];
  t('CATEGORIES union of the categories assets use and the stored list; upper case, de-duplicated, sorted; nothing invented',
    JSON.stringify(allCategories(A, ['12 VESSEL'])) === JSON.stringify(['01 FUEL FARM', '12 VESSEL'])
    && JSON.stringify(allCategories([], ['12 Vessel'])) === JSON.stringify(['12 VESSEL']) && JSON.stringify(allCategories(null, null)) === '[]');
  const U = [{id: 1, username: 'u_a', password: await sha256Hex('Pw-A-123!'), role: 'Admin'}, {id: 2, username: 'u_b', password: await sha256Hex('Pw-B-123!'), role: 'Viewer', active: false}];
  const now = 1.8e12, tok = await makeTabSession(U[0], sha256Hex, now);
  t('SESSION token holds no password or hash', !JSON.stringify(tok).includes(U[0].password) && !('password' in tok) && Object.keys(tok).sort().join() === 'iat,id,proof,username,v');
  t('SESSION valid token is accepted (same tab, within the age limit)', (await verifyTabSession(tok, U, sha256Hex, now + 3600e3)) === U[0]);
  t('SESSION expired after 12 h; a future issue time is refused', (await verifyTabSession(tok, U, sha256Hex, now + 12 * 3600e3 + 1)) === null && (await verifyTabSession({...tok, iat: now + 3600e3}, U, sha256Hex, now)) === null);
  t('SESSION forged or altered token refused (other id, other username, edited proof, wrong version)',
    (await verifyTabSession({...tok, id: 2}, U, sha256Hex, now)) === null && (await verifyTabSession({...tok, username: 'u_b'}, U, sha256Hex, now)) === null
    && (await verifyTabSession({...tok, proof: '0'.repeat(64)}, U, sha256Hex, now)) === null && (await verifyTabSession({...tok, v: 2}, U, sha256Hex, now)) === null);
  const changed = [{...U[0], password: await sha256Hex('Pw-A-NEW-1!')}];
  t('SESSION a password change or reset ends it; a deactivated or deleted account ends it', (await verifyTabSession(tok, changed, sha256Hex, now)) === null
    && (await verifyTabSession(tok, [{...U[0], active: false}], sha256Hex, now)) === null && (await verifyTabSession(tok, [], sha256Hex, now)) === null);
})();

// ---- AUTH (Phase 2B-1): authentication state, verification and profile, offline with synthetic records ----
(async () => {
  const { authVerify, profileFor, AUTH_SIGNED_OUT, findLoginCandidates, authAdapterFor } = ctx.X;
  const sha = s => require('crypto').createHash('sha256').update(String(s)).digest('hex');
  const hashFn = async s => sha(s);
  const ad = authAdapterFor('staging');
  const U = [
    { id: 1, username: 'u_admin', role: 'Admin', active: true, password: sha('Pw-Admin-1') },
    { id: 2, username: 'u_ae', role: 'Assistant Engineer', active: true, password: sha('Pw-AE-1') },
    { id: 3, username: 'u_off', role: 'Senior Engineer', active: false, password: sha('Pw-Off-1') },
    { id: 4, username: 'u_blank', role: 'Admin', active: true, password: '' },
    { id: 5, username: 'u_plain', role: 'Admin', active: true, password: 'Pw-Plain-1' },
    { id: 6, username: 'CD456', role: 'Job Card Editor', section: 'Mechanical', active: true, password: sha('Pw-CD-1') },
    { id: 7, username: 'u_dup', role: 'Admin', active: true, password: sha('Pw-Dup-1') },
    { id: 8, username: 'u_dup', role: 'Admin', active: true, password: sha('Pw-Dup-1') },
  ];
  const V = (loginId, password, extra = {}) => authVerify({ adapter: ad, loginId, password, users: U, usersLoaded: true, hashFn, ...extra });
  t('AUTH initial state is signed out (no subject) and frozen', AUTH_SIGNED_OUT.status === 'signed-out' && AUTH_SIGNED_OUT.subject === null && Object.isFrozen(AUTH_SIGNED_OUT));
  let r = await V('u_admin', 'Pw-Admin-1');
  t('AUTH correct username + password signs in; the state holds only id/username/adapter/env/time (no role, no hash) and is frozen',
    r.ok && r.state.status === 'signed-in' && JSON.stringify(Object.keys(r.state.subject)) === '["id","username"]' && r.state.adapter === 'appdata' && r.state.env === 'staging'
    && !('role' in r.state) && !JSON.stringify(r.state).includes(U[0].password) && Object.isFrozen(r.state) && Object.isFrozen(r.state.subject));
  t('AUTH wrong password refused', !(await V('u_admin', 'wrong')).ok);
  t('AUTH the stored hash typed as the password is refused (no passthrough)', !(await V('u_admin', U[0].password)).ok);
  t('AUTH sign-in by username (exact, surrounding spaces trimmed as the original form did); a different case does not match', (await V(' u_ae ', 'Pw-AE-1')).ok && (await V('CD456', 'Pw-CD-1')).ok && !(await V('U_AE', 'Pw-AE-1')).ok && !(await V('cd456', 'Pw-CD-1')).ok);
  t('AUTH duplicate username (ambiguous) refused', !(await V('u_dup', 'Pw-Dup-1')).ok && findLoginCandidates(U, 'u_dup').length === 2);
  t('AUTH inactive account refused', !(await V('u_off', 'Pw-Off-1')).ok);
  t('AUTH empty stored password refused, with empty or any input', !(await V('u_blank', '')).ok && !(await V('u_blank', 'x')).ok);
  t('AUTH unhashed stored password refused (no plaintext comparison)', !(await V('u_plain', 'Pw-Plain-1')).ok);
  t('AUTH unknown user or empty login ID refused', !(await V('nobody', 'Pw-Admin-1')).ok && !(await V('', 'Pw-Admin-1')).ok && !(await V(null, 'Pw-Admin-1')).ok);
  r = await V('u_admin', 'Pw-Admin-1', { usersLoaded: false });
  t('AUTH users not loaded from the backend: unavailable, never signs in (no fallback)', !r.ok && r.reason === 'unavailable');
  r = await V('u_admin', 'Pw-Admin-1', { adapter: null });
  t('AUTH no adapter (blocked environment): unavailable', !r.ok && r.reason === 'unavailable');
  t('AUTH failure results carry no user data', JSON.stringify(await V('u_admin', 'wrong')) === '{"ok":false,"reason":"invalid"}');
  const st = (await V('u_ae', 'Pw-AE-1')).state;
  t('PROFILE is the stored record of the subject (role from the record)', profileFor(st, U).role === 'Assistant Engineer');
  t('PROFILE follows a role change in the stored users', profileFor(st, U.map(u => u.id === 2 ? { ...u, role: 'Senior Engineer' } : u)).role === 'Senior Engineer');
  t('PROFILE null when the account is deactivated, deleted or renamed',
    profileFor(st, U.map(u => u.id === 2 ? { ...u, active: false } : u)) === null && profileFor(st, U.filter(u => u.id !== 2)) === null
    && profileFor(st, U.map(u => u.id === 2 ? { ...u, username: 'other' } : u)) === null);
  t('PROFILE null when signed out or the state is not a signed-in state', profileFor(AUTH_SIGNED_OUT, U) === null && profileFor(null, U) === null && profileFor({ status: 'x', subject: { id: 1, username: 'u_admin' } }, U) === null);
  t('PROFILE a state claiming a role still gets the STORED role', profileFor({ status: 'signed-in', subject: { id: 2, username: 'u_ae', role: 'Admin' }, role: 'Admin' }, U).role === 'Assistant Engineer');
  t('AUTH adapters: production and staging only; frozen; anything else none', authAdapterFor('production').env === 'production' && authAdapterFor('staging').env === 'staging'
    && Object.isFrozen(authAdapterFor('production')) && ['blocked', undefined, null, '', 'mock', 'local', 'Production'].every(x => authAdapterFor(x) === null));
  // static: the app no longer reads or writes a browser session and signs in through authVerify with a plain SHA-256
  const appSrc = html.slice(html.indexOf('function App()'));
  t('AUTH app wiring: no browser-session read/write; sign-in via authVerify + sha256Hex; auth state starts signed out',
    !/localStorage\.(getItem|setItem)\(SESSION_KEY/.test(html) && /authVerify\(\{adapter: authAdapter[^}]*hashFn: sha256Hex\}\)/.test(appSrc) && /useState\(AUTH_SIGNED_OUT\)/.test(appSrc)
    && /const currentUser = isValidAuthState\(auth, authAdapter\) \? profileFor\(auth, users\) : null;/.test(appSrc) && !/setCurrentUser/.test(html));
  // ---- release 2026-10-14: own-password rule, unique usernames, no temporary passwords / forced change / Employee ID ----
  const { validateNewPassword } = ctx.X;
  t('PASSWORD own change and admin-set passwords: the agreed policy with clear messages; a 64-hex string or the current password refused',
    /needs an uppercase letter, a number, a special character/.test(validateNewPassword('abcdefgh', 'x')) && /at least 8 characters/.test(validateNewPassword('Ab-1', 'x')) && validateNewPassword('Abcdef-1', 'x') === null
    && /too long/.test(validateNewPassword('Aa-1' + 'x'.repeat(69), 'x')) && validateNewPassword('a'.repeat(64), 'x') !== null && /must differ/.test(validateNewPassword('Same-Pass-1', 'Same-Pass-1')) && /required/.test(validateNewPassword(undefined, 'x')));
  const EU = [{ id: 1, username: 'u_admin' }, { id: 2, username: 'u_two' }];
  t('USERNAME duplicate rejected for new accounts and edits; an account keeps its own username', /username is already used/.test(validateUserRecord({ role: 'Admin', username: 'u_two' }, [], { users: EU }))
    && /username is already used/.test(validateUserRecord({ role: 'Admin', username: 'u_two' }, [], { users: EU, editId: 1 })) && validateUserRecord({ role: 'Admin', username: 'u_two' }, [], { users: EU, editId: 2 }) === null);
  t('USERNAME checks run after the existing role/assignment checks (earlier messages unchanged)', /valid role/.test(validateUserRecord({ role: 'x', username: 'u_two' }, [], { users: EU })));
  t('NORM role-only fields removed for other roles; every other field kept', (n => !('department' in n) && !('section' in n) && n.id === 9 && n.fullName === 'X')(normalizeUserRecord({ role: 'Admin', department: 'HR', section: 'Electrical', id: 9, fullName: 'X' })));
  const appS = html.slice(html.indexOf('\nfunction App() {'), html.indexOf('\nfunction NavItem('));
  t('RELEASE no temporary passwords, forced password change, Employee ID login, password-reset tool, recovery or notification code in the app (the redesigned login visuals are included)',
    !/must_change_password|mustChangePassword|generateTempPassword|LOCAL_ACCOUNT_TOOLS|resetUserPassword|ForcePasswordChange|TempPasswordNotice|employeeId|EMPLOYEE_ID_RE|recoveryStep|RecoveryLanding|NotificationBell|notificationMode|local_mock_notifications|Forgot password|login-temp-note/.test(html));
  t('WIRING saveUser: role/assignment + unique username + mandatory email (new) validated; new accounts need a password that meets the policy; admin-set passwords hashed with plain SHA-256 (no passthrough)',
    /validateUserRecord\(user, assetCategories, \{users, editId: editId \|\| undefined, isNew: !editId\}\)/.test(appS) && /if \(!editId && !\(typeof user\.password === 'string' && user\.password !== ''\)\)/.test(appS) && /const pe = validatePassword\(user\.password\); if \(pe\) \{ addToast\(pe, true\); return; \}/.test(appS) && /await sha256Hex\(user\.password\)/.test(appS));
  // ---- Phase 2B-4: session lifecycle (offline, synthetic) ----
  const { isValidAuthState, authzFingerprint } = ctx.X;
  const AP = authAdapterFor('staging'), good = { status: 'signed-in', subject: { id: 2, username: 'u_ae' }, adapter: 'appdata', env: 'staging', since: 'x' };
  t('SESSION a well-formed signed-in state of this environment is valid', isValidAuthState(good, AP) === true);
  const BAD = [['null', null], ['string', 'signed-in'], ['signed out', AUTH_SIGNED_OUT], ['status case', { ...good, status: 'Signed-in' }], ['status truthy', { ...good, status: true }],
    ['no subject', { ...good, subject: null }], ['subject string', { ...good, subject: 'u_ae' }], ['id object', { ...good, subject: { id: {}, username: 'u_ae' } }],
    ['id missing', { ...good, subject: { username: 'u_ae' } }], ['username empty', { ...good, subject: { id: 2, username: '' } }], ['username number', { ...good, subject: { id: 2, username: 5 } }],
    ['other env', { ...good, env: 'production' }], ['other adapter', { ...good, adapter: 'supabase-auth' }], ['no adapter field', { ...good, adapter: undefined }], ['array', [good]]];
  for (const [n, st2] of BAD) t('SESSION malformed state denied: ' + n, isValidAuthState(st2, AP) === false);
  t('SESSION no adapter (blocked environment) → every state is invalid', isValidAuthState(good, authAdapterFor('blocked')) === false && isValidAuthState(good, null) === false);
  t('SESSION profileFor rejects a non-object subject', profileFor({ status: 'signed-in', subject: 'u_ae' }, U) === null);
  const fu = { id: 2, username: 'u_ae', role: 'Assistant Engineer', password: 'h', email: 'x' };
  t('AUTHZ fingerprint changes on role, scope and status; empty when signed out',
    authzFingerprint(null) === '' && ['role', 'department', 'section'].every(k => authzFingerprint(fu) !== authzFingerprint({ ...fu, [k]: 'Other' }))
    && authzFingerprint(fu) !== authzFingerprint({ ...fu, assignedCategories: ['A'] }) && authzFingerprint(fu) !== authzFingerprint({ ...fu, active: false })
    && authzFingerprint(fu) !== authzFingerprint({ ...fu, id: 3 }));
  t('AUTHZ fingerprint ignores the password and contact fields (a password change does not count as a role change)',
    authzFingerprint(fu) === authzFingerprint({ ...fu, password: 'other', email: 'y' }) && !authzFingerprint(fu).includes('"h"'));
  t('STORAGE (N1) no dataset is written to browser storage: the only localStorage writes are the sidebar and theme preferences',
    (html.match(/localStorage\.setItem\(/g) || []).length === 2 && /localStorage\.setItem\(SIDEBAR_KEY,/.test(html) && /localStorage\.setItem\(THEME_KEY, v\)/.test(html));
  t('STORAGE (N1) the only localStorage reads are the theme and sidebar preferences (no dataset is ever read back)',
    (html.match(/localStorage\.getItem\(/g) || []).length === 2 && /localStorage\.getItem\('cmms_vg_theme'\)/.test(html) && /localStorage\.getItem\(SIDEBAR_KEY\)/.test(html));
  t('STORAGE (N1) every legacy data copy (session, users, assets/JOs, PM, employees, categories) is deleted on load',
    /\[SESSION_KEY, USERS_KEY, STORE_KEY, PM_KEY, EMPLOYEES_KEY, CUSTOM_PLANTS_KEY\]\.forEach\(k => localStorage\.removeItem\(k\)\)/.test(appS)
    && ["STORE_KEY = 'cmms_vg_state'", "PM_KEY = 'cmms_vg_pm'", "EMPLOYEES_KEY = 'cmms_vg_employees'", "USERS_KEY = 'cmms_vg_users'", "CUSTOM_PLANTS_KEY = 'cmms_vg_plants'"].every(k => html.includes(k)));
  t('WIRING logout ends the tab session, closes every App-level form and returns to the dashboard',
    /function handleLogout\(forced\) \{[^]*?writeGate\.signedIn = false;\s+clearTabSession\(\);[^\n]*\s+setAuth\(AUTH_SIGNED_OUT\);\s+setAssetModal\(null\); setJoModal\(null\); setJoViewModal\(null\); setAssetImport\(null\);[^\n]*\s+setPage\('dashboard'\);/.test(appS));
  t('WIRING an authorization change closes forms, leaves pages the role cannot see, and re-mounts the page area',
    /const authzKey = authzFingerprint\(currentUser\);/.test(appS) && /\}, \[authzKey\]\);/.test(appS) && /<div className="main" key=\{authzKey\}>/.test(appS));
  t('WIRING the Users tab renders only while the CURRENT user may administer users', /\{tab==='users' && canAdminUsers && \(/.test(html));
  t('WIRING no browser storage of passwords anywhere: sessionStorage only for the tab-session token (id, username, time, proof; no password or hash), no localStorage session, no cookies, no IndexedDB',
    (html.match(/sessionStorage\.setItem\(/g) || []).length === 1 && /function writeTabSession\(t\) \{ try \{ sessionStorage\.setItem\(TAB_SESSION_KEY, JSON\.stringify\(t\)\); \} catch \(_\) \{\} \}/.test(html)
    && /return \{v: 1, id: user\.id, username: user\.username, iat: now, proof: await tabSessionProof\(/.test(html) && !/localStorage\.setItem\(SESSION_KEY/.test(html)
    && !/document\.cookie\s*=|indexedDB\.open/.test(html));
  // ---- N1: safe initialization (planDataLoad), per-dataset saves, print escaping (offline, synthetic) ----
  const { planDataLoad, escHtml } = ctx.X;
  const R = (k, v) => ({ key: k, value: v });
  const FULL = ['assets', 'jobOrders', 'pm', 'employees', 'users', 'customPlants'].map(k => R(k, []));
  const PROD = { envName: 'production', seedOptIn: true }, STG = { envName: 'staging', seedOptIn: true }, STG0 = { envName: 'staging', seedOptIn: false };
  t('LOAD read error → fail (never seed), in every environment', [PROD, STG, STG0].every(o => planDataLoad({ data: null, error: { message: 'x' } }, o).action === 'fail' && planDataLoad({ data: FULL, error: { message: 'x' } }, o).reason === 'failed'));
  t('LOAD unusable responses → fail', [undefined, null, 'x', {}, { data: 'rows' }, { data: {} }].every(r => planDataLoad(r, STG).action === 'fail'));
  t('LOAD zero rows in production → fail "empty" even if a seed opt-in were present (never seeds production)', planDataLoad({ data: [] }, PROD).action === 'fail' && planDataLoad({ data: [] }, PROD).reason === 'empty');
  t('LOAD zero rows in staging WITHOUT the explicit opt-in → fail "empty"', planDataLoad({ data: [] }, STG0).reason === 'empty' && planDataLoad({ data: [] }, { envName: 'staging' }).reason === 'empty' && planDataLoad({ data: [] }, { envName: 'staging', seedOptIn: 'true' }).reason === 'empty');
  t('LOAD only the staging marker row + opt-in → seed (fresh local mock); in production → fail', planDataLoad({ data: [R('__environment', { env: 'staging' })] }, STG).action === 'seed' && planDataLoad({ data: [R('__environment', { env: 'staging' })] }, PROD).action === 'fail');
  t('LOAD blocked/unknown environment never seeds', ['blocked', undefined, '', 'Staging'].every(e => planDataLoad({ data: [] }, { envName: e, seedOptIn: true }).action === 'fail'));
  const full = planDataLoad({ data: FULL }, PROD);
  t('LOAD all six datasets → load, all writable, none missing', full.action === 'load' && full.loaded.length === 6 && !full.missing.length && !full.invalid.length);
  const part = planDataLoad({ data: FULL.filter(r => r.key !== 'pm' && r.key !== 'users') }, PROD);
  t('LOAD missing datasets → partial; only the datasets read are writable', part.action === 'partial' && JSON.stringify(part.missing) === '["pm","users"]' && !part.loaded.includes('pm') && part.loaded.includes('assets'));
  const bad = planDataLoad({ data: FULL.map(r => r.key === 'assets' ? R('assets', null) : r.key === 'employees' ? R('employees', { a: 1 }) : r) }, STG);
  t('LOAD malformed dataset values (null, object) → partial, reported as invalid, NOT writable and never seeded', bad.action === 'partial' && JSON.stringify(bad.invalid) === '["assets","employees"]' && !bad.loaded.includes('assets'));
  t('LOAD rows with only unknown keys or only malformed values → fail "empty" (nothing writable)', planDataLoad({ data: [R('other', [])] }, PROD).reason === 'empty' && planDataLoad({ data: [R('assets', 'x')] }, STG).reason === 'empty');
  t('LOAD empty arrays are valid data (an empty dataset is loaded, not missing)', planDataLoad({ data: FULL }, PROD).loaded.includes('jobOrders'));
  const evil = '<img src=x onerror="alert(1)">&\'<script>x</script>';
  t('ESC escapes & < > " \' and leaves plain text unchanged', escHtml(evil) === '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;&lt;script&gt;x&lt;/script&gt;' && escHtml('Pump 3/4 — 25T') === 'Pump 3/4 — 25T' && escHtml(null) === '' && escHtml(0) === '0');
  // static wiring
  const dbS = html.slice(html.indexOf('async function dbSave('), html.indexOf('async function sha256Hex('));
  t('WIRING dbSave refuses any dataset that was not read completely in this load', /if \(DATA_KEYS\.includes\(key\) && !writableKeys\.has\(key\)\) \{[^}]*return new Error/.test(dbS));
  const ld = appS.slice(appS.indexOf('  // ── Load from Supabase on mount'), appS.indexOf('  // ── Real-time sync'));
  t('WIRING load: a failed or empty read shows the failure screen and writes nothing', /if \(plan\.action === 'fail'\) \{ fail\(plan\.reason/.test(ld) && /, err => fail\('failed', err\)\);/.test(ld) && /if \(loadIssue && loadIssue\.kind !== 'partial'\) return \(/.test(appS));
  t('WIRING load: only the datasets read become writable; unread asset/JO lists are shown empty, never built-in data', /plan\.loaded\.forEach\(k => writableKeys\.add\(k\)\)/.test(ld) && /if \(!\('assets' in map\)\) setAssets\(\[\]\);/.test(ld));
  t('WIRING load (N2): the normal load path writes NOTHING (no dbSave/saveNow/persist); corrections are deferred; no localStorage fallback',
    !/dbSave\(|saveNow\(|persistUsers\(|persistEmployees\(|queueSave\(/.test(ld.slice(ld.indexOf('} else {'))) && /if \(stableJson\(fixed\) !== stableJson\(map\.employees\)\) setDeferredFix\(f => \(\{\.\.\.f, employees: true\}\)\);/.test(ld)
    && /setDeferredFix\(f => \(\{\.\.\.f, users: true\}\)\)/.test(ld) && !/localStorage/.test(ld));
  t('WIRING load (N2): seeding writes only with the {seed:true} flag while seedAllowed is set, and closes it again',
    /writeGate\.seedAllowed = true;[^]*?dbSave\('assets', deduped, seed\);[^]*?dbSave\('users', \[\], seed\);[^]*?writeGate\.seedAllowed = false;/.test(ld));
  // ---- N2: no writes before sign-in, deferred corrections, realtime conflicts (offline, synthetic) ----
  const { stableJson, realtimeAction } = ctx.X;
  t('STABLE key order does not matter; nested objects and arrays; undefined fields ignored like JSON',
    stableJson({ b: 1, a: [{ y: 2, x: 'é' }] }) === stableJson({ a: [{ x: 'é', y: 2 }], b: 1 }) && stableJson([1, 2]) !== stableJson([2, 1]) && stableJson({ a: 1, u: undefined }) === stableJson({ a: 1 }) && stableJson(null) === 'null');
  const mine = [{ jobNo: 'JO-1', status: 'OPEN', dept: 'X' }], recent = [stableJson(mine)];
  t('REALTIME our own write coming back (any key order) is an echo, with or without a waiting change', realtimeAction([{ dept: 'X', status: 'OPEN', jobNo: 'JO-1' }], false, recent) === 'echo' && realtimeAction(mine, true, recent) === 'echo');
  t('REALTIME another change while a local change of that dataset is waiting → conflict (the waiting change must not overwrite it)', realtimeAction([{ jobNo: 'JO-1', status: 'CLOSED' }], true, recent) === 'conflict');
  t('REALTIME another change with nothing waiting → apply; no history → apply', realtimeAction([{ jobNo: 'JO-2' }], false, recent) === 'apply' && realtimeAction([], false, undefined) === 'apply');
  const dbS2 = html.slice(html.indexOf('async function dbSave('), html.indexOf('async function sha256Hex('));
  t('WIRING (N2) dbSave refuses every write while nobody is signed in (except the staging-only seed), before the dataset check',
    /const seeding = opts\.seed === true && writeGate\.seedAllowed && ENV\.name === 'staging';\s+if \(!writeGate\.signedIn && !seeding\) \{[^}]*return new Error\('not signed in'\); \}\s+if \(DATA_KEYS\.includes\(key\)/.test(dbS2)
    && /const writeGate = \{signedIn: false, seedAllowed: false\};/.test(html));
  t('WIRING (N2) the gate follows the signed-in profile and is closed on every sign-out', /useEffect\(\(\) => \{ writeGate\.signedIn = signedInId !== null; \}, \[signedInId\]\);/.test(appS) && /const signedInId = currentUser \? currentUser\.id : null;/.test(appS));
  t('WIRING (N2) deferred corrections: employees only by emp.statusUpdate, users only by users.admin',
    /if \(!currentUser\) return;\s+if \(deferredFix\.employees && can\(currentUser,'emp\.statusUpdate'\) && writableKeys\.has\('employees'\)\)/.test(appS) && /if \(deferredFix\.users && can\(currentUser,'users\.admin'\) && writableKeys\.has\('users'\)\)/.test(appS));
  t('WIRING (N2) normal sign-out writes what is waiting first; a forced sign-out (deactivated/deleted) discards it with a message',
    /if \(forced === true\) \{[^\n]*pendingSaves\.current = \{\}; if \(k\.length\) addToast\(unsavedMsg\(k\), true\); \}\s+else runBatch\(\);\s+writeGate\.signedIn = false;/.test(appS) && /handleLogout\(true\); addToast\('Your account is no longer active/.test(appS));
  t('WIRING (N2) realtime: echo ignored; conflict drops the waiting change with a message, then shows the newer data',
    /const act = realtimeAction\(row\.value, row\.key in pendingSaves\.current, recentWrites\[row\.key\]\);\s+if \(act === 'echo'\) return;\s+if \(act === 'conflict'\) \{\s+delete pendingSaves\.current\[row\.key\];/.test(appS) && /\(recentWrites\[key\] = \(recentWrites\[key\] \|\| \[\]\)\.slice\(-4\)\)\.push\(stableJson\(value\)\);/.test(html));
  // ---- release 2026-10-14: the original login page is restored ----
  const lp = html.slice(html.indexOf('function LoginPage({onLogin}) {'), html.indexOf('// ─── DASHBOARD'));
  t('LOGIN redesigned page (circuit board, introduction, theme toggle) with the SAME sign-in: Username + Password, onLogin(username, password), original messages',
    /<LoginCircuit pageRef=\{pageRef\} cardRef=\{cardRef\}\/>/.test(lp) && /<label htmlFor="login-username">Username<\/label>/.test(lp) && /<label htmlFor="login-password">Password<\/label>/.test(lp)
    && /const res = await onLogin\(username\.trim\(\), password\);/.test(lp) && /setError\('Please enter your username and password\.'\)/.test(lp)
    && /'Invalid username or password\. Please try again\.'/.test(lp) && /COMPUTERIZED MAINTENANCE MANAGEMENT SYSTEM<br\/>/.test(lp));
  t('LOGIN no Employee ID, recovery or temporary-password elements; no length limit on the username',
    !/Employee ID|Forgot password|recover|login-temp-note|maxLength=\{5\}/.test(lp));
  t('LOGIN redesign CSS present (both themes, reduced motion) and no notification styles', /\.login-intro\{/.test(html) && /\.lc-signal/.test(html)
    && /:root\[data-theme="light"\] \.login-page\{--li-bg:/.test(html) && /@media\(prefers-reduced-motion:reduce\)\{\s*\.login-visual \*/.test(html) && !/\.notif-/.test(html));
  // ---- 2026-10-15 feature branch: categories, dashboard, chart, sidebar, tab session ----
  t('CATEGORIES Department User assignment uses the Asset Registry categories only; the asset form, import and rename keep the full list (assets + stored)',
    /const categories = useMemo\(\(\) => allCategories\(assets, customPlants\), \[assets, customPlants\]\);/.test(appS)
    && /<SettingsPage users=\{users\} customPlants=\{assetCategories\}/.test(appS) && /const assetCategories = useMemo\(\(\) => allCategories\(assets, \[\]\), \[assets\]\);/.test(appS) && /validateUserRecord\(user, assetCategories, \{users, editId: editId \|\| undefined, isNew: !editId\}\)/.test(appS) && /customPlants=\{categories\} onAddPlant=\{addCustomPlant\}/.test(appS)
    && /planAssetImport\(rows, assets, categories\)/.test(appS) && /if \(!categories\.some\(same\)\)/.test(appS));
  t('DASHBOARD five most recent job orders; Recent panel matches the Assets by Category height', /const recent = \[\.\.\.jobOrders\]\.reverse\(\)\.slice\(0, 5\);/.test(html)
    && /className="panel recent-jo-panel" style=\{\{display:'flex',flexDirection:'column',contain:'size',minHeight:260\}\}/.test(html));
  t('CHART static: animation off, no hover offset, rebuilt only when the counted data or the theme changes', /animation:false,/.test(html) && /hoverOffset:0,/.test(html)
    && /\},\[chartKey, theme\]\);/.test(html) && !/animateRotate|animateScale/.test(html));
  t('SIDEBAR no section headers (icons and names kept)', !/className="nav-section"/.test(html) && /icon="🏠" label="Dashboard"/.test(html) && /icon="👥" label="Settings"/.test(html));
  t('SESSION restore runs once after the users were read (or are known to be unavailable), only through verifyTabSession, and always ends the restoring state; logout and own password change handled',
    /if \(restoreTried\.current \|\| !restoring\) return;/.test(appS) && /if \(!dbLoaded \|\| !usersSettled\) return;/.test(appS) && /if \(!tok \|\| !usersFromDb\.current\) \{ setRestoring\(false\); return; \}/.test(appS)
    && /verifyTabSession\(tok, users, sha256Hex\)\.then\(u => \{\s*if \(!u\) clearTabSession\(\);/.test(appS) && /setRestoring\(false\);\s*\}, \(\) => setRestoring\(false\)\);/.test(appS) && /\}, RESTORE_MAX_MS\);/.test(appS)
    && /writeTabSession\(await makeTabSession\(updatedMe, sha256Hex\)\);/.test(appS));
  t('WIRING (N2) a change before the data is loaded is never dropped silently', /if \(!isLoaded\.current\) \{ addToast\(unsavedMsg\(\[key\]\), true\); return; \}/.test(appS));
  t('WIRING realtime never fills in a dataset that was not loaded', /if \(!isLoaded\.current \|\| !row \|\| !writableKeys\.has\(row\.key\) \|\| !Array\.isArray\(row\.value\)\) return;/.test(appS));
  t('WIRING no persist() left; asset handlers save only assets, JO handlers only job orders', !/\bpersist\(/.test(appS)
    && ['updateAssetStatus', 'saveAsset', 'deleteAsset', 'clearAllAssets', 'applyAssetImport'].every(f => { const b = appS.slice(appS.indexOf('function ' + f + '('), appS.indexOf('\n  }\n', appS.indexOf('function ' + f + '('))); return /queueSave\('assets'/.test(b) && !/queueSave\('jobOrders'/.test(b); })
    && ['saveJO', 'updateJOStatus', 'deleteJO', 'approveJO', 'closeJO', 'revertJO', 'importJOsFromCSV'].every(f => { const b = appS.slice(appS.indexOf('function ' + f + '('), appS.indexOf('\n  }\n', appS.indexOf('function ' + f + '('))); return /queueSave\('jobOrders'/.test(b) && !/queueSave\('assets'/.test(b); }));
  t('WIRING category rename deliberately saves assets AND job orders in one batch', (() => { const b = appS.slice(appS.indexOf('function renameCustomPlant('), appS.indexOf('function importAssetsFromCSV(')); return /queueSave\('jobOrders', nextJOs\)/.test(b) && /queueSave\('assets', next\)/.test(b); })());
  t('WIRING a failed save is reported by dataset and sets "Not saved" (never "Saved")', /if \(failed\.length\) addToast\(unsavedMsg\(failed\), true\);\s+else addToast\('✓ Saved'\);/.test(appS) && /setSyncStatus\(failed\.length \? 'error' : 'ok'\)/.test(appS) && /syncStatus==='error' \? '⚠ Not saved'/.test(appS));
  const pr = html.slice(html.indexOf('function printAssetPDF('), html.indexOf('// ─── CSV UTILITIES')) + html.slice(html.indexOf('function openPrintWindow('), html.indexOf('// ─── ASSET IMPORT PREVIEW'));
  t('PRINT every ${…} interpolation of a record value in the print HTML is escaped (static scan)', (() => {
    const allowed = /^(esc|escHtml)\(|^(title|now|bodyHtml|detailRows|relRows|rows|partsRows|mpRows|nb|thStyle|jsb|jsc|bg|color|jb|jc|sc|rel\.length|items\.map|l|v|content|sect\(|grid3\(|isApproved\(|jo\.approvalStatus|jo\.workDone\?|!jo\.approvalStatus|jo\.priority==='High'|j\.priority==='High'|assets\.length|jobOrders\.length|open\.length|broken\.length|\[\.\.\.new Set|assets\.filter|jobOrders\.filter|rows\|\||\[\[)/;
    // Window titles are passed as plain text: openPrintWindow escapes its title argument once, centrally (checked below).
    const body = pr.replace(/openPrintWindow\(`[^`]*`,/g, 'openPrintWindow(TITLE,');
    const bad = [...body.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1].trim()).filter(x => !allowed.test(x));
    return (bad.length === 0 || (console.log('   unescaped:', bad.slice(0, 8)), false)) && /function openPrintWindow\(title, bodyHtml\) \{[^]*?title = escHtml\(title\);[^]*?<title>\$\{title\}<\/title>/.test(pr);
  })());
  // ---- 2026-10-17: audit fixes (email, "All" validation, admin-set password policy, refresh keeps sign-in and page) ----
  { const { validateUserRecord, isEmailAddress, validatePassword, pageFromHash, hashForPage, PAGE_IDS, PAGE_CAP, can } = ctx.X;
    const EU = [{ id: 1, username: 'u_admin', email: 'admin.one@example.invalid' }, { id: 2, username: 'u_two', email: 'dup@example.invalid' }, { id: 3, username: 'u_three', email: 'DUP@example.invalid' }, { id: 4, username: 'u_four', email: 'not an email' }];
    const V = (u, o) => validateUserRecord({ role: 'Viewer', username: 'n_new', ...u }, ['PUMP'], { users: EU, ...o });
    t('EMAIL a new account needs a valid email: missing, blank or malformed refused; a valid one accepted',
      /valid email address is required/.test(V({}, { isNew: true })) && /valid email address is required/.test(V({ email: '  ' }, { isNew: true }))
      && ['x', 'a@b', 'a b@example.com', 'a@@example.com'].every(e => /valid email address \(for example/.test(V({ email: e }, { isNew: true }))) && V({ email: 'New.User@Example.com' }, { isNew: true }) === null);
    t('EMAIL unique (case-insensitive) for a new or changed address; an existing record is never blocked by what it already holds',
      /already used by another account/.test(V({ email: 'ADMIN.ONE@example.invalid' }, { isNew: true })) && /already used/.test(V({ username: 'u_admin', email: 'dup@example.invalid' }, { editId: 1 }))
      && V({ username: 'u_two', email: 'dup@example.invalid' }, { editId: 2 }) === null && V({ username: 'u_four', email: 'not an email' }, { editId: 4 }) === null && V({ username: 'u_two' }, { editId: 2 }) === null);
    t('EMAIL isEmailAddress: same rule as the server (one @, no spaces, a dot in the domain, ≤ 254)', isEmailAddress('a@b.co') && !isEmailAddress('a@b') && !isEmailAddress('a@b.c d') && !isEmailAddress('x'.repeat(250) + '@b.co'));
    const allDu = { role: 'Department User', department: 'HR', assignedCategories: ['*'], email: 'du.all@example.invalid' };
    t('ALL a Department User with "All" still gets the later checks (fixed early return): a duplicate username is refused (it would lock both accounts out), and so is a missing email',
      /username is already used/.test(validateUserRecord({ ...allDu, username: 'u_two' }, ['PUMP'], { users: EU, isNew: true }))
      && /valid email address is required/.test(validateUserRecord({ ...allDu, username: 'n_du', email: '' }, ['PUMP'], { users: EU, isNew: true }))
      && validateUserRecord({ ...allDu, username: 'n_du' }, ['PUMP'], { users: EU, isNew: true }) === null && /either All or individual/.test(validateUserRecord({ ...allDu, username: 'n_du', assignedCategories: ['*', 'PUMP'] }, ['PUMP'], { users: EU, isNew: true })));
    t('PASSWORD admin-set (new account / reset) uses the policy in the form and in saveUser', /if \(f\.password\) \{ const pe = validatePassword\(f\.password\); if \(pe\) \{ alert\(pe\); return; \} \}/.test(html) && validatePassword('Abcdef-1') === null && validatePassword('abc') !== null);
    t('ROUTE pageFromHash: only #/<known page>; anything else (incl. junk and unknown pages) is not a page',
      PAGE_IDS.every(p => pageFromHash('#/' + p) === p && hashForPage(p) === '#/' + p) && ['', '#', '#/', '#/admin', '#/JOBORDERS', '#joborders', '#/joborders/1', null, undefined].every(h => pageFromHash(h) === null));
    t('ROUTE every page has a capability; a page the role may not see falls back to the dashboard (Department User: no PM/Employees)',
      PAGE_IDS.every(p => typeof PAGE_CAP[p] === 'string') && /if \(currentUser && !can\(currentUser, PAGE_CAP\[page\]\)\) setPage\('dashboard'\);\s+\}, \[page, authzFingerprint\(currentUser\)\]\);/.test(appS)
      && ['pmschedule', 'employees'].every(p => !can({ role: 'Department User' }, PAGE_CAP[p])));
    t('RESTORE render order: data failure, then the restoring screen (never the sign-in form while a tab session is checked), then sign-in',
      /if \(!currentUser && restoring\) return \(\s+<><style>\{CSS\}<\/style><SplashScreen text="Restoring your session…"\/><\/>/.test(appS)
      && appS.indexOf("if (loadIssue && loadIssue.kind !== 'partial') return (") < appS.indexOf('if (!currentUser && restoring) return (') && appS.indexOf('if (!currentUser && restoring) return (') < appS.indexOf('if (!currentUser) return (')
      && /const \[restoring, setRestoring\] = useState\(\(\) => !!authAdapter && !!readTabSession\(\)\);/.test(appS));
    t('RESTORE the users list always settles (loaded, empty, failed, seeded, hashing done or failed), so restoring always ends',
      (appS.match(/setUsersSettled\(true\)/g) || []).length >= 5 && /setUsers\(hashed\); setDeferredFix\(f => \(\{\.\.\.f, users: true\}\)\); setUsersSettled\(true\); \}, \(\) => setUsersSettled\(true\)\);/.test(appS));
    t('RESTORE page: initial page from the address; kept in the address while signed in; normal logout clears it, forced keeps it; sign-in opens the requested page',
      /const \[page, setPage\] = useState\(\(\) => \{ try \{ return pageFromHash\(window\.location\.hash\) \|\| 'dashboard'; \}/.test(appS)
      && /if \(h && window\.location\.hash !== h\) history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.search \+ h\);/.test(appS)
      && /if \(forced !== true && window\.location\.hash\) history\.replaceState/.test(appS) && /setPage\(\(\) => \{ try \{ return pageFromHash\(window\.location\.hash\) \|\| 'dashboard'; \}/.test(appS));
  }
  console.log(`\nPermission tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
