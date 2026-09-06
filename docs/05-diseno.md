# Sistema de diseño y wireframes textuales

Estado: especificación original propuesta; no son pantallas implementadas. Referencias conceptuales de claridad y calma del PDF, sin copiar interfaces.

## Tokens

| Token | Claro | Oscuro propuesto | Uso |
| --- | --- | --- | --- |
| Primary | #635BFF | #A5A0FF | Acción principal/foco |
| Secondary | #7C3AED | #C4B5FD | Acento secundario |
| Accent | #14B8A6 | #2DD4BF | Datos/identidad, no texto pequeño sin validar |
| Success | #22C55E | #4ADE80 | Estado con icono y texto |
| Warning | #F59E0B | #FBBF24 | Aviso con etiqueta |
| Danger | #EF4444 | #FCA5A5 | Error/destrucción |
| Dark | #111827 | #111827 | Superficies de contraste |
| Background | #F8FAFC | #0B1120 | Fondo |
| Surface | #FFFFFF | #111827 | Tarjetas/paneles |
| Text | #0F172A | #F1F5F9 | Texto principal |
| Text Secondary | #64748B | #CBD5E1 | Metadatos |

Los valores claros preservan la paleta del PDF; los oscuros son propuesta. Medir contrastes reales antes de aprobar componentes: success/warning/accent no sirven automáticamente como texto sobre blanco. Para botones primary, texto blanco sólo si cumple contraste medido; alternativamente oscurecer token funcional manteniendo identidad.

Tipografía: system-ui, alternativa Inter autoalojada si se decide incluirla; cuerpo 16/24 px, etiquetas 14/20, títulos 24/32, saldo 32/40 con números tabulares. Escala de espacios 4, 8, 12, 16, 24, 32, 48. Radios 8 inputs, 12 tarjetas, 20 sheets. Sombras sutiles sólo para elevación, borde visible para límites; gradiente sólo en contexto ornamental sin afectar legibilidad.

Grid escritorio 12 columnas con contenido máximo 1440 px; tablet 8; móvil 4 y margen 16. Breakpoints propuestos <768 móvil, 768–1199 tablet, >=1200 escritorio; comprobar zoom 200%, paisaje y ancho 320 CSS px. Sidebar 240 px colapsable, panel detalle 360–440 px. Iconos SVG consistentes de 20/24 px, stroke uniforme; etiqueta accesible y no usar sólo color.

Motion 120–200 ms para cambios de estado; respetar reduced-motion y evitar animar importes continuamente. Skeleton sólo mientras carga; skeleton de gráficos sin cifras falsas. Estados vacíos tienen explicación y una acción. Light/Dark/System sigue SO por defecto y persiste preferencia; cambio de tema no recarga datos.

## Componentes y accesibilidad

Button primary/secondary/destructive con loading/disabled/focus; MoneyInput con moneda fija visible, validación y formato local; AccountPicker; DateRangePicker; AmountCard; TransactionRow; CategoryBadge; SyncStatus; Alert; BottomSheet; Dialog; EmptyState; Skeleton; Chart con tabla equivalente. Formularios conservan datos tras errores; mensaje específico junto a campo y resumen navegable.

Objetivo WCAG 2.2 AA como mejora propuesta sobre accesibilidad genérica del PDF: contraste texto normal >=4.5:1, texto grande >=3:1, componentes/foco distinguibles, teclado completo, lectura lógica y etiquetas. Mínimo táctil propio 44x44 px con separación; nada depende exclusivamente de swipe/haptic/color. Cifras con formato es-PE, moneda explícita y opción de ocultar importes. Estado de sync con aria-live moderado, sin leer cada fila al sincronizar.

## Wireframe 1 · Inicio escritorio

