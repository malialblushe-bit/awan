/**
 * Api.js — أعوان: مدخل تطبيق الويب ودوال الواجهة.
 * الباركودان روابط لنفس التطبيق:
 *   ?h=<رمز الفندق>&m=req  → نموذج رفع الطلب (فريق العمل، بلا دخول)
 *   ?h=<رمز الفندق>&m=con  → دخول المتعهد بالرقم السري (ويُسجَّل وقت الوصول)
 *   بلا معاملات          → دخول المشرف والمهندس والإدارة
 * كل دالة تعيد ما تحتاجه الشاشة في رد واحد (مبدأ أقل الطلبات).
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var t = HtmlService.createTemplateFromFile('App');
  t.boot = JSON.stringify({ hotel: String(p.h || '').toUpperCase(), mode: String(p.m || '') });
  return t.evaluate()
    .setTitle('أعوان')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ───────── أدوات ─────────
function webUrl_() {
  if (typeof WEB_URL !== 'undefined' && WEB_URL) return WEB_URL;
  try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; }
}

function listsFor_(type) {
  var out = { sym: [], part: [], cause: [], parts: [], leave: [], reject: [] };
  Db.all('Lists', function (l) { return l.status === 'active' && (l.type === type || l.type === 'all'); })
    .sort(function (a, b) { return Number(a.sort) - Number(b.sort); })
    .forEach(function (l) { if (out[l.list]) out[l.list].push({ ar: l.ar, en: l.en }); });
  return out;
}

function isFacility_(r, floor) { return r.kind === 'facility' || (!r.kind && !!floor && floor.kind !== 'rooms'); }

function sortFloors_(a, b) { return Number(a.sort) - Number(b.sort); }

/** الأدوار مع مرافقها (للنماذج): {id, name, kind, facilities:[أسماء]} */
function floorsOf_(hotelId) {
  var rooms = Db.all('Rooms', function (r) { return r.hotel_id === hotelId; });
  return Db.all('Floors', function (f) { return f.hotel_id === hotelId; }).sort(sortFloors_).map(function (f) {
    return {
      id: f.floor_id, name: f.name, kind: f.kind === 'rooms' ? 'rooms' : 'service',
      facilities: rooms.filter(function (r) { return r.floor_id === f.floor_id && isFacility_(r, f); }).map(function (r) { return String(r.number); })
    };
  });
}

/** تخطيط الفندق الكامل لشاشة المشرف */
function hotelLayout_(hotelId) {
  var rooms = Db.all('Rooms', function (r) { return r.hotel_id === hotelId; });
  return Db.all('Floors', function (f) { return f.hotel_id === hotelId; }).sort(sortFloors_).map(function (f) {
    var rs = rooms.filter(function (r) { return r.floor_id === f.floor_id; });
    var rr = rs.filter(function (r) { return !isFacility_(r, f); });
    var nums = rr.map(function (r) { return parseInt(r.number, 10); }).filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
    return {
      id: f.floor_id, name: f.name, kind: f.kind === 'rooms' ? 'rooms' : 'service',
      rooms: rr.length, from: nums.length ? nums[0] : null, to: nums.length ? nums[nums.length - 1] : null,
      acPer: rr.length ? Orders.csv(rr[0].ac_units).length : 0,
      ac: rr.reduce(function (a, r) { return a + Orders.csv(r.ac_units).length; }, 0),
      facilities: rs.filter(function (r) { return isFacility_(r, f); }).map(function (r) { return { id: r.room_id, name: String(r.number), units: Orders.csv(r.ac_units) }; })
    };
  });
}

var ELEV_FIELDS = ['kind', 'brand', 'capacity_kg', 'persons', 'stops', 'floors_served', 'install_year', 'serial', 'notes'];

function elevatorCards_(hotelId) {
  return Db.all('Elevators', function (e) { return e.hotel_id === hotelId && String(e.active).toUpperCase() !== 'FALSE'; }).map(function (e) {
    var o = { id: e.elev_id, name: e.name };
    ELEV_FIELDS.forEach(function (k) { o[k] = e[k] === undefined || e[k] === null ? '' : String(e[k]); });
    return o;
  });
}

