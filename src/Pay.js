/**
 * Pay.js — أعوان: طريقة سداد العقد والمطالبات والدفعات.
 *  - عند العقد: القيمة، وطريقة السداد (sched دفعات مجدولة · monthly فاتورة شهرية ثابتة · stmt حسب الكشف)، ومهلة السداد بالأيام.
 *  - المتعهد يرفع مطالبة (فاتورة + مرفق) لبند مستحق، ولا يرى السداد ولا الجدول: يرى «مرفوعة / مغلقة / مرفوضة».
 *  - مالك الخدمة يعتمد أو يرفض (شرط قبل السداد)، والمالية تسجّل السداد.
 *  - التأخير: من الاستحقاق (أو من تاريخ رفع المطالبة إن جاءت بعده) إلى السداد أو اليوم.
 */
var Pay = (function () {
  var TZ = 'Asia/Riyadh';
  var MODES = { sched: 'دفعات مجدولة', monthly: 'فاتورة شهرية', stmt: 'حسب الكشف' };
  var LIVE = ['submitted', 'approved', 'paid'];

  function ms(d) { return Orders.ms(d); }
  function day_(t) { return t ? Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd') : ''; }
  function today_() { return day_(new Date()); }
  function isDay_(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
  function dayV_(v) { return v instanceof Date ? day_(v) : String(v || '').slice(0, 10); }
  function addDays_(d, n) { var t = new Date(d + 'T12:00:00+03:00'); return day_(new Date(t.getTime() + n * 864e5)); }
  function diff_(a, b) { return Math.round((new Date(b + 'T12:00:00+03:00') - new Date(a + 'T12:00:00+03:00')) / 864e5); }
  function monthEnd_(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); var d = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return m + '-' + (d < 10 ? '0' : '') + d; }
  function nextM_(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) + 1; if (mo > 12) { y++; mo = 1; } return y + '-' + (mo < 10 ? '0' : '') + mo; }
  function owner(type) { return type === 'wa' || type === 'pc' ? 'supmgr' : type === 'wt' ? 'gm' : 'engineer'; }
  function planOf(c) { var v = c && c.pay_plan; if (typeof v === 'string') { try { v = JSON.parse(v || 'null'); } catch (e) { v = null; } } return v; }
  function round_(n) { return Math.round(Number(n) * 100) / 100; }

  /** بنود الاستحقاق للعقد: [{key, label, due, expected}] — الشهرية حتى الشهر الحالي فقط */
  function items(c) {
    var mode = c.pay_mode, days = Number(c.pay_days) || 30, plan = planOf(c), out = [];
    if (mode === 'sched') {
      (Array.isArray(plan) ? plan : []).forEach(function (p, i) { out.push({ key: 'i' + (i + 1), label: 'الدفعة ' + (i + 1), due: p.due, expected: round_(p.amount) }); });
    } else if (mode === 'monthly' || mode === 'stmt') {
      var s = day_(c.start).slice(0, 7), e = (c.end ? day_(c.end) : today_()).slice(0, 7), cur = today_().slice(0, 7);
      if (e > cur) e = cur;
      for (var m = s; m && m <= e; m = nextM_(m)) out.push({ key: m, label: m, due: addDays_(monthEnd_(m), days), expected: mode === 'monthly' && plan ? round_(plan.amount) : null, month: m });
    }
    return out;
  }

  /** مشرف النظام: طريقة السداد للعقد. d: {value, mode, days, plan: [{due, amount}] | {amount}} */
  function setup(contractId, d) {
    var c = Db.get('Contracts', contractId);
    if (!c) throw new Error('العقد غير موجود.');
    d = d || {};
    var mode = d.mode, value = round_(d.value || 0), days = Math.max(0, Math.min(180, parseInt(d.days, 10) || 0)), plan = null;
    if (!MODES[mode]) throw new Error('اختر طريقة السداد.');
    if (mode === 'sched') {
      plan = (d.plan || []).filter(function (p) { return p && (p.due || p.amount); }).map(function (p, i) {
        if (!isDay_(p.due)) throw new Error('الدفعة ' + (i + 1) + ': حدّد تاريخ الاستحقاق.');
        if (!(Number(p.amount) > 0)) throw new Error('الدفعة ' + (i + 1) + ': اكتب المبلغ.');
        return { due: p.due, amount: round_(p.amount) };
      }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
      if (!plan.length) throw new Error('أضف دفعة واحدة على الأقل.');
      if (!(value > 0)) throw new Error('اكتب قيمة العقد.');
      var sum = round_(plan.reduce(function (a, p) { return a + p.amount; }, 0));
      if (Math.abs(sum - value) > 1) throw new Error('مجموع الدفعات (' + sum + ') لا يساوي قيمة العقد (' + value + ').');
    } else if (mode === 'monthly') {
      var amt = round_((d.plan || {}).amount || 0);
      if (!(amt > 0)) throw new Error('اكتب قيمة الفاتورة الشهرية.');
      plan = { amount: amt };
    }
    Db.update('Contracts', contractId, { value: value || '', pay_mode: mode, pay_days: days, pay_plan: plan ? JSON.stringify(plan) : '' });
    return { mode: mode };
  }

  function claimsOf_(pred) { return Db.all('Claims', pred); }
  function liveFor_(contractId) {
    var m = {};
    claimsOf_(function (x) { return x.contract_id === contractId && LIVE.indexOf(x.status) !== -1; }).forEach(function (x) { m[x.item] = x; });
    return m;
  }

  /** للمتعهد: البنود التي يمكن رفع مطالبة لها (بلا مبالغ) */
  function claimable(conId) {
    var R = Orders.refs(), out = [];
    R.contracts.forEach(function (c) {
      if (c.con_id !== conId || !MODES[c.pay_mode]) return;
      var live = liveFor_(c.contract_id);
      items(c).forEach(function (it) {
        if (live[it.key]) return;
        out.push({ contract_id: c.contract_id, type: c.type, key: it.key, label: it.label, month: it.month || '', due: it.due,
          hotels: Orders.csv(c.hotel_ids).map(function (h) { return (R.hotels[h] || {}).name || ''; }).join('، ') });
      });
    });
    return out;
  }

  /** المتوقع للبند: من الجدول، أو من الكشف (التكييف والمياه) للشهر */
  function expected_(c, it) {
    if (it.expected != null) return it.expected;
    if (c.pay_mode !== 'stmt' || !it.month) return null;
    var hs = Orders.csv(c.hotel_ids), from = it.month + '-01', to = monthEnd_(it.month);
    try {
      if (c.type === 'wt') return Water.statement(hs, c.con_id, 'all', from, to).total;
      if (c.type === 'ac') return statementCore_(hs, c.con_id, from, to).total;
    } catch (e) { }
    return null;
  }

  /** d: {contract_id, item, amount, invoice, note, by, att: [fileIds]} */
  function submit(conId, d) {
    d = d || {};
    var c = Db.get('Contracts', d.contract_id);
    if (!c || c.con_id !== conId) throw new Error('العقد غير موجود.');
    var it = items(c).filter(function (x) { return x.key === d.item; })[0];
    if (!it) throw new Error('اختر البند المستحق.');
    if (liveFor_(c.contract_id)[it.key]) throw new Error('رُفعت مطالبة لهذا البند من قبل.');
    var amount = round_(d.amount || 0);
    if (!(amount > 0)) throw new Error('اكتب مبلغ المطالبة.');
    var inv = String(d.invoice || '').trim();
    if (!inv) throw new Error('اكتب رقم الفاتورة.');
    if (claimsOf_(function (x) { return x.con_id === conId && String(x.invoice_no).trim() === inv && x.status !== 'rejected'; }).length) throw new Error('رقم الفاتورة ' + inv + ' مسجّل من قبل.');
    if (!(d.att || []).length) throw new Error('أرفق الفاتورة (صورة أو PDF).');
    var x = Db.insert('Claims', { contract_id: c.contract_id, con_id: conId, type: c.type, item: it.key, label: it.label, due: it.due, amount: amount,
      expected: (function () { var e = expected_(c, it); return e == null ? '' : e; })(), invoice_no: inv, att: (d.att || []).join(','), note: String(d.note || '').trim(),
      by_name: String(d.by || '').trim(), created_at: new Date(), status: 'submitted' });
    return x.claim_id;
  }

  /** للمتعهد: مطالباته بحالة مبسطة (لا سداد) */
  function conList(conId) {
    return claimsOf_(function (x) { return x.con_id === conId; }).map(function (x) {
      return { id: x.claim_id, type: x.type, label: x.label, amount: Number(x.amount) || 0, invoice: String(x.invoice_no || ''), created: ms(x.created_at),
        status: x.status === 'submitted' ? 'submitted' : x.status === 'rejected' ? 'rejected' : 'closed', reason: x.status === 'rejected' ? (x.reason || '') : '' };
    }).sort(function (a, b) { return b.created - a.created; });
  }

  var FIN = ['fin', 'admin'], ALL = ['fin', 'admin', 'management'];
  function canOwn_(s, c, scope) {
    if (s.role === 'admin') return true;
    if (s.role !== owner(c.type)) return false;
    return Orders.csv(c.hotel_ids).some(function (h) { return scope.indexOf(h) !== -1; });
  }
  function sees_(s, c, scope) { return ALL.indexOf(s.role) !== -1 || canOwn_(s, c, scope); }

  /** لوحة المطالبات والسداد: البنود كلها (المصفوفة) + المعلّق للاعتماد + المعلّق للسداد */
  function board(s, scope) {
    var R = Orders.refs(), td = today_(), rows = [], conts = [];
    var byC = {};
    claimsOf_(function () { return true; }).forEach(function (x) { (byC[x.contract_id] = byC[x.contract_id] || []).push(x); });
    R.contracts.forEach(function (c) {
      if (!MODES[c.pay_mode] || !sees_(s, c, scope)) return;
      var cl = byC[c.contract_id] || [], live = {}, rej = {};
      cl.forEach(function (x) { if (LIVE.indexOf(x.status) !== -1) live[x.item] = x; else rej[x.item] = x; });
      var con = R.cons[c.con_id] || {}, hn = Orders.csv(c.hotel_ids).map(function (h) { return (R.hotels[h] || {}).name || ''; }).join('، ');
      conts.push({ id: c.contract_id, con: con.name || '', con_id: c.con_id, type: c.type, hotels: hn, hotel_ids: Orders.csv(c.hotel_ids), value: Number(c.value) || 0,
        mode: c.pay_mode, modeL: MODES[c.pay_mode], days: Number(c.pay_days) || 0, start: day_(c.start), end: day_(c.end), own: canOwn_(s, c, scope) });
      items(c).forEach(function (it) {
        var x = live[it.key], st = x ? x.status : 'none', from = it.due;
        if (x && day_(x.created_at) > from) from = day_(x.created_at);
        var paid = x && x.status === 'paid' ? dayV_(x.paid_at) : '', delay = 0;
        if (x) delay = Math.max(0, diff_(from, paid || td));
        rows.push({ c: c.contract_id, key: it.key, label: it.label, due: it.due, month: it.due.slice(0, 7), expected: x && x.expected !== '' ? Number(x.expected) : it.expected,
          st: st, delay: delay, overdue: !!x && st !== 'paid' && td > from,
          claim: x ? { id: x.claim_id, amount: Number(x.amount) || 0, invoice: String(x.invoice_no || ''), att: Orders.csv(x.att), note: x.note || '', by: x.by_name || '',
            at: ms(x.created_at), okBy: x.ok_by || '', okAt: ms(x.ok_at) || null, paid: paid, ref: x.paid_ref || '', payBy: x.paid_by || '', payNote: x.paid_note || '' } : null,
          lastRej: !x && rej[it.key] ? (rej[it.key].reason || '') : '' });
      });
    });
    return { contracts: conts, rows: rows, today: td, canPay: FIN.indexOf(s.role) !== -1, role: s.role, modes: MODES };
  }

  function decide(s, scope, id, ok, reason) {
    var x = Db.get('Claims', id);
    if (!x) throw new Error('المطالبة غير موجودة.');
    var c = Db.get('Contracts', x.contract_id);
    if (!c || !canOwn_(s, c, scope)) throw new Error('اعتماد المطالبة لمالك الخدمة.');
    if (x.status !== 'submitted') throw new Error('المطالبة ليست بانتظار الاعتماد.');
    reason = String(reason || '').trim();
    if (!ok && !reason) throw new Error('اكتب سبب الرفض.');
    var me = Db.get('Users', s.id) || {};
    Db.update('Claims', id, { status: ok ? 'approved' : 'rejected', reason: ok ? '' : reason, ok_by: me.name || s.name || '', ok_role: s.role, ok_at: new Date() });
  }

  /** المالية: تسجيل السداد لمطالبة معتمدة. d: {date, ref, note} */
  function pay(s, id, d) {
    if (FIN.indexOf(s.role) === -1) throw new Error('تسجيل السداد للمالية.');
    var x = Db.get('Claims', id);
    if (!x) throw new Error('المطالبة غير موجودة.');
    if (x.status !== 'approved') throw new Error('السداد بعد اعتماد مالك الخدمة فقط.');
    d = d || {};
    if (!isDay_(d.date) || d.date > today_()) throw new Error('حدّد تاريخ السداد (اليوم أو قبله).');
    var ref = String(d.ref || '').trim();
    if (!ref) throw new Error('اكتب رقم الحوالة أو الشيك.');
    var me = Db.get('Users', s.id) || {};
    Db.update('Claims', id, { status: 'paid', paid_at: d.date, paid_ref: ref, paid_note: String(d.note || '').trim(), paid_by: me.name || '' });
  }

  return { MODES: MODES, owner: owner, items: items, setup: setup, claimable: claimable, submit: submit, conList: conList, board: board, decide: decide, pay: pay, planOf: planOf };
})();
