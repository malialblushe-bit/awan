/**
 * Water.js — أعوان: متعهد شاحنات المياه (نوع wt).
 *  - باركود لكل فندق ?h=CODE&m=wt: السائق يكتب الرقم السري للشركة، ثم اسمه والحجم ورقم السند وصورته (اختيارية).
 *  - الموقع إلزامي: بلا إحداثيات للفندق لا يُقبل التسجيل.
 *  - الأحجام وأسعارها في عقد المتعهد (Contracts.prices: الحجم بالمتر المكعب ← ريال). السائق لا يرى سعراً.
 *  - المطابقة من مدير الفندق أو المدير المناوب (أو مشرف النظام): اعتماد أو رفض بسبب. الكشف للمعتمد فقط بتاريخ التفريغ.
 */
var Water = (function () {
  var TZ = 'Asia/Riyadh';
  var DUP_MIN = 20;
  var MATCH_ROLES = ['gm', 'duty', 'admin'];

  function ms(d) { return Orders.ms(d); }
  function day_(t) { return t ? Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd') : ''; }
  function contract(hotelId) { return Orders.activeContract(hotelId, 'wt'); }
  /** الأحجام من العقد: مفاتيح رقمية (م³) */
  function sizes_(c) {
    var p = pricesOf_(c);
    return Object.keys(p).filter(function (k) { return Number(k) > 0; }).map(Number).sort(function (a, b) { return a - b; });
  }
  function needGeo_(h, geo) {
    if (!Ops.hasGeo(h)) throw new Error('لم يُحدَّد موقع الفندق بعد، فلا يُقبل التسجيل. اطلب من مشرف النظام تحديده.');
    return Ops.geoCheck(h, geo);
  }

  function login(code, pin, geo) {
    var h = Orders.hotelByCode(code);
    if (!Ops.hasGeo(h)) throw new Error('لم يُحدَّد موقع الفندق بعد، فلا يُقبل التسجيل. اطلب من مشرف النظام تحديده.');
    var r = Auth.conLogin(h, pin);
    if (r.con.type !== 'wt' || !Orders.activeContract(h.hotel_id, 'wt', r.con.con_id)) { Auth.logout(r.token); throw new Error('هذا الباركود لمتعهد شاحنات المياه فقط.'); }
    try { needGeo_(h, geo); } catch (e) { Auth.logout(r.token); throw e; }
    return { token: r.token, name: r.con.name };
  }

  function boot(h) {
    var c = contract(h.hotel_id);
    var last = Db.all('WaterLoads', function (v) { return v.hotel_id === h.hotel_id; }).sort(function (a, b) { return ms(b.at) - ms(a.at); })[0];
    return {
      hotel: { code: h.code, name: h.name, geo: Ops.hasGeo(h), brand: h.brand || 'nawazi' },
      con: c ? ((Db.get('Contractors', c.con_id) || {}).name || '') : '', sizes: c ? sizes_(c) : [],
      last: last ? { at: ms(last.at), driver: last.driver, size: Number(last.size) || 0 } : null
    };
  }

  /** d: {driver, size, receipt, note, photos} */
  function submit(s, code, d, geo) {
    var h = Orders.hotelByCode(code);
    var con = Db.get('Contractors', s.id);
    if (s.role !== 'contractor' || !con || con.type !== 'wt' || s.hotel_id !== h.hotel_id) throw new Error('هذا الباركود لمتعهد شاحنات المياه فقط.');
    var c = Orders.activeContract(h.hotel_id, 'wt', con.con_id);
    if (!c) throw new Error('لا يوجد عقد ساري لهذا الفندق.');
    var g = needGeo_(h, geo);
    var driver = String(d.driver || '').trim();
    if (driver.length < 2) throw new Error('اكتب اسم السائق.');
    var size = Number(d.size);
    if (sizes_(c).indexOf(size) === -1) throw new Error('اختر حجم النقلة.');
    var receipt = String(d.receipt || '').trim();
    var mine = Db.all('WaterLoads', function (v) { return v.con_id === con.con_id; });
    if (receipt) {
      var same = mine.filter(function (v) { return String(v.receipt_no).trim() === receipt && v.status !== 'rejected'; })[0];
      if (same) throw new Error('رقم السند ' + receipt + ' مسجّل من قبل (' + Utilities.formatDate(new Date(same.at), TZ, 'dd/MM HH:mm') + ').');
    }
    var now = Date.now();
    var near = mine.filter(function (v) { return v.hotel_id === h.hotel_id && v.status !== 'rejected' && now - ms(v.at) < DUP_MIN * 60000; });
    var v = Db.insert('WaterLoads', {
      hotel_id: h.hotel_id, con_id: con.con_id, at: new Date(now), driver: driver, size: size, receipt_no: receipt,
      photos: (d.photos || []).join(','), note: String(d.note || '').trim(), status: 'pending', dup: near.length ? true : '',
      lat: g.lat || '', lng: g.lng || '', acc: g.acc || '', dist: g.dist
    });
    return { id: v.load_id, dup: near.length ? Math.round((now - ms(near[near.length - 1].at)) / 60000) : null };
  }

  function view_(v, R) {
    return { id: v.load_id, hotel_id: v.hotel_id, hotel: (R.hotels[v.hotel_id] || {}).name || '', con_id: v.con_id, con: (R.cons[v.con_id] || {}).name || '',
      at: ms(v.at), driver: v.driver, size: Number(v.size) || 0, receipt: String(v.receipt_no || ''), photos: Orders.csv(v.photos), note: v.note || '',
      status: v.status, dup: Orders.truthy(v.dup), by: v.match_by || '', matched: ms(v.match_at) || null, reason: v.reason || '', dist: v.dist === '' ? null : Number(v.dist) };
  }

  /** لوحة الفريق: المعلّق كله + آخر 40 يوماً، واستهلاك 6 أشهر لكل فندق. null إن لا عقد مياه في النطاق */
  function staffBoot(s, hotelIds) {
    var R = Orders.refs();
    var has = R.contracts.some(function (c) { return c.type === 'wt' && Orders.csv(c.hotel_ids).some(function (h) { return hotelIds.indexOf(h) !== -1; }); });
    if (!has) return null;
    var since = Date.now() - 40 * 864e5, from6 = Date.now() - 190 * 864e5, vol = {};
    var all = Db.all('WaterLoads', function (v) { return hotelIds.indexOf(v.hotel_id) !== -1 && ms(v.at) >= from6; });
    all.forEach(function (v) {
      if (v.status === 'rejected') return;
      var m = Utilities.formatDate(new Date(v.at), TZ, 'yyyy-MM'), k = v.hotel_id;
      vol[k] = vol[k] || {}; vol[k][m] = (vol[k][m] || 0) + (Number(v.size) || 0);
    });
    var cons = {};
    R.contracts.forEach(function (c) { if (c.type === 'wt' && Orders.csv(c.hotel_ids).some(function (h) { return hotelIds.indexOf(h) !== -1; })) cons[c.con_id] = { id: c.con_id, name: (R.cons[c.con_id] || {}).name || '' }; });
    return {
      canMatch: MATCH_ROLES.indexOf(s.role) !== -1,
      loads: all.filter(function (v) { return v.status === 'pending' || ms(v.at) >= since; }).map(function (v) { return view_(v, R); }).sort(function (a, b) { return b.at - a.at; }),
      vol: vol, cons: Object.keys(cons).map(function (k) { return cons[k]; })
    };
  }

  /** المتعهد: نقلاته في آخر 35 يوماً بحالتها (بلا أسعار) */
  function conList(conId) {
    var R = Orders.refs(), since = Date.now() - 35 * 864e5;
    return Db.all('WaterLoads', function (v) { return v.con_id === conId && ms(v.at) >= since; }).map(function (v) {
      var x = view_(v, R); delete x.dist; delete x.dup; return x;
    }).sort(function (a, b) { return b.at - a.at; });
  }

  /** اعتماد أو رفض نقلة أو أكثر */
  function match(s, ids, ok, reason, scope) {
    if (MATCH_ROLES.indexOf(s.role) === -1) throw new Error('المطابقة لمدير الفندق أو المدير المناوب.');
    reason = String(reason || '').trim();
    if (!ok && !reason) throw new Error('اكتب سبب الرفض.');
    var me = Db.get('Users', s.id) || {}, n = 0;
    (ids || []).forEach(function (id) {
      var v = Db.get('WaterLoads', id);
      if (!v || scope.indexOf(v.hotel_id) === -1) throw new Error('النقلة ليست ضمن فنادقك.');
      if (v.status !== 'pending') return;
      Db.update('WaterLoads', id, { status: ok ? 'approved' : 'rejected', match_by: me.name || '', match_role: s.role, match_at: new Date(), reason: ok ? '' : reason });
      n++;
    });
    return n;
  }

  /** كشف النقلات المعتمدة بتاريخ التفريغ × سعر العقد لذلك الفندق */
  function statement(scope, conId, hotelId, from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to)) || to < from) throw new Error('حدّد الفترة: من تاريخ إلى تاريخ.');
    var R = Orders.refs(), con = R.cons[conId];
    if (!con || con.type !== 'wt') throw new Error('المتعهد غير موجود.');
    if (hotelId && hotelId !== 'all') scope = scope.filter(function (h) { return h === hotelId; });
    var price = function (v) {
      var best = null, t = ms(v.at);
      R.contracts.forEach(function (c) {
        if (c.con_id !== conId || c.type !== 'wt' || Orders.csv(c.hotel_ids).indexOf(v.hotel_id) === -1) return;
        var fits = t >= (ms(c.start) || 0) && t <= (ms(c.end) || 9e15) + 864e5;
        if (!best || (fits && !best.fits) || (fits === best.fits && ms(c.created_at) > ms(best.c.created_at))) best = { c: c, fits: fits };
      });
      var p = best ? pricesOf_(best.c)[String(Number(v.size))] : null;
      return p == null || p === '' ? null : Number(p);
    };
    var inR = function (v) { var d = day_(v.at); return v.con_id === conId && scope.indexOf(v.hotel_id) !== -1 && d >= from && d <= to; };
    var all = Db.all('WaterLoads', inR).sort(function (a, b) { return ms(a.at) - ms(b.at); });
    var lines = {}, rows = [];
    all.filter(function (v) { return v.status === 'approved'; }).forEach(function (v) {
      var sz = Number(v.size) || 0, pr = price(v), k = sz + '|' + (pr == null ? '' : pr);
      var L = lines[k] || (lines[k] = { size: sz, qty: 0, price: pr });
      L.qty++;
      var x = view_(v, R); x.price = pr; rows.push(x);
    });
    var list = Object.keys(lines).map(function (k) { var L = lines[k]; L.vol = L.size * L.qty; L.total = L.price == null ? null : Math.round(L.price * L.qty * 100) / 100; return L; })
      .sort(function (a, b) { return a.size - b.size; });
    return {
      con: { id: conId, name: con.name }, from: from, to: to,
      hotels: scope.map(function (h) { return (R.hotels[h] || {}).name || h; }),
      lines: list, rows: rows,
      count: rows.length, vol: list.reduce(function (a, L) { return a + L.vol; }, 0),
      total: Math.round(list.reduce(function (a, L) { return a + (L.total || 0); }, 0) * 100) / 100,
      missing: list.filter(function (L) { return L.price == null; }).length,
      pending: all.filter(function (v) { return v.status === 'pending'; }).length,
      rejected: all.filter(function (v) { return v.status === 'rejected'; }).length
    };
  }

  return { login: login, boot: boot, submit: submit, staffBoot: staffBoot, conList: conList, match: match, statement: statement, MATCH_ROLES: MATCH_ROLES };
})();