function elevatorsOf_(hotelId) {
  return Db.all('Elevators', function (e) { return e.hotel_id === hotelId && String(e.active).toUpperCase() !== 'FALSE'; })
    .map(function (e) { return e.name; });
}

function savePhotos_(list, prefix) {
  if (!list || !list.length) return [];
  var folderId = Db.setting('photos_folder_id');
  var folder = DriveApp.getFolderById(folderId);
  return list.slice(0, 6).map(function (dataUrl, i) {
    var m = String(dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
    if (!m) throw new Error('صيغة الصورة غير مقبولة.');
    var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], prefix + '-' + Date.now() + '-' + i + '.jpg');
    var f = folder.createFile(blob);
    try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* قد يمنعها الحساب */ }
    return f.getId();
  });
}

function ensureSchemaVersion_() {
  if (String(Db.setting('schema_version')) === String(SCHEMA_VERSION)) return;
  ensureTables_(Db.ss());
  Db.reset();
  var row = Db.find('Settings', function (r) { return r.key === 'schema_version'; });
  if (row) Db.update('Settings', 'schema_version', { value: SCHEMA_VERSION });
  else Db.insert('Settings', { key: 'schema_version', value: SCHEMA_VERSION, note: 'إصدار هيكل الجداول' });
}

// ───────── فريق العمل: رفع الطلب ─────────
function apiReqBoot(code) {
  var h = Orders.hotelByCode(code);
  return {
    hotel: { code: h.code, name: h.name },
    floors: floorsOf_(h.hotel_id),
    elevators: elevatorsOf_(h.hotel_id),
    has: { ac: !!Orders.activeContract(h.hotel_id, 'ac'), el: !!Orders.activeContract(h.hotel_id, 'el') },
    syms: { ac: listsFor_('ac').sym, el: listsFor_('el').sym }
  };
}

function apiReqSubmit(code, d) {
  return Db.withLock(function () {
    var h = Orders.hotelByCode(code);
    if (['ac', 'el'].indexOf(d.type) === -1) throw new Error('اختر نوع المشكلة.');
    if (!String(d.name || '').trim()) throw new Error('اكتب اسمك.');
    if (!d.symptom && !String(d.description || '').trim()) throw new Error('اختر المشكلة أو اكتب وصفها.');
    var photos = savePhotos_(d.photos, 'REQ');
    var r = Orders.create({
      hotel_id: h.hotel_id, type: d.type, kind: 'corrective', source: 'requester',
      floor_id: d.floor_id, room: d.room, equip: d.equip, symptom: d.symptom, trapped: d.trapped === 'yes',
      requester: String(d.name).trim(), description: d.description, photos: photos
    }, String(d.name).trim());
    var con = r.order.con_id ? Db.get('Contractors', r.order.con_id) : null;
    return {
      id: r.order.wo_id,
      con: con ? con.name : '',
      resp: r.contract ? (r.order.trapped ? 0 : Number(r.order.priority === 'urgent' ? r.contract.resp_urgent : r.contract.resp_normal)) : null
    };
  });
}

// ───────── المتعهد ─────────
function apiConLogin(code, pin) {
  return Db.withLock(function () {
    var h = Orders.hotelByCode(code);
    var r = Auth.conLogin(h, pin);
    if (!Orders.activeContract(h.hotel_id, r.con.type, r.con.con_id)) {
      Auth.logout(r.token);
      throw new Error('لا يوجد عقد ساري لك في ' + h.name + '. راجع مهندس الصيانة.');
    }
    Orders.arrive(r.con.con_id, h.hotel_id);
    return { token: r.token, boot: conBoot_(Auth.session(r.token)) };
  });
}

