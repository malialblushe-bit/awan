/**
 * Api.js — أعوان: مدخل تطبيق الويب.
 * الباركودان روابط لنفس التطبيق:
 *   ?h=<رمز الفندق>&m=req  → نموذج رفع الطلب (فريق العمل)
 *   ?h=<رمز الفندق>&m=con  → دخول المتعهد بالرقم السري (ويُسجَّل وقت الوصول)
 *   بلا معاملات          → دخول المهندس والإدارة والمشرف
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var t = HtmlService.createTemplateFromFile('App');
  t.boot = JSON.stringify({ hotel: String(p.h || ''), mode: String(p.m || '') });
  return t.evaluate()
    .setTitle('أعوان')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
