from pathlib import Path

path = Path('packages/ui/src/detected-finances-screen.ts')
text = path.read_text()
count = text.count('\x08')
if count != 10:
    raise SystemExit(f'expected 10 backspace control characters, found {count}')
path.write_text(text.replace('\x08', r'\b'))
