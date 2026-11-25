/**
 * Records.js — أعوان: سجلات المعدات (قرار صاحب المشروع 26 نوفمبر 2026).
 *  معلومات تاريخية لا أداء: تُبنى من العمليات المسجّلة نفسها بلا إدخال جديد، مرتبةً حول المعدة لا العملية.
 *  نبدأ بالمصاعد: ملخص لكل مصعد · خط زمني للمصعد · القطع المستبدلة لفترة. والبنية تتسع لبقية الفئات.
 */
var Records = (function () {
  var TZ = 'Asia/Riyadh', DAY = 864e5;
  function ms(d) { return Orders.ms(d); }
  function day_(t) { return t ? Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd') : ''; }
  function parse_(v, def) { if (v && typeof v === 'object') return v; try { return JSON.parse(v || ''); } catch (e) { return def; } }
  function hit_(equip, name) { return String(equip || '').split('، ').indexOf(name) !== -1; }
  var OUT_ = { fix: 'تم الإصلاح', ok: 'سليم', visit: 'زيارة', diag: 'يحتاج قطعة', report: 'تقرير فني', pm: 'صيانة دورية', lead: 'إلى قائد الفريق' };

  /** القطع المعتمدة لعملية مصاعد: من آخر تشخيص (أو تقرير فني بقطعة)، وتُثبَّت في تقرير الإصلاح (rparts) */
  function partsOf_(reports) {
    var fx = reports.filter(function (r) { return r && r.outcome === 'fix' && (r.rparts || []).length; }).pop();
    if (fx) return fx.rparts;
    var dg = reports.filter(function (r) { return r && (r.outcome === 'diag' || r.outcome === 'report') && ((r.rec || []).length || (r.parts || []).length); }).pop();
    return dg ? (dg.rec && dg.rec.length ? dg.rec : dg.parts) : [];
  }

  /** hotelIds: نطاق المستخدم · hid: فندق واحد · from/to: yyyy-MM-dd · forCon: بلا قيم */
  function elevators(hotelIds, hid, from, to, forCon) {
    if (hotelIds.indexOf(hid) === -1) throw new Error('الفندق ليس ضمن فنادقك.');
    var day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(String(from || '')) || !day.test(String(to || '')) || to < from) throw new Error('حدّد الفترة: من تاريخ إلى تاريخ.');
    var t0 = new Date(from + 'T00:00:00+03:00').getTime(), t1 = new Date(to + 'T23:59:59+03:00').getTime(), now = Date.now();
    var names = Db.all('Elevators', function (e) { return e.hotel_id === hid; }).map(function (e) { return String(e.name); });
    var pick = function (o) { return o.hotel_id === hid && o.type === 'el'; };
    var archFrom = now - 60 * DAY;
    var list = Db.all('WorkOrders', pick).concat(t0 < archFrom ? Db.all('WorkOrdersArchive', pick) : []);
    var E = {}; names.forEach(function (n) { E[n] = { name: n, faults: 0, trapped: 0, down: 0, downNow: false, parts: 0, value: 0, lastPm: null, events: [] }; });
    var parts = [], inR = function (t) { return t && t >= t0 && t <= t1; };
    list.forEach(function (o) {
      var units = String(o.equip || '').split('، ').filter(function (n) { return E[n]; });
      var reps = parse_(o.report, []); if (!Array.isArray(reps)) reps = reps ? [reps] : [];
      var c = ms(o.created_at), stop = o.decision === 'stop';
      // الصيانة الدورية: زيارة واحدة لعدة مصاعد (units في التقرير)
      reps.forEach(function (r) {
        if (!r || !inR(r.at)) return;
        if (r.outcome === 'pm') {
          (r.units || []).forEach(function (u) {
            if (!E[u]) return; var g = String((r.grid || {})[u] || ''), oN = (g.match(/o/g) || []).length;
            E[u].lastPm = Math.max(E[u].lastPm || 0, r.at);
            E[u].events.push({ at: r.at, k: 'pm', t: 'صيانة دورية', d: (oN ? oN + ' بند يحتاج متابعة' : 'كل البنود سليمة') + ((r.working || {})[u] === 'لا' ? ' · متوقف' : ''), id: o.wo_id });
          });
          if (String(r.replaced || '').trim()) parts.push({ at: r.at, el: (r.units || []).join('، '), part: String(r.replaced).trim(), by: 'الصيانة الدورية', value: '', id: o.wo_id });
          return;
        }
        units.forEach(function (u) { E[u].events.push({ at: r.at, k: r.outcome, t: OUT_[r.outcome] || r.outcome, d: [(r.rec || []).join('، '), r.note || '', r.working ? 'يعمل الآن: ' + r.working : ''].filter(String).join(' · '), id: o.wo_id }); });
      });
      if (o.kind === 'periodic') return;
      // العطل نفسه (ليس الموقوف بقرار المهندس)
      if (inR(c) && !stop && o.kind !== 'report') units.forEach(function (u) {
        E[u].faults++; if (Orders.truthy(o.trapped)) E[u].trapped++;
        E[u].events.push({ at: c, k: Orders.truthy(o.trapped) ? 'trap' : 'fault', t: Orders.truthy(o.trapped) ? 'احتجاز' : 'عطل', d: [o.symptom || '', o.requester ? 'الرافع: ' + o.requester : ''].filter(String).join(' · '), id: o.wo_id });
      });
      // التوقف داخل الفترة (يعمل الآن: لا ← نعم)
      var df = ms(o.down_from), dt = ms(o.down_to) || (df ? now : 0);
      if (df) { var a = Math.max(df, t0), b = Math.min(dt, t1); if (b > a) units.forEach(function (u) { E[u].down += (b - a) / DAY; if (!ms(o.down_to)) E[u].downNow = true; }); }
      // القطع المستبدلة: قرار توريد (المتعهد أو فريقنا) ثم تم الإصلاح
      if ((o.decision === 'con' || o.decision === 'own') && !stop) {
        var fx = reps.filter(function (r) { return r && r.outcome === 'fix'; }).pop(), at = fx ? fx.at : ms(o.closed_at);
        if (inR(at)) {
          var ps = partsOf_(reps), v = o.decision === 'con' ? Number(o.quote) || 0 : 0;
          if (ps.length) {
            parts.push({ at: at, el: units.join('، ') || String(o.equip || ''), part: ps.join('، '), by: o.decision === 'con' ? 'المتعهد' : 'فريقنا', value: forCon ? '' : v, id: o.wo_id });
            units.forEach(function (u) { E[u].parts += ps.length; if (!forCon) E[u].value += v / Math.max(1, units.length); E[u].events.push({ at: at, k: 'part', t: 'استبدال قطعة', d: ps.join('، ') + ' · ' + (o.decision === 'con' ? 'وفّرها المتعهد' : 'من فريقنا'), id: o.wo_id }); });
          }
        }
      }
    });
    names.forEach(function (n) { var x = E[n]; x.down = Math.round(x.down * 10) / 10; x.value = Math.round(x.value); x.events.sort(function (a, b) { return b.at - a.at; }); });
    parts.sort(function (a, b) { return b.at - a.at; });
    var ctr = Orders.activeContract(hid, 'el');
    return { from: from, to: to, hotel: (Db.get('Hotels', hid) || {}).name || '', elevators: names.map(function (n) { return E[n]; }), parts: parts,
      total: forCon ? '' : parts.reduce(function (s, p) { return s + (Number(p.value) || 0); }, 0),
      ctr: ctr ? { from: day_(ctr.start), to: day_(ctr.end) } : null };
  }

  return { elevators: elevators, partsOf: partsOf_ };
})();
