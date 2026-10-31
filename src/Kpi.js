/**
 * Kpi.js — أعوان: حساب مؤشرات الأداء مسبقاً في KpiSummary (اللوحات تقرأ منه فقط).
 * المفتاح: المتعهد|الفندق|الشهر (شهر رفع الطلب). تُخزَّن مجاميع لا متوسطات، فتُجمع اللوحة أي فنادق أو أشهر.
 *   resp  : زمن الوصول بالدقائق (من الإسناد إلى الوصول) — الأقل أفضل
 *   ready : الجاهزية ٪ — أُغلق من أول مرة، بلا إعادة فتح، ولا تكرار عطل لنفس الموقع خلال نافذة التكرار
 *   info  : موثوقية المعلومات ٪ — تقارير قُبلت عند المراجعة بلا إعادة فتح ولا فحص مغاير ولا رفض
 *   sat   : رضا المتعاملين ٪ — تقييم المهندس عند الإغلاق (راضٍ 100، مقبول 50، غير راضٍ 0)
 */
var Kpi = (function () {
  var TZ = 'Asia/Riyadh';
  var SAT = { good: 100, ok: 50, bad: 0 };

  function month_(d) { return d ? Utilities.formatDate(new Date(d), TZ, 'yyyy-MM') : ''; }
  function prevMonth_(m) {
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1;
    if (mo === 0) { y--; mo = 12; }
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  }
  function locKey_(o) {
    if (o.type === 'el') return o.equip ? 'el|' + o.equip : '';
    return (o.floor_id || o.room) ? 'ac|' + (o.floor_id || '') + '|' + String(o.room || '') : '';
  }
  function windowDays_() { return Number(Db.setting('repeat_window_days')) || 30; }

  /** خريطة البنود: النص كما كُتب ← الاسم المعتمد (المعلّق يُحسب «أخرى») */
  function canon_() {
    var rows = Db.all('Lists'), byId = {}, map = {};
    rows.forEach(function (l) { byId[l.item_id] = l; });
    rows.forEach(function (l) {
      var name;
      if (l.status === 'active') name = l.ar;
      else if (l.status === 'merged' && byId[l.merged_into]) name = byId[l.merged_into].ar;
      else name = 'أخرى';
      map[l.type + '|' + l.list + '|' + l.ar] = name;
      if (l.orig) map[l.type + '|' + l.list + '|' + l.orig] = name;
    });
    return function (type, list, txt) {
      var k1 = type + '|' + list + '|' + txt, k2 = 'all|' + list + '|' + txt;
      return map[k1] || map[k2] || txt;
    };
  }

  function bump_(obj, k) { if (k) obj[k] = (obj[k] || 0) + 1; }
  function top_(obj, n) {
    var out = {};
    Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; }).slice(0, n).forEach(function (k) { out[k] = obj[k]; });
    return out;
  }

  function compute_(conId, hotelId, month, hotelOrders, canon) {
    var ms = Orders.ms, win = windowDays_() * 864e5, R = Orders.refs();
    var mine = hotelOrders.filter(function (o) { return o.con_id === conId && month_(o.created_at) === month; });
    var d = {
      orders: mine.length, closed: 0,
      respSum: 0, respN: 0, readyOk: 0, readyN: 0, infoOk: 0, infoN: 0, satSum: 0, satN: 0,
      trapped: 0, rescueSum: 0, rescueN: 0, rescueOk: 0, downMin: 0, downN: 0, pm: 0, respOk: 0, repairN: 0, repairOk: 0,
      repN: 0, okN: 0, qSum: 0, qN: 0, spend: 0, spendN: 0, okBy: {}, clSum: 0, clN: 0,
      acts: {}, parts: {}, causes: {}, syms: {}, locs: {}
    };
    mine.forEach(function (o) {
      // الاستجابة: الطلبات التي أُسندت له ووصل إليها (لا ما فتحه بنفسه)
      var C = Orders.contractOf(R, o) || {};
      if (o.source !== 'contractor' && o.arrived_at && o.assigned_at) {
        var rm = Math.max(0, (ms(o.arrived_at) - ms(o.assigned_at)) / 60000), urg = o.priority === 'urgent' || Orders.truthy(o.trapped);
        var tg = Number(urg ? C.resp_urgent : C.resp_normal) || 0;
        d.respSum += rm; d.respN++; if (!tg || rm <= tg) d.respOk++;
      }
      var reviewed = o.submitted_at && o.status !== 'matching' && o.status !== 'decision' && o.status !== 'quote';
      if (reviewed || Number(o.reopens) > 0) {
        d.infoN++;
        if (!(Number(o.reopens) > 0) && o.decision !== 'recheck' && o.status !== 'rejected') d.infoOk++;
      }
      if (o.kind === 'periodic') d.pm++;
      if (o.status === 'closed') {
        d.closed++;
        if (o.kind !== 'report' && o.kind !== 'periodic') {
          d.readyN++;
          var lk = locKey_(o), repeat = false;
          if (lk && o.closed_at) {
            var c = ms(o.closed_at);
            repeat = hotelOrders.some(function (x) {
              return x.wo_id !== o.wo_id && x.type === o.type && x.kind !== 'periodic' && x.follow_of !== o.wo_id && locKey_(x) === lk &&
                ms(x.created_at) > c && ms(x.created_at) <= c + win;
            });
          }
          if (!(Number(o.reopens) > 0) && !repeat) d.readyOk++;
          var sr = Number(C.sla_repair) || 0;
          if (sr && Number(o.work_minutes) > 0) { d.repairN++; if (Number(o.work_minutes) <= sr) d.repairOk++; }
        }
        if (SAT[o.sat] !== undefined) { d.satSum += SAT[o.sat]; d.satN++; }
      }
      if (Orders.truthy(o.trapped)) {
        d.trapped++;
        if (o.rescued_at) { var rs = Math.max(0, (ms(o.rescued_at) - ms(o.created_at)) / 60000); d.rescueSum += rs; d.rescueN++; if (rs <= (Number(C.sla_rescue) || 30)) d.rescueOk++; }
      }
      // موثوقية البلاغات (مؤشر داخلي لا يُحسب على المتعهد): ما رُفع ثم وُجد سليماً
      if (o.status === 'closed' && (o.source === 'requester' || o.source === 'engineer') && o.kind !== 'periodic' && o.kind !== 'report') {
        d.repN++;
        var rl = o.report; if (typeof rl === 'string') { try { rl = JSON.parse(rl); } catch (e) { rl = null; } }
        if (rl && !Array.isArray(rl)) rl = [rl];
        var lastR = (rl || []).filter(function (r) { return r && r.outcome !== 'visit'; }).slice(-1)[0];
        if (lastR && lastR.outcome === 'ok') { d.okN++; bump_(d.okBy, o.requester || (o.source === 'engineer' ? 'المهندس' : '')); }
      }
      // زمن عرض السعر (من طلبه بالبريد إلى وصوله) والقطع المعتمدة بقيمتها
      // زمن الاستلام: من رفع الطلب إلى «أستلمه» في تيليجرام
      if (o.claimed_at) { d.clSum += Math.max(0, (ms(o.claimed_at) - ms(o.created_at)) / 60000); d.clN++; }
      if (o.rfq_at && o.quote_at) { d.qSum += Math.max(0, (ms(o.quote_at) - ms(o.rfq_at)) / 36e5); d.qN++; }
      if (o.decision === 'con' && Number(o.quote) > 0 && o.status !== 'rejected') { d.spend += Number(o.quote); d.spendN++; }
      if (o.type === 'el' && o.down_from && o.down_to) { d.downMin += Math.max(0, (ms(o.down_to) - ms(o.down_from)) / 60000); d.downN++; }
      // أنماط الأعطال من آخر تقرير
      var reps = o.report;
      if (typeof reps === 'string') { try { reps = JSON.parse(reps); } catch (e) { reps = null; } }
      if (reps && !Array.isArray(reps)) reps = [reps];
      // آخر قيمة مكتوبة لكل حقل عبر تقارير العملية (التقرير المعاد قد لا يكررها)
      if (o.kind === 'periodic') return;   // الزيارة الدورية لا تدخل أنماط الأعطال؛ متابعاتها تدخل
      // الكشف الشهري: خدمات آخر تقرير فيه إجراء، للعمليات المغلقة بعد المطابقة فقط (لا تُحسب إعادة التسليم مرتين)
      if (o.status === 'closed') {
        var lastAct = null;
        (reps || []).forEach(function (r) { if (r && r.action && r.action.length) lastAct = r.action; });
        (lastAct || []).forEach(function (a) { bump_(d.acts, canon(o.type, 'action', a)); });
      }
      var part = '', cause = [], sym = '';
      (reps || []).forEach(function (r) {
        if (!r || ['fix', 'diag', 'comp'].indexOf(r.outcome) === -1) return;
        if (r.part) part = r.part; else if (r.outcome === 'comp' && !part) part = o.type === 'ac' ? 'الكمبروسر' : '';
        if (r.cause && r.cause.length) cause = r.cause;
        if (r.sym) sym = r.sym;
      });
      if (part) bump_(d.parts, canon(o.type, 'part', part));
      cause.forEach(function (c) { bump_(d.causes, canon(o.type, 'cause', c)); });
      if (sym || o.symptom) bump_(d.syms, canon(o.type, 'sym', sym || o.symptom));
      bump_(d.locs, o.type === 'el' ? o.equip : (o.room ? String(o.room) : ''));
    });
    d.qSum = Math.round(d.qSum); d.clSum = Math.round(d.clSum); d.okBy = top_(d.okBy, 5);
    d.respSum = Math.round(d.respSum); d.rescueSum = Math.round(d.rescueSum); d.downMin = Math.round(d.downMin);
    d.parts = top_(d.parts, 8); d.causes = top_(d.causes, 8); d.syms = top_(d.syms, 8); d.locs = top_(d.locs, 8);
    return d;
  }

  function save_(conId, hotelId, month, data) {
    var key = conId + '|' + hotelId + '|' + month;
    var rec = { con_id: conId, hotel_id: hotelId, month: 'm' + month, data: data, updated_at: new Date() };
    if (Db.find('KpiSummary', function (r) { return r.key === key; })) Db.update('KpiSummary', key, rec);
    else { rec.key = key; Db.insert('KpiSummary', rec); }
  }

  /** keys: [{con, hotel, month}] — يُحسب كل مفتاح والشهر الذي قبله (لأن التكرار يمتد عبر الشهر) */
  function refresh(keys) {
    var seen = {}, list = [];
    keys.forEach(function (k) {
      if (!k.con || !k.hotel || !k.month) return;
      [k.month, prevMonth_(k.month)].forEach(function (m) {
        var id = k.con + '|' + k.hotel + '|' + m;
        if (!seen[id]) { seen[id] = true; list.push({ con: k.con, hotel: k.hotel, month: m }); }
      });
    });
    if (!list.length) return 0;
    var canon = canon_(), byHotel = {};
    // شهر قديم قد تكون بعض عملياته مؤرشفة: يُضم الأرشيف (نادراً)
    var archMonth = month_(new Date(Date.now() - (typeof ARCHIVE_DAYS !== 'undefined' ? ARCHIVE_DAYS : 60) * 864e5));
    var needArch = list.some(function (k) { return k.month <= archMonth; });
    list.forEach(function (k) {
      if (!byHotel[k.hotel]) {
        var f = function (o) { return o.hotel_id === k.hotel; };
        byHotel[k.hotel] = Db.all('WorkOrders', f).concat(needArch ? Db.all('WorkOrdersArchive', f) : []);
      }
      var d = compute_(k.con, k.hotel, k.month, byHotel[k.hotel], canon);
      if (d.orders || Db.find('KpiSummary', function (r) { return r.key === k.con + '|' + k.hotel + '|' + k.month; })) save_(k.con, k.hotel, k.month, d);
    });
    return list.length;
  }

  /** مفاتيح العمليات المتأثرة، ومعها العمليات السابقة على نفس الموقع (التكرار يغيّر جاهزيتها) */
  function keysFor(woIds) {
    var keys = [];
    var win = windowDays_() * 864e5;
    woIds.forEach(function (id) {
      var o = Db.get('WorkOrders', id);
      if (!o) return;
      keys.push({ con: o.con_id, hotel: o.hotel_id, month: month_(o.created_at) });
      var lk = locKey_(o), t = Orders.ms(o.created_at);
      if (!lk) return;
      Db.all('WorkOrders', function (x) {
        return x.hotel_id === o.hotel_id && x.wo_id !== o.wo_id && x.closed_at && locKey_(x) === lk &&
          Orders.ms(x.closed_at) < t && Orders.ms(x.closed_at) >= t - win;
      }).forEach(function (x) { keys.push({ con: x.con_id, hotel: x.hotel_id, month: month_(x.created_at) }); });
    });
    return keys;
  }

  function touch(woIds) { try { return refresh(keysFor(woIds)); } catch (e) { return 0; } }

  /** إعادة حساب كل شيء (زر المشرف) */
  function rebuild() {
    var keys = {}, out = [];
    Db.all('WorkOrders').concat(Db.all('WorkOrdersArchive')).forEach(function (o) {
      if (!o.con_id) return;
      var k = o.con_id + '|' + o.hotel_id + '|' + month_(o.created_at);
      if (!keys[k]) { keys[k] = true; out.push({ con: o.con_id, hotel: o.hotel_id, month: month_(o.created_at) }); }
    });
    return refresh(out);
  }

  /** الصفوف المحسوبة لآخر n أشهر، مقصورة على فنادق أو متعهد */
  function rows(filter, n) {
    var since = month_(new Date(Date.now() - (n || 6) * 31 * 864e5));
    // الشهر من المفتاح (خلية الشهر قد يحوّلها الجدول لتاريخ)
    return Db.all('KpiSummary', function (r) { var m = String(r.key).split('|')[2] || ''; return m >= since && filter(r); }).map(function (r) {
      var d = r.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
      return { con: r.con_id, hotel: r.hotel_id, month: String(r.key).split('|')[2], d: d };
    });
  }

  function thresholds() {
    var out = {};
    Db.all('Thresholds').forEach(function (t) {
      (out[t.type] = out[t.type] || {})[t.kpi] = { full: Number(t.full), half: Number(t.half), weight: Number(t.weight) };
    });
    return out;
  }

  /** التشكيلة: مؤشرات كل نوع (القيمة من 100، والدرجة = مجموع القيمة × الوزن ÷ مجموع أوزان ما له عينة كافية) */
  var KPIS = { ac: ['resp', 'ready', 'info', 'sat', 'repair'], sf: ['resp', 'ready', 'info', 'sat', 'repair'], el: ['resp', 'rescue', 'ready', 'pm', 'info', 'sat'],
    wa: ['pickup', 'clean', 'wash'], pc: ['ontime', 'flagresp', 'traps'] };
  var MIN_N = 5;
  function pct(a, b) { return b ? Math.round(1000 * a / b) / 10 : null; }
  /** قيم المؤشرات وعيّناتها من مجاميع الملخص (التكييف والمصاعد والسلامة). pmExp = الزيارات الدورية المطلوبة */
  function values(z, pmExp) {
    var V = { resp: pct(z.respOk, z.respN), ready: pct(z.readyOk, z.readyN), info: pct(z.infoOk, z.infoN), sat: z.satN ? Math.round(10 * z.satSum / z.satN) / 10 : null,
      repair: pct(z.repairOk, z.repairN), rescue: pct(z.rescueOk, z.rescueN), pm: pmExp ? Math.min(100, pct(z.pm, pmExp)) : null };
    var N = { resp: z.respN, ready: z.readyN, info: z.infoN, sat: z.satN, repair: z.repairN, rescue: z.rescueN, pm: pmExp || 0 };
    return { V: V, N: N };
  }
  /** الدرجة المركّبة. w: {kpi: {weight}} */
  function score(type, V, N, w) {
    var ks = (KPIS[type] || Object.keys(V)).filter(function (k) { return V[k] != null && Number((w[k] || {}).weight) > 0; });
    var ok = ks.filter(function (k) { return (N[k] || 0) >= MIN_N || k === 'pm' || k === 'rescue'; }), small = false;
    if (!ok.length) { ok = ks; small = ks.length > 0; }
    var sw = 0, s = 0;
    ok.forEach(function (k) { var wt = Number(w[k].weight); sw += wt; s += wt * V[k]; });
    return { score: sw ? Math.round(10 * s / sw) / 10 : null, used: ok, small: small };
  }
  /** التصنيف من عتبات العقد */
  function cls(v, c) {
    if (v == null) return '';
    c = c || {}; var ex = Number(c.cls_ex) || 90, gd = Number(c.cls_good) || 80, okk = Number(c.cls_ok) || 70;
    return v >= ex ? 'ex' : v >= gd ? 'good' : v >= okk ? 'ok' : 'low';
  }
  function clsOf(conId) {
    var best = null;
    Db.all('Contracts', function (c) { return c.con_id === conId; }).forEach(function (c) { if (!best || Orders.ms(c.created_at) > Orders.ms(best.created_at)) best = c; });
    return { ex: Number(best && best.cls_ex) || 90, good: Number(best && best.cls_good) || 80, ok: Number(best && best.cls_ok) || 70 };
  }

  return { KPIS: KPIS, MIN_N: MIN_N, values: values, score: score, cls: cls, clsOf: clsOf, refresh: refresh, touch: touch, keysFor: keysFor, rebuild: rebuild, rows: rows, thresholds: thresholds, month: month_ };
})();
