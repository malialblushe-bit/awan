/**
 * Schema.js — أعوان: المصدر الوحيد لتعريف الجداول.
 * ملف بيانات واحد. أي تعديل على الجداول هنا ثم "مزامنة الهيكل" من قائمة أعوان.
 * كل عمود: [الاسم، الوصف].
 */

var SCHEMA_VERSION = 21;

/** رابط تطبيق الويب الثابت (يُملأ بعد أول نشر) */
var WEB_URL = 'https://script.google.com/macros/s/AKfycby6A1m7aPlKq-uEogP5nm42tBLkohPMWvv7dJjunFZ7kIuvGQWExF-ylflk0JsN7YCtZA/exec';

var SCHEMA = [
  { name: 'Settings', cols: [['key', 'المفتاح'], ['value', 'القيمة'], ['note', 'الوصف']] },

  { name: 'Hotels', cols: [
    ['hotel_id', 'المعرّف'], ['code', 'رمز الفندق (يظهر في الباركود)'], ['name', 'الاسم'], ['city', 'المدينة'],
    ['towers', 'الأبراج (مفصولة بفاصلة، فارغ إن لم توجد)'],
    ['engineer_ids', 'المهندسون (معرّفات مفصولة بفاصلة)'], ['active', 'نشط'], ['created_at', 'تاريخ الإنشاء'],
    ['lat', 'خط العرض (لتحقق الموقع)'], ['lng', 'خط الطول'], ['geo_radius', 'نطاق الموقع بالمتر'],
    ['geo_con', 'تحقق الموقع عند وصول المتعهد'], ['wa_carts', 'سعة منطقة النفايات (عربات)'],
    ['brand', 'هوية صفحات الفندق: nawazi = كحلي وبيج · warf = زيتي وبيج'],
    ['tg_chat', 'مجموعة تيليجرام لطلبات التكييف'], ['tg_code', 'رمز ربط المجموعة (مؤقت)']] },

  { name: 'Floors', cols: [
    ['floor_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['name', 'اسم الدور أو المنطقة'],
    ['kind', 'rooms = دور غرف · service = دور خدمي'], ['sort', 'الترتيب'], ['tower', 'البرج (فارغ = مشترك)']] },

  { name: 'Rooms', cols: [
    ['room_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['floor_id', 'الدور'], ['number', 'رقم الغرفة أو اسم المرفق'],
    ['ac_units', 'وحدات التكييف (مفصولة بفاصلة)'], ['kind', 'room = غرفة · facility = مرفق'],
    ['ftype', 'نوع المرفق (لدورية المكافحة؛ الغرف: غرف النزلاء)']] },

  { name: 'Elevators', cols: [
    ['elev_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['name', 'الاسم'], ['active', 'نشط'],
    ['kind', 'نزلاء · خدمة · طوارئ · بضائع'], ['brand', 'الشركة المصنّعة'], ['capacity_kg', 'الحمولة (كجم)'],
    ['persons', 'عدد الأشخاص'], ['stops', 'عدد الوقفات'], ['floors_served', 'الأدوار المخدومة'],
    ['install_year', 'سنة التركيب'], ['serial', 'الرقم التسلسلي'], ['notes', 'ملاحظات'], ['tower', 'البرج']] },

  { name: 'Users', cols: [
    ['user_id', 'المعرّف'], ['name', 'الاسم'], ['role', 'admin · engineer · management · gm (مدير الفندق) · om (مدير التشغيل) · duty (المدير المناوب) · supmgr (مدير الإشراف) · sup (مشرف ميداني)'],
    ['username', 'اسم الدخول'], ['email', 'البريد'], ['hotel_ids', 'الفنادق'],
    ['secret_hash', 'السر مشفّراً'], ['salt', 'الملح'], ['must_change', 'يغيّر السر عند الدخول'],
    ['failed', 'محاولات خاطئة'], ['locked_until', 'مقفل حتى'], ['lang', 'ar · en'], ['active', 'نشط']] },

  { name: 'Contractors', cols: [
    ['con_id', 'المعرّف'], ['name', 'الاسم'], ['type', 'ac = تكييف · el = مصاعد · sf = سلامة · wa = نفايات · pc = مكافحة الآفات'],
    ['phone', 'الجوال'], ['contact', 'جهة الاتصال'], ['emails', 'البريد (أكثر من عنوان مفصولة بفاصلة)'],
    ['pin_hash', 'الرقم السري مشفّراً'], ['salt', 'الملح'],
    ['failed', 'محاولات خاطئة'], ['locked_until', 'مقفل حتى'], ['lang', 'ar · en'], ['active', 'نشط']] },

  { name: 'Contracts', cols: [
    ['contract_id', 'المعرّف'], ['con_id', 'المتعهد'], ['type', 'النوع'], ['hotel_ids', 'الفنادق'],
    ['elevator_ids', 'المصاعد المشمولة'], ['start', 'البداية'], ['end', 'النهاية'],
    ['alert_days', 'التنبيه قبل (يوم)'], ['resp_normal', 'الاستجابة: عادي (دقيقة)'],
    ['resp_urgent', 'الاستجابة: طارئ (دقيقة)'], ['pm_per_month', 'زيارات دورية في الشهر'],
    ['prev_contract_id', 'العقد السابق (عند التجديد)'], ['created_at', 'تاريخ الإنشاء'],
    ['prices', 'أسعار الخدمات في هذا العقد (JSON: الخدمة ← الريال)'], ['wa_per_week', 'النفايات: مرات الرفع في الأسبوع']] },

  { name: 'Lists', cols: [
    ['item_id', 'المعرّف'], ['type', 'ac · el · all'],
    ['list', 'sym = الملاحظة · part = الجزء · cause = السبب · action = الإجراء المتخذ · parts = قطع · leave = سبب المغادرة · reject = سبب الرفض · pest = الآفة · ftype = نوع المرفق · material = مادة المكافحة'],
    ['ar', 'العربية'], ['en', 'English'], ['status', 'active · pending · merged · rejected'],
    ['merged_into', 'دُمج في'], ['created_by', 'أضافه'], ['sort', 'الترتيب'], ['orig', 'النص الأصلي قبل إعادة الصياغة'], ['price', 'السعر بالريال (لخدمات الإجراء)']] },

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
    ['down_from', 'بداية التوقف'], ['down_to', 'نهاية التوقف'],
    ['rfq_at', 'آخر طلب عرض سعر بالبريد'], ['rfq_count', 'مرات طلب العرض'], ['quote_no', 'رقم عرض السعر'], ['quote_at', 'وقت وصول العرض'],
    ['pay_pending', 'أُذن بالإصلاح قبل السداد والسداد معلّق'], ['repair_date', 'موعد الإصلاح المتفق عليه'],
    ['tg_msg', 'رسالة تيليجرام'], ['claimed_by', 'استلمه (الفني)'], ['claimed_at', 'وقت الاستلام'], ['tg_uid', 'معرّف الفني في تيليجرام'], ['tg_reminded', 'نُبّه لعدم الاستلام']] },

  { name: 'WOLog', cols: [
    ['log_id', 'المعرّف'], ['wo_id', 'العملية'], ['at', 'الوقت'], ['actor', 'الفاعل'],
    ['action', 'الإجراء'], ['from', 'من حالة'], ['to', 'إلى حالة'], ['note', 'ملاحظة']] },

  { name: 'Arrivals', cols: [
    ['arrival_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['con_id', 'المتعهد'], ['at', 'وقت المسح']] },

  { name: 'CorrectiveActions', cols: [
    ['ca_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['con_id', 'المتعهد'], ['wo_id', 'العملية (فارغ = إجراء مستقل)'],
    ['reason', 'السبب'], ['required', 'المطلوب من المتعهد'], ['due', 'الموعد'], ['status', 'open · responded · closed'],
    ['response', 'رد المتعهد'], ['photos', 'صور الرد'], ['by', 'أصدره'], ['created_at', 'وقت الإصدار'], ['responded_at', 'وقت الرد'],
    ['closed_at', 'وقت الإغلاق'], ['effective', 'فعّال؟ نعم · لا'], ['verify_note', 'ملاحظة التحقق'], ['rounds', 'مرات الإعادة']] },

  { name: 'Notes', cols: [
    ['note_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['service', 'ac · el · sf · wa · pc'], ['to', 'maint = مهندس الصيانة · sup = الإشراف'],
    ['wo_id', 'العملية (اختياري)'], ['text', 'الملاحظة'], ['by_id', 'المرسل'], ['by_name', 'اسم المرسل'], ['by_role', 'دوره'],
    ['created_at', 'وقت الإرسال'], ['seen_at', 'وقت الاطلاع'], ['seen_by', 'اطلع عليها']] },

  { name: 'WasteVisits', cols: [
    ['visit_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['con_id', 'متعهد النفايات'], ['by_id', 'سجّلها'], ['by_name', 'الاسم'], ['by_role', 'contractor · sup · supmgr'],
    ['at', 'الوقت (من الخادم)'], ['truck', 'حضرت الشاحنة؟ نعم · لا'], ['removed', 'رُحّلت النفايات؟ نعم · لا'], ['left_carts', 'العربات المتبقية'],
    ['washed', 'نُظّف وغُسل المكان؟ نعم · لا'], ['rating', 'مستوى النظافة من 5'], ['note', 'ملاحظة'], ['photos', 'الصور'],
    ['lat', 'خط العرض'], ['lng', 'خط الطول'], ['acc', 'دقة الموقع (م)'], ['dist', 'البعد عن الفندق (م)'],
    ['status', 'فارغ = معتمدة · rejected = مرفوضة (لم تحدث فعلاً)'], ['rej_by', 'رفضها'], ['rej_at', 'وقت الرفض'], ['rej_reason', 'سبب الرفض']] },

  { name: 'WaterLoads', cols: [
    ['load_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['con_id', 'متعهد المياه'], ['at', 'وقت التفريغ (من الخادم)'], ['driver', 'السائق'],
    ['size', 'الحجم (م³)'], ['receipt_no', 'رقم السند'], ['photos', 'صورة السند'], ['note', 'ملاحظة'],
    ['status', 'pending · approved · rejected'], ['dup', 'مكرر محتمل (نقلة خلال 20 دقيقة)'], ['match_by', 'طابقها'], ['match_role', 'دوره'],
    ['match_at', 'وقت المطابقة'], ['reason', 'سبب الرفض'], ['lat', 'خط العرض'], ['lng', 'خط الطول'], ['acc', 'دقة الموقع (م)'], ['dist', 'البعد عن الفندق (م)']] },

  { name: 'PestLogs', cols: [
    ['log_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['con_id', 'المتعهد'], ['zones', 'المناطق (معرّفات الغرف والمرافق)'],
    ['kind', 'spray = رش · inspect = فحص · trap = فحص مصيدة'], ['pests', 'الآفات المستهدفة'], ['material', 'المادة'],
    ['finding', 'none · light · medium · heavy'], ['trap_id', 'المصيدة'], ['note', 'ملاحظة'], ['photos', 'الصور'], ['by_name', 'الفني'],
    ['at', 'الوقت'], ['flags_closed', 'البلاغات المنجزة بها']] },

  { name: 'PestFlags', cols: [
    ['flag_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['zone', 'المنطقة (غرفة أو مرفق)'], ['kind', 'ready = متاحة للرش · infest = بلاغ إصابة'],
    ['pests', 'الآفة'], ['note', 'ملاحظة'], ['photos', 'الصور'], ['by_id', 'المبلّغ'], ['by_name', 'اسمه'], ['created_at', 'وقت البلاغ'],
    ['status', 'open · done · cancelled'], ['done_at', 'وقت الإنجاز'], ['done_log', 'سجل المعالجة'],
    ['source', 'sup = الإشراف · req = باركود الطلبات · staff = مدير الفندق أو مشرف النظام']] },

  { name: 'Traps', cols: [
    ['trap_id', 'المعرّف'], ['hotel_id', 'الفندق'], ['zone', 'المنطقة'], ['label', 'رقم المصيدة'], ['kind', 'النوع'],
    ['placed_at', 'موعد الوضع'], ['every_days', 'الفحص كل (يوم)'], ['last_check', 'آخر فحص'], ['last_result', 'آخر نتيجة'],
    ['removed_at', 'موعد الرفع'], ['status', 'active · removed'], ['by_name', 'وضعها']] },

  { name: 'PestSchedule', cols: [
    ['key', 'الفندق|نوع المرفق'], ['hotel_id', 'الفندق'], ['ftype', 'نوع المرفق'], ['every_days', 'الرش كل (يوم)'],
    ['per_month', 'مرات في الشهر عند الإتاحة (غرف النزلاء): الرش عند «متاحة للرش» والتعثر بنهاية الشهر']] },

  { name: 'Evaluations', cols: [
    ['eval_id', 'المعرّف'], ['con_id', 'المتعهد'], ['type', 'النوع'], ['hotel_ids', 'الفنادق'], ['from', 'من'], ['to', 'إلى'],
    ['data', 'المؤشرات (JSON)'], ['score', 'الدرجة'], ['decision', 'القرار'], ['note', 'الملاحظة'], ['by', 'أصدره'], ['created_at', 'وقت الإصدار']] },

  { name: 'KpiSummary', cols: [
    ['key', 'المتعهد|الفندق|الشهر'], ['con_id', 'المتعهد'], ['hotel_id', 'الفندق'], ['month', 'الشهر'],
    ['data', 'الأرقام (JSON)'], ['updated_at', 'آخر تحديث']] }
];

// أرشيف العمليات: نفس أعمدة WorkOrders. تنتقل إليه ليلاً العمليات المغلقة منذ أكثر من ARCHIVE_DAYS، فيبقى الجدول النشط صغيراً
var ARCHIVE_DAYS = 60;
SCHEMA.push({ name: 'WorkOrdersArchive', cols: tableDef('WorkOrders').cols.slice() });

/** الحالات الثماني (كما يراها المهندس). المتعهد يرى decision و pay معاً "قيد المراجعة" */
var STATUS = {
  assigned: 'مُسند',
  in_progress: 'قيد التنفيذ',
  quote: 'بانتظار عرض السعر',
  decision: 'بانتظار قرار المهندس',
  pay: 'بانتظار الاعتماد والسداد',
  parts: 'معلّق بانتظار قطعة',
  matching: 'بانتظار المطابقة',
  closed: 'مغلق',
  rejected: 'مرفوض'
};

var ID_PREFIX = {
  Hotels: 'HTL', Floors: 'FLR', Rooms: 'RM', Elevators: 'ELV', Users: 'USR', Contractors: 'CON',
  Contracts: 'CTR', Lists: 'LST', WorkOrders: 'AWN', WOLog: 'LOG', Arrivals: 'ARV', CorrectiveActions: 'CA', Notes: 'NT',
  WasteVisits: 'WV', WaterLoads: 'WL', PestLogs: 'PL', PestFlags: 'PF', Traps: 'TR', Evaluations: 'EV'
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
  ['photos_folder_id', '', 'مجلد الصور في Drive (يُنشأ تلقائياً)'],
  ['geo_radius', 150, 'نطاق تحقق الموقع الافتراضي (متر)'],
  ['tg_remind_min', 10, 'تيليجرام: التنبيه إن لم يُستلم طلب التكييف خلال (دقيقة)']
];

/** [type, kpi, full, half, weight] — الاستجابة بالدقائق (الأقل أفضل)، والبقية نسب (الأعلى أفضل) */
var SEED_THRESHOLDS = [
  ['ac', 'resp', 30, 40, 30], ['ac', 'ready', 90, 85, 30], ['ac', 'info', 95, 90, 20], ['ac', 'sat', 85, 80, 20],
  ['el', 'resp', 45, 60, 30], ['el', 'ready', 90, 85, 30], ['el', 'info', 95, 90, 20], ['el', 'sat', 85, 80, 20],
  ['sf', 'resp', 60, 80, 30], ['sf', 'ready', 90, 85, 30], ['sf', 'info', 95, 90, 20], ['sf', 'sat', 85, 80, 20],
  ['wa', 'pickup', 95, 85, 50], ['wa', 'clean', 80, 60, 30], ['wa', 'wash', 95, 85, 20],
  ['pc', 'ontime', 90, 75, 40], ['pc', 'flagresp', 24, 48, 30], ['pc', 'traps', 90, 75, 30]
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

  // خدمات متعهد التكييف (لكل خدمة سعرها، وتُجمع في الكشف الشهري)
  ['ac', 'action', 'تغيير جلبة دينمو داخلي', 'Indoor motor bushing replaced'], ['ac', 'action', 'تغيير بلور مروحة داخلي', 'Indoor fan blower replaced'],
  ['ac', 'action', 'تصليح صوت مكيف داخلي', 'Indoor unit noise repaired'], ['ac', 'action', 'تصليح صوت مكيف خارجي', 'Outdoor unit noise repaired'],
  ['ac', 'action', 'تركيب قريل', 'Grille replaced or serviced'], ['ac', 'action', 'تغيير ريموت', 'Remote replaced'], ['ac', 'action', 'تغيير مكان الريموت', 'Remote relocated'],
  ['ac', 'action', 'تغيير مبيلة كبير', 'Large capacitor replaced'], ['ac', 'action', 'تغيير مبيلة صغير', 'Small capacitor replaced'],
  ['ac', 'action', 'تصليح أسلاك محروقة', 'Burnt wiring repaired'], ['ac', 'action', 'إخراج زيت محروق', 'Burnt oil purged'],
  ['ac', 'action', 'تصليح تنسيم (لحام مواسير النحاس)', 'Copper pipe brazing'], ['ac', 'action', 'تصليح تسريب مويا داخلي', 'Indoor water leak repaired'],
  ['ac', 'action', 'تعبئة فريون 50%', 'Freon refill 50%'], ['ac', 'action', 'تعبئة فريون 60%', 'Freon refill 60%'], ['ac', 'action', 'تعبئة فريون 70%', 'Freon refill 70%'],
  ['ac', 'action', 'تعبئة فريون 80%', 'Freon refill 80%'], ['ac', 'action', 'تعبئة فريون 90%', 'Freon refill 90%'], ['ac', 'action', 'تعبئة فريون 100%', 'Freon refill 100%'],

  ['el', 'sym', 'متوقف', 'Stopped'], ['el', 'sym', 'توقف بين الأدوار', 'Stuck between floors'], ['el', 'sym', 'الباب لا يُغلق', 'Door not closing'],
  ['el', 'sym', 'صوت أو اهتزاز', 'Noise or vibration'], ['el', 'sym', 'الأزرار لا تستجيب', 'Buttons not responding'],
  ['el', 'part', 'قفل باب الدور', 'Landing door lock'], ['el', 'part', 'حساس الباب', 'Door sensor'], ['el', 'part', 'لوحة التحكم', 'Controller'],
  ['el', 'part', 'الماكينة', 'Machine'], ['el', 'part', 'الحبال', 'Ropes'], ['el', 'part', 'الأزرار', 'Buttons'],
  ['el', 'cause', 'تآكل طبيعي', 'Normal wear'], ['el', 'cause', 'ارتفاع الحرارة', 'Overheating'], ['el', 'cause', 'سوء استخدام', 'Misuse'],
  ['el', 'cause', 'مشكلة كهرباء', 'Electrical issue'], ['el', 'cause', 'ضبط غير صحيح', 'Incorrect adjustment'], ['el', 'cause', 'عوامل خارجية', 'External factors'],
  ['el', 'parts', 'حساس باب', 'Door sensor'], ['el', 'parts', 'زر استدعاء', 'Call button'], ['el', 'parts', 'لمبة كابينة', 'Car light'], ['el', 'parts', 'بكرة باب', 'Door roller'],
  ['el', 'action', 'ضبط', 'Adjusted'], ['el', 'action', 'تنظيف', 'Cleaning'], ['el', 'action', 'تشحيم', 'Lubricated'],
  ['el', 'action', 'استبدال قطعة', 'Part replaced'], ['el', 'action', 'إصلاح توصيلات كهربائية', 'Wiring repaired'], ['el', 'action', 'إعادة تشغيل', 'Restarted'],
  ['el', 'leave', 'بانتظار قطعة', 'Waiting for a part'], ['el', 'leave', 'يحتاج فريقاً إضافياً', 'Needs extra crew'], ['el', 'leave', 'انتهى وقت العمل', 'End of shift'],

  ['pc', 'pest', 'صراصير', 'Cockroaches'], ['pc', 'pest', 'نمل', 'Ants'], ['pc', 'pest', 'فئران وقوارض', 'Rodents'], ['pc', 'pest', 'بق الفراش', 'Bed bugs'],
  ['pc', 'pest', 'ذباب', 'Flies'], ['pc', 'pest', 'بعوض', 'Mosquitoes'], ['pc', 'pest', 'عناكب', 'Spiders'], ['pc', 'pest', 'نمل أبيض', 'Termites'],
  ['pc', 'material', 'جل', 'Gel'], ['pc', 'material', 'رش سائل', 'Liquid spray'], ['pc', 'material', 'طعوم', 'Baits'], ['pc', 'material', 'بودرة', 'Dust'], ['pc', 'material', 'تبخير', 'Fumigation'],
  ['pc', 'ftype', 'غرف النزلاء', 'Guest rooms'], ['pc', 'ftype', 'الممرات', 'Corridors'], ['pc', 'ftype', 'المطبخ', 'Kitchen'], ['pc', 'ftype', 'المطعم', 'Restaurant'],
  ['pc', 'ftype', 'المخازن', 'Stores'], ['pc', 'ftype', 'مرمى النفايات', 'Waste area'], ['pc', 'ftype', 'الساحات الخارجية', 'Outdoor yards'],
  ['pc', 'ftype', 'دورات المياه العامة', 'Public restrooms'], ['pc', 'ftype', 'مرافق الموظفين', 'Staff areas'], ['pc', 'ftype', 'المكاتب', 'Offices'],

  ['all', 'reject', 'صور غير واضحة', 'Unclear photos'], ['all', 'reject', 'تقرير ناقص', 'Incomplete report'],
  ['all', 'reject', 'رقم معدة خاطئ', 'Wrong equipment number'], ['all', 'reject', 'العمل غير مطابق', 'Work does not match'],
  ['all', 'reject', 'سبب غير مقنع', 'Unconvincing cause']
];
