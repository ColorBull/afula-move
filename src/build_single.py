# -*- coding: utf-8 -*-
"""
בונה קובץ HTML אחד ועצמאי לאירוח (GitHub Pages / כל שרת סטטי).

בניגוד ל-build_artifact.py, כאן הסנכרון מול Firebase נשאר פעיל –
האתר מוגש ב-https ולכן ההתחברות והסנכרון עובדים כרגיל.

הרצה:  python build_single.py
פלט:   index-single.html
"""
import re
import pathlib
from datetime import datetime

HERE = pathlib.Path(__file__).parent
OUT = HERE / "index-single.html"

# חותמת הבנייה מוצגת בסרגל העליון ליד מצב הסנכרון, כדי שאפשר יהיה לראות
# במבט אחד אם הדפדפן מציג את הגרסה האחרונה או עותק ישן מהמטמון.
STAMP = datetime.now().strftime("%Y-%m-%d | %H:%M")

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700'
    '&display=swap" rel="stylesheet">'
)


def read(name):
    return (HERE / name).read_text(encoding="utf-8")


def body_markup(html):
    m = re.search(r"<body>(.*?)</body>", html, re.S)
    if not m:
        raise SystemExit("index.html: לא נמצא <body>")
    return re.sub(r"<script\b[^>]*>.*?</script>\s*", "", m.group(1), flags=re.S).strip()


def main():
    markup = body_markup(read("index.html"))
    icon = read("icon.svg").strip()
    # האייקון מוטמע כ-data URI כדי שהקובץ יישאר עצמאי לגמרי
    import base64
    icon_uri = "data:image/svg+xml;base64," + base64.b64encode(
        icon.encode("utf-8")
    ).decode("ascii")

    doc = f"""<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>ניהול מעבר דירה</title>
<meta name="theme-color" content="#0f766e">
<meta name="description" content="תכנון וניהול מעבר דירה: משימות, קניות, ארגזים, תקציב ושירותים">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="ניהול מעבר דירה">
<link rel="icon" href="{icon_uri}">
<link rel="apple-touch-icon" href="{icon_uri}">
{FONTS}
<style>
{read("styles.css")}
</style>
</head>
<body>

{markup}

<script>
window.BUILD_STAMP = "{STAMP}";
</script>
<script>
{read("data.js")}
</script>
<script>
{read("app.js")}
</script>
</body>
</html>
"""

    # ‎ARTIFACT_MODE‎ לא מוגדר כאן, ולכן הסנכרון מול Firebase פעיל
    if "ARTIFACT_MODE = true" in doc:
        raise SystemExit("שגיאה: מצב Artifact דלוף לקובץ המתארח")
    if 'src="./' in doc or 'href="./' in doc:
        raise SystemExit("שגיאה: נשארה הפניה לקובץ חיצוני")

    OUT.write_text(doc, encoding="utf-8")
    kb = len(doc.encode("utf-8")) / 1024
    print(f"נבנה: {OUT.name}  ({kb:.1f} KB)  – סנכרון Firebase פעיל")


if __name__ == "__main__":
    main()
