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
  var out = { sym: [], part: [], cause: [], action: [], parts: [], leave: [], reject: [], pest: [], material: [], ftype: [] };
  Db.all('Lists', function (l) { return l.status === 'active' && (l.type === type || l.type === 'all'); })
    .sort(function (a, b) { return Number(a.sort) - Number(b.sort); })
    .forEach(function (l) { if (out[l.list]) out[l.list].push({ ar: l.ar, en: l.en }); });
  return out;
}

/** أزواج [عربي، إنجليزي] للبنود المعتمدة: تترجم بها الواجهة الاختيارات */
function i18nPairs_() {
  var seen = {}, out = [];
  Db.all('Lists', function (l) { return l.status === 'active' && l.en; }).forEach(function (l) {
    if (!seen[l.ar]) { seen[l.ar] = true; out.push([String(l.ar), String(l.en)]); }
  });
  return out;
}

function isFacility_(r, floor) { return r.kind === 'facility' || (!r.kind && !!floor && floor.kind !== 'rooms'); }

function sortFloors_(a, b) { return Number(a.sort) - Number(b.sort); }

function towersOf_(h) { return Orders.csv(h && h.towers).map(function (t) { return t.replace(/\s+/g, ' '); }); }
function towerName_(t) { t = String(t || ''); return /^\d+$/.test(t) ? 'برج ' + t : t; }
function floorLabel_(f) { return (f.tower ? towerName_(f.tower) + ' · ' : '') + f.name; }

/** الأدوار مع مرافقها (للنماذج): {id, name, kind, facilities:[أسماء]} */
function floorsOf_(hotelId) {
  var rooms = Db.all('Rooms', function (r) { return r.hotel_id === hotelId; });
  return Db.all('Floors', function (f) { return f.hotel_id === hotelId; }).sort(sortFloors_).map(function (f) {
    return {
      id: f.floor_id, name: f.name, tower: String(f.tower || ''), label: floorLabel_(f), kind: f.kind === 'rooms' ? 'rooms' : 'service',
      facilities: rooms.filter(function (r) { return r.floor_id === f.floor_id && isFacility_(r, f); }).map(function (r) { return String(r.number); }),
      rooms: rooms.filter(function (r) { return r.floor_id === f.floor_id && !isFacility_(r, f); }).map(function (r) { return String(r.number); })
    };
  });
}

/** رقم غرفة قد يبدأ بحرف: A101 أو B-12 أو 0101 → {pre, num, width} */
function roomParts_(v) {
  var m = String(v == null ? '' : v).trim().replace(/\s+/g, '').toUpperCase().match(/^([A-Z]{0,3}-?)(\d{1,6})$/);
  return m ? { pre: m[1], num: parseInt(m[2], 10), width: m[2].length } : null;
}
function roomName_(p, n) { var d = String(n); while (d.length < p.width) d = '0' + d; return p.pre + d; }

/** تخطيط الفندق الكامل لشاشة المشرف */
function hotelLayout_(hotelId) {
  var rooms = Db.all('Rooms', function (r) { return r.hotel_id === hotelId; });
  return Db.all('Floors', function (f) { return f.hotel_id === hotelId; }).sort(sortFloors_).map(function (f) {
    var rs = rooms.filter(function (r) { return r.floor_id === f.floor_id; });
    var rr = rs.filter(function (r) { return !isFacility_(r, f); });
    var nums = rr.map(function (r) { var p = roomParts_(r.number); return p ? { n: p.num, s: String(r.number) } : null; }).filter(Boolean).sort(function (a, b) { return a.n - b.n; });
    return {
      id: f.floor_id, name: f.name, tower: String(f.tower || ''), kind: f.kind === 'rooms' ? 'rooms' : 'service',
      rooms: rr.length, from: nums.length ? nums[0].s : null, to: nums.length ? nums[nums.length - 1].s : null,
      acPer: rr.length ? Orders.csv(rr[0].ac_units).length : 0,
      ac: rr.reduce(function (a, r) { return a + Orders.csv(r.ac_units).length; }, 0),
      facilities: rs.filter(function (r) { return isFacility_(r, f); }).map(function (r) { return { id: r.room_id, name: String(r.number), units: Orders.csv(r.ac_units) }; })
    };
  });
}

var ELEV_FIELDS = ['tower', 'kind', 'brand', 'capacity_kg', 'persons', 'stops', 'floors_served', 'install_year', 'serial', 'notes'];

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
  // الترقية مرة واحدة تحت القفل، حتى لا يتزامن فتح الصفحات ومشغّل تيليجرام بعد النشر
  Db.withLock(function () {
    Db.reset();
    if (String(Db.setting('schema_version')) === String(SCHEMA_VERSION)) return;
    upgradeSchema_();
  });
}
function upgradeSchema_() {
  ensureTables_(Db.ss());
  Db.reset();
  seedMissingLists_();
  Db.all('Hotels').forEach(function (h) { ensureCorridors_(h.hotel_id); });
  var row = Db.find('Settings', function (r) { return r.key === 'schema_version'; });
  if (row) Db.update('Settings', 'schema_version', { value: SCHEMA_VERSION });
  else Db.insert('Settings', { key: 'schema_version', value: SCHEMA_VERSION, note: 'إصدار هيكل الجداول' });
}

// ───────── فريق العمل: رفع الطلب ─────────
function apiReqBoot(code) {
  ensureSchemaVersion_();
  var h = Orders.hotelByCode(code);
  return {
    hotel: { code: h.code, name: h.name, towers: towersOf_(h), brand: h.brand || 'nawazi' },
    floors: floorsOf_(h.hotel_id),
    elevators: elevatorsOf_(h.hotel_id),
    has: { ac: !!Orders.activeContract(h.hotel_id, 'ac'), el: !!Orders.activeContract(h.hotel_id, 'el'), pc: !!Orders.activeContract(h.hotel_id, 'pc') },
    pests: listsFor_('pc').pest,
    syms: { ac: listsFor_('ac').sym, el: listsFor_('el').sym },
    // الطلبات المفتوحة (موقعها فقط) لتنبيه الرافع إن كان نفس الموقع مرفوعاً
    open: Db.all('WorkOrders', function (o) { return o.hotel_id === h.hotel_id && Orders.OPEN.indexOf(o.status) !== -1; }).map(function (o) {
      return { id: o.wo_id, type: o.type, floor_id: o.floor_id, room: String(o.room || ''), equip: o.equip || '', sym: o.symptom || '' };
    }),
    i18n: i18nPairs_()
  };
}

/** باركود الطلبات: بلاغ مكافحة يظهر مباشرة على خريطة المتعهد والإشراف */
function apiReqPest(code, d) {
  return Db.withLock(function () {
    d = d || {};
    var h = Orders.hotelByCode(code);
    d.photos = savePhotos_(d.photos, 'PF');
    return Ops.reqFlag(h, d);
  });
}
/** مشرف النظام ومدير الفندق والمناوب: «طلب مكافحة» من الخدمات المساندة */
function apiSvcPestFlag(token, d) {
  var s = Auth.need(token, ['admin', 'gm', 'duty']);
  return Db.withLock(function () { d = d || {}; d.kind = 'infest'; d.photos = savePhotos_(d.photos, 'PF'); var n = Ops.flag(s, d); Db.reset(); return { n: n, boot: supBoot_(s) }; });
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
    Kpi.touch([r.order.wo_id]);
    Tg.post(r.order.wo_id);
    return {
      id: r.order.wo_id,
      con: con ? con.name : '',
      resp: r.contract ? (r.order.trapped ? 0 : Number(r.order.priority === 'urgent' ? r.contract.resp_urgent : r.contract.resp_normal)) : null
    };
  });
}