function conBoot_(s) {
  var con = Db.get('Contractors', s.id);
  var R = Orders.refs();
  var since = Date.now() - 60 * 864e5;
  var mine = Db.all('WorkOrders', function (o) { return o.con_id === s.id; });
  var jobs = [], archive = [];
  mine.forEach(function (o) {
    if (Orders.OPEN.indexOf(o.status) !== -1) jobs.push(Orders.view(R, o, true));
    else if ((Orders.ms(o.closed_at) || 0) >= since) archive.push(Orders.view(R, o, true));
  });
  jobs.sort(function (a, b) { return (b.trapped - a.trapped) || (a.created - b.created); });
  archive.sort(function (a, b) { return b.closed - a.closed; });

  // أرقام سريعة من نفس البيانات المقروءة
  var today = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd');
  var month = today.slice(0, 7);
  var doneToday = mine.filter(function (o) { return o.submitted_at && Utilities.formatDate(new Date(o.submitted_at), 'Asia/Riyadh', 'yyyy-MM-dd') === today; }).length;
  var resp = mine.filter(function (o) { return o.arrived_at && o.assigned_at && Utilities.formatDate(new Date(o.assigned_at), 'Asia/Riyadh', 'yyyy-MM') === month; })
    .map(function (o) { return Math.max(0, (Orders.ms(o.arrived_at) - Orders.ms(o.assigned_at)) / 60000); });
  var hotels = {};
  R.contracts.filter(function (c) { return c.con_id === s.id; }).forEach(function (c) {
    Orders.csv(c.hotel_ids).forEach(function (hid) {
      var h = R.hotels[hid];
      if (h) hotels[hid] = { id: hid, name: h.name, resp: Number(c.resp_normal) || null, floors: floorsOf_(hid), elevators: elevatorsOf_(hid) };
    });
  });
  var here = R.hotels[s.hotel_id] || {};
  return {
    me: { id: con.con_id, name: con.name, type: con.type, lang: con.lang || 'ar' },
    hotel: { id: s.hotel_id, name: here.name || '' },
    hotels: Object.keys(hotels).map(function (k) { return hotels[k]; }),
    jobs: jobs, archive: archive.slice(0, 50),
    stats: {
      open: jobs.filter(function (j) { return ['assigned', 'in_progress', 'parts'].indexOf(j.status) !== -1; }).length,
      waiting: jobs.filter(function (j) { return j.status === 'review' || j.status === 'matching'; }).length,
      today: doneToday,
      resp: resp.length ? Math.round(resp.reduce(function (a, b) { return a + b; }, 0) / resp.length) : null,
      respN: resp.length,
      target: (hotels[s.hotel_id] || {}).resp || null
    },
    lists: listsFor_(con.type)
  };
}

function apiConBoot(token) { return conBoot_(Auth.need(token, ['contractor'])); }

/** action: submit | new | rescue */
function apiConAct(token, action, woId, d) {
  var s = Auth.need(token, ['contractor']);
  return Db.withLock(function () {
    d = d || {};
    d.photos = savePhotos_(d.photos, woId || 'NEW');
    var res = { msg: '' };
    if (action === 'submit') res = Orders.conSubmit(s, woId, d);
    else if (action === 'new') res = Orders.conNew(s, d);
    else if (action === 'rescue') Orders.rescue(s, woId);
    else throw new Error('إجراء غير معروف.');
    Db.reset();
    return { result: res, boot: conBoot_(s) };
  });
}

// ───────── الموظفون ─────────
function apiStaffLogin(username, password) {
  return Db.withLock(function () {
    ensureSchemaVersion_();
    var r = Auth.staffLogin(username, password);
    return { token: r.token, must: r.must, role: r.user.role, name: r.user.name };
  });
}

function apiChangePassword(token, pw) { return Auth.changePassword(token, pw); }
function apiLogout(token) { Auth.logout(token); return true; }

function engBoot_(s) {
  if (s.must) throw new Error('غيّر كلمة المرور المؤقتة أولاً.');
  var me = Db.get('Users', s.id);
  var R = Orders.refs();
  var myHotels = s.role === 'admin' || s.role === 'management'
    ? Object.keys(R.hotels)
    : Orders.csv(me.hotel_ids);
  var since = Date.now() - 30 * 864e5;
  var orders = Db.all('WorkOrders', function (o) {
    if (myHotels.indexOf(o.hotel_id) === -1) return false;
    return Orders.OPEN.indexOf(o.status) !== -1 || (Orders.ms(o.closed_at) || 0) >= since;
  }).map(function (o) { return Orders.view(R, o, false); });
  orders.sort(function (a, b) { return (b.trapped - a.trapped) || (b.created - a.created); });
  var today = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd');
  var dayOf = function (t) { return t ? Utilities.formatDate(new Date(t), 'Asia/Riyadh', 'yyyy-MM-dd') : ''; };
  return {
    me: { name: me.name, role: s.role },
    hotels: myHotels.map(function (id) {
      var h = R.hotels[id] || {};
      return { id: id, name: h.name, floors: floorsOf_(id), elevators: elevatorsOf_(id) };
    }),
    orders: orders,
    cons: Object.keys(R.cons).map(function (k) { var c = R.cons[k]; return { id: c.con_id, name: c.name, type: c.type }; }),
    reasons: listsFor_('ac').reject.map(function (x) { return x.ar; }),
    stats: {
      decidedToday: orders.filter(function (o) { return dayOf(o.decided) === today; }).length,
      closedToday: orders.filter(function (o) { return o.status === 'closed' && dayOf(o.closed) === today; }).length
    }
  };
}

