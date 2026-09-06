# Contribuir

Proyecto privado e independiente. No copiar código o datos de otros repositorios sin una decisión de replicación limpia revisada por el propietario.

Trabajar en `feature/*` o `fix/*`; main recibe PRs pequeños. Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`. No force push a main. La protección técnica depende del plan de GitHub y debe verificarse, no suponerse.

Cada PR explica problema y comportamiento final, incluye alcance, criterios de aceptación, pruebas realizadas, riesgos y pasos de validación. No marcar tests pendientes como aprobados. Revisar arquitectura antes de implementar producto; consultar [roadmap](ROADMAP.md).

No incluir credenciales, correos reales, datos bancarios, fotos o exportaciones personales en fixtures. Usar datos sintéticos; anonimizaciones de correo requieren autorización y revisión. La prueba de documentación se ejecuta con `python scripts/check_docs.py`. Los comandos de build/test del producto se fijarán en P01 junto al runtime y lockfile; no existen todavía.
