/**
 * Setup.js — أعوان: إعداد ملف البيانات ومزامنة هيكله مع SCHEMA.
 * آمن للتكرار: ينشئ الناقص ويضيف الأعمدة الناقصة، ولا يحذف أي بيانات.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('أعوان')
    .addItem('1) إعداد أعوان', 'setupAwan')
    .addItem('2) إنشاء حساب المشرف', 'createAdminPrompt')
    .addSeparator()
    .addItem('مزامنة الهيكل', 'syncSchema')
    .addToUi();
}

/** يُشغَّل مرة واحدة من داخل ملف البيانات */
function setupAwan() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('DATA_ID', ss.getId());
  ss.setSpreadsheetTimeZone('Asia/Riyadh');

  var report = ensureTables_(ss);
  removeDefaultSheet_(ss);
  Db.reset();

  seedIfEmpty_('Settings', SEED_SETTINGS.map(function (r) { return { key: r[0], value: r[1], note: r[2] }; }));
  seedIfEmpty_('Thresholds', SEED_THRESHOLDS.map(function (r) { return { type: r[0], kpi: r[1], full: r[2], half: r[3], weight: r[4] }; }));
  seedIfEmpty_('Lists', SEED_LISTS.map(function (r, i) { return { type: r[0], list: r[1], ar: r[2], en: r[3], status: 'active', created_by: 'system', sort: i + 1 }; }));
  ensurePhotosFolder_(ss);

  return done_('تم إعداد أعوان', report);
}

function syncSchema() {
  var report = ensureTables_(Db.ss());
  return done_('تمت مزامنة الهيكل', report);
}

function ensureTables_(ss) {
  var report = [];
  SCHEMA.forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    var names = t.cols.map(function (c) { return c[0]; });
    if (!sh) {
      sh = ss.insertSheet(t.name);
      sh.getRange(1, 1, 1, names.length).setValues([names]).setFontWeight('bold').setBackground('#1F3A5F').setFontColor('#FFFFFF');
      sh.getRange(1, 1, 1, names.length).setNotes([t.cols.map(function (c) { return c[1]; })]);
      sh.setFrozenRows(1);
      sh.setRightToLeft(true);
      report.push('أُنشئ: ' + t.name);
      return;
    }
    var lastCol = sh.getLastColumn();
    var head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    var missing = t.cols.filter(function (c) { return head.indexOf(c[0]) === -1; });
    if (missing.length) {
      var start = head.length + 1;
      sh.getRange(1, start, 1, missing.length).setValues([missing.map(function (c) { return c[0]; })]).setFontWeight('bold').setBackground('#1F3A5F').setFontColor('#FFFFFF');
      sh.getRange(1, start, 1, missing.length).setNotes([missing.map(function (c) { return c[1]; })]);
      report.push(t.name + ': أُضيفت ' + missing.length + ' أعمدة');
    }
  });
  return report;
}

function removeDefaultSheet_(ss) {
  ss.getSheets().forEach(function (sh) {
    if (/^(Sheet1|الورقة1|ورقة1)$/.test(sh.getName()) && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function seedIfEmpty_(table, recs) {
  if (Db.all(table).length) return;
  Db.insertMany(table, recs);
}

function ensurePhotosFolder_(ss) {
  if (Db.setting('photos_folder_id')) return;
  var parents = DriveApp.getFileById(ss.getId()).getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var folder = parent.createFolder('أعوان — الصور');
  var row = Db.find('Settings', function (r) { return r.key === 'photos_folder_id'; });
  Db.update('Settings', row.key, { value: folder.getId() });
}

function done_(title, report) {
  var msg = title + (report.length ? '\n\n' + report.join('\n') : '\n\nالهيكل مطابق.');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* خارج الواجهة (الاختبار) */ }
  return msg;
}
