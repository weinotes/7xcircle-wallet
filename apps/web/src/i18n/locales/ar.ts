/**
 * Copyright 2026 Davey Wong <wgwcko@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * الترجمات العربية — واجهة 7xCircle Wallet.
 * العربية لغة RTL (من اليمين إلى اليسار) — تعامل عبر i18n syncDocumentDirection.
 */
export default {
  // ── عام ──
  common: {
    back: 'رجوع',
    next: 'التالي',
    continue: 'متابعة',
    cancel: 'إلغاء',
    loading: 'جارٍ التحميل…',
    retry: 'إعادة المحاولة',
  },

  // ── الإعداد الأولي ──
  onboarding: {
    slogan: 'مفاتيحك، عملاتك. محفظة متعددة السلاسل ذاتية الحفظ.',
    createNewWallet: 'إنشاء محفظة جديدة',
    importExistingWallet: 'استيراد محفظة موجودة',
    license: 'ترخيص Apache-2.0 · بدون خوادم · بدون تتبع',
    recoveryPhraseTitle: 'عبارة الاسترداد الخاصة بك',
    writeWords: 'اكتب هذه الكلمات {{count}} بالترتيب واحتفظ بها بأمان. هذه هي الطريقة الوحيدة لاستعادة محفظتك.',
    neverShare: '⚠ لا تشارك هذه العبارة مع أي شخص أبدًا',
    savedContinue: 'لقد حفظتها، متابعة',
    verifyTitle: 'تحقق من عبارة الاسترداد',
    verifyDesc: 'اختر الكلمة الصحيحة لكل موضع لتأكيد أنك حفظت العبارة',
    wordNumber: 'الكلمة رقم {{n}}',
    importTitle: 'استيراد عبارة الاسترداد',
    importLabel: 'أدخل عبارتك المكونة من 12 أو 24 كلمة',
    importPlaceholder: 'كلمة1 كلمة2 كلمة3 ...',
    setPasswordTitle: 'تعيين كلمة المرور',
    setPasswordDesc: 'تقوم كلمة المرور هذه بتشفير محفظتك محليًا. لا يمكننا مساعدتك في استعادتها.',
    passwordLabel: 'كلمة المرور',
    passwordPlaceholder: '8 أحرف على الأقل، حرف كبير + رقم',
    confirmPasswordLabel: 'تأكيد كلمة المرور',
    confirmPasswordPlaceholder: 'أعد إدخال كلمة المرور',
    createWallet: 'إنشاء المحفظة',
    importWallet: 'استيراد المحفظة',
    invalidMnemonic: 'عبارة الاسترداد غير صالحة. تحقق من جميع الكلمات.',
    incorrectVerify: 'اختيار غير صحيح — يرجى التحقق من عبارة الاسترداد الخاصة بك',
    passwordsDoNotMatch: 'كلمتا المرور غير متطابقتين',
    passwordTooWeak: 'كلمة المرور ضعيفة جدًا',
  },

  // ── فتح القفل ──
  unlock: {
    title: 'فتح محفظتك',
    desc: 'أدخل كلمة المرور لفتح القفل. لا تغادر مفاتيحك هذا الجهاز أبدًا.',
    passwordLabel: 'كلمة المرور',
    passwordPlaceholder: 'أدخل كلمة المرور الخاصة بك',
    showPassword: 'إظهار كلمة المرور',
    hidePassword: 'إخفاء كلمة المرور',
    unlock: 'فتح القفل',
    unlocking: 'جارٍ فتح القفل…',
    enterPassword: 'يرجى إدخال كلمة المرور',
    incorrectPassword: 'كلمة المرور غير صحيحة. حاول مرة أخرى.',
    forgotPassword: 'نسيت كلمة المرور؟ إعادة تعيين المحفظة',
    resetConfirm: 'إعادة تعيين المحفظة؟ سيتم مسح جميع البيانات. تأكد من أن لديك عبارة الاسترداد.',
  },

  // ── الرئيسية ──
  home: {
    balanceOf: '{{chain}} — رصيد {{symbol}}',
    assets: 'الأصول ({{count}})',
    recentTransactions: 'المعاملات الأخيرة',
    viewAll: 'عرض الكل ←',
    noTransactions: 'لا توجد معاملات بعد',
    send: 'إرسال',
    receive: 'استلام',
    history: 'السجل',
    lock: 'قفل',
    sent: 'مرسل',
    received: 'مستلم',
    sentToken: '{{symbol}} مرسل',
    receivedToken: '{{symbol}} مستلم',
    pending: 'قيد الانتظار',
    footer: '7xCircle Wallet · Apache-2.0 · v0.1.0',
  },

  // ── الاستلام ──
  receive: {
    title: 'استلام',
    desc: 'أرسل الأصول إلى هذا العنوان',
    copyAddress: 'نسخ العنوان',
    copied: 'تم النسخ!',
    noAccount: 'لا يوجد حساب لهذه السلسلة بعد',
    warning: '⚠ أرسل الأصول على السلسلة المطابقة فقط',
  },

  // ── سجل المعاملات ──
  history: {
    title: 'سجل المعاملات',
    failedToLoad: 'فشل تحميل المعاملات: {{error}}',
    noTxTitle: 'لا توجد معاملات بعد',
    noTxDesc: 'سيظهر سجلك لـ {{chain}} هنا بمجرد إرسال أو استلام الأموال.',
    send: 'إرسال {{symbol}}',
    sent: 'مرسل',
    received: 'مستلم',
    sentToken: '{{symbol}} مرسل',
    receivedToken: '{{symbol}} مستلم',
    confirmed: 'مؤكد',
    failed: 'فشل',
    pending: 'قيد الانتظار',
    showing: 'عرض {{count}} معاملة',
    autoRefreshing: '· تحديث تلقائي',
    justNow: 'الآن',
    minutesAgo: 'قبل {{n}} دقيقة',
    hoursAgo: 'قبل {{n}} ساعة',
    daysAgo: 'قبل {{n}} يوم',
    networkFee: 'رسوم الشبكة',
  },

  // ── الإرسال ──
  send: {
    title: 'إرسال',
    native: 'أصلي',
    erc20: 'ERC20',
    heldTokens: 'الرموز المملوكة ({{count}})',
    customAddress: 'عنوان مخصص',
    selectToken: 'اختر الرمز',
    searchPlaceholder: 'ابحث عن رمز بالاسم أو الرمز أو العنوان…',
    noTokensMatch: 'لا توجد رموز تطابق "{{query}}"',
    loadTokenAt: 'تحميل الرمز عند {{addr}}…',
    noTokensFound: 'لم يتم العثور على رموز ERC20. قم بالتبديل إلى العنوان المخصص للإرسال.',
    tokenContractLabel: 'عنوان عقد الرمز',
    tokenContractPlaceholder: '0x...',
    readingTokenInfo: 'جارٍ قراءة معلومات الرمز...',
    tokenLoaded: '✓ {{name}} ({{symbol}}) · {{decimals}} منازل عشرية',
    from: 'من:',
    balance: 'الرصيد: {{amount}} {{symbol}}',
    gasHint: '· {{amount}} {{symbol}} للغاز',
    recipientLabel: 'عنوان المستلم',
    recipientPlaceholder: '0x...',
    invalidAddress: 'عنوان EVM غير صالح',
    amountLabel: 'المبلغ ({{symbol}})',
    amountPlaceholder: '0.00',
    max: 'الحد الأقصى',
    networkFee: 'رسوم الشبكة',
    estimatingFee: 'تقدير الرسوم...',
    tronEnergyTitle: 'طاقة TRON',
    tronEnergyBurn: 'الطاقة غير كافية — سيُحرق نحو {{amount}} {{symbol}}.',
    tronEnergyRent: 'استئجار الطاقة بدلًا من ذلك: نحو {{amount}} {{symbol}}.',
    tronEnergySubLot: 'تم تخطي الاستئجار — العجز أقل من الحد الأدنى للمورّد.',
    tronEnergyCovered: 'الطاقة المُرهونة تكفي هذا التحويل (يلزم {{energy}}).',
    tronEnergyRentAction: 'استئجار الطاقة بدلًا من ذلك',
    tronEnergyRentConfirm: 'دفع {{amount}} {{symbol}} لاستئجار هذه الطاقة؟',
    tronEnergyRentConfirmAction: 'ادفع واستأجر',
    tronEnergyRenting: 'جارٍ التوقيع وإرسال طلب الاستئجار...',
    tronEnergyRentDone: 'تم تفويض الطاقة — يمكن لهذا التحويل استخدامها الآن.',
    tronEnergyRentPending: 'تم إرسال الطلب — اكتمل {{percent}}%، والتفويض مستمر.',
    tronEnergyRentFailed: 'تعذّر إنشاء طلب الاستئجار. لم يُرسل أي TRX.',
    feeTierLabel: 'سرعة المعاملة',
    feeTier: {
      slow: 'بطيء',
      normal: 'عادي',
      fast: 'سريع',
    },
    preparing: 'تحضير المعاملة...',
    signing: 'التوقيع بمفتاحك الخاص...',
    broadcasting: 'بث إلى الشبكة...',
    waitingConfirmation: 'بانتظار التأكيد...',
    reviewTransaction: 'مراجعة المعاملة',
    reviewTitle: 'تأكيد الإرسال',
    confirmAndSend: 'تأكيد وإرسال',
    to: 'إلى:',
    amount: 'المبلغ:',
    fee: 'الرسوم:',
    tokenTransferNote: 'هذا تحويل رمز. سيتم إرسال المعاملة إلى عقد الرمز، وليس مباشرة إلى المستلم.',
    doubleCheck: 'يرجى التحقق من العنوان بعناية. لا يمكن عكس المعاملات.',
    walletNotReady: 'المحفظة غير جاهزة',
    tokenNotLoaded: 'عقد الرمز غير محمّل',
    walletLockedBeforeConfirm: 'تم قفل المحفظة قبل التأكيد',
    txReverted: 'تم إرجاع المعاملة بواسطة السلسلة',
    couldNotEstimateFee: 'تعذر تقدير الرسوم — جرب RPC آخر',
    invalidAmount: 'أدخل مبلغًا موجبًا صالحًا',
    amountExceeds: 'المبلغ يتجاوز الرصيد',
    amountMustBePositive: 'يجب أن يكون المبلغ أكبر من 0',
    invalidContractAddress: 'عنوان عقد غير صالح',
    notValidToken: 'ليس رمز ERC20 صالحًا',
    txConfirmed: 'تم تأكيد المعاملة',
    txFailed: 'فشلت المعاملة',
    txConfirmedDesc: 'تم تأكيد معاملتك.',
    txFailedDesc: 'فشلت معاملتك.',
  },

  // ── الإعدادات ──
  settings: {
    title: 'الإعدادات',
    theme: 'المظهر',
    dark: 'داكن',
    light: 'فاتح',
    language: 'اللغة',
    english: 'English',
    chinese: '中文',
    japanese: '日本語',
    french: 'Français',
    korean: '한국어',
    arabic: 'العربية',
    about: 'حول',
    resetWallet: 'إعادة تعيين المحفظة',
    resetWarning: 'سيؤدي هذا إلى مسح جميع البيانات. تأكد من نسخ عبارة الاسترداد احتياطيًا.',
    resetConfirmTitle: 'إعادة تعيين المحفظة؟',
    resetConfirmDesc: 'سيؤدي هذا إلى حذف محفظتك المشفرة من هذا الجهاز. ستحتاج إلى عبارة الاسترداد لاستعادتها.',
    yesReset: 'نعم، إعادة تعيين كل شيء',
  },
};
