/**
 * Db.js — أعوان: طبقة الوصول للبيانات (ملف بيانات واحد).
 * كل الموديولات تمر من هنا فقط، فيُستبدل هذا الملف وحده إن انتقلنا لقاعدة بيانات أخرى.
 *   Db.all(table, filterFn?)  Db.find(table, pred)  Db.get(table, id)
 *   Db.insert(table, rec)  Db.insertMany(table, recs)  Db.update(table, id, patch)
 *   Db.withLock(fn)  Db.setting(key)
 * تقليل الطلبات: كل جدول يُقرأ بعملية واحدة ويُحفظ للتنفيذ الحالي، والكتابة الجماعية بعملية واحدة.
 */

var Db = (function () {
  var memo = {};
  var ssCache = null;
  // البحث بالفهرس: الجداول الكبيرة يُوصل لسجلها بالمعرّف مباشرة (TextFinder داخل الجدول)
  // فيُقرأ صف واحد بدل الجدول كاملاً، ما لم يكن الجدول محمّلاً أصلاً في هذا التنفيذ.
  var INDEXED = { WorkOrders: true, WorkOrdersArchive: true };
  var rowMemo = {}, heads = {};

  function ss() {
    if (ssCache) return ssCache;
    var id = PropertiesService.getScriptProperties().getProperty('DATA_ID');
    if (id) return (ssCache = SpreadsheetApp.openById(id));
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) throw new Error('ملف البيانات غير معرّف. شغّل "إعداد أعوان" من قائمة أعوان أولاً.');
    return (ssCache = active);
  }

  function sheet_(table) {
    var sh = ss().getSheetByName(table);
    if (!sh) throw new Error('الورقة غير موجودة: ' + table + '. شغّل مزامنة الهيكل.');
    return sh;
  }

  // ── (أ) الجداول المرجعية في ذاكرة Google المؤقتة: تتغير نادراً وتُقرأ في كل عملية.
  // لكل جدول رقم إصدار في خصائص السكربت (RV_<الجدول>) يتجدد مع كل كتابة، فلا تُقرأ نسخة قديمة أبداً.
  var REF = { Settings: 1, Hotels: 1, Floors: 1, Rooms: 1, Elevators: 1, Contractors: 1, Contracts: 1, Lists: 1, Users: 1, Thresholds: 1, PestSchedule: 1 };
  var CACHE_TTL = 1800, CHUNK = 40000, vers = null;
  function cache_() { try { return CacheService.getScriptCache(); } catch (e) { return null; } }
  function ver_(table) {
    if (!vers) { try { vers = PropertiesService.getScriptProperties().getProperties() || {}; } catch (e) { vers = {}; } }
    return vers['RV_' + table] || '0';
  }
  function bump_(table) {
    if (!REF[table]) return;
    var v = String(Date.now()) + Math.floor(Math.random() * 1000);
    try { PropertiesService.getScriptProperties().setProperty('RV_' + table, v); } catch (e) { }
    if (vers) vers['RV_' + table] = v;
  }
  /** يجدد إصدار كل الجداول المرجعية (بعد تعديل يدوي في ملف البيانات أو مزامنة الهيكل) */
  function refreshRef() { Object.keys(REF).forEach(bump_); }
  function enc_(values) { return JSON.stringify(values, function (k, v) { var raw = this[k]; return raw instanceof Date ? { $d: raw.getTime() } : v; }); }
  function dec_(str) { return JSON.parse(str, function (k, v) { return v && typeof v === 'object' && v.$d != null && Object.keys(v).length === 1 ? new Date(v.$d) : v; }); }
  function cacheGet_(table) {
    var c = cache_(); if (!c) return null;
    try {
      var base = 'R:' + table + ':' + ver_(table), n = Number(c.get(base) || 0);
      if (!n) return null;
      var keys = []; for (var i = 0; i < n; i++) keys.push(base + ':' + i);
      var got = c.getAll(keys), str = '';
      for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; str += got[keys[j]]; }
      return dec_(str);
    } catch (e) { return null; }
  }
  function cachePut_(table, values) {
    var c = cache_(); if (!c) return;
    try {
      var base = 'R:' + table + ':' + ver_(table), str = enc_(values), m = {}, n = Math.ceil(str.length / CHUNK) || 1;
      if (n > 20) return; // جدول أكبر من المعقول للذاكرة المؤقتة: يُقرأ من الملف
      for (var i = 0; i < n; i++) m[base + ':' + i] = str.slice(i * CHUNK, (i + 1) * CHUNK);
      c.putAll(m, CACHE_TTL); c.put(base, String(n), CACHE_TTL);
    } catch (e) { }
  }

  function load_(table) {
    if (memo[table]) return memo[table];
    if (REF[table]) {
      var cv = cacheGet_(table);
      if (cv && cv.length) {
        var ch = cv[0].map(String);
        memo[table] = { head: ch, rows: cv.slice(1).map(function (v) { return toObj_(ch, v); }) };
        if (typeof Perf !== 'undefined') Perf.cached = (Perf.cached || 0) + 1;
        return memo[table];
      }
    }
    var t0 = Date.now(), sh = sheet_(table);
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    var values = lastRow ? sh.getRange(1, 1, lastRow, Math.max(lastCol, 1)).getValues() : [[]];
    if (typeof Perf !== 'undefined') { var dt = Date.now() - t0; Perf.reads++; Perf.readMs += dt; Perf.tables[table] = (Perf.tables[table] || 0) + dt; }
    var head = values[0].map(String);
    if (REF[table]) cachePut_(table, values);
    var rows = values.slice(1).map(function (v) { return toObj_(head, v); });
    memo[table] = { head: head, rows: rows };
    return memo[table];
  }

  function toObj_(head, v) {
    var o = {};
    for (var i = 0; i < head.length; i++) if (head[i]) o[head[i]] = v[i];
    return o;
  }

  function toRow_(head, o) {
    return head.map(function (k) {
      var v = o[k];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
      // نص من أرقام (جوال، رقم غرفة يبدأ بصفر) يُحفظ كنص كما كُتب
      if (typeof v === 'string' && /^[+0-9][0-9 ]*$/.test(v)) return "'" + v;
      return v;
    });
  }

  /** القيمة في الذاكرة كما تعود من الجدول بعد الكتابة (الكائن نصاً JSON، والفارغ نصاً فارغاً) */
  function norm_(v) { if (v === undefined || v === null) return ''; if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v); return v; }
  function keyOf_(table) { return tableDef(table).cols[0][0]; }

  function head_(table) {
    if (memo[table]) return memo[table].head;
    if (!heads[table]) { var sh = sheet_(table); heads[table] = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String); }
    return heads[table];
  }

  /** موضع السجل بمعرّفه: {r: رقم الصف في الورقة، rec} — يقرأ عمود المعرّف داخل Sheets ثم الصف وحده */
  function locate_(table, id) {
    var rm = rowMemo[table] || (rowMemo[table] = {});
    if (rm[id]) return rm[id];
    var sh = sheet_(table), last = sh.getLastRow();
    if (last < 2 || id == null || id === '') return null;
    var cell = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
    if (!cell) return null;
    var r = cell.getRow(), head = head_(table);
    var rec = toObj_(head, sh.getRange(r, 1, 1, head.length).getValues()[0]);
    if (rec[keyOf_(table)] !== id) return null;
    return (rm[id] = { r: r, rec: rec });
  }

  function all(table, filterFn) {
    var rows = load_(table).rows;
    return filterFn ? rows.filter(filterFn) : rows.slice();
  }

  function find(table, pred) {
    var rows = load_(table).rows;
    for (var i = 0; i < rows.length; i++) if (pred(rows[i])) return rows[i];
    return null;
  }

  function get(table, id) {
    if (INDEXED[table] && !memo[table]) { var x = locate_(table, id); return x ? x.rec : null; }
    var k = keyOf_(table);
    return find(table, function (r) { return r[k] === id; });
  }

  /** يحجز n معرّفات متتالية بعملية قراءة/كتابة واحدة على الإعدادات */
  function nextIds_(table, n) {
    var props = PropertiesService.getScriptProperties();
    var key = 'SEQ_' + table;
    var cur = Number(props.getProperty(key) || 0);
    props.setProperty(key, String(cur + n));
    var out = [];
    for (var i = 1; i <= n; i++) out.push(ID_PREFIX[table] + '-' + ('00000' + (cur + i)).slice(-5));
    return out;
  }

  function insertMany(table, recs) {
    if (!recs.length) return [];
    // الإضافة لا تحتاج قراءة الجدول: الترويسة فقط
    var t = memo[table] || { head: head_(table), rows: null }, sh = sheet_(table), k = keyOf_(table);
    var ids = recs.some(function (r) { return !r[k]; }) ? nextIds_(table, recs.length) : [];
    recs.forEach(function (r, i) { if (!r[k]) r[k] = ids[i]; });
    var rows = recs.map(function (r) { return toRow_(t.head, r); });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, t.head.length).setValues(rows);
    bump_(table);
    if (t.rows) recs.forEach(function (r) { t.rows.push(toObj_(t.head, toRow_(t.head, r).map(function (v) { return (typeof v === 'string' && v.charAt(0) === "'") ? v.slice(1) : v; }))); });
    return recs;
  }

  function insert(table, rec) { return insertMany(table, [rec])[0]; }

  function update(table, id, patch) {
    if (INDEXED[table] && !memo[table]) {
      var x = locate_(table, id);
      if (!x) throw new Error('سجل غير موجود: ' + table + ' ' + id);
      Object.keys(patch).forEach(function (f) { x.rec[f] = norm_(patch[f]); });
      var hd = head_(table);
      sheet_(table).getRange(x.r, 1, 1, hd.length).setValues([toRow_(hd, x.rec)]);
      return x.rec;
    }
    var t = load_(table), k = keyOf_(table);
    var idx = -1;
    for (var i = 0; i < t.rows.length; i++) if (t.rows[i][k] === id) { idx = i; break; }
    if (idx < 0) throw new Error('سجل غير موجود: ' + table + ' ' + id);
    var rec = t.rows[idx];
    Object.keys(patch).forEach(function (f) { rec[f] = norm_(patch[f]); });
    sheet_(table).getRange(idx + 2, 1, 1, t.head.length).setValues([toRow_(t.head, rec)]);
    bump_(table);
    return rec;
  }

  /** يعدّل كل السجلات المطابقة (لجداول بلا معرّف فريد مثل العتبات) */
  function updateWhere(table, pred, patch) {
    var t = load_(table), sh = sheet_(table), n = 0;
    t.rows.forEach(function (rec, i) {
      if (!pred(rec)) return;
      Object.keys(patch).forEach(function (f) { rec[f] = norm_(patch[f]); });
      sh.getRange(i + 2, 1, 1, t.head.length).setValues([toRow_(t.head, rec)]);
      n++;
    });
    if (n) bump_(table);
    return n;
  }

  /** يحذف سجلاً بمعرّفه (للتصحيح في الإعداد فقط) */
  function remove(table, id) {
    var t = load_(table), k = keyOf_(table);
    for (var i = 0; i < t.rows.length; i++) {
      if (t.rows[i][k] === id) { sheet_(table).deleteRow(i + 2); t.rows.splice(i, 1); rowMemo[table] = {}; bump_(table); return true; }
    }
    return false;
  }

  var lockDepth = 0;
  /** قفل واحد للكتابة؛ متداخل بأمان داخل نفس التنفيذ */
  var afterQ = [];
  /** ينفّذ fn بعد فك القفل الحالي (أو فوراً إن لم يكن قفل) */
  function afterLock(fn) { if (lockDepth > 0) afterQ.push(fn); else fn(); }
  function withLock(fn) {
    if (lockDepth > 0) return fn();
    var lock = LockService.getScriptLock(), w0 = Date.now();
    if (!lock.tryLock(20000)) throw new Error('النظام مشغول لحظياً، حاول مرة أخرى.');
    if (typeof Perf !== 'undefined') Perf.wait += Date.now() - w0;
    lockDepth++;
    try { return fn(); } finally {
      lockDepth--; lock.releaseLock();
      // الاتصالات الخارجية (تيليجرام) بعد فك القفل، حتى لا ينتظر بقية المستخدمين ردّ تيليجرام
      var q = afterQ; afterQ = []; q.forEach(function (cb) { try { cb(); } catch (e) { } });
    }
  }

  function setting(key) {
    var r = find('Settings', function (x) { return x.key === key; });
    return r ? r.value : '';
  }

  function reset() { memo = {}; ssCache = null; rowMemo = {}; heads = {}; vers = null; }

  /** يستبدل كل صفوف الجدول بعملية كتابة واحدة (للأرشفة) */
  function rewrite(table, rows) {
    var t = load_(table), sh = sheet_(table), last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, t.head.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, t.head.length).setValues(rows.map(function (r) { return toRow_(t.head, r); }));
    t.rows = rows.map(function (r) { return toObj_(t.head, toRow_(t.head, r).map(function (v) { return (typeof v === 'string' && v.charAt(0) === "'") ? v.slice(1) : v; })); });
    rowMemo[table] = {};
    bump_(table);
  }

  return { ss: ss, all: all, find: find, get: get, insert: insert, insertMany: insertMany, update: update, updateWhere: updateWhere, remove: remove, rewrite: rewrite, withLock: withLock, afterLock: afterLock, setting: setting, reset: reset, refreshRef: refreshRef, locked: function () { return lockDepth > 0; } };
})();
