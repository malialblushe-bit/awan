/**
 * Launch.js — أعوان: تهيئة الإطلاق (لمشرف النظام فقط).
 *  - الجرد: عدد السجلات وأول وآخر تاريخ لكل جدول، وتصنيفه (يبقى / يُمسح)، وأسماء البيانات الأساسية للمراجعة.
 *  - المسح: نسخة احتياطية من ملف البيانات في Drive، ثم تفريغ الجداول التشغيلية وتصفير ترقيمها. لا يعمل إلا بكلمة «إطلاق».
 */
var Launch = (function () {
  var TZ = 'Asia/Riyadh';
  var KEEP = {
    Settings: 'الإعدادات', Hotels: 'الفنادق', Floors: 'الأدوار', Rooms: 'الغرف والمرافق', Elevators: 'المصاعد', Users: 'المستخدمون',
    Contractors: 'المتعهدون', Contracts: 'العقود', Lists: 'القوائم والبنود', Thresholds: 'العتبات', PestSchedule: 'جدولة المكافحة'
  };
  var CLEAR = {
    WorkOrders: 'أوامر العمل', WorkOrdersArchive: 'أرشيف أوامر العمل', WOLog: 'سجل الإجراءات', Arrivals: 'تسجيل الوصول', KpiSummary: 'ملخص المؤشرات',
    CorrectiveActions: 'الإجراءات التصحيحية', Notes: 'الملاحظات', WasteVisits: 'زيارات النفايات', WaterLoads: 'رحلات المياه', PestLogs: 'معالجات المكافحة',
    PestFlags: 'بلاغات المكافحة', Traps: 'المصائد', Evaluations: 'التقييمات الدورية', Tickets: 'تذاكر تجربة الأعوان', OrgEvals: 'تقييم المتعهدين لنا', Claims: 'المطالبات والسداد', SupRatings: 'رضا الإشراف الشهري', PcReports: 'تقارير المكافحة الشهرية', PestMsgs: 'حالات المكافحة وتقاريرها الفنية'
  };
  var DATE_COLS = ['created_at', 'at', 'placed_at', 'arrived_at', 'updated_at'];

  function ms(v) { var t = v instanceof Date ? v.getTime() : (v ? new Date(v).getTime() : NaN); return isNaN(t) ? null : t; }

  function inventory() {
    var out = [];
    SCHEMA.forEach(function (t) {
      var name = t.name, rows = [];
      try { rows = Db.all(name); } catch (e) { rows = []; }
      var col = null, cols = t.cols.map(function (c) { return c[0]; });
      DATE_COLS.some(function (c) { if (cols.indexOf(c) !== -1) { col = c; return true; } return false; });
      var a = null, b = null;
      if (col) rows.forEach(function (r) { var x = ms(r[col]); if (x == null) return; if (a == null || x < a) a = x; if (b == null || x > b) b = x; });
      out.push({ table: name, label: KEEP[name] || CLEAR[name] || name, kind: CLEAR[name] ? 'clear' : 'keep', rows: rows.length, from: a, to: b });
    });
    var R = Orders.refs();
    var review = {
      hotels: Db.all('Hotels').map(function (h) { return { id: h.hotel_id, name: h.name, code: h.code }; }),
      cons: Db.all('Contractors').map(function (c) {
        return { id: c.con_id, name: c.name, type: c.type, contracts: Db.all('Contracts', function (x) { return x.con_id === c.con_id; }).length };
      }),
      users: Db.all('Users').map(function (u) { return { name: u.name, role: u.role, username: u.username }; }),
      pendingLists: Db.all('Lists', function (l) { return l.status === 'pending'; }).length
    };
    var mf = Db.setting('measure_from'); mf = mf instanceof Date ? Utilities.formatDate(mf, 'Asia/Riyadh', 'yyyy-MM-dd') : String(mf || Kpi.LIVE_DEFAULT).slice(0, 10);
    var perf = []; try { perf = JSON.parse(PropertiesService.getScriptProperties().getProperty('PERF_LOG') || '[]'); } catch (e) { }
    return { tables: out, review: review, measureFrom: mf, perf: perf.slice().reverse(), cap: capacity(), clearCount: out.filter(function (x) { return x.kind === 'clear'; }).reduce(function (s, x) { return s + x.rows; }, 0) };
  }

  // ───────── النطاق: الفنادق · المتعهدون · الفئات · الجداول (فارغ = الكل) ─────────
  // ما لا يُعرف نطاقه (فندقه أو متعهده أو فئته) لا يُمسح حين يكون ذلك المرشّح مفعّلاً: الأمان أولاً.
  var FIXED_CAT = { WasteVisits: 'wa', WaterLoads: 'wt', PestLogs: 'pc', PestFlags: 'pc', Traps: 'pc', PcReports: 'pc', PestMsgs: 'pc' };
  function csv_(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function norm_(sc) {
    sc = sc || {};
    var tables = (Array.isArray(sc.tables) ? sc.tables : Object.keys(CLEAR)).filter(function (t) { return CLEAR[t]; });
    // ملخص المؤشرات يتبع أوامر العمل دائماً حتى لا تبقى أرقام لعمليات ممسوحة
    if (tables.indexOf('WorkOrders') !== -1 && tables.indexOf('KpiSummary') === -1) tables.push('KpiSummary');
    return { hotels: sc.hotels || [], cons: sc.cons || [], types: sc.types || [], tables: tables };
  }
  function ctx_() {
    var cons = {}, ctr = {}, wo = {};
    Db.all('Contractors').forEach(function (c) { cons[c.con_id] = c; });
    Db.all('Contracts').forEach(function (c) { ctr[c.contract_id] = c; });
    ['WorkOrders', 'WorkOrdersArchive'].forEach(function (t) { try { Db.all(t).forEach(function (o) { wo[o.wo_id] = o; }); } catch (e) {} });
    // متعهد المكافحة لكل فندق (لبلاغات المكافحة والمصائد التي لا تحمل متعهداً)
    var pcOf = {};
    Object.keys(ctr).forEach(function (k) { var c = ctr[k]; if (c.type !== 'pc') return; csv_(c.hotel_ids).forEach(function (h) { (pcOf[h] = pcOf[h] || []).push(c.con_id); }); });
    return { cons: cons, ctr: ctr, wo: wo, pcOf: pcOf };
  }
  /** نطاق السجل: فنادقه ومتعهده وفئته (null = غير معروف) */
  function dims_(t, r, X) {
    var o = r.wo_id ? X.wo[r.wo_id] : null, c = r.contract_id ? X.ctr[r.contract_id] : null;
    var hotels = r.hotel_id ? [r.hotel_id] : r.hotel_ids ? csv_(r.hotel_ids) : o ? [o.hotel_id] : c ? csv_(c.hotel_ids) : null;
    var con = r.con_id || (o && o.con_id) || (c && c.con_id) || null;
    var cons = con ? [con] : (FIXED_CAT[t] === 'pc' && hotels ? [].concat.apply([], hotels.map(function (h) { return X.pcOf[h] || []; })) : null);
    var cat = FIXED_CAT[t] || ((t === 'WorkOrders' || t === 'WorkOrdersArchive' || t === 'Evaluations') ? r.type : null) || (o && o.type) || (c && c.type) || (con && X.cons[con] ? X.cons[con].type : null);
    if (!cat && t === 'Notes') cat = r.service === 'sup' ? ['wa', 'pc'] : r.service === 'maint' ? ['ac', 'el', 'sf'] : null;
    return { hotels: hotels, cons: cons, cats: cat == null ? null : [].concat(cat) };
  }
  function hit_(d, sc) {
    var any = function (list, want) { return !want.length || (!!list && list.some(function (x) { return want.indexOf(x) !== -1; })); };
    return any(d.hotels, sc.hotels) && any(d.cons, sc.cons) && any(d.cats, sc.types);
  }
  function scoped_(sc) { return sc.hotels.length || sc.cons.length || sc.types.length; }
  /** المعاينة: كم سجلاً سيُمسح من كل جدول بهذا النطاق */
  function plan(scope) {
    var sc = norm_(scope), X = ctx_(), out = [], total = 0;
    Object.keys(CLEAR).forEach(function (t) {
      var rows = []; try { rows = Db.all(t); } catch (e) {}
      var on = sc.tables.indexOf(t) !== -1, n = on ? rows.filter(function (r) { return hit_(dims_(t, r, X), sc); }).length : 0;
      total += n; out.push({ table: t, label: CLEAR[t], rows: rows.length, n: n, on: on });
    });
    return { tables: out, total: total, scoped: !!scoped_(sc) };
  }

  /** النسخة الاحتياطية ثم المسح بالنطاق المختار؛ يُصفَّر ترقيم الجدول إذا فرغ كله فقط */
  function reset(word, scope) {
    if (String(word || '').trim() !== 'إطلاق') throw new Error('اكتب كلمة «إطلاق» للتأكيد.');
    var sc = norm_(scope);
    if (!sc.tables.length) throw new Error('اختر جدولاً واحداً على الأقل للمسح.');
    var file = DriveApp.getFileById(Db.ss().getId());
    var copy = file.makeCopy('أعوان — نسخة قبل الإطلاق ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
    var props = PropertiesService.getScriptProperties(), done = [], X = ctx_(), part = !!scoped_(sc);
    sc.tables.forEach(function (name) {
      var rows; try { rows = Db.all(name); } catch (e) { return; }
      var keep = rows.filter(function (r) { return !hit_(dims_(name, r, X), sc); }), n = rows.length - keep.length;
      if (!n) return;
      Db.rewrite(name, keep);
      if (!keep.length) props.deleteProperty('SEQ_' + name);
      done.push({ table: CLEAR[name], rows: n });
    });
    if (!part && sc.tables.indexOf('WorkOrders') !== -1) props.deleteProperty('TG_PEND');
    // مسح جزئي يمس العمليات: تُعاد المؤشرات من الباقي
    if (part && (sc.tables.indexOf('WorkOrders') !== -1 || sc.tables.indexOf('WorkOrdersArchive') !== -1)) { try { Db.reset(); Kpi.rebuild(); } catch (e) {} }
    return { backup: copy.getName(), backupUrl: copy.getUrl(), cleared: done };
  }

  /** مؤشرات السعة: مساحة Drive للحساب، وخلايا ملف البيانات (الحد 10 ملايين) */
  var WARN = 70, CELL_LIMIT = 10000000;
  function capacity() {
    var out = { warn: WARN, drive: null };
    try {
      var u = DriveApp.getStorageUsed(), l = DriveApp.getStorageLimit();
      out.drive = { used: u, limit: l, pct: l ? Math.round(1000 * u / l) / 10 : null };
    } catch (e) { out.drive = null; }
    var cells = 0, sheets = [];
    Db.ss().getSheets().forEach(function (sh) { var n = sh.getMaxRows() * sh.getMaxColumns(); cells += n; sheets.push({ name: sh.getName(), cells: n }); });
    sheets.sort(function (a, b) { return b.cells - a.cells; });
    out.cells = { used: cells, limit: CELL_LIMIT, pct: Math.round(1000 * cells / CELL_LIMIT) / 10, top: sheets.slice(0, 5) };
    return out;
  }
  /** ليلياً: تنبيه بالبريد لمشرفي النظام عند بلوغ 70% (مرة في الأسبوع على الأكثر) */
  function capAlert() {
    var c = capacity(), hot = [];
    if (c.drive && c.drive.pct >= WARN) hot.push('مساحة Drive ' + c.drive.pct + '%');
    if (c.cells.pct >= WARN) hot.push('خلايا ملف البيانات ' + c.cells.pct + '%');
    if (!hot.length) return false;
    var props = PropertiesService.getScriptProperties(), last = Number(props.getProperty('CAP_ALERT') || 0);
    if (Date.now() - last < 7 * 864e5) return false;
    var to = Db.all('Users', function (u) { return u.role === 'admin' && u.email; }).map(function (u) { return u.email; }).join(',');
    if (!to) return false;
    var txt = 'تنبيه سعة أعوان: ' + hot.join(' · ') + '. راجع الإدارة ← تهيئة الإطلاق ← السعة.';
    try { Mail.send({ to: to, subject: 'أعوان · تنبيه السعة', text: txt, html: '<div dir="rtl" style="font-family:Tahoma,Arial;font-size:15px">' + txt + '</div>' }, ''); } catch (e) { return false; }
    props.setProperty('CAP_ALERT', String(Date.now()));
    return true;
  }

  return { inventory: inventory, plan: plan, reset: reset, capacity: capacity, capAlert: capAlert, KEEP: KEEP, CLEAR: CLEAR };
})();

function apiAdmLaunchInventory(token) { Auth.need(token, ['admin']); return Launch.inventory(); }
function apiAdmLaunchPlan(token, scope) { Auth.need(token, ['admin']); return Launch.plan(scope); }
function apiAdmLaunchReset(token, word, scope) {
  Auth.need(token, ['admin']);
  return Db.withLock(function () { var r = Launch.reset(word, scope); Db.reset(); r.inv = Launch.inventory(); r.boot = admBoot_(); return r; });
}
