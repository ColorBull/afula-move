/* ===== ניהול מעבר דירה · חישובים טהורים =====
   כל מה שכאן הוא פונקציות ללא תופעות לוואי: מקבלות state ומחזירות מספרים
   או מחרוזות. אין כאן DOM, אין state גלובלי ואין קריאה ל-render.
   הקובץ נטען לפני app.js וגם לבדו על ידי tests.html, וזו הסיבה שהוא נפרד:
   app.js כולו עטוף ב-IIFE ולכן אי אפשר לבדוק שום דבר מתוכו.

   שני עקרונות שאסור לשבור כאן:
   1. לעולם לא לחבר סכום חד-פעמי (₪) לסכום חוזר (₪ לחודש). אלה יחידות שונות,
      וכל מספר שנגזר מהחיבור הזה חסר משמעות.
   2. שום ערך לא גורם לרשומה להיעלם. ערך אזור/שלב/סטטוס שאינו ברשימה המוכרת
      מקבל קבוצה משלו במקום להישמט בשקט. */

var AfulaCalc = (function () {
  'use strict';

  function num(v) { return Number(v) || 0; }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

  // מפתחות הקבוצות של "מה שלא מוכר". תוויות תצוגה בלבד – לא ערכים שנשמרים בנתונים.
  var NO_AREA = '__noarea__';
  var NO_SECTION = '__nosection__';
  var NO_PHASE = '__nophase__';

  /* ================= קניות ================= */

  // מתנה: נקנה, אבל לא יצא עליו כסף. שונה מ"פריט שלא נרשם לו מחיר".
  function isGift(it) { return !!(it && it.gift); }
  // מתנה משמעה שהפריט כבר בבית, ולכן היא נספרת כנקנתה גם אם הדגל bought
  // לא הוזן (למשל ברשומה שנכתבה דרך שרת ה-MCP).
  function isBought(it) { return !!(it && (it.bought || it.gift)); }
  // נקנה, אינו מתנה, ואין סכום ששולם – כלומר המחיר פשוט לא הוזן.
  function isCostUnknown(it) { return isBought(it) && !isGift(it) && num(it.cost) <= 0; }
  // כמה כסף באמת יצא על הפריט. מתנה תורמת 0, ופריט שלא נקנה תורם 0.
  function itemSpend(it) { return (isBought(it) && !isGift(it)) ? num(it.cost) : 0; }

  function knownAreas(state) { return arr(state && state.shopAreas); }
  // אזור שאינו ברשימה המוכרת לא נעלם – הוא נופל לקבוצת "ללא אזור".
  function itemAreaKey(state, it) {
    var a = (it && it.area != null) ? String(it.area) : '';
    return knownAreas(state).indexOf(a) >= 0 ? a : NO_AREA;
  }

  function shopStats(state) {
    var st = { total: 0, bought: 0, gifts: 0, unknownCost: 0, spend: 0,
               est: 0, estCount: 0, estScope: 0, mustLeft: 0, orphans: 0 };
    arr(state && state.shopping).forEach(function (s) {
      st.total++;
      // מתנה אינה נכנסת לשום חישוב כספי – לא לאומדן ולא להוצאה בפועל.
      if (!isGift(s)) {
        st.estScope++;
        st.est += num(s.est);
        if (num(s.est) > 0) st.estCount++;
      }
      if (itemAreaKey(state, s) === NO_AREA) st.orphans++;
      if (isBought(s)) {
        st.bought++;
        if (isGift(s)) st.gifts++;
        else if (isCostUnknown(s)) st.unknownCost++;
        st.spend += itemSpend(s);
      } else if (s.prio === 'must') st.mustLeft++;
    });
    return st;
  }

  // סיכום כספי של אוסף פריטים כלשהו – קטגוריה שלמה, או מה שנשאר
  // אחרי סינון. מתנה אינה נכנסת לאומדן ולא להוצאה בפועל, כמו בכל חישוב אחר.
  function listStats(list) {
    var st = { total: 0, bought: 0, est: 0, spend: 0, gifts: 0, unknownCost: 0 };
    arr(list).forEach(function (s) {
      st.total++;
      if (!isGift(s)) st.est += num(s.est);
      if (isBought(s)) {
        st.bought++;
        if (isGift(s)) st.gifts++;
        else if (isCostUnknown(s)) st.unknownCost++;
        st.spend += itemSpend(s);
      }
    });
    return st;
  }

  function areaStats(state, key) {
    return listStats(arr(state && state.shopping).filter(function (s) {
      return itemAreaKey(state, s) === key;
    }));
  }

  // הקבוצות שמסך הקניות מציג: כל האזורים המוכרים, ואחריהם "ללא אזור" אם יש.
  function areaGroups(state) {
    var out = knownAreas(state).map(function (a) { return { key: a, label: a, unknown: false }; });
    if (shopStats(state).orphans) out.push({ key: NO_AREA, label: 'ללא אזור', unknown: true });
    return out;
  }

  /* ================= תקציב ================= */

  function sectionById(state, id) {
    var list = arr(state && state.budgetSections);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  // שורה שהקטגוריה שלה לא מוכרת נחשבת חד-פעמית: עדיף לספור אותה בעלות המעבר
  // מאשר להעלים אותה או להכניס אותה בטעות לסכום החודשי.
  function isRecurringRow(state, row) {
    var s = sectionById(state, row && row.section);
    return !!(s && s.recurring);
  }
  function rowSectionKey(state, row) {
    return sectionById(state, row && row.section) ? row.section : NO_SECTION;
  }
  function sectionStats(state, key) {
    var st = { planned: 0, actual: 0, count: 0 };
    arr(state && state.budget).forEach(function (r) {
      if (rowSectionKey(state, r) !== key) return;
      st.count++; st.planned += num(r.planned); st.actual += num(r.actual);
    });
    return st;
  }
  function sectionGroups(state) {
    var out = arr(state && state.budgetSections).map(function (s) {
      return { key: s.id, label: s.name, recurring: !!s.recurring, unknown: false };
    });
    if (sectionStats(state, NO_SECTION).count) {
      out.push({ key: NO_SECTION, label: 'ללא קטגוריה', recurring: false, unknown: true });
    }
    return out;
  }

  /* שני סיכומים נפרדים לחלוטין:
       once    – תקציב המעבר, ב-₪ חד-פעמיים
       monthly – עלות שוטפת, ב-₪ לחודש
     אין ביניהם שום פעולת חשבון משותפת, ואין "סך הכול מתוכנן" שמחבר אותם. */
  function budgetStats(state) {
    var sh = shopStats(state);
    var oncePlanned = 0, onceRows = 0, recPlanned = 0, recActual = 0;
    arr(state && state.budget).forEach(function (r) {
      if (isRecurringRow(state, r)) { recPlanned += num(r.planned); recActual += num(r.actual); }
      else { oncePlanned += num(r.planned); onceRows += num(r.actual); }
    });
    // הוצאות הקניות נספרות פעם אחת בלבד: הן נכנסות לסכום החד-פעמי כאן,
    // ואינן משויכות לשום שורת תקציב.
    var onceActual = onceRows + sh.spend;
    return {
      once: {
        planned: oncePlanned,
        budgetActual: onceRows,
        shoppingActual: sh.spend,
        actual: onceActual,
        remaining: oncePlanned - onceActual,
        pct: pct(onceActual, oncePlanned),
        over: oncePlanned > 0 && onceActual > oncePlanned,
        gifts: sh.gifts,
        unknownCost: sh.unknownCost
      },
      monthly: {
        planned: recPlanned,
        actual: recActual,
        remaining: recPlanned - recActual,
        pct: pct(recActual, recPlanned),
        over: recPlanned > 0 && recActual > recPlanned
      }
    };
  }

  /* ---------- אזהרות איכות נתונים ---------- */
  // רק דברים שנגזרים מהנתונים עצמם. אין כאן שום הנחה על המעבר.
  function dataWarnings(state) {
    var sh = shopStats(state), out = [];
    if (sh.unknownCost) {
      out.push(sh.unknownCost === 1
        ? 'לפריט אחד שסומן כנקנה לא נרשם מחיר, ולכן "שולם בפועל" חלקי.'
        : 'ל־' + sh.unknownCost + ' פריטים שסומנו כנקנו לא נרשם מחיר, ולכן "שולם בפועל" חלקי.');
    }
    if (sh.orphans) {
      out.push(sh.orphans === 1
        ? 'פריט אחד משויך לאזור שאינו ברשימת הקטגוריות ומוצג תחת "ללא אזור".'
        : sh.orphans + ' פריטים משויכים לאזור שאינו ברשימת הקטגוריות ומוצגים תחת "ללא אזור".');
    }
    return out;
  }

  // כיסוי האומדן: "אומדן ל־14 מתוך 39 פריטים"
  function estCoverageText(state) {
    var sh = shopStats(state);
    if (!sh.estScope) return '';
    return 'אומדן ל־' + sh.estCount + ' מתוך ' + sh.estScope + ' פריטים';
  }

  /* ---------- שורת המצב של כל סיכום, בנפרד ---------- */
  // nis מוזרק כדי ש-calc.js יישאר בלי תלות בפורמט התצוגה של app.js.
  function onceBadge(state, nis) {
    var o = budgetStats(state).once;
    if (!o.planned) return { tone: 'muted', text: 'כדאי למלא סכומים מתוכננים לתקציב המעבר' };
    if (o.over) {
      return { tone: 'warn', text: '⚠️ חריגה של ' + nis(o.actual - o.planned) + ' מתקציב המעבר' };
    }
    var base = 'נוצלו ' + nis(o.actual) + ' מתוך ' + nis(o.planned) +
      ' (' + o.pct + '%), נותרו ' + nis(o.remaining);
    // מתנה אינה מסויגת כאן: היא הוצאה מכל החישובים, כך שה"נותר" נכון כמות
    // שהוא. רק מחיר שלא הוזן באמת מערער אותו, ולכן רק הוא מוריד את ה-✅.
    if (o.unknownCost) {
      var why = o.unknownCost === 1 ? 'לפריט אחד שנקנה לא נרשם מחיר'
                                    : 'ל־' + o.unknownCost + ' פריטים שנקנו לא נרשם מחיר';
      return { tone: 'note', text: 'ℹ️ ' + base + ' · ' + why };
    }
    return { tone: 'ok', text: '✅ ' + base };
  }

  function monthlyBadge(state, nis) {
    var m = budgetStats(state).monthly;
    if (!m.planned) return { tone: 'muted', text: 'כדאי למלא סכומים מתוכננים להוצאות החודשיות' };
    if (m.over) {
      return { tone: 'warn', text: '⚠️ חריגה של ' + nis(m.actual - m.planned) + ' לחודש מהתכנון' };
    }
    return { tone: 'ok', text: '✅ ' + nis(m.actual) + ' בפועל מתוך ' + nis(m.planned) + ' מתוכנן לחודש' };
  }

  /* ================= שירותים ================= */

  function openServices(state) {
    return arr(state && state.services).filter(function (s) { return s.status !== 'done'; });
  }

  // הכרטיס אומר כמה שירותים פתוחים, וזהו. משפט מפורט על שמות, זמנים
  // והנחיות היה רעש: הפרטים ממילא נמצאים במסך השירותים עצמו.
  // מחזיר null כשאין שירות פתוח – ואז הכרטיס לא מוצג בכלל.
  function serviceAlert(state) {
    var open = openServices(state);
    if (!open.length) return null;
    return {
      icon: '🔌', tab: 'services', cta: 'לשירותים',
      title: open.length === 1
        ? 'שירות אחד עדיין לא הועבר'
        : open.length + ' שירותים עדיין לא הועברו'
    };
  }

  return {
    num: num, pct: pct,
    NO_AREA: NO_AREA, NO_SECTION: NO_SECTION, NO_PHASE: NO_PHASE,
    isGift: isGift, isBought: isBought, isCostUnknown: isCostUnknown, itemSpend: itemSpend,
    itemAreaKey: itemAreaKey, areaGroups: areaGroups, areaStats: areaStats, shopStats: shopStats,
    listStats: listStats,
    sectionById: sectionById, isRecurringRow: isRecurringRow, rowSectionKey: rowSectionKey,
    sectionStats: sectionStats, sectionGroups: sectionGroups, budgetStats: budgetStats,
    dataWarnings: dataWarnings, estCoverageText: estCoverageText,
    onceBadge: onceBadge, monthlyBadge: monthlyBadge,
    openServices: openServices, serviceAlert: serviceAlert
  };
})();
