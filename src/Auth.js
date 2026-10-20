/**
 * Auth.js — أعوان: الدخول والجلسات.
 *  - المتعهد: رقم سري 6 أرقام فقط (فريد بين المتعهدين)، بعد مسح باركود أعوان للفندق.
 *  - المشرف والمهندس والإدارة: اسم دخول + كلمة مرور (مؤقتة أول مرة ثم يغيّرها).
 *  - الأسرار مشفّرة بملح، والجلسات في CacheService (6 ساعات تتجدد مع النشاط).
 */

var Auth = (function () {
  var ROUNDS = 150;
  var SESSION_SEC = 6 * 60 * 60;
  var MAX_FAILS = 5;

  function cache_() { return CacheService.getScriptCache(); }

  function hash(secret, salt) {
    var d = salt + ':' + secret;
    for (var i = 0; i < ROUNDS; i++) {
      d = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d, Utilities.Charset.UTF_8));
    }
    return d;
  }

  function salt_() { return Utilities.getUuid().replace(/-/g, ''); }

  function digits_(n) {
    var s = '';
    while (s.length < n) s += Utilities.getUuid().replace(/\D/g, '');
    return s.slice(0, n);
  }

  function tempPassword_() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
    var u = Utilities.getUuid().replace(/-/g, '');
    var out = '';
    for (var i = 0; i < 5; i++) out += chars.charAt(parseInt(u.substr(i * 2, 2), 16) % chars.length);
    return out + digits_(4);
  }

  function weakPin_(p) {
    return /^(\d)\1{5}$/.test(p) || '0123456789'.indexOf(p) !== -1 || '9876543210'.indexOf(p) !== -1;
  }

  function validPassword(p) {
    p = String(p || '');
    if (p.length < 8) return 'كلمة المرور 8 أحرف على الأقل.';
    if (!/[A-Za-z؀-ۿ]/.test(p) || !/\d/.test(p)) return 'كلمة المرور يجب أن تجمع حروفاً وأرقاماً.';
    return null;
  }

  // ───────── محاولات خاطئة ─────────
  function guard_(key) {
    var n = Number(cache_().get('F_' + key) || 0);
    if (n >= MAX_FAILS) throw new Error('محاولات خاطئة كثيرة. انتظر 10 دقائق ثم حاول.');
  }
  function fail_(key) {
    var n = Number(cache_().get('F_' + key) || 0) + 1;
    cache_().put('F_' + key, String(n), 600);
  }
  function clear_(key) { cache_().remove('F_' + key); }

  // ───────── الجلسات ─────────
  function newSession_(data) {
    var tok = Utilities.getUuid().replace(/-/g, '') + digits_(6);
    cache_().put('S_' + tok, JSON.stringify(data), SESSION_SEC);
    return tok;
  }

  function session(token) {
    if (!token) throw new Error('انتهت الجلسة. ادخل مرة أخرى.');
    var v = cache_().get('S_' + token);
    if (!v) throw new Error('انتهت الجلسة. ادخل مرة أخرى.');
    cache_().put('S_' + token, v, SESSION_SEC);
    return JSON.parse(v);
  }

  /** roles: مصفوفة الأدوار المسموحة (contractor, admin, engineer, management) */
  function need(token, roles) {
    var s = session(token);
    if (roles && roles.indexOf(s.role) === -1) throw new Error('لا تملك صلاحية هذا الإجراء.');
    return s;
  }

  function logout(token) { if (token) cache_().remove('S_' + token); }

  // ───────── المتعهد ─────────
  /** دخول إدارة المتعهد من صفحة الويب: بلا فندق ولا تسجيل وصول */
  function conWebLogin(pin) {
    pin = String(pin || '').trim();
    guard_('con_web');
    var con = null;
    if (/^\d{6}$/.test(pin)) {
      con = Db.find('Contractors', function (c) {
        return c.active !== false && String(c.active).toUpperCase() !== 'FALSE' && c.pin_hash && hash(pin, c.salt) === c.pin_hash;
      });
    }
    if (!con) { fail_('con_web'); throw new Error('الرقم السري غير صحيح.'); }
    clear_('con_web');
    return { token: newSession_({ role: 'contractor', id: con.con_id, hotel_id: '', web: true }), con: con };
  }

  function conLogin(hotel, pin) {
    pin = String(pin || '').trim();
    guard_('con_' + hotel.hotel_id);
    var con = null;
    if (/^\d{6}$/.test(pin)) {
      con = Db.find('Contractors', function (c) {
        return c.active !== false && String(c.active).toUpperCase() !== 'FALSE' && c.pin_hash && hash(pin, c.salt) === c.pin_hash;
      });
    }
    if (!con) { fail_('con_' + hotel.hotel_id); throw new Error('الرقم السري غير صحيح.'); }
    clear_('con_' + hotel.hotel_id);
    return { token: newSession_({ role: 'contractor', id: con.con_id, hotel_id: hotel.hotel_id }), con: con };
  }

  /** يولّد رقماً سرياً فريداً للمتعهد ويحفظه، ويعيده مرة واحدة */
  function setPin(conId) {
    var others = Db.all('Contractors', function (c) { return c.con_id !== conId && c.pin_hash; });
    var pin;
    for (var tries = 0; tries < 20; tries++) {
      pin = digits_(6);
      if (pin.charAt(0) === '0' || weakPin_(pin)) continue;
      var clash = others.some(function (c) { return hash(pin, c.salt) === c.pin_hash; }) || supTaken_(pin, '');
      if (!clash) break;
    }
    var s = salt_();
    Db.update('Contractors', conId, { pin_hash: hash(pin, s), salt: s });
    return pin;
  }

  // ───────── الإشراف: مدير الإشراف والمشرف الميداني ─────────
  var SUP_ROLES = ['supmgr', 'sup'];
  function isSup(role) { return SUP_ROLES.indexOf(role) !== -1; }
  function pinSet_(u) { return !!u.secret_hash && !(u.must_change === true || String(u.must_change).toUpperCase() === 'TRUE'); }
  function supTaken_(pin, exceptId) {
    return Db.all('Users', function (u) { return isSup(u.role) && u.user_id !== exceptId && pinSet_(u); })
      .some(function (u) { return hash(pin, u.salt) === u.secret_hash; });
  }
  /** الرقم السري محجوز لمتعهد أو مشرف آخر؟ (الرقم وحده يعرّف صاحبه، فلا يتكرر) */
  function pinTaken(pin, exceptUserId) {
    return supTaken_(pin, exceptUserId || '') || Db.all('Contractors', function (c) { return !!c.pin_hash; }).some(function (c) { return hash(pin, c.salt) === c.pin_hash; });
  }

  /** أول دخول (أو بعد إعادة التعيين): اسم الدخول المعرّف + رقم يختاره بنفسه */
  function supSetPin(username, pin) {
    var u = String(username || '').trim().toLowerCase();
    pin = String(pin || '').trim();
    guard_('sps_' + u);
    var user = Db.find('Users', function (r) { return String(r.username).toLowerCase() === u && isSup(r.role); });
    if (!user || String(user.active).toUpperCase() === 'FALSE') { fail_('sps_' + u); throw new Error('اسم الدخول غير معرّف للإشراف. راجع مشرف النظام.'); }
    if (pinSet_(user)) throw new Error('رقمك السري محدد من قبل. ادخل به، أو اطلب من مشرف النظام إعادة تعيينه إن نسيته.');
    if (!/^\d{6}$/.test(pin)) throw new Error('الرقم السري 6 أرقام.');
    if (weakPin_(pin)) throw new Error('اختر رقماً أصعب: لا تكرار ولا تسلسل.');
    if (pinTaken(pin, user.user_id)) throw new Error('هذا الرقم محجوز، اختر رقماً آخر.');
    var st = salt_();
    Db.update('Users', user.user_id, { secret_hash: hash(pin, st), salt: st, must_change: false });
    clear_('sps_' + u);
    return { token: newSession_({ role: user.role, id: user.user_id }), user: user };
  }

  function supLogin(pin) {
    pin = String(pin || '').trim();
    var user = null;
    if (/^\d{6}$/.test(pin)) {
      user = Db.find('Users', function (u) { return isSup(u.role) && String(u.active).toUpperCase() !== 'FALSE' && pinSet_(u) && hash(pin, u.salt) === u.secret_hash; });
    }
    if (!user) return null;
    return { token: newSession_({ role: user.role, id: user.user_id }), user: user };
  }

  /** دخول بالرقم السري من صفحة الويب: متعهد أو إشراف */
  function pinWebLogin(pin) {
    guard_('pin_web');
    pin = String(pin || '').trim();
    var s = supLogin(pin);
    if (s) { clear_('pin_web'); return { kind: 'sup', token: s.token, user: s.user }; }
    try { var c = conWebLogin(pin); clear_('pin_web'); return { kind: 'con', token: c.token, con: c.con }; }
    catch (e) { fail_('pin_web'); throw new Error('الرقم السري غير صحيح.'); }
  }

  // ───────── الموظفون ─────────
  function staffLogin(username, password) {
    var u = String(username || '').trim().toLowerCase();
    if (!u || !password) throw new Error('اكتب اسم الدخول وكلمة المرور.');
    guard_('usr_' + u);
    var user = Db.find('Users', function (r) { return String(r.username).toLowerCase() === u; });
    if (!user || String(user.active).toUpperCase() === 'FALSE' || hash(String(password), user.salt) !== user.secret_hash) {
      fail_('usr_' + u);
      throw new Error('اسم الدخول أو كلمة المرور غير صحيح.');
    }
    clear_('usr_' + u);
    var must = user.must_change === true || String(user.must_change).toUpperCase() === 'TRUE';
    return { token: newSession_({ role: user.role, id: user.user_id, must: must }), user: user, must: must };
  }

  function changePassword(token, newPw) {
    var s = session(token);
    if (s.role === 'contractor') throw new Error('غير متاح.');
    var err = validPassword(newPw);
    if (err) throw new Error(err);
    var st = salt_();
    Db.update('Users', s.id, { secret_hash: hash(String(newPw), st), salt: st, must_change: false });
    s.must = false;
    cache_().put('S_' + token, JSON.stringify(s), SESSION_SEC);
    return true;
  }

  /** ينشئ مستخدماً ويعيد كلمة مرور مؤقتة تظهر مرة واحدة */
  function createUser(name, role, username, email, hotelIds) {
    var u = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new Error('اسم الدخول بالإنجليزية بلا مسافات (3 أحرف على الأقل)، مثل: eng.ahmed');
    if (Db.find('Users', function (r) { return String(r.username).toLowerCase() === u; })) throw new Error('اسم الدخول مستخدم من قبل.');
    if (['admin', 'engineer', 'management', 'gm', 'om', 'supmgr', 'sup'].indexOf(role) === -1) throw new Error('دور غير معروف.');
    if (isSup(role)) {
      // الإشراف بلا كلمة مرور: يختار رقمه السري عند أول دخول
      return { user: Db.insert('Users', { name: String(name || '').trim(), role: role, username: u, email: email || '', hotel_ids: hotelIds || '',
        secret_hash: '', salt: '', must_change: true, failed: 0, lang: 'ar', active: true }), password: null };
    }
    var pw = tempPassword_(), st = salt_();
    var rec = Db.insert('Users', {
      name: String(name || '').trim(), role: role, username: u, email: email || '', hotel_ids: hotelIds || '',
      secret_hash: hash(pw, st), salt: st, must_change: true, failed: 0, lang: 'ar', active: true
    });
    return { user: rec, password: pw };
  }

  function resetUser(userId) {
    var usr = Db.get('Users', userId);
    if (usr && isSup(usr.role)) { Db.update('Users', userId, { secret_hash: '', salt: '', must_change: true }); return null; }
    var pw = tempPassword_(), st = salt_();
    Db.update('Users', userId, { secret_hash: hash(pw, st), salt: st, must_change: true });
    return pw;
  }

  return {
    hash: hash, validPassword: validPassword, session: session, need: need, logout: logout,
    conLogin: conLogin, conWebLogin: conWebLogin, setPin: setPin, staffLogin: staffLogin, changePassword: changePassword,
    createUser: createUser, resetUser: resetUser,
    isSup: isSup, pinTaken: pinTaken, supSetPin: supSetPin, supLogin: supLogin, pinWebLogin: pinWebLogin
  };
})();
