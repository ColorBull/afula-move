# -*- coding: utf-8 -*-
"""
שרת MCP לאפליקציית "ניהול מעבר דירה".

מאפשר ל-Claude לקרוא ולשנות את הנתונים של האפליקציה ישירות ב-Firestore,
כך שאפשר לנהל שיחה על המעבר – לשאול שאלות, להוסיף משימות, לסמן קניות
ולעדכן תקציב – והשינויים מופיעים מיד באתר בכל המכשירים.

מבנה הנתונים ב-Firestore:
    moves/{uid}  ->  { payload: "<JSON כמחרוזת>", updatedAt: <מילישניות> }

כל המידע נמצא בתוך payload כמחרוזת JSON אחת, בדיוק כפי שהאפליקציה שומרת
אותו. השרת קורא, משנה וכותב מחדש – ותמיד מעדכן updatedAt לזמן הנוכחי,
אחרת האפליקציה תתעלם מהשינוי (היא מאמצת רק עותק חדש יותר מהמקומי).
"""

import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional

import firebase_admin
from firebase_admin import credentials, firestore
from mcp.server import MCPServer

# ----------------------------------------------------------------------------
# הגדרות
# ----------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
SA_KEY = os.environ.get("AFULA_SA_KEY", os.path.join(HERE, "service-account.json"))
FIXED_UID = os.environ.get("AFULA_MOVE_UID", "").strip()
COLLECTION = "moves"

mcp = MCPServer(
    "afula-move",
    instructions=(
        "כלים לניהול אפליקציית מעבר הדירה. כדאי להתחיל ב-get_overview כדי לקבל "
        "תמונת מצב, וב-get_schema לפני עריכה ראשונה. לפני עדכון או מחיקה של פריט "
        "יש לאתר את המזהה שלו עם list_items או search."
    ),
)

_db = None
_doc_id = None


def _client():
    """מאתחל את החיבור ל-Firestore פעם אחת ומחזיר את הלקוח.

    ריצה בענן (Cloud Run וכו'): אם אין קובץ מפתח שירות מקומי, משתמשים
    בזהות ברירת המחדל של הענן (Application Default Credentials) – כלומר
    בחשבון השירות שמחובר לשירות עצמו, בלי לשנע קובץ מפתח כלל.
    """
    global _db
    if _db is None:
        if not firebase_admin._apps:
            if os.path.exists(SA_KEY):
                firebase_admin.initialize_app(credentials.Certificate(SA_KEY))
            elif os.environ.get("K_SERVICE") or os.environ.get("AFULA_USE_ADC"):
                # רץ בענן (Cloud Run מגדיר K_SERVICE אוטומטית) – Application
                # Default Credentials של חשבון השירות המחובר לשירות.
                firebase_admin.initialize_app()
            else:
                raise RuntimeError(
                    "לא נמצא קובץ מפתח השירות בנתיב: " + SA_KEY +
                    "\nיש להוריד אותו מ-Firebase Console ← Project settings ← "
                    "Service accounts ← Generate new private key, ולשמור אותו שם."
                )
        _db = firestore.client()
    return _db


def _doc_ref():
    """מאתר את המסמך של המשתמש. אם יש רק אחד – בוחר אותו אוטומטית."""
    global _doc_id
    db = _client()
    if FIXED_UID:
        return db.collection(COLLECTION).document(FIXED_UID)
    if _doc_id:
        return db.collection(COLLECTION).document(_doc_id)
    docs = list(db.collection(COLLECTION).limit(5).stream())
    if not docs:
        raise RuntimeError(
            "לא נמצא מסמך נתונים. יש להיכנס פעם אחת לאתר, להתחבר עם Google "
            "ולבצע שינוי כלשהו, כדי שהמסמך ייווצר."
        )
    if len(docs) > 1 and not FIXED_UID:
        ids = ", ".join(d.id for d in docs)
        raise RuntimeError(
            "נמצאו כמה מסמכים (" + ids + "). יש להגדיר משתנה סביבה "
            "AFULA_MOVE_UID עם המזהה הרצוי."
        )
    _doc_id = docs[0].id
    return db.collection(COLLECTION).document(_doc_id)