// ───────── المتعهد ─────────
function apiConLogin(code, pin, geo) {
  return Db.withLock(function () {
    ensureSchemaVersion_();
    var h = Orders.hotelByCode(code);
    var r = Auth.conLogin(h, pin);
    if (!Orders.activeContract(h.hotel_id, r.con.type, r.con.con_id)) {
      Auth.logout(r.token);
      throw new Error('لا يوجد عقد ساري لك في ' + h.name + '. راجع مهندس الصيانة.');
    }
    if (Orders.truthy(h.geo_con)) { try { Ops.geoCheck(h, geo); } catch (e) { Auth.logout(r.token); throw e; } }
    var arr = Orders.arrive(r.con.con_id, h.hotel_id);
    Kpi.touch(arr);
    Tg.refresh(arr);
    return { token: r.token, boot: conBoot_(Auth.session(r.token)) };
  });
}

function apiConWebLogin(pin) {
  return Db.withLock(function () {
    ensureSchemaVersion_();
    var r = Auth.conWebLogin(pin);
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
      if (h) {
        var all = elevatorsOf_(hid), inC = Orders.csv(c.elevator_ids).filter(function (e) { return all.indexOf(e) !== -1; });
        hotels[hid] = { id: hid, name: h.name, brand: h.brand || 'nawazi', resp: Number(c.resp_normal) || null, floors: floorsOf_(hid), elevators: all, mine: inC.length ? inC : all, pm: Number(c.pm_per_month) || 0 };
      }
    });
  });
  // «لا ينطبق» من آخر زيارة دورية لكل مصعد، لتُعبّأ تلقائياً
  var pmLast = {};
  mine.filter(function (o) { return o.kind === 'periodic' && o.report; }).sort(function (a, b) { return Orders.ms(a.created_at) - Orders.ms(b.created_at); }).forEach(function (o) {
    var reps = o.report; if (typeof reps === 'string') { try { reps = JSON.parse(reps); } catch (e) { reps = []; } }
    (Array.isArray(reps) ? reps : [reps]).forEach(function (r) { if (r && r.grid) Object.keys(r.grid).forEach(function (u) { pmLast[u] = String(r.grid[u]).replace(/[^n]/g, 'x'); }); });
  });
  // اقتراح الجزء والسبب حسب الملاحظة، من تاريخ نفس نوع الخدمة (الجدول مقروء أصلاً)
  var sg = {};
  Db.all('WorkOrders', function (o) { return o.type === con.type && o.report; }).forEach(function (o) {
    var reps = o.report; if (typeof reps === 'string') { try { reps = JSON.parse(reps); } catch (e) { reps = []; } }
    (Array.isArray(reps) ? reps : [reps]).forEach(function (r) {
      if (!r || !r.sym || ['fix', 'diag'].indexOf(r.outcome) === -1) return;
      var x = sg[r.sym] = sg[r.sym] || { part: {}, cause: {} };
      if (r.part) x.part[r.part] = (x.part[r.part] || 0) + 1;
      (r.cause || []).forEach(function (c) { x.cause[c] = (x.cause[c] || 0) + 1; });
    });
  });
  var top3 = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; }).slice(0, 3); };
  var sugg = {};
  Object.keys(sg).forEach(function (k) { sugg[k] = { part: top3(sg[k].part), cause: top3(sg[k].cause) }; });
  var here = R.hotels[s.hotel_id] || {};
  return {
    pmLast: pmLast,
    sugg: sugg,
    pest: con.type === 'pc' ? Ops.pestBoot(Object.keys(hotels)) : null,
    waste: con.type === 'wa' ? Ops.waVisits(Object.keys(hotels), Date.now() - 35 * 864e5) : null,
    water: con.type === 'wt' ? Water.conList(con.con_id) : null,
    tickets: Tickets.forCon(con.con_id), org: Tickets.pendingOrg(con.con_id), tk: { types: Tickets.TYPES, topics: Tickets.TOPICS },
    evals: Ops.evalList(function (e) { return e.con_id === s.id; }),
    cas: Quality.list(R, function (c) { return c.con_id === s.id; }),
    me: { id: con.con_id, name: con.name, type: con.type, lang: con.lang || 'ar' },
    hotel: { id: s.hotel_id, name: here.name || (s.web ? 'كل الفنادق' : ''), brand: s.web ? '' : (here.brand || 'nawazi') },
    web: !!s.web,
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
    lists: listsFor_(con.type),
    i18n: i18nPairs_()
  };
}

function apiConBoot(token) { var s = Auth.need(token, ['contractor']); ensureSchemaVersion_(); return conBoot_(s); }

