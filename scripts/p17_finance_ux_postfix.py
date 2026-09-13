from pathlib import Path

path = Path("packages/ui/src/gmail-screen.ts")
text = path.read_text()
broken = "const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });"
fixed = "const blob = new Blob([String.fromCharCode(0xfeff) + lines.join(String.fromCharCode(10))], { type: 'text/csv;charset=utf-8' });"
if broken not in text:
    raise SystemExit("generated CSV blob anchor not found")
path.write_text(text.replace(broken, fixed, 1))
