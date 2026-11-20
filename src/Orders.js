/** الاستبدال الرئيسي للتكييف بعرض سعر وقرار المهندس: اسم الخدمة في الكشف لكل نوع */
var REPL_ = { comp: 'استبدال كمبروسر', unit: 'تغيير وحدة خارجية' };
function replKind_(v) { return v === 'unit' || v === REPL_.unit ? 'unit' : 'comp'; }

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

  // ───────── وصول المتعهد: زر «تسجيل الوصول» بعد مسح باركود أعوان ─────────
  /** زيارة اليوم المفتوحة (آخر وصول اليوم لم تُسجَّل مغادرته) */
  function visitToday(conId, hotelId) {
    var today = dayStr_(now_()), best = null;
    Db.all('Arrivals', function (a) { return a.con_id === conId && a.hotel_id === hotelId && a.at && dayStr_(new Date(a.at)) === today; }).forEach(function (a) {
      if (!best || ms(a.at) > ms(best.at)) best = a;
    });
    return best ? { id: best.arrival_id, at: ms(best.at), left: ms(best.left_at) || null, out: String(best.out) === '1' } : null;
  }

  /** زر «تسجيل المغادرة»: ينهي زيارة اليوم، وأي عمل بعده يحتاج وصولاً جديداً */
  function leave(conId, hotelId) {
    var v = visitToday(conId, hotelId);
    if (!v) throw new Error('لم يُسجَّل وصولك اليوم.');
    if (v.out) throw new Error('سُجّلت مغادرتك من قبل.');
    var t = now_();
    Db.update('Arrivals', v.id, { left_at: t, out: 1 });
    return t;
  }

  /** يسجّل الوصول مرة واحدة للزيارة، ويبدأ عدّاد العمليات المختارة (ids غير محدد = كل المفتوحة، [] = الزيارة فقط) */
  function arrive(conId, hotelId, ids) {
    var t = now_(), v = visitToday(conId, hotelId);
    if (!v || v.left) Db.insert('Arrivals', { hotel_id: hotelId, con_id: conId, at: t });
    else Db.update('Arrivals', v.id, { left_at: '', out: '' });
    var pick = Array.isArray(ids) ? ids : null, done = [];
    Db.all('WorkOrders', function (o) {
      return o.con_id === conId && o.hotel_id === hotelId && (o.status === 'assigned' || o.status === 'in_progress') && (!pick || pick.indexOf(o.wo_id) !== -1);
    }).forEach(function (o) {
      var patch = {};
      if (!o.arrived_at) patch.arrived_at = t;
      if (!o.work_from) patch.work_from = t;
      if (Object.keys(patch).length) { Db.update('WorkOrders', o.wo_id, patch); log_(o.wo_id, conId, 'arrive', o.status, o.status, ''); done.push(o.wo_id); }
    });
    return done;
  }

  /** إتمام الطلب = إشعار المغادرة: آخر طلب يُتم يحدّث وقت المغادرة */
  function depart_(conId, hotelId) {
    var v = visitToday(conId, hotelId);
    if (v) Db.update('Arrivals', v.id, { left_at: now_() });
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
    el: ['fix', 'ok', 'visit', 'diag', 'report', 'pm', 'lead'],
    pj: ['visit', 'fix']   // أمر عمل مشروع: زيارة تقدم · تسليم المشروع
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
    if (!o.arrived_at && o.status !== 'lead') {
      // وصوله مسجّل اليوم في هذا الفندق (من الباركود، ولو أرسل التقرير من الويب): يُحسب وصوله للعملية تلقائياً
      var vt = visitToday(s.id, o.hotel_id);
      if (!vt) throw new Error(s.web ? 'سجّل وصولك أولاً بمسح باركود أعوان في الفندق، ثم أرسل التقرير.' : 'سجّل وصولك أولاً: اضغط «تسجيل الوصول».');
      if (vt.out) throw new Error('سُجّلت مغادرتك اليوم: سجّل وصولك من جديد، ثم أرسل التقرير.');
      var ta = new Date(Math.max(vt.at, ms(o.created_at) || 0));
      Db.update('WorkOrders', o.wo_id, { arrived_at: ta, work_from: o.work_from || ta });
      log_(o.wo_id, s.id, 'arrive', o.status, o.status, 'تلقائي من زيارة اليوم');
      o = Db.get('WorkOrders', woId);
    }
    var oc = d.outcome;
    if ((OUTCOMES[o.type] || []).indexOf(oc) === -1) throw new Error('اختر النتيجة.');
    if (o.type === 'pj' && o.supply && !o.accepted_at) throw new Error('استلم أمر العمل أولاً: اقرأ النطاق والشروط ثم اضغط «استلمت أمر العمل».');
    if (oc === 'lead' && (s.web || o.status === 'lead')) throw new Error('الإرسال لقائد الفريق من الفني في الموقع.');
    if (o.status === 'lead' && (oc === 'visit' || oc === 'report')) throw new Error('استكمل التقرير: تم الإصلاح أو يحتاج قطعة أو سليم.');
    // المصاعد: التقرير الفني للمتعهد (على كليشته) إلزامي مع كل تسليم نهائي — شرط الإدارة القانونية
    if (o.type === 'el' && ['fix', 'ok', 'diag', 'pm'].indexOf(oc) !== -1 && !(d.att || []).length) throw new Error('أرفق التقرير الفني للمتعهد (صورة أو PDF).');
    if (o.type === 'pj' && !(d.photos || []).length) throw new Error(oc === 'fix' ? 'أرفق صور التسليم (قبل وبعد).' : 'أرفق صورة لما أُنجز.');
    // المشروع: نسبة الإنجاز من الأنشطة المنجزة بأوزانها (فارغة = بالتساوي)، والتسليم يُتم كل الأنشطة
    var pjActs = o.type === 'pj' ? parse_(o.acts, null) : null;
    if (pjActs && pjActs.a && pjActs.a.length) d.pct = projDone_(pjActs, oc === 'fix' ? null : (d.done || []), dayStr_(now_()));
    else if (o.type === 'pj' && oc === 'visit' && !d.pct) throw new Error('حدّد نسبة الإنجاز التقريبية.');
    if (oc === 'comp' && !(d.photos || []).length) throw new Error('صورة قراءة التيار إلزامية.');
    if (oc === 'comp' && !(Number(d.quote) > 0)) throw new Error('اكتب سعر العرض بالريال.');
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
      att: d.att || [], by: s.lead_name ? s.lead_name + ' (قائد الفريق)' : '', pct: d.pct || ''
    };
    if (pjActs && pjActs.a) report.done = pjActs.a.filter(function (r) { return r.done; }).map(function (r) { return r.n; });
    if (oc === 'comp') report.rep = replKind_(d.rep);
    if (pm) {
      report.units = pm.units; report.grid = pm.grid; report.working = pm.working;
      report.techs = d.techs || ''; report.replaced = d.replaced || ''; report.adjust = d.adjust || ''; report.toreplace = d.toreplace || ''; report.others = d.others || '';
    }
    var hist = parse_(o.report, null);
    var all = Array.isArray(hist) ? hist : (hist ? [hist] : []);
    // تركيب الكمبروسر المعتمد: «استبدال كمبروسر» ثابت في الخدمة المقدمة (يُحسب في الكشف)، والمعدة والسبب من تقرير الكمبروسر
    var compR = all.filter(function (r) { return r && r.outcome === 'comp'; }).pop();
    if (oc === 'fix' && o.type === 'ac' && compR && (o.decision === 'con' || o.decision === 'own')) {
      var rn = REPL_[replKind_(compR.rep)];
      if (report.action.indexOf(rn) === -1) report.action.unshift(rn);
      if (!report.equip) report.equip = compR.equip || o.equip || '';
      if (!report.cause.length) report.cause = compR.cause || [];
    }
    all.push(report);

    var hadCA = !!o.reject_reason;   // قبل التحديث (السجل نفسه يتغير بالتحديث)
    var patch = { report: all, reject_reason: '', equip: d.equip || o.equip };
    if (pjActs && pjActs.a) patch.acts = JSON.stringify(pjActs);
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
    if (!s.web) depart_(o.con_id, o.hotel_id);
    return { status: to, minutes: patch.work_minutes, msg: extra.join(' · ') };
  }

  /** عملية جديدة بمبادرة المتعهد: ملاحظة عطل أو تقرير فني */
  function conNew(s, d) {
    var con = Db.get('Contractors', s.id);
    // من الباركود: العملية الجديدة في فندق الباركود نفسه (حيث سُجّل الوصول)
    var hotelId = s.web ? (d.hotel_id || s.hotel_id) : s.hotel_id;
    if (!activeContract(hotelId, con.type, con.con_id)) throw new Error('لا يوجد عقد ساري لك في هذا الفندق.');
    if (!s.web && !visitToday(con.con_id, hotelId)) throw new Error('سجّل وصولك أولاً: اضغط «تسجيل الوصول».');
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
    // من الباركود: الوصول مسجّل اليوم شرط، والصيانة الدورية تبدأ من وقت الوصول
    var t0 = now_(), vis = s.web ? null : visitToday(con.con_id, hotelId);
    if (isPm && vis) t0 = new Date(vis.at);
    Db.update('WorkOrders', o.wo_id, { arrived_at: t0, work_from: t0 });
    var res = conSubmit(s, o.wo_id, d);
    res.id = o.wo_id;
    return res;
  }

  /** التقرير الفني من الويب (قائد الفريق، المصاعد): تقرير حالة ← المطابقة، أو تشخيص يحتاج قطعة مع عرض السعر ← قرار المهندس مباشرة */
  function techReport(s, d) {
    if (!s.web) throw new Error('التقرير الفني من صفحة الويب.');
    var con = Db.get('Contractors', s.id);
    if (!con || con.type !== 'el') throw new Error('التقرير الفني من الويب لمتعهد المصاعد.');
    if (!d.hotel_id) throw new Error('اختر الفندق.');
    if (!String(d.equip || '').trim()) throw new Error('اختر المصعد.');
    if (!String(d.title || '').trim()) throw new Error('اكتب عنوان التقرير.');
    if (!(d.att || []).length) throw new Error('أرفق التقرير الفني بكليشة مقدم الخدمة موقّعاً (صورة أو PDF).');
    var diag = d.kind === 'diag', amt = 0;
    if (diag) {
      amt = Number(String(d.amount || '').replace(/[,،\s]/g, ''));
      if (!(amt > 0)) throw new Error('اكتب مبلغ عرض السعر بالريال.');
      if (!(d.rec || []).length) throw new Error('اختر القطعة الموصى باستبدالها.');
      if (!d.working) throw new Error('حدّد: هل المصعد يعمل الآن؟');
    }
    var res = conNew(s, { hotel_id: d.hotel_id, outcome: diag ? 'diag' : 'report', equip: d.equip, title: String(d.title).trim(), sym: String(d.title).trim(),
      body: d.note || '', note: d.note || '', rec: d.rec || [], part: d.part || '', cause: d.cause || [], working: d.working || '', att: d.att });
    if (diag) {
      var t = now_();
      Db.update('WorkOrders', res.id, { status: 'decision', quote: amt, quote_no: String(d.no || '').trim(), quote_at: t });
      log_(res.id, s.lead_name || con.name, 'quote', 'quote', 'decision', 'عرض السعر ضمن التقرير الفني ' + amt);
    }
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

    // عرض سعر الاستبدال الرئيسي (كمبروسر/وحدة خارجية) لعملية رُفعت بلا عرض: يُدخله المهندس في أي مرحلة، فيُسعَّر في الكشف
    var isRepl = o.type === 'ac' && parse_(o.report, []).some(function (r) { return r && r.outcome === 'comp'; });
    var hasQ = o.quote !== '' && o.quote != null && Number(o.quote) > 0;
    if (action === 'paccept') { pjAccept(s, woId, true); return o.status; }
    if (action === 'pkeep') {
      var mm = parse_(o.mod, null); if (!mm || mm.done) throw new Error('لا طلب تعديل مفتوح.');
      var rp = String(d.note || '').trim(); if (!rp) throw new Error('اكتب ردك على طلب التعديل.');
      mm.reply = rp.slice(0, 600); mm.rat = t.getTime(); mm.done = 1;
      Db.update('WorkOrders', woId, { mod: JSON.stringify(mm) }); log_(woId, me ? me.name : s.id, 'modkeep', o.status, o.status, rp);
      return o.status;
    }
    if (action === 'pdoc') {
      if (o.type !== 'pj') throw new Error('المستندات لأوامر عمل المشاريع.');
      if (!(d.docs || []).length) throw new Error('اختر الملف.');
      Db.update('WorkOrders', woId, { docs: JSON.stringify(projDocs_(d.docs, parse_(o.docs, []))) });
      log_(woId, me ? me.name : s.id, 'doc', o.status, o.status, '');
      return o.status;
    }
    if (action === 'cquote') {
      if (!isRepl) throw new Error('هذه العملية ليست استبدالاً بعرض سعر.');
      var qa = Number(String(d.amount || '').replace(/[,،\s]/g, ''));
      if (!(qa > 0)) throw new Error('اكتب سعر العرض بالريال.');
      Db.update('WorkOrders', woId, { quote: qa });
      log_(woId, s.id, 'cquote', o.status, o.status, 'سعر العرض ' + qa);
      return o.status;
    }
    if (action === 'decide' && isRepl && !hasQ && (d.decision === 'con' || d.decision === 'own')) throw new Error('سجّل سعر العرض المقدم أولاً، ثم اعتمد.');

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
      to = 'closed'; patch.closed_at = t; patch.sat = d.sat; patch.matched_by = me.name || ''; patch.matched_role = s.role;
      Quality.closeForOrder(woId);
    } else if (action === 'ca' || action === 'reopen') {
      // إجراء تصحيحي من المطابقة (بديل إعادة الفتح): يعود للمتعهد بالسبب والمطلوب، ويُسجَّل في سجل عدم المطابقة
      if (o.status !== 'matching') throw new Error('العملية ليست بانتظار المطابقة.');
      if (!d.reason) throw new Error('اختر سبب الإجراء التصحيحي.');
      to = 'in_progress'; patch.reject_reason = d.reason + (d.required ? ' — ' + String(d.required).trim() : ''); patch.reopens = (Number(o.reopens) || 0) + 1; note = patch.reject_reason;
      Quality.openForOrder(o, d, me ? me.name : s.id);
    } else if (action === 'stop') {
      // إيقاف طلب غير صحيح من مالك الخدمة (أياً كان رافعه) بتعليق إلزامي؛ لا يُحسب على المتعهد
      if (OPEN.indexOf(o.status) === -1) throw new Error('العملية مغلقة.');
      var why = String(d.note || '').trim();
      if (!why) throw new Error('اكتب تعليقاً يوضح سبب الإيقاف.');
      patch.stop_prev = JSON.stringify({ status: o.status, decision: o.decision || '', reject_reason: o.reject_reason || '' });
      to = 'rejected'; patch.decision = 'stop'; patch.reject_reason = 'أُوقف: ' + why; patch.closed_at = t; note = patch.reject_reason;
    } else if (action === 'unstop') {
      // إلغاء الإيقاف في أي وقت: يعود لآخر مرحلة قبل الإيقاف بقرارها وملاحظتها
      if (o.status !== 'rejected' || o.decision !== 'stop') throw new Error('الطلب ليس موقوفاً.');
      var pv = {}; try { pv = JSON.parse(o.stop_prev || '{}'); } catch (e) { pv = {}; }
      to = pv.status || (o.arrived_at ? 'in_progress' : 'assigned');
      patch.decision = pv.decision || ''; patch.reject_reason = pv.reject_reason || ''; patch.closed_at = ''; patch.stop_prev = ''; note = 'أُلغي الإيقاف';
    } else if (action === 'follow') {
      // فتح متابعة من التقرير: عطل آخر ظهر في تقرير المتعهد، يُفتح باسمه دون تغيير حالة الأصل
      var fn = String(d.note || '').trim();
      if (!fn) throw new Error('اكتب ما الذي يحتاج معالجة.');
      if (!o.con_id) throw new Error('العملية بلا متعهد.');
      var nf = create({
        hotel_id: o.hotel_id, type: o.type, kind: 'corrective', source: 'engineer', con_id: o.con_id,
        floor_id: o.floor_id, room: o.room, equip: o.equip, symptom: fn, follow_of: woId, description: fn
      }, me ? me.name : s.id).order;
      d.created = nf.wo_id; note = 'فُتحت متابعة ' + nf.wo_id + ': ' + fn;
    } else if (action === 'assign') {
      if (OPEN.indexOf(o.status) === -1) throw new Error('العملية مغلقة.');
      patch.con_id = d.con_id; patch.assigned_at = t;
    } else throw new Error('إجراء غير معروف.');

    patch.status = to;
    Db.update('WorkOrders', woId, patch);
    log_(woId, me ? me.name : s.id, action, o.status, to, note);
    return to;
  }

  /** أنشطة أمر عمل المشروع: [{p: الحزمة, n: النشاط, c: معيار القبول, d: موعد التسليم}] + معايير الحزم {pk} */
  /** يعلّم الأنشطة المنجزة (done: أسماء مسبوقة برقمها «1. …»، أو null = كلها) بتاريخ اليوم، ويعيد النسبة الموزونة «n%» */
  function projDone_(acts, done, day) {
    var idx = done === null ? null : done.map(function (x) { return parseInt(String(x), 10) - 1; });
    acts.a.forEach(function (r, i) {
      var on = idx === null || idx.indexOf(i) !== -1;
      if (on && !r.done) r.done = day; else if (!on) delete r.done;
    });
    var ws = acts.a.map(function (r) { return Number(r.w) > 0 ? Number(r.w) : 1; }), tot = ws.reduce(function (s, x) { return s + x; }, 0), got = 0;
    acts.a.forEach(function (r, i) { if (r.done) got += ws[i]; });
    return Math.round(got / tot * 100) + '%';
  }

  /** شروط العمل والتوريد والمواد والأدوات (قرار صاحب المشروع 21 نوفمبر) */
  var SUPPLY_ = { con: 'المنفذ', own: 'نحن', mix: 'مشترك' };
  function projSpec_(d) {
    var tx = function (v, n) { return String(v == null ? '' : v).trim().slice(0, n || 160); };
    var terms = (d.terms || []).map(function (x) { return tx(x); }).filter(String).slice(0, 20);
    if (!SUPPLY_[d.supply]) throw new Error('حدّد من يورّد المواد: المنفذ أو نحن أو مشترك.');
    var by = function (v) { return SUPPLY_[v] && v !== 'mix' ? v : (d.supply === 'own' ? 'own' : 'con'); };
    var mats = (d.mats || []).filter(function (r) { return r && tx(r.n); }).slice(0, 60).map(function (r) { return { n: tx(r.n, 100), s: tx(r.s), q: tx(r.q, 40), by: by(r.by) }; });
    var tools = (d.tools || []).filter(function (r) { return r && tx(r.n); }).slice(0, 40).map(function (r) { return { n: tx(r.n, 100), by: r.by === 'own' ? 'own' : 'con' }; });
    return { terms: JSON.stringify(terms), supply: d.supply, mats: JSON.stringify(mats), tools: JSON.stringify(tools) };
  }
  /** المستندات المرجعية: d = [{f: معرّف الملف في Drive, n, t, v}] */
  function projDocs_(list, prev) {
    var T = ['مخطط', 'مواصفات', 'جدول كميات', 'عرض سعر', 'أخرى'], at = now_().getTime();
    return (prev || []).concat((list || []).filter(function (x) { return x && x.f; }).map(function (x) {
      var t = T.indexOf(x.t) === -1 ? 'أخرى' : x.t;
      return { f: x.f, n: String(x.n || t).trim().slice(0, 80) || t, t: t, v: t === 'عرض سعر' ? false : x.v !== false, at: at };
    }));
  }
  /** استلام المنفذ لأمر العمل وموافقته على النطاق (أو «ورقياً» من المهندس) */
  function pjAccept(s, woId, paper) {
    var o = Db.get('WorkOrders', woId);
    if (!o || o.type !== 'pj') throw new Error('أمر العمل غير موجود.');
    if (!paper && o.con_id !== s.id) throw new Error('أمر العمل غير موجود.');
    if (o.accepted_at) throw new Error('استُلم أمر العمل من قبل.');
    var who = paper ? 'ورقياً · ' + ((Db.get('Users', s.id) || {}).name || '') : ((Db.get('Contractors', s.id) || {}).name || '') + (s.lead_name ? ' · ' + s.lead_name : '');
    Db.update('WorkOrders', woId, { accepted_at: now_(), accepted_by: who });
    log_(woId, who, 'accept', o.status, o.status, '');
  }

  /** طلب تعديل من المنفذ قبل الاستلام (قبل الاستلام لم يُتفق بعد، فالتعديل بلا أمر تغيير) */
  function pjModReq(s, woId, note) {
    var o = Db.get('WorkOrders', woId);
    if (!o || o.type !== 'pj' || o.con_id !== s.id) throw new Error('أمر العمل غير موجود.');
    if (o.accepted_at) throw new Error('استُلم أمر العمل: أي تعديل بعده أمر تغيير من المهندس.');
    note = String(note || '').trim(); if (!note) throw new Error('اكتب التعديل المطلوب.');
    Db.update('WorkOrders', woId, { mod: JSON.stringify({ req: note.slice(0, 600), at: now_().getTime() }) });
    log_(woId, (Db.get('Contractors', s.id) || {}).name || s.id, 'modreq', o.status, o.status, note);
  }
  /** تعديل أمر العمل من المهندس قبل الاستلام: النموذج نفسه؛ يعيد {before, after} لعقد المشروع لسجل التعديلات */
  function projEdit(s, woId, d) {
    var o = Db.get('WorkOrders', woId), me = Db.get('Users', s.id) || {};
    if (!o || o.type !== 'pj') throw new Error('أمر العمل غير موجود.');
    if (s.role !== 'admin' && csv(me.hotel_ids).indexOf(o.hotel_id) === -1) throw new Error('هذه العملية ليست ضمن فنادقك.');
    if (o.accepted_at) throw new Error('استُلم أمر العمل: التعديل بعده أمر تغيير (لاحقاً).');
    if (o.status !== 'assigned') throw new Error('بدأ التنفيذ: لا يُعدَّل أمر العمل.');
    var title = String(d.title || '').trim(); if (!title) throw new Error('اكتب عنوان المشروع.');
    var day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(String(d.start || '')) || !day.test(String(d.end || '')) || d.end < d.start) throw new Error('حدّد مدة المشروع: من تاريخ إلى تاريخ.');
    var amt = Number(String(d.amount || '').replace(/[,،\s]/g, '')); if (!(amt > 0)) throw new Error('اكتب قيمة المشروع المتفق عليها بالريال.');
    var acts = projActs_(d.acts, d.start, d.end), spec = projSpec_(d), rq = String(d.req_name || '').trim();
    var c = Db.get('Contracts', o.equip), before = c ? { start: dayStr_(new Date(c.start)), end: dayStr_(new Date(c.end)), value: String(c.value) } : null;
    if (c) Db.update('Contracts', c.contract_id, { start: new Date(d.start + 'T00:00:00'), end: new Date(d.end + 'T00:00:00'), value: amt });
    var m = parse_(o.mod, null);
    Db.update('WorkOrders', woId, { symptom: title, description: String(d.description || '').trim(), floor_id: d.floor_id || '', room: d.room || '', quote: amt,
      acts: JSON.stringify(acts), terms: spec.terms, supply: spec.supply, mats: spec.mats, tools: spec.tools,
      requester: rq || o.issued_by || me.name || '', req_title: rq ? String(d.req_title || '').trim() : (o.issued_title || userTitle_(me, s.role)),
      docs: JSON.stringify(projDocs_(d.docs, parse_(o.docs, []))), mod: m ? JSON.stringify({ req: m.req, at: m.at, reply: 'عُدّل أمر العمل', rat: now_().getTime(), done: 1 }) : '' });
    log_(woId, me.name || s.id, 'edit', o.status, o.status, m ? m.req : '');
    return { c: c, before: before, after: { start: d.start, end: d.end, value: String(amt) }, req: m ? m.req : '' };
  }

  function projActs_(x, start, end) {
    x = x || {};
    var pk = {}, a = [], day = /^\d{4}-\d{2}-\d{2}$/;
    Object.keys(x.pk || {}).forEach(function (k) { var v = String(x.pk[k] || '').trim(); if (String(k).trim() && v) pk[String(k).trim()] = v; });
    (x.a || []).forEach(function (r, i) {
      var n = String((r && r.n) || '').trim(); if (!n) return;
      var p = String(r.p || '').trim(), c = String(r.c || '').trim(), dd = String(r.d || '').trim();
      if (!c && !(p && pk[p])) throw new Error('النشاط «' + n + '»: اكتب معيار قبوله، أو معياراً لحزمته.');
      if (dd && !day.test(dd)) throw new Error('النشاط «' + n + '»: موعد التسليم غير صحيح.');
      if (dd && (dd < start || dd > end)) throw new Error('النشاط «' + n + '»: موعد التسليم خارج مدة المشروع.');
      var w = String(r.w == null ? '' : r.w).trim();
      if (w !== '' && !(Number(w) > 0)) throw new Error('النشاط «' + n + '»: الوزن رقم أكبر من صفر.');
      a.push({ p: p, n: n, c: c, d: dd, w: w === '' ? '' : Number(w) });
    });
    if (!a.length) throw new Error('عرّف نطاق المشروع: نشاط واحد على الأقل بمعيار قبوله.');
    // الأوزان: كلها أو لا شيء (فارغة = بالتساوي)
    var nw = a.filter(function (r) { return r.w !== ''; }).length;
    if (nw && nw < a.length) throw new Error('اكتب وزن كل نشاط، أو اترك الأوزان كلها فارغة لتكون بالتساوي.');
    return { pk: pk, a: a };
  }

  /** أمر عمل مشروع (قرار صاحب المشروع 20 نوفمبر): عمل محدد النطاق والمدة لمتعهد مسجل أو لمنفذ جديد.
   *  المنفذ يُعطى عقداً من نوع «مشروع» بمدة المشروع وقيمته، فيدخل برقمه طوال المدة ويتوقف دخوله تلقائياً بعدها. */
  var ROLE_T_ = { admin: 'مشرف النظام', engineer: 'مهندس الصيانة', management: 'الإدارة', gm: 'مدير الفندق', om: 'مدير التشغيل', duty: 'المدير المناوب', fo: 'مشرف المكاتب الأمامية', supmgr: 'مدير الإشراف', sup: 'المشرف الميداني', fin: 'المالية' };
  /** المسمى الوظيفي من الحساب، وإلا وظيفة الدور */
  function userTitle_(u, role) { return String((u && u.title) || '').trim() || ROLE_T_[role || (u && u.role)] || ''; }

  function projCreate(s, d) {
    var me = Db.get('Users', s.id) || {};
    if (s.role !== 'admin' && csv(me.hotel_ids).indexOf(d.hotel_id) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    if (!Db.get('Hotels', d.hotel_id)) throw new Error('اختر الفندق.');
    var title = String(d.title || '').trim(); if (!title) throw new Error('اكتب عنوان المشروع.');
    var day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(String(d.start || '')) || !day.test(String(d.end || '')) || d.end < d.start) throw new Error('حدّد مدة المشروع: من تاريخ إلى تاريخ.');
    var amt = Number(String(d.amount || '').replace(/[,،\s]/g, '')); if (!(amt > 0)) throw new Error('اكتب قيمة المشروع المتفق عليها بالريال.');
    // النطاق نشاطاً نشاطاً: لكل نشاط معيار قبوله، أو معيار حزمته إن جُمعت الأنشطة في حزم (مربط الفرس في أمر العمل)
    var acts = projActs_(d.acts, d.start, d.end), spec = projSpec_(d);
    var conId = d.con_id || '', pin = null, con;
    if (conId) { con = Db.get('Contractors', conId); if (!con) throw new Error('المتعهد غير موجود.'); }
    else {
      var nm = String(d.name || '').trim(); if (!nm) throw new Error('اختر متعهداً مسجلاً أو اكتب اسم المنفذ.');
      var nk = conNameKey_(nm);
      con = Db.all('Contractors', function (c) { return conNameKey_(c.name) === nk; })[0];
      if (!con) { con = Db.insert('Contractors', { name: nm, type: 'pj', phone: String(d.phone || '').trim(), contact: '', emails: emails_(d.emails).join(','), failed: 0, lang: 'ar', active: true }); pin = Auth.setPin(con.con_id); }
      conId = con.con_id;
    }
    var ctr = Db.insert('Contracts', { con_id: conId, type: 'pj', hotel_ids: d.hotel_id, start: new Date(d.start + 'T00:00:00'), end: new Date(d.end + 'T00:00:00'), alert_days: 7, value: amt, created_at: now_() });
    // المُصدِر = المهندس من حسابه (الاسم والمسمى)، والطالب من يكتبه المهندس، وإلا فالمُصدِر نفسه
    var myTitle = userTitle_(me, s.role), rq = String(d.req_name || '').trim();
    var r = create({ hotel_id: d.hotel_id, type: 'pj', kind: 'project', source: 'engineer', con_id: conId, floor_id: d.floor_id || '', room: d.room || '',
      symptom: title, description: String(d.description || '').trim(), photos: d.photos || [], requester: rq || me.name || '' }, me.name || s.id);
    Db.update('WorkOrders', r.order.wo_id, { quote: amt, equip: ctr.contract_id, acts: JSON.stringify(acts),
      req_title: rq ? String(d.req_title || '').trim() : myTitle, issued_by: me.name || '', issued_title: myTitle,
      terms: spec.terms, supply: spec.supply, mats: spec.mats, tools: spec.tools, docs: JSON.stringify(projDocs_(d.docs, [])) });
    return { id: r.order.wo_id, contract_id: ctr.contract_id, con_id: conId, pin: pin, isNew: !!pin };
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

  /** بيانات أمر عمل المشروع للطباعة: المدة من عقد المشروع، والطالب والمُصدِر بوظيفتيهما */
  function pjInfo_(R, o, forCon) {
    var c = null; for (var i = 0; i < R.contracts.length; i++) if (R.contracts[i].contract_id === o.equip) { c = R.contracts[i]; break; }
    var d = function (x) { return x ? Utilities.formatDate(new Date(x), 'Asia/Riyadh', 'yyyy-MM-dd') : ''; };
    var docs = parse_(o.docs, []).filter(function (x) { return !forCon || x.v; });
    return { from: c ? d(c.start) : '', to: c ? d(c.end) : '', req_title: o.req_title || '', by: o.issued_by || '', by_title: o.issued_title || '',
      terms: parse_(o.terms, []), supply: o.supply || '', mats: parse_(o.mats, []), tools: parse_(o.tools, []), docs: docs,
      acc: o.accepted_at ? new Date(o.accepted_at).getTime() : null, accBy: o.accepted_by || '', needAcc: !!o.supply && !o.accepted_at,
      mod: parse_(o.mod, null), floor_id: o.floor_id || '', room: String(o.room || ''), description: o.description || '' };
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
      trapped: truthy(o.trapped), requester: o.requester || '', description: o.description || '', acts: o.type === 'pj' ? parse_(o.acts, null) : undefined, pj: o.type === 'pj' ? pjInfo_(R, o, forCon) : undefined,
      photos: csv(o.photos), reports: reports, quote: forCon ? '' : (o.quote || ''),
      decision: o.decision || '', decision_note: o.decision_note || '', note: note,
      reject_reason: (o.status === 'in_progress' || o.status === 'rejected') ? (o.reject_reason || '') : '',
      receipt: forCon ? '' : (o.receipt || ''), sat: forCon ? '' : (o.sat || ''),
      visits: Number(o.visits) || 0, work_minutes: Number(o.work_minutes) || 0, reopens: Number(o.reopens) || 0,
      follow_of: o.follow_of || '', resp: respOf_(o, contractOf_(R, o)),
      created: ms(o.created_at), assigned: ms(o.assigned_at), arrived: ms(o.arrived_at), rescued: ms(o.rescued_at),
      submitted: ms(o.submitted_at), decided: ms(o.decided_at), paid: forCon ? null : ms(o.paid_at),
      part_arrived: ms(o.part_arrived_at), closed: ms(o.closed_at), matchedBy: o.matched_by || '', matchedRole: o.matched_role || '', stopped: o.decision === 'stop', down_from: ms(o.down_from), down_to: ms(o.down_to),
      claimed_by: o.claimed_by || '', claimed_at: ms(o.claimed_at), tg: !!o.tg_msg,
      pay_pending: forCon ? false : truthy(o.pay_pending), repair_date: String(o.repair_date || ''),
      rfq: forCon ? null : ms(o.rfq_at), rfq_count: forCon ? 0 : (Number(o.rfq_count) || 0), quote_no: forCon ? '' : String(o.quote_no || ''), quote_at: forCon ? null : ms(o.quote_at)
    };
  }

  return {
    OPEN: OPEN, ms: ms, csv: csv, truthy: truthy, hotelByCode: hotelByCode, activeContract: activeContract,
    create: create, arrive: arrive, leave: leave, visitToday: visitToday, conSubmit: conSubmit, conNew: conNew, techReport: techReport, rescue: rescue,
    engAct: engAct, engCreate: engCreate, projCreate: projCreate, pjAccept: pjAccept, pjModReq: pjModReq, projEdit: projEdit, userTitle: userTitle_, refs: refs, contractOf: contractOf_, view: view, normRoom: normRoom
  };
})();