/** action: submit | new | rescue */
function apiConAct(token, action, woId, d) {
  var s = Auth.need(token, ['contractor']);
  return Db.withLock(function () {
    d = d || {};
    if (s.web) {
      if (action !== 'submit') throw new Error('هذا الإجراء من الفندق فقط: امسح باركود أعوان.');
      var w = Db.get('WorkOrders', woId);
      if (w && w.con_id === s.id && !w.arrived_at) throw new Error('سجّل وصولك أولاً بمسح باركود أعوان في الفندق، ثم أرسل التقرير.');
    }
    d.photos = savePhotos_(d.photos, woId || 'NEW');
    var res = { msg: '' };
    if (action === 'submit') res = Orders.conSubmit(s, woId, d);
    else if (action === 'new') res = Orders.conNew(s, d);
    else if (action === 'rescue') Orders.rescue(s, woId);
    else throw new Error('إجراء غير معروف.');
    Kpi.touch([woId || res.id]);
    if (woId) Tg.refresh([woId]);
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

/** أدوار المتابعة (اطلاع فقط + ملاحظة): الإدارة لكل الفنادق، ومدير الفندق ومدير التشغيل لفنادقهم */
var STAFF_ROLES = ['admin', 'engineer', 'management', 'gm', 'om', 'duty'];
var VIEW_ROLES = ['management', 'gm', 'om', 'duty'];
function scopeHotels_(s, R) {
  if (s.role === 'admin' || s.role === 'management') return Object.keys(R.hotels);
  return Orders.csv((Db.get('Users', s.id) || {}).hotel_ids);
}

function engBoot_(s) {
  if (s.must) throw new Error('غيّر كلمة المرور المؤقتة أولاً.');
  var me = Db.get('Users', s.id);
  var R = Orders.refs();
  var myHotels = scopeHotels_(s, R);
  var since = Date.now() - 30 * 864e5;
  var orders = Db.all('WorkOrders', function (o) {
    if (myHotels.indexOf(o.hotel_id) === -1) return false;
    return Orders.OPEN.indexOf(o.status) !== -1 || (Orders.ms(o.closed_at) || 0) >= since;
  }).map(function (o) { return Orders.view(R, o, false); });
  orders.sort(function (a, b) { return (b.trapped - a.trapped) || (b.created - a.created); });
  var today = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd');
  var dayOf = function (t) { return t ? Utilities.formatDate(new Date(t), 'Asia/Riyadh', 'yyyy-MM-dd') : ''; };
  return {
    me: { name: me.name, role: s.role, lang: me.lang || 'ar', email: me.email || '' },
    hotels: myHotels.map(function (id) {
      var h = R.hotels[id] || {};
      var cons = {};
      ['ac', 'el'].forEach(function (t) {
        var c = Orders.activeContract(id, t);
        if (c) cons[t] = { name: (R.cons[c.con_id] || {}).name || '', resp: Number(c.resp_normal) || null, urgent: Number(c.resp_urgent) || null, prices: pricesOf_(c) };
      });
      return { id: id, name: h.name, brand: h.brand || 'nawazi', floors: floorsOf_(id), elevators: elevatorsOf_(id), cons: cons };
    }),
    orders: orders,
    cons: Object.keys(R.cons).map(function (k) { var c = R.cons[k]; return { id: c.con_id, name: c.name, type: c.type }; }),
    reasons: listsFor_('ac').reject.map(function (x) { return x.ar; }),
    syms: { ac: listsFor_('ac').sym.map(function (x) { return x.ar; }), el: listsFor_('el').sym.map(function (x) { return x.ar; }) },
    cas: Quality.list(R, function (c) { return myHotels.indexOf(c.hotel_id) !== -1; }),
    notes: notesFor_(s, myHotels, 'maint'),
    water: Water.staffBoot(s, myHotels),
    tickets: Tickets.visibleTo(s, myHotels),
    org: ['admin', 'management', 'gm', 'om', 'duty'].indexOf(s.role) !== -1 ? Tickets.orgResults(myHotels) : null,
    evals: Ops.evalList(function (e) { var hs = Orders.csv(e.hotel_ids); return (VIEW_ROLES.indexOf(s.role) !== -1 || s.role === 'admin' || ['ac', 'el', 'sf'].indexOf(e.type) !== -1) && hs.some(function (h) { return myHotels.indexOf(h) !== -1; }); }),
    stats: {
      decidedToday: orders.filter(function (o) { return dayOf(o.decided) === today; }).length,
      closedToday: orders.filter(function (o) { return o.status === 'closed' && dayOf(o.closed) === today; }).length
    },
    i18n: i18nPairs_()
  };
}

function apiEngBoot(token) { var s = Auth.need(token, STAFF_ROLES); ensureSchemaVersion_(); return engBoot_(s); }

function apiEngAct(token, woId, action, d) {
  var s = Auth.need(token, ['admin', 'engineer']);
  return Db.withLock(function () {
    var to = Orders.engAct(s, woId, action, d);
    Kpi.touch([woId]);
    if (action === 'assign') Tg.post(woId); else Tg.refresh([woId]);
    var mailed = '';
    if (action === 'paid' || action === 'prepay') {
      // إشعار إدارة المتعهد بالبريد (لا يمنع الإجراء إن تعذّر)
      try {
        var o = Db.get('WorkOrders', woId), me = Db.get('Users', s.id) || {};
        var m = Mail.notice(action, o, me, action === 'paid' ? (d || {}).receipt : (d || {}).date);
        if (m) { Mail.send(m, me.email); mailed = m.to; } else mailed = 'none';
      } catch (e) { mailed = 'fail'; }
    }
    Db.reset();
    return { to: to, mailed: mailed, boot: engBoot_(s) };
  });
}

/** مطابقة جماعية: إغلاق عدة عمليات بتقييم واحد */
function apiEngBulkClose(token, ids, sat) {
  var s = Auth.need(token, ['admin', 'engineer']);
  return Db.withLock(function () {
    if (!(ids || []).length) throw new Error('حدّد العمليات.');
    var n = 0;
    ids.forEach(function (id) { Orders.engAct(s, id, 'close', { sat: sat }); n++; });
    Kpi.touch(ids);
    Tg.refresh(ids);
    Db.reset();
    return { n: n, boot: engBoot_(s) };
  });
}

/** طلب عرض سعر بالبريد بهوية نوازي، بعد مراجعة المهندس للتشخيص. preview=true للمعاينة فقط */
function apiEngRfq(token, woId, preview) {
  var s = Auth.need(token, ['admin', 'engineer']);
  var me = Db.get('Users', s.id) || {};
  var o = Db.get('WorkOrders', woId);
  if (!o) throw new Error('العملية غير موجودة.');
  if (o.status !== 'quote') throw new Error('العملية ليست بانتظار عرض سعر.');
  var m = Mail.rfq(o, me);
  if (preview) return { to: m.to, cc: m.cc, subject: m.subject, html: m.html };
  return Db.withLock(function () {
    Mail.send(m, me.email);
    Orders.engAct(s, woId, 'rfq', {});
    Db.reset();
    return { to: m.to, boot: engBoot_(s) };
  });
}

/** فتح عملية برقمها، من النشط أو الأرشيف */
function apiEngFind(token, woId) {
  var s = Auth.need(token, STAFF_ROLES);
  var id = String(woId || '').trim().toUpperCase();
  var o = Db.get('WorkOrders', id) || Db.get('WorkOrdersArchive', id);
  if (!o) throw new Error('لا توجد عملية بهذا الرقم.');
  if (scopeHotels_(s, Orders.refs()).indexOf(o.hotel_id) === -1) throw new Error('العملية ليست ضمن فنادقك.');
  var v = Orders.view(Orders.refs(), o, false);
  v.archived = !Db.get('WorkOrders', id);
  return v;
}

function apiEngCreate(token, d) {
  var s = Auth.need(token, ['admin', 'engineer']);
  return Db.withLock(function () {
    d.photos = savePhotos_(d.photos, 'ENG');
    var id = Orders.engCreate(s, d);
    Kpi.touch([id]);
    Tg.post(id);
    Db.reset();
    return { id: id, boot: engBoot_(s) };
  });
}

// ───────── ملاحظات الإدارة ومدير الفندق ومدير التشغيل ─────────
/** المهندس يرى ملاحظات الصيانة (تكييف، مصاعد، سلامة) لفنادقه؛ والمرسل يرى ما أرسله وهل اطُّلع عليه */
function notesFor_(s, hotels, to) {
  var since = Date.now() - 30 * 864e5, R = Orders.refs();
  return Db.all('Notes', function (n) {
    if (hotels.indexOf(n.hotel_id) === -1) return false;
    var mine = VIEW_ROLES.indexOf(s.role) !== -1 ? n.by_id === s.id : n.to === (to || 'maint');
    return mine && (!n.seen_at || (Orders.ms(n.created_at) || 0) >= since);
  }).map(function (n) {
    return { id: n.note_id, hotel_id: n.hotel_id, hotel: (R.hotels[n.hotel_id] || {}).name || '', service: n.service, to: n.to, wo_id: n.wo_id || '', text: n.text,
      by: n.by_name, role: n.by_role, created: Orders.ms(n.created_at), seen: Orders.ms(n.seen_at), seen_by: n.seen_by || '' };
  }).sort(function (a, b) { return b.created - a.created; });
}

/** d: {wo_id?} أو {hotel_id, service} + text. التكييف والمصاعد والسلامة ← مهندس الصيانة؛ النفايات والآفات ← الإشراف */
function apiNote(token, d) {
  var s = Auth.need(token, VIEW_ROLES);
  return Db.withLock(function () {
    var me = Db.get('Users', s.id), R = Orders.refs(), scope = scopeHotels_(s, R);
    var text = String(d.text || '').trim();
    if (!text) throw new Error('اكتب الملاحظة.');
    var hotelId = d.hotel_id, service = d.service, woId = '';
    if (d.wo_id) { var o = Db.get('WorkOrders', d.wo_id); if (!o) throw new Error('العملية غير موجودة.'); hotelId = o.hotel_id; service = o.type; woId = o.wo_id; }
    if (scope.indexOf(hotelId) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    if (['ac', 'el', 'sf', 'wa', 'pc'].indexOf(service) === -1) throw new Error('اختر الخدمة.');
    Db.insert('Notes', { hotel_id: hotelId, service: service, to: (service === 'wa' || service === 'pc') ? 'sup' : 'maint', wo_id: woId, text: text,
      by_id: s.id, by_name: me ? me.name : '', by_role: s.role, created_at: new Date() });
    Db.reset();
    return { boot: engBoot_(s) };
  });
}

function apiNoteSeen(token, noteId) {
  var s = Auth.need(token, ['admin', 'engineer', 'supmgr']);
  return Db.withLock(function () {
    var n = Db.get('Notes', noteId), me = Db.get('Users', s.id);
    if (!n) throw new Error('الملاحظة غير موجودة.');
    if (s.role === 'supmgr' && (n.to !== 'sup' || Ops.supHotels(s).indexOf(n.hotel_id) === -1)) throw new Error('لا تملك صلاحية هذا الإجراء.');
    if (!n.seen_at) Db.update('Notes', noteId, { seen_at: new Date(), seen_by: me ? me.name : '' });
    Db.reset();
    return { boot: s.role === 'supmgr' ? supBoot_(s) : engBoot_(s) };
  });
}

// ───────── الإجراء التصحيحي ─────────
function apiEngCA(token, d) {
  var s = Auth.need(token, ['admin', 'engineer']);
  return Db.withLock(function () { var c = Quality.create(s, d || {}); Db.reset(); return { id: c.ca_id, boot: engBoot_(s) }; });
}
/** action: close (فعّال) · return (غير فعّال، يُعاد للمتعهد) */
function apiEngCAAct(token, caId, action, note) {
  var s = Auth.need(token, ['admin', 'engineer']);
  return Db.withLock(function () { Quality.verify(s, caId, action, note); Db.reset(); return { boot: engBoot_(s) }; });
}
function apiConCA(token, caId, text, photos) {
  var s = Auth.need(token, ['contractor']);
  return Db.withLock(function () { Quality.respond(s, caId, text, savePhotos_(photos, caId)); Db.reset(); return { boot: conBoot_(s) }; });
}

// ───────── لوحات الأداء (تقرأ من KpiSummary فقط) ─────────
/** للمهندس والإدارة والمشرف: فنادقهم · وللمتعهد: أرقامه فقط */
function apiKpiBoot(token) {
  var s = Auth.need(token, STAFF_ROLES.concat(['contractor']));
  var R = Orders.refs(), rows, hotels;
  if (s.role === 'contractor') {
    // لا معلومات مالية لدى المتعهد: لا أسعار ولا قيم قطع
    rows = Kpi.rows(function (r) { return r.con_id === s.id; }, 6).map(function (r) { if (r.d) { delete r.d.spend; delete r.d.spendN; delete r.d.acts; } return r; });
  } else {
    hotels = scopeHotels_(s, R);
    rows = Kpi.rows(function (r) { return hotels.indexOf(r.hotel_id) !== -1; }, 6);
  }
  var cons = {}, hs = {};
  rows.forEach(function (r) {
    var c = R.cons[r.con]; if (c) cons[r.con] = { id: c.con_id, name: c.name, type: c.type };
    var h = R.hotels[r.hotel]; if (h) hs[r.hotel] = { id: h.hotel_id, name: h.name, brand: h.brand || 'nawazi' };
  });
  return {
    rows: rows, thresholds: Kpi.thresholds(),
    cons: Object.keys(cons).map(function (k) { return cons[k]; }),
    hotels: Object.keys(hs).map(function (k) { return hs[k]; }),
    month: Kpi.month(new Date()), window: Number(Db.setting('repeat_window_days')) || 30,
    prices: s.role === 'contractor' ? {} : (function () { var p = {}; R.contracts.slice().sort(function (a, b) { return Orders.ms(a.created_at) - Orders.ms(b.created_at); }).forEach(function (c) { var m = pricesOf_(c); Object.keys(m).forEach(function (k) { p[c.con_id + '|' + k] = Number(m[k]); }); }); return p; })(),
    pmTarget: (function () { var t = {}; R.contracts.forEach(function (c) { if (Number(c.pm_per_month) > 0) Orders.csv(c.hotel_ids).forEach(function (h) { t[c.con_id + '|' + h] = Number(c.pm_per_month); }); }); return t; })()
  };
}

/** كشف الخدمات المنفذة للطباعة: خدمات العمليات المغلقة بعد المطابقة لمتعهد خلال فترة يختارها المستخدم */
function apiStatement(token, conId, hotelId, from, to) {
  // الفترة بتاريخ الإغلاق (المطابقة): من–إلى شاملة؛ أو شهر كامل إن جاء «YYYY-MM» وحده
  if (/^\d{4}-\d{2}$/.test(String(from)) && !to) {
    var y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)), last = new Date(y, m, 0).getDate();
    to = from + '-' + (last < 10 ? '0' : '') + last; from = from + '-01';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to)) || to < from) throw new Error('حدّد الفترة: من تاريخ إلى تاريخ.');
  var dayOf = function (t) { return t ? Utilities.formatDate(new Date(t), 'Asia/Riyadh', 'yyyy-MM-dd') : ''; };
  var s = Auth.need(token, STAFF_ROLES);
  var R = Orders.refs();
  var scope = scopeHotels_(s, R);
  if (hotelId && hotelId !== 'all') scope = scope.filter(function (h) { return h === hotelId; });
  var con = R.cons[conId];
  if (!con) throw new Error('المتعهد غير موجود.');
  var en = {};
  Db.all('Lists', function (l) { return l.list === 'action'; }).forEach(function (l) { en[l.ar] = l.en || ''; });
  // السعر من عقد المتعهد لذلك الفندق (يُكتب في صفحة التعاقد)
  var cprice = function (o) {
    var best = null;
    R.contracts.forEach(function (c) {
      if (c.con_id !== o.con_id || c.type !== o.type || Orders.csv(c.hotel_ids).indexOf(o.hotel_id) === -1) return;
      var t = Orders.ms(o.created_at), st = Orders.ms(c.start) || 0, en2 = (Orders.ms(c.end) || 9e15) + 864e5;
      var fits = t >= st && t <= en2;
      if (!best || (fits && !best.fits) || (fits === best.fits && Orders.ms(c.created_at) > Orders.ms(best.c.created_at))) best = { c: c, fits: fits };
    });
    return best ? pricesOf_(best.c) : {};
  };
  var lines = {}, orders = [];
  var inSt = function (o) { var d = dayOf(o.closed_at); return o.con_id === conId && o.status === 'closed' && o.kind !== 'periodic' && scope.indexOf(o.hotel_id) !== -1 && d >= from && d <= to; };
  var archFrom = dayOf(new Date(Date.now() - ARCHIVE_DAYS * 864e5));
  Db.all('WorkOrders', inSt).concat(from < archFrom ? Db.all('WorkOrdersArchive', inSt) : [])
    .sort(function (a, b) { return Orders.ms(a.closed_at) - Orders.ms(b.closed_at); })
    .forEach(function (o) {
      var reps = o.report; if (typeof reps === 'string') { try { reps = JSON.parse(reps); } catch (e) { reps = []; } }
      var acts = null; (Array.isArray(reps) ? reps : [reps]).forEach(function (r) { if (r && r.action && r.action.length) acts = r.action; });
      if (!acts) return;
      var amount = 0, price = cprice(o);
      acts.forEach(function (a) {
        var pr = price[a] == null ? null : Number(price[a]), key = a + '|' + (pr == null ? '' : pr);
        var L = lines[key] || (lines[key] = { svc: a, en: en[a] || '', qty: 0, price: pr });
        L.qty++; if (pr != null) amount += pr;
      });
      var v = Orders.view(R, o, false);
      orders.push({ id: o.wo_id, hotel: v.hotel, loc: v.loc, closed: v.closed, acts: acts, amount: amount });
    });
  var list = Object.keys(lines).map(function (k) { var L = lines[k]; L.total = L.price == null ? null : Math.round(L.price * L.qty * 100) / 100; return L; })
    .sort(function (a, b) { return b.qty - a.qty; });
  return {
    con: { name: con.name, type: con.type, emails: Orders.csv(con.emails) }, from: from, to: to,
    hotels: scope.map(function (h) { return (R.hotels[h] || {}).name || h; }),
    lines: list, orders: orders,
    total: Math.round(list.reduce(function (a, L) { return a + (L.total || 0); }, 0) * 100) / 100,
    missing: list.filter(function (L) { return L.price == null; }).length
  };
}

