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
  getRow() { return this.r; }
  createTextFinder(text) {
    const self = this, t = String(text);
    const f = { matchEntireCell: () => f, findNext: () => {
      self.sh.ss.reads++;
      for (let i = 0; i < self.nr; i++) for (let j = 0; j < self.nc; j++) {
        const v = (self.sh.grid[self.r - 1 + i] || [])[self.c - 1 + j];
        if (v !== undefined && String(v) === t) return new Range(self.sh, self.r + i, self.c + j, 1, 1);
      }
      return null;
    } };
    return f;
  }
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
  deleteRow(r) { this.grid.splice(r - 1, 1); }
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
  createFile(blob) { const id = newId('file'); this.children.push({ name: blob.name, id }); return { getId: () => id, setSharing: () => {} }; }
  getFoldersByName(n) { const m = this.children.filter(f => f.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; }
}

const rootFolder = new Folder('root');
const projectFolder = rootFolder.createFolder('Project');
const masterSs = new Spreadsheet('أعوان — البيانات');
const props = {};
const sentMail = [];
const triggers = [], tgCalls = [], tgReply = { getMe: () => ({ ok: true, result: { username: 'AwanBot' } }), getUpdates: () => ({ ok: true, result: tgQueue.splice(0) }) }, tgQueue = [];
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
    getRootFolder: () => rootFolder,
    Access: { ANYONE_WITH_LINK: 'A' }, Permission: { VIEW: 'V' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, d) => Array.from(require('crypto').createHash('sha256').update(String(d), 'utf8').digest()),
    base64Encode: (b) => Buffer.from(b.map(x => x & 255)).toString('base64'),
    getUuid: () => require('crypto').randomUUID(),
    base64Decode: (b) => Array.from(Buffer.from(b, 'base64')),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name, getBytes: () => typeof bytes === 'string' ? Array.from(Buffer.from(bytes, 'utf8')) : bytes }),
    base64EncodeWebSafe: (b) => Buffer.from(b.map(x => x & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    formatDate: (d, tz, fmt) => {
      const x = new Date(new Date(d).getTime() + 3 * 3600e3).toISOString();
      if (fmt === 'yyyy-MM-dd') return x.slice(0, 10);
      if (fmt === 'yyyy-MM') return x.slice(0, 7);
      if (fmt === 'yyyy-MM-dd HH:mm') return x.slice(0, 10) + ' ' + x.slice(11, 16);
      return x;
    }
  },
  Gmail: { Users: { Messages: { send: (m) => {
    const txt = Buffer.from(m.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const head = txt.split('\r\n\r\n')[0], H = {};
    head.split('\r\n').forEach(l => { const i = l.indexOf(': '); H[l.slice(0, i).toLowerCase()] = l.slice(i + 2).replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8')); });
    const parts = txt.split(/--awan[0-9a-f]+/).filter(x => /Content-Type: text\/html/.test(x));
    const html = parts.length ? Buffer.from(parts[0].split('\r\n\r\n')[1].replace(/\s/g, ''), 'base64').toString('utf8') : '';
    sentMail.push({ to: { to: H.to, cc: H.cc, replyTo: H['reply-to'], subject: H.subject, from: (H.from.match(/<([^>]+)>/) || [])[1], html }, gmail: true });
    return { id: 'm' + sentMail.length };
  } } } },
  GmailApp: { getAliases: () => ['maint@nawazi.sa'], sendEmail: (to, subj, body, o) => { sentMail.push({ to: Object.assign({ to: to, subject: subj }, o), gmail: true }); } },
  MailApp: { sendEmail: (to, subj, body) => { sentMail.push({ to, subj, body }); } },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'nawazimai@gmail.com' }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getProjectTriggers: () => triggers, deleteTrigger: () => {}, newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => { triggers.push({ getHandlerFunction: () => fn }); } }), everyDays: () => ({ atHour: () => ({ create: () => { triggers.push({ getHandlerFunction: () => fn }); } }) }), onMonthDay: () => ({ atHour: () => ({ create: () => {} }) }) }) }) },
  UrlFetchApp: { getRequest: () => ({}), fetch: (url, o) => { const m = url.split('/').pop(), p = JSON.parse(o.payload || '{}'); tgCalls.push({ m, p }); const r = tgReply[m] ? tgReply[m](p) : { ok: true, result: { message_id: 500 + tgCalls.length } }; return { getContentText: () => JSON.stringify(r) }; } }
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
  eq(run("Db.all('Thresholds').length"), 18);
  eq(run("Db.all('Lists').length"), run('SEED_LISTS.length'));
  eq(run("Db.all('Lists')[0].item_id"), 'LST-00001');
  if (!run("Db.setting('photos_folder_id')")) throw new Error('مجلد الصور لم يُنشأ');
});

