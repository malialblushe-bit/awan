/**
 * Orders.js — أعوان: دورة أمر العمل كاملة.
 * الحالات: assigned · in_progress · decision · pay · parts · matching · closed · rejected
 * المتعهد يرى decision و pay معاً "قيد المراجعة". الأوقات من الخادم فقط.
 */

var Orders = (function () {
  var OPEN = ['assigned', 'in_progress', 'lead', 'quote', 'decision', 'pay', 'parts', 'matching'];
  var STOP_SYMS = ['متوقف', 'توقف بين الأدوار'];

  function now_() { return new Date(); }
  function ms(d) { if (!d) return null; var t = (d instanceof Date) ? d.getTime() : new Date(d).getTime(); return isNaN(t) ? null : t; }
  function truthy(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
  function csv(v) { return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(String); }
  function parse_(v, def) { if (!v) return def; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (e) { return def; } }

  function log_(woId, actor, action, from, to, note) {
    Db.insert('WOLog', { wo_id: woId, at: now_(), actor: actor, action: action, from: from || '', to: to || '', note: note || '' });
  }

  // ───────── المراجع ─────────
  function hotelByCode(code) {
    var c = String(code || '').trim().toUpperCase();
    var h = Db.find('Hotels', function (r) { return String(r.code).toUpperCase() === c && !(String(r.active).toUpperCase() === 'FALSE'); });
    if (!h) throw new Error('الباركود غير صحيح أو الفندق غير مفعّل.');
    return h;
  }

  function dayStr_(d) { return Utilities.formatDate(d, 'Asia/Riyadh', 'yyyy-MM-dd'); }

  function activeContract(hotelId, type, conId) {
    var today = dayStr_(now_());
    return Db.find('Contracts', function (c) {
      if (c.type !== type) return false;
      if (conId && c.con_id !== conId) return false;
      if (csv(c.hotel_ids).indexOf(hotelId) === -1) return false;
      var s = c.start ? dayStr_(new Date(c.start)) : '0000';
      var e = c.end ? dayStr_(new Date(c.end)) : '9999';
      return s <= today && today <= e;
    });
  }

  function respOf_(o, contract) {
    if (!contract) return null;
    if (truthy(o.trapped)) return 0;
    return Number(o.priority === 'urgent' ? contract.resp_urgent : contract.resp_normal) || null;
  }

  // ───────── الإنشاء ─────────
  /** o: hotel_id, type, kind, source, floor_id, room, equip, symptom, trapped, requester, description, photos, priority, con_id? */
  /** a101 أو « A 101 » → A101؛ أسماء المرافق تبقى كما هي */
  function normRoom(v) {
    var s = String(v == null ? '' : v).trim();
    var c = s.replace(/\s+/g, '');
    return /^[A-Za-z]{1,3}-?\d+$/.test(c) ? c.toUpperCase() : s;
  }

  function create(o, actor) {
    var t = now_();
    var contract = o.con_id ? activeContract(o.hotel_id, o.type, o.con_id) : activeContract(o.hotel_id, o.type);
    var urgent = truthy(o.trapped) || o.symptom === 'توقف بين الأدوار';
    var rec = {
      hotel_id: o.hotel_id, type: o.type, kind: o.kind || 'corrective', source: o.source,
      con_id: o.con_id || (contract ? contract.con_id : ''),
      status: 'assigned', priority: urgent ? 'urgent' : (o.priority || 'normal'),
      floor_id: o.floor_id || '', room: normRoom(o.room), equip: o.equip || '',
      symptom: o.symptom || '', trapped: truthy(o.trapped), requester: o.requester || '',
      description: o.description || '', photos: (o.photos || []).join(','),
      follow_of: o.follow_of || '', visits: 0, work_minutes: 0, reopens: 0,
      created_at: t, assigned_at: (o.con_id || contract) ? t : ''
    };
    if (o.type === 'el' && STOP_SYMS.indexOf(o.symptom) !== -1) rec.down_from = t;
    Db.insert('WorkOrders', rec);
    log_(rec.wo_id, actor, 'create', '', 'assigned', o.source);
    return { order: rec, contract: contract };
  }

  // ───────── وصول المتعهد (مسح باركود أعوان) ─────────
  function arrive(conId, hotelId) {
    var t = now_();
    Db.insert('Arrivals', { hotel_id: hotelId, con_id: conId, at: t });
    var ids = [];
    Db.all('WorkOrders', function (o) {
      return o.con_id === conId && o.hotel_id === hotelId && (o.status === 'assigned' || o.status === 'in_progress');
    }).forEach(function (o) {
      var patch = {};
      if (!o.arrived_at) patch.arrived_at = t;
      if (!o.work_from) patch.work_from = t;
      if (Object.keys(patch).length) { Db.update('WorkOrders', o.wo_id, patch); ids.push(o.wo_id); }
    });
    return ids;
  }

  function lastArrival_(conId, hotelId) {
    var best = null;
    Db.all('Arrivals', function (a) { return a.con_id === conId && a.hotel_id === hotelId; }).forEach(function (a) {
      if (!best || ms(a.at) > ms(best)) best = a.at;
    });
    return best;
  }

  /** يضيف وقت العمل الجاري لدقائق العمل ويوقف العدّاد */
  function stopWork_(o, patch, t) {
    var from = ms(o.work_from) || ms(o.arrived_at) || ms(lastArrival_(o.con_id, o.hotel_id)) || ms(o.created_at);
    if (from && ms(o.created_at) && from < ms(o.created_at)) from = ms(o.created_at);
    var add = from ? Math.max(0, Math.round((t.getTime() - from) / 60000)) : 0;
    patch.work_minutes = (Number(o.work_minutes) || 0) + add;
    patch.work_from = '';
    if (!o.arrived_at) patch.arrived_at = from ? new Date(from) : t;
  }

  // ───────── إجراءات المتعهد ─────────
  var OUTCOMES = {
    ac: ['ok', 'fix', 'comp', 'diag', 'report'],
    el: ['fix', 'ok', 'visit', 'diag', 'report', 'pm', 'lead']
  };
  var PM_EL_N = 38;   // بنود نموذج الصيانة الدورية للمصاعد (1–38)

  /** يتحقق من زيارة الصيانة الدورية قبل أي كتابة */
  function pmParse_(d) {
    var units = (d.units || []).filter(String);
    if (!units.length) throw new Error('اختر المصاعد المشمولة في الزيارة.');
    var pm = { units: units, grid: {}, working: {} };
    units.forEach(function (u) {
      var g = String(d['g|' + u] || '');
      if (!new RegExp('^[xon]{' + PM_EL_N + '}$').test(g)) throw new Error('بنود المصعد ' + u + ' ناقصة.');
      if (d['w|' + u] !== 'نعم' && d['w|' + u] !== 'لا') throw new Error('حدّد: هل المصعد ' + u + ' يعمل الآن؟');
      pm.grid[u] = g; pm.working[u] = d['w|' + u];
    });
    return pm;
  }

  /** d: outcome + حقول التقرير. custom: [{list, ar}] بنود جديدة بزر + */
  function conSubmit(s, woId, d) {
    var o = Db.get('WorkOrders', woId);
    if (!o || o.con_id !== s.id) throw new Error('العملية غير موجودة.');
    if (o.status !== 'assigned' && o.status !== 'in_progress' && o.status !== 'lead') throw new Error('هذه العملية ليست بانتظار تقريرك الآن.');
    var oc = d.outcome;
    if ((OUTCOMES[o.type] || []).indexOf(oc) === -1) throw new Error('اختر النتيجة.');
    if (oc === 'lead' && (s.web || o.status === 'lead')) throw new Error('الإرسال لقائد الفريق من الفني في الموقع.');
    if (o.status === 'lead' && (oc === 'visit' || oc === 'report')) throw new Error('استكمل التقرير: تم الإصلاح أو يحتاج قطعة أو سليم.');
    // المصاعد: التقرير الفني للمتعهد (على كليشته) إلزامي مع كل تسليم نهائي — شرط الإدارة القانونية
    if (o.type === 'el' && ['fix', 'ok', 'diag', 'pm'].indexOf(oc) !== -1 && !(d.att || []).length) throw new Error('أرفق التقرير الفني للمتعهد (صورة أو PDF).');
    if (oc === 'comp' && !(d.photos || []).length) throw new Error('صورة قراءة التيار إلزامية.');
    if (o.type === 'el' && oc !== 'report' && oc !== 'pm' && !d.working) throw new Error('حدّد: هل المصعد يعمل الآن؟');
    var pm = oc === 'pm' ? pmParse_(d) : null;
    if (oc === 'ok' && !(d.checked || []).length) throw new Error('سجّل ما فحصته حتى لو كان سليماً.');
    if (o.type === 'el' && oc === 'diag' && !(d.rec || []).length) throw new Error('اختر القطعة الموصى باستبدالها.');
    if ((oc === 'comp' || oc === 'diag') && (o.decision === 'con' || o.decision === 'own')) throw new Error('هذه العملية معتمدة للتركيب. سجّل الإصلاح.');

    var t = now_();
    var con = Db.get('Contractors', s.id);
    var report = {
      outcome: oc, equip: d.equip || '', sym: d.sym || '', part: d.part || '', cause: d.cause || [], action: d.action || [], parts: d.parts || [], checked: d.checked || [], rec: d.rec || [], gas: d.gas || '', pb: d.pb || '', pa: d.pa || '',
      working: d.working || '', follow: d.follow || '', followNote: d.followNote || '', note: d.note || '',
      leave: d.leave || '', ret: d.ret || '', title: d.title || '', body: d.body || '', at: t.getTime(),
      att: d.att || [], by: s.lead_name ? s.lead_name + ' (قائد الفريق)' : ''
    };
    if (pm) {
      report.units = pm.units; report.grid = pm.grid; report.working = pm.working;
      report.techs = d.techs || ''; report.replaced = d.replaced || ''; report.adjust = d.adjust || ''; report.toreplace = d.toreplace || ''; report.others = d.others || '';
    }
    var hist = parse_(o.report, null);
    var all = Array.isArray(hist) ? hist : (hist ? [hist] : []);
    all.push(report);

    var hadCA = !!o.reject_reason;   // قبل التحديث (السجل نفسه يتغير بالتحديث)
    var patch = { report: all, reject_reason: '', equip: d.equip || o.equip };
    if (d.photos && d.photos.length) patch.photos = csv(o.photos).concat(d.photos).join(',');
    stopWork_(o, patch, t);

    var to;
    if (d.att && d.att.length) patch.att = csv(o.att).concat(d.att).join(',');
    if (oc === 'visit') { to = 'in_progress'; patch.visits = (Number(o.visits) || 0) + 1; }
    else if (oc === 'lead') { to = 'lead'; patch.lead_at = t; patch.visits = (Number(o.visits) || 0) + 1; }
    else if (oc === 'diag' && o.type === 'el') {
      // المصاعد: لا سعر من الفني؛ يراجع المهندس ثم يطلب عرض السعر من إدارة المتعهد بالبريد
      to = 'quote'; patch.quote = ''; patch.quote_no = ''; patch.quote_at = ''; patch.rfq_at = ''; patch.rfq_count = 0; patch.decision = ''; patch.decision_note = ''; patch.submitted_at = t; patch.visits = (Number(o.visits) || 0) + 1;
    }
    else if (oc === 'comp' || oc === 'diag') { to = 'decision'; patch.quote = d.quote || ''; patch.decision = ''; patch.decision_note = ''; patch.submitted_at = t; patch.visits = (Number(o.visits) || 0) + 1; }
    else { to = 'matching'; patch.submitted_at = t; patch.visits = (Number(o.visits) || 0) + 1; }
    patch.status = to;

    if (o.type === 'el') {
      if (d.working === 'نعم' && o.down_from && !o.down_to) patch.down_to = t;
      if (d.working === 'لا' && !o.down_from) patch.down_from = t;
    }
    Db.update('WorkOrders', woId, patch);
    log_(woId, con ? con.name : s.id, 'submit:' + oc, o.status, to, d.note || '');
    if (hadCA) Quality.respondForOrder(woId, d.note || '');

    var extra = [];
    if (d.follow === 'نعم') {
      var f = create({
        hotel_id: o.hotel_id, type: o.type, kind: 'corrective', source: 'contractor', con_id: o.con_id,
        floor_id: o.floor_id, room: o.room, equip: d.equip || o.equip, symptom: d.followNote || 'متابعة', follow_of: woId,
        description: d.followNote || ''
      }, con ? con.name : s.id).order;
      extra.push('فُتحت عملية متابعة ' + f.wo_id + ' تلقائياً');
    }
    if (o.type === 'el' && d.working === 'نعم' && o.down_from) extra.push('أُغلق عدّاد توقف المصعد');
    if (pm) {
      // كل مصعد فيه بند يحتاج صيانة أو متوقف: عملية متابعة باسم المتعهد (والمتوقف يبدأ عدّاد توقفه)
      pm.units.forEach(function (u) {
        var bad = [];
        pm.grid[u].split('').forEach(function (c, i) { if (c === 'o') bad.push(i + 1); });
        var down = pm.working[u] === 'لا';
        if (!bad.length && !down) return;
        var f2 = create({
          hotel_id: o.hotel_id, type: 'el', kind: 'corrective', source: 'contractor', con_id: o.con_id, equip: u,
          symptom: down ? 'متوقف' : 'متابعة صيانة دورية', follow_of: woId,
          description: (bad.length ? 'بنود تحتاج صيانة أو استبدال: ' + bad.join('، ') : '') + (d.toreplace ? (bad.length ? ' · ' : '') + d.toreplace : '')
        }, con ? con.name : s.id).order;
        Db.update('WorkOrders', f2.wo_id, { arrived_at: t, work_from: '' });
        extra.push('فُتحت متابعة ' + f2.wo_id + ' لـ ' + u);
      });
    }
    if ((d.custom || []).length) {
      Db.insertMany('Lists', d.custom.map(function (c) {
        return { type: o.type, list: c.list, ar: String(c.ar || '').trim(), en: '', status: 'pending', created_by: con ? con.name : s.id, sort: 999 };
      }));
      extra.push('البنود الجديدة أُرسلت للمشرف لاعتمادها');
    }
    return { status: to, minutes: patch.work_minutes, msg: extra.join(' · ') };
  }

  /** عملية جديدة بمبادرة المتعهد: ملاحظة عطل أو تقرير فني */
  function conNew(s, d) {
    var con = Db.get('Contractors', s.id);
    var hotelId = d.hotel_id || s.hotel_id;
    if (!activeContract(hotelId, con.type, con.con_id)) throw new Error('لا يوجد عقد ساري لك في هذا الفندق.');
    var isPm = d.outcome === 'pm';
    // التحقق قبل الإنشاء حتى لا تبقى عملية ناقصة
    if ((OUTCOMES[con.type] || []).indexOf(d.outcome) === -1) throw new Error('اختر النتيجة.');
    if (isPm) pmParse_(d);
    else if (con.type === 'el' && d.outcome !== 'report' && !d.working) throw new Error('حدّد: هل المصعد يعمل الآن؟');
    var o = create({
      hotel_id: hotelId, type: con.type, kind: isPm ? 'periodic' : (d.outcome === 'report' ? 'report' : (d.outcome === 'fix' ? 'corrective' : 'diag')), source: 'contractor', con_id: con.con_id,
      floor_id: d.floor_id || '', room: d.room || '', equip: isPm ? (d.units || []).join('، ') : (d.equip || ''),
      symptom: isPm ? 'صيانة دورية' : (d.sym || d.title || '')
    }, con.name).order;
    // الصيانة الدورية: وقت الدخول = آخر مسح لباركود أعوان اليوم في هذا الفندق
    var t0 = now_(), last = isPm ? lastArrival_(con.con_id, hotelId) : null;
    if (last && dayStr_(new Date(last)) === dayStr_(t0)) t0 = new Date(last);
    Db.update('WorkOrders', o.wo_id, { arrived_at: t0, work_from: t0 });
    var res = conSubmit(s, o.wo_id, d);
    res.id = o.wo_id;
    return res;
  }

  function rescue(s, woId) {
    var o = Db.get('WorkOrders', woId);
    if (!o || o.con_id !== s.id) throw new Error('العملية غير موجودة.');
    if (!truthy(o.trapped) || o.rescued_at) return true;
    var t = now_();
    Db.update('WorkOrders', woId, { rescued_at: t, arrived_at: o.arrived_at || t });
    log_(woId, s.id, 'rescue', o.status, o.status, '');
    return true;
  }

  // ───────── إجراءات المهندس ─────────
  function engAct(s, woId, action, d) {
    d = d || {};
    var o = Db.get('WorkOrders', woId);
    if (!o) throw new Error('العملية غير موجودة.');
    var me = Db.get('Users', s.id);
    if (s.role !== 'admin' && csv(me.hotel_ids).indexOf(o.hotel_id) === -1) throw new Error('هذه العملية ليست ضمن فنادقك.');
    var t = now_(), patch = {}, to = o.status, note = '';

    if (action === 'rfq') {
      if (o.status !== 'quote') throw new Error('العملية ليست بانتظار عرض سعر.');
      patch.rfq_at = t; patch.rfq_count = (Number(o.rfq_count) || 0) + 1; note = 'طلب عرض سعر بالبريد';
    } else if (action === 'quote') {
      if (o.status !== 'quote') throw new Error('العملية ليست بانتظار عرض سعر.');
      var amt = Number(String(d.amount || '').replace(/[,،\s]/g, ''));
      if (!(amt > 0)) throw new Error('اكتب مبلغ عرض السعر بالريال.');
      patch.quote = amt; patch.quote_no = String(d.no || '').trim(); patch.quote_at = t; to = 'decision'; note = 'وصل عرض السعر ' + amt;
    } else if (action === 'decide') {
      if (o.status === 'quote' && ['recheck', 'reject'].indexOf(d.decision) === -1) throw new Error('سجّل عرض السعر أولاً، أو اختر فحصاً مغايراً أو رفضاً.');
      if (o.status !== 'decision' && o.status !== 'quote') throw new Error('العملية ليست بانتظار قرارك.');
      patch.decision = d.decision; patch.decided_at = t;
      if (d.decision === 'con') to = 'pay';
      else if (d.decision === 'own') to = 'parts';
      else if (d.decision === 'recheck') { if (!d.note) throw new Error('اكتب ملاحظتك للمتعهد.'); to = 'in_progress'; patch.decision_note = d.note; }
      else if (d.decision === 'reject') { if (!d.reason) throw new Error('اختر سبب الرفض.'); to = 'rejected'; patch.reject_reason = d.reason; patch.closed_at = t; }
      else throw new Error('اختر القرار.');
      note = d.note || d.reason || '';
    } else if (action === 'paid') {
      // السداد: يفتح الإصلاح، أو يُسجَّل لاحقاً لعملية أُذن بإصلاحها قبل السداد (ولو بعد إغلاقها)
      if (o.status === 'pay') { to = 'in_progress'; }
      else if (!truthy(o.pay_pending)) throw new Error('العملية ليست بانتظار السداد.');
      patch.paid_at = t; patch.receipt = d.receipt || ''; patch.pay_pending = false;
    } else if (action === 'prepay') {
      // اتفاق تشغيلي: الإصلاح قبل السداد حتى لا يتوقف المصعد، والسداد يبقى معلّقاً
      if (o.status !== 'pay') throw new Error('العملية ليست بانتظار السداد.');
      to = 'in_progress'; patch.pay_pending = true; patch.repair_date = String(d.date || '').trim(); note = 'إصلاح قبل السداد' + (patch.repair_date ? ' · ' + patch.repair_date : '');
    } else if (action === 'part') {
      if (o.status !== 'parts') throw new Error('العملية ليست بانتظار قطعة.');
      to = 'in_progress'; patch.part_arrived_at = t;
    } else if (action === 'close') {
      if (o.status !== 'matching') throw new Error('العملية ليست بانتظار المطابقة.');
      if (!d.sat) throw new Error('حدّد رضاك عن العمل.');
      to = 'closed'; patch.closed_at = t; patch.sat = d.sat;
      Quality.closeForOrder(woId);
    } else if (action === 'ca' || action === 'reopen') {
      // إجراء تصحيحي من المطابقة (بديل إعادة الفتح): يعود للمتعهد بالسبب والمطلوب، ويُسجَّل في سجل عدم المطابقة
      if (o.status !== 'matching') throw new Error('العملية ليست بانتظار المطابقة.');
      if (!d.reason) throw new Error('اختر سبب الإجراء التصحيحي.');
      to = 'in_progress'; patch.reject_reason = d.reason + (d.required ? ' — ' + String(d.required).trim() : ''); patch.reopens = (Number(o.reopens) || 0) + 1; note = patch.reject_reason;
      Quality.openForOrder(o, d, me ? me.name : s.id);
    } else if (action === 'assign') {
      if (OPEN.indexOf(o.status) === -1) throw new Error('العملية مغلقة.');
      patch.con_id = d.con_id; patch.assigned_at = t;
    } else throw new Error('إجراء غير معروف.');

    patch.status = to;
    Db.update('WorkOrders', woId, patch);
    log_(woId, me ? me.name : s.id, action, o.status, to, note);
    return to;
  }

  function engCreate(s, d) {
    var me = Db.get('Users', s.id);
    if (s.role !== 'admin' && csv(me.hotel_ids).indexOf(d.hotel_id) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    if (!d.type || !String(d.symptom || '').trim()) throw new Error('اختر النوع واكتب الملاحظة.');
    if (d.type === 'el' && !d.equip) throw new Error('اختر المصعد.');
    if (d.type === 'ac' && !d.floor_id) throw new Error('اختر الدور أو المكان.');
    var r = create({
      hotel_id: d.hotel_id, type: d.type, kind: 'corrective', source: 'engineer', floor_id: d.floor_id, room: d.room,
      equip: d.equip, symptom: String(d.symptom).trim(), description: d.description, priority: d.priority, trapped: d.trapped === 'yes',
      photos: d.photos || [], requester: me ? me.name : ''
    }, me ? me.name : s.id);
    return r.order.wo_id;   // بلا عقد ساري: يبقى بلا متعهد ويسنده المهندس يدوياً
  }

  // ───────── العرض للواجهة ─────────
  /** cache: { floors, hotels, cons, rooms, contracts } مقروءة مرة واحدة لكل استدعاء */
  function refs() {
    var floors = {}, hotels = {}, cons = {}, rooms = {};
    Db.all('Floors').forEach(function (f) { floors[f.floor_id] = f; });
    Db.all('Hotels').forEach(function (h) { hotels[h.hotel_id] = h; });
    Db.all('Contractors').forEach(function (c) { cons[c.con_id] = c; });
    Db.all('Rooms').forEach(function (r) {
      rooms[r.hotel_id + '|' + r.floor_id + '|' + String(r.number)] = r;
      if (r.kind !== 'facility' && !rooms[r.hotel_id + '|' + String(r.number)]) rooms[r.hotel_id + '|' + String(r.number)] = r;
    });
    return { floors: floors, hotels: hotels, cons: cons, rooms: rooms, contracts: Db.all('Contracts') };
  }

  function contractOf_(R, o) {
    for (var i = 0; i < R.contracts.length; i++) {
      var c = R.contracts[i];
      if (c.con_id === o.con_id && c.type === o.type && csv(c.hotel_ids).indexOf(o.hotel_id) !== -1) return c;
    }
    return null;
  }

  function loc(R, o) {
    var f = R.floors[o.floor_id];
    var parts = [];
    if (f) parts.push(f.tower ? (/^\d+$/.test(String(f.tower)) ? 'برج ' + f.tower : f.tower) + ' · ' + f.name : f.name);
    var rec = R.rooms[o.hotel_id + '|' + o.floor_id + '|' + String(o.room)];
    var facility = rec ? rec.kind === 'facility' : ((f && f.kind !== 'rooms') || !/^[A-Za-z]{0,3}-?\d+$/.test(String(o.room)));
    if (o.room) parts.push(facility ? o.room : 'غرفة ' + o.room);
    if (o.type === 'el' && o.equip) parts.unshift(o.equip);
    return parts.join(' · ') || o.equip || '—';
  }

  function view(R, o, forCon) {
    var h = R.hotels[o.hotel_id] || {};
    var c = R.cons[o.con_id] || {};
    var room = R.rooms[o.hotel_id + '|' + o.floor_id + '|' + String(o.room)] || R.rooms[o.hotel_id + '|' + String(o.room)];
    var st = o.status;
    if (forCon && (st === 'decision' || st === 'pay' || st === 'quote')) st = 'review';
    var note = '';
    if (o.status === 'in_progress') {
      if (o.decision === 'con' && o.paid_at) note = 'اعتُمد: وفّر القطعة وركّبها، ثم سجّل الإصلاح.';
      else if (o.decision === 'con' && truthy(o.pay_pending)) note = 'اعتُمد الإصلاح قبل السداد: وفّر القطعة وركّبها' + (o.repair_date ? ' · الموعد ' + o.repair_date : '') + '، ثم سجّل الإصلاح.';
      else if (o.decision === 'own' && o.part_arrived_at) note = 'وصلت القطعة من فريقنا، جاهزة للتركيب.';
      else if (o.decision === 'recheck') note = 'فحص مغاير: ' + (o.decision_note || '');
    }
    var reports = parse_(o.report, []);
    if (!Array.isArray(reports)) reports = [reports];
    return {
      id: o.wo_id, hotel_id: o.hotel_id, hotel: h.name || '', type: o.type, kind: o.kind, source: o.source,
      att: csv(o.att), leadAt: ms(o.lead_at) || null,
      con_id: o.con_id, con: c.name || '', status: st, priority: o.priority,
      floor_id: o.floor_id, room: String(o.room || ''), equip: o.equip || '', loc: loc(R, o),
      units: room ? csv(room.ac_units) : [], symptom: o.symptom || '', title: o.symptom || (o.kind === 'report' ? 'تقرير فني' : 'طلب صيانة'),
      trapped: truthy(o.trapped), requester: o.requester || '', description: o.description || '',
      photos: csv(o.photos), reports: reports, quote: forCon ? '' : (o.quote || ''),
      decision: o.decision || '', decision_note: o.decision_note || '', note: note,
      reject_reason: (o.status === 'in_progress' || o.status === 'rejected') ? (o.reject_reason || '') : '',
      receipt: forCon ? '' : (o.receipt || ''), sat: forCon ? '' : (o.sat || ''),
      visits: Number(o.visits) || 0, work_minutes: Number(o.work_minutes) || 0, reopens: Number(o.reopens) || 0,
      follow_of: o.follow_of || '', resp: respOf_(o, contractOf_(R, o)),
      created: ms(o.created_at), assigned: ms(o.assigned_at), arrived: ms(o.arrived_at), rescued: ms(o.rescued_at),
      submitted: ms(o.submitted_at), decided: ms(o.decided_at), paid: forCon ? null : ms(o.paid_at),
      part_arrived: ms(o.part_arrived_at), closed: ms(o.closed_at), down_from: ms(o.down_from), down_to: ms(o.down_to),
      claimed_by: o.claimed_by || '', claimed_at: ms(o.claimed_at), tg: !!o.tg_msg,
      pay_pending: forCon ? false : truthy(o.pay_pending), repair_date: String(o.repair_date || ''),
      rfq: forCon ? null : ms(o.rfq_at), rfq_count: forCon ? 0 : (Number(o.rfq_count) || 0), quote_no: forCon ? '' : String(o.quote_no || ''), quote_at: forCon ? null : ms(o.quote_at)
    };
  }

  return {
    OPEN: OPEN, ms: ms, csv: csv, truthy: truthy, hotelByCode: hotelByCode, activeContract: activeContract,
    create: create, arrive: arrive, conSubmit: conSubmit, conNew: conNew, rescue: rescue,
    engAct: engAct, engCreate: engCreate, refs: refs, contractOf: contractOf_, view: view, normRoom: normRoom
  };
})();