/** لغة الواجهة لكل مستخدم: ar · en */
function apiSetLang(token, lang) {
  var s = Auth.need(token, STAFF_ROLES.concat(['contractor']));
  lang = lang === 'en' ? 'en' : 'ar';
  return Db.withLock(function () {
    if (s.role === 'contractor') Db.update('Contractors', s.id, { lang: lang });
    else Db.update('Users', s.id, { lang: lang });
    return lang;
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
        id: h.hotel_id, code: h.code, name: h.name, city: h.city || '', towers: towersOf_(h), brand: h.brand || 'nawazi',
        lat: h.lat === '' || h.lat == null ? '' : Number(h.lat), lng: h.lng === '' || h.lng == null ? '' : Number(h.lng),
        geo_radius: Number(h.geo_radius) || '', geo_con: Orders.truthy(h.geo_con), wa_carts: Number(h.wa_carts) || '',
        tg: !!h.tg_chat, tg_code: h.tg_code || '', wt: !!Orders.activeContract(h.hotel_id, 'wt'),
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
        id: c.con_id, name: c.name, type: c.type, phone: String(c.phone || ''), contact: c.contact || '', emails: Orders.csv(c.emails), hasPin: !!c.pin_hash,
        contracts: R.contracts.filter(function (x) { return x.con_id === c.con_id; }).map(function (x) {
          var s = x.start ? Utilities.formatDate(new Date(x.start), 'Asia/Riyadh', 'yyyy-MM-dd') : '';
          var e = x.end ? Utilities.formatDate(new Date(x.end), 'Asia/Riyadh', 'yyyy-MM-dd') : '';
          var left = e ? Math.round((new Date(e).getTime() - new Date(today).getTime()) / 864e5) : null;
          return {
            id: x.contract_id, hotels: Orders.csv(x.hotel_ids).map(function (id) { return (R.hotels[id] || {}).name || id; }),
            elevators: Orders.csv(x.elevator_ids), start: s, end: e, left: left, alert: Number(x.alert_days) || 60,
            resp_normal: x.resp_normal, resp_urgent: x.resp_urgent, pm: x.pm_per_month, type: x.type, prices: pricesOf_(x), wa_per_week: Number(x.wa_per_week) || 0
          };
        })
      };
    }),
    users: Db.all('Users').map(function (u) {
      return { id: u.user_id, name: u.name, role: u.role, username: u.username, email: u.email || '', hotels: Orders.csv(u.hotel_ids), active: String(u.active).toUpperCase() !== 'FALSE',
        pinSet: Auth.isSup(u.role) ? (!!u.secret_hash && !Orders.truthy(u.must_change)) : null };
    }),
    pending: Db.all('Lists', function (l) { return l.status === 'pending'; }).length,
    lists: Db.all('Lists', function (l) { return l.status === 'active' || l.status === 'pending'; })
      .sort(function (a, b) { return Number(a.sort) - Number(b.sort); })
      .map(function (l) { return { id: l.item_id, type: l.type, list: l.list, ar: String(l.ar), en: String(l.en || ''), price: l.price === '' || l.price == null ? '' : Number(l.price), status: l.status, by: l.created_by || '' }; }),
    thresholds: Kpi.thresholds(),
    tgBot: Tg.bot(),
    mailFrom: String(Db.setting('mail_from') || '')
  };
}