function apiEngBoot(token) { return engBoot_(Auth.need(token, ['admin', 'engineer', 'management'])); }

function apiEngAct(token, woId, action, d) {
  var s = Auth.need(token, ['admin', 'engineer']);
  return Db.withLock(function () {
    var to = Orders.engAct(s, woId, action, d);
    Db.reset();
    return { to: to, boot: engBoot_(s) };
  });
}

function apiEngCreate(token, d) {
  var s = Auth.need(token, ['admin', 'engineer']);
  return Db.withLock(function () {
    var id = Orders.engCreate(s, d);
    Db.reset();
    return { id: id, boot: engBoot_(s) };
  });
}

// ───────── مشرف النظام ─────────
function admBoot_() {
  var R = Orders.refs();
  var today = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd');
  return {
    webUrl: webUrl_(),
    hotels: Object.keys(R.hotels).map(function (k) {
      var h = R.hotels[k];
      var layout = hotelLayout_(h.hotel_id);
      var elevs = elevatorCards_(h.hotel_id);
      return {
        id: h.hotel_id, code: h.code, name: h.name, city: h.city || '',
        floors: layout, elevatorCards: elevs, elevators: elevs.map(function (e) { return e.name; }),
        totals: {
          floors: layout.length,
          rooms: layout.reduce(function (a, f) { return a + f.rooms; }, 0),
          facilities: layout.reduce(function (a, f) { return a + f.facilities.length; }, 0),
          ac: layout.reduce(function (a, f) { return a + f.ac + f.facilities.reduce(function (b, x) { return b + x.units.length; }, 0); }, 0)
        }
      };
    }),
    contractors: Object.keys(R.cons).map(function (k) {
      var c = R.cons[k];
      return {
        id: c.con_id, name: c.name, type: c.type, phone: c.phone || '', contact: c.contact || '', hasPin: !!c.pin_hash,
        contracts: R.contracts.filter(function (x) { return x.con_id === c.con_id; }).map(function (x) {
          var s = x.start ? Utilities.formatDate(new Date(x.start), 'Asia/Riyadh', 'yyyy-MM-dd') : '';
          var e = x.end ? Utilities.formatDate(new Date(x.end), 'Asia/Riyadh', 'yyyy-MM-dd') : '';
          var left = e ? Math.round((new Date(e).getTime() - new Date(today).getTime()) / 864e5) : null;
          return {
            id: x.contract_id, hotels: Orders.csv(x.hotel_ids).map(function (id) { return (R.hotels[id] || {}).name || id; }),
            elevators: Orders.csv(x.elevator_ids), start: s, end: e, left: left, alert: Number(x.alert_days) || 60,
            resp_normal: x.resp_normal, resp_urgent: x.resp_urgent, pm: x.pm_per_month
          };
        })
      };
    }),
    users: Db.all('Users').map(function (u) {
      return { id: u.user_id, name: u.name, role: u.role, username: u.username, hotels: Orders.csv(u.hotel_ids), active: String(u.active).toUpperCase() !== 'FALSE' };
    }),
    pending: Db.all('Lists', function (l) { return l.status === 'pending'; }).length
  };
}

function apiAdmBoot(token) { Auth.need(token, ['admin']); return admBoot_(); }

function adm_(token, fn) {
  Auth.need(token, ['admin']);
  return Db.withLock(function () {
    var out = fn() || {};
    Db.reset();
    out.boot = admBoot_();
    return out;
  });
}

