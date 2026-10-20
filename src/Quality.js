/**
 * Quality.js — أعوان: الإجراء التصحيحي (سجل عدم المطابقة) والتقييم الدوري للمتعهدين.
 * الإجراء التصحيحي: مفتوح ← ردّ المتعهد ← يتحقق المهندس (فعّال: يُغلق / غير فعّال: يُعاد مفتوحاً).
 * المرتبط بعملية يُفتح من المطابقة، ويُرد عليه بإعادة تسليم التقرير، ويُغلق بإغلاق العملية.
 */
var Quality = (function () {
  function now_() { return new Date(); }

  /** من المطابقة: يعيد العملية للمتعهد بإجراء تصحيحي (الإجراء السابق عليها يُغلق «غير فعّال») */
  function openForOrder(o, d, actor) {
    Db.all('CorrectiveActions', function (c) { return c.wo_id === o.wo_id && c.status !== 'closed'; }).forEach(function (c) {
      Db.update('CorrectiveActions', c.ca_id, { status: 'closed', effective: 'لا', closed_at: now_() });
    });
    return Db.insert('CorrectiveActions', {
      hotel_id: o.hotel_id, con_id: o.con_id, wo_id: o.wo_id, reason: d.reason, required: String(d.required || '').trim(),
      due: d.due || '', status: 'open', by: actor, created_at: now_()
    });
  }

  function respondForOrder(woId, text) {
    Db.all('CorrectiveActions', function (c) { return c.wo_id === woId && c.status === 'open'; }).forEach(function (c) {
      Db.update('CorrectiveActions', c.ca_id, { status: 'responded', response: text || 'أُعيد تسليم التقرير', responded_at: now_() });
    });
  }

  function closeForOrder(woId) {
    Db.all('CorrectiveActions', function (c) { return c.wo_id === woId && c.status !== 'closed'; }).forEach(function (c) {
      Db.update('CorrectiveActions', c.ca_id, { status: 'closed', effective: 'نعم', closed_at: now_() });
    });
  }

  /** إجراء مستقل من المهندس على المتعهد (بلا عملية) */
  function create(s, d) {
    var me = Db.get('Users', s.id);
    if (!d.con_id || !Db.get('Contractors', d.con_id)) throw new Error('اختر المتعهد.');
    if (!d.hotel_id) throw new Error('اختر الفندق.');
    if (s.role !== 'admin' && Orders.csv(me.hotel_ids).indexOf(d.hotel_id) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    if (!d.reason) throw new Error('اختر السبب.');
    if (!String(d.required || '').trim()) throw new Error('اكتب الإجراء المطلوب من المتعهد.');
    return Db.insert('CorrectiveActions', {
      hotel_id: d.hotel_id, con_id: d.con_id, wo_id: '', reason: d.reason, required: String(d.required).trim(),
      due: d.due || '', status: 'open', by: me ? me.name : s.id, created_at: now_()
    });
  }

  /** ردّ المتعهد على إجراء مستقل */
  function respond(s, caId, text, photos) {
    var c = Db.get('CorrectiveActions', caId);
    if (!c || c.con_id !== s.id) throw new Error('الإجراء غير موجود.');
    if (c.wo_id) throw new Error('هذا الإجراء مرتبط بعملية: أعد تسليم تقريرها.');
    if (c.status !== 'open') throw new Error('الإجراء ليس بانتظار ردك.');
    if (!String(text || '').trim()) throw new Error('اكتب ما عملته.');
    Db.update('CorrectiveActions', caId, { status: 'responded', response: String(text).trim(), photos: (photos || []).join(','), responded_at: now_() });
  }

  /** تحقق المهندس من إجراء مستقل: close = فعّال · return = غير فعّال ويُعاد */
  function verify(s, caId, action, note) {
    var c = Db.get('CorrectiveActions', caId), me = Db.get('Users', s.id);
    if (!c) throw new Error('الإجراء غير موجود.');
    if (s.role !== 'admin' && Orders.csv(me.hotel_ids).indexOf(c.hotel_id) === -1) throw new Error('هذا الإجراء ليس ضمن فنادقك.');
    if (c.wo_id) throw new Error('هذا الإجراء يُغلق بإغلاق عمليته بعد المطابقة.');
    if (c.status !== 'responded') throw new Error('بانتظار رد المتعهد.');
    if (action === 'close') Db.update('CorrectiveActions', caId, { status: 'closed', effective: 'نعم', closed_at: now_(), verify_note: note || '' });
    else if (action === 'return') {
      if (!String(note || '').trim()) throw new Error('اكتب سبب الإعادة.');
      Db.update('CorrectiveActions', caId, { status: 'open', verify_note: String(note).trim(), rounds: (Number(c.rounds) || 0) + 1 });
    } else throw new Error('إجراء غير معروف.');
  }

  function view(R, c) {
    var o = c.wo_id ? Db.get('WorkOrders', c.wo_id) : null;
    return {
      id: c.ca_id, hotel_id: c.hotel_id, hotel: (R.hotels[c.hotel_id] || {}).name || '', con_id: c.con_id, con: (R.cons[c.con_id] || {}).name || '',
      wo_id: c.wo_id || '', title: o ? (o.symptom || '') : '', reason: c.reason || '', required: c.required || '', due: c.due ? String(c.due).slice(0, 10) : '',
      status: c.status, response: c.response || '', photos: Orders.csv(c.photos), by: c.by || '', effective: c.effective || '', note: c.verify_note || '',
      rounds: Number(c.rounds) || 0, created: Orders.ms(c.created_at), responded: Orders.ms(c.responded_at), closed: Orders.ms(c.closed_at)
    };
  }

  /** للواجهة: المفتوح والمردود عليه، والمغلق خلال 60 يوماً */
  function list(R, filter) {
    var since = Date.now() - 60 * 864e5;
    return Db.all('CorrectiveActions', function (c) { return filter(c) && (c.status !== 'closed' || (Orders.ms(c.closed_at) || 0) >= since); })
      .map(function (c) { return view(R, c); })
      .sort(function (a, b) { return b.created - a.created; });
  }

  return { openForOrder: openForOrder, respondForOrder: respondForOrder, closeForOrder: closeForOrder, create: create, respond: respond, verify: verify, list: list };
})();
