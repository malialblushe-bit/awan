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
    PestFlags: 'بلاغات المكافحة', Traps: 'المصائد', Evaluations: 'التقييمات الدورية', Tickets: 'تذاكر تجربة الأعوان', OrgEvals: 'تقييم المتعهدين لنا', Claims: 'المطالبات والسداد', SupRatings: 'رضا الإشراف الشهري', PcReports: 'تقارير المكافحة الشهرية'
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
      hotels: Db.all('Hotels').map(function (h) { return { name: h.name, code: h.code }; }),
      cons: Db.all('Contractors').map(function (c) {
        return { name: c.name, type: c.type, contracts: Db.all('Contracts', function (x) { return x.con_id === c.con_id; }).length };
      }),
      users: Db.all('Users').map(function (u) { return { name: u.name, role: u.role, username: u.username }; }),
      pendingLists: Db.all('Lists', function (l) { return l.status === 'pending'; }).length
    };
    return { tables: out, review: review, cap: capacity(), clearCount: out.filter(function (x) { return x.kind === 'clear'; }).reduce(function (s, x) { return s + x.rows; }, 0) };
  }

  /** النسخة الاحتياطية ثم المسح وتصفير الترقيم */
  function reset(word) {
    if (String(word || '').trim() !== 'إطلاق') throw new Error('اكتب كلمة «إطلاق» للتأكيد.');
    var file = DriveApp.getFileById(Db.ss().getId());
    var copy = file.makeCopy('أعوان — نسخة قبل الإطلاق ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
    var props = PropertiesService.getScriptProperties(), done = [];
    Object.keys(CLEAR).forEach(function (name) {
      var n = 0;
      try { n = Db.all(name).length; Db.rewrite(name, []); } catch (e) { return; }
      props.deleteProperty('SEQ_' + name);
      done.push({ table: CLEAR[name], rows: n });
    });
    props.deleteProperty('TG_PEND');
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

  return { inventory: inventory, reset: reset, capacity: capacity, capAlert: capAlert, KEEP: KEEP, CLEAR: CLEAR };
})();

function apiAdmLaunchInventory(token) { Auth.need(token, ['admin']); return Launch.inventory(); }
function apiAdmLaunchReset(token, word) {
  Auth.need(token, ['admin']);
  return Db.withLock(function () { var r = Launch.reset(word); Db.reset(); r.inv = Launch.inventory(); r.boot = admBoot_(); return r; });
}
