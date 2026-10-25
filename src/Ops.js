/**
 * Ops.js — أعوان: الإشراف (النفايات ومكافحة الآفات) والتقييم الدوري.
 *  - النفايات: زيارة من باركود منطقة النفايات (?h=CODE&m=wa) بالرقم السري لمتعهد النفايات أو المشرف، مع تحقق الموقع.
 *  - المكافحة: المناطق = غرف ومرافق الفندق بنوع المرفق (ftype)، ودورية الرش لكل نوع (PestSchedule) يحددها مدير الإشراف.
 *    المشرف يبلّغ: «متاحة للرش» أو «إصابة»، والمتعهد يسجّل المعالجة على منطقة أو أكثر فتُنجز بلاغاتها، والمصائد بمواعيدها.
 *  - التقييم الدوري: لقطة محفوظة لمؤشرات المتعهد في فترة يختارها المُصدِر، بدرجة وقرار وملاحظة.
 */
var Ops = (function () {
  var TZ = 'Asia/Riyadh';
  var GUEST = 'غرف النزلاء';
  var FIND = { none: 'لا إصابة', light: 'إصابة خفيفة', medium: 'إصابة متوسطة', heavy: 'إصابة شديدة' };
  var TRAP_KINDS = ['مصيدة لاصقة', 'محطة طعوم قوارض', 'مصيدة حشرات طائرة'];

  function ms(d) { return Orders.ms(d); }
  function csv(v) { return Orders.csv(v); }
  function yes_(v) { return v === 'نعم' || v === true || v === 'yes'; }
  function day_(t) { return Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd'); }

  // ───────── الموقع الجغرافي ─────────
  function dist_(lat1, lng1, lat2, lng2) {
    var R = 6371000, r = Math.PI / 180;
    var a = Math.pow(Math.sin((lat2 - lat1) * r / 2), 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin((lng2 - lng1) * r / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function hasGeo_(h) { return h && h.lat !== '' && h.lat != null && h.lng !== '' && h.lng != null && !isNaN(Number(h.lat)); }
  /** يتحقق أن المستخدم داخل نطاق الفندق. بلا إحداثيات للفندق: لا تحقق. الرسالة تبدأ بـ «الموقع مطلوب» ليطلبه المتصفح ويعيد */
  function geoCheck(h, geo) {
    if (!hasGeo_(h)) return { dist: '' };
    if (!geo || geo.lat == null || geo.lat === '') throw new Error('الموقع مطلوب: اسمح للصفحة بالوصول إلى موقعك ثم حاول.');
    var d = dist_(Number(h.lat), Number(h.lng), Number(geo.lat), Number(geo.lng));
    var radius = Number(h.geo_radius) || Number(Db.setting('geo_radius')) || 150;
    var slack = Math.min(Number(geo.acc) || 0, 100);
    if (d > radius + slack) throw new Error('أنت خارج موقع الفندق (على بعد ' + Math.round(d) + ' م). سجّل من الموقع نفسه.');
    return { dist: Math.round(d), lat: geo.lat, lng: geo.lng, acc: Math.round(Number(geo.acc) || 0) };
  }
  /** «24.7136, 46.6753» أو رابط خرائط Google → {lat, lng} */
  function parseGeo(v) {
    v = String(v || '').trim();
    if (!v) return { lat: '', lng: '' };
    var m = v.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || v.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || v.match(/(-?\d{1,2}\.\d{3,})\s*[,،]\s*(-?\d{1,3}\.\d{3,})/);
    if (!m) throw new Error('اكتب الإحداثيات مثل 21.4225, 39.8262 أو الصق رابط الموقع من خرائط Google.');
    var lat = Number(m[1]), lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('الإحداثيات غير صحيحة.');
    return { lat: lat, lng: lng };
  }

  // ───────── الإشراف: نطاق الفنادق ─────────
  function supHotels(s) {
    if (s.role === 'admin' || s.role === 'management') return Db.all('Hotels').map(function (h) { return h.hotel_id; });
    return csv((Db.get('Users', s.id) || {}).hotel_ids);
  }

  // ───────── النفايات ─────────
  function waContract(hotelId) { return Orders.activeContract(hotelId, 'wa'); }

  /** دخول باركود النفايات: متعهد نفايات بعقد ساري لهذا الفندق، أو مشرف الفندق */
  function waLogin(code, pin, geo) {
    var h = Orders.hotelByCode(code);
    var sup = Auth.supLogin(pin), who;
    if (sup) {
      if (csv(sup.user.hotel_ids).indexOf(h.hotel_id) === -1) { Auth.logout(sup.token); throw new Error('هذا الفندق ليس ضمن فنادقك.'); }
      who = { token: sup.token, name: sup.user.name, role: sup.user.role };
    } else {
      var r = Auth.conLogin(h, pin);
      if (r.con.type !== 'wa' || !Orders.activeContract(h.hotel_id, 'wa', r.con.con_id)) { Auth.logout(r.token); throw new Error('هذا الباركود لمتعهد النفايات والمشرفين فقط.'); }
      who = { token: r.token, name: r.con.name, role: 'contractor' };
    }
    try { geoCheck(h, geo); } catch (e) { Auth.logout(who.token); throw e; }
    return who;
  }

  function waBoot(h) {
    var c = waContract(h.hotel_id);
    var last = Db.all('WasteVisits', function (v) { return v.hotel_id === h.hotel_id; }).sort(function (a, b) { return ms(b.at) - ms(a.at); })[0];
    return {
      hotel: { code: h.code, name: h.name, carts: Number(h.wa_carts) || 0, geo: hasGeo_(h), brand: h.brand || 'nawazi' },
      con: c ? ((Db.get('Contractors', c.con_id) || {}).name || '') : '', perWeek: c ? Number(c.wa_per_week) || 0 : 0,
      last: last ? { at: ms(last.at), by: last.by_name, truck: last.truck, removed: last.removed, left: Number(last.left_carts) || 0, rating: Number(last.rating) || 0 } : null
    };
  }

  /** d: {truck, removed, left_carts, washed, rating, note, photos} */
  function waSubmit(s, code, d, geo) {
    var h = Orders.hotelByCode(code);
    var g = geoCheck(h, geo);
    var name, role = s.role, conId = '';
    if (s.role === 'contractor') {
      var con = Db.get('Contractors', s.id);
      if (!con || con.type !== 'wa' || s.hotel_id !== h.hotel_id) throw new Error('هذا الباركود لمتعهد النفايات والمشرفين فقط.');
      name = con.name; conId = con.con_id;
    } else {
      if (!Auth.isSup(s.role) || supHotels(s).indexOf(h.hotel_id) === -1) throw new Error('لا تملك صلاحية هذا الإجراء.');
      name = (Db.get('Users', s.id) || {}).name || '';
      var c = waContract(h.hotel_id); conId = c ? c.con_id : '';
    }
    if (['نعم', 'لا'].indexOf(d.truck) === -1) throw new Error('هل حضرت الشاحنة؟');
    var removed = d.truck === 'لا' ? 'لا' : d.removed;
    if (['نعم', 'لا'].indexOf(removed) === -1) throw new Error('هل رُحّلت النفايات؟');
    var left = Number(d.left_carts);
    if (removed === 'لا' && !(left >= 0 && String(d.left_carts).trim() !== '')) throw new Error('اكتب عدد العربات المتبقية.');
    if (removed === 'نعم') left = 0;
    var cap = Number(h.wa_carts) || 0;
    if (cap && left > cap * 2) throw new Error('عدد العربات أكبر بكثير من سعة المنطقة (' + cap + '). تأكد منه.');
    var washed = d.truck === 'لا' ? '' : d.washed;
    if (d.truck !== 'لا' && ['نعم', 'لا'].indexOf(washed) === -1) throw new Error('هل نُظّف المكان وغُسل بعد الترحيل؟');
    var rating = Number(d.rating);
    if (!(rating >= 1 && rating <= 5)) throw new Error('قيّم مستوى النظافة من 1 إلى 5.');
    var v = Db.insert('WasteVisits', {
      hotel_id: h.hotel_id, con_id: conId, by_id: s.id, by_name: name, by_role: role, at: new Date(),
      truck: d.truck, removed: removed, left_carts: left, washed: washed, rating: Math.round(rating), note: String(d.note || '').trim(),
      photos: (d.photos || []).join(','), lat: g.lat || '', lng: g.lng || '', acc: g.acc || '', dist: g.dist
    });
    return { id: v.visit_id };
  }

  function waVisits(hotelIds, sinceMs) {
    return Db.all('WasteVisits', function (v) { return hotelIds.indexOf(v.hotel_id) !== -1 && ms(v.at) >= sinceMs; }).map(function (v) {
      return { id: v.visit_id, hotel_id: v.hotel_id, at: ms(v.at), by: v.by_name, role: v.by_role, truck: v.truck, removed: v.removed,
        left: Number(v.left_carts) || 0, washed: v.washed, rating: Number(v.rating) || 0, note: v.note || '', photos: csv(v.photos), dist: v.dist === '' ? null : Number(v.dist),
        status: v.status || '', rejBy: v.rej_by || '', rejAt: ms(v.rej_at) || null, reason: v.rej_reason || '' };
    }).sort(function (a, b) { return b.at - a.at; });
  }

  /** رفض زيارة مسجلة لم تحدث فعلاً (مدير الإشراف أو مشرف النظام): لا تُحسب في المؤشرات */
  function waReject(s, id, reason) {
    if (['supmgr', 'admin'].indexOf(s.role) === -1) throw new Error('رفض الزيارات لمدير الإشراف أو مشرف النظام.');
    reason = String(reason || '').trim();
    if (!reason) throw new Error('اكتب سبب الرفض.');
    var v = Db.get('WasteVisits', id);
    if (!v || supHotels(s).indexOf(v.hotel_id) === -1) throw new Error('الزيارة ليست ضمن فنادقك.');
    if (v.status === 'rejected') return 0;
    Db.update('WasteVisits', id, { status: 'rejected', rej_by: (Db.get('Users', s.id) || {}).name || '', rej_at: new Date(), rej_reason: reason });
    return 1;
  }

  // ───────── مكافحة الآفات ─────────
  function schedule(hotelId) {
    var out = {};
    Db.all('PestSchedule', function (r) { return r.hotel_id === hotelId; }).forEach(function (r) { out[r.ftype] = Number(r.every_days) || 0; });
    return out;
  }

  /** المناطق بحالتها: آخر رش، الموعد التالي، البلاغات المفتوحة، المصائد */
  function pestState(hotelId) {
    var floors = Db.all('Floors', function (f) { return f.hotel_id === hotelId; }).sort(function (a, b) { return Number(a.sort) - Number(b.sort); });
    var rooms = Db.all('Rooms', function (r) { return r.hotel_id === hotelId; });
    var sch = schedule(hotelId), now = Date.now();
    var last = {}, lastFind = {};
    Db.all('PestLogs', function (l) { return l.hotel_id === hotelId && l.kind !== 'trap'; }).sort(function (a, b) { return ms(a.at) - ms(b.at); }).forEach(function (l) {
      csv(l.zones).forEach(function (z) { if (l.kind === 'spray') last[z] = ms(l.at); lastFind[z] = l.finding || ''; });
    });
    var flags = Db.all('PestFlags', function (f) { return f.hotel_id === hotelId && f.status === 'open'; });
    var traps = Db.all('Traps', function (t) { return t.hotel_id === hotelId && t.status === 'active'; });
    var byZoneF = {}, byZoneT = {};
    flags.forEach(function (f) { (byZoneF[f.zone] = byZoneF[f.zone] || []).push(f.kind); });
    traps.forEach(function (t) { byZoneT[t.zone] = (byZoneT[t.zone] || 0) + 1; });
    return floors.map(function (f) {
      var label = (f.tower ? towerName_(f.tower) + ' · ' : '') + f.name;
      return {
        id: f.floor_id, label: label,
        zones: rooms.filter(function (r) { return r.floor_id === f.floor_id; }).map(function (r) {
          var fac = isFacility_(r, f), ft = r.ftype || (fac ? '' : GUEST), every = sch[ft] || 0, l = last[r.room_id] || null;
          return { id: r.room_id, name: String(r.number), fac: fac, ftype: ft, every: every, last: l,
            due: every ? (l ? l + every * 864e5 : 0) : null, overdue: !!every && (!l || l + every * 864e5 < now),
            flags: byZoneF[r.room_id] || [], traps: byZoneT[r.room_id] || 0, find: lastFind[r.room_id] || '' };
        })
      };
    });
  }

  function trapsOf(hotelId) {
    var zones = {};
    Db.all('Rooms', function (r) { return r.hotel_id === hotelId; }).forEach(function (r) { zones[r.room_id] = String(r.number); });
    return Db.all('Traps', function (t) { return t.hotel_id === hotelId && t.status === 'active'; }).map(function (t) {
      var lc = ms(t.last_check) || ms(t.placed_at), every = Number(t.every_days) || 7;
      return { id: t.trap_id, label: t.label, kind: t.kind, zone: t.zone, zoneName: zones[t.zone] || '', placed: ms(t.placed_at), every: every,
        last: ms(t.last_check), result: t.last_result || '', next: lc + every * 864e5, late: lc + every * 864e5 < Date.now() };
    }).sort(function (a, b) { return a.next - b.next; });
  }

  function flagsOf(hotelIds, sinceMs) {
    var zones = {};
    Db.all('Rooms').forEach(function (r) { zones[r.room_id] = String(r.number); });
    return Db.all('PestFlags', function (f) { return hotelIds.indexOf(f.hotel_id) !== -1 && (f.status === 'open' || ms(f.created_at) >= sinceMs); }).map(function (f) {
      return { id: f.flag_id, hotel_id: f.hotel_id, zone: f.zone, zoneName: zones[f.zone] || '', kind: f.kind, pests: csv(f.pests), note: f.note || '',
        by: f.by_name, created: ms(f.created_at), status: f.status, done: ms(f.done_at) };
    }).sort(function (a, b) { return b.created - a.created; });
  }

  function logsOf(hotelIds, sinceMs) {
    var zones = {};
    Db.all('Rooms').forEach(function (r) { zones[r.room_id] = String(r.number); });
    return Db.all('PestLogs', function (l) { return hotelIds.indexOf(l.hotel_id) !== -1 && ms(l.at) >= sinceMs; }).map(function (l) {
      return { id: l.log_id, hotel_id: l.hotel_id, kind: l.kind, zoneIds: csv(l.zones), zones: csv(l.zones).map(function (z) { return zones[z] || z; }), pests: csv(l.pests), material: l.material || '',
        finding: l.finding || '', note: l.note || '', by: l.by_name, at: ms(l.at), trap: l.trap_id || '', flags: csv(l.flags_closed).length };
    }).sort(function (a, b) { return b.at - a.at; });
  }

  function pestBoot(hotelIds) {
    var out = {};
    hotelIds.forEach(function (hid) { out[hid] = { floors: pestState(hid), schedule: schedule(hid), traps: trapsOf(hid) }; });
    var since = Date.now() - 60 * 864e5;
    return { hotels: out, flags: flagsOf(hotelIds, since), logs: logsOf(hotelIds, since), finds: FIND, trapKinds: TRAP_KINDS };
  }

  function zoneOf_(hotelId, zoneId) {
    var r = Db.get('Rooms', zoneId);
    if (!r || r.hotel_id !== hotelId) throw new Error('المنطقة غير موجودة في هذا الفندق.');
    return r;
  }

  /** المشرف: «متاحة للرش» أو «بلاغ إصابة» على منطقة */
  function flag(s, d) {
    if (supHotels(s).indexOf(d.hotel_id) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    if (['ready', 'infest'].indexOf(d.kind) === -1) throw new Error('اختر: متاحة للرش أو بلاغ إصابة.');
    var zones = (d.zones && d.zones.length) ? d.zones : [d.zone];
    if (!zones[0]) throw new Error('اختر المنطقة.');
    if (d.kind === 'infest' && !(d.pests || []).length) throw new Error('اختر الآفة.');
    var me = Db.get('Users', s.id) || {};
    var recs = zones.map(function (z) {
      zoneOf_(d.hotel_id, z);
      return { hotel_id: d.hotel_id, zone: z, kind: d.kind, pests: (d.pests || []).join(','), note: String(d.note || '').trim(), photos: (d.photos || []).join(','),
        by_id: s.id, by_name: me.name || '', created_at: new Date(), status: 'open' };
    });
    Db.insertMany('PestFlags', recs);
    return recs.length;
  }

  function cancelFlag(s, flagId) {
    var f = Db.get('PestFlags', flagId);
    if (!f || supHotels(s).indexOf(f.hotel_id) === -1) throw new Error('البلاغ غير موجود.');
    if (f.status !== 'open') throw new Error('البلاغ ليس مفتوحاً.');
    if (s.role !== 'supmgr' && f.by_id !== s.id) throw new Error('يلغيه من رفعه أو مدير الإشراف.');
    Db.update('PestFlags', flagId, { status: 'cancelled', done_at: new Date() });
  }

  function pcCon_(s, hotelId) {
    var con = Db.get('Contractors', s.id);
    if (!con || con.type !== 'pc') throw new Error('هذا الإجراء لمتعهد المكافحة.');
    if (s.web) throw new Error('هذا الإجراء من الفندق فقط: امسح باركود أعوان.');
    if (!Orders.activeContract(hotelId, 'pc', con.con_id)) throw new Error('لا يوجد عقد ساري لك في هذا الفندق.');
    return con;
  }

  /** المتعهد: معالجة منطقة أو أكثر. d: {hotel_id, zones[], kind: spray|inspect, pests[], material, finding, note, photos} */
  function log(s, d) {
    var hotelId = d.hotel_id || s.hotel_id;
    var con = pcCon_(s, hotelId);
    if (['spray', 'inspect'].indexOf(d.kind) === -1) throw new Error('اختر: رش أو فحص.');
    if (!(d.zones || []).length) throw new Error('اختر منطقة واحدة على الأقل.');
    d.zones.forEach(function (z) { zoneOf_(hotelId, z); });
    if (!FIND[d.finding]) throw new Error('حدّد نتيجة المعاينة.');
    if (d.kind === 'spray' && !String(d.material || '').trim()) throw new Error('اختر المادة المستخدمة.');
    var t = new Date();
    // يُنجز: بلاغات «متاحة للرش» بالرش، وبلاغات الإصابة بأي معالجة
    var closed = Db.all('PestFlags', function (f) { return f.hotel_id === hotelId && f.status === 'open' && d.zones.indexOf(f.zone) !== -1 && (f.kind === 'infest' || d.kind === 'spray'); });
    var rec = Db.insert('PestLogs', {
      hotel_id: hotelId, con_id: con.con_id, zones: d.zones.join(','), kind: d.kind, pests: (d.pests || []).join(','), material: String(d.material || '').trim(),
      finding: d.finding, note: String(d.note || '').trim(), photos: (d.photos || []).join(','), by_name: String(d.tech || '').trim() || con.name, at: t,
      flags_closed: closed.map(function (f) { return f.flag_id; }).join(',')
    });
    closed.forEach(function (f) { Db.update('PestFlags', f.flag_id, { status: 'done', done_at: t, done_log: rec.log_id }); });
    return { id: rec.log_id, flags: closed.length };
  }

  /** المصائد. place {hotel_id, zone, kind, every_days} · check {trap_id, result, note} · remove {trap_id} */
  function trap(s, action, d) {
    var t = new Date();
    if (action === 'place') {
      var hotelId = d.hotel_id || s.hotel_id, con = pcCon_(s, hotelId);
      zoneOf_(hotelId, d.zone);
      if (TRAP_KINDS.indexOf(d.kind) === -1) throw new Error('اختر نوع المصيدة.');
      var every = Number(d.every_days) || 7;
      if (every < 1 || every > 90) throw new Error('موعد الفحص بين 1 و90 يوماً.');
      var n = Db.all('Traps', function (x) { return x.hotel_id === hotelId; }).length + 1;
      var rec = Db.insert('Traps', { hotel_id: hotelId, zone: d.zone, label: 'T-' + (n < 10 ? '0' : '') + n, kind: d.kind, placed_at: t, every_days: every,
        last_check: '', last_result: '', removed_at: '', status: 'active', by_name: con.name });
      return { id: rec.trap_id, label: rec.label };
    }
    var tr = Db.get('Traps', d.trap_id);
    if (!tr || tr.status !== 'active') throw new Error('المصيدة غير موجودة أو مرفوعة.');
    var c2 = pcCon_(s, tr.hotel_id);
    if (action === 'check') {
      if (['نظيفة', 'رصد آفة', 'تالفة'].indexOf(d.result) === -1) throw new Error('اختر نتيجة الفحص.');
      Db.update('Traps', tr.trap_id, { last_check: t, last_result: d.result });
      Db.insert('PestLogs', { hotel_id: tr.hotel_id, con_id: c2.con_id, zones: tr.zone, kind: 'trap', trap_id: tr.trap_id, pests: '', material: '',
        finding: d.result === 'رصد آفة' ? 'light' : 'none', note: (d.result + (d.note ? ' · ' + String(d.note).trim() : '')), photos: '', by_name: c2.name, at: t, flags_closed: '' });
      return {};
    }
    if (action === 'remove') { Db.update('Traps', tr.trap_id, { status: 'removed', removed_at: t }); return {}; }
    throw new Error('إجراء غير معروف.');
  }

  /** مدير الإشراف: دورية الرش لكل نوع مرفق. rows: {ftype: days} */
  function saveSchedule(s, hotelId, rows) {
    if (s.role !== 'supmgr' && s.role !== 'admin') throw new Error('الجدولة لمدير الإشراف.');
    if (supHotels(s).indexOf(hotelId) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    Object.keys(rows || {}).forEach(function (ft) {
      var v = String(rows[ft]).trim(), n = v === '' ? 0 : Number(v);
      if (isNaN(n) || n < 0 || n > 365) throw new Error('الدورية بالأيام بين 1 و365، أو فارغة لغير المجدول: ' + ft);
      var key = hotelId + '|' + ft;
      if (Db.find('PestSchedule', function (r) { return r.key === key; })) Db.update('PestSchedule', key, { every_days: n });
      else Db.insert('PestSchedule', { key: key, hotel_id: hotelId, ftype: ft, every_days: n });
    });
  }

  /** مدير الإشراف: نوع المرفق لمنطقة أو أكثر */
  function setZoneType(s, hotelId, zoneIds, ftype) {
    if (s.role !== 'supmgr' && s.role !== 'admin') throw new Error('لمدير الإشراف.');
    if (supHotels(s).indexOf(hotelId) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    ftype = String(ftype || '').trim();
    (zoneIds || []).forEach(function (z) { zoneOf_(hotelId, z); Db.update('Rooms', z, { ftype: ftype }); });
  }

  // ───────── التقييم الدوري ─────────
  function factor_(kpi, v, t) {
    if (v == null || !t) return null;
    var low = kpi === 'resp' || kpi === 'flagresp';
    if (low) return v <= t.full ? 1 : v <= t.half ? 0.5 : 0;
    return v >= t.full ? 1 : v >= t.half ? 0.5 : 0;
  }
  function score_(V, th) {
    var w = 0, s = 0;
    Object.keys(V).forEach(function (k) { var t = (th || {})[k], f = factor_(k, V[k], t); if (f == null) return; w += t.weight; s += t.weight * f; });
    return w ? Math.round(100 * s / w) : null;
  }
  function pct_(a, b) { return b ? Math.round(100 * a / b) : null; }

  /** مؤشرات المتعهد في الفترة [from, to] (تواريخ yyyy-MM-dd) لفنادق محددة */
  function metrics(con, hotelIds, from, to) {
    var a = new Date(from + 'T00:00:00').getTime(), b = new Date(to + 'T23:59:59').getTime(), days = Math.max(1, Math.round((b - a) / 864e5));
    var inR = function (t) { t = ms(t); return t >= a && t <= b; };
    var V = {}, X = {};
    // أيام الفترة التي كان فيها عقد ساري لهذا المتعهد في الفندق (لا يُحاسب على ما قبل العقد)
    var cdays = function (h, field) {
      var best = 0, n = 0;
      Db.all('Contracts', function (c) { return c.con_id === con.con_id && csv(c.hotel_ids).indexOf(h) !== -1; }).forEach(function (c) {
        var s0 = Math.max(a, c.start ? ms(c.start) : a), e0 = Math.min(b, c.end ? ms(c.end) + 864e5 - 1 : b);
        var d = Math.max(0, Math.round((e0 - s0) / 864e5));
        if (d > 0) { n += d; if (field) best += (Number(c[field]) || 0) * d / 7; }
      });
      return field ? best : n;
    };
    if (con.type === 'wa') {
      var exp = 0;
      hotelIds.forEach(function (h) { exp += cdays(h, 'wa_per_week'); });
      exp = Math.round(exp);
      var vs = Db.all('WasteVisits', function (v) { return hotelIds.indexOf(v.hotel_id) !== -1 && inR(v.at) && v.status !== 'rejected'; });
      var done = vs.filter(function (v) { return yes_(v.truck) && yes_(v.removed); }).length;
      var rated = vs.filter(function (v) { return Number(v.rating) > 0; }), came = vs.filter(function (v) { return yes_(v.truck); });
      V.pickup = exp ? Math.min(100, pct_(done, exp)) : null;
      V.clean = rated.length ? Math.round(rated.reduce(function (s, v) { return s + Number(v.rating); }, 0) / rated.length * 20) : null;
      V.wash = came.length ? pct_(came.filter(function (v) { return yes_(v.washed); }).length, came.length) : null;
      X = { visits: vs.length, done: done, expected: exp, missed: Math.max(0, exp - done), noTruck: vs.length - came.length, leftMax: vs.reduce(function (m, v) { return Math.max(m, Number(v.left_carts) || 0); }, 0) };
    } else if (con.type === 'pc') {
      var expS = 0, gotS = 0;
      hotelIds.forEach(function (h) {
        var sch = schedule(h), sprays = {}, hd = cdays(h);
        Db.all('PestLogs', function (l) { return l.hotel_id === h && l.kind === 'spray' && inR(l.at); }).forEach(function (l) { csv(l.zones).forEach(function (z) { sprays[z] = (sprays[z] || 0) + 1; }); });
        var floors = {}; Db.all('Floors', function (f) { return f.hotel_id === h; }).forEach(function (f) { floors[f.floor_id] = f; });
        Db.all('Rooms', function (r) { return r.hotel_id === h; }).forEach(function (r) {
          var ft = r.ftype || (isFacility_(r, floors[r.floor_id]) ? '' : GUEST), ev = sch[ft];
          if (!ev) return;
          var e = Math.floor(hd / ev); if (!e) return; expS += e; gotS += Math.min(e, sprays[r.room_id] || 0);
        });
      });
      var fl = Db.all('PestFlags', function (f) { return hotelIds.indexOf(f.hotel_id) !== -1 && inR(f.created_at) && f.status !== 'cancelled'; });
      var dn = fl.filter(function (f) { return f.status === 'done'; });
      var tl = Db.all('PestLogs', function (l) { return hotelIds.indexOf(l.hotel_id) !== -1 && l.kind === 'trap' && inR(l.at); }).length;
      var tExp = 0;
      Db.all('Traps', function (t) { return hotelIds.indexOf(t.hotel_id) !== -1 && ms(t.placed_at) <= b && (t.status === 'active' || ms(t.removed_at) >= a); }).forEach(function (t) {
        var s0 = Math.max(a, ms(t.placed_at)), e0 = t.status === 'active' ? b : Math.min(b, ms(t.removed_at));
        tExp += Math.floor(Math.max(0, e0 - s0) / ((Number(t.every_days) || 7) * 864e5));
      });
      V.ontime = expS ? pct_(gotS, expS) : null;
      V.flagresp = dn.length ? Math.round(dn.reduce(function (s, f) { return s + (ms(f.done_at) - ms(f.created_at)) / 36e5; }, 0) / dn.length) : null;
      V.traps = tExp ? Math.min(100, pct_(tl, tExp)) : null;
      X = { sprays: gotS, expected: expS, flags: fl.length, infest: fl.filter(function (f) { return f.kind === 'infest'; }).length, open: fl.length - dn.length, trapChecks: tl, trapExpected: tExp };
    } else {
      var m1 = from.slice(0, 7), m2 = to.slice(0, 7);
      var z = { respSum: 0, respN: 0, readyOk: 0, readyN: 0, infoOk: 0, infoN: 0, satSum: 0, satN: 0, orders: 0, closed: 0, pm: 0, trapped: 0, clSum: 0, clN: 0 };
      Db.all('KpiSummary', function (r) { var k = String(r.key).split('|'); return k[0] === con.con_id && hotelIds.indexOf(k[1]) !== -1 && k[2] >= m1 && k[2] <= m2; }).forEach(function (r) {
        var d = r.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
        Object.keys(z).forEach(function (k) { z[k] += Number(d[k]) || 0; });
      });
      V.resp = z.respN ? Math.round(z.respSum / z.respN) : null;
      V.ready = z.readyN ? pct_(z.readyOk, z.readyN) : null;
      V.info = z.infoN ? pct_(z.infoOk, z.infoN) : null;
      V.sat = z.satN ? Math.round(z.satSum / z.satN) : null;
      X = { orders: z.orders, closed: z.closed, pm: z.pm, trapped: z.trapped, claim: z.clN ? Math.round(z.clSum / z.clN) + ' د' : '', respN: z.respN, readyN: z.readyN, infoN: z.infoN, satN: z.satN, months: m1 === m2 ? m1 : m1 + ' — ' + m2 };
    }
    var cas = Db.all('CorrectiveActions', function (c) { return c.con_id === con.con_id && hotelIds.indexOf(c.hotel_id) !== -1 && inR(c.created_at); });
    X.ca = cas.length; X.caOpen = cas.filter(function (c) { return c.status !== 'closed'; }).length;
    X.caNot = cas.filter(function (c) { return Number(c.rounds) > 0; }).length;
    var th = Kpi.thresholds()[con.type] || {};
    return { V: V, X: X, score: score_(V, th), th: th, days: days };
  }

  /** من يقيّم من: المهندس للتكييف والمصاعد والسلامة، ومدير الإشراف للنفايات والمكافحة، ومشرف النظام للكل */
  function canEval_(s, type) {
    if (s.role === 'admin') return true;
    if (s.role === 'engineer') return ['ac', 'el', 'sf'].indexOf(type) !== -1;
    if (s.role === 'supmgr') return ['wa', 'pc'].indexOf(type) !== -1;
    return false;
  }

  function evalScope_(s, conId) {
    var con = Db.get('Contractors', conId);
    if (!con) throw new Error('المتعهد غير موجود.');
    if (!canEval_(s, con.type)) throw new Error('لا تملك صلاحية تقييم هذا المتعهد.');
    var mine = s.role === 'admin' ? null : (s.role === 'supmgr' ? supHotels(s) : csv((Db.get('Users', s.id) || {}).hotel_ids));
    var hs = [];
    Db.all('Contracts', function (c) { return c.con_id === conId; }).forEach(function (c) { csv(c.hotel_ids).forEach(function (h) { if (hs.indexOf(h) === -1 && (!mine || mine.indexOf(h) !== -1)) hs.push(h); }); });
    if (!hs.length) throw new Error('لا توجد فنادق مشتركة مع هذا المتعهد.');
    return { con: con, hotels: hs };
  }

  function checkRange_(from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to)) || to < from) throw new Error('حدّد الفترة: من وإلى.');
  }

  function evalPreview(s, conId, from, to) {
    checkRange_(from, to);
    var sc = evalScope_(s, conId);
    var m = metrics(sc.con, sc.hotels, from, to);
    m.con = { id: sc.con.con_id, name: sc.con.name, type: sc.con.type }; m.hotels = sc.hotels; m.from = from; m.to = to;
    return m;
  }

  function evalIssue(s, conId, from, to, decision, note) {
    checkRange_(from, to);
    var DEC = ['مستمر', 'مستمر مع خطة تحسين', 'إنذار', 'عدم التجديد'];
    if (DEC.indexOf(decision) === -1) throw new Error('اختر القرار.');
    var sc = evalScope_(s, conId), m = metrics(sc.con, sc.hotels, from, to);
    var me = Db.get('Users', s.id) || {};
    var rec = Db.insert('Evaluations', { con_id: conId, type: sc.con.type, hotel_ids: sc.hotels.join(','), from: "'" + from, to: "'" + to,
      data: { V: m.V, X: m.X, th: m.th, days: m.days }, score: m.score == null ? '' : m.score, decision: decision, note: String(note || '').trim(),
      by: me.name || '', created_at: new Date() });
    return { id: rec.eval_id };
  }

  /** التقارير المحفوظة ضمن نطاق المستخدم */
  function evalList(filterFn) {
    var hotels = {}, cons = {};
    Db.all('Hotels').forEach(function (h) { hotels[h.hotel_id] = h.name; });
    Db.all('Contractors').forEach(function (c) { cons[c.con_id] = c.name; });
    return Db.all('Evaluations', filterFn).map(function (e) {
      var d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { d = {}; } }
      var f = function (v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v).replace(/^'/, ''); };
      return { id: e.eval_id, con_id: e.con_id, con: cons[e.con_id] || '', type: e.type, hotels: csv(e.hotel_ids).map(function (h) { return hotels[h] || h; }),
        hotel_ids: csv(e.hotel_ids), from: f(e.from), to: f(e.to), data: d, score: e.score === '' ? null : Number(e.score), decision: e.decision, note: e.note || '',
        by: e.by, created: ms(e.created_at) };
    }).sort(function (a, b) { return b.created - a.created; });
  }

  return {
    geoCheck: geoCheck, parseGeo: parseGeo, hasGeo: hasGeo_, supHotels: supHotels,
    waLogin: waLogin, waBoot: waBoot, waSubmit: waSubmit, waVisits: waVisits, waReject: waReject, waContract: waContract,
    pestBoot: pestBoot, pestState: pestState, flag: flag, cancelFlag: cancelFlag, log: log, trap: trap, saveSchedule: saveSchedule, setZoneType: setZoneType,
    metrics: metrics, evalPreview: evalPreview, evalIssue: evalIssue, evalList: evalList, canEval: canEval_, FIND: FIND, TRAP_KINDS: TRAP_KINDS
  };
})();
