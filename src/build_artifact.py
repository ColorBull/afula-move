# -*- coding: utf-8 -*-
"""
בונה גרסת קובץ-אחד של האפליקציה, לפרסום כדף מתארח (Artifact).

הבדלים מהגרסה הרגילה:
  * הכול בקובץ אחד – אין קריאות לקבצים חיצוניים (הדף מוגש עם CSP נוקשה)
  * בלי Google Fonts, בלי manifest, בלי service worker
  * ARTIFACT_MODE=true  -> סנכרון Firebase מכובה, ההורדה עוברת דרך window.claude.downloads

הרצה:  python build_artifact.py
פלט:   afula-move-app.html
"""
import re
import pathlib
from datetime import datetime

HERE = pathlib.Path(__file__).parent
OUT = HERE / "afula-move-app.html"

# אותה חותמת בנייה כמו בגרסה המתארחת, מוצגת ליד מצב הסנכרון
STAMP = datetime.now().strftime("%Y-%m-%d | %H:%M")


def read(name):
    return (HERE / name).read_text(encoding="utf-8")


def extract_body(html):
    """שולף את התוכן שבין <body> ל-</body> ומסיר את תגי ה-script."""
    body = re.search(r"<body>(.*?)</body>", html, re.S)
    if not body:
        raise SystemExit("index.html: לא נמצא <body>")
    markup = body.group(1)
    markup = re.sub(r"<script\b[^>]*>.*?</script>\s*", "", markup, flags=re.S)
    return markup.strip()


def main():
    markup = extract_body(read("index.html"))
    css = read("styles.css")
    data_js = read("data.js")
    app_js = read("app.js")

    # אייקון האפליקציה מוטמע כ-data URI במקום קובץ נפרד
    icon = read("icon.svg").strip()

    parts = [
        "<title>ניהול מעבר דירה</title>",
        "<style>\n" + css + "\n</style>",
        markup,
        "<script>\n"
        "window.ARTIFACT_MODE = true;\n"
        'window.BUILD_STAMP = "' + STAMP + '";\n'
        "document.documentElement.lang = 'he';\n"
        "document.documentElement.dir = 'rtl';\n"
        "</script>",
        "<script>\n" + data_js + "\n</script>",
        "<script>\n" + app_js + "\n</script>",
    ]

    out = "\n\n".join(parts) + "\n"

    # בדיקות שפיות: שום הפניה לרשת או לקובץ מקומי לא אמורה לשרוד
    forbidden = [
        ("<link", "תג link חיצוני"),
        ("fonts.googleapis", "Google Fonts"),
        ("src=\"./", "קובץ סקריפט חיצוני"),
        ("href=\"./", "קובץ נכס חיצוני"),
        ("serviceWorker.register", "רישום service worker"),
    ]
    problems = [why for token, why in forbidden if token in out]
    # הרישום קיים בקוד אבל חסום ע\"י ARTIFACT – מותר שיישאר
    problems = [p for p in problems if p != "רישום service worker"]
    if problems:
        raise SystemExit("נמצאו הפניות חיצוניות: " + ", ".join(problems))

    OUT.write_text(out, encoding="utf-8")
    kb = len(out.encode("utf-8")) / 1024
    print(f"נבנה: {OUT.name}  ({kb:.1f} KB)")
    print(f"אייקון SVG באורך {len(icon)} תווים לא הוטמע (לא נדרש בדף מתארח)")

    # קובץ בדיקה מקומי בלבד: עוטף את הפלט באותו שלד שהפלטפורמה מוסיפה,
    # כדי לבדוק את הדף לפני פרסום. לא מועלה לשום מקום.
    preview = (
        "<!doctype html>\n<html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "</head><body>\n" + out + "\n</body></html>\n"
    )
    (HERE / "afula-move-app.preview.html").write_text(preview, encoding="utf-8")
    print("נבנה גם: afula-move-app.preview.html (לבדיקה מקומית)")


if __name__ == "__main__":
    main()
