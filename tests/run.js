/**
 * tests/run.js — فحص كود أعوان على محاكاة لخدمات Google (بدون إنترنت أو حساب).
 * التشغيل: node tests/run.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ───────── محاكاة خدمات Google ─────────
let idSeq = 0;
const newId = (p) => p + '_' + (++idSeq);
const files = {};      // id → Spreadsheet
const folders = {};    // id → Folder
const log = [];

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sh.grid[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error(`setValues size mismatch: range ${this.nr}x${this.nc}, data ${v.length}x${v[0].length}`);
    v.forEach((row, i) => row.forEach((x, j) => {
      const R = this.r - 1 + i;
      this.sh.grid[R] = this.sh.grid[R] || [];
      this.sh.grid[R][this.c - 1 + j] = (typeof x === 'string' && x.charAt(0) === "'") ? x.slice(1) : x;
    }));
    this.sh.ss.writes++;
    return this;
  }
  setValue(x) { return this.setValues([[x]]); }
  clearContent() { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(''))); }
  setNotes() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.grid = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.grid.length - 1; i >= 0; i--) if ((this.grid[i] || []).some(v => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.grid.forEach(r => (r || []).forEach((v, j) => { if (v !== '' && v !== undefined) m = Math.max(m, j + 1); }));
    return m;
  }
  getRange(r, c, nr, nc) {
    if (r < 1 || c < 1 || nr === 0 || nc === 0) throw new Error(`bad range ${r},${c},${nr},${nc}`);
    this.ss.reads++;
    return new Range(this, r, c, nr, nc);
  }
  setFrozenRows() {} setRightToLeft() {} setTabColor() {}
  getProtections() { return this.prot ? [this.prot] : []; }
  protect() { const p = { setDescription: () => p, setWarningOnly: () => p }; this.prot = p; return p; }
}

class Spreadsheet {
  constructor(name) { this.id = newId('ss'); this.name = name; this.sheets = [new Sheet(this, 'Sheet1')]; this.reads = 0; this.writes = 0; files[this.id] = this; }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheets() { return this.sheets; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setSpreadsheetTimeZone() {}
}

class Folder {
  constructor(name) { this.id = newId('fd'); this.name = name; this.children = []; folders[this.id] = this; }
  getId() { return this.id; }
  createFolder(n) { const f = new Folder(n); this.children.push(f); return f; }
  createFile(blob) { const id = newId('file'); this.children.push({ name: blob.name, id }); return { getId: () => id }; }
  getFoldersByName(n) { const m = this.children.filter(f => f.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; }
}

const rootFolder = new Folder('root');
const projectFolder = rootFolder.createFolder('Project');
const masterSs = new Spreadsheet('أعوان — البيانات');
const props = {};
const sentMail = [];
const cache = {};

const ctx = {
  console, JSON, Math, Date, Object, Array, String, Number, Error, RegExp,
  Logger: { log: (m) => log.push(String(m)) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => masterSs,
    openById: (id) => { if (!files[id]) throw new Error('no file ' + id); return files[id]; },
    create: (n) => new Spreadsheet(n),
    getUi: () => { throw new Error('no ui'); },
    ProtectionType: { SHEET: 'SHEET' }
  },
  DriveApp: {
    getFileById: (id) => ({ setTrashed: () => {}, getParents: () => { let d = false; return { hasNext: () => !d, next: () => { d = true; return projectFolder; } }; }, moveTo: () => {} }),
    getFolderById: (id) => { if (!folders[id]) throw new Error('no folder ' + id); return folders[id]; },
    getRootFolder: () => rootFolder
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, d) => Array.from(require('crypto').createHash('sha256').update(String(d), 'utf8').digest()),
    base64Encode: (b) => Buffer.from(b.map(x => x & 255)).toString('base64'),
    getUuid: () => require('crypto').randomUUID(),
    base64Decode: (b) => Array.from(Buffer.from(b, 'base64')),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name })
  },
  MailApp: { sendEmail: (to, subj, body) => { sentMail.push({ to, subj, body }); } },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'nawazimai@gmail.com' }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => ({ timeBased: () => ({ onMonthDay: () => ({ atHour: () => ({ create: () => {} }) }) }) }) }
};
vm.createContext(ctx);

const src = path.join(__dirname, '..', 'src');
fs.readdirSync(src).filter(f => f.endsWith('.js')).sort().forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(src, f), 'utf8'), ctx, { filename: f });
});
const run = (code) => vm.runInContext(code, ctx);

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ` expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); }

console.log('أعوان — الفحص');

t('الإعداد ينشئ كل الجداول ويحذف الورقة الافتراضية', () => {
  run('setupAwan()');
  const names = masterSs.getSheets().map(s => s.name);
  run('SCHEMA').forEach(tb => { if (!names.includes(tb.name)) throw new Error('ناقص: ' + tb.name); });
  if (names.includes('Sheet1')) throw new Error('الورقة الافتراضية باقية');
  eq(props.DATA_ID, masterSs.id);
});

t('البذور: الإعدادات والعتبات والقوائم', () => {
  eq(run("Db.all('Thresholds').length"), 12);
  eq(run("Db.all('Lists').length"), run('SEED_LISTS.length'));
  eq(run("Db.all('Lists')[0].item_id"), 'LST-00001');
  if (!run("Db.setting('photos_folder_id')")) throw new Error('مجلد الصور لم يُنشأ');
});

t('الإعداد آمن للتكرار ولا يكرر البذور', () => {
  run('Db.reset(); setupAwan()');
  run('Db.reset()');
  eq(run("Db.all('Thresholds').length"), 12);
  eq(run("Db.all('Lists').length"), run('SEED_LISTS.length'));
});

t('الإدخال والتحديث يحفظان النص الرقمي كما كُتب', () => {
  run("Db.reset(); Db.insert('Hotels', { code: 'WARIF', name: 'فندق وارف', city: 'مكة المكرمة', active: true })");
  run("Db.insert('Rooms', { hotel_id: 'HTL-00001', number: '0712', ac_units: 'AC-712-A' })");
  run('Db.reset()');
  eq(run("Db.get('Rooms', 'RM-00001').number"), '0712');
  run("Db.update('Hotels', 'HTL-00001', { city: 'مكة' })");
  run('Db.reset()');
  eq(run("Db.get('Hotels', 'HTL-00001').city"), 'مكة');
});

t('المزامنة تضيف عموداً ناقصاً دون مسح البيانات', () => {
  const sh = masterSs.getSheetByName('Elevators');
  sh.grid[0] = sh.grid[0].slice(0, 3);
  run('Db.reset(); syncSchema()');
  eq(sh.grid[0][3], 'active');
});

console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
