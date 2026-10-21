/**
 * Mail.js — أعوان: البريد الصادر بهوية نوازي (كحلي وبيج).
 *  - طلب عرض سعر لشركة المصاعد بعد مراجعة المهندس للتشخيص. الرد يصل لبريد المهندس (replyTo + نسخة).
 * يحتاج إذن الإرسال مرة واحدة: شغّل authorizeAwan من محرر السكربت بحساب الصيانة.
 */
var Mail = (function () {
  var NAVY = '#1F3A5F', BEIGE = '#EFE7D6', SAND = '#F6F3ED', GOLD = '#B39B6E', INK = '#4A5A70';
  var FONT = "'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif";

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function lastReport_(o) {
    var reps = o.report;
    if (typeof reps === 'string') { try { reps = JSON.parse(reps); } catch (e) { reps = []; } }
    if (reps && !Array.isArray(reps)) reps = [reps];
    return (reps || []).filter(function (r) { return r && r.outcome === 'diag'; }).slice(-1)[0] || {};
  }

  function row_(k, v) {
    if (!v || (Array.isArray(v) && !v.length)) return '';
    return '<tr><td style="padding:10px 14px;border-bottom:1px solid ' + BEIGE + ';color:' + INK + ';width:34%;vertical-align:top">' + esc(k) + '</td>' +
      '<td style="padding:10px 14px;border-bottom:1px solid ' + BEIGE + ';color:' + NAVY + ';font-weight:bold">' + esc(Array.isArray(v) ? v.join('، ') : v) + '</td></tr>';
  }

  /** {to, cc, subject, html, text} لطلب عرض السعر */
  function rfq(o, me) {
    var con = Db.get('Contractors', o.con_id) || {};
    var h = Db.get('Hotels', o.hotel_id) || {};
    var to = Orders.csv(con.emails);
    if (!to.length) throw new Error('لا يوجد بريد لـ ' + (con.name || 'المتعهد') + '. أضفه من المتعهدون والعقود ← بيانات التواصل.');
    if (!me || !me.email) throw new Error('أضف بريدك في المستخدمين ليصلك رد عرض السعر.');
    var r = lastReport_(o);
    var photos = Orders.csv(o.photos);
    var subject = 'طلب عرض سعر | ' + o.wo_id + ' | ' + (h.name || '') + ' | ' + (o.equip || '');
    var html = '<div dir="rtl" style="background:' + SAND + ';padding:24px 12px;font-family:' + FONT + '">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ' + BEIGE + '">' +
      '<tr><td style="background:' + NAVY + ';padding:22px 26px;color:#ffffff">' +
      '<div style="font-size:22px;font-weight:bold">نوازي للفنادق والاستثمار</div>' +
      '<div style="font-size:13px;color:' + BEIGE + ';direction:ltr;text-align:right">Nawazi For Hotels &amp; Investment</div></td></tr>' +
      '<tr><td style="height:4px;background:' + GOLD + '"></td></tr>' +
      '<tr><td style="padding:24px 26px;color:' + NAVY + ';font-size:15px;line-height:1.8">' +
      '<div style="font-size:19px;font-weight:bold;margin-bottom:6px">طلب عرض سعر</div>' +
      '<p style="margin:0 0 14px">السادة / ' + esc(con.name || '') + '<br>السلام عليكم ورحمة الله وبركاته،<br>نأمل تزويدنا بعرض سعر للقطعة الموصى باستبدالها حسب تشخيص فنيكم أدناه.</p>' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ' + BEIGE + ';border-radius:10px;border-collapse:separate;font-size:14px">' +
      row_('رقم العملية', o.wo_id) + row_('الفندق', h.name) + row_('المصعد', o.equip) +
      row_('الملاحظة', r.sym || o.symptom) + row_('الجزء المعطّل', r.part) + row_('السبب', r.cause) +
      row_('القطعة الموصى باستبدالها', r.rec) + row_('ملاحظة الفني', r.note) + '</table>' +
      (photos.length ? '<p style="margin:14px 0 0;font-size:14px">الصور: ' + photos.map(function (id, i) { return '<a style="color:' + NAVY + '" href="https://drive.google.com/file/d/' + esc(id) + '/view">صورة ' + (i + 1) + '</a>'; }).join(' · ') + '</p>' : '') +
      '<div style="margin:18px 0 0;padding:12px 14px;background:' + BEIGE + ';border-radius:10px;font-size:14px">نرجو الرد على هذه الرسالة بعرض السعر، مع ذكر رقم العملية <b dir="ltr">' + esc(o.wo_id) + '</b>.</div>' +
      '<p style="margin:18px 0 0;font-size:14px">مع التحية،<br><b>' + esc(me.name || '') + '</b><br>مهندس الصيانة · ' + esc(h.name || '') + '</p>' +
      '</td></tr><tr><td style="padding:12px 26px;background:' + SAND + ';color:' + INK + ';font-size:12px">أُرسلت من منصة أعوان للمتعهدين · نوازي للفنادق والاستثمار</td></tr></table></div>';
    var text = 'طلب عرض سعر\nرقم العملية: ' + o.wo_id + '\nالفندق: ' + (h.name || '') + '\nالمصعد: ' + (o.equip || '') +
      '\nالقطعة الموصى باستبدالها: ' + (r.rec || []).join('، ') + '\nنرجو الرد بعرض السعر مع ذكر رقم العملية.\n' + (me.name || '');
    return { to: to.join(','), cc: me.email, subject: subject, html: html, text: text };
  }

  /** إشعار لإدارة المتعهد: تم السداد، أو الإصلاح قبل السداد */
  function notice(kind, o, me, extra) {
    var con = Db.get('Contractors', o.con_id) || {}, h = Db.get('Hotels', o.hotel_id) || {};
    var to = Orders.csv(con.emails);
    if (!to.length) return null;
    var paid = kind === 'paid';
    var title = paid ? 'إشعار سداد' : 'اعتماد الإصلاح قبل السداد';
    var intro = paid ? 'نفيدكم بإتمام سداد قيمة القطعة حسب عرض سعركم، ويمكن لفريقكم البدء بالتوريد والتركيب.'
      : 'تم الاتفاق على البدء بالإصلاح قبل استكمال السداد حتى لا يتوقف المصعد، ويُستكمل السداد حسب الإجراءات.';
    var subject = title + ' | ' + o.wo_id + ' | ' + (h.name || '') + ' | ' + (o.equip || '');
    var html = '<div dir="rtl" style="background:' + SAND + ';padding:24px 12px;font-family:' + FONT + '">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ' + BEIGE + '">' +
      '<tr><td style="background:' + NAVY + ';padding:22px 26px;color:#ffffff"><div style="font-size:22px;font-weight:bold">نوازي للفنادق والاستثمار</div>' +
      '<div style="font-size:13px;color:' + BEIGE + ';direction:ltr;text-align:right">Nawazi For Hotels &amp; Investment</div></td></tr><tr><td style="height:4px;background:' + GOLD + '"></td></tr>' +
      '<tr><td style="padding:24px 26px;color:' + NAVY + ';font-size:15px;line-height:1.8"><div style="font-size:19px;font-weight:bold;margin-bottom:6px">' + title + '</div>' +
      '<p style="margin:0 0 14px">السادة / ' + esc(con.name || '') + '<br>السلام عليكم ورحمة الله وبركاته،<br>' + intro + '</p>' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ' + BEIGE + ';border-radius:10px;border-collapse:separate;font-size:14px">' +
      row_('رقم العملية', o.wo_id) + row_('الفندق', h.name) + row_('المصعد', o.equip) + row_('عرض السعر', (o.quote_no ? o.quote_no + ' · ' : '') + (o.quote ? o.quote + ' ريال' : '')) +
      (paid ? row_('رقم الإيصال', extra) : row_('موعد الإصلاح', extra)) + '</table>' +
      '<p style="margin:18px 0 0;font-size:14px">يسجّل فنيكم الإصلاح في أعوان بعد التركيب.<br>مع التحية،<br><b>' + esc(me.name || '') + '</b><br>مهندس الصيانة · ' + esc(h.name || '') + '</p>' +
      '</td></tr><tr><td style="padding:12px 26px;background:' + SAND + ';color:' + INK + ';font-size:12px">أُرسلت من منصة أعوان للمتعهدين · نوازي للفنادق والاستثمار</td></tr></table></div>';
    return { to: to.join(','), cc: me.email || '', subject: subject, html: html, text: title + '\n' + o.wo_id + '\n' + intro };
  }

  function send(m, replyTo) {
    MailApp.sendEmail({ to: m.to, cc: m.cc || '', replyTo: replyTo || m.cc || '', name: 'نوازي للفنادق والاستثمار', subject: m.subject, htmlBody: m.html, body: m.text });
  }

  return { rfq: rfq, notice: notice, send: send };
})();

/** يُشغَّل مرة واحدة من محرر السكربت بحساب الصيانة لمنح إذن إرسال البريد */
function authorizeAwan() {
  return 'المتبقي من البريد اليوم: ' + MailApp.getRemainingDailyQuota();
}