function apiAdmSaveHotel(token, d) {
  return adm_(token, function () {
    var code = String(d.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(code)) throw new Error('رمز الفندق بالإنجليزية والأرقام فقط، مثل WARIF.');
    if (!String(d.name || '').trim()) throw new Error('اكتب اسم الفندق.');
    var dup = Db.find('Hotels', function (h) { return String(h.code).toUpperCase() === code && h.hotel_id !== d.id; });
    if (dup) throw new Error('رمز الفندق مستخدم.');
    if (d.id) { Db.update('Hotels', d.id, { code: code, name: d.name.trim(), city: d.city || '' }); return { id: d.id }; }
    var h = Db.insert('Hotels', { code: code, name: d.name.trim(), city: d.city || '', active: true, created_at: new Date() });
    return { id: h.hotel_id };
  });
}

function nextSort_(hotelId) {
  var max = 0;
  Db.all('Floors', function (f) { return f.hotel_id === hotelId; }).forEach(function (f) { max = Math.max(max, Number(f.sort) || 0); });
  return max + 1;
}

function acUnits_(label, n) {
  var out = [];
  for (var k = 0; k < n; k++) out.push(label + '-' + String.fromCharCode(65 + k));
  return out;
}

/**
 * أدوار الغرف دفعة واحدة، ولكل دور نطاقه وعدد وحداته.
 * rows: [{name, from, to, ac}] — الدور الموجود بنفس الاسم تُضاف له الغرف الناقصة فقط.
 */
function apiAdmSaveFloors(token, hotelId, rows) {
  return adm_(token, function () {
    if (!rows || !rows.length) throw new Error('أضف دوراً واحداً على الأقل.');
    var clean = rows.map(function (r, i) {
      var name = String(r.name || '').trim(), from = parseInt(r.from, 10), to = parseInt(r.to, 10);
      var ac = Math.max(0, Math.min(4, parseInt(r.ac, 10) || 0));
      if (!name) throw new Error('السطر ' + (i + 1) + ': اكتب اسم الدور.');
      if (!(from > 0) || !(to >= from) || to - from > 199) throw new Error('السطر ' + (i + 1) + ' (' + name + '): نطاق الغرف غير صحيح.');
      return { name: name, from: from, to: to, ac: ac };
    });
    var seen = {};
    clean.forEach(function (r) { for (var n = r.from; n <= r.to; n++) { if (seen[n]) throw new Error('الغرفة ' + n + ' مكررة في أكثر من دور.'); seen[n] = r.name; } });
    var floorsById = {};
    Db.all('Floors', function (f) { return f.hotel_id === hotelId; }).forEach(function (f) { floorsById[f.floor_id] = f; });
    var existing = {};
    Db.all('Rooms', function (r) { return r.hotel_id === hotelId && !isFacility_(r, floorsById[r.floor_id]); }).forEach(function (r) { existing[String(r.number)] = r.floor_id; });
    var sort = nextSort_(hotelId), recs = [], newFloors = 0;
    clean.forEach(function (r) {
      var floor = Db.find('Floors', function (f) { return f.hotel_id === hotelId && f.name === r.name; });
      if (!floor) { floor = Db.insert('Floors', { hotel_id: hotelId, name: r.name, kind: 'rooms', sort: sort++ }); newFloors++; }
      for (var n = r.from; n <= r.to; n++) {
        if (existing[String(n)]) {
          if (existing[String(n)] !== floor.floor_id) throw new Error('الغرفة ' + n + ' موجودة في دور آخر.');
          continue;
        }
        recs.push({ hotel_id: hotelId, floor_id: floor.floor_id, number: String(n), ac_units: acUnits_('AC-' + n, r.ac).join(','), kind: 'room' });
      }
    });
    Db.insertMany('Rooms', recs);
    return { added: recs.length, floors: newFloors };
  });
}

/** دور خدمي (الاستقبال، الميزانين، المطعم، المواقف…) ومرافقه */
function apiAdmAddServiceFloor(token, hotelId, name, facilities) {
  return adm_(token, function () {
    name = String(name || '').trim();
    if (!name) throw new Error('اكتب اسم الدور.');
    if (Db.find('Floors', function (f) { return f.hotel_id === hotelId && f.name === name; })) throw new Error('يوجد دور بهذا الاسم.');
    var f = Db.insert('Floors', { hotel_id: hotelId, name: name, kind: 'service', sort: nextSort_(hotelId) });
    addFacilities_(hotelId, f.floor_id, facilities || []);
    return { id: f.floor_id };
  });
}

