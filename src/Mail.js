/**
 * Mail.js — أعوان: البريد الصادر بهوية نوازي (كحلي وبيج)، عربي يميناً وإنجليزي يساراً.
 *  - طلب عرض سعر لشركة المصاعد بعد مراجعة المهندس (تفاصيل العطل فقط؛ التشخيص من فنيهم).
 *  - إشعار السداد، واعتماد الإصلاح قبل السداد.
 * الرد يصل لبريد المهندس (replyTo + نسخة). إذن الإرسال مرة واحدة: شغّل authorizeAwan من محرر السكربت.
 */
var Mail = (function () {
  var NAVY = '#1F3A5F', BEIGE = '#EFE7D6', SAND = '#F6F3ED', GOLD = '#B39B6E', INK = '#4A5A70', KHAKI = '#7A6844', DEEP = '#5C4E33';
  var FONT = "'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif";
  var BRAND_AR = 'نوازي للفندقة والاستثمار', BRAND_EN = 'Nawazi For Hotels & Investment';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function when_(d) { return d ? Utilities.formatDate(new Date(d), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm') : ''; }
  /** الترجمة الإنجليزية لبند من القوائم المعتمدة (الملاحظة مثلاً) */
  function en_(ar) {
    var l = Db.find('Lists', function (x) { return x.ar === ar && x.en && x.status === 'active'; });
    return l ? String(l.en) : '';
  }

  /** عمودان: عربي يميناً وإنجليزي يساراً */
  function bi_(ar, en, styleAr, styleEn) {
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>' +
      '<td dir="rtl" align="right" valign="top" style="width:50%;padding-left:10px;text-align:right;' + (styleAr || '') + '">' + ar + '</td>' +
      '<td dir="ltr" align="left" valign="top" style="width:50%;padding-right:10px;text-align:left;' + (styleEn || styleAr || '') + '">' + en + '</td></tr></table>';
  }

  /** خطوات التعاون الثلاث: done = ما أُنجز، on = الخطوة الحالية */
  function steps_(list, cur) {
    return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 18px"><tr>' + list.map(function (s, i) {
      var on = i === cur, done = i < cur;
      var bg = on ? GOLD : done ? NAVY : BEIGE, fg = on || done ? '#ffffff' : DEEP;
      return '<td style="width:33%;padding:0 3px"><div style="background:' + bg + ';color:' + fg + ';border-radius:10px;padding:10px 6px;text-align:center;font-size:13px;line-height:1.5' + (on ? ';font-weight:bold' : '') + '">' +
        (i + 1) + (done ? ' ✓' : '') + '<br>' + esc(s[0]) + '<br><span style="font-size:11px;opacity:.85" dir="ltr">' + esc(s[1]) + '</span></div></td>';
    }).join('') + '</tr></table>';
  }

  function factRow_(ar, en, val, valEn) {
    if (!val) return '';
    return '<tr><td style="padding:9px 14px;border-bottom:1px solid ' + BEIGE + ';color:' + KHAKI + ';font-size:12px;width:30%" dir="rtl" align="right">' + esc(ar) + '</td>' +
      '<td' + (/^[\x00-\x7F]+$/.test(String(val)) ? ' dir="ltr"' : '') + ' style="padding:9px 14px;border-bottom:1px solid ' + BEIGE + ';color:' + NAVY + ';font-weight:bold;font-size:14px;text-align:center">' + esc(val) +
      (valEn && valEn !== val ? '<div style="font-weight:normal;font-size:12px;color:' + INK + '" dir="ltr">' + esc(valEn) + '</div>' : '') + '</td>' +
      '<td style="padding:9px 14px;border-bottom:1px solid ' + BEIGE + ';color:' + KHAKI + ';font-size:12px;width:30%" dir="ltr" align="left">' + esc(en) + '</td></tr>';
  }

  /** الإطار الكامل (تصميم «مسار التعاون») */
  function page_(o, p) {
    return '<div dir="rtl" style="background:' + SAND + ';padding:24px 10px;font-family:' + FONT + '">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ' + BEIGE + '">' +
      '<tr><td style="padding:22px 24px 4px">' + bi_('<b style="font-size:17px;color:' + NAVY + '">' + BRAND_AR + '</b>', '<b style="font-size:14px;color:' + NAVY + '">' + BRAND_EN + '</b>') +
      '<div style="text-align:center;margin-top:10px"><span style="font-size:12px;background:' + BEIGE + ';color:' + DEEP + ';border-radius:20px;padding:4px 14px" dir="ltr">' + esc(o.wo_id) + '</span></div></td></tr>' +
      '<tr><td style="padding:10px 24px 22px;color:' + NAVY + ';line-height:1.8">' +
      bi_('<div style="font-size:21px;font-weight:bold;color:' + NAVY + '">' + esc(p.titleAr) + '</div>', '<div style="font-size:18px;font-weight:bold;color:' + NAVY + '">' + esc(p.titleEn) + '</div>') +
      (p.subAr ? bi_('<p style="margin:2px 0 14px;color:' + INK + ';font-size:14px">' + esc(p.subAr) + '</p>', '<p style="margin:2px 0 14px;color:' + INK + ';font-size:13px">' + esc(p.subEn) + '</p>') : '<div style="height:12px"></div>') +
      steps_(p.steps, p.cur) +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ' + BEIGE + ';border-radius:12px;border-collapse:separate">' + p.facts + '</table>' +
      (p.photos ? '<p style="margin:12px 0 0;font-size:13px;text-align:center">' + p.photos + '</p>' : '') +
      '<div style="margin-top:16px;background:' + BEIGE + ';border-radius:10px;padding:12px 14px">' + bi_('<span style="font-size:14px">' + esc(p.askAr) + '</span>', '<span style="font-size:13px">' + esc(p.askEn) + '</span>') + '</div>' +
      '<div style="margin-top:18px">' + bi_('<span style="font-size:13px;color:' + INK + '">مع التقدير،<br><b style="color:' + NAVY + '">' + esc(p.by) + '</b> · مهندس الصيانة · ' + esc(p.hotel) + '</span>',
        '<span style="font-size:12px;color:' + INK + '">Regards,<br><b style="color:' + NAVY + '">' + esc(p.by) + '</b> · Maintenance Engineer</span>') + '</div>' +
      '</td></tr><tr><td style="background:' + NAVY + ';padding:10px 24px">' +
      bi_('<span style="font-size:11px;color:#E6DAC0">' + BRAND_AR + '</span>', '<span style="font-size:11px;color:#E6DAC0">Awan · Partners in achievement</span>') +
      '</td></tr></table></div>';
  }

  /** الحقائق المشتركة: الفندق، المصعد ورقمه، العطل كما بُلِّغ، الحالة، البلاغ، المعاينة والفحص */
  function ctx_(o) {
    var h = Db.get('Hotels', o.hotel_id) || {};
    var el = Db.find('Elevators', function (e) { return e.hotel_id === o.hotel_id && e.name === o.equip; }) || {};
    var reps = o.report;
    if (typeof reps === 'string') { try { reps = JSON.parse(reps); } catch (e) { reps = []; } }
    if (reps && !Array.isArray(reps)) reps = [reps];
    var last = (reps || []).filter(function (r) { return r && r.outcome === 'diag'; }).slice(-1)[0] || {};
    var working = last.working || '';
    var sym = o.symptom || '';
    var facts = factRow_('الفندق', 'Hotel', h.name) +
      factRow_('المصعد', 'Elevator', o.equip) +
      factRow_('رقم المصعد', 'Elevator No.', el.serial ? String(el.serial) : '') +
      factRow_('العطل المُبلّغ', 'Reported fault', sym + (o.description && o.description !== sym ? ' · ' + o.description : ''), en_(sym)) +
      factRow_('الحالة', 'Status', working === 'لا' ? 'متوقف' : working === 'نعم' ? 'يعمل' : '', working === 'لا' ? 'Stopped' : working === 'نعم' ? 'Working' : '') +
      factRow_('وقت البلاغ', 'Reported at', when_(o.created_at)) +
      factRow_('المعاينة والفحص', 'Inspected at', when_(last.at || o.submitted_at || o.arrived_at));
    var photos = Orders.csv(o.photos).map(function (id, i) { return '<a style="color:' + NAVY + '" href="https://drive.google.com/file/d/' + esc(id) + '/view">صورة ' + (i + 1) + ' · Photo ' + (i + 1) + '</a>'; }).join(' &nbsp; ');
    return { h: h, facts: facts, photos: photos };
  }

  function to_(o) {
    var con = Db.get('Contractors', o.con_id) || {};
    return { con: con, list: Orders.csv(con.emails) };
  }

  /** طلب عرض السعر */
  function rfq(o, me) {
    var t = to_(o);
    if (!t.list.length) throw new Error('لا يوجد بريد لـ ' + (t.con.name || 'المتعهد') + '. أضفه من المتعهدون والعقود ← بيانات التواصل.');
    if (!me || !me.email) throw new Error('أضف بريدك في المستخدمين ليصلك رد عرض السعر.');
    var c = ctx_(o);
    var html = page_(o, {
      titleAr: (o.equip || 'المصعد') + ' ينتظر عرضكم', titleEn: 'The elevator awaits your quotation',
      subAr: '', subEn: '',
      steps: [['فنيكم عاين', 'Inspected'], ['عرضكم', 'Your quote'], ['نعتمد ونبدأ', 'We approve']], cur: 1,
      facts: c.facts, photos: c.photos,
      askAr: 'حسب توصية فنيكم، نأمل إرسال العرض بالرد على هذا البريد.', askEn: 'Per your technician’s recommendation, please reply to this email with your quotation.',
      by: me.name || '', hotel: c.h.name || ''
    });
    var subject = 'طلب عرض سعر · Quotation request | ' + o.wo_id + ' | ' + (c.h.name || '') + ' | ' + (o.equip || '');
    var text = 'طلب عرض سعر / Quotation request\n' + o.wo_id + ' · ' + (c.h.name || '') + ' · ' + (o.equip || '') + '\nالعطل: ' + (o.symptom || '') +
      '\nحسب توصية فنيكم، نأمل إرسال العرض بالرد على هذا البريد.\nPer your technician’s recommendation, please reply with your quotation.\n' + (me.name || '');
    return { to: t.list.join(','), cc: me.email, subject: subject, html: html, text: text };
  }

  /** إشعار لإدارة المتعهد: paid = تم السداد · prepay = الإصلاح قبل السداد */
  function notice(kind, o, me, extra) {
    var t = to_(o);
    if (!t.list.length) return null;
    var c = ctx_(o), paid = kind === 'paid';
    var facts = c.facts + factRow_('عرض السعر', 'Quotation', (o.quote_no ? o.quote_no + ' · ' : '') + (o.quote ? o.quote + ' ريال' : ''), o.quote ? (o.quote_no ? o.quote_no + ' · ' : '') + o.quote + ' SAR' : '') +
      (paid ? factRow_('رقم الإيصال', 'Receipt No.', extra) : factRow_('موعد الإصلاح', 'Repair date', extra));
    var html = page_(o, paid ? {
      titleAr: 'تم السداد، ننتظر التركيب', titleEn: 'Payment completed — ready for installation',
      subAr: 'شكراً لعرضكم. الخطوة الآن لدى فريقكم.', subEn: 'Thank you for your quotation. The next step is with your team.',
      steps: [['عرضكم', 'Your quote'], ['اعتمدنا وسددنا', 'Approved & paid'], ['فريقكم يركّب', 'You install']], cur: 2,
      facts: facts, photos: '',
      askAr: 'وفّروا القطعة وركّبوها، ثم يسجّل فنيكم الإصلاح في أعوان.', askEn: 'Please supply and install the part; your technician then logs the repair in Awan.',
      by: me.name || '', hotel: c.h.name || ''
    } : {
      titleAr: 'ابدؤوا الإصلاح، والسداد يُستكمل', titleEn: 'Please proceed — payment to follow',
      subAr: 'اتفقنا على البدء قبل استكمال السداد حتى لا يتوقف المصعد.', subEn: 'We agreed to start before payment is completed, to keep the elevator running.',
      steps: [['عرضكم', 'Your quote'], ['اعتمدنا البدء', 'Start approved'], ['فريقكم يركّب', 'You install']], cur: 2,
      facts: facts, photos: '',
      askAr: 'وفّروا القطعة وركّبوها في الموعد، ثم يسجّل فنيكم الإصلاح في أعوان.', askEn: 'Please supply and install the part on the agreed date; your technician then logs the repair in Awan.',
      by: me.name || '', hotel: c.h.name || ''
    });
    var title = paid ? 'إشعار سداد · Payment notice' : 'اعتماد الإصلاح قبل السداد · Repair approved before payment';
    return { to: t.list.join(','), cc: me.email || '', subject: title + ' | ' + o.wo_id + ' | ' + (c.h.name || '') + ' | ' + (o.equip || ''), html: html, text: title + '\n' + o.wo_id };
  }

  // ── الإرسال عبر Gmail API بإذن «الإرسال فقط» (gmail.send): لا قراءة ولا حذف لبريد الحساب
  function b64_(s) { return Utilities.base64Encode(Utilities.newBlob(String(s)).getBytes()); }
  function hdr_(s) { return '=?UTF-8?B?' + b64_(s) + '?='; }
  function wrap_(s) { return s.replace(/.{1,76}/g, '$&\r\n'); }
  /** رسالة MIME: نص + HTML، وكل الترويسات UTF-8 */
  function mime_(m, from, replyTo) {
    var bd = 'awan' + Utilities.getUuid().replace(/-/g, '');
    var h = ['From: ' + hdr_(BRAND_AR) + ' <' + from + '>', 'To: ' + m.to];
    if (m.cc) h.push('Cc: ' + m.cc);
    if (replyTo) h.push('Reply-To: ' + replyTo);
    h.push('Subject: ' + hdr_(m.subject), 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="' + bd + '"');
    return h.join('\r\n') + '\r\n\r\n' +
      '--' + bd + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap_(b64_(m.text || '')) +
      '--' + bd + '\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap_(b64_(m.html || '')) +
      '--' + bd + '--';
  }
  /** المرسل: مهندس الصيانة للفندق (المرسل نفسه إن كان مهندس الفندق، وإلا مهندس الفندق ذو البريد)، ثم الافتراضي ثم حساب الصيانة.
   *  يجب أن يكون بريده مؤكداً في Gmail حساب الصيانة («إرسال البريد بصفة»)، وإلا تصل من حساب الصيانة. */
  function hotelEng_(hotelId, me) {
    var covers = function (u) { var hs = String(u.hotel_ids || '').split(',').map(function (x) { return x.trim(); }).filter(String); return !hs.length || hs.indexOf(hotelId) !== -1; };
    if (me && me.role === 'engineer' && me.email && covers(me)) return String(me.email).trim();
    if (!hotelId) return '';
    var u = Db.all('Users', function (x) { return x.role === 'engineer' && x.email && x.active !== false && String(x.active) !== 'FALSE' && covers(x); })[0];
    return u ? String(u.email).trim() : '';
  }
  function fromAddr_(hotelId, me) {
    var f = hotelEng_(hotelId, me) || String(Db.setting('mail_from') || '').trim();
    return f || Session.getEffectiveUser().getEmail();
  }

  function send(m, replyTo, hotelId, me) {
    var from = fromAddr_(hotelId, me), acct = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    // الأبوية: الرد العادي يصل للمرسل الرسمي (مهندس الفندق) ولـ Gmail حساب الصيانة معاً، وGmail نسخة دائماً
    // بيانات الدخول خاصة بصاحبها: بلا نسخة لحساب الصيانة
    if (from.toLowerCase() !== acct && !m.private) {
      var cc = [acct].concat(String(m.cc || '').split(',')).map(function (x) { return x.trim().toLowerCase(); })
        .filter(function (x, i, a) { return x && x !== from.toLowerCase() && a.indexOf(x) === i; });
      m = Object.assign({}, m, { cc: cc.join(',') }); replyTo = from + (acct ? ', ' + acct : '');
    }
    var raw = Utilities.base64EncodeWebSafe(Utilities.newBlob(mime_(m, from, replyTo || m.cc || '')).getBytes());
    var n0 = Date.now();
    try { Gmail.Users.Messages.send({ raw: raw }, 'me'); if (typeof Perf !== 'undefined') { Perf.net++; Perf.netMs += Date.now() - n0; } }
    catch (e) {
      var msg = String(e && e.message || e);
      if (/auth|permission|scope|not defined|insufficient/i.test(msg)) throw new Error('إرسال البريد غير مفعّل بعد: شغّل الدالة authorizeAwan مرة واحدة من محرر السكربت بحساب الصيانة ووافق على الأذونات، ثم أعد المحاولة.');
      throw new Error('تعذّر إرسال البريد: ' + msg);
    }
    return from;
  }

  /** المرسل الرسمي (عنوان بديل في Gmail). يرسل رسالة تجريبية إليه للتأكد؛ إن لم يكن مضافاً يصل من حساب الصيانة */
  function setFrom(addr) {
    addr = String(addr || '').trim().toLowerCase();
    if (addr && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(addr)) throw new Error('البريد غير صحيح: ' + addr);
    var row = Db.find('Settings', function (r) { return r.key === 'mail_from'; });
    if (row) Db.update('Settings', 'mail_from', { value: addr }); else Db.insert('Settings', { key: 'mail_from', value: addr, note: 'المرسل الرسمي (عنوان بديل في Gmail)' });
    if (addr) send({ to: addr, subject: 'أعوان · رسالة تجريبية · Test message', text: 'إن وصلت هذه الرسالة من ' + addr + ' فالإرسال من البريد الرسمي يعمل.',
      html: '<div dir="rtl" style="font-family:Tahoma,Arial;font-size:15px;color:' + NAVY + '">إن وصلت هذه الرسالة <b>من ' + esc(addr) + '</b> فالإرسال من البريد الرسمي يعمل.<br>إن وصلت من حساب الصيانة، فالعنوان غير مؤكد في Gmail («إرسال البريد بصفة»).</div>' }, '');
    return addr;
  }

  /** رسالة بيانات الدخول: staff (كلمة مرور مؤقتة) · sup (يختار رقمه) · con (أرقام المتعهد). بطاقة ترحيب تحفّز على البدء */
  var ROLE_ = { admin: ['مشرف النظام', 'System admin'], engineer: ['مهندس الصيانة', 'Maintenance engineer'], management: ['الإدارة', 'Management'],
    gm: ['مدير الفندق', 'Hotel manager'], om: ['مدير التشغيل', 'Operations manager'], duty: ['المدير المناوب', 'Duty manager'], fo: ['مشرف المكاتب الأمامية', 'Front office supervisor'],
    supmgr: ['مدير الإشراف', 'Supervision manager'], sup: ['مشرف ميداني', 'Field supervisor'], fin: ['المالية', 'Finance'] };
  /** ما يجده كل دور في أعوان: ثلاث فوائد قصيرة بالعربية والإنجليزية */
  var GAIN_ = {
    engineer: [['كل طلبات المتعهدين وقراراتها في شاشة واحدة', 'All contractor jobs and decisions on one screen'], ['المطابقة والختم بضغطة، والكشف جاهز للطباعة', 'Match and stamp in one tap; statements ready to print'], ['أداء كل متعهد لحظياً بالأرقام', 'Live, measurable contractor performance']],
    gm: [['عمليات فندقك وأداء متعهديه أمامك', 'Your hotel’s jobs and contractor performance at a glance'], ['ملاحظتك تصل لمالك الخدمة مباشرة', 'Your notes reach the service owner directly'], ['مطابقة رحلات المياه رحلةً رحلة', 'Approve water trips one by one']],
    supmgr: [['خريطة المكافحة بحالة كل غرفة ومرفق', 'A pest map showing every room and facility'], ['بلاغ «متاحة» أو «إصابة» بضغطة لعدة مناطق', 'Flag “ready” or “infested” for many areas in one tap'], ['تقييم المتعهد والإجراء التصحيحي من مكانه', 'Rate the contractor and issue corrective actions in place']],
    management: [['لوحات أداء المتعهدين لكل الفنادق', 'Contractor performance dashboards across hotels'], ['المطالبات والسداد وأعمار المستحقات', 'Claims, payments and receivables ageing'], ['التقييمات الدورية جاهزة للاطلاع والطباعة', 'Periodic evaluations ready to view and print']],
    fin: [['المطالبات المعتمدة بانتظار السداد', 'Approved claims awaiting payment'], ['تسجيل السداد برقم الحوالة', 'Record payments with transfer number'], ['أعمار المستحقات لكل متعهد', 'Receivables ageing per contractor']],
    con: [['أعمالك مرتبة: الطارئ أولاً ثم الدور', 'Your jobs in order: urgent first, then by floor'], ['تقريرك يصل للمهندس فوراً بلا ورق', 'Your report reaches the engineer instantly, paperless'], ['أداؤك وتقييمك واضحان، و«تواصل معنا» مفتوح', 'Clear performance and ratings, and “Contact us” is always open']]
  };
  GAIN_.om = GAIN_.duty = GAIN_.fo = GAIN_.gm; GAIN_.sup = GAIN_.supmgr; GAIN_.admin = GAIN_.management;
  var SUPPORT_ = 'qd@nawazi.co · 0537658576', SLOGAN_ = ['تمكين الأداء', 'Empowering performance'];

  function credRow_(ar, en, val, big) {
    return '<tr><td style="padding:12px 16px;border-bottom:1px solid ' + BEIGE + ';color:' + KHAKI + ';font-size:13px;width:34%;line-height:1.4" dir="rtl" align="right">' + esc(ar) + '<br><span dir="ltr" style="font-size:10px;color:#A89A7A">' + esc(en) + '</span></td>' +
      '<td dir="ltr" align="center" style="padding:12px 16px;border-bottom:1px solid ' + BEIGE + '">' + (big
        ? '<span style="display:inline-block;background:' + SAND + ';border:2px dashed ' + GOLD + ';border-radius:10px;padding:8px 16px;color:' + NAVY + ';font-weight:bold;font-size:24px;letter-spacing:3px;font-family:Consolas,Menlo,monospace">' + esc(val) + '</span>'
        : '<span style="color:' + NAVY + ';font-weight:bold;font-size:15px;font-family:Consolas,Menlo,monospace;word-break:break-all">' + esc(val) + '</span>') + '</td></tr>';
  }
  function gain_(list) {
    return '<table role="presentation" dir="rtl" width="100%" cellspacing="0" cellpadding="0">' + list.map(function (g) {
      return '<tr><td width="34" valign="top" style="padding:7px 0 7px 0"><div style="width:26px;height:26px;border-radius:13px;background:' + GOLD + ';color:#fff;font-size:14px;line-height:26px;text-align:center;font-weight:bold">✓</div></td>' +
        '<td dir="rtl" align="right" style="padding:7px 10px 7px 0;line-height:1.5"><b style="color:' + NAVY + ';font-size:14px">' + esc(g[0]) + '</b><br><span dir="ltr" style="color:' + INK + ';font-size:12px">' + esc(g[1]) + '</span></td></tr>';
    }).join('') + '</table>';
  }
  function steps3_(st) {
    return '<table role="presentation" dir="rtl" width="100%" cellspacing="0" cellpadding="0"><tr>' + st.map(function (s, i) {
      return '<td width="33%" valign="top" align="center" style="padding:0 4px"><div style="width:34px;height:34px;border-radius:17px;background:' + NAVY + ';color:#fff;font-weight:bold;font-size:16px;line-height:34px;margin:0 auto 6px">' + (i + 1) + '</div>' +
        '<div dir="rtl" style="color:' + NAVY + ';font-size:13px;font-weight:bold;line-height:1.5">' + esc(s[0]) + '</div><div dir="ltr" style="color:' + INK + ';font-size:11px;line-height:1.4;margin-top:2px">' + esc(s[1]) + '</div></td>';
    }).join('') + '</tr></table>';
  }

  function creds(kind, d) {
    var url = d.url || '', role = (ROLE_[d.role] || [d.role || ''])[0], hotels = (d.hotels || []).join('، ');
    var first = String(d.name || '').replace(/^م\.\s*/, '').split(/\s+/)[0] || d.name;
    var hello, line, gain, rows, cta, tip, en;
    if (kind === 'con') {
      hello = 'أهلاً ' + d.name; line = 'رقمكم السري لأعوان جاهز'; gain = GAIN_.con[1][0];
      rows = (d.pin ? credRow_('رقم الشركة', 'Company PIN', d.pin, 1) : '') + (d.leadPin ? credRow_('رقم القائد' + (d.leadName ? ' · ' + d.leadName : ''), 'Leader PIN', d.leadPin, 1) : '');
      cta = 'افتح أعوان'; tip = 'في الفندق: امسح باركود أعوان واكتب الرقم.';
      en = 'Your Awan PIN is above. Scan the Awan barcode at the hotel and enter it.';
    } else {
      hello = 'أهلاً ' + first; line = 'حسابك جاهز · ' + role + (hotels ? ' · ' + hotels : ''); gain = (GAIN_[d.role] || GAIN_.gm)[0][0];
      rows = credRow_('الدخول', 'Sign-in', d.login) + (kind === 'sup' ? '' : credRow_('كلمة مؤقتة', 'Temp. password', d.password, 1));
      cta = 'ادخل الآن';
      tip = kind === 'sup' ? 'اختر «مشرف ودخولك الأول؟» ثم رقمك السري.' : 'صالحة 72 ساعة، وتختار كلمتك عند أول دخول.';
      en = kind === 'sup' ? 'Your Awan account is ready. Choose “First sign-in?” and set your PIN.' : 'Your Awan account is ready. Temporary password valid for 72 hours.';
    }
    var btn = url ? '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0 0"><tr><td align="center" style="background:' + NAVY + ';border-radius:12px"><a href="' + esc(url) + '" style="display:block;padding:16px 20px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:18px">' + cta + ' ←</a></td></tr></table>' : '';
    var html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:' + SAND + ';font-family:' + FONT + '">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:22px 10px">' +
      '<table role="presentation" width="520" cellspacing="0" cellpadding="0" dir="rtl" style="max-width:520px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ' + BEIGE + '">' +
      '<tr><td align="center" style="background:' + NAVY + ';padding:22px;text-align:center"><div style="color:#ffffff;font-size:26px;font-weight:bold;line-height:1.2">أعوان</div><div style="color:' + GOLD + ';font-size:13px;margin-top:2px">شركاء في الإنجاز</div></td></tr>' +
      '<tr><td dir="rtl" style="padding:26px 26px 8px;text-align:center">' +
      '<div style="color:' + NAVY + ';font-size:24px;font-weight:bold;line-height:1.4">' + esc(hello) + '</div>' +
      '<div style="color:' + KHAKI + ';font-size:13px;margin-top:4px">' + esc(line) + '</div>' +
      '<div style="display:inline-block;margin-top:14px;background:' + BEIGE + ';color:' + DEEP + ';border-radius:20px;padding:7px 16px;font-size:13px;font-weight:bold">✓ ' + esc(gain) + '</div>' +
      '</td></tr><tr><td style="padding:14px 26px 24px">' +
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ' + BEIGE + ';border-radius:12px;border-collapse:separate;overflow:hidden">' + rows + '</table>' +
      btn + '<div dir="rtl" style="color:' + KHAKI + ';font-size:12px;text-align:center;margin-top:12px">' + esc(tip) + '</div>' +
      '</td></tr>' +
      '<tr><td style="border-top:1px solid ' + BEIGE + ';padding:14px 24px;text-align:center;line-height:1.7">' +
      '<div dir="rtl" style="color:' + NAVY + ';font-size:12px;font-weight:bold">«' + SLOGAN_[0] + '»</div>' +
      '<div dir="rtl" style="color:' + KHAKI + ';font-size:11px">للمساعدة: <span dir="ltr">' + SUPPORT_ + '</span></div>' +
      '<div dir="ltr" style="color:#A89A7A;font-size:10px;margin-top:4px">' + esc(en) + '</div></td></tr>' +
      '</table></td></tr></table></body></html>';
    var text = hello + '\n' + line + '\n\n' + (kind === 'con' ? ((d.pin ? 'رقم الشركة: ' + d.pin + '\n' : '') + (d.leadPin ? 'رقم القائد: ' + d.leadPin + '\n' : ''))
      : ('الدخول: ' + d.login + '\n' + (d.password ? 'كلمة مؤقتة: ' + d.password + '\n' : ''))) + url + '\n' + tip + '\n\n' + en + '\nللمساعدة: ' + SUPPORT_;
    return { to: d.to, subject: kind === 'con' ? 'أعوان · رقمكم السري جاهز' : 'أهلاً ' + first + '، حسابك في أعوان جاهز', html: html, text: text, private: true };
  }

  return { rfq: rfq, notice: notice, send: send, fromOf: fromAddr_, setFrom: setFrom, creds: creds };
})();

/** يُشغَّل مرة واحدة من محرر السكربت بحساب الصيانة لمنح إذن إرسال البريد */
function authorizeAwan() {
  // يطلب الأذونات مرة واحدة: إرسال البريد فقط (Gmail API)، والاتصال الخارجي (تيليجرام)، والمشغّلات
  UrlFetchApp.getRequest('https://api.telegram.org');
  ensureTriggers_();
  return 'البريد: ' + Session.getEffectiveUser().getEmail() + ' · المشغّلات: ' + ScriptApp.getProjectTriggers().length + ' · ' + (Gmail.Users ? 'Gmail API مفعّلة' : '');
}
