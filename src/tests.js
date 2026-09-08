/* ===== בדיקות יחידה ל-calc.js =====
   רצות בדפדפן: פותחים את tests.html דרך  python -m http.server 5178
   ואז  http://localhost:5178/tests.html
   בלי כלי בנייה ובלי חבילות – אותם כללי משחק כמו שאר הפרויקט. */

(function () {
  'use strict';

  var results = [];
  function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function test(name, fn) {
    try { fn(); results.push({ name: name, ok: true }); }
    catch (e) { results.push({ name: name, ok: false, msg: e && e.message ? e.message : String(e) }); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'ציפייה נכשלה'); }
  function assertEq(got, want, msg) {
    if (!eq(got, want)) {
      throw new Error((msg ? msg + ': ' : '') + 'קיבלנו ' + JSON.stringify(got) + ', ציפינו ל-' + JSON.stringify(want));
    }
  }
  // פורמט מקוצר לבדיקות – מספיק כדי לזהות שהסכום הנכון הגיע לטקסט
  function nis(n) { return (Number(n) || 0) + '₪'; }

  var AREAS = ['חדר שינה', 'סלון', 'מטבח', 'אמבטיה ושירותים', 'ניקיון וכביסה', 'תאורה וחשמל', 'כללי'];

  // בונה state מינימלי. מה שלא מועבר – ריק.
  function st(o) {
    o = o || {};
    return {
      settings: o.settings || {},
      tasks: o.tasks || [],
      shopping: o.shopping || [],
      boxes: o.boxes || [],
      docs: o.docs || [],
      contacts: o.contacts || [],
      services: o.services || [],
      shopAreas: o.shopAreas || AREAS.slice(),
      budgetSections: o.budgetSections || [
        { id: 'once', name: 'הוצאות חד-פעמיות', recurring: false },
        { id: 'recurring', name: 'הוצאות שוטפות', recurring: true }
      ],
      budget: o.budget || []
    };
  }
  function row(section, planned, actual) {
    return { id: 'r' + Math.random(), section: section, cat: 'סעיף', planned: planned, actual: actual };
  }
  function item(o) {
    return {
      id: 'i' + Math.random(), name: o.name || 'פריט', area: o.area == null ? 'כללי' : o.area,
      prio: o.prio || 'soon', est: o.est || 0, cost: o.cost || 0,
      bought: !!o.bought, gift: !!o.gift
    };
  }

  /* ================= תקציב: חד-פעמי מול חודשי ================= */

  test('חד-פעמי בלבד: אין שום זליגה לסכום החודשי', function () {
    var s = st({ budget: [row('once', 8500, 3000)] });
    var b = AfulaCalc.budgetStats(s);
    assertEq(b.once.planned, 8500);
    assertEq(b.once.actual, 3000);
    assertEq(b.once.remaining, 5500);
    assertEq(b.monthly.planned, 0);
    assertEq(b.monthly.actual, 0);
  });

  test('חוזר בלבד: אין שום זליגה לסכום החד-פעמי', function () {
    var s = st({ budget: [row('recurring', 8995, 3195)] });
    var b = AfulaCalc.budgetStats(s);
    assertEq(b.monthly.planned, 8995);
    assertEq(b.monthly.actual, 3195);
    assertEq(b.monthly.remaining, 5800);
    assertEq(b.once.planned, 0);
    assertEq(b.once.actual, 0);
  });

  test('שניהם מלאים: שני הסיכומים נשארים נפרדים, ואין "סה״כ" משותף', function () {
    var s = st({ budget: [row('once', 8500, 0), row('recurring', 8995, 3195)] });
    var b = AfulaCalc.budgetStats(s);
    assertEq(b.once.planned, 8500);
    assertEq(b.monthly.planned, 8995);
    // המספר השבור הישן היה 17,495 מתוכנן ו-14,300 "פנוי". אף אחד מהם לא קיים יותר.
    assert(b.once.planned !== 17495, 'אסור לחבר מתוכנן חד-פעמי לחודשי');
    assertEq(b.once.remaining, 8500);
    assertEq(b.monthly.remaining, 5800);
    assert(!('planned' in b) && !('remaining' in b), 'אסור שיהיה סיכום גלובלי מעורבב');
  });

  test('חריגה נבדקת לכל סיכום בנפרד', function () {
    var s = st({ budget: [row('once', 1000, 1500), row('recurring', 5000, 4000)] });
    var b = AfulaCalc.budgetStats(s);
    assertEq(b.once.over, true);
    assertEq(b.monthly.over, false);
    assertEq(AfulaCalc.onceBadge(s, nis).tone, 'warn');
    assertEq(AfulaCalc.monthlyBadge(s, nis).tone, 'ok');
  });

  test('הוצאות הקניות נכנסות לסכום החד-פעמי, ופעם אחת בלבד', function () {
    var s = st({
      budget: [row('once', 8500, 0)],
      shopping: [
        item({ area: 'מטבח', cost: 1000, bought: true }),
        item({ area: 'סלון', cost: 390, bought: true }),
        item({ area: 'סלון', cost: 500, bought: false })   // עוד לא נקנה – לא נספר
      ]
    });
    var b = AfulaCalc.budgetStats(s);
    assertEq(b.once.shoppingActual, 1390);
    assertEq(b.once.budgetActual, 0);
    assertEq(b.once.actual, 1390, 'הסכום בפועל הוא שורות התקציב ועוד הקניות, בלי כפילות');
    assertEq(b.once.remaining, 7110);
    assertEq(b.once.pct, 16);
    assertEq(b.monthly.actual, 0, 'קניות לעולם לא נכנסות לעלות החודשית');
  });

  test('מתנה נספרת כנקנתה ויוצאת מכל החישובים – בלי הסתייגות בשורת המצב', function () {
    var s = st({
      budget: [row('once', 1000, 0)],
      shopping: [item({ name: 'קומקום', area: 'מטבח', est: 300, cost: 0, bought: true, gift: true })]
    });
    var sh = AfulaCalc.shopStats(s);
    assertEq(sh.bought, 1);
    assertEq(sh.gifts, 1);
    assertEq(sh.unknownCost, 0, 'מתנה אינה "מחיר לא ידוע"');
    assertEq(sh.spend, 0);
    assertEq(sh.est, 0, 'מתנה אינה נספרת גם באומדן');
    assertEq(sh.estCount, 0);
    assertEq(sh.estScope, 0, 'מתנה אינה בתוך מכנה כיסוי האומדן');
    assertEq(AfulaCalc.areaStats(s, 'מטבח').est, 0);
    var b = AfulaCalc.budgetStats(s);
    assertEq(b.once.actual, 0);
    assertEq(b.once.gifts, 1);
    var badge = AfulaCalc.onceBadge(s, nis);
    assertEq(badge.tone, 'ok', 'מתנה אינה אזהרה ואינה מורידה את ה-✅');
    assertEq(badge.text.indexOf('מתנה'), -1, 'אין להסביר את המתנה בשורת המצב');
  });

  test('מתנה בלי דגל bought עדיין נספרת כנקנתה', function () {
    var s = st({ shopping: [item({ name: 'שטיח', gift: true, bought: false, prio: 'must' })] });
    var sh = AfulaCalc.shopStats(s);
    assertEq(sh.bought, 1);
    assertEq(sh.gifts, 1);
    assertEq(sh.spend, 0);
    assertEq(sh.mustLeft, 0, 'פריט שהתקבל במתנה כבר לא חסר');
  });

  test('פריט שנקנה בלי מחיר: נספר כנקנה, לא נספר כהוצאה, ומסומן כאזהרה', function () {
    var s = st({
      budget: [row('once', 1000, 0)],
      shopping: [item({ name: 'מדף', area: 'סלון', cost: 0, bought: true })]
    });
    var sh = AfulaCalc.shopStats(s);
    assertEq(sh.bought, 1);
    assertEq(sh.unknownCost, 1);
    assertEq(sh.gifts, 0);
    assertEq(sh.spend, 0);
    assertEq(AfulaCalc.budgetStats(s).once.actual, 0);
    var w = AfulaCalc.dataWarnings(s);
    assert(w.length === 1 && w[0].indexOf('לא נרשם מחיר') !== -1, 'צריכה להופיע אזהרת מחיר חסר');
    assertEq(AfulaCalc.onceBadge(s, nis).tone, 'note');
  });

  test('פריט עם אזור לא מוכר נספר בכל הסיכומים ומקבל קבוצה משלו', function () {
    var s = st({
      shopping: [
        item({ name: 'מזגן', area: 'מרפסת', cost: 900, bought: true, est: 800, prio: 'must' }),
        item({ name: 'שולחן', area: 'מרפסת', prio: 'must' }),
        item({ name: 'כוסות', area: 'מטבח', cost: 100, bought: true })
      ]
    });
    var sh = AfulaCalc.shopStats(s);
    assertEq(sh.total, 3);
    assertEq(sh.spend, 1000, 'הפריטים היתומים נספרים בהוצאה');
    assertEq(sh.mustLeft, 1, 'הפריטים היתומים נספרים במונה "חייבים"');
    assertEq(sh.orphans, 2);
    assertEq(AfulaCalc.budgetStats(s).once.shoppingActual, 1000);

    var groups = AfulaCalc.areaGroups(s);
    var last = groups[groups.length - 1];
    assertEq(last.key, AfulaCalc.NO_AREA);
    assertEq(last.label, 'ללא אזור');
    assertEq(groups.length, 8, 'שבעה אזורים מוכרים ועוד קבוצת היתומים');
    var ast = AfulaCalc.areaStats(s, AfulaCalc.NO_AREA);
    assertEq(ast.total, 2);
    assertEq(ast.est, 800);
    assertEq(ast.spend, 900);
    assert(AfulaCalc.dataWarnings(s).join(' ').indexOf('ללא אזור') !== -1);
  });

  test('שורת תקציב עם קטגוריה לא מוכרת לא נעלמת ונחשבת חד-פעמית', function () {
    var s = st({ budget: [row('once', 100, 50), row('קטגוריה-שנמחקה', 200, 200)] });
    var b = AfulaCalc.budgetStats(s);
    assertEq(b.once.planned, 300);
    assertEq(b.once.actual, 250);
    assertEq(b.monthly.planned, 0);
    var groups = AfulaCalc.sectionGroups(s);
    assertEq(groups[groups.length - 1].key, AfulaCalc.NO_SECTION);
    assertEq(AfulaCalc.sectionStats(s, AfulaCalc.NO_SECTION).count, 1);
  });

  test('כיסוי האומדן מדווח כמה פריטים באמת קיבלו הערכה', function () {
    var s = st({
      shopping: [item({ est: 100 }), item({ est: 0 }), item({ est: 250 }), item({ est: 0 })]
    });
    assertEq(AfulaCalc.estCoverageText(s), 'אומדן ל־2 מתוך 4 פריטים');
    assertEq(AfulaCalc.shopStats(s).est, 350);
  });

  test('בלי תכנון אין הצהרה על עמידה בתקציב', function () {
    var s = st({ budget: [row('once', 0, 500)] });
    assertEq(AfulaCalc.budgetStats(s).once.over, false);
    assertEq(AfulaCalc.onceBadge(s, nis).tone, 'muted');
    assertEq(AfulaCalc.monthlyBadge(s, nis).tone, 'muted');
  });

  /* ================= התראת השירותים ================= */

  function svc(name, status, notes) {
    return { id: 's' + Math.random(), name: name, status: status || 'todo', notes: notes || '' };
  }

  test('אפס שירותים פתוחים: הכרטיס לא מוצג בכלל', function () {
    var s = st({ settings: { moveDate: '2026-09-10' }, services: [svc('אינטרנט', 'done')] });
    assertEq(AfulaCalc.serviceAlert(s), null);
    assertEq(AfulaCalc.serviceAlert(st({})), null, 'בלי שירותים בכלל גם אין כרטיס');
  });

  test('שירות פתוח אחד: לשון יחיד', function () {
    var s = st({ services: [svc('אינטרנט', 'todo', 'להזמין שבוע מראש.'), svc('בנק', 'done')] });
    var a = AfulaCalc.serviceAlert(s);
    assertEq(a.title, 'שירות אחד עדיין לא הועבר');
    assertEq(a.tab, 'services');
  });

  test('יותר משלושה פתוחים: הכרטיס מציג את המספר בלבד', function () {
    var s = st({
      settings: { moveDate: '2026-09-16' },
      services: [svc('אינטרנט'), svc('העברת דואר'), svc('שינוי כתובת בת"ז'),
                 svc('קופת חולים'), svc('בנק וכרטיסי אשראי')]
    });
    var a = AfulaCalc.serviceAlert(s);
    assertEq(a.title, '5 שירותים עדיין לא הועברו');
    assertEq(a.sub, undefined, 'אין משפט הסבר – הפרטים נמצאים במסך השירותים');
  });

  test('שום שם שירות – מהנתונים או קבוע בקוד – לא מופיע בכרטיס', function () {
    var s = st({ services: [svc('מנוי לחדר כושר ליד הבית', 'wip'), svc('אינטרנט', 'todo')] });
    var txt = JSON.stringify(AfulaCalc.serviceAlert(s));
    // הטקסט הישן נקב בחשמל, מים וארנונה – שלושה שירותים שאינם רשומות כלל
    ['חשמל', 'מים', 'ארנונה', 'אינטרנט', 'מנוי לחדר כושר'].forEach(function (n) {
      assert(txt.indexOf(n) === -1, 'אסור ששם השירות "' + n + '" יופיע בכרטיס');
    });
  });

  test('שירות בסטטוס שאינו מוכר נחשב פתוח ולא נעלם מהספירה', function () {
    var s = st({ services: [svc('אינטרנט', 'הועבר-חלקית'), svc('בנק', 'done')] });
    assertEq(AfulaCalc.openServices(s).length, 1);
    assertEq(AfulaCalc.serviceAlert(s).title, 'שירות אחד עדיין לא הועבר');
  });

  test('listStats מסכם אוסף פריטים מסונן, ומתנה נשארת מחוץ לכסף', function () {
    var list = [
      item({ name: 'ספה', est: 2000, cost: 1800, bought: true }),
      item({ name: 'כורסא', est: 400, cost: 0, bought: true }),          // מחיר לא נרשם
      item({ name: 'מנורה', est: 300, cost: 0, bought: true, gift: true }), // מתנה
      item({ name: 'שטיח', est: 500 })                                  // טרם נקנה
    ];
    var st2 = AfulaCalc.listStats(list);
    assertEq(st2.total, 4);
    assertEq(st2.bought, 3, 'מתנה נספרת כנקנתה');
    assertEq(st2.est, 2900, 'המתנה יוצאת מהאומדן');
    assertEq(st2.spend, 1800);
    assertEq(st2.gifts, 1);
    assertEq(st2.unknownCost, 1);
    assertEq(AfulaCalc.listStats([]).spend, 0);
  });

  /* ================= פלט ================= */

  var pass = results.filter(function (r) { return r.ok; }).length;
  var fail = results.length - pass;
  var el = document.getElementById('out');
  el.innerHTML =
    '<div class="sum ' + (fail ? 'bad' : 'good') + '">' +
    (fail ? '✖ ' + fail + ' נכשלו' : '✔ הכול עבר') + ' · ' + pass + '/' + results.length + '</div>' +
    results.map(function (r) {
      return '<div class="t ' + (r.ok ? 'ok' : 'no') + '">' + (r.ok ? '✔' : '✖') + ' ' + r.name +
        (r.ok ? '' : '<div class="msg">' + r.msg + '</div>') + '</div>';
    }).join('');
  (fail ? console.error : console.log)('בדיקות: ' + pass + '/' + results.length + ' עברו');
})();
