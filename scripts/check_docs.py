"""Check phase-0 artifacts and local Markdown links; no product tests claimed."""
from pathlib import Path
import re
import sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "README.md", "ARCHITECTURE.md", "ROADMAP.md", "SECURITY.md",
    "CONTRIBUTING.md", "CHANGELOG.md", "docs/01-producto.md",
    "docs/02-datos.md", "docs/03-gmail.md", "docs/04-clientes-sync.md",
    "docs/05-diseno.md", "docs/06-backlog.md", "docs/07-calidad-entrega.md",
    "docs/08-trazabilidad.md", "docs/referencia/Plan_Maestro_Codex_App_Finanzas.pdf",
    "apps/web/README.md", "apps/mobile/README.md", "packages/shared/README.md",
    "backend/README.md", "infra/README.md", ".github/workflows/docs.yml",
]
ENTITIES = ["User", "Transaction", "Account", "Card", "Category", "Budget", "Debt",
            "DebtPayment", "SavingsGoal", "Subscription", "Merchant",
            "FinancialInstitution", "AutomationRule", "EmailImport", "Notification",
            "UserPreference", "AuditLog"]
# The PDF lists 17 distinct names, not 18; count exactly what it specifies.

def check():
    errors = []
    for name in REQUIRED:
        path = ROOT / name
        if not path.is_file() or not path.stat().st_size:
            errors.append(f"Missing/empty: {name}")
    for path in ROOT.rglob("*.md"):
        if ".git" in path.parts:
            continue
        content = path.read_text(encoding="utf-8")
        for link in re.findall(r"\[[^\]\n]+\]\(([^)]+)\)", content):
            target = link.split("#", 1)[0].strip("<>")
            if not target or re.match(r"^[a-zA-Z]+:", target):
                continue
            resolved = (path.parent / unquote(target)).resolve()
            if not resolved.is_relative_to(ROOT) or not resolved.exists():
                errors.append(f"Broken local link: {path.relative_to(ROOT)} -> {target}")
    trace = (ROOT / "docs/08-trazabilidad.md").read_text(encoding="utf-8")
    for number in range(1, 23):
        key = f"E{number:02}"
        if not re.search(rf"^\| {key} \|", trace, re.M):
            errors.append(f"Missing deliverable: {key}")
    model = (ROOT / "docs/02-datos.md").read_text(encoding="utf-8")
    for entity in ENTITIES:
        if not re.search(rf"^\| {entity} \|", model, re.M):
            errors.append(f"Missing entity: {entity}")
    return errors

if __name__ == "__main__":
    failures = check()
    if failures:
        print("\n".join(failures), file=sys.stderr)
        sys.exit(1)
    print(f"PASS: {len(REQUIRED)} required files, 22 deliverables, "
          f"{len(ENTITIES)} required entities and local Markdown links.")
