# نشر الصياد الباحث Web على GitHub Pages

المشروع جاهز للنشر دون بناء إلزامي. استخدم مستودعًا جديدًا باسم `research-hunter-web` تحت حساب `ensanbinadam`، مستقلًا عن `research-hunter-generator` والإضافة.

## النشر من المتصفح

1. فك ضغط حزمة `research-hunter-web-github-pages.zip`.
2. افتح [إنشاء مستودع GitHub](https://github.com/new)، واختر المالك `ensanbinadam` والاسم `research-hunter-web`. اجعله عامًا إذا كنت تستخدم خطة GitHub المجانية لنشر Pages.
3. ارفع **محتويات الحزمة** إلى جذر المستودع، بحيث يظهر `index.html` مباشرة بجانب `README.md`، ويظهر مجلد `assets`. لا تضع المحتويات داخل مجلد إضافي.
4. احفظ الرفع على الفرع `main`.
5. افتح **Settings → Pages**.
6. من **Build and deployment** اختر **Deploy from a branch**، ثم `main` و`/ (root)`، واضغط **Save**.
7. انتظر اكتمال نشر Pages، ثم استخدم رابط **Visit site** الذي يعرضه GitHub. قد يستغرق ظهور النشر عدة دقائق.

العنوان المتوقع بعد النشر، وليس دليلًا على أنه منشور مسبقًا:

```text
https://ensanbinadam.github.io/research-hunter-web/
```

جميع روابط الملفات نسبية، وتعمل تحت المسار الفرعي للمستودع. ملف `.nojekyll` مرفق. لا حاجة إلى نطاق خاص أو أسرار أو متغيرات بيئة أو مفاتيح API.

## النشر باستخدام Git

بعد إنشاء مستودع فارغ على GitHub، نفّذ من مجلد الملفات المفكوكة:

```sh
git init -b main
git add .
git commit -m "Launch Research Hunter Web"
git remote add origin https://github.com/ensanbinadam/research-hunter-web.git
git push -u origin main
```

إذا كان المجلد مستودع Git بالفعل، تجاهل `git init`؛ وإذا كان له `origin` مختلف فاستخدم اسم remote جديدًا مثل `github` بدل استبدال وجهته. لا تستخدم مستودع المولّد أو مجلد الإضافة لهذا الرفع. ثم فعّل Pages من الفرع والجذر كما سبق.

## التحديث

عدّل الملفات في هذا المشروع فقط، ثم شغّل `npm test` وارفع التغييرات إلى `main`. عند استخدام Pages من الجذر لا يلزم رفع `dist/`؛ مصدره هو `index.html` و`assets/` في الجذر. حزمة `research-hunter-web-site-only.zip` بديل صغير لأي استضافة ثابتة، وتحتوي ملفات التشغيل وعينات JSON فقط.

## بعد النشر

- افتح الموقع من الرابط النهائي، وجرّب إضافة تصنيف ثم إعادة تحميل الصفحة.
- جرّب `samples/categories-demo.json` في نافذة الاستيراد، وراجع معاينة الدمج قبل التطبيق.
- نزّل نسخة Web كاملة وتحقق من حفظها في جهازك.
- اسمح بالنوافذ المنبثقة لهذا الموقع إذا منع المتصفح فتح نتائج X، أو استخدم رابط الدفعة اليدوي.
- اختبر السابق والتالي. إعادة استخدام التبويب محاولة تخضع لعزل X والمتصفح، وليست ضمانًا.

الحفظ المحلي مرتبط **بأصل الموقع والمتصفح**. نقل الموقع من المعاينة إلى GitHub Pages لا ينقل المكتبة تلقائيًا؛ نزّل نسخة Web واستعدها في العنوان الجديد.

مرجع الإعدادات: [إنشاء موقع GitHub Pages — توثيق GitHub الرسمي](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