function apiAdmBoot(token) { Auth.need(token, ['admin']); return admBoot_(); }

function adm_(token, fn) {
  Auth.need(token, ['admin']);
  ensureSchemaVersion_();
  try { ensureTriggers_(); } catch (e) { /* يُنشأ عند تشغيل authorizeAwan */ }
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
    var towers = String(d.towers || '').split(/[,،\n]+/).map(function (t) { return t.trim(); }).filter(String);
    if (d.id && d.towers === undefined) towers = towersOf_(Db.get('Hotels', d.id));
    if (d.id) {
      var used = {};
      Db.all('Floors', function (f) { return f.hotel_id === d.id && f.tower; }).forEach(function (f) { used[f.tower] = true; });
      Object.keys(used).forEach(function (t) { if (towers.indexOf(t) === -1) throw new Error('البرج «' + t + '» عليه أدوار، لا يمكن حذفه أو تغيير اسمه.'); });
      var up = { code: code, name: d.name.trim(), city: d.city || '', towers: towers.join(',') };
      if (d.brand !== undefined) up.brand = d.brand === 'warf' ? 'warf' : 'nawazi';
      Db.update('Hotels', d.id, up);
      return { id: d.id };
    }
    var h = Db.insert('Hotels', { code: code, name: d.name.trim(), city: d.city || '', towers: towers.join(','), brand: d.brand === 'warf' ? 'warf' : 'nawazi', active: true, created_at: new Date() });
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
    var hotel = Db.get('Hotels', hotelId), towers = towersOf_(hotel);
    var clean = rows.map(function (r, i) {
      var name = String(r.name || '').trim(), a = roomParts_(r.from), b = roomParts_(r.to);
      var ac = Math.max(0, Math.min(4, parseInt(r.ac, 10) || 0)), tower = String(r.tower || '').trim();
      if (!name) throw new Error('السطر ' + (i + 1) + ': اكتب اسم الدور.');
      if (tower && towers.indexOf(tower) === -1) towers.push(tower);
      if (!a || !b || a.pre !== b.pre || !(b.num >= a.num) || b.num - a.num > 199) throw new Error('السطر ' + (i + 1) + ' (' + name + '): نطاق الغرف غير صحيح. اكتب مثل 101 إلى 120، أو A101 إلى A120.');
      var nums = [];
      for (var n = a.num; n <= b.num; n++) nums.push(roomName_(a, n));
      return { name: name, tower: tower, nums: nums, ac: ac };
    });
    if (towers.join(',') !== towersOf_(hotel).join(',')) Db.update('Hotels', hotelId, { towers: towers.join(',') });
    var seen = {};
    clean.forEach(function (r) { r.nums.forEach(function (n) { if (seen[n]) throw new Error('الغرفة ' + n + ' مكررة في أكثر من سطر.'); seen[n] = r.name; }); });
    var floorsById = {};
    Db.all('Floors', function (f) { return f.hotel_id === hotelId; }).forEach(function (f) { floorsById[f.floor_id] = f; });
    var existing = {};
    Db.all('Rooms', function (r) { return r.hotel_id === hotelId && !isFacility_(r, floorsById[r.floor_id]); }).forEach(function (r) { existing[String(r.number).toUpperCase()] = r.floor_id; });
    var sort = nextSort_(hotelId), recs = [], newFloors = 0;
    clean.forEach(function (r) {
      var floor = Db.find('Floors', function (f) { return f.hotel_id === hotelId && f.name === r.name && String(f.tower || '') === r.tower; });
      if (!floor) { floor = Db.insert('Floors', { hotel_id: hotelId, name: r.name, tower: r.tower, kind: 'rooms', sort: sort++ }); newFloors++; }
      r.nums.forEach(function (n) {
        if (existing[n]) {
          if (existing[n] !== floor.floor_id) throw new Error('الغرفة ' + n + ' موجودة في دور آخر أو برج آخر.');
          return;
        }
        recs.push({ hotel_id: hotelId, floor_id: floor.floor_id, number: n, ac_units: acUnits_('AC-' + n, r.ac).join(','), kind: 'room' });
      });
    });
    Db.insertMany('Rooms', recs);
    ensureCorridors_(hotelId);
    return { added: recs.length, floors: newFloors };
  });
}

/** لكل دور غرف ممر تلقائي («ممر الدور 11») بنوع «الممرات»، ليظهر في خريطة المكافحة وطلبات التكييف */
function ensureCorridors_(hotelId) {
  var floors = Db.all('Floors', function (f) { return f.hotel_id === hotelId && f.kind === 'rooms'; });
  if (!floors.length) return 0;
  var has = {};
  Db.all('Rooms', function (r) { return r.hotel_id === hotelId && r.kind === 'facility' && /^ممر/.test(String(r.number)); }).forEach(function (r) { has[r.floor_id] = true; });
  var recs = floors.filter(function (f) { return !has[f.floor_id]; }).map(function (f) {
    return { hotel_id: hotelId, floor_id: f.floor_id, number: 'ممر ' + f.name, ac_units: '', kind: 'facility', ftype: 'الممرات' };
  });
  if (recs.length) Db.insertMany('Rooms', recs);
  return recs.length;
}