DEFAULT_SECTIONS = [
    {"id": "once", "name": "הוצאות חד-פעמיות", "recurring": False},
    {"id": "recurring", "name": "הוצאות שוטפות", "recurring": True},
]
DEFAULT_AREAS = ["חדר שינה", "סלון", "מטבח", "אמבטיה ושירותים",
                 "ניקיון וכביסה", "תאורה וחשמל", "כללי"]


def _normalize(state: Dict[str, Any]) -> Dict[str, Any]:
    """משלים שדות שנוספו לאפליקציה אחרי שהמסמך נשמר לאחרונה.

    האתר מבצע את אותה השלמה בזיכרון, אבל שומר אותה רק בשינוי הבא.
    בלי זה השרת היה מדווח על אפס קטגוריות תקציב עד לעריכה הבאה באתר.
    """
    if not isinstance(state.get("budgetSections"), list) or not state["budgetSections"]:
        state["budgetSections"] = [dict(x) for x in DEFAULT_SECTIONS]
    sec_ids = [x["id"] for x in state["budgetSections"]]
    for row in state.get("budget", []):
        if row.get("section") not in sec_ids:
            row["section"] = sec_ids[0]

    if not isinstance(state.get("shopAreas"), list) or not state["shopAreas"]:
        areas = list(DEFAULT_AREAS)
        for item in state.get("shopping", []):
            if item.get("area") and item["area"] not in areas:
                areas.append(item["area"])
        state["shopAreas"] = areas
    return state


def _load() -> Dict[str, Any]:
    snap = _doc_ref().get()
    if not snap.exists:
        raise RuntimeError("מסמך הנתונים לא קיים עדיין.")
    raw = snap.to_dict() or {}
    payload = raw.get("payload")
    if not payload:
        raise RuntimeError("המסמך ריק – אין שדה payload.")
    return _normalize(json.loads(payload))


def _save(state: Dict[str, Any]) -> None:
    """כותב את המצב חזרה, עם חותמת זמן חדשה כדי שהאפליקציה תאמץ אותו."""
    now = int(time.time() * 1000)
    state["updatedAt"] = now
    _doc_ref().set({"payload": json.dumps(state, ensure_ascii=False), "updatedAt": now})


# אוספים שניתן לערוך, והשדות של כל אחד
COLLECTIONS: Dict[str, Dict[str, Any]] = {
    "tasks": {
        "desc": "משימות המעבר",
        "fields": ["title", "phase", "done", "due"],
        "required": ["title"],
        "defaults": {"phase": "p30", "done": False, "due": ""},
        "enums": {"phase": ["p60", "p30", "p14", "p7", "pday", "post"]},
    },
    "shopping": {
        "desc": "קניות לדירה",
        "fields": ["name", "area", "prio", "est", "cost", "store", "bought"],
        "required": ["name"],
        "defaults": {"prio": "soon", "est": 0, "cost": 0, "store": "", "bought": False},
        "enums": {"prio": ["must", "soon", "later"]},
    },
    "boxes": {
        "desc": "ארגזים",
        "fields": ["num", "contents", "from", "to", "status", "fragile"],
        "required": ["contents"],
        "defaults": {"status": "todo", "fragile": False, "from": "כללי", "to": "כללי"},
        "enums": {"status": ["todo", "packed", "loaded", "arrived", "opened"]},
    },
    "budget": {
        "desc": "סעיפי תקציב",
        "fields": ["cat", "section", "planned", "actual", "paid", "note"],
        "required": ["cat"],
        "defaults": {"planned": 0, "actual": 0, "paid": False, "note": ""},
        "enums": {},
    },
    "services": {
        "desc": "העברת שירותים",
        "fields": ["name", "provider", "phone", "account", "status", "notes"],
        "required": ["name"],
        "defaults": {"provider": "", "phone": "", "account": "", "status": "todo", "notes": ""},
        "enums": {"status": ["todo", "wip", "done"]},
    },
    "docs": {
        "desc": "מסמכים וצילומים",
        "fields": ["title", "type", "date", "value", "link", "notes"],
        "required": ["title"],
        "defaults": {"type": "other", "date": "", "value": "", "link": "", "notes": ""},
        "enums": {"type": ["meter", "contract", "protocol", "receipt", "other"]},
    },
    "contacts": {
        "desc": "אנשי קשר",
        "fields": ["name", "role", "phone", "notes"],
        "required": ["name"],
        "defaults": {"role": "", "phone": "", "notes": ""},
        "enums": {},
    },
}

