/* ===== ניהול מעבר דירה · לוגיקת האפליקציה ===== */
(function () {
  'use strict';

  var LS_DATA = 'afula_move_v1';
  var LS_CFG = 'afula_move_fb_cfg';
  var LS_SPACE = 'afula_move_space';
  // המסך הפעיל והסינונים נשמרים בנפרד מהנתונים: הם מצב תצוגה של המכשיר
  // הזה בלבד ואין שום סיבה לסנכרן אותם בין מכשירים.
  var LS_UI = 'afula_move_ui';

  /* ---------- עזרים ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var uid = function () { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  var nis = function (n) {
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(Number(n) || 0);
  };
  var fmtDate = function (iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  };
  var todayISO = function () {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  var daysBetween = function (a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  };
  var toast = function (msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, 2400);
  };
  var safeLS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  // האם אפשר בכלל לשמור בדפדפן הזה? (גלישה פרטית / חסימת אחסון)
  safeLS.ok = (function () {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }
    catch (e) { return false; }
  })();

  // גרסה מתארחת (Artifact) – בלי סנכרון ענן, הכול נשמר במכשיר
  var ARTIFACT = !!window.ARTIFACT_MODE;

  /* ---------- ערכת נושא ---------- */
  // שלושה מצבים: 'auto' הולך אחרי הגדרת המערכת (וזו ברירת המחדל, כמו
  // שהאפליקציה התנהגה מאז ומתמיד), ו-'light'/'dark' גוברים עליה.
  // נשמר במכשיר ולא ב-state: זו העדפת תצוגה, ואין סיבה שבחירת כהה בטלפון
  // תכפה כהה גם על המחשב. הבחירה שורדת רענון, סגירה והתחברות מחדש.
  var LS_THEME = 'afula_move_theme';
  function themeMode() {
    var t = safeLS.get(LS_THEME);
    return (t === 'light' || t === 'dark') ? t : 'auto';
  }
  function applyTheme() {
    var m = themeMode();
    if (m === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', m);
  }
  function setTheme(m) {
    if (m === 'auto') safeLS.del(LS_THEME);
    else safeLS.set(LS_THEME, m);
    applyTheme();
  }
  // מוחל מיד, לפני בניית המסך, כדי שלא תהיה הבזקה של הערכה הלא נכונה
  applyTheme();

  /* ---------- מצב ---------- */
  function defaultState() {
    return {
      v: 1,
      // 0 = מצב התחלתי שמעולם לא נשמר. חשוב: כך עותק ריק במכשיר חדש
      // לעולם לא "מנצח" את העותק שבענן ולא דורס אותו.
      updatedAt: 0,
      settings: {
        moveDate: '',
        fromAddr: '',
        toAddr: '',
        movers: ''
      },
      tasks: SEED_TASKS.map(function (t) { return { id: uid(), phase: t[0], title: t[1], done: false, due: '' }; }),
      boxes: [],
      shopping: SEED_SHOPPING.map(function (s) {
        return { id: uid(), area: s[0], name: s[1], prio: s[2], est: 0, cost: 0, store: '', link: '', bought: false };
      }),
      docs: SEED_DOCS.map(function (d) {
        return { id: uid(), type: d[0], title: d[1], date: '', value: '', link: '', notes: '' };
      }),
      shopAreas: SHOP_AREAS.slice(),
      budgetSections: SEED_BUDGET_SECTIONS.map(function (s) {
        return { id: s.id, name: s.name, recurring: s.recurring };
      }),
      budget: SEED_BUDGET.map(function (c) {
        return { id: uid(), section: c[0], cat: c[1], planned: 0, actual: 0, paid: false, note: '' };
      }),
      services: SEED_SERVICES.map(function (s) {
        return { id: uid(), name: s.name, provider: s.provider, phone: s.phone, account: '', status: 'todo', notes: s.notes };
      }),
      contacts: SEED_CONTACTS.map(function (c) { return { id: uid(), name: c.name, role: c.role, phone: c.phone, notes: c.notes }; })
    };
  }

  var state = null;
  var view = 'dash';

  function loadLocal() {
    var raw = safeLS.get(LS_DATA);
    if (!raw) return defaultState();
    try {
      var s = JSON.parse(raw);
      var d = defaultState();
      // מיזוג בטוח למקרה של גרסה ישנה
      ['tasks', 'boxes', 'shopping', 'docs', 'budget', 'services', 'contacts'].forEach(function (k) {
        if (!Array.isArray(s[k])) s[k] = d[k];
      });
      s.settings = Object.assign({}, d.settings, s.settings || {});

      // --- שדרוג נתונים ישנים שנשמרו לפני שהיו קטגוריות ניתנות לעריכה ---
      // אזורי הקניות: משלימים מתוך הפריטים הקיימים כדי שלא ייעלם אזור בשימוש
      if (!Array.isArray(s.shopAreas) || !s.shopAreas.length) {
        var areas = d.shopAreas.slice();
        s.shopping.forEach(function (it) {
          if (it.area && areas.indexOf(it.area) < 0) areas.push(it.area);
        });
        s.shopAreas = areas;
      }
      // קטגוריות התקציב: שורות ישנות היו שטוחות – משייכים אותן לקטגוריה הראשונה
      if (!Array.isArray(s.budgetSections) || !s.budgetSections.length) {
        s.budgetSections = d.budgetSections;
      }
      var secIds = s.budgetSections.map(function (x) { return x.id; });
      s.budget.forEach(function (r) {
        if (!r.section || secIds.indexOf(r.section) < 0) r.section = secIds[0];
      });

      s.updatedAt = s.updatedAt || 0;
      return s;
    } catch (e) { return defaultState(); }
  }

  var saveTimer = null;
  function save(push) {
    state.updatedAt = Date.now();
    safeLS.set(LS_DATA, JSON.stringify(state));
    if (push !== false) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(cloudPush, 700);
    }
  }

  /* ---------- סנכרון ענן (Firebase Firestore) ---------- */
  var cloud = { ready: false, db: null, auth: null, ref: null, unsub: null, user: null, mod: {} };

  // הגדרות הפרויקט של האפליקציה. מפתח ה-API של Firebase לצד לקוח אינו סוד –
  // הוא מיועד להיות גלוי בקוד. ההגנה עצמה מגיעה מכללי האבטחה של Firestore
  // (כל משתמש ניגש רק למסמך שלו) ומרשימת הדומיינים המורשים.
  var FB_CONFIG = {
    apiKey: 'AIzaSyBRXtjFbFYrkWxNCan9UB17hUND8ax41SU',
    authDomain: 'afula-move.firebaseapp.com',
    projectId: 'afula-move',
    storageBucket: 'afula-move.firebasestorage.app',
    messagingSenderId: '691992999528',
    appId: '1:691992999528:web:4a9a92dc3d420190ebeddd'
  };

  function getCfg() {
    // אפשר לעקוף בהגדרות מקומיות, אחרת משתמשים בפרויקט המובנה
    try {
      var custom = JSON.parse(safeLS.get(LS_CFG) || 'null');
      if (custom && custom.apiKey && custom.projectId) return custom;
    } catch (e) {}
    return FB_CONFIG;
  }

  function setSyncBadge(txt, cls) {
    var b = $('#syncBadge');
    b.textContent = '● ' + txt;
    b.className = 'chip' + (cls ? ' ' + cls : '');
  }

  // חותמת הבנייה מוזרקת בזמן הבנייה כ-window.BUILD_STAMP, ומוצגת בתחתית
  // תפריט הצד. בגרסת הפיתוח (שלושה קבצים, בלי שלב בנייה) אין חותמת ואז
  // מוצג "גרסת פיתוח", כדי שלא תתבלבל עם מה שפורסם באתר.
  var BUILD_STAMP = window.BUILD_STAMP || '';

  async function initCloud() {
    if (ARTIFACT) { setSyncBadge('נשמר במכשיר'); return; }
    var cfg = getCfg();
    if (!cfg || !cfg.apiKey || !cfg.projectId) { setSyncBadge('מקומי'); return; }
    if (location.protocol === 'file:') { setSyncBadge('מקומי (file://)', 'err'); return; }
    setSyncBadge('מתחבר…');
    try {
      var V = 'https://www.gstatic.com/firebasejs/10.12.2/';
      var appMod = await import(V + 'firebase-app.js');
      var authMod = await import(V + 'firebase-auth.js');
      var fsMod = await import(V + 'firebase-firestore.js');
      cloud.mod = { app: appMod, auth: authMod, fs: fsMod };

      var app = appMod.initializeApp(cfg);
      var auth = authMod.getAuth(app);
      cloud.db = fsMod.getFirestore(app);

      cloud.auth = auth;

      // חוזרים מהתחברות שהתבצעה בהפניה (נפוץ בדפדפני מובייל)
      authMod.getRedirectResult(auth).catch(function () {});

      authMod.onAuthStateChanged(auth, function (user) {
        cloud.user = user;
        if (!user) {
          detachDoc();
          setSyncBadge('לא מחובר');
          return;
        }
        // כל חשבון Google מקבל מסמך משלו, לפי המזהה הייחודי שלו
        attachDoc(user.uid);
      });
    } catch (e) {
      console.error(e);
      setSyncBadge('אין חיבור', 'err');
    }
  }

  function signIn() {
    var authMod = cloud.mod.auth;
    if (!authMod || !cloud.auth) { toast('הסנכרון אינו זמין כרגע'); return; }
    setSyncBadge('מתחבר…');
    var provider = new authMod.GoogleAuthProvider();
    authMod.signInWithPopup(cloud.auth, provider).catch(function (e) {
      var code = (e && e.code) || '';
      // חלונות קופצים חסומים בחלק מדפדפני המובייל – עוברים להתחברות בהפניה
      if (/popup-blocked|popup-closed|cancelled-popup|operation-not-supported/.test(code)) {
        authMod.signInWithRedirect(cloud.auth, provider).catch(function (err) {
          console.error(err); setSyncBadge('ההתחברות נכשלה', 'err');
        });
        return;
      }
      console.error(e);
      setSyncBadge('ההתחברות נכשלה', 'err');
      toast(code === 'auth/unauthorized-domain'
        ? 'הדומיין הזה לא מאושר בפרויקט Firebase'
        : 'ההתחברות נכשלה');
    });
  }

  function signOutNow() {
    if (!cloud.mod.auth || !cloud.auth) return;
    cloud.mod.auth.signOut(cloud.auth).then(function () {
      toast('התנתקת. הנתונים נשארו שמורים במכשיר הזה.');
    });
  }

  function detachDoc() {
    if (cloud.unsub) { cloud.unsub(); cloud.unsub = null; }
    cloud.ready = false;
    cloud.ref = null;
  }

  function attachDoc(uid) {
    var fs = cloud.mod.fs;
    detachDoc();
    cloud.ref = fs.doc(cloud.db, 'moves', uid);
    cloud.ready = true;
    setSyncBadge('מסונכרן', 'on');

    cloud.unsub = fs.onSnapshot(cloud.ref, function (snap) {
      if (!snap.exists()) { cloudPush(); return; }
      if (snap.metadata.hasPendingWrites) return;
      var data = snap.data();
      if (!data || !data.payload) return;
      var remote;
      try { remote = JSON.parse(data.payload); } catch (e) { return; }
      // הענן מנצח רק אם הוא חדש יותר מהעותק המקומי.
      // במכשיר חדש state.updatedAt הוא 0, ולכן הנתונים מהענן תמיד נטענים.
      if (!remote.updatedAt || remote.updatedAt <= state.updatedAt) return;
      state = remote;
      safeLS.set(LS_DATA, JSON.stringify(state));
      render();
      toast('עודכן ממכשיר אחר');
    }, function (err) {
      console.error(err);
      setSyncBadge('שגיאת סנכרון', 'err');
    });
  }

  function cloudPush() {
    if (!cloud.ready || !cloud.ref) return;
    var fs = cloud.mod.fs;
    // מסמך חדש בענן צריך חותמת זמן אמיתית, גם אם עוד לא בוצע שינוי מקומי
    if (!state.updatedAt) state.updatedAt = Date.now();
    fs.setDoc(cloud.ref, { payload: JSON.stringify(state), updatedAt: state.updatedAt })
      .catch(function (e) { console.error(e); setSyncBadge('שמירה נכשלה', 'err'); });
  }

  /* ---------- חישובים ---------- */
  function taskStats() {
    var done = state.tasks.filter(function (t) { return t.done; }).length;
    return { done: done, total: state.tasks.length };
  }
  function boxStats() {
    var packed = state.boxes.filter(function (b) { return b.status !== 'todo'; }).length;
    return { packed: packed, total: state.boxes.length };
  }
  function serviceStats() {
    var done = state.services.filter(function (s) { return s.status === 'done'; }).length;
    return { done: done, total: state.services.length };
  }
  function shopStats() {
    var bought = 0, est = 0, cost = 0, mustLeft = 0;
    state.shopping.forEach(function (s) {
      if (s.bought) { bought++; cost += Number(s.cost) || 0; }
      else if (s.prio === 'must') mustLeft++;
      est += Number(s.est) || 0;
    });
    return { bought: bought, total: state.shopping.length, est: est, cost: cost, mustLeft: mustLeft };
  }
  // סיכום לקטגוריית קניות אחת – מקביל ל-sectionStats של התקציב
  function areaStats(area) {
    var est = 0, cost = 0, bought = 0, total = 0;
    state.shopping.forEach(function (s) {
      if (s.area !== area) return;
      total++;
      est += Number(s.est) || 0;
      cost += Number(s.cost) || 0;
      if (s.bought) bought++;
    });
    return { est: est, cost: cost, bought: bought, total: total };
  }
  function sectionById(id) {
    for (var i = 0; i < state.budgetSections.length; i++) {
      if (state.budgetSections[i].id === id) return state.budgetSections[i];
    }
    return null;
  }
  function isRecurring(row) {
    var s = sectionById(row.section);
    return !!(s && s.recurring);
  }
  // סכום שורה שוטפת: מה ששולם בפועל, ואם עוד לא שולם – ההערכה המתוכננת
  function rowMonthly(r) { return (Number(r.actual) || 0) || (Number(r.planned) || 0); }

  function budgetStats() {
    var p = 0, a = 0, paid = 0, recurring = 0, oneTime = 0;
    state.budget.forEach(function (r) {
      p += Number(r.planned) || 0;
      a += Number(r.actual) || 0;
      if (r.paid) paid += Number(r.actual) || 0;
      if (isRecurring(r)) recurring += rowMonthly(r);
      else oneTime += Number(r.actual) || 0;
    });
    return { planned: p, actual: a, paid: paid, recurring: recurring, oneTime: oneTime };
  }
  function sectionStats(secId) {
    var p = 0, a = 0, n = 0;
    state.budget.forEach(function (r) {
      if (r.section !== secId) return;
      n++; p += Number(r.planned) || 0; a += Number(r.actual) || 0;
    });
    return { planned: p, actual: a, count: n };
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }

  /* ---------- חיפוש כללי ---------- */
  // אותיות סופיות: בלי נרמול, חיפוש "מזגן" לא היה מוצא "מזגנים",
  // כי נו"ן סופית (ן) ונו"ן רגילה (נ) הן תווים שונים.
  var FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  function heNorm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[ךםןףץ]/g, function (c) { return FINALS[c]; });
  }
  function query() {
    var el = $('#globalSearch');
    return el ? el.value.trim().toLowerCase() : '';
  }
  // מחזיר true אם אין חיפוש פעיל, או אם אחד השדות מכיל את מילת החיפוש
  function hit() {
    var q = heNorm(query());
    if (!q) return true;
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (v != null && heNorm(v).indexOf(q) !== -1) return true;
    }
    return false;
  }
  /* ---------- מיון וסינון לכל מסך ---------- */
  // 'manual' הוא הסדר השמור, וזה גם המצב היחיד שבו גרירה אפשרית.
  var SORTS = {
    tasks:    [['manual','סדר ידני'],['az','לפי א-ת'],['due','לפי תאריך יעד'],['open','שלא בוצעו קודם']],
    shopping: [['manual','סדר ידני'],['az','לפי א-ת'],['prio','לפי עדיפות'],['estAsc','משוער: מהזול ליקר'],['estDesc','משוער: מהיקר לזול'],['costDesc','שולם: מהגבוה לנמוך']],
    boxes:    [['manual','סדר ידני'],['num','לפי מספר ארגז'],['room','לפי חדר יעד'],['status','לפי סטטוס']],
    budget:   [['manual','סדר ידני'],['az','לפי א-ת'],['plannedDesc','מתוכנן: מהגבוה לנמוך'],['actualDesc','בפועל: מהגבוה לנמוך'],['unpaid','שלא שולמו קודם']],
    services: [['manual','סדר ידני'],['az','לפי א-ת'],['status','לפי סטטוס'],['provider','לפי ספק']],
    docs:     [['manual','סדר ידני'],['az','לפי א-ת'],['type','לפי סוג'],['date','לפי תאריך']],
    contacts: [['manual','סדר ידני'],['az','לפי שם'],['role','לפי תפקיד']]
  };
  var sortBy = {};   // view -> sort key
  var filterBy = {}; // view -> {field: value}

  // רענון של הדף לא אמור לאבד את מקומו של המשתמש: המסך הפעיל, המיון
  // והסינונים נשמרים במכשיר ונטענים בחזרה באתחול.
  function saveUI() {
    safeLS.set(LS_UI, JSON.stringify({ view: view, sortBy: sortBy, filterBy: filterBy }));
  }
  function loadUI() {
    try {
      var u = JSON.parse(safeLS.get(LS_UI) || 'null');
      if (!u) return;
      if (u.view && VIEWS[u.view]) view = u.view;
      if (u.sortBy && typeof u.sortBy === 'object') sortBy = u.sortBy;
      if (u.filterBy && typeof u.filterBy === 'object') filterBy = u.filterBy;
    } catch (e) {}
  }
  // חזרה למצב ההתחלתי של מסך אחד: בלי מיון, בלי סינונים ובלי חיפוש פעיל
  function clearFilters(v) {
    delete sortBy[v];
    delete filterBy[v];
    var s = $('#globalSearch');
    if (s && s.value) s.value = '';
  }
  function hasFilters(v) {
    if (sortOf(v) !== 'manual') return true;
    var f = filterBy[v] || {};
    for (var k in f) if (f[k]) return true;
    return !!query();
  }

  function setFilter(v, field, val) {
    filterBy[v] = filterBy[v] || {};
    filterBy[v][field] = val;
  }
  function uniq(a) {
    var seen = {}, out = [];
    a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out.sort(function (p, q) { return String(p).localeCompare(String(q), 'he'); });
  }
  function sortOf(v) { return sortBy[v] || 'manual'; }
  function isManual(v) { return sortOf(v) === 'manual'; }
  function filt(v, key) { return (filterBy[v] || {})[key] || ''; }

  var cmpText = function (a, b) { return String(a || '').localeCompare(String(b || ''), 'he'); };
  var num = function (x) { return Number(x) || 0; };

  function sortList(v, list) {
    var s = sortOf(v);
    if (s === 'manual') return list;
    var out = list.slice();
    var by = {
      az: function (a, b) { return cmpText(a.title || a.name || a.cat || a.contents, b.title || b.name || b.cat || b.contents); },
      due: function (a, b) { return (a.due || '9999').localeCompare(b.due || '9999'); },
      open: function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); },
      prio: function (a, b) { var o = { must: 0, soon: 1, later: 2 }; return o[a.prio] - o[b.prio]; },
      estAsc: function (a, b) { return num(a.est) - num(b.est); },
      estDesc: function (a, b) { return num(b.est) - num(a.est); },
      costDesc: function (a, b) { return num(b.cost) - num(a.cost); },
      num: function (a, b) { return num(a.num) - num(b.num); },
      room: function (a, b) { return cmpText(a.to, b.to); },
      status: function (a, b) { return cmpText(a.status, b.status); },
      plannedDesc: function (a, b) { return num(b.planned) - num(a.planned); },
      actualDesc: function (a, b) { return num(b.actual) - num(a.actual); },
      unpaid: function (a, b) { return (a.paid ? 1 : 0) - (b.paid ? 1 : 0); },
      provider: function (a, b) { return cmpText(a.provider, b.provider); },
      type: function (a, b) { return cmpText(a.type, b.type); },
      date: function (a, b) { return (a.date || '9999').localeCompare(b.date || '9999'); },
      role: function (a, b) { return cmpText(a.role, b.role); }
    }[s];
    return by ? out.sort(by) : out;
  }

  // סרגל מיון/סינון אחיד. selects = [[id, label, currentValue, [[val,label]…]]…]
  function toolbar(v, selects) {
    var h = '<div class="card toolbar"><div class="row">' +
      '<label class="f">מיון<select data-sortfor="' + v + '">' +
      SORTS[v].map(function (o) {
        return '<option value="' + o[0] + '"' + (sortOf(v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></label>';
    (selects || []).forEach(function (s) {
      h += '<label class="f">' + esc(s[1]) + '<select data-filterfor="' + v + '" data-field="' + s[0] + '">' +
        s[3].map(function (o) {
          return '<option value="' + esc(o[0]) + '"' + (s[2] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></label>';
    });
    h += '<button type="button" class="btn sm clearfilt' + (hasFilters(v) ? ' on' : '') +
      '" data-act="clear-filters" data-view="' + v + '">נקה סינונים 🧹</button>';
    h += '</div>' +
      (isManual(v) ? '' : '<div class="small muted" style="margin-top:8px">במיון הזה לא ניתן לגרור. חוזרים ל"סדר ידני" כדי לשנות סדר.</div>') +
      '</div>';
    return h;
  }

  function taskDueOk(t) {
    var f = filt('tasks', 'due');
    if (!f) return true;
    if (f === 'has') return !!t.due;
    if (f === 'none') return !t.due;
    if (!t.due) return false;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var d = new Date(t.due + 'T00:00:00');
    if (f === 'late') return d < today && !t.done;
    if (f === 'week') return d >= today && (d - today) <= 7 * 86400000;
    return true;
  }
  function taskCalOk(t) {
    var f = filt('tasks', 'cal');
    if (!f) return true;
    return f === '1' ? !!t.calendarEventId : !t.calendarEventId;
  }

  function searchNote(shown, total, noun) {
    if (!query()) return '';
    return '<div class="search-note"><span>🔍 ' +
      (shown ? shown + ' מתוך ' + total : 'אין תוצאות מתוך ' + total) + ' ' + esc(noun) + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn sm" data-act="clear-search">ניקוי החיפוש</button></div>';
  }

  /* ---------- רכיבי HTML ---------- */
  // כרטיס נתון. אם הועבר tab – הכרטיס הופך לכפתור שמוביל למסך המתאים
  // totKey מסמן את שדה הסכום כדי שיתעדכן תוך כדי הקלדה, בלי לבנות מחדש את המסך
  function statCard(k, v, cur, tot, tab, totKey) {
    var inner = '<div class="k">' + esc(k) + '</div>' +
      '<div class="v"' + (totKey ? ' data-total="' + totKey + '"' : '') + '>' + v + '</div>' +
      (tot != null ? '<div class="bar"><i style="width:' + pct(cur, tot) + '%"></i></div>' : '');
    if (!tab) return '<div class="stat">' + inner + '</div>';
    return '<button type="button" class="stat stat-link" data-tab="' + tab + '">' + inner + '</button>';
  }

  // הודעה שניתן ללחוץ עליה כדי לקפוץ למסך הרלוונטי, כבר עם הסינון המתאים.
  // filters ממופה לשמות ה-data שמטופלים במאזין הלחיצה (prio, taskphase, boxstatus…)
  function alertCard(o) {
    var attrs = ' data-tab="' + o.tab + '"';
    Object.keys(o.filters || {}).forEach(function (k) {
      attrs += ' data-' + k + '="' + esc(o.filters[k]) + '"';
    });
    return '<button type="button" class="card alert-card ' + (o.tone || 'warn') + '"' + attrs + '>' +
      '<b>' + o.icon + ' ' + esc(o.title) + '</b>' +
      (o.sub ? '<div class="small">' + esc(o.sub) + '</div>' : '') +
      '<span class="alert-go">' + esc(o.cta || 'פתיחה') + ' ←</span></button>';
  }
  function opts(list, sel, valKey, labKey) {
    return list.map(function (o) {
      var v = valKey ? o[valKey] : o, l = labKey ? o[labKey] : o;
      return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }
  function bind(coll, id, field, extra) {
    return 'data-act="edit" data-coll="' + coll + '" data-id="' + id + '" data-field="' + field + '"' + (extra || '');
  }

  // כפתור קישור. שדה קישור מלא תופס שורה שלמה ומציג טקסט שאף אחד לא קורא,
  // ולכן הקישור מתחבא מאחורי כפתור אחד: לחיצה קצרה פותחת, לחיצה ארוכה עורכת.
  function linkBtn(collName, it) {
    var has = !!String(it.link || '').trim();
    return '<button type="button" class="btn sm linkbtn' + (has ? ' has' : '') + '"' +
      ' data-act="link" data-coll="' + collName + '" data-id="' + it.id + '"' +
      ' title="' + (has ? 'לחיצה קצרה פותחת · לחיצה ארוכה לעריכת הקישור' : 'לחיצה להוספת קישור') + '">' +
      (has ? '🔗 פתח קישור' : '🔗 הוספת קישור') + '</button>';
  }

  function editLink(collName, id) {
    var it = findItem(collName, id);
    if (!it) return;
    var v;
    // סביבות מתארחות (iframe בארגז חול, וגם חלק מדפדפני התצוגה) חוסמות
    // חלונות דו-שיח של הדפדפן, ואז prompt זורק שגיאה במקום להחזיר ערך.
    try {
      v = prompt('הדביקו כאן קישור (גוגל דרייב, גוגל תמונות, אתר החנות…)\nלמחיקת הקישור: מוחקים את השורה ומאשרים.',
        it.link || '');
    } catch (e) {
      toast('עריכת קישורים אינה זמינה בגרסה הזו');
      return;
    }
    if (v === null || v === undefined) return;
    v = v.trim();
    // הדבקה מהדפדפן לרוב כוללת את הפרוטוקול, אבל לא תמיד – משלימים אותו
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    it.link = v;
    save(); render();
    toast(v ? 'הקישור נשמר' : 'הקישור הוסר');
  }

  function openLink(collName, id) {
    var it = findItem(collName, id);
    var url = it && String(it.link || '').trim();
    if (!url) { editLink(collName, id); return; }
    window.open(url, '_blank', 'noopener');
  }

  /* ---------- מסכים ---------- */
  // כשמחפשים, מסך הסקירה הופך לתוצאות חיפוש מכל האפליקציה
  function viewGlobalSearch() {
    var groups = [
      { id: 'tasks', icon: '✅', label: 'משימות', items: state.tasks.filter(function (t) { return hit(t.title); })
          .map(function (t) { var p = PHASES.filter(function (x) { return x.id === t.phase; })[0];
            return { t: t.title, s: (p ? p.label : '') + (t.done ? ' · בוצע' : '') }; }) },
      { id: 'shopping', icon: '🛒', label: 'קניות', items: state.shopping.filter(function (x) { return hit(x.name, x.store, x.area); })
          .map(function (x) { return { t: x.name, s: x.area + (x.bought ? ' · נקנה' : '') }; }) },
      { id: 'boxes', icon: '📦', label: 'ארגזים', items: state.boxes.filter(function (x) { return hit(x.contents, x.num, x.from, x.to); })
          .map(function (x) { return { t: '#' + x.num + ' ' + (x.contents || ''), s: x.from + ' ← ' + x.to }; }) },
      { id: 'budget', icon: '💰', label: 'תקציב', items: state.budget.filter(function (x) { return hit(x.cat, x.note); })
          .map(function (x) { return { t: x.cat, s: nis(x.actual || x.planned) }; }) },
      { id: 'services', icon: '🔌', label: 'שירותים', items: state.services.filter(function (x) { return hit(x.name, x.provider, x.notes, x.account, x.phone); })
          .map(function (x) { return { t: x.name, s: x.provider || '' }; }) },
      { id: 'docs', icon: '📄', label: 'מסמכים', items: state.docs.filter(function (x) { return hit(x.title, x.value, x.notes, x.link); })
          .map(function (x) { return { t: x.title, s: x.value || '' }; }) },
      { id: 'contacts', icon: '📇', label: 'אנשי קשר', items: state.contacts.filter(function (x) { return hit(x.name, x.role, x.phone, x.notes); })
          .map(function (x) { return { t: x.name || x.role, s: x.phone || x.role || '' }; }) }
    ].filter(function (g) { return g.items.length; });

    var total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    var h = '<div class="card"><h2>תוצאות חיפוש <span class="sub">' + total + ' תוצאות עבור “' + esc(query()) + '”</span></h2>' +
      '<div class="row"><button class="btn sm" data-act="clear-search">ניקוי החיפוש</button></div></div>';

    if (!total) return h + '<div class="card"><div class="empty">לא נמצא כלום. אפשר לנסות מילה אחרת.</div></div>';

    groups.forEach(function (g) {
      h += '<div class="card"><h2>' + g.icon + ' ' + esc(g.label) +
        ' <span class="sub">' + g.items.length + '</span></h2>' +
        g.items.slice(0, 12).map(function (it) {
          return '<div class="task"><div class="t"><div style="font-weight:500">' + esc(it.t) + '</div>' +
            (it.s ? '<div class="small muted">' + esc(it.s) + '</div>' : '') + '</div></div>';
        }).join('') +
        (g.items.length > 12 ? '<div class="small muted" style="margin-top:6px">ועוד ' + (g.items.length - 12) + '…</div>' : '') +
        '<div class="row" style="margin-top:10px"><button class="btn sm" data-tab="' + g.id + '">מעבר ל' + esc(g.label) + '</button></div></div>';
    });
    return h;
  }

  function viewDash() {
    if (query()) return viewGlobalSearch();
    var s = state.settings;
    var t = taskStats(), b = boxStats(), sv = serviceStats(), bg = budgetStats(), sh = shopStats();
    var h = '';

    var cd = '';
    if (s.moveDate) {
      var d = daysBetween(todayISO(), s.moveDate);
      cd = d > 0 ? '<div class="cd"><b>' + d + '</b><span>ימים למעבר</span></div>'
        : d === 0 ? '<div class="cd"><b>היום!</b><span>יום המעבר</span></div>'
          : '<div class="cd"><b>' + Math.abs(d) + '</b><span>ימים מאז המעבר</span></div>';
      cd += '<p>' + esc(fmtDate(s.moveDate)) + '</p>';
    } else {
      cd = '<div class="cd"><b>?</b><span>עוד לא נקבע תאריך</span></div>' +
        '<p>אפשר לקבוע תאריך מעבר בהגדרות ⚙️</p>';
    }

    h += '<div class="card hero">' + cd +
      '<div class="hero-addr">📍 ' + esc(s.toAddr || 'עוד לא הוגדרה כתובת') +
      (s.fromAddr ? '<br>↩️ מ־' + esc(s.fromAddr) : '') + '</div></div>';

    h += '<div class="grid g4">' +
      statCard('משימות', t.done + '/' + t.total, t.done, t.total, 'tasks') +
      statCard('קניות לדירה', sh.bought + '/' + sh.total, sh.bought, sh.total, 'shopping') +
      statCard('שירותים הועברו', sv.done + '/' + sv.total, sv.done, sv.total, 'services') +
      statCard('ארגזים ארוזים', b.packed + '/' + b.total, b.packed, b.total, 'boxes') +
      '</div>';

    // --- הודעות שדורשות פעולה. כל אחת פותחת את המסך הנכון עם הסינון הנכון ---
    if (sh.mustLeft) {
      h += alertCard({
        icon: '🛒', tab: 'shopping', cta: 'לרשימה',
        title: sh.mustLeft + ' פריטים שחייבים כבר ליום הראשון עדיין לא נקנו',
        sub: 'פתיחת רשימת הקניות מסוננת לפריטים של היום הראשון שטרם נקנו.',
        filters: { prio: 'must', shophide: '1' }
      });
    }

    var lateTasks = state.tasks.filter(function (x) { return !x.done && x.due && x.due < todayISO(); }).length;
    if (lateTasks) {
      h += alertCard({
        icon: '⏰', tab: 'tasks', tone: 'danger', cta: 'למשימות',
        title: lateTasks + ' משימות עברו את תאריך היעד',
        sub: 'פתיחת רשימת המשימות עם כל מה שעדיין לא בוצע.',
        filters: { taskstate: 'open', taskphase: '' }
      });
    }

    if (sv.total - sv.done && s.moveDate && daysBetween(todayISO(), s.moveDate) <= 14) {
      h += alertCard({
        icon: '🔌', tab: 'services', cta: 'לשירותים',
        title: (sv.total - sv.done) + ' שירותים עדיין לא הועברו',
        sub: 'נשארו פחות משבועיים למעבר – חשמל, מים, ארנונה ואינטרנט דורשים תיאום מראש.'
      });
    }

    // המשימות הקרובות
    var next = state.tasks.filter(function (x) { return !x.done; });
    var order = PHASES.map(function (p) { return p.id; });
    next.sort(function (a, c) {
      if (a.due && c.due) return a.due < c.due ? -1 : 1;
      if (a.due) return -1;
      if (c.due) return 1;
      return order.indexOf(a.phase) - order.indexOf(c.phase);
    });
    h += '<div class="card"><h2>המשימות הקרובות <span class="sub">' + next.length + ' פתוחות</span></h2>';
    if (!next.length) h += '<div class="empty">הכול סומן כבוצע 🎉</div>';
    else h += next.slice(0, 6).map(function (x) {
      var ph = PHASES.filter(function (p) { return p.id === x.phase; })[0];
      return '<div class="task"><input type="checkbox" data-act="toggle" data-coll="tasks" data-id="' + x.id + '" data-field="done">' +
        '<div class="t"><div style="font-weight:500">' + esc(x.title) + '</div>' +
        '<div class="small muted">' + esc(ph ? ph.label : '') + (x.due ? ' · ' + esc(fmtDate(x.due)) : '') + '</div></div></div>';
    }).join('');
    h += '</div>';

    h += '<div class="card"><h2>כסף במבט מהיר</h2><div class="grid g2">' +
      statCard('תקציב מתוכנן', nis(bg.planned), null, null, 'budget') +
      statCard('הוצאות המעבר', nis(bg.oneTime), null, null, 'budget') +
      statCard('קניות לדירה', nis(sh.cost), null, null, 'shopping') +
      statCard('הוצאות שוטפות', nis(bg.recurring), null, null, 'budget') +
      statCard('סה"כ יצא עד עכשיו', nis(bg.oneTime + sh.cost), null, null, 'budget') +
      '</div><div class="small muted" style="margin-top:8px">"קניות לדירה" מגיע מלשונית הקניות ולא נספר פעמיים. "הוצאות שוטפות" הוא הסכום החודשי מהקטגוריות המסומנות כחוזרות בתקציב, והוא אינו חלק מעלות המעבר החד-פעמית.</div></div>';

    return h;
  }

  function viewTasks() {
    var h = '<div class="card"><h2>הוספת משימה</h2><div class="row">' +
      '<input id="ntTitle" placeholder="מה צריך לעשות?" style="flex:2 1 200px">' +
      '<select id="ntPhase" style="flex:1 1 130px">' + opts(PHASES, 'p30', 'id', 'label') + '</select>' +
      '<button class="btn primary" data-act="add-task">הוסף</button></div></div>';

    // --- סנכרון ללוח שנה ---
    // שורה אחת דקה. הכותרת והמשפטים ירדו – שני הכפתורים מסבירים את עצמם,
    // ושאר המידע נדחס לשורת מטא זעירה לצידם.
    if (!ARTIFACT) {
      var syncable = state.tasks.filter(gcalEligible).length;
      var last = state.settings.calendarSyncedAt;
      // מחרוזת מטא אחת וקצרה, כדי שהכול יישאר בשורה אחת גם בנייד:
      // לפני הסנכרון הראשון – כמה משימות ייכנסו; אחריו – מתי היה.
      var calMeta = last && !gcalBusy
        ? 'עודכן ' + new Intl.DateTimeFormat('he-IL', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
          }).format(new Date(last))
        : syncable + ' עם תאריך';
      h += '<div class="card calbar">' +
        '<button class="btn sm primary" data-act="gcal-sync"' + (gcalBusy ? ' disabled' : '') + '>' +
        (gcalBusy ? '⏳ מסנכרן…' : '🗓️ ללוח שנה') + '</button>' +
        '<button class="btn sm" data-act="gcal-pull"' + (gcalBusy ? ' disabled' : '') + '>' +
        '📥 מלוח שנה</button>' +
        '<span class="cal-meta">' + esc(calMeta) + '</span>' +
        (gcalMsg ? '<span class="cal-msg">' + esc(gcalMsg) + '</span>' : '') +
        '</div>';
    }

    // כל המיון והסינון יושבים בסרגל אחד, כמו במסך הקניות
    h += toolbar('tasks', [
      ['phase', 'שלב', filt('tasks', 'phase'),
        [['', 'כל השלבים']].concat(PHASES.map(function (p) { return [p.id, p.label]; }))],
      ['state', 'מצב', filt('tasks', 'state'),
        [['', 'הכול'], ['open', 'רק שלא בוצעו'], ['done', 'רק שבוצעו']]],
      ['due', 'תאריך יעד', filt('tasks', 'due'),
        [['', 'הכל'], ['has', 'עם תאריך'], ['none', 'ללא תאריך'], ['late', 'באיחור'], ['week', 'בשבוע הקרוב']]],
      ['cal', 'לוח שנה', filt('tasks', 'cal'), [['', 'הכל'], ['1', 'מסונכרנות ללוח'], ['0', 'לא בלוח']]]
    ]);

    var phFilt = filt('tasks', 'phase'), stFilt = filt('tasks', 'state');
    var phases = PHASES.filter(function (p) { return !phFilt || p.id === phFilt; });
    var shown = 0, total = state.tasks.length;

    phases.forEach(function (p) {
      var all = state.tasks.filter(function (t) { return t.phase === p.id; });
      var list = all.filter(function (t) {
        if (stFilt === 'open' && t.done) return false;
        if (stFilt === 'done' && !t.done) return false;
        if (!taskDueOk(t)) return false;
        if (!taskCalOk(t)) return false;
        return hit(t.title);
      });
      shown += list.length;
      // בסינון פעיל אין טעם להציג שלבים ריקים
      if (!list.length && (query() || stFilt || filt('tasks', 'due') || filt('tasks', 'cal'))) return;
      var done = all.filter(function (t) { return t.done; }).length;
      h += '<div class="card phase"><div class="phase-head"><h3>' + esc(p.label) + '</h3>' +
        '<span class="cnt">' + done + '/' + all.length + ' · ' + esc(p.hint) + '</span>' +
        '<span class="spacer"></span></div>' +
        '<div class="bar" style="margin-bottom:8px"><i style="width:' + pct(done, all.length) + '%"></i></div>';
      if (!list.length) h += '<div class="empty">אין משימות בשלב הזה</div>';
      list = sortList('tasks', list);
      var tManual = isManual('tasks');
      h += '<div data-drag-group data-drag-coll="tasks">';

      // המספור משקף את מה שמוצג בפועל, כך שהדירוג נשאר קריא גם כשמסננים.
      list.forEach(function (t, i) {
        var late = !t.done && t.due && t.due < todayISO();
        h += '<div class="task' + (t.done ? ' done' : '') + '" data-drag-item data-id="' + t.id + '">' +
          rank(i, tManual) +
          '<input type="checkbox"' + (t.done ? ' checked' : '') + ' data-act="toggle" data-coll="tasks" data-id="' + t.id + '" data-field="done">' +
          '<div class="t"><input class="title" value="' + esc(t.title) + '" ' + bind('tasks', t.id, 'title') + '>' +
          '<div class="meta">' +
          // העברת המשימה לשלב אחר – אייקון שפותח רשימה נפתחת עם כל השלבים
          '<span class="phase-pick" title="העברה לשלב אחר"><i aria-hidden="true">⇄</i>' +
          '<select class="phase-sel" aria-label="העברת המשימה לשלב אחר" ' +
          bind('tasks', t.id, 'phase') + '>' + opts(PHASES, t.phase, 'id', 'label') + '</select></span>' +
          '<span class="small muted">יעד:</span>' +
          '<input type="date" value="' + esc(t.due || '') + '" ' + bind('tasks', t.id, 'due') + '>' +
          (late ? '<span class="late">באיחור</span>' : '') + '</div></div>' +
          '<button class="x" data-act="del" data-coll="tasks" data-id="' + t.id + '" title="מחיקה">✕</button></div>';
      });
      h += '</div></div>';
    });

    if (!shown) h += '<div class="card"><div class="empty">לא נמצאו משימות מתאימות</div></div>';
    return searchNote(shown, total, 'משימות') + h;
  }

  function viewBoxes() {
    var b = boxStats();
    var h = '<div class="card"><h2>ארגז חדש</h2><div class="row">' +
      '<input id="nbContents" placeholder="מה בפנים? (למשל: סירים וכלי הגשה)" style="flex:2 1 200px">' +
      '<select id="nbFrom" style="flex:1 1 120px">' + opts(ROOMS, 'מטבח') + '</select>' +
      '<select id="nbTo" style="flex:1 1 120px">' + opts(ROOMS, 'מטבח') + '</select>' +
      '<button class="btn primary" data-act="add-box">הוסף ארגז</button></div>' +
      '<div class="small muted" style="margin-top:6px">חדר מקור ← חדר יעד בדירה החדשה</div></div>';

    h += toolbar('boxes', [
      ['status', 'סטטוס', filt('boxes', 'status'),
        [['', 'כל הסטטוסים']].concat(BOX_STATUS.map(function (s) { return [s.id, s.label]; }))],
      ['to', 'חדר יעד', filt('boxes', 'to'),
        [['', 'כל החדרים']].concat(ROOMS.map(function (r) { return [r, r]; }))],
      ['fragile', 'שביר', filt('boxes', 'fragile'), [['', 'הכל'], ['1', 'שבירים בלבד']]]
    ]);

    h += '<div class="card"><h2>ארגזים <span class="sub">' + b.packed + '/' + b.total + ' ארוזים</span></h2>' +
      '<div class="row" style="margin-bottom:10px">' +
      '<button class="btn sm" data-act="print-labels">🖨️ תוויות</button></div>';

    var list = state.boxes.filter(function (x) {
      if (filt('boxes', 'status') && x.status !== filt('boxes', 'status')) return false;
      if (filt('boxes', 'to') && x.to !== filt('boxes', 'to')) return false;
      if (filt('boxes', 'fragile') && !x.fragile) return false;
      return hit(x.contents, x.num, x.from, x.to);
    });
    list = sortList('boxes', list);
    var bManual = isManual('boxes');

    if (!state.boxes.length) h += '<div class="empty">עדיין אין ארגזים. מוסיפים ארגז ומדביקים עליו את המספר.</div>';
    else if (!list.length) h += '<div class="empty">לא נמצאו ארגזים מתאימים</div>';
    else h += '<div class="grid" data-drag-group data-drag-coll="boxes">' + list.map(function (x, i) {
      var st = BOX_STATUS.filter(function (s) { return s.id === x.status; })[0];
      return '<div class="box" data-drag-item data-id="' + x.id + '">' + rank(i, bManual) +
        '<div class="num">' + x.num + '</div><div class="body">' +
        '<input value="' + esc(x.contents) + '" placeholder="תוכן הארגז" ' + bind('boxes', x.id, 'contents') + '>' +
        '<div class="line">' +
        '<select ' + bind('boxes', x.id, 'from') + ' style="flex:1">' + opts(ROOMS, x.from) + '</select>' +
        '<span class="muted">←</span>' +
        '<select ' + bind('boxes', x.id, 'to') + ' style="flex:1">' + opts(ROOMS, x.to) + '</select>' +
        '</div><div class="line">' +
        '<select ' + bind('boxes', x.id, 'status') + ' style="flex:1">' + opts(BOX_STATUS, x.status, 'id', 'label') + '</select>' +
        '<label class="row small" style="gap:5px;flex:none"><input type="checkbox"' + (x.fragile ? ' checked' : '') +
        ' data-act="toggle" data-coll="boxes" data-id="' + x.id + '" data-field="fragile"> שביר</label>' +
        '<button class="x" data-act="del" data-coll="boxes" data-id="' + x.id + '">✕</button></div>' +
        '<div class="tagline"><span class="tag' + (x.status === 'opened' ? ' ok' : x.status === 'todo' ? '' : ' warn') + '">' +
        esc(st ? st.label : '') + '</span>' + (x.fragile ? '<span class="tag fragile">⚠️ שביר</span>' : '') + '</div>' +
        '</div></div>';
    }).join('') + '</div>';
    h += '</div>';
    return searchNote(list.length, b.total, 'ארגזים') + h;
  }

  function viewShopping() {
    var sh = shopStats();
    var h = '<div class="card"><h2>קניות לדירה <span class="sub">' + sh.bought + '/' + sh.total + ' נקנו</span></h2>' +
      '<div class="bar"><i style="width:' + pct(sh.bought, sh.total) + '%"></i></div>' +
      '<div class="grid g2" style="margin-top:10px">' +
      '<div class="stat"><div class="k">סה"כ משוער</div><div class="v" data-total="sh:est">' + nis(sh.est) + '</div></div>' +
      '<div class="stat"><div class="k">שולם בפועל</div><div class="v" data-total="sh:cost">' + nis(sh.cost) + '</div></div>' +
      '</div></div>';

    h += '<div class="card"><h2>פריט חדש</h2><div class="row">' +
      '<input id="nsName" placeholder="מה צריך לקנות?" style="flex:2 1 180px">' +
      '<select id="nsArea" style="flex:1 1 120px">' + opts(state.shopAreas, state.shopAreas[0]) + '</select>' +
      '<select id="nsPrio" style="flex:1 1 120px">' + opts(SHOP_PRIO, 'soon', 'id', 'label') + '</select>' +
      '<button class="btn primary" data-act="add-shop">הוסף</button></div></div>';

    h += toolbar('shopping', [
      ['prio', 'עדיפות', filt('shopping', 'prio'),
        [['', 'כל העדיפויות']].concat(SHOP_PRIO.map(function (x) { return [x.id, x.label]; }))],
      ['area', 'קטגוריה', filt('shopping', 'area'),
        [['', 'כל הקטגוריות']].concat(state.shopAreas.map(function (a) { return [a, a]; }))],
      ['bought', 'מצב', filt('shopping', 'bought'),
        [['', 'הכל'], ['0', 'שטרם נקנו'], ['1', 'שכבר נקנו']]],
      ['store', 'חנות', filt('shopping', 'store'),
        [['', 'כל החנויות']].concat(uniq(state.shopping.map(function (s) { return (s.store || '').trim(); }))
          .map(function (v) { return [v, v]; }))]
    ]);

    var shopShown = 0;
    state.shopAreas.forEach(function (area) {
      var all = state.shopping.filter(function (s) { return s.area === area; });
      if (!all.length) return;
      if (filt('shopping', 'area') && area !== filt('shopping', 'area')) return;
      var list = all.filter(function (s) {
        if (filt('shopping', 'prio') && s.prio !== filt('shopping', 'prio')) return false;
        var bf = filt('shopping', 'bought');
        if (bf === '1' && !s.bought) return false;
        if (bf === '0' && s.bought) return false;
        if (filt('shopping', 'store') && (s.store || '').trim() !== filt('shopping', 'store')) return false;
        return hit(s.name, s.store, s.area);
      });
      list = sortList('shopping', list);
      var sManual = isManual('shopping');
      shopShown += list.length;
      if (!list.length && query()) return;
      var ast = areaStats(area);
      var got = ast.bought;
      h += '<div class="card phase"><div class="phase-head"><h3>' + esc(area) + '</h3>' +
        '<span class="cnt">' + got + '/' + all.length + '</span><span class="spacer"></span></div>' +
        '<div class="bar" style="margin-bottom:8px"><i style="width:' + pct(got, all.length) + '%"></i></div>';
      if (!list.length) h += '<div class="empty">אין פריטים מתאימים לסינון</div>';
      h += '<div data-drag-group data-drag-coll="shopping">';
      list.forEach(function (s, i) {
        h += '<div class="task' + (s.bought ? ' done' : '') + '" data-drag-item data-id="' + s.id + '">' +
          rank(i, sManual) +
          '<input type="checkbox"' + (s.bought ? ' checked' : '') + ' data-act="toggle" data-coll="shopping" data-id="' + s.id + '" data-field="bought">' +
          '<div class="t"><input class="title" value="' + esc(s.name) + '" ' + bind('shopping', s.id, 'name') + '>' +
          '<div class="shopmeta">' +
          '<select ' + bind('shopping', s.id, 'prio') + ' class="mini' + (s.prio === 'must' && !s.bought ? ' urgent' : '') + '">' +
          opts(SHOP_PRIO, s.prio, 'id', 'label') + '</select>' +
          '<input type="number" inputmode="numeric" min="0" class="mini" placeholder="משוער ₪" value="' + (s.est || '') + '" ' + bind('shopping', s.id, 'est') + '>' +
          '<input type="number" inputmode="numeric" min="0" class="mini" placeholder="שולם ₪" value="' + (s.cost || '') + '" ' + bind('shopping', s.id, 'cost') + '>' +
          '<input class="mini" placeholder="חנות" value="' + esc(s.store || '') + '" ' + bind('shopping', s.id, 'store') + '>' +
          '<select class="mini" title="העברה לקטגוריה אחרת" ' + bind('shopping', s.id, 'area') + '>' +
          opts(state.shopAreas, s.area) + '</select>' +
          linkBtn('shopping', s) +
          '</div></div>' +
          '<button class="x" data-act="del" data-coll="shopping" data-id="' + s.id + '" title="מחיקה">✕</button></div>';
      });
      // אותה שורת סיכום כמו בתקציב: כמה תוכנן לקטגוריה וכמה יצא בפועל
      h += '</div><div class="sectotal"><span>סה"כ</span><span class="spacer"></span>' +
        '<span class="small muted">משוער</span><b data-total="ssec:est:' + esc(area) + '">' + nis(ast.est) + '</b>' +
        '<span class="small muted">בפועל</span><b data-total="ssec:cost:' + esc(area) + '">' + nis(ast.cost) + '</b>' +
        '</div></div>';
    });
    if (!shopShown) h += '<div class="card"><div class="empty">לא נמצאו פריטים מתאימים</div></div>';

    // --- ניהול קטגוריות הקניות ---
    h += '<div class="card"><h2>קטגוריות</h2><div class="row">' +
      '<input id="nsaName" placeholder="שם קטגוריה חדשה, למשל: מרפסת" style="flex:2 1 180px">' +
      '<button class="btn primary" data-act="add-shop-area">הוספה</button></div>' +
      '<div class="seclist">' + state.shopAreas.map(function (a) {
        var n = state.shopping.filter(function (s) { return s.area === a; }).length;
        return '<div class="secrow"><b>' + esc(a) + '</b><span class="spacer"></span>' +
          '<span class="tag">' + n + ' פריטים</span>' +
          '<button class="x" data-act="del-shop-area" data-name="' + esc(a) + '" title="מחיקה">✕</button></div>';
      }).join('') + '</div></div>';

    return searchNote(shopShown, sh.total, 'פריטים') + h;
  }

  function viewDocs() {
    var h = '<div class="card"><h2>מסמכים וצילומים</h2>' +
      '<div class="small muted">מצלמים בטלפון → התמונה נשמרת בגוגל דרייב או בגוגל תמונות → ' +
      'לחיצה ארוכה על כפתור הקישור מדביקה אותו כאן, ולחיצה קצרה פותחת אותו. ' +
      'כך כל המספרים והצילומים החשובים במקום אחד, בכל המכשירים.</div></div>';

    h += toolbar('docs', [
      ['type', 'סוג', filt('docs', 'type'),
        [['', 'כל הסוגים']].concat(DOC_TYPES.map(function (x) { return [x.id, x.label]; }))],
      ['link', 'קישור', filt('docs', 'link'), [['', 'הכל'], ['1', 'עם קישור'], ['0', 'ללא קישור']]]
    ]);

    var docList = state.docs.filter(function (d) {
      if (filt('docs', 'type') && d.type !== filt('docs', 'type')) return false;
      var lf = filt('docs', 'link');
      if (lf === '1' && !d.link) return false;
      if (lf === '0' && d.link) return false;
      return hit(d.title, d.value, d.notes, d.link);
    });
    docList = sortList('docs', docList);
    var dcManual = isManual('docs');
    h += '<div data-drag-group data-drag-coll="docs">';
    docList.forEach(function (d, i) {
      var tp = DOC_TYPES.filter(function (x) { return x.id === d.type; })[0];
      h += '<div class="card" data-drag-item data-id="' + d.id + '">' + rank(i, dcManual) + '<h2>' + esc(d.title || 'ללא שם') +
        '<span class="tag">' + esc(tp ? tp.label : '') + '</span></h2>' +
        '<div class="row">' +
        '<label class="f">כותרת<input value="' + esc(d.title || '') + '" ' + bind('docs', d.id, 'title') + '></label>' +
        '<label class="f">סוג<select ' + bind('docs', d.id, 'type') + '>' + opts(DOC_TYPES, d.type, 'id', 'label') + '</select></label>' +
        '<label class="f">תאריך<input type="date" value="' + esc(d.date || '') + '" ' + bind('docs', d.id, 'date') + '></label>' +
        '<label class="f">' + (d.type === 'meter' ? 'קריאת המונה' : 'מספר / סכום') +
        '<input value="' + esc(d.value || '') + '" ' + bind('docs', d.id, 'value') + '></label>' +
        '</div>' +
        '<label class="f" style="margin-top:8px">הערות<textarea ' + bind('docs', d.id, 'notes') + '>' + esc(d.notes || '') + '</textarea></label>' +
        '<div class="row" style="margin-top:8px">' +
        linkBtn('docs', d) +
        '<span class="spacer"></span>' +
        '<button class="x" data-act="del" data-coll="docs" data-id="' + d.id + '">✕ מחיקה</button></div></div>';
    });
    h += '</div>';
    if (!docList.length) h += '<div class="card"><div class="empty">לא נמצאו רשומות מתאימות</div></div>';
    h += '<div class="card"><button class="btn" data-act="add-doc">➕ רשומה חדשה</button></div>';
    return searchNote(docList.length, state.docs.length, 'רשומות') + h;
  }

  function viewBudget() {
    var bg = budgetStats();
    var h = '<div class="card"><h2>סיכום</h2><div class="grid g4">' +
      statCard('מתוכנן', nis(bg.planned), null, null, null, 'bg:planned') +
      statCard('בפועל', nis(bg.actual), null, null, null, 'bg:actual') +
      statCard('הוצאות המעבר', nis(bg.oneTime), null, null, null, 'bg:oneTime') +
      statCard('שוטף לחודש', nis(bg.recurring), null, null, null, 'bg:recurring') +
      '</div><div class="small muted" style="margin-top:8px">' +
      (bg.planned && bg.actual > bg.planned ? '⚠️ חריגה של ' + nis(bg.actual - bg.planned) + ' מהתכנון' :
        bg.planned ? '✅ בתוך התקציב (' + nis(bg.planned - bg.actual) + ' פנוי)' : 'כדאי למלא סכומים מתוכננים') +
      '</div></div>';

    h += toolbar('budget', [
      ['paid', 'תשלום', filt('budget', 'paid'), [['', 'הכל'], ['0', 'שטרם שולמו'], ['1', 'ששולמו']]],
      ['over', 'חריגה', filt('budget', 'over'), [['', 'הכל'], ['1', 'בחריגה מהמתוכנן']]]
    ]);

    var bRows = state.budget.filter(function (r) {
      var pf = filt('budget', 'paid');
      if (pf === '1' && !r.paid) return false;
      if (pf === '0' && r.paid) return false;
      if (filt('budget', 'over') && !(num(r.actual) > num(r.planned))) return false;
      return hit(r.cat, r.note);
    });
    var secOpts = state.budgetSections.map(function (s) { return { id: s.id, label: s.name }; });
    var buManual = isManual('budget');

    state.budgetSections.forEach(function (sec) {
      var rows = sortList('budget', bRows.filter(function (r) { return r.section === sec.id; }));
      if (!rows.length && (query() || filt('budget', 'paid') || filt('budget', 'over'))) return;
      var st = sectionStats(sec.id);

      h += '<div class="card"><h2>' + esc(sec.name) +
        (sec.recurring ? '<span class="tag warn">חוזר כל חודש</span>' : '') +
        '<span class="sub">' + nis(st.actual) + ' מתוך ' + nis(st.planned) + ' מתוכנן</span></h2>' +
        '';

      if (!rows.length) h += '<div class="empty">אין סעיפים בקטגוריה הזו</div>';
      h += '<div data-drag-group data-drag-coll="budget">';
      // אותו פריסת כרטיס כמו במשימות ובקניות: שם הסעיף גדול ובולט,
      // והשדות הקטנים מתחתיו נשברים לשורות במסך צר במקום להיחתך
      rows.forEach(function (r, i) {
        h += '<div class="task' + (r.paid ? ' done' : '') + '" data-drag-item data-id="' + r.id + '">' +
          rank(i, buManual) +
          '<input type="checkbox"' + (r.paid ? ' checked' : '') +
          ' title="שולם" data-act="toggle" data-coll="budget" data-id="' + r.id + '" data-field="paid">' +
          '<div class="t"><input class="title" value="' + esc(r.cat) + '" placeholder="שם הסעיף" ' +
          bind('budget', r.id, 'cat') + '>' +
          '<div class="shopmeta">' +
          '<input type="number" inputmode="numeric" min="0" class="mini" placeholder="מתוכנן ₪" value="' +
          (r.planned || '') + '" ' + bind('budget', r.id, 'planned') + '>' +
          '<input type="number" inputmode="numeric" min="0" class="mini" placeholder="בפועל ₪" value="' +
          (r.actual || '') + '" ' + bind('budget', r.id, 'actual') + '>' +
          '<select class="mini" title="קטגוריה" ' + bind('budget', r.id, 'section') + '>' +
          opts(secOpts, r.section, 'id', 'label') + '</select>' +
          '<input class="mini" placeholder="ספק / פרטים" value="' + esc(r.note || '') + '" ' +
          bind('budget', r.id, 'note') + '>' +
          '</div></div>' +
          '<button class="x" data-act="del" data-coll="budget" data-id="' + r.id + '" title="מחיקה">✕</button></div>';
      });

      h += '</div><div class="sectotal"><span>סה"כ</span><span class="spacer"></span>' +
        '<span class="small muted">מתוכנן</span><b data-total="bsec:planned:' + esc(sec.id) + '">' + nis(st.planned) + '</b>' +
        '<span class="small muted">בפועל</span><b data-total="bsec:actual:' + esc(sec.id) + '">' + nis(st.actual) + '</b></div>' +
        '<div class="row" style="margin-top:10px">' +
        '<button class="btn" data-act="add-budget" data-section="' + sec.id + '">➕ סעיף חדש</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm danger" data-act="del-budget-section" data-id="' + sec.id + '">מחיקת הקטגוריה</button>' +
        '</div></div>';
    });

    // --- ניהול קטגוריות ---
    h += '<div class="card"><h2>קטגוריות התקציב</h2>' +
      '<div class="row">' +
      '<input id="nbsName" placeholder="שם קטגוריה חדשה, למשל: שיפוץ" style="flex:2 1 180px">' +
      '<label class="row small" style="gap:6px;flex:none"><input type="checkbox" id="nbsRecurring"> הוצאה חוזרת (חודשית)</label>' +
      '<button class="btn primary" data-act="add-budget-section">הוספה</button></div>' +
      '<div class="small muted" style="margin-top:8px">קטגוריות מסומנות כ"חוזרות" נספרות בנפרד בסקירה, ' +
      'תחת «הוצאות שוטפות», ולא מתערבבות בעלות החד-פעמית של המעבר.</div>' +
      '<div class="seclist">' + state.budgetSections.map(function (s) {
        var n = sectionStats(s.id).count;
        return '<div class="secrow"><b>' + esc(s.name) + '</b>' +
          '<label class="row small" style="gap:5px;flex:none"><input type="checkbox"' + (s.recurring ? ' checked' : '') +
          ' data-act="toggle-section-recurring" data-id="' + s.id + '"> חוזרת</label>' +
          '<span class="tag">' + n + ' סעיפים</span>' +
          '<button class="x" data-act="del-budget-section" data-id="' + s.id + '" title="מחיקה">✕</button></div>';
      }).join('') + '</div></div>';

    return searchNote(bRows.length, state.budget.length, 'סעיפים') + h;
  }

  function viewServices() {
    var sv = serviceStats();
    var h = '<div class="card"><h2>העברת שירותים <span class="sub">' + sv.done + '/' + sv.total + ' הושלמו</span></h2>' +
      '<div class="bar"><i style="width:' + pct(sv.done, sv.total) + '%"></i></div>' +
      '<div class="small muted" style="margin-top:8px">מספרי הטלפון הם ברירת מחדל לנוחות – כדאי לאמת מול הספק שלכם.</div></div>';

    h += toolbar('services', [
      ['status', 'סטטוס', filt('services', 'status'),
        [['', 'כל הסטטוסים']].concat(SERVICE_STATUS.map(function (x) { return [x.id, x.label]; }))],
      ['provider', 'ספק', filt('services', 'provider'),
        [['', 'כל הספקים']].concat(uniq(state.services.map(function (x) { return (x.provider || '').trim(); }))
          .map(function (v) { return [v, v]; }))]
    ]);

    var svcList = state.services.filter(function (s) {
      if (filt('services', 'status') && s.status !== filt('services', 'status')) return false;
      if (filt('services', 'provider') && (s.provider || '').trim() !== filt('services', 'provider')) return false;
      return hit(s.name, s.provider, s.notes, s.account, s.phone);
    });
    svcList = sortList('services', svcList);
    var svManual = isManual('services');
    h += '<div data-drag-group data-drag-coll="services">';
    svcList.forEach(function (s, i) {
      var stl = SERVICE_STATUS.filter(function (x) { return x.id === s.status; })[0];
      h += '<div class="card" data-drag-item data-id="' + s.id + '">' + rank(i, svManual) + '<h2>' + esc(s.name) +
        '<span class="tag ' + (s.status === 'done' ? 'ok' : s.status === 'wip' ? 'warn' : '') + '">' + esc(stl ? stl.label : '') + '</span></h2>' +
        '<div class="row">' +
        '<label class="f">ספק<input value="' + esc(s.provider || '') + '" ' + bind('services', s.id, 'provider') + '></label>' +
        '<label class="f">טלפון<input value="' + esc(s.phone || '') + '" ' + bind('services', s.id, 'phone') + '></label>' +
        '<label class="f">מס\' לקוח/חוזה<input value="' + esc(s.account || '') + '" ' + bind('services', s.id, 'account') + '></label>' +
        '<label class="f">סטטוס<select ' + bind('services', s.id, 'status') + '>' + opts(SERVICE_STATUS, s.status, 'id', 'label') + '</select></label>' +
        '</div>' +
        '<label class="f" style="margin-top:8px">הערות<textarea ' + bind('services', s.id, 'notes') + '>' + esc(s.notes || '') + '</textarea></label>' +
        '<div class="row" style="margin-top:8px">' +
        (s.phone ? '<a class="btn sm" href="tel:' + esc(String(s.phone).replace(/\s/g, '')) + '">📞 חיוג</a>' : '') +
        '<span class="spacer"></span>' +
        '<button class="x" data-act="del" data-coll="services" data-id="' + s.id + '">✕ מחיקה</button></div></div>';
    });
    h += '</div>';
    if (!svcList.length) h += '<div class="card"><div class="empty">לא נמצאו שירותים מתאימים</div></div>';
    h += '<div class="card"><button class="btn" data-act="add-service">➕ שירות נוסף</button></div>';
    return searchNote(svcList.length, sv.total, 'שירותים') + h;
  }

  function viewContacts() {
    var h = '<div class="card"><h2>איש קשר חדש</h2><div class="row">' +
      '<input id="ncName" placeholder="שם" style="flex:1 1 130px">' +
      '<input id="ncRole" placeholder="תפקיד (מוביל, חשמלאי…)" style="flex:1 1 150px">' +
      '<input id="ncPhone" placeholder="טלפון" inputmode="tel" style="flex:1 1 120px">' +
      '<button class="btn primary" data-act="add-contact">הוסף</button></div></div>';

    h += toolbar('contacts', [
      ['role', 'תפקיד', filt('contacts', 'role'),
        [['', 'כל התפקידים']].concat(uniq(state.contacts.map(function (c) { return (c.role || '').trim(); }))
          .map(function (v) { return [v, v]; }))]
    ]);

    var conList = state.contacts.filter(function (c) {
      if (filt('contacts', 'role') && (c.role || '').trim() !== filt('contacts', 'role')) return false;
      return hit(c.name, c.role, c.phone, c.notes);
    });
    conList = sortList('contacts', conList);
    var coManual = isManual('contacts');
    if (!state.contacts.length) h += '<div class="card"><div class="empty">אין עדיין אנשי קשר</div></div>';
    else if (!conList.length) h += '<div class="card"><div class="empty">לא נמצאו אנשי קשר מתאימים</div></div>';
    h += '<div data-drag-group data-drag-coll="contacts">';
    conList.forEach(function (c, i) {
      var tel = String(c.phone || '').replace(/[^\d+]/g, '');
      var wa = tel.replace(/^0/, '972').replace(/\+/, '');
      h += '<div class="card" data-drag-item data-id="' + c.id + '">' + rank(i, coManual) + '<div class="row">' +
        '<label class="f">שם<input value="' + esc(c.name || '') + '" ' + bind('contacts', c.id, 'name') + '></label>' +
        '<label class="f">תפקיד<input value="' + esc(c.role || '') + '" ' + bind('contacts', c.id, 'role') + '></label>' +
        '<label class="f">טלפון<input inputmode="tel" value="' + esc(c.phone || '') + '" ' + bind('contacts', c.id, 'phone') + '></label>' +
        '</div><label class="f" style="margin-top:8px">הערות<textarea ' + bind('contacts', c.id, 'notes') + '>' + esc(c.notes || '') + '</textarea></label>' +
        '<div class="row" style="margin-top:8px">' +
        (tel ? '<a class="btn sm" href="tel:' + esc(tel) + '">📞 חיוג</a>' : '') +
        (tel ? '<a class="btn sm" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener">💬 וואטסאפ</a>' : '') +
        '<span class="spacer"></span>' +
        '<button class="x" data-act="del" data-coll="contacts" data-id="' + c.id + '">✕ מחיקה</button></div></div>';
    });
    h += '</div>';
    return searchNote(conList.length, state.contacts.length, 'אנשי קשר') + h;
  }

  /* ---------- ניתוב ורינדור ---------- */
  var VIEWS = {
    dash: viewDash, tasks: viewTasks, shopping: viewShopping, boxes: viewBoxes,
    budget: viewBudget, services: viewServices, docs: viewDocs, contacts: viewContacts
  };

  /* ---------- תפריט צד ---------- */
  function sectionCount(id) {
    if (id === 'dash') return '';
    var map = { tasks: 'tasks', shopping: 'shopping', boxes: 'boxes',
                budget: 'budget', services: 'services', docs: 'docs', contacts: 'contacts' };
    var arr = state[map[id]];
    if (!arr) return '';
    if (id === 'tasks') return arr.filter(function (t) { return !t.done; }).length || '';
    if (id === 'shopping') return arr.filter(function (s) { return !s.bought; }).length || '';
    if (id === 'services') return arr.filter(function (s) { return s.status !== 'done'; }).length || '';
    return arr.length || '';
  }

  function renderDrawer() {
    $('#drawer').innerHTML =
      '<div class="drawer-head">' +
      (isDesktop() ? '' : '<span style="font-size:20px">🏡</span><strong>ניהול מעבר דירה</strong>') +
      '</div>' +
      TABS.map(function (t) {
        var c = sectionCount(t.id);
        return '<button class="nav-item' + (t.id === view ? ' active' : '') + '" data-tab="' + t.id + '">' +
          '<i>' + t.icon + '</i>' + esc(t.fullLabel || t.label) +
          (c ? '<span class="count">' + c + '</span>' : '') + '</button>';
      }).join('') +
      '<div class="drawer-foot" title="גרסת הבנייה המוצגת כרגע">' +
      (BUILD_STAMP ? 'נבנה ' + esc(BUILD_STAMP) : 'גרסת פיתוח') + '</div>';
  }

  // מצב המגירה נקרא תמיד מה-DOM עצמו, כדי שלא ייווצר פער בין משתנה למציאות
  function drawerIsOpen() { return $('#drawer').classList.contains('open'); }
  // בדסקטופ התפריט נשאר נעוץ עד שסוגרים אותו, והמסך נשאר פעיל לצידו.
  // בנייד הוא שכבה מעל התוכן ולכן נסגר אחרי בחירת מסך.
  var LS_DRAWER = 'afula_drawer_pinned';
  function isDesktop() { return window.matchMedia('(min-width: 1024px)').matches; }

  // גובה הסרגל העליון נמדד ונמסר ל-CSS, כדי שראש התפריט יתחיל בדיוק
  // באותו קו שבו מסתיים הסרגל הראשי בכל גודל מסך ובכל גופן.
  function syncTopbarHeight() {
    var h = $('.topbar').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--topbar-h', Math.round(h) + 'px');
  }

  function setDrawer(open) {
    var d = $('#drawer'), s = $('#scrim'), b = $('#btnMenu');
    d.classList.toggle('open', open);
    d.setAttribute('aria-hidden', open ? 'false' : 'true');
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.setAttribute('aria-label', open ? 'סגירת התפריט' : 'פתיחת התפריט');
    // הרקע המעומעם חוסם לחיצות, ולכן הוא מוצג רק כשהתפריט צף מעל התוכן
    s.classList.toggle('hidden', !open || isDesktop());
    document.body.classList.toggle('drawer-pinned', open && isDesktop());
    if (isDesktop()) safeLS.set(LS_DRAWER, open ? '1' : '0');
    if (open && !isDesktop()) { var f = d.querySelector('.nav-item'); if (f) f.focus(); }
  }

  /* ---------- גרירה לשינוי סדר ---------- */
  // מנוע אחד לכל המסכים. עובד בעכבר ובמגע דרך pointer events, וגורר רק
  // בתוך אותה קבוצה – כך שפריט לא יכול לעבור בין שלבים או קטגוריות.
  var dragCtx = null;

  function dragStart(e) {
    var g = e.target.closest && e.target.closest('[data-grip]');
    if (!g || e.button > 0) return;
    var item = g.closest('[data-drag-item]');
    var group = item && item.closest('[data-drag-group]');
    if (!item || !group) return;
    e.preventDefault();
    dragCtx = { item: item, group: group, coll: group.dataset.dragColl, pid: e.pointerId };
    item.classList.add('dragging');
    document.body.classList.add('dragging-active');
    try { g.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function dragMove(e) {
    if (!dragCtx || e.pointerId !== dragCtx.pid) return;
    e.preventDefault();
    var cur = dragCtx.item;
    var items = [].slice.call(dragCtx.group.querySelectorAll('[data-drag-item]'));
    var curRect = cur.getBoundingClientRect();
    for (var i = 0; i < items.length; i++) {
      var other = items[i];
      if (other === cur) continue;
      var r = other.getBoundingClientRect();
      var mid = r.top + r.height / 2;
      if (e.clientY < mid && curRect.top > r.top) {
        other.parentNode.insertBefore(cur, other); return;
      }
      if (e.clientY > mid && curRect.top < r.top) {
        other.parentNode.insertBefore(cur, other.nextSibling); return;
      }
    }
  }

  function dragEnd(e) {
    if (!dragCtx || (e && e.pointerId !== dragCtx.pid)) return;
    var group = dragCtx.group, coll = dragCtx.coll;
    dragCtx.item.classList.remove('dragging');
    document.body.classList.remove('dragging-active');
    dragCtx = null;
    var ids = [].slice.call(group.querySelectorAll('[data-drag-item]'))
      .map(function (n) { return n.dataset.id; });
    if (applyOrder(coll, ids)) { save(); render(); }
  }

  // כותב את הסדר החדש למערך המצב. הפריטים הנגררים תופסים בדיוק את
  // אותם מקומות שהיו להם, ולכן פריטים מסוננים או מקבוצות אחרות לא זזים.
  function applyOrder(collName, ids) {
    var arr = state[collName];
    if (!arr || !ids.length) return false;
    var inGroup = {};
    ids.forEach(function (id) { inGroup[id] = true; });
    var slots = [], byId = {};
    arr.forEach(function (x, i) {
      byId[x.id] = x;
      if (inGroup[x.id]) slots.push(i);
    });
    if (slots.length !== ids.length) return false;
    var changed = false;
    ids.forEach(function (id, k) {
      if (arr[slots[k]] !== byId[id]) changed = true;
      arr[slots[k]] = byId[id];
    });
    return changed;
  }

  // המספר הוא גם ידית הגרירה, בכל המסכים: אותו מידע, פעולה אחת.
  // כשמיון אחר מ"ידני" פעיל המספר נשאר לקריאוּת אך מוצג עמום ולא נגרר,
  // כי אז הסדר המוצג אינו הסדר השמור וגרירה הייתה מטעה.
  function rank(i, manual) {
    return manual
      ? '<button type="button" class="rank" data-grip title="גרירה לשינוי הסדר" ' +
        'aria-label="גרירה לשינוי הסדר">' + (i + 1) + '</button>'
      : '<span class="rank static">' + (i + 1) + '</span>';
  }

  function render() {
    renderDrawer();
    var warn = safeLS.ok ? '' :
      '<div class="card" style="border-color:var(--danger);background:var(--danger-soft)">' +
      '<b>⚠️ הדפדפן הזה חוסם שמירה מקומית</b>' +
      '<div class="small" style="margin-top:4px">מה שתמלאו כאן ייעלם ברענון הדף. ' +
      'זה קורה בדרך כלל בגלישה פרטית או כשחסימת עוגיות מופעלת – כדאי לפתוח את הדף בחלון רגיל.</div></div>';
    // מחיקה או עריכה בונות מחדש את המסך. גלילה לראש הדף נכונה רק כשעוברים
    // מסך – אחרת המשתמש "נזרק" למעלה אחרי כל לחיצה על ✕.
    var sameView = render._last === view;
    var keepY = window.scrollY;
    $('#views').innerHTML = warn + (VIEWS[view] || viewDash)();
    $('#searchClear').classList.toggle('hidden', !query());
    if (sameView) window.scrollTo({ top: keepY });
    else window.scrollTo({ top: 0 });
    render._last = view;
    // כל שינוי במסך, במיון או בסינון עובר דרך כאן, ולכן זו הנקודה
    // הבטוחה היחידה לשמור את מצב התצוגה לרענון הבא
    saveUI();
  }

  /* ---------- סנכרון עם לוח השנה של Google ---------- */
  // שני כיוונים, שניהם ידניים ובלחיצה מפורשת:
  //   דחיפה  – המשימות נכתבות ללוח. נוגעת רק באירועים שהאפליקציה יצרה.
  //   משיכה  – אירועים שנוספו ידנית בלוח נכנסים כמשימות, ותאריכים שהוזזו
  //            בלוח מתעדכנים במשימה.
  // נכתב ללוח ייעודי שהאפליקציה יוצרת בעצמה, ולכן ההרשאה המבוקשת היא
  // calendar.app.created – היא לא מאפשרת גישה ללוחות הקיימים של המשתמש.
  var GCAL = {
    clientId: '691992999528-jcnsvhqb73hm5k7uisnl7av5k3pe5bsc.apps.googleusercontent.com',
    scope: 'https://www.googleapis.com/auth/calendar.app.created',
    api: 'https://www.googleapis.com/calendar/v3',
    calendarName: 'ניהול מעבר דירה',
    tz: 'Asia/Jerusalem',
    startTime: '17:30:00',
    endTime: '18:00:00',
    reminderMinutes: 30,
    lsToken: 'afula_move_gcal_token'
  };
  var gcalBusy = false;
  var gcalMsg = '';

  function gcalGetToken() {
    try {
      var t = JSON.parse(safeLS.get(GCAL.lsToken) || 'null');
      // שוליים של דקה, כדי לא להתחיל בקשה עם טוקן שפג באמצע
      if (t && t.token && t.exp > Date.now() + 60000) return t.token;
    } catch (e) {}
    return null;
  }

  function gcalLoadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('לא הצלחנו לטעון את שירות ההרשאות של Google')); };
      document.head.appendChild(s);
    });
  }

  // מבקש הרשאה. הטוקן קצר-מועד ונשמר רק במכשיר הזה (לא בענן).
  function gcalAuthorize() {
    return gcalLoadGis().then(function () {
      return new Promise(function (resolve, reject) {
        var client = window.google.accounts.oauth2.initTokenClient({
          client_id: GCAL.clientId,
          scope: GCAL.scope,
          callback: function (resp) {
            if (resp && resp.access_token) {
              safeLS.set(GCAL.lsToken, JSON.stringify({
                token: resp.access_token,
                exp: Date.now() + ((Number(resp.expires_in) || 3600) - 60) * 1000
              }));
              resolve(resp.access_token);
            } else {
              reject(new Error('ההרשאה לא הושלמה'));
            }
          },
          error_callback: function (err) {
            var t = (err && err.type) || '';
            reject(new Error(t === 'popup_closed' ? 'חלון ההרשאה נסגר' :
              t === 'popup_failed_to_open' ? 'הדפדפן חסם את חלון ההרשאה' :
                'ההרשאה נכשלה'));
          }
        });
        client.requestAccessToken({ prompt: '' });
      });
    });
  }

  function gcalToken(forceNew) {
    var t = !forceNew && gcalGetToken();
    return t ? Promise.resolve(t) : gcalAuthorize();
  }

  // קריאה ל-API. אם הטוקן נדחה, מנסה פעם אחת נוספת עם הרשאה מחודשת.
  function gcalFetch(path, opts, retried) {
    return gcalToken(!!retried).then(function (token) {
      var o = opts || {};
      return fetch(GCAL.api + path, {
        method: o.method || 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        },
        body: o.body ? JSON.stringify(o.body) : undefined
      }).then(function (res) {
        if (res.status === 401 && !retried) {
          safeLS.del(GCAL.lsToken);
          return gcalFetch(path, opts, true);
        }
        if (res.status === 204) return {};
        return res.json().then(function (data) {
          if (!res.ok) {
            var msg = (data && data.error && data.error.message) || ('שגיאה ' + res.status);
            if (res.status === 403 && /rate|quota/i.test(msg)) msg = 'יותר מדי בקשות – כדאי לנסות שוב בעוד רגע';
            var err = new Error(msg);
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
    });
  }

  // מוודא שהלוח הייעודי קיים; אם נמחק ידנית – יוצר אותו מחדש
  function gcalEnsureCalendar() {
    var id = state.settings.calendarId;
    if (!id) return gcalCreateCalendar();
    return gcalFetch('/calendars/' + encodeURIComponent(id))
      .then(function () { return id; })
      .catch(function (e) {
        if (e.status === 404 || e.status === 403) return gcalCreateCalendar();
        throw e;
      });
  }

  function gcalCreateCalendar() {
    return gcalFetch('/calendars', {
      method: 'POST',
      body: { summary: GCAL.calendarName, timeZone: GCAL.tz }
    }).then(function (cal) {
      state.settings.calendarId = cal.id;
      save();
      return cal.id;
    });
  }

  function gcalEligible(t) { return !!t.due && !t.done; }
  // כל שינוי באחד מהשדות האלה מחייב עדכון של האירוע
  function gcalHash(t) {
    var p = PHASES.filter(function (x) { return x.id === t.phase; })[0];
    return [t.title, t.due, p ? p.label : t.phase].join('|');
  }

  function gcalEventBody(t) {
    var p = PHASES.filter(function (x) { return x.id === t.phase; })[0];
    return {
      summary: t.title,
      description: 'שלב: ' + (p ? p.label : '') +
        '\n\nנוצר אוטומטית מתוך "ניהול מעבר דירה". שינויים כאן יידרסו בסנכרון הבא.',
      start: { dateTime: t.due + 'T' + GCAL.startTime, timeZone: GCAL.tz },
      end: { dateTime: t.due + 'T' + GCAL.endTime, timeZone: GCAL.tz },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: GCAL.reminderMinutes }] },
      extendedProperties: { private: { afulaTaskId: t.id } }
    };
  }

  // שולף את כל האירועים בלוח שלנו, כדי לזהות מה כבר קיים ומה התייתם
  function gcalListEvents(calId) {
    var all = [];
    function page(token) {
      var q = '/calendars/' + encodeURIComponent(calId) +
        '/events?maxResults=2500&showDeleted=false' + (token ? '&pageToken=' + token : '');
      return gcalFetch(q).then(function (data) {
        all = all.concat(data.items || []);
        return data.nextPageToken ? page(data.nextPageToken) : all;
      });
    }
    return page('');
  }

  function gcalTaskIdOf(ev) {
    return (ev && ev.extendedProperties && ev.extendedProperties.private &&
      ev.extendedProperties.private.afulaTaskId) || '';
  }

  // תאריך האירוע כ-YYYY-MM-DD. אירוע "כל היום" מגיע ב-date, אירוע רגיל ב-dateTime.
  function gcalEventDate(ev) {
    var s = ev && ev.start;
    if (!s) return '';
    if (s.date) return s.date;
    if (s.dateTime) return String(s.dateTime).slice(0, 10);
    return '';
  }

  // לאיזה שלב שייך תאריך, לפי המרחק מיום המעבר. בלי תאריך מעבר מוגדר
  // אין ממה לגזור, ואז הכול נוחת ב"חודש לפני" כברירת מחדל שקל לתקן.
  function gcalPhaseFor(due) {
    var md = state.settings.moveDate;
    if (!md || !due) return 'p30';
    var days = Math.round((new Date(md + 'T12:00:00') - new Date(due + 'T12:00:00')) / 86400000);
    if (days < 0) return 'post';
    if (days === 0) return 'pday';
    if (days <= 7) return 'p7';
    if (days <= 14) return 'p14';
    if (days <= 30) return 'p30';
    return 'p60';
  }

  // סנכרון הפוך: מושך מהלוח הייעודי אל האפליקציה.
  //  · אירוע ידני  -> נוצרת משימה חדשה, והאירוע מסומן ב-afulaTaskId כדי
  //    שמשיכה נוספת לא תיצור כפילות ושהדחיפה תדע לתחזק אותו מכאן והלאה.
  //  · אירוע שלנו שהוזז או ששמו שונה בלוח -> המשימה מתעדכנת לפיו.
  function gcalPull() {
    if (gcalBusy) return;
    if (ARTIFACT) { toast('סנכרון עם לוח שנה זמין רק באתר עצמו'); return; }
    gcalBusy = true; gcalMsg = ''; render();

    var added = 0, changed = 0, calId;

    gcalEnsureCalendar()
      .then(function (id) { calId = id; return gcalListEvents(id); })
      .then(function (events) {
        var chain = Promise.resolve();

        events.forEach(function (ev) {
          var due = gcalEventDate(ev);
          var title = (ev.summary || '').trim();
          if (!due || !title) return;              // אירוע בלי תאריך או בלי שם – אין מה לייבא
          var tid = gcalTaskIdOf(ev);

          if (tid) {
            var task = findItem('tasks', tid);
            if (!task) return;                     // המשימה נמחקה; הדחיפה תנקה את האירוע
            if (task.due === due && task.title === title) return;
            task.due = due;
            task.title = title;
            // מיישרים את הטביעה כדי שהדחיפה הבאה לא "תתקן" בחזרה
            task.calendarEventId = ev.id;
            task.syncHash = gcalHash(task);
            changed++;
            return;
          }

          // אירוע ידני: נכנס כמשימה חדשה ומסומן כשייך לאפליקציה
          var nt = {
            id: uid(),
            phase: gcalPhaseFor(due),
            title: title,
            done: false,
            due: due,
            calendarEventId: ev.id
          };
          nt.syncHash = gcalHash(nt);
          state.tasks.push(nt);
          added++;
          chain = chain.then(function () {
            return gcalFetch('/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(ev.id), {
              method: 'PATCH',
              body: { extendedProperties: { private: { afulaTaskId: nt.id } } }
            }).catch(function (e) {
              // אם הסימון נכשל, עדיף לוותר על המשימה מאשר להכפיל אותה בפעם הבאה
              console.error(e);
              state.tasks = state.tasks.filter(function (x) { return x.id !== nt.id; });
              added--;
            });
          });
        });

        return chain;
      })
      .then(function () {
        state.settings.calendarPulledAt = Date.now();
        save();
        gcalBusy = false;
        gcalMsg = added + ' משימות נוספו, ' + changed + ' עודכנו מהלוח';
        render();
        toast('המשיכה הושלמה: ' + gcalMsg);
      })
      .catch(function (err) {
        console.error(err);
        gcalBusy = false;
        gcalMsg = 'שגיאה: ' + (err && err.message ? err.message : 'המשיכה נכשלה');
        render();
        toast(gcalMsg);
      });
  }

  function gcalSync() {
    if (gcalBusy) return;
    if (ARTIFACT) { toast('סנכרון ללוח שנה זמין רק באתר עצמו'); return; }
    gcalBusy = true; gcalMsg = ''; render();

    var created = 0, updated = 0, deleted = 0, calId;

    gcalEnsureCalendar()
      .then(function (id) { calId = id; return gcalListEvents(id); })
      .then(function (events) {
        // מיפוי מזהה משימה -> אירוע.
        // האפליקציה מנהלת אך ורק אירועים שהיא עצמה יצרה, כלומר כאלה
        // שנושאים afulaTaskId. אירוע שנוצר ידנית בלוח לא נמחק ולא משתנה –
        // הוא חומר הגלם של "סנכרן מלוח שנה", ובלי ההפרדה הזאת שני הכפתורים
        // היו מבטלים זה את זה.
        var byTask = {};
        var orphans = [];
        events.forEach(function (ev) {
          var tid = gcalTaskIdOf(ev);
          if (!tid) return;                       // אירוע ידני – לא נוגעים
          if (!byTask[tid]) byTask[tid] = ev; else orphans.push(ev);
        });

        var chain = Promise.resolve();
        var seen = {};

        state.tasks.forEach(function (t) {
          var ev = byTask[t.id];
          if (ev) seen[t.id] = true;

          if (gcalEligible(t)) {
            var hash = gcalHash(t);
            if (!ev) {
              chain = chain.then(function () {
                return gcalFetch('/calendars/' + encodeURIComponent(calId) + '/events',
                  { method: 'POST', body: gcalEventBody(t) })
                  .then(function (res) {
                    t.calendarEventId = res.id; t.syncHash = hash; created++;
                  });
              });
            } else if (t.syncHash !== hash || t.calendarEventId !== ev.id) {
              chain = chain.then(function () {
                return gcalFetch('/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(ev.id),
                  { method: 'PATCH', body: gcalEventBody(t) })
                  .then(function () {
                    t.calendarEventId = ev.id; t.syncHash = hash; updated++;
                  });
              });
            }
            // ללא שינוי – לא פונים ל-API בכלל
          } else if (ev) {
            // בוצעה, אבד לה התאריך, או שאינה רלוונטית יותר
            chain = chain.then(function () {
              return gcalFetch('/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(ev.id),
                { method: 'DELETE' }).then(function () {
                  delete t.calendarEventId; delete t.syncHash; deleted++;
                });
            });
          } else if (t.calendarEventId) {
            delete t.calendarEventId; delete t.syncHash;
          }
        });

        // אירועים של משימות שכבר לא קיימות
        Object.keys(byTask).forEach(function (tid) {
          if (!seen[tid]) orphans.push(byTask[tid]);
        });
        orphans.forEach(function (ev) {
          chain = chain.then(function () {
            return gcalFetch('/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(ev.id),
              { method: 'DELETE' }).then(function () { deleted++; });
          });
        });

        return chain;
      })
      .then(function () {
        state.settings.calendarSyncedAt = Date.now();
        save();
        gcalBusy = false;
        gcalMsg = created + ' נוספו, ' + updated + ' עודכנו, ' + deleted + ' נמחקו';
        render();
        toast('הסנכרון הושלם: ' + gcalMsg);
      })
      .catch(function (err) {
        console.error(err);
        gcalBusy = false;
        gcalMsg = 'שגיאה: ' + (err && err.message ? err.message : 'הסנכרון נכשל');
        render();
        toast(gcalMsg);
      });
  }

  /* ---------- פעולות ---------- */
  function coll(name) { return state[name]; }
  function findItem(name, id) {
    var a = coll(name);
    for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  }

  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab) {
      var d = tab.dataset;
      // בדסקטופ התפריט נשאר פתוח; בנייד הוא מסתיר את התוכן ולכן נסגר
      var keepOpen = isDesktop() && drawerIsOpen();
      // סינונים שמגיעים יחד עם הניווט, כדי שהמסך ייפתח ישר על מה שרלוונטי
      if (d.prio !== undefined) setFilter('shopping', 'prio', d.prio);
      if (d.shophide !== undefined) setFilter('shopping', 'bought', d.shophide === '1' ? '0' : '');
      if (d.taskphase !== undefined) setFilter('tasks', 'phase', d.taskphase);
      if (d.taskstate !== undefined) setFilter('tasks', 'state', d.taskstate);
      if (d.boxstatus !== undefined) setFilter('boxes', 'status', d.boxstatus);
      view = d.tab;
      setDrawer(keepOpen);
      render();
      return;
    }

    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act;

    if (act === 'del') {
      var it = findItem(el.dataset.coll, el.dataset.id);
      if (!it) return;
      state[el.dataset.coll] = coll(el.dataset.coll).filter(function (x) { return x.id !== el.dataset.id; });
      save(); render(); toast('נמחק');
    }
    else if (act === 'add-task') {
      var ti = $('#ntTitle');
      if (!ti.value.trim()) { ti.focus(); return; }
      state.tasks.push({ id: uid(), phase: $('#ntPhase').value, title: ti.value.trim(), done: false, due: '' });
      save(); render(); toast('משימה נוספה');
    }
    else if (act === 'add-box') {
      var max = state.boxes.reduce(function (m, b) { return Math.max(m, Number(b.num) || 0); }, 0);
      state.boxes.unshift({
        id: uid(), num: max + 1, contents: $('#nbContents').value.trim(),
        from: $('#nbFrom').value, to: $('#nbTo').value, status: 'todo', fragile: false
      });
      save(); render(); toast('ארגז מס\' ' + (max + 1) + ' נוסף');
    }
    else if (act === 'add-budget') {
      state.budget.push({
        id: uid(), section: el.dataset.section || state.budgetSections[0].id,
        cat: '', planned: 0, actual: 0, paid: false, note: ''
      });
      save(); render();
    }
    else if (act === 'add-budget-section') {
      var bsn = $('#nbsName');
      var bsName = bsn.value.trim();
      if (!bsName) { bsn.focus(); return; }
      if (state.budgetSections.some(function (s) { return s.name === bsName; })) {
        toast('כבר קיימת קטגוריה בשם הזה'); return;
      }
      state.budgetSections.push({ id: uid(), name: bsName, recurring: $('#nbsRecurring').checked });
      save(); render(); toast('הקטגוריה נוספה');
    }
    else if (act === 'del-budget-section') {
      if (state.budgetSections.length < 2) { toast('חייבת להישאר לפחות קטגוריה אחת'); return; }
      var secId = el.dataset.id;
      var sec = sectionById(secId);
      var inSec = state.budget.filter(function (r) { return r.section === secId; });
      var fallback = state.budgetSections.filter(function (s) { return s.id !== secId; })[0];
      if (inSec.length && !confirm('בקטגוריה "' + sec.name + '" יש ' + inSec.length +
          ' סעיפים. למחוק את הקטגוריה ולהעביר אותם ל"' + fallback.name + '"?')) return;
      inSec.forEach(function (r) { r.section = fallback.id; });
      state.budgetSections = state.budgetSections.filter(function (s) { return s.id !== secId; });
      save(); render();
      toast(inSec.length ? 'הקטגוריה נמחקה והסעיפים הועברו' : 'הקטגוריה נמחקה');
    }
    else if (act === 'add-shop-area') {
      var san = $('#nsaName');
      var saName = san.value.trim();
      if (!saName) { san.focus(); return; }
      if (state.shopAreas.indexOf(saName) !== -1) { toast('כבר קיימת קטגוריה בשם הזה'); return; }
      state.shopAreas.push(saName);
      save(); render(); toast('הקטגוריה נוספה');
    }
    else if (act === 'del-shop-area') {
      if (state.shopAreas.length < 2) { toast('חייבת להישאר לפחות קטגוריה אחת'); return; }
      var areaName = el.dataset.name;
      var items = state.shopping.filter(function (s) { return s.area === areaName; });
      var otherArea = state.shopAreas.filter(function (a) { return a !== areaName; })[0];
      if (items.length && !confirm('בקטגוריה "' + areaName + '" יש ' + items.length +
          ' פריטים. למחוק את הקטגוריה ולהעביר אותם ל"' + otherArea + '"?')) return;
      items.forEach(function (s) { s.area = otherArea; });
      state.shopAreas = state.shopAreas.filter(function (a) { return a !== areaName; });
      save(); render();
      toast(items.length ? 'הקטגוריה נמחקה והפריטים הועברו' : 'הקטגוריה נמחקה');
    }
    else if (act === 'add-shop') {
      var sn = $('#nsName');
      if (!sn.value.trim()) { sn.focus(); return; }
      state.shopping.push({
        id: uid(), area: $('#nsArea').value, name: sn.value.trim(),
        prio: $('#nsPrio').value, est: 0, cost: 0, store: '', link: '', bought: false
      });
      save(); render(); toast('נוסף לרשימת הקניות');
    }
    else if (act === 'add-doc') {
      state.docs.push({ id: uid(), type: 'other', title: 'רשומה חדשה', date: '', value: '', link: '', notes: '' });
      save(); render();
    }
    else if (act === 'link') {
      // לחיצה ארוכה כבר פתחה את העריכה – הקליק שאחריה לא אמור גם לפתוח את הקישור
      if (linkPress.fired) { linkPress.fired = false; return; }
      openLink(el.dataset.coll, el.dataset.id);
    }
    else if (act === 'clear-filters') {
      clearFilters(el.dataset.view);
      render(); toast('הסינונים נוקו');
    }
    else if (act === 'add-service') {
      state.services.push({ id: uid(), name: 'שירות חדש', provider: '', phone: '', account: '', status: 'todo', notes: '' });
      save(); render();
    }
    else if (act === 'add-contact') {
      var n = $('#ncName').value.trim(), r = $('#ncRole').value.trim(), p = $('#ncPhone').value.trim();
      if (!n && !p) { $('#ncName').focus(); return; }
      state.contacts.push({ id: uid(), name: n, role: r, phone: p, notes: '' });
      save(); render(); toast('נוסף');
    }
    else if (act === 'gcal-sync') gcalSync();
    else if (act === 'gcal-pull') gcalPull();
    else if (act === 'print-labels') printLabels();
    else if (act === 'settings') openSettings();
    else if (act === 'clear-search') {
      $('#globalSearch').value = '';
      render();
      $('#globalSearch').focus();
    }
  });

  /* ---------- תפריט צד וחיפוש ---------- */
  $('#btnMenu').addEventListener('click', function () { setDrawer(!drawerIsOpen()); });
  $('#scrim').addEventListener('click', function () { setDrawer(false); });
  document.addEventListener('pointerdown', dragStart);
  document.addEventListener('pointermove', dragMove);
  document.addEventListener('pointerup', dragEnd);
  document.addEventListener('pointercancel', dragEnd);

  /* ---------- לחיצה ארוכה על כפתור קישור ---------- */
  // הכפתור נושא שתי פעולות: לחיצה קצרה פותחת את הקישור, לחיצה ארוכה
  // (חצי שנייה) פותחת את תיבת ההדבקה. הדגל fired מונע מהקליק שאחרי
  // הלחיצה הארוכה לפתוח גם את הקישור.
  var linkPress = { t: null, fired: false, x: 0, y: 0 };
  function linkPressCancel() { clearTimeout(linkPress.t); linkPress.t = null; }
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="link"]');
    if (!b || e.button > 0) return;
    var c = b.dataset.coll, id = b.dataset.id;
    linkPress.fired = false;
    linkPress.x = e.clientX; linkPress.y = e.clientY;
    clearTimeout(linkPress.t);
    linkPress.t = setTimeout(function () {
      linkPress.t = null;
      linkPress.fired = true;
      editLink(c, id);
    }, 550);
  });
  document.addEventListener('pointerup', linkPressCancel);
  document.addEventListener('pointercancel', linkPressCancel);
  document.addEventListener('pointermove', function (e) {
    // גלילה מעל הכפתור אינה לחיצה ארוכה. הסף נדרש כי אצבע על המסך
    // זזה תמיד פיקסל-שניים, ובלעדיו כמעט אף לחיצה ארוכה לא הייתה נספרת.
    if (!linkPress.t) return;
    if (Math.abs(e.clientX - linkPress.x) > 10 || Math.abs(e.clientY - linkPress.y) > 10) linkPressCancel();
  });
  // בנייד לחיצה ארוכה פותחת תפריט הקשר של הדפדפן ומכסה את תיבת ההדבקה
  document.addEventListener('contextmenu', function (e) {
    if (e.target.closest && e.target.closest('[data-act="link"]')) e.preventDefault();
  });
  // מעבר בין נייד לדסקטופ משנה את התנהגות התפריט
  window.addEventListener('resize', function () {
    syncTopbarHeight();
    renderDrawer();
    if (drawerIsOpen()) setDrawer(true);
    else document.body.classList.remove('drawer-pinned');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (drawerIsOpen()) { setDrawer(false); $('#btnMenu').focus(); return; }
      if (!$('#overlay').classList.contains('hidden')) $('#overlay').classList.add('hidden');
    }
  });

  var searchTimer = null;
  $('#globalSearch').addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var el = $('#globalSearch'), pos = el.selectionStart;
      render();
      // ‎render‎ בונה מחדש את המסך אך לא את שורת החיפוש, ולכן הפוקוס נשמר
      el.focus();
      try { el.setSelectionRange(pos, pos); } catch (err) {}
    }, 200);
  });
  $('#searchClear').addEventListener('click', function () {
    $('#globalSearch').value = '';
    render();
    $('#globalSearch').focus();
  });

  // עריכת שדות: input (טקסט) בלי רינדור מחדש, change (select/date) עם רינדור
  function applyEdit(el) {
    var it = findItem(el.dataset.coll, el.dataset.id);
    if (!it) return false;
    var f = el.dataset.field;
    it[f] = (el.type === 'number') ? (el.value === '' ? 0 : Number(el.value)) : el.value;
    save();
    return true;
  }
  document.addEventListener('input', function (e) {
    var el = e.target.closest('[data-act="edit"]');
    if (!el) return;
    if (el.tagName === 'SELECT' || el.type === 'date') return;
    applyEdit(el);
    if (el.dataset.coll === 'budget' || el.dataset.coll === 'shopping') refreshTotals();
  });
  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-act="edit"]');
    if (el && (el.tagName === 'SELECT' || el.type === 'date')) {
      // העברת משימה לשלב אחר מוציאה אותה מהרשימה הנוכחית – מאשרים בהודעה קצרה
      var movedTask = el.dataset.coll === 'tasks' && el.dataset.field === 'phase';
      var movedShop = el.dataset.coll === 'shopping' && el.dataset.field === 'area';
      var target = el.value;
      if (applyEdit(el)) {
        render();
        if (movedTask) {
          var ph = PHASES.filter(function (p) { return p.id === target; })[0];
          toast('המשימה הועברה ל"' + (ph ? ph.label : '') + '"');
        } else if (movedShop) {
          toast('הפריט הועבר ל"' + target + '"');
        }
      }
      return;
    }
    var rec = e.target.closest('[data-act="toggle-section-recurring"]');
    if (rec) {
      var sc = sectionById(rec.dataset.id);
      if (sc) { sc.recurring = rec.checked; save(); render(); }
      return;
    }
    var tg = e.target.closest('[data-act="toggle"]');
    if (tg) {
      var it = findItem(tg.dataset.coll, tg.dataset.id);
      if (it) { it[tg.dataset.field] = tg.checked; save(); render(); }
      return;
    }
    if (e.target.dataset && e.target.dataset.sortfor) {
      sortBy[e.target.dataset.sortfor] = e.target.value; render(); return;
    }
    if (e.target.dataset && e.target.dataset.filterfor) {
      var fv = e.target.dataset.filterfor;
      filterBy[fv] = filterBy[fv] || {};
      filterBy[fv][e.target.dataset.field] = e.target.value;
      render();
    }
  });

  // מעדכן כל סכום מוצג במקום, בלי לבנות מחדש את המסך – אחרת הפוקוס
  // היה קופץ מהשדה באמצע ההקלדה. המפתח הוא "מקור:שדה[:מזהה]".
  function refreshTotals() {
    var els = document.querySelectorAll('[data-total]');
    if (!els.length) return;
    var bg = null, sh = null;
    [].forEach.call(els, function (n) {
      var p = String(n.dataset.total).split(':');
      var kind = p[0], field = p[1], key = p.slice(2).join(':');
      var src;
      if (kind === 'bg') src = (bg = bg || budgetStats());
      else if (kind === 'sh') src = (sh = sh || shopStats());
      else if (kind === 'bsec') src = sectionStats(key);
      else if (kind === 'ssec') src = areaStats(key);
      if (src && src[field] != null) n.textContent = nis(src[field]);
    });
  }

  /* ---------- הדפסת תוויות ---------- */
  function printLabels() {
    if (!state.boxes.length) { toast('אין ארגזים להדפסה'); return; }
    var html = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>תוויות ארגזים</title><style>' +
      'body{font-family:Rubik,Arial,sans-serif;margin:8mm}' +
      '.g{display:grid;grid-template-columns:1fr 1fr;gap:6mm}' +
      '.l{border:2px solid #000;border-radius:6px;padding:5mm;height:60mm;display:flex;flex-direction:column;justify-content:space-between;page-break-inside:avoid}' +
      '.n{font-size:52pt;font-weight:800;line-height:1}' +
      '.r{font-size:20pt;font-weight:700}.c{font-size:12pt}.f{font-size:14pt;font-weight:700;color:#b91c1c}' +
      '.a{font-size:10pt;color:#555;border-top:1px solid #999;padding-top:2mm}' +
      '</style></head><body><div class="g">' +
      state.boxes.map(function (b) {
        return '<div class="l"><div><div class="n">#' + b.num + '</div>' +
          '<div class="r">→ ' + esc(b.to || '') + '</div>' +
          '<div class="c">' + esc(b.contents || '') + '</div></div>' +
          (b.fragile ? '<div class="f">⚠️ שביר – בזהירות</div>' : '<div></div>') +
          '<div class="a">' + esc(state.settings.toAddr || '') + '</div></div>';
      }).join('') + '</div></body></html>';
    var w = window.open('', '_blank');
    if (!w) { toast('החלון נחסם – יש לאשר חלונות קופצים'); return; }
    w.document.write(html); w.document.close();
    setTimeout(function () { w.print(); }, 400);
  }

  /* ---------- הגדרות ---------- */
  function themeOpt(val, label) {
    return '<button class="btn sm theme-opt' + (themeMode() === val ? ' active' : '') +
      '" type="button" data-s="theme" data-val="' + val + '"' +
      ' aria-pressed="' + (themeMode() === val ? 'true' : 'false') + '">' + label + '</button>';
  }

  function openSettings() {
    var s = state.settings;
    var ov = $('#overlay');
    ov.innerHTML = '<div class="sheet">' +
      '<div class="row"><h2>הגדרות</h2><span class="spacer"></span><button class="x" data-s="close">✕</button></div>' +

      '<div class="sect"><h3>פרטי המעבר</h3><div class="row">' +
      '<label class="f">תאריך המעבר<input type="date" id="stDate" value="' + esc(s.moveDate || '') + '"></label>' +
      '<label class="f">חברת הובלה<input id="stMovers" value="' + esc(s.movers || '') + '"></label></div>' +
      '<div class="row" style="margin-top:8px">' +
      '<label class="f">כתובת נוכחית<input id="stFrom" value="' + esc(s.fromAddr || '') + '" placeholder="רחוב, עיר"></label>' +
      '<label class="f">כתובת חדשה<input id="stTo" value="' + esc(s.toAddr || '') + '"></label></div></div>' +

      (ARTIFACT ?
      '<div class="sect"><h3>סנכרון בין מכשירים</h3>' +
      '<div class="small muted">בגרסה המתארחת הזו הנתונים נשמרים בדפדפן של המכשיר שאתם נמצאים בו, ' +
      'ולא עוברים בין מכשירים. כדי לעבוד על אותו לוח מהטלפון ומהמחשב יחד, יש להעלות את תיקיית האפליקציה ' +
      'לאירוח עם Firebase – ההוראות המלאות בקובץ ה־README.<br><br>' +
      'בינתיים אפשר להעביר נתונים בין מכשירים דרך <b>ייצוא</b> ו<b>ייבוא</b> של קובץ גיבוי, למטה.</div></div>'
      :
      '<div class="sect"><h3>סנכרון בין מכשירים</h3>' +
      (cloud.user
        ? '<div class="small">מחובר כ־<b>' + esc(cloud.user.email || cloud.user.displayName || '') + '</b></div>' +
          '<div class="small muted" style="margin-top:6px">כל שינוי נשמר בענן ומופיע מיד בכל מכשיר שמחובר לאותו חשבון Google.</div>' +
          '<div class="row" style="margin-top:10px"><button class="btn" data-s="signout">התנתקות</button></div>'
        : '<div class="small muted" style="margin-bottom:10px">מתחברים עם חשבון Google, וכל המכשירים שלכם רואים את אותו לוח תכנון בזמן אמת. ' +
          'בלי התחברות הנתונים נשמרים רק במכשיר הזה.</div>' +
          '<div class="row"><button class="btn primary" data-s="signin">התחברות עם Google</button></div>'
      ) + '</div>') +

      '<div class="sect"><h3>מראה</h3>' +
      '<div class="row themepick">' +
      themeOpt('auto', '🖥️ לפי המערכת') +
      themeOpt('light', '☀️ בהיר') +
      themeOpt('dark', '🌙 כהה') +
      '</div>' +
      '<div class="small muted" style="margin-top:6px">הבחירה נשמרת במכשיר הזה ונשארת גם אחרי סגירת האפליקציה ' +
      'והתחברות מחדש. "לפי המערכת" מתחלף לבד יחד עם מצב הלילה של הטלפון.</div></div>' +

      '<div class="sect"><h3>גיבוי</h3><div class="row">' +
      '<button class="btn" data-s="export">⬇️ ייצוא לקובץ</button>' +
      '<button class="btn" data-s="import">⬆️ ייבוא מקובץ</button>' +
      '<input type="file" id="stFile" accept="application/json" class="hidden"></div>' +
      '<div class="small muted" style="margin-top:6px">אפשר לשמור את קובץ הגיבוי בגוגל דרייב.</div></div>' +

      '<div class="sect"><h3>איפוס</h3>' +
      '<button class="btn danger" data-s="reset">מחיקת כל הנתונים והתחלה מחדש</button></div>' +

      '<div class="row" style="margin-top:16px"><button class="btn primary" data-s="save" style="flex:1">שמירה</button></div>' +
      '</div>';
    ov.classList.remove('hidden');

    ov.onclick = function (e) {
      if (e.target === ov) { ov.classList.add('hidden'); return; }
      var b = e.target.closest('[data-s]');
      if (!b) return;
      var a = b.dataset.s;

      if (a === 'close') ov.classList.add('hidden');
      else if (a === 'save') {
        s.moveDate = $('#stDate').value;
        s.movers = $('#stMovers').value;
        s.fromAddr = $('#stFrom').value;
        s.toAddr = $('#stTo').value;
        save(); render(); ov.classList.add('hidden'); toast('נשמר');
      }
      else if (a === 'theme') {
        setTheme(b.dataset.val);
        // הגיליון נשאר פתוח; רק סימון הבחירה מתעדכן במקום, כדי שאפשר יהיה
        // להשוות בין בהיר לכהה בלי לצאת ולהיכנס שוב
        [].forEach.call(ov.querySelectorAll('.theme-opt'), function (x) {
          var on = x.dataset.val === themeMode();
          x.classList.toggle('active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      else if (a === 'signin') { ov.classList.add('hidden'); signIn(); }
      else if (a === 'signout') { ov.classList.add('hidden'); signOutNow(); }
      else if (a === 'export') exportJSON();
      else if (a === 'import') $('#stFile').click();
      else if (a === 'reset') {
        if (confirm('למחוק את כל הנתונים ולחזור לרשימות ברירת המחדל?')) {
          state = defaultState(); save(); render(); ov.classList.add('hidden'); toast('אופס');
        }
      }
    };

    $('#stFile').onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var d = JSON.parse(r.result);
          if (!d || !Array.isArray(d.tasks)) throw 0;
          state = d; save(); render(); ov.classList.add('hidden'); toast('הנתונים יובאו');
        } catch (err) { toast('קובץ לא תקין'); }
      };
      r.readAsText(f);
    };
  }

  function exportJSON() {
    var json = JSON.stringify(state, null, 2);
    var name = 'afula-move-' + todayISO() + '.json';

    // בגרסה המתארחת ההורדה עוברת דרך שכבת האירוח ומחייבת אישור של המשתמש
    if (window.claude && window.claude.downloads) {
      window.claude.downloads.save({ filename: name, data: json })
        .then(function () { toast('הגיבוי נשמר'); })
        .catch(function (err) {
          toast(err && err.code === 'declined' ? 'השמירה בוטלה' : 'לא הצלחנו לשמור את הגיבוי');
        });
      return;
    }

    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('הקובץ הורד');
  }

  $('#btnSettings').addEventListener('click', openSettings);
  $('#syncBadge').addEventListener('click', openSettings);

  /* ---------- אתחול ---------- */
  state = loadLocal();
  loadUI();
  render();
  syncTopbarHeight();
  // בדסקטופ התפריט חוזר למצב שבו נשאר. בנייד הוא תמיד מתחיל סגור.
  if (isDesktop() && safeLS.get(LS_DRAWER) === '1') setDrawer(true);
  initCloud();

  if (!ARTIFACT && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
})();