/** دور خدمي (الاستقبال، الميزانين، المطعم، المواقف…) ومرافقه */
function apiAdmAddServiceFloor(token, hotelId, name, facilities, tower) {
  return adm_(token, function () {
    name = String(name || '').trim(); tower = String(tower || '').trim();
    if (!name) throw new Error('اكتب اسم الدور.');
    if (Db.find('Floors', function (f) { return f.hotel_id === hotelId && f.name === name && String(f.tower || '') === tower; })) throw new Error('يوجد دور بهذا الاسم' + (tower ? ' في ' + tower : '') + '.');
    var f = Db.insert('Floors', { hotel_id: hotelId, name: name, tower: tower, kind: 'service', sort: nextSort_(hotelId) });
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
    if (Db.find('Floors', function (x) { return x.hotel_id === f.hotel_id && x.name === name && String(x.tower || '') === String(f.tower || '') && x.floor_id !== floorId; })) throw new Error('يوجد دور بهذا الاسم.');
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
/** أسعار خدمات العقد: {الخدمة: ريال}، والخانة الفارغة تُترك */
function cleanPrices_(obj) {
  var out = {};
  Object.keys(obj || {}).forEach(function (k) { var v = price_(obj[k]); if (v !== '') out[String(k).trim()] = v; });
  return out;
}
function pricesOf_(contract) {
  var p = contract && contract.prices;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = {}; } }
  return p || {};
}

/** أسعار عقد قائم (عقد التكييف) */
function apiAdmSaveContractPrices(token, contractId, prices) {
  return adm_(token, function () {
    var c = Db.get('Contracts', contractId);
    if (!c) throw new Error('العقد غير موجود.');
    if (c.type === 'wt') { prices = wtPrices_(prices); if (!Object.keys(prices).length) throw new Error('اكتب حجم نقلة واحد على الأقل بسعره.'); }
    Db.update('Contracts', contractId, { prices: cleanPrices_(prices) });
    return {};
  });
}

/** عدة عناوين بريد مفصولة بفاصلة أو سطر أو مسافة */
function emails_(v) {
  var list = String(v || '').split(/[\s,،;]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(String);
  list.forEach(function (e) { if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) throw new Error('البريد غير صحيح: ' + e); });
  return list.filter(function (e, i) { return list.indexOf(e) === i; });
}

/** بيانات تواصل المتعهد: الجوال وجهة الاتصال والبريد */
function apiAdmSaveConInfo(token, conId, d) {
  return adm_(token, function () {
    if (!Db.get('Contractors', conId)) throw new Error('المتعهد غير موجود.');
    Db.update('Contractors', conId, { phone: String(d.phone || '').trim(), contact: String(d.contact || '').trim(), emails: emails_(d.emails).join(',') });
    return {};
  });
}

function apiAdmSaveContract(token, d) {
  return adm_(token, function () {
    if (['ac', 'el', 'sf', 'wa', 'pc', 'wt'].indexOf(d.type) === -1) throw new Error('اختر نوع المتعهد.');
    if (d.type === 'wt' && !Object.keys(wtPrices_(d.prices)).length) throw new Error('اكتب حجم نقلة واحد على الأقل بسعره.');
    if (d.type === 'wt') d.prices = wtPrices_(d.prices);
    if (d.type === 'wa' && !(Number(d.wa_per_week) > 0)) throw new Error('اكتب عدد مرات الرفع في الأسبوع.');
    if (!d.hotel_ids || !d.hotel_ids.length) throw new Error('اختر فندقاً واحداً على الأقل.');
    if (!d.start || !d.end || d.end < d.start) throw new Error('حدّد تاريخ البداية والنهاية.');
    var pin = null, conId = d.con_id;
    if (!conId) {
      if (!String(d.name || '').trim()) throw new Error('اكتب اسم المتعهد.');
      var c = Db.insert('Contractors', { name: d.name.trim(), type: d.type, phone: d.phone || '', contact: d.contact || '', emails: emails_(d.emails).join(','), failed: 0, lang: 'ar', active: true });
      conId = c.con_id;
      pin = Auth.setPin(conId);
    }
    Db.insert('Contracts', {
      con_id: conId, type: d.type, hotel_ids: d.hotel_ids.join(','), elevator_ids: (d.elevator_ids || []).join(','),
      start: new Date(d.start + 'T00:00:00'), end: new Date(d.end + 'T00:00:00'), alert_days: Number(d.alert_days) || 60,
      resp_normal: Number(d.resp_normal) || 30, resp_urgent: Number(d.resp_urgent) || 15, pm_per_month: Number(d.pm_per_month) || 0,
      prev_contract_id: d.prev_contract_id || '', created_at: new Date(), prices: cleanPrices_(d.prices), wa_per_week: Number(d.wa_per_week) || ''
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
    var r = Auth.createUser(d.name, d.role, d.username, emails_(d.email)[0] || '', (d.hotel_ids || []).join(','));
    return { password: r.password };
  });
}

function apiAdmSaveUserEmail(token, userId, email) {
  return adm_(token, function () {
    if (!Db.get('Users', userId)) throw new Error('المستخدم غير موجود.');
    var e = emails_(email);
    if (e.length > 1) throw new Error('بريد واحد للمستخدم.');
    Db.update('Users', userId, { email: e[0] || '' });
    return {};
  });
}

function apiAdmResetUser(token, userId) {
  return adm_(token, function () { return { password: Auth.resetUser(userId) }; });
}

/** إعدادات الفندق للإشراف: الموقع ونطاقه، وتحقق وصول المتعهد، وسعة منطقة النفايات */
function apiAdmSaveHotelOps(token, hotelId, d) {
  return adm_(token, function () {
    if (!Db.get('Hotels', hotelId)) throw new Error('الفندق غير موجود.');
    var g = Ops.parseGeo(d.geo), r = String(d.geo_radius || '').trim(), c = String(d.wa_carts || '').trim();
    if (r !== '' && !(Number(r) >= 30 && Number(r) <= 2000)) throw new Error('نطاق الموقع بين 30 و2000 متر.');
    if (c !== '' && !(Number(c) >= 0 && Number(c) <= 500)) throw new Error('سعة منطقة النفايات عدد عربات صحيح.');
    Db.update('Hotels', hotelId, { lat: g.lat, lng: g.lng, geo_radius: r === '' ? '' : Number(r), geo_con: !!d.geo_con && g.lat !== '', wa_carts: c === '' ? '' : Number(c) });
    return {};
  });
}

/** تيليجرام: مفتاح البوت (يُحفظ في خصائص السكربت) ورمز ربط مجموعة الفندق */
function apiAdmTgSetup(token, botToken) { return adm_(token, function () { return { bot: Tg.setup(botToken) }; }); }
function apiAdmTgCode(token, hotelId) {
  return adm_(token, function () {
    if (!Tg.on()) throw new Error('اربط البوت أولاً بمفتاحه.');
    if (!Db.get('Hotels', hotelId)) throw new Error('الفندق غير موجود.');
    return { code: Tg.newCode(hotelId) };
  });
}
function apiAdmMailFrom(token, addr) { return adm_(token, function () { return { from: Mail.setFrom(addr) }; }); }
function apiAdmTgUnlink(token, hotelId) { return adm_(token, function () { Db.update('Hotels', hotelId, { tg_chat: '', tg_code: '' }); return {}; }); }

// ───────── اعتماد البنود ─────────
var LIST_KEYS = ['sym', 'part', 'cause', 'action', 'parts', 'leave', 'reject', 'pest', 'material', 'ftype'];

/** action: approve {ar, en} · merge {into} · reject */
function apiAdmListAct(token, id, action, d) {
  return adm_(token, function () {
    d = d || {};
    var l = Db.get('Lists', id);
    if (!l || l.status !== 'pending') throw new Error('البند غير موجود أو اعتُمد من قبل.');
    if (action === 'approve') {
      var ar = String(d.ar || '').trim(), en = String(d.en || '').trim();
      if (!ar) throw new Error('اكتب صياغة البند بالعربية.');
      if (!en) throw new Error('اكتب الترجمة الإنجليزية.');
      if (Db.find('Lists', function (x) { return x.item_id !== id && x.status === 'active' && x.list === l.list && (x.type === l.type || x.type === 'all') && x.ar === ar; })) throw new Error('يوجد بند معتمد بنفس الصياغة: ادمجه فيه بدلاً من ذلك.');
      var max = 0;
      Db.all('Lists', function (x) { return x.list === l.list && x.status === 'active'; }).forEach(function (x) { max = Math.max(max, Number(x.sort) || 0); });
      Db.update('Lists', id, { ar: ar, en: en, status: 'active', orig: ar !== String(l.ar) ? l.ar : '', sort: max + 1 });
    } else if (action === 'merge') {
      var into = Db.get('Lists', d.into);
      if (!into || into.status !== 'active' || into.list !== l.list) throw new Error('اختر البند الذي تدمجه فيه من نفس القائمة.');
      Db.update('Lists', id, { status: 'merged', merged_into: into.item_id });
    } else if (action === 'reject') {
      Db.update('Lists', id, { status: 'rejected' });
    } else throw new Error('إجراء غير معروف.');
    Kpi.rebuild();
    return {};
  });
}

function price_(v) {
  if (v === '' || v == null) return '';
  var t = String(v).trim(), n = Number(t);
  if (!/^\d+(\.\d+)?$/.test(t) || isNaN(n)) throw new Error('السعر رقم بالريال.');
  return n;
}

/** بند معتمد: إضافة أو تعديل الصياغة والترجمة. d: {id?, type, list, ar, en} */
function apiAdmListSave(token, d) {
  return adm_(token, function () {
    var ar = String(d.ar || '').trim(), en = String(d.en || '').trim();
    if (!ar) throw new Error('اكتب البند بالعربية.');
    if (d.id) {
      var l = Db.get('Lists', d.id);
      if (!l) throw new Error('البند غير موجود.');
      var patch = { ar: ar, en: en, orig: ar !== String(l.ar) ? (l.orig || l.ar) : (l.orig || '') };
      if (d.price !== undefined) patch.price = price_(d.price);
      Db.update('Lists', d.id, patch);
      return {};
    }
    if (['ac', 'el', 'pc', 'all'].indexOf(d.type) === -1 || LIST_KEYS.indexOf(d.list) === -1) throw new Error('اختر القائمة.');
    var max = 0;
    Db.all('Lists', function (x) { return x.list === d.list; }).forEach(function (x) { max = Math.max(max, Number(x.sort) || 0); });
    Db.insert('Lists', { type: d.type, list: d.list, ar: ar, en: en, price: price_(d.price), status: 'active', created_by: 'admin', sort: max + 1 });
    return {};
  });
}

// ───────── العتبات ─────────
/** rows: {resp:{full,half,weight}, ready:{…}, info:{…}, sat:{…}} لنوع متعهد واحد */
function apiAdmSaveThresholds(token, type, rows) {
  return adm_(token, function () {
    var KPIS = { ac: ['resp', 'ready', 'info', 'sat'], el: ['resp', 'ready', 'info', 'sat'], sf: ['resp', 'ready', 'info', 'sat'], wa: ['pickup', 'clean', 'wash'], pc: ['ontime', 'flagresp', 'traps'] };
    if (!KPIS[type]) throw new Error('اختر نوع المتعهد.');
    var kpis = KPIS[type], sum = 0;
    kpis.forEach(function (k) {
      var r = rows[k] || {}, full = Number(r.full), half = Number(r.half), w = Number(r.weight);
      if (!(full >= 0) || !(half >= 0) || !(w >= 0) || isNaN(full) || isNaN(half) || isNaN(w)) throw new Error('اكتب أرقاماً صحيحة في كل الخانات.');
      if ((k === 'resp' || k === 'flagresp') && half < full) throw new Error('الاستجابة: حد نصف النقاط يكون أكبر من حد كامل النقاط (الأقل أفضل).');
      if (k !== 'resp' && k !== 'flagresp' && (half > full || full > 100)) throw new Error('النسب: حد كامل النقاط أكبر من حد النصف، ولا يتجاوز 100.');
      sum += w;
    });
    if (Math.round(sum) !== 100) throw new Error('مجموع الأوزان ' + sum + '، والمطلوب 100.');
    kpis.forEach(function (k) {
      var r = rows[k], patch = { full: Number(r.full), half: Number(r.half), weight: Number(r.weight) };
      if (!Db.updateWhere('Thresholds', function (t) { return t.type === type && t.kpi === k; }, patch)) {
        patch.type = type; patch.kpi = k; Db.insert('Thresholds', patch);
      }
    });
    return {};
  });
}

function apiAdmKpiRebuild(token) {
  return adm_(token, function () { return { n: Kpi.rebuild() }; });
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

// ───────── الإشراف: مدير الإشراف والمشرف الميداني ─────────
var SUP_ROLES_ = ['supmgr', 'sup'];

function supBoot_(s) {
  var me = Db.get('Users', s.id) || {};
  var hs = Ops.supHotels(s), R = Orders.refs();
  var conOf = function (h, t) { var c = Orders.activeContract(h, t); return c ? { id: c.con_id, name: (R.cons[c.con_id] || {}).name || '', perWeek: Number(c.wa_per_week) || 0, start: Orders.ms(c.start) || 0 } : null; };
  var L = listsFor_('pc');
  var cons = [];
  Object.keys(R.cons).forEach(function (k) {
    var c = R.cons[k];
    if (c.type !== 'wa' && c.type !== 'pc') return;
    var on = R.contracts.some(function (x) { return x.con_id === c.con_id && Orders.csv(x.hotel_ids).some(function (h) { return hs.indexOf(h) !== -1; }); });
    if (on) cons.push({ id: c.con_id, name: c.name, type: c.type });
  });
  return {
    me: { name: me.name, role: s.role, lang: me.lang || 'ar' },
    hotels: hs.map(function (id) {
      var h = R.hotels[id] || {};
      return { id: id, name: h.name, code: h.code, brand: h.brand || 'nawazi', carts: Number(h.wa_carts) || 0, geo: Ops.hasGeo(h), wa: conOf(id, 'wa'), pc: conOf(id, 'pc'),
        floors: Db.all('Floors', function (f) { return f.hotel_id === id; }).sort(sortFloors_).map(function (f) { return { id: f.floor_id, label: floorLabel_(f) }; }) };
    }),
    pest: Ops.pestBoot(hs),
    waste: Ops.waVisits(hs, Date.now() - 35 * 864e5),
    notes: s.role === 'supmgr' ? notesFor_(s, hs, 'sup') : [],
    canReject: ['supmgr', 'admin'].indexOf(s.role) !== -1,
    tickets: s.role === 'supmgr' ? Tickets.visibleTo(s, hs) : [],
    canFlag: ['admin', 'gm', 'duty'].indexOf(s.role) !== -1,
    cons: cons,
    evals: Ops.evalList(function (e) { return (e.type === 'wa' || e.type === 'pc') && Orders.csv(e.hotel_ids).some(function (h) { return hs.indexOf(h) !== -1; }); }),
    lists: { pest: L.pest, material: L.material, ftype: L.ftype },
    webUrl: webUrl_(),
    i18n: i18nPairs_()
  };
}

function apiSupBoot(token) { var s = Auth.need(token, SUP_ROLES_); ensureSchemaVersion_(); return supBoot_(s); }
/** «الخدمات المساندة» للفريق: النفايات والمكافحة اطلاعاً (ورفض الزيارات لمشرف النظام) — تُقرأ عند فتح التبويب فقط */
var SVC_ROLES_ = ['admin', 'gm', 'om', 'duty', 'management'];
function apiSvcBoot(token) { var s = Auth.need(token, SVC_ROLES_); return supBoot_(s); }
function apiWaReject(token, id, reason) {
  var s = Auth.need(token, ['supmgr', 'admin']);
  return Db.withLock(function () { Ops.waReject(s, id, reason); Db.reset(); return { boot: supBoot_(s) }; });
}

/** صفحة الويب: الرقم السري لمتعهد أو مشرف */
function apiPinWebLogin(pin) {
  return Db.withLock(function () {
    ensureSchemaVersion_();
    var r = Auth.pinWebLogin(pin);
    if (r.kind === 'sup') return { kind: 'sup', token: r.token, boot: supBoot_(Auth.session(r.token)) };
    return { kind: 'con', token: r.token, boot: conBoot_(Auth.session(r.token)) };
  });
}

/** أول دخول للمشرف: اسم الدخول + رقم يختاره (يُرفض المحجوز) */
function apiSupSetPin(username, pin) {
  return Db.withLock(function () {
    ensureSchemaVersion_();
    var r = Auth.supSetPin(username, pin);
    return { token: r.token, boot: supBoot_(Auth.session(r.token)) };
  });
}

function sup_(token, roles, fn) {
  var s = Auth.need(token, roles || SUP_ROLES_);
  return Db.withLock(function () { var out = fn(s) || {}; Db.reset(); out.boot = supBoot_(s); return out; });
}

function apiPestFlag(token, d) {
  return sup_(token, null, function (s) { d = d || {}; d.photos = savePhotos_(d.photos, 'PF'); return { n: Ops.flag(s, d) }; });
}
function apiPestFlagCancel(token, flagId) { return sup_(token, null, function (s) { Ops.cancelFlag(s, flagId); }); }
function apiPestSchedule(token, hotelId, rows) { return sup_(token, ['supmgr'], function (s) { Ops.saveSchedule(s, hotelId, rows); }); }
function apiPestZoneType(token, hotelId, zoneIds, ftype) { return sup_(token, ['supmgr'], function (s) { Ops.setZoneType(s, hotelId, zoneIds, ftype); }); }
function apiSupAddZone(token, hotelId, floorId, name, ftype) {
  return sup_(token, ['supmgr'], function (s) {
    if (Ops.supHotels(s).indexOf(hotelId) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    var f = Db.get('Floors', floorId);
    if (!f || f.hotel_id !== hotelId) throw new Error('اختر الدور أو المنطقة.');
    if (!String(name || '').trim()) throw new Error('اكتب اسم المرفق.');
    addFacilities_(hotelId, floorId, [{ name: name, ac: 0 }]);
    var r = Db.find('Rooms', function (x) { return x.floor_id === floorId && String(x.number) === String(name).trim(); });
    if (r && ftype) Db.update('Rooms', r.room_id, { ftype: String(ftype).trim() });
  });
}

// ───────── المتعهد: المكافحة ─────────
function apiPestLog(token, d) {
  var s = Auth.need(token, ['contractor']);
  return Db.withLock(function () { d = d || {}; d.photos = savePhotos_(d.photos, 'PL'); var r = Ops.log(s, d); Db.reset(); return { result: r, boot: conBoot_(s) }; });
}
function apiPestTrap(token, action, d) {
  var s = Auth.need(token, ['contractor']);
  return Db.withLock(function () { var r = Ops.trap(s, action, d || {}); Db.reset(); return { result: r, boot: conBoot_(s) }; });
}

// ───────── النفايات: باركود منطقة النفايات ─────────
function apiWaBoot(code) {
  ensureSchemaVersion_();
  return Ops.waBoot(Orders.hotelByCode(code));
}
function apiWaLogin(code, pin, geo) {
  return Db.withLock(function () {
    ensureSchemaVersion_();
    var w = Ops.waLogin(code, pin, geo);
    return { token: w.token, name: w.name, role: w.role, boot: Ops.waBoot(Orders.hotelByCode(code)) };
  });
}
function apiWaSubmit(token, code, d, geo) {
  var s = Auth.session(token);
  return Db.withLock(function () {
    d = d || {};
    d.photos = savePhotos_(d.photos, 'WA');
    var r = Ops.waSubmit(s, code, d, geo);
    Db.reset();
    return { id: r.id, boot: Ops.waBoot(Orders.hotelByCode(code)) };
  });
}

// ───────── التقييم الدوري ─────────
var EVAL_ROLES_ = ['admin', 'engineer', 'supmgr'];
function apiEvalPreview(token, conId, from, to) { var s = Auth.need(token, EVAL_ROLES_); return Ops.evalPreview(s, conId, from, to); }
function apiEvalIssue(token, conId, from, to, decision, note) {
  var s = Auth.need(token, EVAL_ROLES_);
  return Db.withLock(function () {
    var r = Ops.evalIssue(s, conId, from, to, decision, note);
    Db.reset();
    return { id: r.id, boot: s.role === 'supmgr' ? supBoot_(s) : engBoot_(s) };
  });
}

// ───────── شاحنات المياه ─────────
/** أسعار شاحنات المياه: مفتاح الحجم رقم بالمتر المكعب */
function wtPrices_(p) {
  var out = {};
  Object.keys(p || {}).forEach(function (k) {
    var sz = Number(String(k).replace(/[^\d.]/g, '')), v = price_(p[k]);
    if (!(sz > 0)) return;
    if (v === '') return;
    out[String(sz)] = v;
  });
  return out;
}
function apiWtBoot(code) { ensureSchemaVersion_(); return Water.boot(Orders.hotelByCode(code)); }
function apiWtLogin(code, pin, geo) {
  return Db.withLock(function () {
    ensureSchemaVersion_();
    var w = Water.login(code, pin, geo);
    return { token: w.token, name: w.name, boot: Water.boot(Orders.hotelByCode(code)) };
  });
}
function apiWtSubmit(token, code, d, geo) {
  var s = Auth.session(token);
  return Db.withLock(function () {
    d = d || {};
    d.photos = savePhotos_(d.photos, 'WT');
    var r = Water.submit(s, code, d, geo);
    Db.reset();
    return { id: r.id, dup: r.dup, boot: Water.boot(Orders.hotelByCode(code)) };
  });
}
function apiWtMatch(token, ids, ok, reason) {
  var s = Auth.need(token, Water.MATCH_ROLES);
  return Db.withLock(function () {
    var n = Water.match(s, ids, !!ok, reason, scopeHotels_(s, Orders.refs()));
    Db.reset();
    return { n: n, boot: engBoot_(s) };
  });
}
function apiWtStatement(token, conId, hotelId, from, to) {
  var s = Auth.need(token, STAFF_ROLES);
  return Water.statement(scopeHotels_(s, Orders.refs()), conId, hotelId, from, to);
}

// ───────── «تواصل»: تذاكر المتعهدين وتقييمهم لمؤسستنا ─────────
function apiConTicket(token, d) {
  var s = Auth.need(token, ['contractor']);
  return Db.withLock(function () { d = d || {}; d.photos = savePhotos_(d.photos, 'TK'); var id = Tickets.create(s.id, d, d.by); Db.reset(); return { id: id, boot: conBoot_(s) }; });
}
function apiConTicketRate(token, id, sat, note) {
  var s = Auth.need(token, ['contractor']);
  return Db.withLock(function () { var r = Tickets.rate(s.id, id, sat, note); Db.reset(); return { r: r, boot: conBoot_(s) }; });
}
function apiConOrgEval(token, hotelId, scores, note, by) {
  var s = Auth.need(token, ['contractor']);
  return Db.withLock(function () { Tickets.orgSubmit(s.id, hotelId, scores, note, by); Db.reset(); return { boot: conBoot_(s) }; });
}
function apiTicketAct(token, id, action, d) {
  var s = Auth.need(token, STAFF_ROLES.concat(['supmgr']));
  return Db.withLock(function () {
    var hs = s.role === 'supmgr' ? Ops.supHotels(s) : scopeHotels_(s, Orders.refs());
    Tickets.act(s, id, action, d || {}, hs); Db.reset();
    return { boot: s.role === 'supmgr' ? supBoot_(s) : engBoot_(s) };
  });
}