function addFacilities_(hotelId, floorId, list) {
  var names = {};
  Db.all('Rooms', function (r) { return r.floor_id === floorId; }).forEach(function (r) { names[String(r.number)] = true; });
  var recs = [];
  list.forEach(function (x) {
    var n = String(x.name || '').trim(), ac = Math.max(0, Math.min(12, parseInt(x.ac, 10) || 0));
    if (!n) return;
    if (names[n]) throw new Error('المرفق «' + n + '» موجود في هذا الدور.');
    names[n] = true;
    var units = [];
    for (var k = 1; k <= ac; k++) units.push(ac === 1 ? n : n + ' ' + k);
    recs.push({ hotel_id: hotelId, floor_id: floorId, number: n, ac_units: units.join(','), kind: 'facility' });
  });
  Db.insertMany('Rooms', recs);
  return recs.length;
}

/** مرفق في أي دور (غرف أو خدمي): الممر، غرفة الكهرباء، المطعم… */
function apiAdmAddFacility(token, hotelId, floorId, name, ac) {
  return adm_(token, function () {
    if (!String(name || '').trim()) throw new Error('اكتب اسم المرفق.');
    addFacilities_(hotelId, floorId, [{ name: name, ac: ac }]);
    return {};
  });
}

function usedLocation_(floorId, roomName) {
  return !!Db.find('WorkOrders', function (o) { return o.floor_id === floorId && (roomName === undefined || String(o.room) === String(roomName)); });
}

function apiAdmRemoveFacility(token, roomId) {
  return adm_(token, function () {
    var r = Db.get('Rooms', roomId);
    if (!r) throw new Error('المرفق غير موجود.');
    if (usedLocation_(r.floor_id, r.number)) throw new Error('لا يمكن حذفه: عليه طلبات مسجلة.');
    Db.remove('Rooms', roomId);
    return {};
  });
}

function apiAdmRemoveFloor(token, floorId) {
  return adm_(token, function () {
    if (usedLocation_(floorId)) throw new Error('لا يمكن حذف الدور: عليه طلبات مسجلة.');
    Db.all('Rooms', function (r) { return r.floor_id === floorId; }).forEach(function (r) { Db.remove('Rooms', r.room_id); });
    Db.remove('Floors', floorId);
    return {};
  });
}

/** تحريك الدور أعلى أو أسفل في الترتيب (dir: -1 أو 1) */
function apiAdmMoveFloor(token, floorId, dir) {
  return adm_(token, function () {
    var f = Db.get('Floors', floorId);
    var list = Db.all('Floors', function (x) { return x.hotel_id === f.hotel_id; }).sort(sortFloors_);
    list.forEach(function (x, i) { if (Number(x.sort) !== i + 1) Db.update('Floors', x.floor_id, { sort: i + 1 }); });
    var i = list.indexOf(f), j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return {};
    Db.update('Floors', list[j].floor_id, { sort: i + 1 });
    Db.update('Floors', f.floor_id, { sort: j + 1 });
    return {};
  });
}

function apiAdmRenameFloor(token, floorId, name) {
  return adm_(token, function () {
    name = String(name || '').trim();
    var f = Db.get('Floors', floorId);
    if (!name) throw new Error('اكتب اسم الدور.');
    if (Db.find('Floors', function (x) { return x.hotel_id === f.hotel_id && x.name === name && x.floor_id !== floorId; })) throw new Error('يوجد دور بهذا الاسم.');
    Db.update('Floors', floorId, { name: name });
    return {};
  });
}