```text
┌ Sidebar ───────┬ Inicio             [Mes actual ▾] [Ocultar importes] ┐
│ Inicio        │ [Saldo PEN] [Ingresos] [Gastos netos] [Balance]       │
│ Movimientos   │ [Ahorro registrado] [Estado: confirmado / pendiente] │
│ Cuentas       │ Flujo de caja (8 columnas) │ Próximos pagos (4)      │
│ Tarjetas      │ gráfico + tabla accesible │ fecha, moneda, estado   │
│ Presupuestos  │ Distribución categorías   │ Utilización tarjetas    │
│ …             │ Últimos movimientos con filtros y panel de detalle  │
│ Configuración │ Última sincronización · cobertura · revisar 2 avisos │
└───────────────┴──────────────────────────────────────────────────────┘
```

Cada indicador abre su listado con el mismo periodo. Sin tasa USD, segunda sección USD; no un total mezclado. Sin datos: «Registra tu primera cuenta»; error: «No pudimos actualizar. Datos guardados hasta…» y Reintentar.

## Wireframe 2 · Inicio móvil

```text
[Saludo]                            [Ocultar] [Avisos]
[Saldo por moneda]                 [Mes actual ▾]
[Ingresos] [Gastos]                 [Balance]
[Presupuesto usado ━━━━━ / límite]
[Próximos pagos: fecha · tarjeta · importe]
[Actividad reciente: 3 filas → Ver movimientos]
[Sin conexión · 2 operaciones por sincronizar]
[Inicio] [Movimientos] [( + )] [Análisis] [Perfil]
```

Tocar + abre sheet con tipos. Seleccionar gasto: Importe+moneda → cuenta/tarjeta → categoría → fecha → nota opcional → Guardar. Confirmación «Guardado en este dispositivo» offline; puede deshacer por comando de reversión/cancelación según estado, no borrado opaco.

## Wireframe 3 · Movimientos y detalle

Escritorio: barra búsqueda, chips de filtros, tabla fecha/comercio/categoría/cuenta/importe/estado; seleccionar fila abre lateral con procedencia, importación y auditoría resumida. Móvil: lista por día y filtros en sheet; detalle en pantalla propia. Acciones: editar clasificación, corregir importe mediante flujo revisable, marcar coincidencia con Gmail, exportar selección. Estado sin resultados ofrece limpiar filtros, no crear movimientos falsos.

## Wireframe 4 · Cuentas, tarjetas y presupuesto

Cuentas agrupa saldos por moneda; alta pide nombre/tipo/moneda/saldo inicial/fecha del saldo. Tarjeta muestra deuda confirmada, pendientes, línea, utilización, próximo vencimiento, pago del periodo y mínimo cuando informados; desconocido se ve «Sin confirmar». Presupuesto muestra consumido, restante y días del mes; exceso se expresa en texto además de color. Acción contextual permite registrar pago a tarjeta sin categorizarlo como nuevo gasto.

## Wireframe 5 · Gmail y revisión

Automatizaciones: conexión desconectada/conectada/atención, cuenta enmascarada, alcance, rango y última importación; botones Conectar/Revocar. Revisión: aviso «Falta confirmar cuenta», campos sugeridos, evidencia resumida, posible coincidencia, opciones Aceptar, Vincular existente, Corregir, Rechazar. Revocar informa que los registros aceptados permanecen y ofrece gestionarlos por separado.

## Wireframe 6 · Conflicto, sesión y V2

Conflicto: «Este movimiento cambió en otro dispositivo»; columnas «Tu cambio» y «Servidor», versión/fecha, conservar servidor o revisar nuevo cambio; nunca elegir automáticamente el mayor importe. Perfil: tema, idioma, moneda, bloqueo, sesiones, exportación/borrado e integraciones. V2 Deudas: Por pagar/Por cobrar, capital, intereses confirmados, abonos y próximo compromiso; metas muestran aporte necesario y supuestos; suscripciones indican estimación/confirmación. Un cobro por recibir no aumenta efectivo hasta registrar abono.
