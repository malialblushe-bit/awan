/**
 * Tickets.js — أعوان: «تواصل» مع المتعهدين في الاتجاهين (متطلبات الأيزو).
 *  - المتعهد يرفع اقتراحاً أو رأياً أو شكوى. المالك حسب الخدمة: المهندس (تكييف/مصاعد/سلامة) · مدير الإشراف (نفايات/مكافحة) · مدير الفندق (المياه).
 *  - المالك يفيد خلال يوم عمل، والرد المتكامل مع الإجراء المتخذ والإغلاق من الإدارة خلال يومي عمل.
 *    المياه: مدير الفندق يرد ويغلق، ويُصعَّد لمدير التشغيل إن تأخر.
 *  - المتعهد يقيّم الرد؛ «غير راضٍ» يعيدها مرة واحدة للإدارة.
 *  - تقييم المتعهد لمؤسستنا شهرياً لكل فندق (OrgEvals).
 */
var Tickets = (function () {
  var TZ = 'Asia/Riyadh';
  var TYPES = { suggest: 'اقتراح', opinion: 'رأي', complaint: 'شكوى' };
  var TOPICS = ['الطلبات والإسناد', 'الوصول والتنسيق في الفندق', 'تعاون فريق العمل', 'نظام أعوان', 'أخرى'];
  var CRIT = [['clarity', 'وضوح الطلبات ودقة المعلومات'], ['speed', 'سرعة القرار والمطابقة'], ['access', 'تسهيل الوصول والتنسيق في الموقع'],
    ['team', 'تعاون فريق العمل واحترامه'], ['commit', 'الوفاء بالالتزامات'], ['comm', 'جودة التواصل والرد'], ['system', 'سهولة نظام أعوان']];
  var CLOSERS = ['admin', 'management'];

  function ms(d) { return Orders.ms(d); }
  function ownerOf(type) { return type === 'wa' || type === 'pc' ? 'supmgr' : type === 'wt' ? 'gm' : 'engineer'; }
  /** يضيف أيام عمل (الأحد–الخميس) بتوقيت الرياض */
  function addWork(t, n) {
    var d = new Date(t), k = 0;
    while (k < n) { d = new Date(d.getTime() + 864e5); var wd = Number(Utilities.formatDate(d, TZ, 'u')); if (wd !== 5 && wd !== 6) k++; }
    return d;
  }
  function conHotels_(conId) {
    var out = [];
    Orders.refs().contracts.forEach(function (c) { if (c.con_id === conId) Orders.csv(c.hotel_ids).forEach(function (h) { if (out.indexOf(h) === -1) out.push(h); }); });
    return out;
  }

  function create(conId, d, byName) {
    var con = Db.get('Contractors', conId);
    if (!con) throw new Error('المتعهد غير موجود.');
    if (!TYPES[d.type]) throw new Error('اختر: اقتراح أو رأي أو شكوى.');
    if (TOPICS.indexOf(d.topic) === -1) throw new Error('اختر الموضوع.');
    var text = String(d.text || '').trim();
    if (text.length < 5) throw new Error('اكتب التفاصيل.');
    var hid = String(d.hotel_id || '');
    if (hid && conHotels_(conId).indexOf(hid) === -1) throw new Error('الفندق ليس ضمن عقودك.');
    var now = new Date();
    var r = Db.insert('Tickets', { con_id: conId, hotel_id: hid, type: d.type, topic: d.topic, wo_id: String(d.wo_id || '').trim(), text: text,
      photos: (d.photos || []).join(','), by_name: String(byName || con.name), created_at: now, owner: ownerOf(con.type),
      resp_due: addWork(now, 1), close_due: addWork(now, 2), status: 'new' });
    return r.ticket_id;
  }

  /** نطاق رؤية المستخدم: تذاكر متعهدين يعملون في فنادقه، والمالك يرى خدمته فقط */
  function visibleTo(s, myHotels) {
    var R = Orders.refs();
    return Db.all('Tickets').filter(function (t) {
      var hs = t.hotel_id ? [t.hotel_id] : conHotels_(t.con_id);
      if (s.role !== 'admin' && s.role !== 'management' && !hs.some(function (h) { return myHotels.indexOf(h) !== -1; })) return false;
      if (s.role === 'engineer') return t.owner === 'engineer';
      if (s.role === 'supmgr') return t.owner === 'supmgr';
      return true;
    }).map(function (t) { return view(t, R); }).sort(function (a, b) { return b.created - a.created; });
  }
  function forCon(conId) { var R = Orders.refs(); return Db.all('Tickets', function (t) { return t.con_id === conId; }).map(function (t) { return view(t, R); }).sort(function (a, b) { return b.created - a.created; }); }

  function view(t, R) {
    var now = Date.now(), open = t.status !== 'closed';
    return { id: t.ticket_id, con: (R.cons[t.con_id] || {}).name || '', conType: (R.cons[t.con_id] || {}).type || '', hotel_id: t.hotel_id, hotel: (R.hotels[t.hotel_id] || {}).name || '',
      type: t.type, typeL: TYPES[t.type], topic: t.topic, wo: t.wo_id || '', text: t.text, photos: Orders.csv(t.photos), by: t.by_name, created: ms(t.created_at),
      owner: t.owner, status: t.status, note: t.owner_note || '', noteBy: t.owner_by || '', noteAt: ms(t.owner_at) || null,
      reply: t.reply || '', action: t.action || '', accepted: t.accepted || '', closedBy: t.closed_by || '', closedAt: ms(t.closed_at) || null,
      sat: t.sat || '', satNote: t.sat_note || '', reopened: Orders.truthy(t.reopened),
      respLate: open && !t.owner_note && !t.reply && now > ms(t.resp_due), closeLate: open && now > ms(t.close_due), closeDue: ms(t.close_due) };
  }

  function canClose_(s, t) { return CLOSERS.indexOf(s.role) !== -1 || (t.owner === 'gm' && (s.role === 'gm' || s.role === 'om')); }

  function act(s, id, action, d, myHotels) {
    var t = Db.get('Tickets', id);
    if (!t) throw new Error('التذكرة غير موجودة.');
    var vis = visibleTo(s, myHotels).some(function (x) { return x.id === id; });
    if (!vis) throw new Error('التذكرة ليست ضمن نطاقك.');
    var me = Db.get('Users', s.id) || {};
    if (t.status === 'closed') throw new Error('التذكرة مغلقة.');
    if (action === 'note') {
      if (s.role !== t.owner && !canClose_(s, t)) throw new Error('الإفادة لمالك الخدمة.');
      var n = String(d.note || '').trim(); if (!n) throw new Error('اكتب إفادتك.');
      Db.update('Tickets', id, { owner_note: n, owner_by: me.name || '', owner_at: new Date(), status: t.status === 'new' ? 'noted' : t.status });
      return;
    }
    if (action === 'close') {
      if (!canClose_(s, t)) throw new Error('الرد والإغلاق للإدارة.');
      var reply = String(d.reply || '').trim(), acted = String(d.action || '').trim();
      if (!reply) throw new Error('اكتب الرد.');
      if (!acted) throw new Error('اكتب الإجراء المتخذ.');
      if (t.type === 'complaint' && ['مقبولة', 'غير مقبولة'].indexOf(d.accepted) === -1) throw new Error('حدد: الشكوى مقبولة أم غير مقبولة.');
      Db.update('Tickets', id, { reply: reply, action: acted, accepted: t.type === 'complaint' ? d.accepted : '', closed_by: me.name || '', closed_role: s.role, closed_at: new Date(), status: 'closed' });
      return;
    }
    throw new Error('إجراء غير معروف.');
  }

  /** المتعهد يقيّم الرد؛ «غير راضٍ» يعيدها مرة واحدة للإدارة بموعد جديد */
  function rate(conId, id, sat, note) {
    var t = Db.get('Tickets', id);
    if (!t || t.con_id !== conId) throw new Error('التذكرة غير موجودة.');
    if (t.status !== 'closed') throw new Error('التذكرة لم تُغلق بعد.');
    if (t.sat) throw new Error('قيّمت الرد من قبل.');
    if (['راضٍ', 'غير راضٍ'].indexOf(sat) === -1) throw new Error('اختر: راضٍ أو غير راضٍ.');
    var patch = { sat: sat, sat_note: String(note || '').trim(), sat_at: new Date() };
    if (sat === 'غير راضٍ' && !Orders.truthy(t.reopened)) {
      var now = new Date();
      patch.status = 'reopened'; patch.reopened = true; patch.resp_due = addWork(now, 1); patch.close_due = addWork(now, 2);
      patch.reply = ''; patch.action = ''; patch.closed_at = ''; patch.closed_by = ''; patch.owner_note = (t.owner_note ? t.owner_note + '\n— الرد السابق: ' : '— الرد السابق: ') + t.reply + ' · ' + t.action;
      patch.sat = ''; patch.sat_note = '';
      Db.update('Tickets', id, patch); return 'reopened';
    }
    Db.update('Tickets', id, patch); return 'rated';
  }

  // ───────── تقييم المتعهد لمؤسستنا (شهري) ─────────
  function prevMonth_() { var d = new Date(); var m = Utilities.formatDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 864e5), TZ, 'yyyy-MM'); return m; }
  /** الفنادق التي لم يقيّمها المتعهد للشهر السابق (وكان له عقد فيها) */
  function pendingOrg(conId) {
    var m = prevMonth_(), R = Orders.refs(), done = {};
    Db.all('OrgEvals', function (e) { return e.con_id === conId && String(e.month) === m; }).forEach(function (e) { done[e.hotel_id] = true; });
    var mStart = new Date(m + '-01T00:00:00+03:00').getTime();
    var hs = [];
    R.contracts.forEach(function (c) {
      if (c.con_id !== conId) return;
      if ((ms(c.start) || 0) > mStart + 31 * 864e5 || (ms(c.end) || 9e15) < mStart) return;
      Orders.csv(c.hotel_ids).forEach(function (h) { if (!done[h] && hs.indexOf(h) === -1) hs.push(h); });
    });
    return { month: m, hotels: hs.map(function (h) { return { id: h, name: (R.hotels[h] || {}).name || '' }; }), crit: CRIT };
  }
  function orgSubmit(conId, hotelId, scores, note, byName) {
    var p = pendingOrg(conId);
    if (!p.hotels.some(function (h) { return h.id === hotelId; })) throw new Error('لا يوجد تقييم مطلوب لهذا الفندق.');
    var sc = {};
    CRIT.forEach(function (c) { var v = Number((scores || {})[c[0]]); if (!(v >= 1 && v <= 5)) throw new Error('قيّم كل البنود من 1 إلى 5.'); sc[c[0]] = Math.round(v); });
    Db.insert('OrgEvals', { con_id: conId, hotel_id: hotelId, month: p.month, scores: JSON.stringify(sc), note: String(note || '').trim(), by_name: byName || '', at: new Date() });
  }
  /** النتائج للإدارة: متوسط كل بند لكل فندق وشهر، مع من لم يقيّم */
  function orgResults(hotelIds) {
    var R = Orders.refs(), rows = {};
    Db.all('OrgEvals', function (e) { return hotelIds.indexOf(e.hotel_id) !== -1; }).forEach(function (e) {
      var k = e.hotel_id + '|' + e.month, sc = {}; try { sc = JSON.parse(e.scores); } catch (x) { sc = {}; }
      var r = rows[k] || (rows[k] = { hotel: (R.hotels[e.hotel_id] || {}).name || '', hotel_id: e.hotel_id, month: String(e.month), n: 0, sum: {}, notes: [] });
      r.n++; CRIT.forEach(function (c) { r.sum[c[0]] = (r.sum[c[0]] || 0) + (Number(sc[c[0]]) || 0); });
      if (e.note) r.notes.push({ con: (R.cons[e.con_id] || {}).name || '', note: e.note });
    });
    return { crit: CRIT, rows: Object.keys(rows).map(function (k) { var r = rows[k], avg = {}; CRIT.forEach(function (c) { avg[c[0]] = Math.round(r.sum[c[0]] / r.n * 10) / 10; }); return { hotel: r.hotel, hotel_id: r.hotel_id, month: r.month, n: r.n, avg: avg, notes: r.notes }; })
      .sort(function (a, b) { return a.month < b.month ? 1 : a.month > b.month ? -1 : 0; }) };
  }

  return { TYPES: TYPES, TOPICS: TOPICS, CRIT: CRIT, create: create, visibleTo: visibleTo, forCon: forCon, act: act, rate: rate, addWork: addWork,
    pendingOrg: pendingOrg, orgSubmit: orgSubmit, orgResults: orgResults, ownerOf: ownerOf };
})();