/** بطاقة المصعد: إضافة أو تعديل */
function apiAdmSaveElevator(token, hotelId, d) {
  return adm_(token, function () {
    var name = String(d.name || '').trim();
    if (!name) throw new Error('اكتب اسم المصعد.');
    if (Db.find('Elevators', function (e) { return e.hotel_id === hotelId && e.name === name && e.elev_id !== d.id && String(e.active).toUpperCase() !== 'FALSE'; })) throw new Error('يوجد مصعد بهذا الاسم.');
    var rec = { name: name };
    ELEV_FIELDS.forEach(function (k) { rec[k] = d[k] === undefined ? '' : String(d[k]).trim(); });
    if (d.id) {
      var old = Db.get('Elevators', d.id);
      if (old.name !== name && Db.find('WorkOrders', function (o) { return o.hotel_id === hotelId && o.equip === old.name; })) throw new Error('لا يمكن تغيير الاسم: عليه طلبات مسجلة. عدّل البيانات الأخرى فقط.');
      Db.update('Elevators', d.id, rec);
    } else {
      rec.hotel_id = hotelId; rec.active = true;
      Db.insert('Elevators', rec);
    }
    return {};
  });
}

/** d: con_id? name type phone contact hotel_ids[] elevator_ids[] start end alert_days resp_normal resp_urgent pm_per_month */
function apiAdmSaveContract(token, d) {
  return adm_(token, function () {
    if (['ac', 'el', 'sf'].indexOf(d.type) === -1) throw new Error('اختر نوع المتعهد.');
    if (!d.hotel_ids || !d.hotel_ids.length) throw new Error('اختر فندقاً واحداً على الأقل.');
    if (!d.start || !d.end || d.end < d.start) throw new Error('حدّد تاريخ البداية والنهاية.');
    var pin = null, conId = d.con_id;
    if (!conId) {
      if (!String(d.name || '').trim()) throw new Error('اكتب اسم المتعهد.');
      var c = Db.insert('Contractors', { name: d.name.trim(), type: d.type, phone: d.phone || '', contact: d.contact || '', failed: 0, lang: 'ar', active: true });
      conId = c.con_id;
      pin = Auth.setPin(conId);
    }
    Db.insert('Contracts', {
      con_id: conId, type: d.type, hotel_ids: d.hotel_ids.join(','), elevator_ids: (d.elevator_ids || []).join(','),
      start: new Date(d.start + 'T00:00:00'), end: new Date(d.end + 'T00:00:00'), alert_days: Number(d.alert_days) || 60,
      resp_normal: Number(d.resp_normal) || 30, resp_urgent: Number(d.resp_urgent) || 15, pm_per_month: Number(d.pm_per_month) || 0,
      prev_contract_id: d.prev_contract_id || '', created_at: new Date()
    });
    return { pin: pin };
  });
}

function apiAdmResetPin(token, conId) {
  return adm_(token, function () { return { pin: Auth.setPin(conId) }; });
}

function apiAdmAddUser(token, d) {
  return adm_(token, function () {
    if (!String(d.name || '').trim()) throw new Error('اكتب الاسم.');
    var r = Auth.createUser(d.name, d.role, d.username, d.email, (d.hotel_ids || []).join(','));
    return { password: r.password };
  });
}

function apiAdmResetUser(token, userId) {
  return adm_(token, function () { return { password: Auth.resetUser(userId) }; });
}

// ───────── من قائمة أعوان في ملف البيانات ─────────
function createAdminPrompt() {
  var ui = SpreadsheetApp.getUi();
  if (Db.find('Users', function (u) { return u.role === 'admin'; })) {
    var again = ui.alert('يوجد مشرف بالفعل. إنشاء مشرف إضافي؟', ui.ButtonSet.YES_NO);
    if (again !== ui.Button.YES) return;
  }
  var name = ui.prompt('اسم المشرف', 'مثال: م. محمد البلوشي', ui.ButtonSet.OK_CANCEL);
  if (name.getSelectedButton() !== ui.Button.OK) return;
  var user = ui.prompt('اسم الدخول (بالإنجليزية)', 'مثال: admin', ui.ButtonSet.OK_CANCEL);
  if (user.getSelectedButton() !== ui.Button.OK) return;
  var r = Auth.createUser(name.getResponseText(), 'admin', user.getResponseText(), Session.getEffectiveUser().getEmail(), '');
  ui.alert('تم إنشاء حساب المشرف',
    'اسم الدخول: ' + r.user.username + '\nكلمة المرور المؤقتة: ' + r.password +
    '\n\nتظهر مرة واحدة فقط. ستُطلب منك كلمة مرور جديدة عند أول دخول.\nرابط النظام: ' + webUrl_(), ui.ButtonSet.OK);
}