t('الإعداد آمن للتكرار ولا يكرر البذور', () => {
  run('Db.reset(); setupAwan()');
  run('Db.reset()');
  eq(run("Db.all('Thresholds').length"), 18);
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


// ───────── المرحلة الأولى: الدورة كاملة ─────────
const J = (x) => JSON.parse(JSON.stringify(x));
const throws = (code, part) => { try { run(code); } catch (e) { if (part && !e.message.includes(part)) throw new Error('رسالة غير متوقعة: ' + e.message); return; } throw new Error('كان يجب أن يفشل'); };
let adminTok, engTok, acPin, elPin, acTok, elTok, engPw;
const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const nextYear = (Number(today.slice(0, 4)) + 1) + today.slice(4);
const yesterday = new Date(Date.now() + 3 * 3600e3 - 864e5).toISOString().slice(0, 10);

t('المشرف: إنشاء حساب ثم تغيير كلمة المرور المؤقتة', () => {
  const r = run("Auth.createUser('م. محمد', 'admin', 'Admin', 'a@x.com', '')");
  const login = run(`apiStaffLogin('admin', '${r.password}')`);
  eq(login.must, true);
  throws(`apiAdmBoot('${login.token}') && apiEngBoot('${login.token}')`, 'غيّر كلمة المرور');
  throws(`apiChangePassword('${login.token}', 'abc')`, '8 أحرف');
  run(`apiChangePassword('${login.token}', 'Awan2026x')`);
  adminTok = run("apiStaffLogin('admin', 'Awan2026x')").token;
  eq(run("Db.setting('schema_version')"), run('SCHEMA_VERSION'));
});

t('البدروم: أدوار B1 وB2 بنطاقات قصيرة ← B101… وB201… بلا تكرار', () => {
  const hid = run(`apiAdmSaveHotel('${adminTok}', { code: 'bsmt', name: 'فندق البدروم', city: 'مكة' })`).id;
  run(`apiAdmSaveFloors('${adminTok}', '${hid}', [{ name: 'B1', from: 1, to: 7, ac: 1 }, { name: 'B2', from: 1, to: 8, ac: 1 }])`);
  const rn = JSON.stringify(run(`Db.all('Rooms', function (r) { return r.hotel_id === '${hid}'; })`));
  eq(rn.indexOf('B107') !== -1 && rn.indexOf('B208') !== -1, true);
});

t('المشرف: أدوار بنطاقات مختلفة دفعة واحدة، وأدوار خدمية بمرافقها، وبطاقات المصاعد', () => {
  throws(`apiAdmSaveHotel('${adminTok}', { code: 'وارف', name: 'x' })`, 'بالإنجليزية');
  const hid = run(`apiAdmSaveHotel('${adminTok}', { code: 'warif2', name: 'فندق وارف', city: 'مكة' })`).id;
  global.HID = hid;
  run(`apiAdmAddServiceFloor('${adminTok}', '${hid}', 'الاستقبال', [{ name: 'اللوبي', ac: 3 }, { name: 'المكاتب', ac: 1 }])`);
  let b = run(`apiAdmSaveFloors('${adminTok}', '${hid}', [{ name: 'الدور 7', from: 701, to: 714, ac: 2 }, { name: 'الدور 8', from: 801, to: 820, ac: 1 }])`).boot;
  throws(`apiAdmSaveFloors('${adminTok}', '${hid}', [{ name: 'الدور 9', from: 901, to: 905, ac: 1 }, { name: 'الدور 10', from: 905, to: 910, ac: 1 }])`, 'مكررة');
  throws(`apiAdmSaveFloors('${adminTok}', '${hid}', [{ name: 'الدور 9', from: 801, to: 803, ac: 1 }])`, 'دور آخر');
  run(`apiAdmSaveFloors('${adminTok}', '${hid}', [{ name: 'الدور 7', from: 701, to: 716, ac: 2 }])`);
  const f7 = run(`apiAdmBoot('${adminTok}')`).hotels.find(h => h.id === hid).floors.find(f => f.name === 'الدور 7');
  eq(f7.rooms, 16); eq(f7.from, '701'); eq(f7.to, '716'); eq(f7.acPer, 2);
  run(`apiAdmAddFacility('${adminTok}', '${hid}', '${f7.id}', 'الممر', 2)`);
  throws(`apiAdmAddFacility('${adminTok}', '${hid}', '${f7.id}', 'الممر', 1)`, 'موجود');
  b = run(`apiAdmBoot('${adminTok}')`).hotels.find(h => h.id === hid);
  const lobby = b.floors.find(f => f.name === 'الاستقبال');
  eq(lobby.kind, 'service'); eq(lobby.facilities.length, 2); eq(lobby.facilities[0].units.join(), 'اللوبي 1,اللوبي 2,اللوبي 3');
  eq(b.floors.find(f => f.name === 'الدور 8').rooms, 20);
  eq(b.totals.rooms, 36);
  run(`apiAdmMoveFloor('${adminTok}', '${b.floors[2].id}', -1)`);
  eq(run(`apiAdmBoot('${adminTok}')`).hotels.find(h => h.id === hid).floors[1].name, 'الدور 8');
  run(`apiAdmSaveElevator('${adminTok}', '${hid}', { name: 'مصعد النزلاء 1', kind: 'نزلاء', brand: 'Schindler', capacity_kg: 1000, persons: 13, stops: 18 })`);
  run(`apiAdmSaveElevator('${adminTok}', '${hid}', { name: 'مصعد الخدمة', kind: 'خدمة' })`);
  throws(`apiAdmSaveElevator('${adminTok}', '${hid}', { name: 'مصعد الخدمة' })`, 'يوجد');
  const e = run(`apiAdmBoot('${adminTok}')`).hotels.find(h => h.id === hid).elevatorCards[0];
  eq(e.brand, 'Schindler'); eq(e.persons, '13');
  run(`apiAdmSaveElevator('${adminTok}', '${hid}', { id: '${e.id}', name: 'مصعد النزلاء 1', brand: 'KONE', stops: 18 })`);
  eq(run(`Db.get('Elevators', '${e.id}').brand`), 'KONE');
  const tmp = run(`apiAdmAddServiceFloor('${adminTok}', '${hid}', 'دور مؤقت', [{ name: 'مخزن', ac: 0 }])`).id;
  run(`apiAdmRemoveFloor('${adminTok}', '${tmp}')`);
  eq(run(`Db.all('Floors', f => f.floor_id === '${tmp}').length`), 0);
  eq(run(`Db.all('Rooms', r => r.floor_id === '${tmp}').length`), 0);
});

t('الأبراج: نفس الدور في ثلاثة أبراج بنطاقات مختلفة', () => {
  const nid = run(`apiAdmSaveHotel('${adminTok}', { code: 'NAWAZI', name: 'أبراج نوازي' })`).id;
  const rows = [];
  for (let f = 3; f <= 5; f++) [['البرج الأول', 1, 13], ['البرج الثاني', 14, 33], ['البرج الثالث', 34, 44]].forEach(([tw, a, b]) => rows.push({ tower: tw, name: 'الدور ' + f, from: f * 100 + a, to: f * 100 + b, ac: 1 }));
  run(`apiAdmSaveFloors('${adminTok}', '${nid}', ${JSON.stringify(rows)})`);
  const h = run(`apiAdmBoot('${adminTok}')`).hotels.find(x => x.id === nid);
  eq(h.towers.length, 3); eq(h.floors.length, 9); eq(h.totals.rooms, 132);
  const f = h.floors.find(x => x.tower === 'البرج الثاني' && x.name === 'الدور 4');
  eq(f.from, '414'); eq(f.to, '433');
  throws(`apiAdmSaveFloors('${adminTok}', '${nid}', [{ tower: 'البرج الأول', name: 'الدور 6', from: 520, to: 522, ac: 1 }])`, 'برج آخر');
  run(`apiAdmSaveHotel('${adminTok}', { id: '${nid}', code: 'NAWAZI', name: 'أبراج نوازي', city: 'مكة' })`);
  eq(run(`apiAdmBoot('${adminTok}')`).hotels.find(x => x.id === nid).towers.length, 3);
  throws(`apiAdmSaveHotel('${adminTok}', { id: '${nid}', code: 'NAWAZI', name: 'أبراج نوازي', towers: 'البرج الأول, البرج الثاني' })`, 'عليه أدوار');
  const fl = run(`floorsOf_('${nid}')`).find(x => x.tower === 'البرج الثالث' && x.name === 'الدور 5');
  eq(fl.label, 'البرج الثالث · الدور 5');
  global.NID = nid; global.NFL = fl.id;
});

t('المشرف: عقدان، والرقم السري يظهر مرة واحدة وفريد', () => {
  acPin = run(`apiAdmSaveContract('${adminTok}', { name: 'مؤسسة التبريد', type: 'ac', hotel_ids: ['${HID}'], start: '${yesterday}', end: '${nextYear}', resp_normal: 30, resp_urgent: 15 })`).pin;
  elPin = run(`apiAdmSaveContract('${adminTok}', { name: 'شركة المصاعد', type: 'el', hotel_ids: ['${HID}'], elevator_ids: ['مصعد النزلاء 1'], start: '${yesterday}', end: '${nextYear}', resp_normal: 45, resp_urgent: 15, pm_per_month: 1 })`).pin;
  if (!/^\d{6}$/.test(acPin) || acPin === elPin) throw new Error('رقم سري غير صالح');
  const b = run(`apiAdmBoot('${adminTok}')`);
  eq(b.contractors.length, 2);
  eq(b.contractors[0].contracts[0].left > 300, true);
  if (JSON.stringify(b).includes(acPin)) throw new Error('الرقم السري ظاهر في البيانات');
});

t('المشرف: مهندس للفندق بكلمة مرور مؤقتة', () => {
  engPw = run(`apiAdmAddUser('${adminTok}', { name: 'م. أحمد', role: 'engineer', username: 'eng.ahmed', hotel_ids: ['${HID}'] })`).password;
  const l = run(`apiStaffLogin('eng.ahmed', '${engPw}')`);
  run(`apiChangePassword('${l.token}', 'Eng12345a')`);
  engTok = run("apiStaffLogin('eng.ahmed', 'Eng12345a')").token;
});

t('الغرف بحرف: A301–A305 و B-01–B-03، ورقم بحرف صغير يُطابَق', () => {
  const nid = run(`apiAdmSaveHotel('${adminTok}', { code: 'LETTERS', name: 'فندق الحروف' })`).id;
  run(`apiAdmSaveFloors('${adminTok}', '${nid}', [{ tower: 'A', name: 'الدور 3', from: 'A301', to: 'a305', ac: 1 }, { name: 'الدور 0', from: 'B-01', to: 'B-03', ac: 2 }])`);
  const h = run(`apiAdmBoot('${adminTok}')`).hotels.find(x => x.id === nid);
  eq(h.totals.rooms, 8);
  const f3 = h.floors.find(x => x.name === 'الدور 3');
  eq(f3.from, 'A301'); eq(f3.to, 'A305');
  eq(run(`Db.all('Rooms', r => r.hotel_id === '${nid}' && r.kind === 'room').map(r => r.number).sort().join(',')`), 'A301,A302,A303,A304,A305,B-01,B-02,B-03');
  throws(`apiAdmSaveFloors('${adminTok}', '${nid}', [{ name: 'الدور 4', from: 'A401', to: 'B405', ac: 1 }])`, 'نطاق الغرف');
  throws(`apiAdmSaveFloors('${adminTok}', '${nid}', [{ name: 'الدور 9', from: 'A303', to: 'A303', ac: 1 }])`, 'دور آخر');
  eq(run(`Orders.normRoom(' a 302 ')`), 'A302'); eq(run(`Orders.normRoom('اللوبي')`), 'اللوبي');
});

t('فريق العمل: باركود الطلبات يفتح النموذج بلا دخول', () => {
  const b = run("apiReqBoot('warif2')");
  eq(b.hotel.name, 'فندق وارف'); eq(b.has.ac, true); eq(b.elevators.length, 2);
  if (!b.syms.el.some(x => x.ar === 'توقف بين الأدوار')) throw new Error('قائمة الأعراض ناقصة');
  throws("apiReqBoot('NOPE')", 'الباركود');
});

t('فريق العمل: طلب تكييف يُسند للمتعهد حسب العقد مع الصورة', () => {
  const floor = run(`floorsOf_('${HID}')`).find(f => f.name === 'الدور 7').id;
  const r = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${floor}', room: '712', symptom: 'لا يبرد', name: 'أحمد', photos: ['data:image/jpeg;base64,AAAA'] })`);
  eq(r.con, 'مؤسسة التبريد'); eq(r.resp, 30);
  global.AC1 = r.id;
  eq(run(`Db.get('WorkOrders', '${r.id}').status`), 'assigned');
  eq(run(`Db.get('WorkOrders', '${r.id}').photos`).length > 0, true);
  throws(`apiReqSubmit('WARIF2', { type: 'ac', symptom: 'لا يبرد', name: '' })`, 'اسمك');
});

t('فريق العمل: احتجاز في المصعد = فوري ويبدأ عدّاد التوقف', () => {
  const r = run(`apiReqSubmit('WARIF2', { type: 'el', equip: 'مصعد النزلاء 1', symptom: 'توقف بين الأدوار', trapped: 'yes', name: 'خالد' })`);
  eq(r.resp, 0); global.EL1 = r.id;
  const o = run(`Db.get('WorkOrders', '${r.id}')`);
  eq(o.priority, 'urgent'); eq(!!o.down_from, true);
});

t('المتعهد: الرقم السري الخاطئ يُرفض، والصحيح يسجّل الوصول', () => {
  throws("apiConLogin('WARIF2', '000000')", 'غير صحيح');
  const r = run(`apiConLogin('WARIF2', '${acPin}')`);
  acTok = r.token;
  eq(r.boot.me.type, 'ac'); eq(r.boot.jobs.length, 1);
  eq(r.boot.jobs[0].units.join(), 'AC-712-A,AC-712-B');
  eq(r.boot.jobs[0].loc, 'الدور 7 · غرفة 712');
  eq(!!run(`Db.get('WorkOrders', '${AC1}').arrived_at`), true);
  eq(run("Db.all('Arrivals').length"), 1);
  if (r.boot.lists.cause.length < 3) throw new Error('القوائم لم تصل');
});

t('المتعهد: تشخيص كمبروسر بلا صورة يُرفض، وبالصورة يصل للمهندس "قيد المراجعة"', () => {
  throws(`apiConAct('${acTok}', 'submit', '${AC1}', { outcome: 'comp', equip: 'AC-712-A' })`, 'قراءة التيار');
  const r = run(`apiConAct('${acTok}', 'submit', '${AC1}', { outcome: 'comp', equip: 'AC-712-A', cause: ['تآكل طبيعي'], quote: '2400', photos: ['data:image/jpeg;base64,AAAA'] })`);
  eq(r.result.status, 'decision');
  eq(r.boot.jobs[0].status, 'review', 'المتعهد يرى قيد المراجعة');
  eq(r.boot.jobs[0].quote, '', 'السعر لا يُعاد للمتعهد');
});

t('المهندس: قرار "المتعهد يوفّر" ← بانتظار السداد، ولا يظهر السداد للمتعهد', () => {
  const b = run(`apiEngBoot('${engTok}')`);
  const o = b.orders.find(x => x.id === AC1);
  eq(o.status, 'decision'); eq(o.quote, '2400');
  run(`apiEngAct('${engTok}', '${AC1}', 'decide', { decision: 'con' })`);
  eq(run(`apiConBoot('${acTok}')`).jobs[0].status, 'review');
  throws(`apiConAct('${acTok}', 'submit', '${AC1}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix' })`, 'ليست بانتظار تقريرك');
  run(`apiEngAct('${engTok}', '${AC1}', 'paid', { receipt: 'R-55' })`);
  const j = run(`apiConBoot('${acTok}')`).jobs[0];
  eq(j.status, 'in_progress'); if (!j.note.includes('وفّر القطعة')) throw new Error('رسالة الاعتماد ناقصة');
  eq(j.paid, null, 'وقت السداد مخفي');
});

t('المتعهد: الإصلاح بعد الاعتماد، والمتابعة تفتح عملية جديدة، والبند الجديد ينتظر الاعتماد', () => {
  throws(`apiConAct('${acTok}', 'submit', '${AC1}', { outcome: 'comp', photos: ['data:image/jpeg;base64,AA'] })`, 'معتمدة للتركيب');
  const r = run(`apiConAct('${acTok}', 'submit', '${AC1}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', equip: 'AC-712-A', sym: 'لا يبرد', part: 'الكمبروسر', cause: ['تآكل طبيعي'], parts: ['كمبروسر جديد'], follow: 'نعم', followNote: 'تنظيف خط التصريف', custom: [{ list: 'parts', ar: 'كمبروسر جديد' }] })`);
  eq(r.result.status, 'matching');
  if (!r.result.msg.includes('متابعة')) throw new Error('لم تُفتح المتابعة');
  eq(r.boot.jobs.length, 2);
  eq(run("Db.all('Lists', l => l.status === 'pending').length"), 1);
  eq(run(`Db.get('WorkOrders', '${AC1}').visits`), 2);
});

t('المهندس: إعادة الفتح بسبب، ثم الإغلاق بعد المطابقة مع الرضا ← الأرشيف', () => {
  throws(`apiEngAct('${engTok}', '${AC1}', 'reopen', {})`, 'سبب');
  run(`apiEngAct('${engTok}', '${AC1}', 'reopen', { reason: 'صور غير واضحة' })`);
  const j = run(`apiConBoot('${acTok}')`).jobs.find(x => x.id === AC1);
  eq(j.reject_reason, 'صور غير واضحة');
  run(`apiConAct('${acTok}', 'submit', '${AC1}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', equip: 'AC-712-A', photos: ['data:image/jpeg;base64,AA'] })`);
  throws(`apiEngAct('${engTok}', '${AC1}', 'close', {})`, 'رضاك');
  run(`apiEngAct('${engTok}', '${AC1}', 'close', { sat: 'good' })`);
  const b = run(`apiConBoot('${acTok}')`);
  eq(b.archive.length, 1); eq(b.archive[0].id, AC1);
  eq(run(`Db.get('WorkOrders', '${AC1}').reopens`), 1);
});

t('المصاعد: الإنقاذ ثم "يعمل الآن" يغلق عدّاد التوقف، وقرار فريقنا يعلّق حتى وصول القطعة', () => {
  elTok = run(`apiConLogin('WARIF2', '${elPin}')`).token;
  run(`apiConAct('${elTok}', 'rescue', '${EL1}', {})`);
  eq(!!run(`Db.get('WorkOrders', '${EL1}').rescued_at`), true);
  throws(`apiConAct('${elTok}', 'submit', '${EL1}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix' })`, 'يعمل الآن');
  throws(`apiConAct('${elTok}', 'submit', '${EL1}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'diag', part: 'قفل باب الدور', working: 'نعم' })`, 'القطعة الموصى');
  run(`apiConAct('${elTok}', 'submit', '${EL1}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'diag', part: 'قفل باب الدور', rec: ['قفل باب الدور'], working: 'نعم', quote: '900' })`);
  eq(!!run(`Db.get('WorkOrders', '${EL1}').down_to`), true);
  eq(run(`Db.get('WorkOrders', '${EL1}').status`), 'quote'); eq(String(run(`Db.get('WorkOrders', '${EL1}').quote`)), '');
  eq(run(`apiConBoot('${elTok}')`).jobs.find(x => x.id === EL1).status, 'review');
  throws(`apiEngAct('${engTok}', '${EL1}', 'decide', { decision: 'own' })`, 'عرض السعر أولاً');
  throws(`apiEngRfq('${engTok}', '${EL1}', true)`, 'لا يوجد بريد');
  const elc = run(`Db.find('Contractors', c => c.type === 'el').con_id`);
  run(`apiAdmSaveConInfo('${adminTok}', '${elc}', { emails: 'sales@lift.sa, ops@lift.sa' })`);
  throws(`apiEngRfq('${engTok}', '${EL1}', true)`, 'أضف بريدك');
  const eu = run(`Db.find('Users', u => u.username === 'eng.ahmed').user_id`);
  throws(`apiAdmSaveUserEmail('${adminTok}', '${eu}', 'x@y')`, 'غير صحيح');
  run(`apiAdmSaveUserEmail('${adminTok}', '${eu}', 'eng@warf.sa')`);
  const pv = run(`apiEngRfq('${engTok}', '${EL1}', true)`); eq(pv.to, 'sales@lift.sa,ops@lift.sa'); if (!pv.html.includes('نوازي للفندقة') || pv.html.includes('قفل باب الدور') || !pv.html.includes('Nawazi')) throw new Error('محتوى البريد');
  const n0 = sentMail.length; run(`apiEngRfq('${engTok}', '${EL1}')`); eq(sentMail.length, n0 + 1); eq(sentMail[n0].to.replyTo, 'eng@warf.sa');
  eq(Number(run(`Db.get('WorkOrders', '${EL1}').rfq_count`)), 1);
  throws(`apiEngAct('${engTok}', '${EL1}', 'quote', { amount: '' })`, 'مبلغ');
  run(`apiEngAct('${engTok}', '${EL1}', 'quote', { amount: '1,850', no: 'Q-77' })`);
  eq(run(`Db.get('WorkOrders', '${EL1}').status`), 'decision'); eq(Number(run(`Db.get('WorkOrders', '${EL1}').quote`)), 1850);
  run(`apiEngAct('${engTok}', '${EL1}', 'decide', { decision: 'own' })`);
  eq(run(`Db.get('WorkOrders', '${EL1}').status`), 'parts');
  run(`apiEngAct('${engTok}', '${EL1}', 'part', {})`);
  const j = run(`apiConBoot('${elTok}')`).jobs.find(x => x.id === EL1);
  if (!j.note.includes('وصلت القطعة')) throw new Error('رسالة القطعة ناقصة');
});

t('المهندس: فحص مغاير برسالة، ورفض بسبب من القائمة', () => {
  run(`apiConAct('${elTok}', 'new', null, { att: ['data:image/jpeg;base64,AAAA'], outcome: 'diag', equip: 'مصعد الخدمة', sym: 'صوت أو اهتزاز', rec: ['بكرة باب'], working: 'نعم' })`);
  const o = run(`apiEngBoot('${engTok}')`).orders.find(x => x.status === 'quote');
  throws(`apiEngAct('${engTok}', '${o.id}', 'decide', { decision: 'recheck' })`, 'ملاحظتك');
  run(`apiEngAct('${engTok}', '${o.id}', 'decide', { decision: 'recheck', note: 'افحص الحبال' })`);
  run(`apiConAct('${elTok}', 'submit', '${o.id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'diag', rec: ['بكرة باب'], working: 'نعم' })`);
  run(`apiEngAct('${engTok}', '${o.id}', 'decide', { decision: 'reject', reason: 'سبب غير مقنع' })`);
  eq(run(`Db.get('WorkOrders', '${o.id}').status`), 'rejected');
});

t('الصلاحيات: المتعهد لا يصل لدوال المهندس، والمهندس لا يصل لدوال المشرف', () => {
  throws(`apiEngBoot('${acTok}')`, 'صلاحية');
  throws(`apiAdmBoot('${engTok}')`, 'صلاحية');
  throws("apiConBoot('bad')", 'الجلسة');
});

t('طلب على مرفق: يظهر بلا "غرفة" ووحداته من مرفق ذلك الدور', () => {
  const fl = run(`floorsOf_('${HID}')`).find(f => f.name === 'الاستقبال');
  eq(fl.facilities.join(), 'اللوبي,المكاتب');
  const r = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${fl.id}', room: 'اللوبي', symptom: 'لا يبرد', name: 'سارة' })`);
  const tok = run(`apiConLogin('WARIF2', '${acPin}')`).token;
  const j = run(`apiConBoot('${tok}')`).jobs.find(x => x.id === r.id);
  eq(j.loc, 'الاستقبال · اللوبي'); eq(j.units.join(), 'اللوبي 1,اللوبي 2,اللوبي 3');
  throws(`apiAdmRemoveFacility('${adminTok}', '${run(`Db.find('Rooms', x => x.number === 'اللوبي').room_id`)}')`, 'طلبات');
});

t('المهندس: طلب جديد يُسند حسب العقد', () => {
  const r = run(`apiEngCreate('${engTok}', { hotel_id: '${HID}', type: 'el', equip: 'مصعد الخدمة', symptom: 'الباب لا يُغلق' })`);
  eq(r.boot.orders.find(x => x.id === r.id).con, 'شركة المصاعد');
});

t('دخول المتعهد من الويب: كل الفنادق، بلا تسجيل وصول، ولا إجراءات ميدانية', () => {
  const before = run(`Db.all('Arrivals').length`);
  throws(`apiConWebLogin('000000')`, 'غير صحيح');
  const r = run(`apiConWebLogin('${acPin}')`);
  eq(r.boot.web, true); eq(r.boot.hotel.name, 'كل الفنادق'); eq(r.boot.me.name, 'مؤسسة التبريد');
  eq(run(`Db.all('Arrivals').length`), before);
  throws(`apiConAct('${r.token}', 'new', null, { outcome: 'report', title: 'x' })`, 'من الفندق فقط');
  const floor = run(`floorsOf_('${HID}')`).find(f => f.name === 'الدور 7').id;
  const w = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${floor}', room: '705', symptom: 'لا يبرد', name: 'سالم' })`).id;
  throws(`apiConAct('${r.token}', 'submit', '${w}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'ok' })`, 'سجّل وصولك أولاً');
  eq(run(`apiConBoot('${r.token}')`).jobs.some(j => j.id === w), true);
});

t('الرقم السري: 5 محاولات خاطئة تقفل مؤقتاً', () => {
  for (let i = 0; i < 5; i++) { try { run("apiConLogin('WARIF2', '111111')"); } catch (e) {} }
  throws(`apiConLogin('WARIF2', '${acPin}')`, 'انتظر');
});

// ───────── المرحلة الثانية: البنود واللوحات والعتبات واللغة ─────────
t('الأداء: يُحسب مسبقاً في KpiSummary بعد الإغلاق (الجاهزية والموثوقية والرضا والاستجابة)', () => {
  const con = run(`Db.find('Contractors', c => c.name === 'مؤسسة التبريد').con_id`);
  const m = run('Kpi.month(new Date())');
  const row = run(`Kpi.rows(r => r.con_id === '${con}' && r.hotel_id === '${HID}', 6)`).find(r => r.month === m);
  if (!row) throw new Error('لا يوجد ملخص');
  const d = row.d;
  eq(d.closed, 1); eq(d.readyN, 1); eq(d.readyOk, 0);       // أُعيد فتحها فلا تُحسب جاهزة
  eq(d.satN, 1); eq(d.satSum, 100);
  if (!(d.infoN >= 1) || d.infoOk !== 0) throw new Error('الموثوقية: ' + JSON.stringify(d));
  if (!(d.respN >= 1)) throw new Error('الاستجابة لم تُحسب');
  eq(d.parts['الكمبروسر'], 1);
  const el = run(`Kpi.rows(r => r.hotel_id === '${HID}', 6)`).filter(r => r.con !== con);
  eq(el.reduce((a, r) => a + r.d.trapped, 0), 1);
  eq(el.reduce((a, r) => a + r.d.rescueN, 0), 1);
});

t('الأداء: المهندس يرى فنادقه، والمتعهد يرى أرقامه فقط', () => {
  const e = run(`apiKpiBoot('${engTok}')`);
  if (e.rows.length < 2) throw new Error('صفوف المهندس ناقصة');
  eq(e.thresholds.ac.resp.full, 30);
  const c = run(`apiKpiBoot('${acTok}')`);
  const con = run(`Db.find('Contractors', c => c.name === 'مؤسسة التبريد').con_id`);
  eq(c.rows.every(r => r.con === con), true);
  eq(c.cons.length, 1);
});

t('العتبات: المجموع 100، والاستجابة الأقل أفضل، ثم تُحفظ', () => {
  const ok = { resp: { full: 25, half: 40, weight: 40 }, ready: { full: 90, half: 80, weight: 30 }, info: { full: 95, half: 90, weight: 15 }, sat: { full: 85, half: 75, weight: 15 } };
  throws(`apiAdmSaveThresholds('${adminTok}', 'ac', ${JSON.stringify({ ...ok, sat: { full: 85, half: 75, weight: 10 } })})`, '100');
  throws(`apiAdmSaveThresholds('${adminTok}', 'ac', ${JSON.stringify({ ...ok, resp: { full: 40, half: 25, weight: 40 } })})`, 'الأقل أفضل');
  run(`apiAdmSaveThresholds('${adminTok}', 'ac', ${JSON.stringify(ok)})`);
  const th = run(`apiAdmBoot('${adminTok}')`).thresholds.ac;
  eq(th.resp.full, 25); eq(th.sat.half, 75); eq(th.ready.weight, 30);
  eq(run(`Db.all('Thresholds').length`), 18);
  eq(run(`apiAdmBoot('${adminTok}')`).thresholds.el.resp.full, 45);
});

t('اعتماد البنود: إعادة صياغة مع الإنجليزية، ودمج، ورفض', () => {
  const a = run(`apiAdmBoot('${adminTok}')`);
  const p = a.lists.find(l => l.status === 'pending' && l.ar === 'كمبروسر جديد');
  if (!p) throw new Error('البند المعلّق غير موجود');
  throws(`apiAdmListAct('${adminTok}', '${p.id}', 'approve', { ar: 'كمبروسر' })`, 'الإنجليزية');
  run(`apiAdmListAct('${adminTok}', '${p.id}', 'approve', { ar: 'كمبروسر', en: 'Compressor' })`);
  const l = run(`Db.get('Lists', '${p.id}')`);
  eq(l.status, 'active'); eq(l.ar, 'كمبروسر'); eq(l.orig, 'كمبروسر جديد');
  eq(run(`listsFor_('ac').parts.some(x => x.ar === 'كمبروسر' && x.en === 'Compressor')`), true);
  // دمج: بند معلّق يُدمج في بند قائم
  const m = run(`Db.insert('Lists', { type: 'ac', list: 'cause', ar: 'وسخ', status: 'pending', created_by: 'x', sort: 999 }).item_id`);
  const into = run(`Db.find('Lists', x => x.ar === 'اتساخ' && x.type === 'ac').item_id`);
  throws(`apiAdmListAct('${adminTok}', '${m}', 'merge', { into: '${run(`Db.find('Lists', x => x.ar === 'المروحة').item_id`)}' })`, 'نفس القائمة');
  run(`apiAdmListAct('${adminTok}', '${m}', 'merge', { into: '${into}' })`);
  eq(run(`Db.get('Lists', '${m}').status`), 'merged');
  const r = run(`Db.insert('Lists', { type: 'ac', list: 'sym', ar: 'كلام فارغ', status: 'pending', created_by: 'x', sort: 999 }).item_id`);
  run(`apiAdmListAct('${adminTok}', '${r}', 'reject', {})`);
  eq(run(`Db.get('Lists', '${r}').status`), 'rejected');
  eq(run(`apiAdmBoot('${adminTok}')`).pending, 0);
  // بند معتمد: إضافة وتعديل الترجمة
  run(`apiAdmListSave('${adminTok}', { type: 'el', list: 'parts', ar: 'كفرات باب', en: 'Door shoes' })`);
  eq(run(`listsFor_('el').parts.some(x => x.en === 'Door shoes')`), true);
});

t('اللغة: كل مستخدم يختار لغة واجهته، والترجمات تصل مع الإقلاع', () => {
  eq(run(`apiSetLang('${engTok}', 'en')`), 'en');
  const b = run(`apiEngBoot('${engTok}')`);
  eq(b.me.lang, 'en');
  if (!b.i18n.some(p => p[0] === 'لا يبرد' && p[1] === 'Not cooling')) throw new Error('الترجمات ناقصة');
  run(`apiSetLang('${acTok}', 'en')`);
  eq(run(`apiConBoot('${acTok}')`).me.lang, 'en');
  eq(run("apiReqBoot('warif2')").i18n.length > 10, true);
});

t('الملاحظة والعطل والإجراء: قائمة الإجراء تُضاف للملف القائم، والتقرير يحفظ الإجراء، والمهندس يرفع طلباً بملاحظة حرة وصورة', () => {
  run(`Db.all('Lists').filter(l => l.list === 'action').forEach(l => Db.remove('Lists', l.item_id))`);
  eq(run(`listsFor_('ac').action.length`), 0);
  eq(run('seedMissingLists_()') > 0, true);
  eq(run('seedMissingLists_()'), 0);
  eq(run(`listsFor_('ac').action.some(x => x.ar === 'تعبئة فريون 60%' && x.en === 'Freon refill 60%')`), true);
  const b = run(`apiEngBoot('${engTok}')`);
  eq(b.syms.ac.includes('لا يبرد'), true);
  const h = b.hotels.find(x => x.id === HID);
  eq(h.cons.ac.name, 'مؤسسة التبريد'); eq(h.cons.ac.resp, 30);
  eq(h.floors.find(f => f.name === 'الدور 7').rooms.includes('712'), true);
  const fl = h.floors.find(f => f.name === 'الدور 7').id;
  const r = run(`apiEngCreate('${engTok}', { hotel_id: '${HID}', type: 'ac', floor_id: '${fl}', room: '703', symptom: 'صوت طقطقة من الوحدة', photos: ['data:image/jpeg;base64,AAAA'] })`);
  const o = run(`Db.get('WorkOrders', '${r.id}')`);
  eq(o.symptom, 'صوت طقطقة من الوحدة'); eq(!!o.photos, true);
  throws(`apiEngCreate('${engTok}', { hotel_id: '${HID}', type: 'ac', symptom: 'x' })`, 'الدور');
  run(`apiConAct('${acTok}', 'submit', '${r.id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', equip: 'AC-703-A', sym: 'صوت مرتفع', part: 'المروحة', cause: ['اتساخ'], action: ['تعبئة فريون 60%'], follow: 'لا' })`);
  const rep = run(`apiEngBoot('${engTok}')`).orders.find(x => x.id === r.id).reports.slice(-1)[0];
  eq(rep.action.join(), 'تعبئة فريون 60%');
  // الخدمات مسعّرة وتُجمع في الكشف الشهري بعد الإغلاق، والإجراءات العامة القديمة أُوقفت
  const ctr = run(`Db.find('Contracts', c => c.type === 'ac').contract_id`);
  throws(`apiAdmSaveContractPrices('${adminTok}', '${ctr}', { 'تعبئة فريون 60%': 'abc' })`, 'السعر');
  run(`apiAdmSaveContractPrices('${adminTok}', '${ctr}', { 'تعبئة فريون 60%': '120', 'استبدال كمبروسر': '2400', 'تغيير ريموت': '' })`);
  eq(JSON.stringify(run(`pricesOf_(Db.get('Contracts', '${ctr}'))`)), JSON.stringify({ 'تعبئة فريون 60%': 120, 'استبدال كمبروسر': 2400 }));
  eq(run(`apiEngBoot('${engTok}')`).hotels.find(x => x.id === HID).cons.ac.prices['استبدال كمبروسر'], 2400);
  run(`Db.insert('Lists', { type: 'ac', list: 'action', ar: 'تعبئة غاز', en: 'x', status: 'active', created_by: 'system', sort: 1 })`);
  run('seedMissingLists_()');
  eq(run(`Db.find('Lists', l => l.ar === 'تعبئة غاز').status`), 'rejected');
  run(`apiEngAct('${engTok}', '${r.id}', 'close', { sat: 'good' })`);
  const k = run(`apiKpiBoot('${engTok}')`);
  const con = run(`Db.find('Contractors', c => c.name === 'مؤسسة التبريد').con_id`);
  eq(k.prices[con + '|تعبئة فريون 60%'], 120);
  const row = k.rows.find(x => x.con === con && x.hotel === HID && x.month === k.month);
  eq(row.d.acts['تعبئة فريون 60%'], 1);
});

t('الصيانة الدورية للمصاعد: زيارة واحدة لكل مصاعد العقد، والبند O أو المتوقف يفتح متابعة، و«لا ينطبق» يُتذكَّر', () => {
  const b = run(`apiConBoot('${elTok}')`);
  const h = b.hotels.find(x => x.id === HID);
  eq(h.mine.join(), 'مصعد النزلاء 1');
  const ok = 'x'.repeat(38), withO = 'x'.repeat(4) + 'o' + 'x'.repeat(3) + 'nnn' + 'x'.repeat(27);
  throws(`apiConAct('${elTok}', 'new', null, { att: ['data:image/jpeg;base64,AAAA'], outcome: 'pm', units: ['مصعد النزلاء 1'], 'g|مصعد النزلاء 1': 'xx' })`, 'ناقصة');
  throws(`apiConAct('${elTok}', 'new', null, { att: ['data:image/jpeg;base64,AAAA'], outcome: 'pm', units: ['مصعد النزلاء 1'], 'g|مصعد النزلاء 1': '${ok}' })`, 'يعمل الآن');
  const r = run(`apiConAct('${elTok}', 'new', null, { att: ['data:image/jpeg;base64,AAAA'], outcome: 'pm', units: ['مصعد النزلاء 1', 'مصعد الخدمة'], techs: 'أبوبكر، حسام', 'g|مصعد النزلاء 1': '${withO}', 'w|مصعد النزلاء 1': 'نعم', 'g|مصعد الخدمة': '${ok}', 'w|مصعد الخدمة': 'لا', replaced: '', toreplace: 'فرامل P8' })`);
  const id = r.result.id, o = run(`Db.get('WorkOrders', '${id}')`);
  eq(o.kind, 'periodic'); eq(o.status, 'matching'); eq(o.symptom, 'صيانة دورية');
  const fol = run(`Db.all('WorkOrders', x => x.follow_of === '${id}')`);
  eq(fol.length, 2);
  const stop = fol.find(x => x.equip === 'مصعد الخدمة');
  eq(stop.symptom, 'متوقف'); eq(!!stop.down_from, true);
  if (!fol.find(x => x.equip === 'مصعد النزلاء 1').description.includes('5')) throw new Error('البند 5 لم يُذكر');
  eq(run(`apiConBoot('${elTok}')`).pmLast['مصعد النزلاء 1'], 'x'.repeat(8) + 'nnn' + 'x'.repeat(27));
  run(`apiEngAct('${engTok}', '${id}', 'close', { sat: 'good' })`);
  const con = run(`Db.find('Contractors', c => c.name === 'شركة المصاعد').con_id`);
  const row = run(`Kpi.rows(r => r.con_id === '${con}' && r.hotel_id === '${HID}', 6)`).find(x => x.month === run('Kpi.month(new Date())'));
  eq(row.d.pm, 1);
  eq(run(`apiKpiBoot('${engTok}')`).pmTarget[con + '|' + HID] >= 0, true);
});

t('المتعهد: أكثر من بريد، والكشف الشهري يجمع الخدمات بأسعارها من العمليات المغلقة', () => {
  const con = run(`Db.find('Contractors', c => c.name === 'مؤسسة التبريد').con_id`);
  throws(`apiAdmSaveConInfo('${adminTok}', '${con}', { emails: 'a@x.com, خطأ' })`, 'البريد غير صحيح');
  run(`apiAdmSaveConInfo('${adminTok}', '${con}', { phone: '0500000000', emails: 'Ops@Cool.sa, billing@cool.sa ops@cool.sa' })`);
  eq(run(`apiAdmBoot('${adminTok}')`).contractors.find(c => c.id === con).emails.join(), 'ops@cool.sa,billing@cool.sa');
  throws(`apiStatement('${engTok}', '${con}', 'all', '2026-10-20', '2026-10-01')`, 'الفترة');
  const empty = run(`apiStatement('${engTok}', '${con}', 'all', '2020-01-01', '2020-01-31')`);
  eq(empty.orders.length, 0); eq(empty.total, 0);
  const st = run(`apiStatement('${engTok}', '${con}', 'all', Kpi.month(new Date()))`);
  eq(st.from.slice(8), '01');
  const l = st.lines.find(x => x.svc === 'تعبئة فريون 60%');
  eq(l.qty, 1); eq(l.price, 120); eq(l.total, 120);
  eq(st.total >= 120, true); eq(st.orders.length >= 1, true); eq(st.con.emails.length, 2);
  throws(`apiStatement('${acTok}', '${con}', 'all', '2026-10-01', '2026-10-31')`, 'صلاحية');
});

t('التكييف: إصلاح مباشر بمبادرة المتعهد بالإجراء المتخذ، والدخول يزامن الهيكل والقوائم', () => {
  run(`Db.update('Settings', 'schema_version', { value: 1 })`);
  run(`Db.all('Lists').filter(l => l.list === 'action' && l.type === 'ac').forEach(l => Db.remove('Lists', l.item_id))`);
  const b = run(`apiConBoot('${acTok}')`);
  eq(b.lists.action.some(x => x.ar === 'تغيير ريموت'), true);
  eq(String(run(`Db.setting('schema_version')`)), String(run('SCHEMA_VERSION')));
  const fl = run(`floorsOf_('${HID}')`).find(f => f.name === 'الدور 7').id;
  const r = run(`apiConAct('${acTok}', 'new', null, { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', hotel_id: '${HID}', floor_id: '${fl}', room: '707', sym: 'لا يبرد', part: 'المروحة', cause: ['اتساخ'], action: ['تغيير ريموت'], follow: 'لا' })`);
  const o = run(`Db.get('WorkOrders', '${r.result.id}')`);
  eq(o.kind, 'corrective'); eq(o.status, 'matching'); eq(o.room, '707');
});

t('الإجراء التصحيحي: من المطابقة يعود للمتعهد ويُغلق «فعّالاً» بالإغلاق، والمستقل يرد عليه المتعهد ويتحقق المهندس', () => {
  const fl = run(`floorsOf_('${HID}')`).find(f => f.name === 'الدور 7').id;
  const id = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${fl}', room: '709', symptom: 'لا يبرد', name: 'سالم' })`).id;
  run(`apiConAct('${acTok}', 'submit', '${id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', equip: 'AC-709-A', sym: 'لا يبرد', part: 'المروحة', cause: ['اتساخ'], action: ['تغيير ريموت'], follow: 'لا' })`);
  throws(`apiEngAct('${engTok}', '${id}', 'ca', {})`, 'سبب');
  run(`apiEngAct('${engTok}', '${id}', 'ca', { reason: 'صور غير واضحة', required: 'أرفق صورة الوحدة بعد العمل' })`);
  let ca = run(`Db.find('CorrectiveActions', c => c.wo_id === '${id}')`);
  eq(ca.status, 'open'); eq(run(`Db.get('WorkOrders', '${id}').status`), 'in_progress');
  const cb = run(`apiConBoot('${acTok}')`).cas; if (!cb.some(c => c.wo_id === id && c.required.includes('صورة'))) throw new Error(JSON.stringify(cb));
  run(`apiConAct('${acTok}', 'submit', '${id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', equip: 'AC-709-A', action: ['تغيير ريموت'], follow: 'لا', note: 'أرفقت الصورة', photos: ['data:image/jpeg;base64,AA'] })`);
  eq(run(`Db.get('CorrectiveActions', '${ca.ca_id}').status`), 'responded');
  run(`apiEngAct('${engTok}', '${id}', 'close', { sat: 'ok' })`);
  ca = run(`Db.get('CorrectiveActions', '${ca.ca_id}')`); eq(ca.status, 'closed'); eq(ca.effective, 'نعم');
  // مستقل
  const con = run(`Db.find('Contractors', c => c.name === 'مؤسسة التبريد').con_id`);
  throws(`apiEngCA('${engTok}', { con_id: '${con}', hotel_id: '${HID}', reason: 'تأخر متكرر' })`, 'المطلوب');
  const r = run(`apiEngCA('${engTok}', { con_id: '${con}', hotel_id: '${HID}', reason: 'تأخر متكرر', required: 'خطة لتقليل زمن الوصول', due: '2026-12-01' })`);
  throws(`apiEngCAAct('${engTok}', '${r.id}', 'close')`, 'بانتظار رد');
  throws(`apiConCA('${acTok}', '${r.id}', '')`, 'اكتب');
  run(`apiConCA('${acTok}', '${r.id}', 'فني ثانٍ في الدوام المسائي', [])`);
  throws(`apiEngCAAct('${engTok}', '${r.id}', 'return', '')`, 'سبب الإعادة');
  run(`apiEngCAAct('${engTok}', '${r.id}', 'return', 'أرفق جدول الدوام')`);
  eq(run(`Db.get('CorrectiveActions', '${r.id}').status`), 'open'); eq(run(`Db.get('CorrectiveActions', '${r.id}').rounds`), 1);
  run(`apiConCA('${acTok}', '${r.id}', 'أرفقنا الجدول', [])`);
  run(`apiEngCAAct('${engTok}', '${r.id}', 'close', 'تم')`);
  eq(run(`apiEngBoot('${engTok}')`).cas.find(c => c.id === r.id).effective, 'نعم');
});

t('مدير الفندق: يطّلع على عمليات فندقه وأدائه فقط، ولا إجراء سوى ملاحظة تصل لمهندس الصيانة', () => {
  const pw = run(`apiAdmAddUser('${adminTok}', { name: 'مدير وارف', role: 'gm', username: 'gm.warif', hotel_ids: ['${HID}'] })`).password;
  run(`Auth.changePassword(apiStaffLogin('gm.warif', '${pw}').token, 'Gm2026xxx')`);
  const tok = run(`apiStaffLogin('gm.warif', 'Gm2026xxx')`).token;
  const b = run(`apiEngBoot('${tok}')`);
  eq(b.me.role, 'gm'); eq(b.hotels.length, 1); eq(b.hotels[0].id, HID);
  eq(b.orders.every(o => o.hotel_id === HID), true);
  eq(run(`apiKpiBoot('${tok}')`).rows.every(r => r.hotel === HID), true);
  const any = b.orders[0].id;
  throws(`apiEngAct('${tok}', '${any}', 'close', { sat: 'good' })`, 'صلاحية');
  throws(`apiEngCreate('${tok}', { hotel_id: '${HID}', type: 'ac', symptom: 'x' })`, 'صلاحية');
  throws(`apiNote('${tok}', { wo_id: '${any}', text: '' })`, 'اكتب');
  run(`apiNote('${tok}', { wo_id: '${any}', text: 'النزيل في الغرفة يشتكي، الرجاء الإسراع' })`);
  run(`apiNote('${tok}', { hotel_id: '${HID}', service: 'wa', text: 'رائحة عند منطقة النفايات' })`);
  const mine = run(`apiEngBoot('${tok}')`).notes;
  eq(mine.length, 2); eq(mine.find(n => n.service === 'wa').to, 'sup');
  const eng = run(`apiEngBoot('${engTok}')`).notes;
  eq(eng.length, 1); eq(eng[0].wo_id, any);
  run(`apiNoteSeen('${engTok}', '${eng[0].id}')`);
  eq(!!run(`apiEngBoot('${tok}')`).notes.find(n => n.wo_id === any).seen, true);
  throws(`apiAdmAddUser('${adminTok}', { name: 'x', role: 'boss', username: 'xx.boss', hotel_ids: [] })`, 'دور');
});

t('التسهيلات: تنبيه الرافع بطلب مفتوح لنفس الموقع، واقتراح الجزء والسبب، وضغط الفريون، والمطابقة الجماعية', () => {
  const fl = run(`floorsOf_('${HID}')`).find(f => f.name === 'الدور 7').id;
  const a = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${fl}', room: '711', symptom: 'لا يبرد', name: 'سالم' })`).id;
  const b = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${fl}', room: '713', symptom: 'لا يبرد', name: 'سالم' })`).id;
  const op = run(`apiReqBoot('WARIF2')`).open;
  if (!op.some(o => o.id === a && o.room === '711' && o.floor_id === fl)) throw new Error(JSON.stringify(op));
  run(`apiConAct('${acTok}', 'submit', '${a}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', equip: 'AC-711-A', sym: 'لا يبرد', part: 'المروحة', cause: ['اتساخ'], action: ['تعبئة فريون 60%'], gas: 'R410A', pb: '50', pa: '128', follow: 'لا' })`);
  run(`apiConAct('${acTok}', 'submit', '${b}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', equip: 'AC-713-A', sym: 'لا يبرد', part: 'المروحة', cause: ['اتساخ'], action: ['تغيير ريموت'], follow: 'لا' })`);
  const rep = run(`Db.get('WorkOrders', '${a}').report`); const r0 = (typeof rep === 'string' ? JSON.parse(rep) : rep).slice(-1)[0];
  eq(r0.gas, 'R410A'); eq(String(r0.pa), '128');
  const sg = run(`apiConBoot('${acTok}')`).sugg['لا يبرد']; eq(sg.part[0], 'المروحة'); eq(sg.cause[0], 'اتساخ');
  throws(`apiEngBulkClose('${acTok}', ['${a}'], 'good')`, 'صلاحية');
  const r = run(`apiEngBulkClose('${engTok}', ['${a}', '${b}'], 'good')`);
  eq(r.n, 2); eq(run(`Db.get('WorkOrders', '${a}').status`), 'closed'); eq(run(`Db.get('WorkOrders', '${b}').sat`), 'good');
  eq(run(`apiReqBoot('WARIF2')`).open.some(o => o.id === a), false);
});

let waPin, pcPin, mgrTok, supTok;
t('الإشراف: حساب بلا كلمة مرور، يختار رقمه السري أول مرة، ويُرفض الرقم المحجوز', () => {
  eq(run(`apiAdmAddUser('${adminTok}', { name: 'مدير الإشراف', role: 'supmgr', username: 'sup.mgr', hotel_ids: ['${HID}'] })`).password, null);
  run(`apiAdmAddUser('${adminTok}', { name: 'علي المشرف', role: 'sup', username: 'sup.ali', hotel_ids: ['${HID}'] })`);
  throws(`apiStaffLogin('sup.mgr', '')`, 'اكتب');
  throws(`apiSupSetPin('sup.mgr', '111111')`, 'أصعب');
  throws(`apiSupSetPin('nobody', '135792')`, 'غير معرّف');
  throws(`apiSupSetPin('sup.mgr', '${acPin}')`, 'محجوز');
  mgrTok = run(`apiSupSetPin('sup.mgr', '135792')`).token;
  throws(`apiSupSetPin('sup.mgr', '246813')`, 'محدد من قبل');
  throws(`apiSupSetPin('sup.ali', '135792')`, 'محجوز');
  supTok = run(`apiSupSetPin('sup.ali', '246813')`).token;
  const r = run(`apiPinWebLogin('135792')`); eq(r.kind, 'sup'); eq(r.boot.me.role, 'supmgr');
  eq(run(`apiPinWebLogin('${acPin}')`).kind, 'con');
  const u = run(`apiAdmBoot('${adminTok}')`).users.find(x => x.username === 'sup.ali'); eq(u.pinSet, true);
});

t('النفايات: باركود منطقة النفايات بتحقق الموقع، للمتعهد أو المشرف، والأسئلة الأربعة والتقييم', () => {
  throws(`apiAdmSaveContract('${adminTok}', { name: 'شركة النظافة', type: 'wa', hotel_ids: ['${HID}'], start: '${yesterday}', end: '${nextYear}' })`, 'الرفع');
  waPin = run(`apiAdmSaveContract('${adminTok}', { name: 'شركة النظافة', type: 'wa', hotel_ids: ['${HID}'], start: '${yesterday}', end: '${nextYear}', wa_per_week: 3 })`).pin;
  throws(`apiAdmSaveHotelOps('${adminTok}', '${HID}', { geo: 'هنا' })`, 'الإحداثيات');
  run(`apiAdmSaveHotelOps('${adminTok}', '${HID}', { geo: 'https://www.google.com/maps/place/x/@21.4225,39.8262,17z', geo_radius: 150, wa_carts: 6 })`);
  const b = run(`apiWaBoot('WARIF2')`); eq(b.hotel.carts, 6); eq(b.hotel.geo, true); eq(b.perWeek, 3);
  run(`CacheService.getScriptCache().remove('F_con_${HID}')`);
  const near = { lat: 21.4230, lng: 39.8265, acc: 20 }, far = { lat: 21.4425, lng: 39.8262, acc: 20 };
  throws(`apiWaLogin('WARIF2', '${waPin}', null)`, 'الموقع مطلوب');
  throws(`apiWaLogin('WARIF2', '${waPin}', ${JSON.stringify(far)})`, 'خارج');
  throws(`apiWaLogin('WARIF2', '${acPin}', ${JSON.stringify(near)})`, 'النفايات');
  const w = run(`apiWaLogin('WARIF2', '${waPin}', ${JSON.stringify(near)})`); eq(w.role, 'contractor');
  throws(`apiWaSubmit('${w.token}', 'WARIF2', { truck: 'نعم', removed: 'لا', washed: 'نعم', rating: 4 }, ${JSON.stringify(near)})`, 'العربات');
  throws(`apiWaSubmit('${w.token}', 'WARIF2', { truck: 'نعم', removed: 'نعم', washed: 'نعم' }, ${JSON.stringify(near)})`, 'قيّم');
  throws(`apiWaSubmit('${w.token}', 'WARIF2', { truck: 'نعم', removed: 'نعم', washed: 'نعم', rating: 4 }, ${JSON.stringify(far)})`, 'خارج');
  run(`apiWaSubmit('${w.token}', 'WARIF2', { truck: 'نعم', removed: 'نعم', washed: 'نعم', rating: 4 }, ${JSON.stringify(near)})`);
  const s = run(`apiWaLogin('WARIF2', '246813', ${JSON.stringify(near)})`); eq(s.role, 'sup');
  const r = run(`apiWaSubmit('${s.token}', 'WARIF2', { truck: 'لا', left_carts: 5, rating: 2, note: 'لم تحضر' }, ${JSON.stringify(near)})`);
  const v = run(`Db.get('WasteVisits', '${r.id}')`); eq(v.removed, 'لا'); eq(v.by_name, 'علي المشرف');
  const sb = run(`apiSupBoot('${mgrTok}')`); eq(sb.waste.length, 2); eq(sb.hotels[0].wa.perWeek, 3);
  // ملاحظة مدير الفندق للإشراف تصل لمدير الإشراف
  eq(sb.notes.some(n => n.service === 'wa'), true);
  run(`apiNoteSeen('${mgrTok}', '${sb.notes.find(n => n.service === 'wa').id}')`);
  throws(`apiNoteSeen('${supTok}', '${sb.notes[0].id}')`, 'صلاحية');
});

t('المكافحة: دورية لكل نوع مرفق، بلاغ المشرف، معالجة المتعهد تُنجز البلاغ، والمصائد', () => {
  pcPin = run(`apiAdmSaveContract('${adminTok}', { name: 'مكافحة الخليج', type: 'pc', hotel_ids: ['${HID}'], start: '${yesterday}', end: '${nextYear}' })`).pin;
  const fl = run(`floorsOf_('${HID}')`);
  const svc = fl.find(f => f.kind === 'service') || fl[0];
  throws(`apiSupAddZone('${supTok}', '${HID}', '${svc.id}', 'المطبخ الرئيسي', 'المطبخ')`, 'صلاحية');
  run(`apiSupAddZone('${mgrTok}', '${HID}', '${svc.id}', 'المطبخ الرئيسي', 'المطبخ')`);
  throws(`apiPestSchedule('${mgrTok}', '${HID}', { 'المطبخ': 'x' })`, 'الدورية');
  run(`apiPestSchedule('${mgrTok}', '${HID}', { 'غرف النزلاء': 30, 'المطبخ': 7 })`);
  let st = run(`apiSupBoot('${mgrTok}')`).pest.hotels[HID].floors;
  const zones = [].concat(...st.map(f => f.zones));
  const kitchen = zones.find(z => z.name === 'المطبخ الرئيسي'), room = zones.find(z => z.name === '712');
  eq(kitchen.ftype, 'المطبخ'); eq(kitchen.every, 7); eq(kitchen.overdue, true); eq(room.ftype, 'غرف النزلاء');
  throws(`apiPestFlag('${supTok}', { hotel_id: '${HID}', zone: '${room.id}', kind: 'infest' })`, 'الآفة');
  run(`apiPestFlag('${supTok}', { hotel_id: '${HID}', zone: '${room.id}', kind: 'ready' })`);
  run(`apiPestFlag('${supTok}', { hotel_id: '${HID}', zone: '${kitchen.id}', kind: 'infest', pests: ['صراصير'], note: 'تحت المغسلة' })`);
  const ct = run(`apiConLogin('WARIF2', '${pcPin}', ${JSON.stringify({ lat: 21.4230, lng: 39.8265, acc: 20 })})`).token;
  const cb = run(`apiConBoot('${ct}')`); eq(cb.me.type, 'pc'); eq(cb.pest.flags.filter(f => f.status === 'open').length, 2);
  throws(`apiPestLog('${ct}', { hotel_id: '${HID}', zones: ['${room.id}'], kind: 'spray', finding: 'none' })`, 'المادة');
  const r = run(`apiPestLog('${ct}', { hotel_id: '${HID}', zones: ['${room.id}', '${kitchen.id}'], kind: 'spray', pests: ['صراصير'], material: 'جل', finding: 'light' })`);
  eq(r.result.flags, 2);
  st = run(`apiSupBoot('${mgrTok}')`).pest;
  const k2 = [].concat(...st.hotels[HID].floors.map(f => f.zones)).find(z => z.id === kitchen.id);
  eq(k2.overdue, false); eq(k2.flags.length, 0); eq(st.flags.filter(f => f.status === 'done').length, 2);
  const tp = run(`apiPestTrap('${ct}', 'place', { hotel_id: '${HID}', zone: '${kitchen.id}', kind: 'محطة طعوم قوارض', every_days: 7 })`).result;
  eq(tp.label, 'T-01');
  run(`apiPestTrap('${ct}', 'check', { trap_id: '${tp.id}', result: 'نظيفة' })`);
  eq(run(`apiConBoot('${ct}')`).pest.hotels[HID].traps[0].result, 'نظيفة');
  run(`apiPestTrap('${ct}', 'remove', { trap_id: '${tp.id}' })`);
  eq(run(`apiConBoot('${ct}')`).pest.hotels[HID].traps.length, 0);
  // متعهد التكييف لا يسجّل مكافحة
  throws(`apiPestLog('${acTok}', { hotel_id: '${HID}', zones: ['${room.id}'], kind: 'inspect', finding: 'none' })`, 'المكافحة');
});

t('التقييم الدوري: يصدره المختص لفترة يختارها، ويُحفظ بدرجته وقراره ويظهر في التقارير', () => {
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10), from = yesterday.slice(0, 8) + '01';
  const wa = run(`Db.find('Contractors', c => c.type === 'wa').con_id`), ac = run(`Db.find('Contractors', c => c.type === 'ac').con_id`);
  throws(`apiEvalPreview('${engTok}', '${wa}', '${from}', '${today}')`, 'صلاحية');
  throws(`apiEvalPreview('${mgrTok}', '${ac}', '${from}', '${today}')`, 'صلاحية');
  const p = run(`apiEvalPreview('${mgrTok}', '${wa}', '${from}', '${today}')`);
  eq(p.X.visits, 2); eq(p.X.noTruck, 1); eq(p.V.wash, 100); eq(p.V.clean, 60);
  throws(`apiEvalIssue('${mgrTok}', '${wa}', '${from}', '${today}', 'ممتاز', '')`, 'القرار');
  run(`apiEvalIssue('${mgrTok}', '${wa}', '${from}', '${today}', 'مستمر مع خطة تحسين', 'تأخر الشاحنة مرة')`);
  const ev = run(`apiSupBoot('${mgrTok}')`).evals; eq(ev.length, 1); eq(ev[0].from, from); eq(ev[0].decision, 'مستمر مع خطة تحسين');
  const pa = run(`apiEvalPreview('${engTok}', '${ac}', '${from}', '${today}')`); if (pa.V.resp == null && pa.X.orders === 0) throw new Error('no ac data');
  run(`apiEvalIssue('${engTok}', '${ac}', '${from}', '${today}', 'مستمر', '')`);
  eq(run(`apiEngBoot('${engTok}')`).evals.length, 1);
  eq(run(`apiConBoot('${acTok}')`).evals.length, 1);
  const pc = run(`Db.find('Contractors', c => c.type === 'pc').con_id`);
  const pp = run(`apiEvalPreview('${mgrTok}', '${pc}', '${from}', '${today}')`); eq(pp.X.flags, 2); eq(pp.X.open, 0);
});

t('سليم: يسجّل المتعهد ما فحصه، ويُحسب داخلياً في موثوقية البلاغات لا على المتعهد', () => {
  const id = run(`apiReqSubmit('WARIF2', { type: 'el', equip: 'مصعد النزلاء 1', symptom: 'صوت أو اهتزاز', name: 'نورة' })`).id;
  throws(`apiConAct('${elTok}', 'submit', '${id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'ok', working: 'نعم' })`, 'ما فحصته');
  run(`apiConAct('${elTok}', 'submit', '${id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'ok', working: 'نعم', checked: ['الماكينة', 'الحبال'], note: 'لا صوت عند التشغيل' })`);
  run(`apiEngAct('${engTok}', '${id}', 'close', { sat: 'good' })`);
  const rows = run(`Kpi.rows(function(){return true}, 2)`).filter(r => r.hotel === HID);
  const ok = rows.reduce((a, r) => a + (r.d.okN || 0), 0), rep = rows.reduce((a, r) => a + (r.d.repN || 0), 0);
  if (!(ok >= 1 && rep >= ok)) throw new Error('okN ' + ok + ' repN ' + rep);
  if (!rows.some(r => r.d.okBy && r.d.okBy['نورة'])) throw new Error('okBy');
});

t('المصاعد بعد العرض: بانتظار الاعتماد والسداد، والإصلاح قبل السداد ثم تسجيل السداد بعد الإغلاق، وإشعار إدارتهم بالبريد', () => {
  const id = run(`apiReqSubmit('WARIF2', { type: 'el', equip: 'مصعد النزلاء 1', symptom: 'الباب لا يُغلق', name: 'نورة' })`).id;
  run(`apiConAct('${elTok}', 'submit', '${id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'diag', part: 'حساس الباب', rec: ['حساس باب'], working: 'نعم' })`);
  run(`apiEngRfq('${engTok}', '${id}')`);
  run(`apiEngAct('${engTok}', '${id}', 'quote', { amount: 1200, no: 'Q-90' })`);
  run(`apiEngAct('${engTok}', '${id}', 'decide', { decision: 'con' })`);
  eq(run(`Db.get('WorkOrders', '${id}').status`), 'pay');
  const n0 = sentMail.length;
  const r = run(`apiEngAct('${engTok}', '${id}', 'prepay', { date: '2026-10-25' })`);
  eq(r.mailed, 'sales@lift.sa,ops@lift.sa'); eq(sentMail.length, n0 + 1); if (!sentMail[n0].to.subject.includes('قبل السداد')) throw new Error('subject');
  const o = run(`Db.get('WorkOrders', '${id}')`); eq(o.status, 'in_progress'); eq(o.pay_pending, true);
  const j = run(`apiConBoot('${elTok}')`).jobs.find(x => x.id === id); if (!j.note.includes('قبل السداد')) throw new Error(j.note);
  eq(run(`apiEngBoot('${engTok}')`).orders.find(x => x.id === id).pay_pending, true);
  run(`apiConAct('${elTok}', 'submit', '${id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', part: 'حساس الباب', cause: ['تآكل طبيعي'], working: 'نعم', follow: 'لا' })`);
  run(`apiEngAct('${engTok}', '${id}', 'close', { sat: 'good' })`);
  run(`apiEngAct('${engTok}', '${id}', 'paid', { receipt: 'R-5' })`);
  const o2 = run(`Db.get('WorkOrders', '${id}')`); eq(o2.status, 'closed'); eq(o2.pay_pending, false); eq(!!o2.paid_at, true);
  if (!sentMail[sentMail.length - 1].to.subject.includes('إشعار سداد')) throw new Error('paid mail');
  throws(`apiEngAct('${engTok}', '${id}', 'paid', {})`, 'ليست بانتظار السداد');
});

t('تيليجرام: طلب التكييف يُنشر في مجموعة الفندق، وأول من يضغط «أستلمه» يستلمه، والتنبيه عند عدم الاستلام', () => {
  throws(`apiAdmTgCode('${adminTok}', '${HID}')`, 'البوت');
  throws(`apiAdmTgSetup('${adminTok}', 'abc')`, 'غير صحيح');
  eq(run(`apiAdmTgSetup('${adminTok}', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ')`).bot, 'AwanBot');
  eq(triggers.filter(t => t.getHandlerFunction() === 'tgPoll').length, 1);
  const code = run(`apiAdmTgCode('${adminTok}', '${HID}')`).code;
  tgQueue.push({ update_id: 1, message: { chat: { id: -100777 }, text: '/link ' + code } });
  run(`tgPoll()`);
  eq(String(run(`Db.get('Hotels', '${HID}').tg_chat`)), '-100777');
  const fl = run(`floorsOf_('${HID}')`).find(f => f.name === 'الدور 7').id;
  const n0 = tgCalls.length;
  const id = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${fl}', room: '714', symptom: 'لا يبرد', name: 'سالم' })`).id;
  const sent = tgCalls.slice(n0).find(c => c.m === 'sendMessage');
  eq(sent.p.chat_id, '-100777'); if (!sent.p.text.includes(id) || !sent.p.text.includes('بانتظار الاستلام')) throw new Error(sent.p.text);
  eq(sent.p.reply_markup.inline_keyboard[0][0].callback_data, 'c|' + id);
  tgQueue.push({ update_id: 2, callback_query: { id: 'q1', data: 'c|' + id, from: { id: 9, first_name: 'أحمد', last_name: 'علي' } } });
  tgQueue.push({ update_id: 3, callback_query: { id: 'q2', data: 'c|' + id, from: { id: 10, first_name: 'خالد' } } });
  run(`tgPoll()`);
  const o = run(`Db.get('WorkOrders', '${id}')`); eq(o.claimed_by, 'أحمد علي');
  const late = tgCalls.filter(c => c.m === 'answerCallbackQuery' && c.p.callback_query_id === 'q2')[0]; if (!late.p.text.includes('أحمد علي')) throw new Error('second claim');
  const ed = tgCalls.filter(c => c.m === 'editMessageText').slice(-1)[0]; if (!ed.p.text.includes('استلمه أحمد علي') || ed.p.reply_markup.inline_keyboard.length) throw new Error(ed.p.text);
  eq(run(`apiEngBoot('${engTok}')`).orders.find(x => x.id === id).claimed_by, 'أحمد علي');
  // تنبيه لطلب لم يُستلم
  const id2 = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${fl}', room: '713', symptom: 'لا يبرد', name: 'سالم' })`).id;
  run(`(function(){var P=PropertiesService.getScriptProperties(),p=JSON.parse(P.getProperty('TG_PEND'));p.forEach(function(x){x.due=0});P.setProperty('TG_PEND',JSON.stringify(p))})()`);
  eq(run(`JSON.parse(PropertiesService.getScriptProperties().getProperty('TG_PEND')).length`), 1);
  const n1 = tgCalls.length; run(`tgPoll()`); run(`tgPoll()`);
  eq(tgCalls.slice(n1).filter(c => c.m === 'sendMessage' && c.p.text.includes('لم يُستلم')).length, 1);
  // الحالة تتحدّث مع الإجراءات
  run(`apiConAct('${acTok}', 'submit', '${id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', equip: 'AC-714-A', sym: 'لا يبرد', part: 'المروحة', cause: ['اتساخ'], action: ['تغيير ريموت'], follow: 'لا' })`);
  { const e = tgCalls.filter(c => c.m === 'editMessageText').slice(-1)[0]; if (!e.p.text.includes('مطابقة')) throw new Error('refresh ' + e.p.text + ' ' + run(`Db.get('WorkOrders', '${id}').status`)); }
  // المصاعد لا تُنشر
  const n2 = tgCalls.length; run(`apiReqSubmit('WARIF2', { type: 'el', equip: 'مصعد النزلاء 1', symptom: 'متوقف', name: 'سالم' })`);
  eq(tgCalls.slice(n2).filter(c => c.m === 'sendMessage').length, 0);
});

t('البريد الرسمي عنواناً بديلاً، وزمن الاستلام، ولا معلومات مالية لدى المتعهد', () => {
  throws(`apiAdmMailFrom('${adminTok}', 'x@')`, 'غير صحيح');
  const t0 = sentMail.length;
  eq(run(`apiAdmMailFrom('${adminTok}', 'Maint@Nawazi.sa')`).from, 'maint@nawazi.sa');
  eq(sentMail[t0].to.to, 'maint@nawazi.sa'); if (!sentMail[t0].to.subject.includes('تجريبية')) throw new Error('test mail');
  const id = run(`apiReqSubmit('WARIF2', { type: 'el', equip: 'مصعد النزلاء 1', symptom: 'صوت أو اهتزاز', name: 'نورة' })`).id;
  run(`apiConAct('${elTok}', 'submit', '${id}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'diag', rec: ['بكرة باب'], working: 'نعم' })`);
  const n0 = sentMail.length; run(`apiEngRfq('${engTok}', '${id}')`);
  eq(sentMail[n0].gmail, true); eq(sentMail[n0].to.from, 'maint@nawazi.sa');
  run(`apiAdmMailFrom('${adminTok}', '')`);
  const k = run(`apiKpiBoot('${acTok}')`); eq(Object.keys(k.prices).length, 0);
  eq(k.rows.some(r => r.d && (r.d.spend !== undefined || r.d.acts !== undefined)), false);
  const ks = run(`apiKpiBoot('${engTok}')`); if (!Object.keys(ks.prices).length) throw new Error('staff prices');
  const cl = ks.rows.reduce((a, r) => a + ((r.d && r.d.clN) || 0), 0); if (cl < 1) throw new Error('claim kpi');
});

t('شاحنات المياه: باركود بالرقم السري والموقع إلزامي، الأحجام من العقد، مطابقة مدير الفندق أو المناوب، والكشف للمعتمد', () => {
  const NID = run(`Db.all('Hotels').find(h => h.code === 'NAWAZI').hotel_id`);
  throws(`apiAdmSaveContract('${adminTok}', { name: 'مياه زمزم', type: 'wt', hotel_ids: ['${HID}'], start: '${yesterday}', end: '${nextYear}', prices: {} })`, 'حجم');
  const wtPin = run(`apiAdmSaveContract('${adminTok}', { name: 'مياه زمزم', type: 'wt', hotel_ids: ['${HID}', '${NID}'], start: '${yesterday}', end: '${nextYear}', prices: { '19 م³': '350', '32': 520, 'x': 5 } })`).pin;
  const conId = run(`Db.all('Contractors').find(c => c.type === 'wt').con_id`);
  eq(run(`apiWtBoot('WARIF2')`).sizes.join(','), '19,32');
  run(`CacheService.getScriptCache().remove('F_con_${HID}')`); run(`CacheService.getScriptCache().remove('F_con_${NID}')`);
  const near = { lat: 21.4230, lng: 39.8265, acc: 20 }, far = { lat: 21.4425, lng: 39.8262, acc: 20 };
  throws(`apiWtLogin('NAWAZI', '${wtPin}', ${JSON.stringify(near)})`, 'لم يُحدَّد موقع');
  throws(`apiWtLogin('WARIF2', '${wtPin}', null)`, 'الموقع مطلوب');
  throws(`apiWtLogin('WARIF2', '${acPin}', ${JSON.stringify(near)})`, 'المياه');
  const tk = run(`apiWtLogin('WARIF2', '${wtPin}', ${JSON.stringify(near)})`).token;
  throws(`apiWtSubmit('${tk}', 'WARIF2', { driver: '', size: 19 }, ${JSON.stringify(near)})`, 'السائق');
  throws(`apiWtSubmit('${tk}', 'WARIF2', { driver: 'سالم', size: 10 }, ${JSON.stringify(near)})`, 'حجم');
  throws(`apiWtSubmit('${tk}', 'WARIF2', { driver: 'سالم', size: 19 }, ${JSON.stringify(far)})`, 'خارج');
  throws(`apiWtSubmit('${tk}', 'WARIF2', { driver: 'سالم', size: 19, receipt: ' ' }, ${JSON.stringify(near)})`, 'السند');
  const a = run(`apiWtSubmit('${tk}', 'WARIF2', { driver: 'سالم', size: 19, receipt: 'A1', photos: ['data:image/jpeg;base64,AAAA'] }, ${JSON.stringify(near)})`);
  eq(a.dup, null);
  throws(`apiWtSubmit('${tk}', 'WARIF2', { driver: 'سالم', size: 19, receipt: 'A1' }, ${JSON.stringify(near)})`, 'مسجّل');
  const b = run(`apiWtSubmit('${tk}', 'WARIF2', { driver: 'فهد', size: 32, receipt: 'A2' }, ${JSON.stringify(near)})`);
  eq(b.dup, 0);
  const cb = run(`apiPinWebLogin('${wtPin}')`).boot;
  eq(cb.water.length, 2); eq(cb.water.some(x => 'price' in x), false);
  const gm = run(`apiStaffLogin('gm.warif', 'Gm2026xxx')`).token;
  const gb = run(`apiEngBoot('${gm}')`).water;
  eq(gb.canMatch, true); eq(gb.loads.length, 2); eq(gb.loads.find(x => x.id === b.id).dup, true);
  eq(run(`apiEngBoot('${engTok}')`).water.canMatch, false);
  throws(`apiWtMatch('${engTok}', ['${a.id}'], true)`, 'صلاحية');
  throws(`apiWtMatch('${gm}', ['${b.id}'], false, '')`, 'سبب');
  run(`apiWtMatch('${gm}', ['${a.id}'], true)`);
  run(`apiWtMatch('${gm}', ['${b.id}'], false, 'نقلة مكررة')`);
  eq(run(`Db.get('WaterLoads', '${b.id}').status`), 'rejected');
  // المدير المناوب
  const pw = run(`apiAdmAddUser('${adminTok}', { name: 'المناوب', role: 'duty', username: 'duty.warif', hotel_ids: ['${HID}'] })`).password;
  run(`Auth.changePassword(apiStaffLogin('duty.warif', '${pw}').token, 'Duty2026xx')`);
  const du = run(`apiStaffLogin('duty.warif', 'Duty2026xx')`).token;
  const tk2 = run(`apiWtLogin('WARIF2', '${wtPin}', ${JSON.stringify(near)})`).token;
  const c = run(`apiWtSubmit('${tk2}', 'WARIF2', { driver: 'سالم', size: 19, receipt: 'A2' }, ${JSON.stringify(near)})`);
  eq(run(`apiWtMatch('${du}', ['${c.id}'], true)`).n, 1);
  throws(`apiEngAct('${du}', '${run(`Db.all('WorkOrders')[0].wo_id`)}', 'close', {})`, 'صلاحية');
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const st = run(`apiWtStatement('${gm}', '${conId}', 'all', '${today}', '${today}')`);
  eq(st.count, 2); eq(st.vol, 38); eq(st.total, 700); eq(st.rejected, 1); eq(st.pending, 0); eq(st.lines[0].size, 19);
  throws(`apiWtStatement('${cb.me ? 'x' : ''}', '${conId}', 'all', '${today}', '${today}')`, '');
});

t('البحث بالفهرس: الوصول لعملية بمعرّفها يقرأ صفاً واحداً، والأرشفة الليلية تبقي الجدول النشط صغيراً دون فقد شيء', () => {
  const any = run(`Db.all('WorkOrders')[3].wo_id`);
  run(`Db.reset()`);
  const ss = run(`Db.ss()`); const r0 = ss.reads;
  const o = run(`Db.get('WorkOrders', '${any}')`); eq(o.wo_id, any);
  if (ss.reads - r0 > 4) throw new Error('reads ' + (ss.reads - r0));
  run(`Db.update('WorkOrders', '${any}', { description: 'تحديث بالفهرس' })`);
  run(`Db.reset()`); eq(run(`Db.all('WorkOrders').find(x => x.wo_id === '${any}').description`), 'تحديث بالفهرس');
  eq(run(`Db.get('WorkOrders', 'AWN-99999')`), null);
  // أرشفة: عملية مغلقة قديمة
  const fl = run(`floorsOf_('${HID}')`).find(f => f.name === 'الدور 7').id;
  const id = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${fl}', room: '701', symptom: 'لا يبرد', name: 'قديم' })`).id;
  run(`Db.update('WorkOrders', '${id}', { status: 'closed', closed_at: new Date(Date.now() - 90 * 864e5), created_at: new Date(Date.now() - 95 * 864e5) })`);
  const before = run(`Db.all('WorkOrders').length`);
  const n = run(`archiveAwan()`); if (n < 1) throw new Error('archived ' + n);
  run(`Db.reset()`);
  eq(run(`Db.all('WorkOrders').length`), before - n);
  eq(run(`Db.get('WorkOrders', '${id}')`), null); eq(run(`Db.get('WorkOrdersArchive', '${id}').requester`), 'قديم');
  const f = run(`apiEngFind('${engTok}', '${id.toLowerCase()}')`); eq(f.id, id); eq(f.archived, true);
  throws(`apiEngFind('${engTok}', 'AWN-99999')`, 'لا توجد');
  eq(run(`archiveAwan()`), 0);
  // الدورات ما زالت تعمل بعد الأرشفة
  const id2 = run(`apiReqSubmit('WARIF2', { type: 'ac', floor_id: '${fl}', room: '702', symptom: 'لا يبرد', name: 'جديد' })`).id;
  run(`apiConAct('${acTok}', 'submit', '${id2}', { att: ['data:image/jpeg;base64,AAAA'], outcome: 'fix', equip: 'AC-702-A', sym: 'لا يبرد', part: 'المروحة', cause: ['اتساخ'], action: ['تغيير ريموت'], follow: 'لا' })`);
  run(`apiEngAct('${engTok}', '${id2}', 'close', { sat: 'good' })`);
  eq(run(`Db.get('WorkOrders', '${id2}').status`), 'closed');
  run(`apiAdmKpiRebuild('${adminTok}')`);
});

t('الخدمات المساندة: الفريق يطّلع على النفايات والمكافحة، ومشرف النظام يرفض زيارة لم تحدث فلا تُحسب', () => {
  const b = run(`apiSvcBoot('${adminTok}')`);
  eq(b.canReject, true); if (!b.waste.length) throw new Error('no visits'); eq(typeof b.pest.logs, 'object');
  const gm = run(`apiStaffLogin('gm.warif', 'Gm2026xxx')`).token;
  eq(run(`apiSvcBoot('${gm}')`).canReject, false);
  throws(`apiSvcBoot('${engTok}')`, 'صلاحية');
  const id = b.waste[0].id;
  throws(`apiWaReject('${gm}', '${id}', 'x')`, 'صلاحية');
  throws(`apiWaReject('${adminTok}', '${id}', '')`, 'سبب');
  const r = run(`apiWaReject('${adminTok}', '${id}', 'لم تحضر الشاحنة فعلياً')`);
  const v = r.boot.waste.find(x => x.id === id); eq(v.status, 'rejected'); eq(v.reason, 'لم تحضر الشاحنة فعلياً');
});

t('بلاغ المكافحة: من باركود الطلبات للجميع، ومن مدير الفندق ومشرف النظام، ويظهر للمتعهد والإشراف', () => {
  const b = run(`apiReqBoot('WARIF2')`); eq(b.has.pc, true); if (!b.pests.length) throw new Error('pests');
  const fl = run(`floorsOf_('${HID}')`).find(f => f.name === 'الدور 7').id;
  throws(`apiReqPest('WARIF2', { floor_id: '${fl}', room: '799', pests: ['صراصير'], name: 'سعاد' })`, 'من القائمة');
  throws(`apiReqPest('WARIF2', { floor_id: '${fl}', room: '705', pests: [], name: 'سعاد' })`, 'الآفة');
  throws(`apiReqPest('WARIF2', { floor_id: '${fl}', room: '705', pests: ['صراصير'], name: '' })`, 'اسمك');
  run(`apiReqPest('WARIF2', { floor_id: '${fl}', room: '705', pests: ['صراصير'], name: 'سعاد', note: 'في الحمام' })`);
  run(`Db.reset()`); const all = run(`Db.all('PestFlags')`); const sb = run(`supBoot_(Auth.session('${supTok}'))`).pest.flags.find(f => f.zoneName === '705' && f.status === 'open'); if (!sb) throw new Error(JSON.stringify(all.slice(-2)));
  eq(sb.src, 'req'); eq(sb.by, 'سعاد');
  const gm = run(`apiStaffLogin('gm.warif', 'Gm2026xxx')`).token;
  const z = run(`Db.find('Rooms', r => r.hotel_id === '${HID}' && String(r.number) === '706').room_id`);
  eq(run(`apiSvcBoot('${gm}')`).canFlag, true);
  throws(`apiSvcPestFlag('${engTok}', { hotel_id: '${HID}', zone: '${z}', pests: ['نمل'] })`, 'صلاحية');
  const r = run(`apiSvcPestFlag('${gm}', { hotel_id: '${HID}', zone: '${z}', pests: ['نمل'] })`);
  const f2 = r.boot.pest.flags.find(f => f.zone === z && f.status === 'open'); eq(f2.src, 'staff'); eq(f2.kind, 'infest');
});

t('الممرات: لكل دور غرف ممر تلقائي يظهر في خريطة المكافحة بنوع الممرات، والأدوار بأبراجها', () => {
  const st = run(`Ops.pestState('${HID}')`);
  const f7 = st.find(f => /الدور 7/.test(f.label)); const c = f7.zones.find(z => z.name === 'ممر الدور 7');
  if (!c) throw new Error('no corridor'); eq(c.fac, true); eq(c.ftype, 'الممرات'); eq(typeof f7.tower, 'string');
  const n = run(`Db.all('Rooms', r => r.floor_id === '${f7.id}' && /^ممر/.test(String(r.number))).length`); eq(n, 1);
  run(`ensureCorridors_('${HID}')`); eq(run(`Db.all('Rooms', r => r.floor_id === '${f7.id}' && /^ممر/.test(String(r.number))).length`), 1);
});

t('غرف النزلاء: مرات في الشهر عند الإتاحة، لا تأخر قبل الإتاحة، وبلاغ الإتاحة يدخل التقييم', () => {
  run(`Ops.saveSchedule(Auth.session('${adminTok}'), '${HID}', { 'غرف النزلاء': { pm: 2 }, 'الممرات': 7 })`);
  const st = run(`Ops.pestState('${HID}')`); const z = st.find(f => /الدور 7/.test(f.label)).zones.find(x => x.name === '710');
  eq(z.quota, 2); eq(z.every, 0); eq(z.overdue, false); eq(z.monthN, 0);
  const c = st.find(f => /الدور 7/.test(f.label)).zones.find(x => x.name === 'ممر الدور 7'); eq(c.every, 7); eq(c.quota, 0);
  throws(`Ops.saveSchedule(Auth.session('${adminTok}'), '${HID}', { 'غرف النزلاء': { pm: 40 } })`, 'الشهر');
  eq(run(`Db.find('PestSchedule', r => r.key === '${HID}|غرف النزلاء').per_month`), 2);
});

t('ترقية الهيكل من إصدار سابق لا تعطل فتح الواجهة (المهندس والإدارة ومدير الفندق)', () => {
  run(`Db.update('Settings', 'schema_version', { value: 19 }); Db.reset()`);
  run(`apiEngBoot('${adminTok}')`); run(`apiAdmBoot('${adminTok}')`);
  eq(String(run(`Db.setting('schema_version')`)), String(run(`SCHEMA_VERSION`)));
  const gm = run(`apiStaffLogin('gm.warif', 'Gm2026xxx')`).token; run(`apiEngBoot('${gm}')`); run(`apiSvcBoot('${gm}')`); run(`apiKpiBoot('${gm}')`);
  run(`apiEngBoot('${engTok}')`); run(`apiKpiBoot('${adminTok}')`);
});

t('تواصل: تذكرة المتعهد ← إفادة المالك ← رد الإدارة بالإجراء ← تقييم المتعهد، والمياه لمدير الفندق، وتقييم المؤسسة الشهري', () => {
  throws(`apiConTicket('${acTok}', { type: 'complaint', topic: 'الطلبات والإسناد', text: '' })`, 'التفاصيل');
  const id = run(`apiConTicket('${acTok}', { type: 'complaint', topic: 'الطلبات والإسناد', text: 'الطلبات تصل بلا رقم غرفة أحياناً', hotel_id: '${HID}' })`).id;
  const eb = run(`apiEngBoot('${engTok}')`).tickets.find(t => t.id === id); eq(eb.owner, 'engineer'); eq(eb.status, 'new');
  run(`apiTicketAct('${engTok}', '${id}', 'note', { note: 'صحيح، نوجّه الاستقبال' })`);
  throws(`apiTicketAct('${engTok}', '${id}', 'close', { reply: 'x', action: 'y', accepted: 'مقبولة' })`, 'للإدارة');
  throws(`apiTicketAct('${adminTok}', '${id}', 'close', { reply: 'نعتذر', accepted: 'مقبولة' })`, 'الإجراء');
  throws(`apiTicketAct('${adminTok}', '${id}', 'close', { reply: 'نعتذر', action: 'تدريب الاستقبال' })`, 'مقبولة');
  run(`apiTicketAct('${adminTok}', '${id}', 'close', { reply: 'نعتذر', action: 'تدريب الاستقبال', accepted: 'مقبولة' })`);
  eq(run(`apiConTicketRate('${acTok}', '${id}', 'غير راضٍ', 'تكرر')`).r, 'reopened');
  run(`apiTicketAct('${adminTok}', '${id}', 'close', { reply: 'أُضيف حقل إلزامي', action: 'تعديل النموذج', accepted: 'مقبولة' })`);
  eq(run(`apiConTicketRate('${acTok}', '${id}', 'راضٍ', '')`).r, 'rated');
  const gm = run(`apiStaffLogin('gm.warif', 'Gm2026xxx')`).token;
  eq(run(`apiEngBoot('${gm}')`).tickets.some(t => t.id === id), true);
  // تقييم المؤسسة للشهر السابق
  const acCon = run(`Db.find('Contractors', c => c.type === 'ac').con_id`);
  run(`Db.all('Contracts').filter(c => c.con_id === '${acCon}').forEach(c => Db.update('Contracts', c.contract_id, { start: new Date(Date.now() - 70 * 864e5) }))`);
  const p = run(`conBoot_(Auth.session('${acTok}')).org`); if (!p.hotels.some(h => h.id === HID)) throw new Error('no pending');
  throws(`apiConOrgEval('${acTok}', '${HID}', { clarity: 5 }, '')`, 'كل البنود');
  run(`apiConOrgEval('${acTok}', '${HID}', { clarity: 4, speed: 5, access: 3, team: 5, commit: 4, comm: 5, system: 4 }, 'تعاون ممتاز', 'م. سالم')`);
  eq(run(`conBoot_(Auth.session('${acTok}')).org`).hotels.some(h => h.id === HID), false);
  const o = run(`apiEngBoot('${adminTok}')`).org.rows.find(r => r.hotel_id === HID); eq(o.avg.access, 3);
});

t('قائد فريق المصاعد: الفني ينهي ويرسل للقائد، والقائد برقمه الخاص يستكمل التقرير والمرفق إلزامي', () => {
  const ctr = run(`Db.all('Contracts').filter(c => c.type === 'el').pop().contract_id`);
  throws(`apiAdmLeadPin('${adminTok}', '${ctr}', '')`, 'اسم');
  const lp = run(`apiAdmLeadPin('${adminTok}', '${ctr}', 'م. عدنان')`).pin;
  eq(run(`Auth.pinTaken('${lp}')`), true);
  run(`CacheService.getScriptCache().remove('F_con_${HID}')`);
  const tk = run(`apiConLogin('WARIF2', '${elPin}')`).token;
  const id = run(`apiReqSubmit('WARIF2', { type: 'el', equip: 'مصعد النزلاء 1', symptom: 'الباب لا يُغلق', name: 'خالد' })`).id;
  throws(`apiConAct('${tk}', 'submit', '${id}', { outcome: 'lead' })`, 'يعمل');
  eq(run(`apiConAct('${tk}', 'submit', '${id}', { outcome: 'lead', working: 'نعم', note: 'ضبط القفل' })`).result.status, 'lead');
  eq(run(`Db.get('WorkOrders', '${id}').status`), 'lead');
  const L = run(`apiPinWebLogin('${lp}')`); eq(L.kind, 'con'); eq(L.boot.me.lead, 'م. عدنان');
  eq(L.boot.jobs.some(j => j.id === id && j.status === 'lead'), true);
  throws(`apiConAct('${L.token}', 'submit', '${id}', { outcome: 'lead', working: 'نعم' })`, 'الفني');
  throws(`apiConAct('${L.token}', 'submit', '${id}', { outcome: 'fix', sym: 'الباب لا يُغلق', part: 'حساس الباب', cause: ['تآكل طبيعي'], action: ['ضبط'], working: 'نعم', follow: 'لا' })`, 'التقرير الفني');
  run(`apiConAct('${L.token}', 'submit', '${id}', { att: ['data:application/pdf;base64,JVBERi0='], outcome: 'fix', sym: 'الباب لا يُغلق', part: 'حساس الباب', cause: ['تآكل طبيعي'], action: ['ضبط'], working: 'نعم', follow: 'لا' })`);
  const o = run(`Db.get('WorkOrders', '${id}')`); eq(o.status, 'matching'); if (!o.att) throw new Error('no att');
  const rep = JSON.parse(o.report).pop(); eq(rep.by, 'م. عدنان (قائد الفريق)');
});

t('الواجهة: كل كتل السكربت في ملفات html سليمة الصياغة (خطأ واحد يعطل الصفحة كلها)', () => {
  fs.readdirSync(src).filter(f => f.endsWith('.html')).forEach(f => {
    const html = fs.readFileSync(path.join(src, f), 'utf8').replace(/<\?!=[\s\S]*?\?>/g, '0');
    const re = /<script[^>]*>([\s\S]*?)<\/script>/g; let m, i = 0;
    while ((m = re.exec(html))) { i++; try { new vm.Script(m[1]); } catch (e) { throw new Error(f + ' كتلة ' + i + ': ' + e.message); } }
  });
});

console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
