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

  function load_(table) {
    if (memo[table]) return memo[table];
    var sh = sheet_(table);
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    var values = lastRow ? sh.getRange(1, 1, lastRow, Math.max(lastCol, 1)).getValues() : [[]];
    var head = values[0].map(String);
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

  function keyOf_(table) { return tableDef(table).cols[0][0]; }

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
    var t = load_(table), sh = sheet_(table), k = keyOf_(table);
    var ids = recs.some(function (r) { return !r[k]; }) ? nextIds_(table, recs.length) : [];
    recs.forEach(function (r, i) { if (!r[k]) r[k] = ids[i]; });
    var rows = recs.map(function (r) { return toRow_(t.head, r); });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, t.head.length).setValues(rows);
    recs.forEach(function (r) { t.rows.push(toObj_(t.head, toRow_(t.head, r).map(function (v) { return (typeof v === 'string' && v.charAt(0) === "'") ? v.slice(1) : v; }))); });
    return recs;
  }

  function insert(table, rec) { return insertMany(table, [rec])[0]; }

  function update(table, id, patch) {
    var t = load_(table), k = keyOf_(table);
    var idx = -1;
    for (var i = 0; i < t.rows.length; i++) if (t.rows[i][k] === id) { idx = i; break; }
    if (idx < 0) throw new Error('سجل غير موجود: ' + table + ' ' + id);
    var rec = t.rows[idx];
    Object.keys(patch).forEach(function (f) { rec[f] = patch[f]; });
    sheet_(table).getRange(idx + 2, 1, 1, t.head.length).setValues([toRow_(t.head, rec)]);
    return rec;
  }

  /** يعدّل كل السجلات المطابقة (لجداول بلا معرّف فريد مثل العتبات) */
  function updateWhere(table, pred, patch) {
    var t = load_(table), sh = sheet_(table), n = 0;
    t.rows.forEach(function (rec, i) {
      if (!pred(rec)) return;
      Object.keys(patch).forEach(function (f) { rec[f] = patch[f]; });
      sh.getRange(i + 2, 1, 1, t.head.length).setValues([toRow_(t.head, rec)]);
      n++;
    });
    return n;
  }

  /** يحذف سجلاً بمعرّفه (للتصحيح في الإعداد فقط) */
  function remove(table, id) {
    var t = load_(table), k = keyOf_(table);
    for (var i = 0; i < t.rows.length; i++) {
      if (t.rows[i][k] === id) { sheet_(table).deleteRow(i + 2); t.rows.splice(i, 1); return true; }
    }
    return false;
  }

  function withLock(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('النظام مشغول لحظياً، حاول مرة أخرى.');
    try { return fn(); } finally { lock.releaseLock(); }
  }

  function setting(key) {
    var r = find('Settings', function (x) { return x.key === key; });
    return r ? r.value : '';
  }

  function reset() { memo = {}; ssCache = null; }

  return { ss: ss, all: all, find: find, get: get, insert: insert, insertMany: insertMany, update: update, updateWhere: updateWhere, remove: remove, withLock: withLock, setting: setting, reset: reset };
})();
