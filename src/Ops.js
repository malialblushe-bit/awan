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

  /** رفض معالجة مكافحة مسجّلة لم تحدث فعلاً: لا تُحسب في الدورية ولا المصائد، وتُنقص موثوقية المعلومات */
  /** رفض معالجة لم تحدث، كلها أو مناطق منها (رفض جزئي). بلاغات المناطق المرفوضة تعود مفتوحة */
  function pcReject(s, id, reason, zones) {
    if (['supmgr', 'admin'].indexOf(s.role) === -1) throw new Error('رفض المعالجات لمدير الإشراف أو مشرف النظام.');
    reason = String(reason || '').trim();
    if (!reason) throw new Error('اكتب سبب الرفض.');
    var l = Db.get('PestLogs', id);
    if (!l || supHotels(s).indexOf(l.hotel_id) === -1) throw new Error('المعالجة ليست ضمن فنادقك.');
    if (l.status === 'rejected') return 0;
    var all = csv(l.zones), was = csv(l.rej_zones);
    var pick = (zones && zones.length) ? zones.filter(function (z) { return all.indexOf(z) !== -1; }) : all;
    if (!pick.length) throw new Error('اختر المناطق المرفوضة.');
    var rz = was.concat(pick.filter(function (z) { return was.indexOf(z) === -1; }));
    var full = all.every(function (z) { return rz.indexOf(z) !== -1; });
    Db.update('PestLogs', id, { status: full ? 'rejected' : '', rej_zones: full ? '' : rz.join(','), rej_by: (Db.get('Users', s.id) || {}).name || '', rej_at: new Date(),
      rej_reason: (l.rej_reason && !full ? l.rej_reason + ' · ' : '') + reason });
    // ما أنجزته هذه المعالجة في المناطق المرفوضة يعود مفتوحاً
    csv(l.flags_closed).forEach(function (fid) {
      var f = Db.get('PestFlags', fid);
      if (f && f.status === 'done' && rz.indexOf(f.zone) !== -1) Db.update('PestFlags', fid, { status: 'open', done_at: '', done_log: '' });
    });
    return pick.length;
  }
  /** المناطق المقبولة من معالجة (بعد الرفض الكلي أو الجزئي) */
  function okZones_(l) { if (l.status === 'rejected') return []; var rz = csv(l.rej_zones); return csv(l.zones).filter(function (z) { return rz.indexOf(z) === -1; }); }

  // ───────── رضا الإشراف الشهري (النفايات والمكافحة) وتقرير المكافحة الشهري ─────────
  function prevMonth_() { var d = new Date(); return Utilities.formatDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 864e5), TZ, 'yyyy-MM'); }
  function mon_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM') : String(v || '').slice(0, 7); }
  /** المتعهدون (نفايات/مكافحة) الذين كان لهم عقد ساري في الشهر لكل فندق */
  function activeIn_(month, types, hotelIds) {
    var a = new Date(month + '-01T00:00:00+03:00').getTime(), out = [];
    Db.all('Contracts', function (c) { return types.indexOf(c.type) !== -1; }).forEach(function (c) {
      if ((ms(c.start) || 0) > a + 31 * 864e5 || (ms(c.end) || 9e15) < a) return;
      csv(c.hotel_ids).forEach(function (h) { if ((!hotelIds || hotelIds.indexOf(h) !== -1) && !out.some(function (x) { return x.con === c.con_id && x.hotel === h; })) out.push({ con: c.con_id, hotel: h, type: c.type }); });
    });
    return out;
  }
  /** مدير الإشراف: ما لم يُقيَّم للشهر السابق */
  function ratesDue(hotelIds) {
    var m = prevMonth_(), done = {};
    Db.all('SupRatings', function (r) { return mon_(r.month) === m; }).forEach(function (r) { done[r.con_id + '|' + r.hotel_id] = 1; });
    var cn = {}, hn = {}; Db.all('Contractors').forEach(function (c) { cn[c.con_id] = c.name; }); Db.all('Hotels').forEach(function (h) { hn[h.hotel_id] = h.name; });
    return { month: m, due: activeIn_(m, ['wa', 'pc'], hotelIds).filter(function (x) { return !done[x.con + '|' + x.hotel]; }).map(function (x) { return { con: x.con, conName: cn[x.con] || '', hotel: x.hotel, hotelName: hn[x.hotel] || '', type: x.type }; }) };
  }
  function rate(s, conId, hotelId, score, note) {
    if (['supmgr', 'admin'].indexOf(s.role) === -1) throw new Error('تقييم الرضا لمدير الإشراف.');
    if ([0, 50, 100].indexOf(Number(score)) === -1) throw new Error('اختر: راضٍ أو مقبول أو غير راضٍ.');
    var d = ratesDue(supHotels(s));
    if (!d.due.some(function (x) { return x.con === conId && x.hotel === hotelId; })) throw new Error('لا تقييم مطلوب لهذا المتعهد والفندق.');
    Db.insert('SupRatings', { con_id: conId, hotel_id: hotelId, month: "'" + d.month, score: Number(score), note: String(note || '').trim(), by_name: (Db.get('Users', s.id) || {}).name || '', at: new Date() });
  }
  /** متعهد المكافحة: التقارير الشهرية المطلوبة (الشهر السابق) */
  function reportsDue(conId) {
    var m = prevMonth_(), done = {}, hn = {};
    Db.all('Hotels').forEach(function (h) { hn[h.hotel_id] = h.name; });
    Db.all('PcReports', function (r) { return r.con_id === conId && mon_(r.month) === m; }).forEach(function (r) { done[r.hotel_id] = 1; });
    return { month: m, due: activeIn_(m, ['pc']).filter(function (x) { return x.con === conId && !done[x.hotel]; }).map(function (x) { return { hotel: x.hotel, name: hn[x.hotel] || '' }; }) };
  }
  function pcReport(conId, hotelId, att, by) {
    var d = reportsDue(conId);
    if (!d.due.some(function (x) { return x.hotel === hotelId; })) throw new Error('لا تقرير مطلوب لهذا الفندق.');
    if (!att || !att.length) throw new Error('أرفق التقرير الشهري (PDF أو صورة).');
    Db.insert('PcReports', { con_id: conId, hotel_id: hotelId, month: "'" + d.month, att: att.join(','), by_name: String(by || '').trim(), at: new Date() });
  }

  // ───────── المكافحة: فنيو القائد، حالة من الفني لقائده، والتقرير الفني لمالك الخدمة ─────────
  var CASE_TYPES = ['منطقة تحتاج قرار القائد', 'نقص مواد أو معدات', 'فتحات ومنافذ للآفات', 'أخرى'];
  function pcContract_(conId) { return Db.find('Contracts', function (c) { return c.con_id === conId && c.type === 'pc'; }); }
  function team(conId) { var c = pcContract_(conId); try { return c && c.team ? JSON.parse(c.team) : []; } catch (e) { return []; } }
  function setTeam(s, names) {
    if (!s.lead) throw new Error('تعريف الفنيين لقائد الفريق.');
    var seen = {}, l = (names || []).map(function (x) { return String(x || '').trim(); }).filter(function (x) { if (!x || seen[x]) return false; seen[x] = 1; return true; });
    Db.update('Contracts', s.lead, { team: JSON.stringify(l) });
    return l.length;
  }
  function pestMsg(s, d) {
    var con = Db.get('Contractors', s.id), hid = d.hotel_id;
    pcCon_(s, hid);
    var zones = (d.zones || []).filter(function (z) { var r = Db.get('Rooms', z); return r && r.hotel_id === hid; });
    var by = String(d.by || '').trim() || (s.lead_name ? s.lead_name + ' (قائد الفريق)' : con.name);
    if (d.kind === 'case') {
      if (s.lead) throw new Error('الحالات يرسلها الفنيون لقائدهم.');
      var c = pcContract_(con.con_id); if (!c || !String(c.lead_name || '').trim()) throw new Error('لا قائد فريق معرّف في عقدكم.');
      if (CASE_TYPES.indexOf(d.ctype) === -1) throw new Error('اختر نوع الحالة.');
      if (!String(d.by || '').trim()) throw new Error('اختر اسمك.');
      if (!String(d.note || '').trim() && !(d.att || []).length) throw new Error('اكتب الحالة أو أرفق صورة.');
    } else if (d.kind === 'tech') {
      if (!String(d.title || '').trim()) throw new Error('اكتب عنوان التقرير.');
      if (!(d.att || []).length) throw new Error('أرفق التقرير الفني على كليشتكم (صورة أو PDF).');
    } else throw new Error('نوع غير معروف.');
    return Db.insert('PestMsgs', { kind: d.kind, hotel_id: hid, con_id: con.con_id, zones: zones.join(','), ctype: d.kind === 'case' ? d.ctype : '', title: String(d.title || '').trim(),
      note: String(d.note || '').trim(), att: (d.att || []).join(','), by_name: by, created_at: new Date(), status: 'open' }).msg_id;
  }
  /** القائد يتعامل مع حالة فنيه · مالك الخدمة يؤشر «اطّلعت» على التقرير الفني */
  function pestMsgDone(s, id, reply, sup) {
    var m = Db.get('PestMsgs', id); if (!m) throw new Error('غير موجود.');
    if (sup) { if (m.kind !== 'tech' || supHotels(s).indexOf(m.hotel_id) === -1) throw new Error('التقرير ليس ضمن فنادقك.'); }
    else { if (m.kind !== 'case' || m.con_id !== s.id || !s.lead) throw new Error('الحالة لقائد الفريق.'); }
    Db.update('PestMsgs', id, { status: 'done', done_by: sup ? ((Db.get('Users', s.id) || {}).name || '') : s.lead_name, done_at: new Date(), reply: String(reply || '').trim() });
  }
  function pestMsgs(filter) {
    var since = Date.now() - 60 * 864e5, rn = {};
    return Db.all('PestMsgs', function (m) { return filter(m) && (m.status === 'open' || ms(m.created_at) >= since); }).map(function (m) {
      var z = csv(m.zones);
      return { id: m.msg_id, kind: m.kind, hotel_id: m.hotel_id, con_id: m.con_id, zones: z.map(function (x) { if (!rn[x]) { var r = Db.get('Rooms', x); rn[x] = r ? String(r.number) : x; } return rn[x]; }), ctype: m.ctype || '', title: m.title || '',
        note: m.note || '', att: csv(m.att), by: m.by_name || '', at: ms(m.created_at), status: m.status, doneBy: m.done_by || '', doneAt: ms(m.done_at) || null, reply: m.reply || '' };
    }).sort(function (a, b) { return b.at - a.at; });
  }

  // ───────── مكافحة الآفات ─────────
  /** دورية فحص المصائد لكل فندق: يحددها مدير الإشراف في الجدولة، من 1 إلى 3 أيام (الافتراضي 3) */
  var TRAP_KEY = '__traps', TRAP_MAX = 3;
  function trapEvery(hotelId) {
    var r = Db.find('PestSchedule', function (x) { return x.hotel_id === hotelId && x.ftype === TRAP_KEY; });
    var n = r ? Number(r.every_days) : 0;
    return n >= 1 ? Math.min(TRAP_MAX, n) : TRAP_MAX;
  }
  function schedule(hotelId) {
    var out = {};
    Db.all('PestSchedule', function (r) { return r.hotel_id === hotelId && r.ftype !== TRAP_KEY; }).forEach(function (r) { out[r.ftype] = Number(r.every_days) || 0; });
    return out;
  }
  /** غرف النزلاء: عدد مرات الرش في الشهر عند الإتاحة (بدل الدورية بالأيام) */
  function quotas(hotelId) {
    var out = {};
    Db.all('PestSchedule', function (r) { return r.hotel_id === hotelId && Number(r.per_month) > 0; }).forEach(function (r) { out[r.ftype] = Number(r.per_month); });
    return out;
  }
  function monthStart_() { var d = Utilities.formatDate(new Date(), TZ, 'yyyy-MM') + '-01T00:00:00'; return new Date(d + '+03:00').getTime(); }

  /** المناطق بحالتها: آخر رش، الموعد التالي، البلاغات المفتوحة، المصائد */
  function pestState(hotelId) {
    var floors = Db.all('Floors', function (f) { return f.hotel_id === hotelId; }).sort(function (a, b) { return Number(a.sort) - Number(b.sort); });
    var rooms = Db.all('Rooms', function (r) { return r.hotel_id === hotelId; });
    var sch = schedule(hotelId), qt = quotas(hotelId), now = Date.now(), m0 = monthStart_();
    var last = {}, lastFind = {}, monthN = {};
    Db.all('PestLogs', function (l) { return l.hotel_id === hotelId && l.kind !== 'trap' && l.status !== 'rejected'; }).sort(function (a, b) { return ms(a.at) - ms(b.at); }).forEach(function (l) {
      okZones_(l).forEach(function (z) { if (l.kind === 'spray') { last[z] = ms(l.at); if (ms(l.at) >= m0) monthN[z] = (monthN[z] || 0) + 1; } lastFind[z] = l.finding || ''; });
    });
    var flags = Db.all('PestFlags', function (f) { return f.hotel_id === hotelId && f.status === 'open'; });
    var traps = Db.all('Traps', function (t) { return t.hotel_id === hotelId && t.status === 'active'; });
    var byZoneF = {}, byZoneT = {};
    flags.forEach(function (f) { (byZoneF[f.zone] = byZoneF[f.zone] || []).push(f.kind); });
    traps.forEach(function (t) { byZoneT[t.zone] = (byZoneT[t.zone] || 0) + 1; });
    return floors.map(function (f) {
      var label = (f.tower ? towerName_(f.tower) + ' · ' : '') + f.name;
      return {
        id: f.floor_id, label: label, tower: String(f.tower || ''),
        zones: rooms.filter(function (r) { return r.floor_id === f.floor_id; }).map(function (r) {
          var fac = isFacility_(r, f), ft = r.ftype || (fac ? '' : GUEST), q = qt[ft] || 0, every = q ? 0 : (sch[ft] || 0), l = last[r.room_id] || null;
          return { id: r.room_id, name: String(r.number), fac: fac, ftype: ft, every: every, last: l, quota: q, monthN: q ? Math.min(q, monthN[r.room_id] || 0) : 0,
            due: every ? (l ? l + every * 864e5 : 0) : null, overdue: !!every && (!l || l + every * 864e5 < now),
            flags: byZoneF[r.room_id] || [], traps: byZoneT[r.room_id] || 0, find: lastFind[r.room_id] || '' };
        })
      };
    });
  }

  function trapsOf(hotelId) {
    var zones = {};
    Db.all('Rooms', function (r) { return r.hotel_id === hotelId; }).forEach(function (r) { zones[r.room_id] = String(r.number); });
    var every = trapEvery(hotelId);
    return Db.all('Traps', function (t) { return t.hotel_id === hotelId && t.status === 'active'; }).map(function (t) {
      var lc = ms(t.last_check) || ms(t.placed_at);
      return { id: t.trap_id, label: t.label, kind: t.kind, zone: t.zone, zoneName: zones[t.zone] || '', placed: ms(t.placed_at), every: every,
        last: ms(t.last_check), result: t.last_result || '', next: lc + every * 864e5, late: lc + every * 864e5 < Date.now() };
    }).sort(function (a, b) { return a.next - b.next; });
  }

  /** سجل المصائد: النشطة والمرفوعة خلال 60 يوماً، مع أحداث كل مصيدة (وضع، فحوص، استبدال، رفع) */
  function trapLog(hotelId) {
    var zones = {}, since = Date.now() - 60 * 864e5, ev = {};
    Db.all('Rooms', function (r) { return r.hotel_id === hotelId; }).forEach(function (r) { zones[r.room_id] = String(r.number); });
    Db.all('PestLogs', function (l) { return l.hotel_id === hotelId && l.kind === 'trap' && l.trap_id; }).forEach(function (l) {
      (ev[l.trap_id] = ev[l.trap_id] || []).push({ at: ms(l.at), text: l.note || '', by: l.by_name || '', rejected: l.status === 'rejected' });
    });
    return Db.all('Traps', function (t) { return t.hotel_id === hotelId && (t.status === 'active' || ms(t.removed_at) >= since); }).map(function (t) {
      var e = (ev[t.trap_id] || []).slice();
      e.push({ at: ms(t.placed_at), text: 'وضع المصيدة', by: t.by_name || '' });
      if (t.status === 'removed') e.push({ at: ms(t.removed_at), text: 'رفع المصيدة', by: '' });
      e.sort(function (a, b) { return b.at - a.at; });
      return { id: t.trap_id, label: t.label, kind: t.kind, zoneName: zones[t.zone] || '', status: t.status, placed: ms(t.placed_at), removed: ms(t.removed_at) || null, every: trapEvery(hotelId), events: e };
    }).sort(function (a, b) { return (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || String(a.label).localeCompare(String(b.label)); });
  }

  function flagsOf(hotelIds, sinceMs) {
    var zones = {};
    Db.all('Rooms').forEach(function (r) { zones[r.room_id] = String(r.number); });
    return Db.all('PestFlags', function (f) { return hotelIds.indexOf(f.hotel_id) !== -1 && (f.status === 'open' || ms(f.created_at) >= sinceMs); }).map(function (f) {
      return { id: f.flag_id, hotel_id: f.hotel_id, zone: f.zone, zoneName: zones[f.zone] || '', kind: f.kind, pests: csv(f.pests), note: f.note || '',
        by: f.by_name, src: f.source || 'sup', created: ms(f.created_at), status: f.status, done: ms(f.done_at) };
    }).sort(function (a, b) { return b.created - a.created; });
  }

  function logsOf(hotelIds, sinceMs) {
    var zones = {};
    Db.all('Rooms').forEach(function (r) { zones[r.room_id] = String(r.number); });
    return Db.all('PestLogs', function (l) { return hotelIds.indexOf(l.hotel_id) !== -1 && ms(l.at) >= sinceMs; }).map(function (l) {
      return { id: l.log_id, hotel_id: l.hotel_id, kind: l.kind, zoneIds: csv(l.zones), zones: csv(l.zones).map(function (z) { return zones[z] || z; }), pests: csv(l.pests), material: l.material || '',
        finding: l.finding || '', note: l.note || '', by: l.by_name, at: ms(l.at), trap: l.trap_id || '', flags: csv(l.flags_closed).length,
        status: l.status || '', rejZones: csv(l.rej_zones), rejBy: l.rej_by || '', rejAt: ms(l.rej_at) || null, reason: l.rej_reason || '' };
    }).sort(function (a, b) { return b.at - a.at; });
  }

  function pestBoot(hotelIds) {
    var out = {};
    hotelIds.forEach(function (hid) { out[hid] = { floors: pestState(hid), schedule: schedule(hid), quota: quotas(hid), traps: trapsOf(hid), trapLog: trapLog(hid), trapEvery: trapEvery(hid) }; });
    var since = Date.now() - 60 * 864e5;
    return { hotels: out, flags: flagsOf(hotelIds, since), logs: logsOf(hotelIds, since), finds: FIND, trapKinds: TRAP_KINDS };
  }

  function zoneOf_(hotelId, zoneId) {
    var r = Db.get('Rooms', zoneId);
    if (!r || r.hotel_id !== hotelId) throw new Error('المنطقة غير موجودة في هذا الفندق.');
    return r;
  }

  /** المشرف: «متاحة للرش» أو «بلاغ إصابة» على منطقة */
  /** بنود المكافحة الجديدة (آفة أو مادة) تعمل فوراً وتُرسل للمشرف لاعتمادها */
  function addPending_(list, names, by) {
    var have = {}; Db.all('Lists', function (l) { return l.list === list && (l.type === 'pc' || l.type === 'all') && l.status !== 'rejected'; }).forEach(function (l) { have[String(l.ar).trim()] = 1; });
    var nw = []; (names || []).forEach(function (v) { v = String(v || '').trim(); if (v && !have[v]) { have[v] = 1; nw.push(v); } });
    if (nw.length) Db.insertMany('Lists', nw.map(function (v) { return { type: 'pc', list: list, ar: v, en: '', status: 'pending', created_by: by || '', sort: 999 }; }));
    return nw.length;
  }

  function flag(s, d) {
    if (supHotels(s).indexOf(d.hotel_id) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    if (['ready', 'infest'].indexOf(d.kind) === -1) throw new Error('اختر: متاحة للرش أو بلاغ إصابة.');
    var zones = (d.zones && d.zones.length) ? d.zones : [d.zone];
    if (!zones[0]) throw new Error('اختر المنطقة.');
    if (d.kind === 'infest' && !(d.pests || []).length) throw new Error('اختر الآفة.');
    var me = Db.get('Users', s.id) || {};
    var src = Auth.isSup(s.role) ? 'sup' : 'staff';
    if (d.kind === 'ready') d.pests = [];
    var recs = zones.map(function (z) {
      zoneOf_(d.hotel_id, z);
      return { hotel_id: d.hotel_id, zone: z, kind: d.kind, pests: (d.pests || []).join(','), note: String(d.note || '').trim(), photos: (d.photos || []).join(','),
        by_id: s.id, by_name: me.name || '', created_at: new Date(), status: 'open', source: src };
    });
    Db.insertMany('PestFlags', recs);
    addPending_('pest', d.pests, me.name || s.id);
    return recs.length;
  }

  /** بلاغ إصابة من باركود الطلبات (فريق العمل بلا دخول): الدور + الغرفة أو المرفق بالاسم */
  function reqFlag(h, d) {
    var name = String(d.name || '').trim();
    if (name.length < 2) throw new Error('اكتب اسمك.');
    if (!(d.pests || []).length) throw new Error('اختر الآفة.');
    var room = String(d.room || '').trim();
    var z = Db.find('Rooms', function (r) { return r.hotel_id === h.hotel_id && r.floor_id === d.floor_id && String(r.number).trim() === room; });
    if (!z) throw new Error('اختر الغرفة أو المرفق من القائمة.');
    if (!Orders.activeContract(h.hotel_id, 'pc')) throw new Error('لا يوجد عقد مكافحة ساري لهذا الفندق.');
    var rec = Db.insert('PestFlags', { hotel_id: h.hotel_id, zone: z.room_id, kind: 'infest', pests: d.pests.join(','), note: String(d.note || '').trim(),
      photos: (d.photos || []).join(','), by_id: '', by_name: name, created_at: new Date(), status: 'open', source: 'req' });
    return { id: rec.flag_id, zone: String(z.number) };
  }

  /** إجراء تصحيحي على معالجة (بدل الرفض): تبقى محسوبة رشاً، وتُنقص الجاهزية، والمتعهد يرد ثم يتحقق مدير الإشراف */
  function pcCA(s, logId, d) {
    if (['supmgr', 'admin'].indexOf(s.role) === -1) throw new Error('الإجراء التصحيحي لمدير الإشراف أو مشرف النظام.');
    var l = Db.get('PestLogs', logId);
    if (!l || supHotels(s).indexOf(l.hotel_id) === -1) throw new Error('المعالجة ليست ضمن فنادقك.');
    if (Db.find('CorrectiveActions', function (c) { return c.log_id === logId && c.status !== 'closed'; })) throw new Error('على هذه المعالجة إجراء تصحيحي مفتوح.');
    var reason = String(d.reason || '').trim(), req = String(d.required || '').trim();
    if (!reason) throw new Error('اكتب الملاحظة على المعالجة.');
    if (!req) throw new Error('اكتب المطلوب من المتعهد.');
    var zn = (d.zones || []).filter(function (z) { return csv(l.zones).indexOf(z) !== -1; }).map(function (z) { var r = Db.get('Rooms', z); return r ? String(r.number) : z; });
    return Db.insert('CorrectiveActions', { hotel_id: l.hotel_id, con_id: l.con_id, wo_id: '', log_id: logId, reason: reason + (zn.length ? ' (' + zn.join('، ') + ')' : ''), required: req,
      due: '', status: 'open', by: (Db.get('Users', s.id) || {}).name || s.id, created_at: new Date() });
  }

  /** إلغاء بلاغات مفتوحة لعدة مناطق دفعة واحدة (مثل دخول نزلاء قبل الرش) */
  function cancelMany(s, hotelId, zones, kind) {
    if (supHotels(s).indexOf(hotelId) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    var fl = Db.all('PestFlags', function (f) { return f.hotel_id === hotelId && f.status === 'open' && (zones || []).indexOf(f.zone) !== -1 && (!kind || f.kind === kind) && (s.role === 'supmgr' || s.role === 'admin' || f.by_id === s.id); });
    if (!fl.length) throw new Error('لا بلاغات مفتوحة لك في المناطق المحددة.');
    var t = new Date(); fl.forEach(function (f) { Db.update('PestFlags', f.flag_id, { status: 'cancelled', done_at: t }); });
    return fl.length;
  }

  /** الإغلاق اليومي: إتاحة الرش تنتهي بنهاية يومها، وما لم يُرش يُتاح من جديد */
  function expireReady() {
    var d0 = new Date(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') + 'T00:00:00+03:00').getTime(), t = new Date(), n = 0;
    Db.all('PestFlags', function (f) { return f.kind === 'ready' && f.status === 'open' && ms(f.created_at) < d0; }).forEach(function (f) { Db.update('PestFlags', f.flag_id, { status: 'expired', done_at: t }); n++; });
    return n;
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
    var mats = (Array.isArray(d.material) ? d.material : String(d.material || '').split(',')).map(function (x) { return String(x).trim(); }).filter(String);
    if (d.kind === 'spray' && !mats.length) throw new Error('اختر المادة المستخدمة.');
    var t = new Date();
    // يُنجز: بلاغات «متاحة للرش» بالرش، وبلاغات الإصابة بأي معالجة
    var closed = Db.all('PestFlags', function (f) { return f.hotel_id === hotelId && f.status === 'open' && d.zones.indexOf(f.zone) !== -1 && (f.kind === 'infest' || d.kind === 'spray'); });
    var rec = Db.insert('PestLogs', {
      hotel_id: hotelId, con_id: con.con_id, zones: d.zones.join(','), kind: d.kind, pests: (d.pests || []).join(','), material: d.kind === 'spray' ? mats.join(',') : '',
      finding: d.finding, note: String(d.note || '').trim(), photos: (d.photos || []).join(','), by_name: String(d.tech || '').trim() || (s.lead_name ? s.lead_name + ' (قائد الفريق)' : con.name), at: t,
      flags_closed: closed.map(function (f) { return f.flag_id; }).join(',')
    });
    closed.forEach(function (f) { Db.update('PestFlags', f.flag_id, { status: 'done', done_at: t, done_log: rec.log_id }); });
    // بنود جديدة (آفة أو مادة): تعمل فوراً وتنتظر اعتماد المشرف
    var added = addPending_('pest', d.pests, con.name) + addPending_('material', mats, con.name);
    return { id: rec.log_id, flags: closed.length, added: added };
  }

  /** المصائد. place {hotel_id, zone, kind, every_days} · check {trap_id, result, note} · remove {trap_id} */
  function trap(s, action, d) {
    var t = new Date();
    if (action === 'place') {
      var hotelId = d.hotel_id || s.hotel_id, con = pcCon_(s, hotelId);
      var zs = (d.zones && d.zones.length) ? d.zones : [d.zone];
      zs.forEach(function (z) { zoneOf_(hotelId, z); });
      if (TRAP_KINDS.indexOf(d.kind) === -1) throw new Error('اختر نوع المصيدة.');
      var every = trapEvery(hotelId);
      var n = Db.all('Traps', function (x) { return x.hotel_id === hotelId; }).length;
      // مصيدة في كل منطقة محددة، بترقيم متتابع
      var recs = Db.insertMany('Traps', zs.map(function (z) { n++;
        return { hotel_id: hotelId, zone: z, label: 'T-' + (n < 10 ? '0' : '') + n, kind: d.kind, placed_at: t, every_days: every,
          last_check: '', last_result: '', removed_at: '', status: 'active', by_name: con.name }; }));
      var labels = zs.map(function (z, i) { return 'T-' + (n - zs.length + i + 1 < 10 ? '0' : '') + (n - zs.length + i + 1); });
      return { id: recs && recs[0] ? recs[0].trap_id : '', label: labels[0], labels: labels };
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
    if (action === 'replace') {
      // استبدال المصيدة (رصد حالة): تبقى بنفس الرقم ويبدأ موعد فحصها من جديد
      Db.update('Traps', tr.trap_id, { last_check: t, last_result: 'استُبدلت' });
      Db.insert('PestLogs', { hotel_id: tr.hotel_id, con_id: c2.con_id, zones: tr.zone, kind: 'trap', trap_id: tr.trap_id, pests: '', material: '',
        finding: 'none', note: 'استبدال' + (d.note ? ' · ' + String(d.note).trim() : ''), photos: '', by_name: c2.name, at: t, flags_closed: '' });
      return {};
    }
    if (action === 'remove') { Db.update('Traps', tr.trap_id, { status: 'removed', removed_at: t }); return {}; }
    throw new Error('إجراء غير معروف.');
  }

  /** مدير الإشراف: دورية الرش لكل نوع مرفق. rows: {ftype: days} */
  function saveSchedule(s, hotelId, rows) {
    if (s.role !== 'supmgr' && s.role !== 'admin') throw new Error('الجدولة لمدير الإشراف.');
    if (supHotels(s).indexOf(hotelId) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    if (rows && rows[TRAP_KEY] !== undefined) {
      var tv = String(rows[TRAP_KEY]).trim(), tn = tv === '' ? TRAP_MAX : Number(tv);
      if (isNaN(tn) || tn < 1 || tn > TRAP_MAX || Math.floor(tn) !== tn) throw new Error('دورية فحص المصائد من يوم إلى ' + TRAP_MAX + ' أيام.');
      var tk = hotelId + '|' + TRAP_KEY;
      if (Db.find('PestSchedule', function (r) { return r.key === tk; })) Db.update('PestSchedule', tk, { every_days: tn, per_month: 0 });
      else Db.insert('PestSchedule', { key: tk, hotel_id: hotelId, ftype: TRAP_KEY, every_days: tn, per_month: 0 });
    }
    Object.keys(rows || {}).filter(function (ft) { return ft !== TRAP_KEY; }).forEach(function (ft) {
      var raw = rows[ft], isQ = raw && typeof raw === 'object', v = String(isQ ? raw.pm : raw).trim(), n = v === '' ? 0 : Number(v);
      if (isQ && (isNaN(n) || n < 0 || n > 31)) throw new Error('مرات الرش في الشهر بين 1 و31، أو فارغة: ' + ft);
      if (!isQ && (isNaN(n) || n < 0 || n > 365)) throw new Error('الدورية بالأيام بين 1 و365، أو فارغة لغير المجدول: ' + ft);
      var key = hotelId + '|' + ft, rec = isQ ? { every_days: 0, per_month: n } : { every_days: n, per_month: 0 };
      if (Db.find('PestSchedule', function (r) { return r.key === key; })) Db.update('PestSchedule', key, rec);
      else { rec.key = key; rec.hotel_id = hotelId; rec.ftype = ft; Db.insert('PestSchedule', rec); }
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

  /** رضا الإشراف الشهري في الفترة (متوسط من 100) */
  function ratingIn_(conId, hotelIds, from, to) {
    var m1 = from.slice(0, 7), m2 = to.slice(0, 7);
    var rs = Db.all('SupRatings', function (r) { var m = mon_(r.month); return r.con_id === conId && hotelIds.indexOf(r.hotel_id) !== -1 && m >= m1 && m <= m2; });
    return { v: rs.length ? Math.round(10 * rs.reduce(function (a, r) { return a + Number(r.score); }, 0) / rs.length) / 10 : null, n: rs.length };
  }
  /** مؤشرات المتعهد في الفترة [from, to] (تواريخ yyyy-MM-dd) لفنادق محددة */
  function metrics(con, hotelIds, from, to) {
    // لا يُحسب ما قبل بداية القياس (تهيئة الإطلاق، أو بداية القياس في العقد)
    var lfS = Utilities.formatDate(new Date(Kpi.liveFrom(con.con_id, hotelIds)), TZ, 'yyyy-MM-dd');
    if (lfS > from) from = lfS;
    var a = new Date(from + 'T00:00:00').getTime(), b = new Date(to + 'T23:59:59').getTime(), days = Math.max(1, Math.round((b - a) / 864e5));
    var inR = function (t) { t = ms(t); return t >= a && t <= b; };
    var V = {}, X = {}, N = {};
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
      var allV = Db.all('WasteVisits', function (v) { return hotelIds.indexOf(v.hotel_id) !== -1 && inR(v.at); });
      V.visitsOk = allV.length ? pct_(vs.length, allV.length) : null;
      var rt = ratingIn_(con.con_id, hotelIds, from, to); V.rating = rt.v;
      N = { pickup: exp, clean: rated.length, wash: came.length, visitsOk: allV.length, rating: rt.n };
      X = { visits: vs.length, done: done, expected: exp, missed: Math.max(0, exp - done), noTruck: vs.length - came.length, leftMax: vs.reduce(function (m, v) { return Math.max(m, Number(v.left_carts) || 0); }, 0) };
    } else if (con.type === 'pc') {
      var expS = 0, gotS = 0;
      hotelIds.forEach(function (h) {
        var sch = schedule(h), sprays = {}, hd = cdays(h);
        Db.all('PestLogs', function (l) { return l.hotel_id === h && l.kind === 'spray' && l.status !== 'rejected' && inR(l.at); }).forEach(function (l) { okZones_(l).forEach(function (z) { sprays[z] = (sprays[z] || 0) + 1; }); });
        var floors = {}; Db.all('Floors', function (f) { return f.hotel_id === h; }).forEach(function (f) { floors[f.floor_id] = f; });
        Db.all('Rooms', function (r) { return r.hotel_id === h; }).forEach(function (r) {
          var ft = r.ftype || (isFacility_(r, floors[r.floor_id]) ? '' : GUEST), ev = sch[ft];
          if (!ev) return;
          var e = Math.floor(hd / ev); if (!e) return; expS += e; gotS += Math.min(e, sprays[r.room_id] || 0);
        });
      });
      // غرف النزلاء (مرات في الشهر): الاستجابة = إكمال الاستحقاق الشهري (حد أدنى)، للأشهر المنتهية، بنسبة أيام العقد والقياس في الشهر
      var qExp = 0, qGot = 0, curM = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
      var cov = function (h, s0, e0) {
        var n = 0;
        Db.all('Contracts', function (c) { return c.con_id === con.con_id && csv(c.hotel_ids).indexOf(h) !== -1; }).forEach(function (c) {
          var x0 = Math.max(s0, c.start ? ms(c.start) : s0), x1 = Math.min(e0, c.end ? ms(c.end) + 864e5 - 1 : e0);
          n += Math.max(0, (x1 - x0) / 864e5);
        });
        return n;
      };
      hotelIds.forEach(function (h) {
        var qt = quotas(h); if (!Object.keys(qt).length) return;
        var zt = {}, floors = {}; Db.all('Floors', function (f) { return f.hotel_id === h; }).forEach(function (f) { floors[f.floor_id] = f; });
        Db.all('Rooms', function (r) { return r.hotel_id === h; }).forEach(function (r) { var t = r.ftype || (isFacility_(r, floors[r.floor_id]) ? '' : GUEST); if (qt[t]) zt[r.room_id] = Number(qt[t]) || 0; });
        var rooms = Object.keys(zt); if (!rooms.length) return;
        var cnt = {};
        Db.all('PestLogs', function (l) { return l.hotel_id === h && l.kind === 'spray' && l.status !== 'rejected' && inR(l.at); }).forEach(function (l) {
          var m = Utilities.formatDate(new Date(ms(l.at)), TZ, 'yyyy-MM'); okZones_(l).forEach(function (z) { var k = z + '|' + m; cnt[k] = (cnt[k] || 0) + 1; });
        });
        for (var mq = from.slice(0, 7); mq <= to.slice(0, 7) && mq < curM; mq = Utilities.formatDate(new Date(new Date(mq + '-15T12:00:00+03:00').getTime() + 31 * 864e5), TZ, 'yyyy-MM')) {
          var m0 = new Date(mq + '-01T00:00:00+03:00').getTime(), m1 = new Date(new Date(mq + '-15T12:00:00+03:00').getTime() + 31 * 864e5);
          m1 = new Date(Utilities.formatDate(m1, TZ, 'yyyy-MM') + '-01T00:00:00+03:00').getTime() - 1;
          var fr = cov(h, Math.max(a, m0), Math.min(b, m1)) / ((m1 + 1 - m0) / 864e5);
          if (fr <= 0) continue;
          rooms.forEach(function (r) { var e = zt[r] * Math.min(1, fr); qExp += e; qGot += Math.min(e, cnt[r + '|' + mq] || 0); });
        }
      });
      V.quota = qExp ? Math.min(100, pct_(qGot, qExp)) : null; N.quota = Math.round(qExp);
      var fl = Db.all('PestFlags', function (f) { return hotelIds.indexOf(f.hotel_id) !== -1 && inR(f.created_at) && f.status !== 'cancelled'; });
      var dn = fl.filter(function (f) { return f.status === 'done'; });
      var tl = Db.all('PestLogs', function (l) { return hotelIds.indexOf(l.hotel_id) !== -1 && l.kind === 'trap' && l.status !== 'rejected' && inR(l.at); }).length;
      var tExp = 0;
      Db.all('Traps', function (t) { return hotelIds.indexOf(t.hotel_id) !== -1 && ms(t.placed_at) <= b && (t.status === 'active' || ms(t.removed_at) >= a); }).forEach(function (t) {
        var s0 = Math.max(a, ms(t.placed_at)), e0 = t.status === 'active' ? b : Math.min(b, ms(t.removed_at));
        tExp += Math.floor(Math.max(0, e0 - s0) / (trapEvery(t.hotel_id) * 864e5));
      });
      V.ontime = expS ? pct_(gotS, expS) : null;
      var slaH = 24; Db.all('Contracts', function (c) { return c.con_id === con.con_id; }).forEach(function (c) { if (Number(c.sla_pest) > 0) slaH = Number(c.sla_pest); });
      var due = fl.filter(function (f) { return f.kind === 'infest' && (f.status === 'done' || ms(f.created_at) + slaH * 36e5 < Date.now()); });
      V.flagresp = due.length ? pct_(due.filter(function (f) { return f.status === 'done' && ms(f.done_at) - ms(f.created_at) <= slaH * 36e5; }).length, due.length) : null;
      N.flagresp = due.length; N.ontime = expS; N.traps = tExp;
      var allL = Db.all('PestLogs', function (l) { return l.con_id === con.con_id && hotelIds.indexOf(l.hotel_id) !== -1 && inR(l.at); });
      // الموثوقية لكل منطقة في المعالجة: المرفوض جزئياً يُحسب بمناطقه
      var zAll = 0, zOk = 0; allL.forEach(function (l) { var n = l.kind === 'trap' ? 1 : (csv(l.zones).length || 1); zAll += n; zOk += l.kind === 'trap' ? (l.status === 'rejected' ? 0 : 1) : okZones_(l).length; });
      V.logsOk = zAll ? pct_(zOk, zAll) : null; N.logsOk = zAll;
      // الجاهزية: المعالجات بلا إجراء تصحيحي
      var caLog = {}; Db.all('CorrectiveActions', function (c) { return c.con_id === con.con_id && c.log_id; }).forEach(function (c) { caLog[c.log_id] = 1; });
      var trt = allL.filter(function (l) { return l.kind !== 'trap' && l.status !== 'rejected'; });
      V.caok = trt.length ? pct_(trt.filter(function (l) { return !caLog[l.log_id]; }).length, trt.length) : null; N.caok = trt.length;
      // التقرير الشهري: لكل شهر انتهى داخل الفترة ولكل فندق كان فيه عقد
      var need = 0, got = 0, pm0 = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
      for (var mm = from.slice(0, 7); mm <= to.slice(0, 7) && mm < pm0; mm = Utilities.formatDate(new Date(new Date(mm + '-15T12:00:00+03:00').getTime() + 31 * 864e5), TZ, 'yyyy-MM')) {
        activeIn_(mm, ['pc'], hotelIds).forEach(function (x) { if (x.con !== con.con_id) return; need++; if (Db.all('PcReports', function (r) { return r.con_id === con.con_id && r.hotel_id === x.hotel && mon_(r.month) === mm; }).length) got++; });
      }
      V.reports = need ? pct_(got, need) : null; N.reports = need;
      var rt2 = ratingIn_(con.con_id, hotelIds, from, to); V.rating = rt2.v; N.rating = rt2.n;
      X.flagAvgH = dn.length ? Math.round(dn.reduce(function (s, f) { return s + (ms(f.done_at) - ms(f.created_at)) / 36e5; }, 0) / dn.length) : ''; X.slaH = slaH;
      V.traps = tExp ? Math.min(100, pct_(tl, tExp)) : null;
      X = { flagAvgH: X.flagAvgH, slaH: X.slaH, sprays: gotS, expected: expS, flags: fl.length, infest: fl.filter(function (f) { return f.kind === 'infest'; }).length, open: fl.filter(function (f) { return f.kind === 'infest' && f.status === 'open'; }).length, trapChecks: tl, trapExpected: tExp, quotaGot: Math.round(qGot), quotaExp: Math.round(qExp), caLogs: trt.length - (V.caok == null ? 0 : Math.round(V.caok * trt.length / 100)) };
    } else {
      var m1 = from.slice(0, 7), m2 = to.slice(0, 7);
      var z = { respSum: 0, respN: 0, respOk: 0, readyOk: 0, readyN: 0, infoOk: 0, infoN: 0, satSum: 0, satN: 0, orders: 0, closed: 0, pm: 0, trapped: 0, clSum: 0, clN: 0, repairN: 0, repairOk: 0, rescueN: 0, rescueOk: 0, rescueSum: 0 };
      Db.all('KpiSummary', function (r) { var k = String(r.key).split('|'); return k[0] === con.con_id && hotelIds.indexOf(k[1]) !== -1 && k[2] >= m1 && k[2] <= m2; }).forEach(function (r) {
        var d = r.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
        Object.keys(z).forEach(function (k) { z[k] += Number(d[k]) || 0; });
      });
      var pmExp = 0;
      if (con.type === 'el') hotelIds.forEach(function (h) { pmExp += cdays(h, 'pm_per_month') * 7 / 30; });
      pmExp = Math.round(pmExp);
      var vv = Kpi.values(z, pmExp), KS = Kpi.subsOf(con.type);
      KS.forEach(function (k) { V[k] = vv.V[k]; N[k] = vv.N[k]; });
      X = { respAvg: z.respN ? Math.round(z.respSum / z.respN) + ' د' : '', rescueAvg: z.rescueN ? Math.round(z.rescueSum / z.rescueN) + ' د' : '', pmExp: con.type === 'el' ? pmExp : '', orders: z.orders, closed: z.closed, pm: z.pm, trapped: z.trapped, claim: z.clN ? Math.round(z.clSum / z.clN) + ' د' : '', respN: z.respN, readyN: z.readyN, infoN: z.infoN, satN: z.satN, months: m1 === m2 ? m1 : m1 + ' — ' + m2 };
    }
    var cas = Db.all('CorrectiveActions', function (c) { return c.con_id === con.con_id && hotelIds.indexOf(c.hotel_id) !== -1 && inR(c.created_at); });
    X.ca = cas.length; X.caOpen = cas.filter(function (c) { return c.status !== 'closed'; }).length;
    X.caNot = cas.filter(function (c) { return Number(c.rounds) > 0; }).length;
    var th = Kpi.thresholds()[con.type] || {}, sc = Kpi.score(con.type, V, N, th), cl = Kpi.clsOf(con.con_id);
    var c2 = { cls_ex: cl.ex, cls_good: cl.good, cls_ok: cl.ok }, C = {};
    Object.keys(sc.P).forEach(function (k) { C[k] = Kpi.cls(sc.P[k].v, c2); });
    return { V: V, N: N, P: sc.P, X: X, score: sc.score, small: sc.small, used: sc.used, cls: Kpi.cls(sc.score, c2), C: C, bands: cl, th: th, days: days };
  }

  /** كشف المكافحة أو النفايات لمتعهد في فترة: الملخص من metrics والتفاصيل من السجل */
  function statement(scope, conId, hotelId, from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to)) || to < from) throw new Error('حدّد الفترة: من تاريخ إلى تاريخ.');
    var con = Db.get('Contractors', conId);
    if (!con || (con.type !== 'wa' && con.type !== 'pc')) throw new Error('المتعهد غير موجود.');
    var mine = {}; Db.all('Contracts', function (c) { return c.con_id === conId; }).forEach(function (c) { csv(c.hotel_ids).forEach(function (h) { mine[h] = 1; }); });
    var hs = scope.filter(function (h) { return mine[h] && (!hotelId || hotelId === 'all' || h === hotelId); });
    if (!hs.length) throw new Error('لا فنادق لهذا المتعهد ضمن نطاقك.');
    var a = new Date(from + 'T00:00:00+03:00').getTime(), b = new Date(to + 'T23:59:59+03:00').getTime();
    var hn = {}; Db.all('Hotels').forEach(function (h) { hn[h.hotel_id] = h.name; });
    var m = metrics(con, hs, from, to), rows;
    if (con.type === 'wa') {
      rows = waVisits(hs, a).filter(function (v) { return v.at <= b; }).map(function (v) { v.hotel = hn[v.hotel_id] || ''; delete v.photos; delete v.dist; return v; }).reverse();
    } else {
      rows = logsOf(hs, a).filter(function (l) { return l.at <= b; }).map(function (l) { l.hotel = hn[l.hotel_id] || ''; return l; }).reverse();
    }
    return { con: { id: conId, name: con.name, type: con.type }, from: from, to: to, hotels: hs.map(function (h) { return hn[h] || h; }), V: m.V, X: m.X, score: m.score, rows: rows };
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
      data: { type: sc.con.type, V: m.V, N: m.N, P: m.P, used: m.used, X: m.X, th: m.th, days: m.days, cls: m.cls, C: m.C, bands: m.bands, small: m.small }, score: m.score == null ? '' : m.score, decision: decision, note: String(note || '').trim(),
      by: me.name || '', by_role: s.role, created_at: new Date() });
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
        by: e.by, byRole: e.by_role || '', created: ms(e.created_at) };
    }).sort(function (a, b) { return b.created - a.created; });
  }

  return {
    statement: statement, pcReject: pcReject, pcCA: pcCA, cancelMany: cancelMany, team: team, setTeam: setTeam, pestMsg: pestMsg, pestMsgDone: pestMsgDone, pestMsgs: pestMsgs, CASE_TYPES: CASE_TYPES, expireReady: expireReady, ratesDue: ratesDue, rate: rate, reportsDue: reportsDue, pcReport: pcReport, geoCheck: geoCheck, parseGeo: parseGeo, hasGeo: hasGeo_, supHotels: supHotels,
    waLogin: waLogin, waBoot: waBoot, waSubmit: waSubmit, waVisits: waVisits, waReject: waReject, waContract: waContract,
    pestBoot: pestBoot, pestState: pestState, flag: flag, reqFlag: reqFlag, cancelFlag: cancelFlag, log: log, trap: trap, saveSchedule: saveSchedule, setZoneType: setZoneType,
    metrics: metrics, evalPreview: evalPreview, evalIssue: evalIssue, evalList: evalList, canEval: canEval_, FIND: FIND, TRAP_KINDS: TRAP_KINDS
  };
})();
