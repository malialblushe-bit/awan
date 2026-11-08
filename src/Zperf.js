/**
 * Zperf.js — أعوان: قياس زمن كل عملية في الخادم (تشخيص البطء).
 * يُحمَّل آخر الملفات (ترتيب أبجدي)، فيلف كل دالة api* ليقيس: الزمن الكلي، وانتظار القفل،
 * وقراءات الجداول وزمنها، والاتصالات الخارجية. يُسجَّل ما زاد على PERF_SLOW_MS فقط في خاصية
 * PERF_LOG (آخر 40)، ويظهر لمشرف النظام في «تهيئة الإطلاق ← سجل البطء». لا يغيّر أي سلوك.
 */
var PERF_SLOW_MS = 4000;
var Perf = { t0: 0, wait: 0, reads: 0, readMs: 0, net: 0, netMs: 0, tables: {} };
function perfReset_() { if (typeof BOOT_LITE_ !== 'undefined') BOOT_LITE_ = false; Perf.t0 = Date.now(); Perf.wait = 0; Perf.reads = 0; Perf.readMs = 0; Perf.net = 0; Perf.netMs = 0; Perf.tables = {}; Perf.cached = 0; }
function perfLog_(fn, ms) {
  try {
    var P = PropertiesService.getScriptProperties(), a = [];
    try { a = JSON.parse(P.getProperty('PERF_LOG') || '[]'); } catch (e) { a = []; }
    var top = Object.keys(Perf.tables).sort(function (x, y) { return Perf.tables[y] - Perf.tables[x]; }).slice(0, 4)
      .map(function (k) { return k + ' ' + Perf.tables[k]; }).join(' · ');
    a.push({ fn: fn, at: Date.now(), ms: ms, wait: Perf.wait, reads: Perf.reads, cached: Perf.cached || 0, readMs: Perf.readMs, net: Perf.net, netMs: Perf.netMs, top: top });
    P.setProperty('PERF_LOG', JSON.stringify(a.slice(-40)));
  } catch (e) { /* القياس لا يعطل العمل */ }
}
(function (g) {
  Object.keys(g).forEach(function (k) {
    if (!/^api[A-Z]/.test(k) || typeof g[k] !== 'function' || g[k].__perf) return;
    var f = g[k];
    var w = function () {
      perfReset_();
      try { return f.apply(this, arguments); }
      finally { var ms = Date.now() - Perf.t0; if (ms >= PERF_SLOW_MS) perfLog_(k, ms); }
    };
    w.__perf = true;
    g[k] = w;
  });
})(this);
