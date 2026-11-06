"""Inline src/dfam-engine.js into src/page.tpl.html -> index.html."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
tpl = (root / "src/page.tpl.html").read_text()
eng = (root / "src/dfam-engine.js").read_text()
html = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n" + tpl.replace("/*__ENGINE__*/", eng).replace("</style>\n", "</style>\n</head>\n<body>\n", 1) + "\n</body>\n</html>\n"
(root / "index.html").write_text(html)
print("wrote index.html")