PHASE_LABELS = {
    "p60": "חודשיים לפני", "p30": "חודש לפני", "p14": "שבועיים לפני",
    "p7": "שבוע לפני", "pday": "יום המעבר", "post": "אחרי המעבר",
}
PRIO_LABELS = {"must": "ליום הראשון", "soon": "שבוע ראשון", "later": "בהמשך"}


# אותיות סופיות בעברית: בלי נרמול, חיפוש "מזגן" לא ימצא "מזגנים",
# כי הנו"ן הסופית (ן) והנו"ן הרגילה (נ) הן תווים שונים לגמרי.
_FINALS = str.maketrans("ךםןףץ", "כמנפצ")


def _norm(value: Any) -> str:
    return str(value).lower().translate(_FINALS)


def _matches(item: Dict[str, Any], needle: str) -> bool:
    return any(needle in _norm(v) for v in item.values())


def _ok(msg: str, extra: Optional[Dict[str, Any]] = None) -> str:
    out = {"ok": True, "message": msg}
    if extra:
        out.update(extra)
    return json.dumps(out, ensure_ascii=False, indent=1)


def _find(items: List[Dict[str, Any]], item_id: str) -> Optional[Dict[str, Any]]:
    for it in items:
        if it.get("id") == item_id:
            return it
    return None


# ----------------------------------------------------------------------------
# כלים
# ----------------------------------------------------------------------------

@mcp.tool()
def get_schema() -> str:
    """מחזיר את מבנה הנתונים: אילו אוספים קיימים, אילו שדות יש לכל אחד
    ואילו ערכים מותרים בשדות מקודדים. כדאי לקרוא לזה לפני עריכה ראשונה."""
    schema = {}
    for name, meta in COLLECTIONS.items():
        schema[name] = {
            "description": meta["desc"],
            "fields": meta["fields"],
            "required_on_add": meta["required"],
            "allowed_values": meta["enums"],
        }
    schema["_labels"] = {"phase": PHASE_LABELS, "prio": PRIO_LABELS}
    return json.dumps(schema, ensure_ascii=False, indent=1)


