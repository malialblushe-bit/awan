/**
 * Schema.js — أعوان: المصدر الوحيد لتعريف الجداول.
 * ملف بيانات واحد. أي تعديل على الجداول هنا ثم "مزامنة الهيكل" من قائمة أعوان.
 * كل عمود: [الاسم، الوصف].
 */

var SCHEMA_VERSION = 2;

/** رابط تطبيق الويب الثابت (يُملأ بعد أول نشر) */
var WEB_URL = '';

var SCHEMA = [
  { name: 'Settings', cols: [['key', 'المفتاح'], ['value', 'القيمة'], ['note', 'الوصف']] },

  { name: 'Hotels', cols: [
    ['hotel_id', 'المعرّف'], ['code', 'رمز الفندق (يظهر في الباركود)'], ['name', 'الاسم'], ['city', 'المدينة'],
    ['engineer_ids', 'المهندسون (معرّفات مفصولة بفاصلة)'], ['active', 'نشط'], ['created_at', 'تاريخ الإنشاء']] },

  { name: 'Floors', cols: [
    ['floor_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['name', 'اسم الدور أو المنطقة'],
    ['kind', 'rooms = أدوار غرف · public = منطقة عامة'], ['sort', 'الترتيب']] },

  { name: 'Rooms', cols: [
    ['room_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['floor_id', 'الدور'], ['number', 'رقم الغرفة'],
    ['ac_units', 'وحدات التكييف (مفصولة بفاصلة)']] },

  { name: 'Elevators', cols: [
    ['elev_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['name', 'الاسم'], ['active', 'نشط']] },

  { name: 'Users', cols: [
    ['user_id', 'المعرّف'], ['name', 'الاسم'], ['role', 'admin · engineer · management'],
    ['username', 'اسم الدخول'], ['email', 'البريد'], ['hotel_ids', 'الفنادق'],
    ['secret_hash', 'السر مشفّراً'], ['salt', 'الملح'], ['must_change', 'يغيّر السر عند الدخول'],
    ['failed', 'محاولات خاطئة'], ['locked_until', 'مقفل حتى'], ['lang', 'ar · en'], ['active', 'نشط']] },

  { name: 'Contractors', cols: [
    ['con_id', 'المعرّف'], ['name', 'الاسم'], ['type', 'ac = تكييف · el = مصاعد · sf = سلامة'],
    ['phone', 'الجوال'], ['contact', 'جهة الاتصال'],
    ['pin_hash', 'الرقم السري مشفّراً'], ['salt', 'الملح'],
    ['failed', 'محاولات خاطئة'], ['locked_until', 'مقفل حتى'], ['lang', 'ar · en'], ['active', 'نشط']] },

  { name: 'Contracts', cols: [
    ['contract_id', 'المعرّف'], ['con_id', 'المتعهد'], ['type', 'النوع'], ['hotel_ids', 'الفنادق'],
    ['elevator_ids', 'المصاعد المشمولة'], ['start', 'البداية'], ['end', 'النهاية'],
    ['alert_days', 'التنبيه قبل (يوم)'], ['resp_normal', 'الاستجابة: عادي (دقيقة)'],
    ['resp_urgent', 'الاستجابة: طارئ (دقيقة)'], ['pm_per_month', 'زيارات دورية في الشهر'],
    ['prev_contract_id', 'العقد السابق (عند التجديد)'], ['created_at', 'تاريخ الإنشاء']] },

  { name: 'Lists', cols: [
    ['item_id', 'المعرّف'], ['type', 'ac · el · all'],
    ['list', 'sym = العرض · part = الجزء · cause = السبب · parts = قطع · leave = سبب المغادرة · reject = سبب الرفض'],
    ['ar', 'العربية'], ['en', 'English'], ['status', 'active · pending · rejected'],
    ['merged_into', 'دُمج في'], ['created_by', 'أضافه'], ['sort', 'الترتيب']] },

  { name: 'Thresholds', cols: [
    ['type', 'نوع المتعهد'], ['kpi', 'resp · ready · info · sat'],
    ['full', 'حد كامل النقاط'], ['half', 'حد نصف النقاط'], ['weight', 'الوزن ٪']] },

  { name: 'WorkOrders', cols: [
    ['wo_id', 'رقم العملية'], ['hotel_id', 'الفندق'], ['type', 'ac · el'],
    ['kind', 'corrective · periodic · diag · report'], ['source', 'requester · engineer · contractor'],
    ['con_id', 'المتعهد'], ['status', 'الحالة'], ['priority', 'normal · high · urgent'],
    ['floor_id', 'الدور'], ['room', 'الغرفة أو المكان'], ['equip', 'المعدة أو المصعد'],
    ['symptom', 'العَرَض'], ['trapped', 'احتجاز'], ['requester', 'رافع الطلب'], ['description', 'الوصف'],
    ['photos', 'الصور (معرّفات Drive)'], ['report', 'التقرير (JSON)'],
    ['quote', 'عرض السعر'], ['decision', 'القرار'], ['decision_note', 'ملاحظة القرار'],
    ['reject_reason', 'سبب الرفض أو إعادة الفتح'], ['receipt', 'رقم الإيصال'], ['sat', 'رضا المهندس'],
    ['follow_of', 'متابعة للعملية'], ['visits', 'عدد الزيارات'], ['work_minutes', 'دقائق العمل الفعلي'],
    ['work_from', 'بداية العمل الجاري'], ['reopens', 'مرات إعادة الفتح'],
    ['created_at', 'وقت الرفع'], ['assigned_at', 'وقت الإسناد'], ['arrived_at', 'وقت الوصول'],
    ['rescued_at', 'وقت الإنقاذ'], ['submitted_at', 'وقت التسليم'], ['decided_at', 'وقت القرار'],
    ['paid_at', 'وقت السداد'], ['part_arrived_at', 'وقت وصول القطعة'], ['closed_at', 'وقت الإغلاق'],
    ['down_from', 'بداية التوقف'], ['down_to', 'نهاية التوقف']] },

  { name: 'WOLog', cols: [
    ['log_id', 'المعرّف'], ['wo_id', 'العملية'], ['at', 'الوقت'], ['actor', 'الفاعل'],
    ['action', 'الإجراء'], ['from', 'من حالة'], ['to', 'إلى حالة'], ['note', 'ملاحظة']] },

  { name: 'Arrivals', cols: [
    ['arrival_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['con_id', 'المتعهد'], ['at', 'وقت المسح']] },

  { name: 'KpiSummary', cols: [
    ['key', 'المتعهد|الفندق|الشهر'], ['con_id', 'المتعهد'], ['hotel_id', 'الفندق'], ['month', 'الشهر'],
    ['data', 'الأرقام (JSON)'], ['updated_at', 'آخر تحديث']] }
];

/** الحالات الثماني (كما يراها المهندس). المتعهد يرى decision و pay معاً "قيد المراجعة" */
var STATUS = {
  assigned: 'مُسند',
  in_progress: 'قيد التنفيذ',
  decision: 'بانتظار قرار المهندس',
  pay: 'بانتظار السداد',
  parts: 'معلّق بانتظار قطعة',
  matching: 'بانتظار المطابقة',
  closed: 'مغلق',
  rejected: 'مرفوض'
};

var ID_PREFIX = {
  Hotels: 'HTL', Floors: 'FLR', Rooms: 'RM', Elevators: 'ELV', Users: 'USR', Contractors: 'CON',
  Contracts: 'CTR', Lists: 'LST', WorkOrders: 'AWN', WOLog: 'LOG', Arrivals: 'ARV'
};

function tableDef(name) {
  for (var i = 0; i < SCHEMA.length; i++) if (SCHEMA[i].name === name) return SCHEMA[i];
  throw new Error('جدول غير معرّف: ' + name);
}

var SEED_SETTINGS = [
  ['timezone', 'Asia/Riyadh', 'المنطقة الزمنية'],
  ['repeat_window_days', 30, 'نافذة العطل المتكرر (يوم)'],
  ['chronic_count', 2, 'المعدة مزمنة بعد هذا العدد من الأعطال خلال 90 يوماً'],
  ['session_hours', 6, 'مدة الجلسة (ساعات)'],
  ['photos_folder_id', '', 'مجلد الصور في Drive (يُنشأ تلقائياً)']
];

/** [type, kpi, full, half, weight] — الاستجابة بالدقائق (الأقل أفضل)، والبقية نسب (الأعلى أفضل) */
var SEED_THRESHOLDS = [
  ['ac', 'resp', 30, 40, 30], ['ac', 'ready', 90, 85, 30], ['ac', 'info', 95, 90, 20], ['ac', 'sat', 85, 80, 20],
  ['el', 'resp', 45, 60, 30], ['el', 'ready', 90, 85, 30], ['el', 'info', 95, 90, 20], ['el', 'sat', 85, 80, 20],
  ['sf', 'resp', 60, 80, 30], ['sf', 'ready', 90, 85, 30], ['sf', 'info', 95, 90, 20], ['sf', 'sat', 85, 80, 20]
];

/** [type, list, ar, en] */
var SEED_LISTS = [
  ['ac', 'sym', 'لا يبرد', 'Not cooling'], ['ac', 'sym', 'تسريب ماء', 'Water leak'], ['ac', 'sym', 'صوت مرتفع', 'Loud noise'],
  ['ac', 'sym', 'لا يعمل', 'Not working'], ['ac', 'sym', 'رائحة غير طبيعية', 'Unusual smell'],
  ['ac', 'part', 'المروحة', 'Fan'], ['ac', 'part', 'الكباستر', 'Capacitor'], ['ac', 'part', 'خط التصريف', 'Drain line'],
  ['ac', 'part', 'الفلتر', 'Filter'], ['ac', 'part', 'الثرموستات', 'Thermostat'], ['ac', 'part', 'لوحة التحكم', 'Control board'],
  ['ac', 'part', 'الكمبروسر', 'Compressor'],
  ['ac', 'cause', 'اتساخ', 'Dirt'], ['ac', 'cause', 'انسداد', 'Blockage'], ['ac', 'cause', 'تآكل طبيعي', 'Normal wear'],
  ['ac', 'cause', 'سوء استخدام', 'Misuse'], ['ac', 'cause', 'مشكلة كهرباء', 'Electrical issue'], ['ac', 'cause', 'تركيب سابق', 'Previous installation'],
  ['ac', 'parts', 'جلدة', 'Gasket'], ['ac', 'parts', 'كباستر', 'Capacitor'], ['ac', 'parts', 'مروحة', 'Fan'],
  ['ac', 'parts', 'فلتر', 'Filter'], ['ac', 'parts', 'ريموت', 'Remote'],

  ['el', 'sym', 'متوقف', 'Stopped'], ['el', 'sym', 'توقف بين الأدوار', 'Stuck between floors'], ['el', 'sym', 'الباب لا يُغلق', 'Door not closing'],
  ['el', 'sym', 'صوت أو اهتزاز', 'Noise or vibration'], ['el', 'sym', 'الأزرار لا تستجيب', 'Buttons not responding'],
  ['el', 'part', 'قفل باب الدور', 'Landing door lock'], ['el', 'part', 'حساس الباب', 'Door sensor'], ['el', 'part', 'لوحة التحكم', 'Controller'],
  ['el', 'part', 'الماكينة', 'Machine'], ['el', 'part', 'الحبال', 'Ropes'], ['el', 'part', 'الأزرار', 'Buttons'],
  ['el', 'cause', 'تآكل طبيعي', 'Normal wear'], ['el', 'cause', 'ارتفاع الحرارة', 'Overheating'], ['el', 'cause', 'سوء استخدام', 'Misuse'],
  ['el', 'cause', 'مشكلة كهرباء', 'Electrical issue'], ['el', 'cause', 'ضبط غير صحيح', 'Incorrect adjustment'], ['el', 'cause', 'عوامل خارجية', 'External factors'],
  ['el', 'parts', 'حساس باب', 'Door sensor'], ['el', 'parts', 'زر استدعاء', 'Call button'], ['el', 'parts', 'لمبة كابينة', 'Car light'], ['el', 'parts', 'بكرة باب', 'Door roller'],
  ['el', 'leave', 'بانتظار قطعة', 'Waiting for a part'], ['el', 'leave', 'يحتاج فريقاً إضافياً', 'Needs extra crew'], ['el', 'leave', 'انتهى وقت العمل', 'End of shift'],

  ['all', 'reject', 'صور غير واضحة', 'Unclear photos'], ['all', 'reject', 'تقرير ناقص', 'Incomplete report'],
  ['all', 'reject', 'رقم معدة خاطئ', 'Wrong equipment number'], ['all', 'reject', 'العمل غير مطابق', 'Work does not match'],
  ['all', 'reject', 'سبب غير مقنع', 'Unconvincing cause']
];
