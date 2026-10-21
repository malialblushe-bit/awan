/**
 * Tg.js — أعوان: مجموعة تيليجرام لكل فندق لطلبات التكييف.
 *  - كل طلب تكييف يُنشر في مجموعة الفندق بزر «أستلمه»؛ أول من يضغط يستلمه ويظهر اسمه للجميع وفي أعوان.
 *  - الرسالة تتحدّث مع الحالة (وصل، أُرسل للمطابقة، أُغلق). وتنبيه في المجموعة إن لم يُستلم خلال tg_remind_min.
 *  - الاستقبال بالسحب كل دقيقة (tgPoll بمشغّل زمني)؛ مفتاح البوت في خصائص السكربت لا في الجداول.
 * أي خطأ في تيليجرام لا يمنع العمل في أعوان.
 */
var Tg = (function () {
  var TZ = 'Asia/Riyadh';
  function props_() { return PropertiesService.getScriptProperties(); }
  function token_() { return props_().getProperty('TG_TOKEN') || ''; }
  function on() { return !!token_(); }

  function api_(method, payload) {
    var t = token_();
    if (!t) return null;
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/' + method, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true
    });
    var j = {};
    try { j = JSON.parse(res.getContentText()); } catch (e) { j = { ok: false }; }
    return j;
  }

  function esc_(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function hm_(d) { return d ? Utilities.formatDate(new Date(d), TZ, 'HH:mm') : ''; }

  /** نص الرسالة بحالتها الحالية */
  function text_(o) {
    var R = Orders.refs(), v = Orders.view(R, o, false);
    var st;
    if (o.status === 'closed') st = '✔️ أُغلق ' + hm_(o.closed_at);
    else if (o.status === 'rejected') st = '✖️ مرفوض';
    else if (o.status === 'matching') st = '📋 أُرسل للمطابقة ' + hm_(o.submitted_at);
    else if (['decision', 'quote', 'pay', 'parts'].indexOf(o.status) !== -1) st = '⏸ بانتظار قرار المهندس';
    else if (o.arrived_at) st = '🛠 في الموقع منذ ' + hm_(o.arrived_at) + (o.claimed_by ? ' · ' + esc_(o.claimed_by) : '');
    else if (o.claimed_by) st = '✅ استلمه ' + esc_(o.claimed_by) + ' · ' + hm_(o.claimed_at);
    else st = '⏳ بانتظار الاستلام';
    var resp = v.resp != null ? (v.resp === 0 ? 'فوري' : v.resp + ' د') : '';
    return '🔔 <b>طلب تكييف</b> · <code>' + o.wo_id + '</code>\n' +
      '📍 ' + esc_(v.loc) + '\n' +
      '📝 ' + esc_(v.title) + (o.description && o.description !== v.title ? ' · ' + esc_(o.description) : '') + '\n' +
      '👤 ' + esc_(o.requester || 'المهندس') + ' · ' + hm_(o.created_at) + (resp ? ' · الاستجابة خلال ' + resp : '') + (v.con ? '\n🏢 ' + esc_(v.con) : '') + '\n\n' +
      '<b>' + st + '</b>';
  }

  function keyboard_(o) {
    if (o.claimed_by || Orders.OPEN.indexOf(o.status) === -1) return { inline_keyboard: [] };
    return { inline_keyboard: [[{ text: '✋ أستلمه', callback_data: 'c|' + o.wo_id }]] };
  }

  /** ينشر طلب التكييف الجديد في مجموعة فندقه */
  function post(woId) {
    try {
      if (!on()) return false;
      var o = Db.get('WorkOrders', woId);
      if (!o || o.type !== 'ac' || o.tg_msg) return false;
      var h = Db.get('Hotels', o.hotel_id);
      if (!h || !h.tg_chat) return false;
      var r = api_('sendMessage', { chat_id: String(h.tg_chat), text: text_(o), parse_mode: 'HTML', reply_markup: keyboard_(o) });
      if (r && r.ok) { Db.update('WorkOrders', woId, { tg_msg: r.result.message_id }); return true; }
    } catch (e) { /* لا يمنع العمل */ }
    return false;
  }

  /** يحدّث رسالة الطلب بحالته */
  function refresh(woIds) {
    if (!on()) return 0;
    var n = 0;
    (woIds || []).forEach(function (id) {
      try {
        var o = Db.get('WorkOrders', id);
        if (!o || !o.tg_msg) return;
        var h = Db.get('Hotels', o.hotel_id);
        if (!h || !h.tg_chat) return;
        api_('editMessageText', { chat_id: String(h.tg_chat), message_id: Number(o.tg_msg), text: text_(o), parse_mode: 'HTML', reply_markup: keyboard_(o) });
        n++;
      } catch (e) { /* تجاهل */ }
    });
    return n;
  }

  function name_(u) { return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'فني'; }

  function claim_(cb) {
    var id = String(cb.data || '').split('|')[1];
    var o = Db.get('WorkOrders', id);
    if (!o) return api_('answerCallbackQuery', { callback_query_id: cb.id, text: 'الطلب غير موجود.' });
    if (o.claimed_by) return api_('answerCallbackQuery', { callback_query_id: cb.id, text: 'استلمه ' + o.claimed_by + ' قبلك.', show_alert: true });
    if (Orders.OPEN.indexOf(o.status) === -1) return api_('answerCallbackQuery', { callback_query_id: cb.id, text: 'الطلب منتهٍ.' });
    Db.update('WorkOrders', id, { claimed_by: name_(cb.from), claimed_at: new Date(), tg_uid: String(cb.from.id) });
    api_('answerCallbackQuery', { callback_query_id: cb.id, text: 'الطلب باسمك. امسح باركود أعوان عند الوصول.' });
    refresh([id]);
  }

  function link_(msg) {
    var m = String(msg.text || '').match(/^\/link(?:@\w+)?\s+([A-Z0-9-]{4,20})/i);
    if (!m) return;
    var code = m[1].toUpperCase();
    var h = Db.find('Hotels', function (x) { return String(x.tg_code || '').toUpperCase() === code; });
    if (!h) { api_('sendMessage', { chat_id: msg.chat.id, text: 'رمز الربط غير صحيح.' }); return; }
    Db.update('Hotels', h.hotel_id, { tg_chat: String(msg.chat.id), tg_code: '' });
    api_('sendMessage', { chat_id: msg.chat.id, text: '✅ رُبطت المجموعة بـ ' + h.name + '. ستصل هنا طلبات التكييف، ويستلمها الفني بزر «أستلمه».' });
  }

  /** تنبيه واحد في المجموعة لطلب لم يُستلم خلال المدة */
  function remind_() {
    var min = Number(Db.setting('tg_remind_min')) || 10, now = Date.now(), hotels = {};
    Db.all('Hotels').forEach(function (h) { hotels[h.hotel_id] = h; });
    Db.all('WorkOrders', function (o) {
      return o.type === 'ac' && o.tg_msg && !o.claimed_by && !Orders.truthy(o.tg_reminded) && o.status === 'assigned' && now - Orders.ms(o.created_at) > min * 60000;
    }).forEach(function (o) {
      var h = hotels[o.hotel_id];
      if (!h || !h.tg_chat) return;
      api_('sendMessage', { chat_id: String(h.tg_chat), text: '⏰ الطلب ' + o.wo_id + ' لم يُستلم منذ ' + min + ' دقائق.', reply_to_message_id: Number(o.tg_msg) });
      Db.update('WorkOrders', o.wo_id, { tg_reminded: true });
    });
  }

  /** يُشغَّل كل دقيقة: الاستلامات وروابط المجموعات، ثم التنبيهات */
  function poll() {
    if (!on()) return 0;
    var p = props_(), off = Number(p.getProperty('TG_OFFSET') || 0);
    var r = api_('getUpdates', { offset: off, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    var ups = (r && r.ok) ? r.result : [];
    ups.forEach(function (u) {
      off = Math.max(off, u.update_id + 1);
      try {
        if (u.callback_query && /^c\|/.test(u.callback_query.data || '')) claim_(u.callback_query);
        else if (u.message && u.message.text) link_(u.message);
      } catch (e) { /* تجاهل التحديث المعطوب */ }
    });
    p.setProperty('TG_OFFSET', String(off));
    remind_();
    return ups.length;
  }

  /** مشرف النظام: حفظ مفتاح البوت والتحقق منه وتشغيل السحب كل دقيقة */
  function setup(tok) {
    tok = String(tok || '').trim();
    if (!/^\d+:[\w-]{20,}$/.test(tok)) throw new Error('مفتاح البوت غير صحيح. انسخه كما أرسله BotFather.');
    props_().setProperty('TG_TOKEN', tok);
    var me = api_('getMe', {});
    if (!me || !me.ok) { props_().deleteProperty ? props_().deleteProperty('TG_TOKEN') : props_().setProperty('TG_TOKEN', ''); throw new Error('لم يقبل تيليجرام المفتاح. تأكد منه.'); }
    api_('deleteWebhook', {});
    props_().setProperty('TG_BOT', me.result.username || '');
    var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction && t.getHandlerFunction() === 'tgPoll'; });
    if (!has) ScriptApp.newTrigger('tgPoll').timeBased().everyMinutes(1).create();
    return me.result.username;
  }

  function bot() { return props_().getProperty('TG_BOT') || ''; }

  /** رمز ربط جديد لمجموعة الفندق */
  function newCode(hotelId) {
    var c = 'A' + Utilities.getUuid().replace(/\D/g, '').slice(0, 6);
    Db.update('Hotels', hotelId, { tg_code: c });
    return c;
  }

  return { on: on, post: post, refresh: refresh, poll: poll, setup: setup, bot: bot, newCode: newCode, text: text_ };
})();

/** المشغّل الزمني (كل دقيقة) */
function tgPoll() {
  try { return Db.withLock(function () { return Tg.poll(); }); } catch (e) { return 0; }
}