@mcp.tool()
def get_overview() -> str:
    """סיכום כללי של המעבר: תאריך, כמה ימים נשארו, התקדמות בכל תחום
    וסיכום כספי. נקודת פתיחה טובה לכל שאלה על מצב המעבר."""
    s = _load()
    settings = s.get("settings", {})
    tasks = s.get("tasks", [])
    shopping = s.get("shopping", [])
    services = s.get("services", [])
    boxes = s.get("boxes", [])
    budget = s.get("budget", [])
    sections = {x["id"]: x for x in s.get("budgetSections", [])}

    days_left = None
    if settings.get("moveDate"):
        try:
            move = time.mktime(time.strptime(settings["moveDate"], "%Y-%m-%d"))
            days_left = int((move - time.time()) // 86400) + 1
        except ValueError:
            days_left = None

    one_time = sum((r.get("actual") or 0) for r in budget
                   if not sections.get(r.get("section"), {}).get("recurring"))
    recurring = sum(((r.get("actual") or 0) or (r.get("planned") or 0)) for r in budget
                    if sections.get(r.get("section"), {}).get("recurring"))

    return json.dumps({
        "move_date": settings.get("moveDate") or None,
        "days_left": days_left,
        "from_address": settings.get("fromAddr") or None,
        "to_address": settings.get("toAddr") or None,
        "tasks": {"done": sum(1 for t in tasks if t.get("done")), "total": len(tasks),
                  "overdue": sum(1 for t in tasks if not t.get("done") and t.get("due")
                                 and t["due"] < time.strftime("%Y-%m-%d"))},
        "shopping": {"bought": sum(1 for x in shopping if x.get("bought")), "total": len(shopping),
                     "must_have_left": sum(1 for x in shopping
                                           if not x.get("bought") and x.get("prio") == "must")},
        "services": {"done": sum(1 for x in services if x.get("status") == "done"),
                     "total": len(services)},
        "boxes": {"packed": sum(1 for b in boxes if b.get("status") != "todo"), "total": len(boxes)},
        "money": {
            "planned_total": sum((r.get("planned") or 0) for r in budget),
            "one_time_spent": one_time,
            "recurring_monthly": recurring,
            "shopping_spent": sum((x.get("cost") or 0) for x in shopping),
        },
        "budget_sections": [{"id": x["id"], "name": x["name"], "recurring": x.get("recurring", False)}
                            for x in s.get("budgetSections", [])],
        "shopping_areas": s.get("shopAreas", []),
    }, ensure_ascii=False, indent=1)


@mcp.tool()
def list_items(collection: str, only_open: bool = False, contains: str = "") -> str:
    """מציג פריטים מאוסף מסוים.

    collection: אחד מ-tasks / shopping / boxes / budget / services / docs / contacts
    only_open:  להציג רק מה שעדיין לא בוצע (משימות שלא הושלמו, קניות שלא נקנו,
                שירותים שלא הועברו)
    contains:   סינון חופשי לפי טקסט
    """
    if collection not in COLLECTIONS:
        return _ok("אוסף לא מוכר. אפשרויות: " + ", ".join(COLLECTIONS))
    s = _load()
    items = s.get(collection, [])

    if only_open:
        if collection == "tasks":
            items = [x for x in items if not x.get("done")]
        elif collection == "shopping":
            items = [x for x in items if not x.get("bought")]
        elif collection == "services":
            items = [x for x in items if x.get("status") != "done"]
        elif collection == "boxes":
            items = [x for x in items if x.get("status") == "todo"]

    if contains:
        needle = _norm(contains)
        items = [x for x in items if _matches(x, needle)]

    # תוויות בעברית לשדות מקודדים, כדי שהתשובה תהיה קריאה
    out = []
    for x in items:
        row = dict(x)
        if "phase" in row:
            row["phase_label"] = PHASE_LABELS.get(row["phase"], row["phase"])
        if "prio" in row:
            row["prio_label"] = PRIO_LABELS.get(row["prio"], row["prio"])
        if collection == "budget":
            sec = next((y for y in s.get("budgetSections", []) if y["id"] == row.get("section")), None)
            row["section_label"] = sec["name"] if sec else ""
        out.append(row)

    return json.dumps({"collection": collection, "count": len(out), "items": out},
                      ensure_ascii=False, indent=1)


@mcp.tool()
def add_item(collection: str, fields: str) -> str:
    """מוסיף פריט חדש. fields הוא אובייקט JSON עם השדות הרצויים,
    למשל: {"title": "לתאם מנוף", "phase": "p14"}
    כדאי לקרוא ל-get_schema כדי לדעת אילו שדות וערכים חוקיים."""
    if collection not in COLLECTIONS:
        return _ok("אוסף לא מוכר. אפשרויות: " + ", ".join(COLLECTIONS))
    meta = COLLECTIONS[collection]
    try:
        data = json.loads(fields)
    except json.JSONDecodeError as e:
        return _ok("ה-JSON בשדה fields אינו תקין: " + str(e))
    if not isinstance(data, dict):
        return _ok("fields צריך להיות אובייקט JSON.")

    for req in meta["required"]:
        if not str(data.get(req, "")).strip():
            return _ok('חסר שדה חובה: "' + req + '"')
    for key, allowed in meta["enums"].items():
        if key in data and data[key] not in allowed:
            return _ok('ערך לא חוקי בשדה "' + key + '". מותר: ' + ", ".join(allowed))

    s = _load()
    item = dict(meta["defaults"])
    item.update({k: v for k, v in data.items() if k in meta["fields"]})
    item["id"] = uuid.uuid4().hex[:12]

    if collection == "boxes" and not item.get("num"):
        item["num"] = max([b.get("num", 0) for b in s.get("boxes", [])] + [0]) + 1
    if collection == "shopping" and not item.get("area"):
        item["area"] = (s.get("shopAreas") or ["כללי"])[0]
    if collection == "budget" and not item.get("section"):
        item["section"] = (s.get("budgetSections") or [{"id": "once"}])[0]["id"]

    s.setdefault(collection, []).append(item)
    _save(s)
    return _ok("נוסף בהצלחה", {"item": item})


@mcp.tool()
def update_item(collection: str, item_id: str, fields: str) -> str:
    """מעדכן פריט קיים לפי המזהה שלו. fields הוא אובייקט JSON עם
    השדות שברצונך לשנות בלבד, למשל: {"done": true}"""
    if collection not in COLLECTIONS:
        return _ok("אוסף לא מוכר. אפשרויות: " + ", ".join(COLLECTIONS))
    meta = COLLECTIONS[collection]
    try:
        data = json.loads(fields)
    except json.JSONDecodeError as e:
        return _ok("ה-JSON בשדה fields אינו תקין: " + str(e))

    for key, allowed in meta["enums"].items():
        if key in data and data[key] not in allowed:
            return _ok('ערך לא חוקי בשדה "' + key + '". מותר: ' + ", ".join(allowed))

    s = _load()
    item = _find(s.get(collection, []), item_id)
    if not item:
        return _ok("לא נמצא פריט עם המזהה הזה. אפשר לאתר אותו עם list_items.")
    before = dict(item)
    item.update({k: v for k, v in data.items() if k in meta["fields"]})
    _save(s)
    return _ok("עודכן בהצלחה", {"before": before, "after": item})


@mcp.tool()
def delete_item(collection: str, item_id: str) -> str:
    """מוחק פריט לפי מזהה. פעולה זו אינה הפיכה, לכן כדאי לוודא מול
    המשתמש לפני מחיקה של משהו שלא הוא ביקש למחוק במפורש."""
    if collection not in COLLECTIONS:
        return _ok("אוסף לא מוכר. אפשרויות: " + ", ".join(COLLECTIONS))
    s = _load()
    items = s.get(collection, [])
    item = _find(items, item_id)
    if not item:
        return _ok("לא נמצא פריט עם המזהה הזה.")
    s[collection] = [x for x in items if x.get("id") != item_id]
    _save(s)
    return _ok("נמחק", {"deleted": item})


@mcp.tool()
def search(query: str) -> str:
    """חיפוש חופשי בכל האוספים בבת אחת. מחזיר את ההתאמות מקובצות
    לפי אוסף, כולל המזהים – שימושי לפני עדכון או מחיקה."""
    s = _load()
    needle = _norm(query.strip())
    if not needle:
        return _ok("צריך מילת חיפוש.")
    results = {}
    for name in COLLECTIONS:
        hits = [x for x in s.get(name, []) if _matches(x, needle)]
        if hits:
            results[name] = hits
    total = sum(len(v) for v in results.values())
    return json.dumps({"query": query, "total": total, "results": results},
                      ensure_ascii=False, indent=1)


@mcp.tool()
def update_settings(fields: str) -> str:
    """מעדכן את הגדרות המעבר. שדות אפשריים:
    moveDate (בפורמט YYYY-MM-DD), fromAddr, toAddr, movers.
    למשל: {"moveDate": "2026-09-15", "toAddr": "העבודה 28, עפולה"}"""
    try:
        data = json.loads(fields)
    except json.JSONDecodeError as e:
        return _ok("ה-JSON אינו תקין: " + str(e))
    allowed = ["moveDate", "fromAddr", "toAddr", "movers"]
    s = _load()
    s.setdefault("settings", {})
    changed = {}
    for k in allowed:
        if k in data:
            s["settings"][k] = data[k]
            changed[k] = data[k]
    if not changed:
        return _ok("לא צוין אף שדה מוכר. אפשרויות: " + ", ".join(allowed))
    _save(s)
    return _ok("ההגדרות עודכנו", {"changed": changed})


if __name__ == "__main__":
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    if transport == "streamable-http":
        # ריצה כשרת HTTP מרוחק (למשל ב-Cloud Run), במקום stdio מקומי.
        # ה"סוד" הוא לא סיסמה בכותרת אלא חלק מנתיב ה-URL עצמו: מי שלא
        # מכיר את הטוקן לא יכול בכלל להגיע לנתיב הזה. חובה להגדיר
        # AFULA_MCP_TOKEN לפני הרצה בענן.
        token = os.environ.get("AFULA_MCP_TOKEN", "").strip()
        if not token:
            raise RuntimeError(
                "יש להגדיר את משתנה הסביבה AFULA_MCP_TOKEN (מחרוזת אקראית "
                "וארוכה, למשל תוצאה של: openssl rand -hex 32) לפני הרצה עם "
                "MCP_TRANSPORT=streamable-http."
            )
        port = int(os.environ.get("PORT", "8080"))
        path = "/mcp/" + token
        print(f"Listening on 0.0.0.0:{port}{path}", flush=True)
        mcp.run(transport="streamable-http", host="0.0.0.0", port=port,
                streamable_http_path=path)
    else:
        mcp.run()
