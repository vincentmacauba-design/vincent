// TEST SUPPORT + LOCAL MOCK — job-order notification rules (recipients, events, de-duplication).
// The SERVER-SIDE implementation is p2/sql/0008_notifications.sql (DRAFT — NOT EXECUTED); tests/p2/static.test.mjs
// checks that its role/event lists equal the ones here. This module is also used by the LOCAL MOCK database
// (tests/e2e/rig.js) so the browser UI can be exercised; the local mock is NOT a secure server (see P2A_MIGRATION §8).
//
// Rules (owner requirements 2026-10-14):
//   Admin, Assistant Engineer, Senior Engineer : OPEN, IN_PROGRESS, COMPLETED, CLOSED for every job order
//   Job Card Editor                            : OPEN and CLOSED for job orders of THEIR section (job order has a section)
//   Department User                            : IN_PROGRESS, COMPLETED, CLOSED for job orders THEY raised (requesterId)
//   Viewer                                     : none
// Only active accounts receive notifications. The acting user is NOT excluded (decision N-D2, documented).
// One event per real transition: (jobNo, event, seq) is unique; one notification per (event, recipient).

export const NOTIFY_EVENTS = Object.freeze(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']);
export const STATUS_EVENT = Object.freeze({ 'OPEN': 'OPEN', 'IN PROGRESS': 'IN_PROGRESS', 'COMPLETED': 'COMPLETED', 'CLOSED': 'CLOSED' });
export const NOTIFY_RULES = Object.freeze({
  'Admin': ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'],
  'Assistant Engineer': ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'],
  'Senior Engineer': ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'],
  'Job Card Editor': ['OPEN', 'CLOSED'],
  'Department User': ['IN_PROGRESS', 'COMPLETED', 'CLOSED'],
  'Viewer': [],
});
const normSection = v => String(v || '').trim().toLowerCase();

// Events from a whole-array change of jobOrders (how the CURRENT app writes). New job order -> event for its status;
// changed status -> event for the new status; unchanged or deleted -> nothing. Repeating the same write yields nothing.
export function joEventsFromDiff(prev, next) {
  const before = new Map((Array.isArray(prev) ? prev : []).filter(j => j && j.jobNo).map(j => [j.jobNo, j]));
  const out = [];
  for (const j of Array.isArray(next) ? next : []) {
    if (!j || !j.jobNo || !STATUS_EVENT[j.status]) continue;
    const old = before.get(j.jobNo);
    if (!old || old.status !== j.status) out.push({ jobNo: j.jobNo, event: STATUS_EVENT[j.status], jo: j });
  }
  return out;
}

// Does `user` (legacy app shape: {id, role, active, section, ...} or profile shape) receive `event` for job order `jo`?
export function isRecipient(user, event, jo) {
  if (!user || user.active === false || !jo) return false;
  const rules = NOTIFY_RULES[user.role];
  if (!rules || !rules.includes(event)) return false;
  if (user.role === 'Job Card Editor') { const s = normSection(jo.section); return !!s && s === normSection(user.section); }
  if (user.role === 'Department User') return jo.requesterId != null && Number(jo.requesterId) === Number(user.legacy_id != null ? user.legacy_id : user.id);   // profiles: legacy_id; app users: id
  return true;
}

// A small in-memory notification store with the server's de-duplication rules (used by the local mock and the tests).
export function createNotificationStore() {
  const events = [];          // {id, jobNo, event, seq, at, summary}
  const notes = [];           // {id, eventId, recipient, readAt}
  let eid = 0, nid = 0;
  return {
    // record events for a jobOrders write; users = the stored account list; returns the new notifications
    recordWrite(prev, next, users, at) {
      const created = [];
      for (const e of joEventsFromDiff(prev, next)) {
        const seq = events.filter(x => x.jobNo === e.jobNo && x.event === e.event).length + 1;
        const ev = { id: ++eid, jobNo: e.jobNo, event: e.event, seq, at: at || new Date().toISOString(),
          summary: { assetNum: e.jo.assetNum || '', assetDesc: e.jo.assetDesc || '', dept: e.jo.dept || '', section: e.jo.section || '' } };
        events.push(ev);
        for (const u of Array.isArray(users) ? users : []) {
          if (!isRecipient(u, e.event, e.jo)) continue;
          if (notes.some(n => n.eventId === ev.id && n.recipient === u.id)) continue;   // unique (event, recipient)
          const n = { id: ++nid, eventId: ev.id, recipient: u.id, readAt: null }; notes.push(n); created.push(n);
        }
      }
      return created;
    },
    list(recipient, limit = 50) {
      return notes.filter(n => n.recipient === recipient).sort((a, b) => b.id - a.id).slice(0, limit)
        .map(n => { const ev = events.find(e => e.id === n.eventId); return { id: n.id, jobNo: ev.jobNo, event: ev.event, at: ev.at, read: !!n.readAt, ...ev.summary }; });
    },
    markRead(recipient, ids, at) {   // only the recipient's own notifications; returns how many changed
      let c = 0; const set = Array.isArray(ids) ? new Set(ids) : null;
      notes.forEach(n => { if (n.recipient === recipient && !n.readAt && (!set || set.has(n.id))) { n.readAt = at || new Date().toISOString(); c++; } });
      return c;
    },
    _state: () => ({ events, notes }),
  };
}
