# Backlog, historias y aceptación

> Baseline de fase 0. Las aprobaciones y el orden de ejecución actuales están en [decisiones vigentes](09-aprobacion-ejecucion.md); prevalecen sobre estados pendientes históricos de este documento.
Estado: propuesto. P0 necesario para beta, P1 siguiente valor, P2 posterior. Cada historia debe enlazar implementación y evidencia al cerrarse; hoy ninguna se declara implementada.

| ID / prioridad / versión | Historia de usuario | Criterios observables de aceptación | PR |
| --- | --- | --- | --- |
| H01 / P0 / MVP | Como usuario quiero iniciar sesión con Google o email verificado para proteger mis datos | Email no verificado no sincroniza; token inválido devuelve 401; linking requiere autenticar ambas cuentas; UI permite MFA opcional | P05 |
| H02 / P0 / MVP | Quiero bloquear y revocar un dispositivo | Biometría/PIN protege clave local; revocado no escribe online; sesión offline muestra límite; logout no expone datos al siguiente usuario | P03,P05 |
| H03 / P0 / MVP | Quiero registrar cuentas y categorías | Moneda obligatoria; saldo inicial no cuenta como ingreso; cuenta archivada preserva historial; FK a otro usuario rechazada | P07 |
| H04 / P0 / MVP | Quiero registrar gasto/ingreso exacto | S/ 0,10 + S/ 0,20 = S/ 0,30; fecha/moneda/cuenta requeridas; asientos balanceados; error conserva formulario | P06,P08 |
| H05 / P0 / MVP | Quiero transferir, pagar y reembolsar sin duplicar gasto | Transferencia propia neto0 en ingreso/gasto; pago tarjeta reduce pasivo/caja; reembolso parcial enlaza original; ajuste se distingue de salario | P06,P13 |
| H06 / P0 / MVP | Quiero guardar sin internet y recuperar mis cambios | Crear offline, cerrar/reabrir y reconectar produce una operación; commit sin respuesta y 5 reintentos no duplican; clave perdida no se ignora | P08–P10 |
| H07 / P0 / MVP | Quiero resolver cambios de dos dispositivos | Ediciones simultáneas dan conflicto409; se ven ambas versiones; ningún importe se sobrescribe silenciosamente; snapshot conserva pendientes | P10 |
| H08 / P0 / MVP | Quiero ver cuánto entra, sale y queda | Dashboard concilia con operaciones filtradas; distingue monedas, ahorro y balance; datos pendientes/locales tienen etiqueta; vacío no implica cero confirmado | P11 |
| H09 / P0 / MVP | Quiero encontrar y exportar movimientos | Todos los rangos del PDF, cuenta/tarjeta/categoría/texto; límites correctos en zona IANA; CSV contiene sólo selección propia y neutraliza fórmulas en texto | P11,P12 |
| H10 / P0 / MVP | Quiero conocer saldo, línea y fechas de tarjetas | Mostrar total/mínimo/pago del periodo separados; desconocido no es0; pagos no repiten gasto; línea agotada y fecha fin de mes correctas | P13 |
| H11 / P0 / MVP | Quiero controlar presupuesto del mes | Único por categoría/mes/moneda; reembolso modifica gasto neto; transferencia no consume presupuesto; exceso visible en texto | P14 |
| H12 / P0 / MVP | Quiero conectar Gmail conscientemente | Login no conecta Gmail; pantalla explica readonly/rango; denegar permite uso manual; revocar cancela trabajos y no vuelve a leer | P15 |
| H13 / P0 / MVP | Quiero revisar consumos BCP importados | Fixture soportada extrae importe/moneda/fecha; desconocida va a revisión; dos mensajes del mismo consumo concilian; dos compras iguales distintas permanecen | P16,P17 |
| H14 / P0 / MVP | Quiero que errores no pierdan importaciones | Push duplicado/fuera de orden, 429 y cursor404 se recuperan; cursor avanza sólo tras persistencia; último éxito/cobertura visibles | P17 |
| H15 / P0 / MVP | Quiero controlar exportación y borrado de mi información | Reautenticación para acciones sensibles; exportación de otro usuario denegada; borrado cancela conexiones/jobs y respeta ciclo de backups | P18 |
| H16 / P0 / MVP | Quiero usar web/móvil con accesibilidad | Teclado, lector pantalla, zoom200%, tema claro/oscuro y mínimo táctil44px; no gesto obligatorio; pruebas físicas Android/iOS | P02,P19 |
| H17 / P1 / V2 | Quiero ver cuánto debo y cuánto me deben | Dirección pagar/cobrar; capital/interés/penalidad separados; abonos reducen componente correcto; términos sin confirmar no generan interés inventado | P20 |
| H18 / P1 / V2 | Quiero simular amortización | Mostrar tasa/periodo/método/fecha y supuestos; no aplicar escenario a libro real; cuotas y último redondeo concilian con principal | P20 |
| H19 / P1 / V2 | Quiero calcular aportes a metas | Aporte semanal/quincenal/mensual usa fecha restante y saldo asignado; meta vencida pide ajuste; mover ahorro no es ingreso nuevo | P21 |
| H20 / P1 / V2 | Quiero identificar servicios recurrentes | Cargos compatibles generan sugerencia; confirmar periodicidad; cancelar no borra histórico; proyección anual etiquetada | P22 |
| H21 / P1 / V2 | Quiero avisos de próximos pagos | Permiso opcional; importe oculto por defecto; quiet hours por zona; cambio de fecha cancela aviso anterior; sin push queda en app | P23 |
| H22 / P1 / V2 | Quiero sumar otros bancos y exportar Excel/PDF | Cada banco tiene fixtures versionadas; parser desconocido no confirma; exportaciones concilian con CSV y filtros | P24,P25 |
| H23 / P1 / V2 | Quiero comparar periodos y proyectar | Comparaciones identifican periodos parciales; proyección muestra método y cobertura; sin datos suficientes no extrapola cifra falsa | P25 |
| H24 / P2 / V3 | Quiero consultar mis finanzas en lenguaje natural | Respuesta incluye periodo, moneda y agregados usados; pruebas A/B, prompt injection y permisos; ninguna acción de pago | P27 |

## Definición de listo

Historia con alcance, contrato, reglas, estados UX, dependencias, privacidad y prueba de aceptación definidos. Datos de prueba sintéticos o anonimizados con autorización. Si hay integración externa, identificar credenciales/configuración que el propietario debe realizar; no pedir claves bancarias.

## Definición de terminado

Código revisado, lint/build/tests pertinentes aprobados, evidencia de aceptación adjunta, documentación actualizada y riesgos residuales registrados. Para mobile, E2E web no sustituye instalación real; para seguridad, ocultar botones no sustituye rechazo backend. Para Gmail, mock no acredita compatibilidad con correos reales. No cerrar una historia sólo porque existe una pantalla.
