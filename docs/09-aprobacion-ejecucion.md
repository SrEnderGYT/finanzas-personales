# Aprobación de fase 0 y límites de ejecución

El propietario aprobó explícitamente continuar sólo en SrEnderGYT/finanzas-personales, sin copiar proyectos anteriores ni usar datos financieros reales. Esta instrucción posterior reemplaza los estados pendientes y el requisito de repositorio privado del PDF; el PDF permanece como referencia histórica.

## Decisiones aprobadas

| ID  | Decisión vigente                                              |
| --- | ------------------------------------------------------------- |
| D01 | Angular Web + Ionic/Capacitor Mobile                          |
| D02 | TypeScript + NestJS/Fastify + PostgreSQL                      |
| D03 | Core manual probado antes de Gmail                            |
| D04 | Offline-first implementado progresivamente                    |
| D05 | Beta privada de la aplicación antes de publicación definitiva |

La aprobación tecnológica no aprueba automáticamente costos cloud, política de retención, publicación de datos ni obtención de credenciales. Las cifras de retención del diseño siguen propuestas. Repositorio y previews DEMO públicos no hacen públicos los datos o la futura infraestructura real.

## Continuación autorizada después de P03

El 06/09/2026, después de entregar P03 con preview, APK y evidencias, el propietario indicó: «continua sin bloqueos continuos». Esta instrucción permite continuar con P04 y resolver los pasos rutinarios sin reiterar solicitudes de aprobación. Los PR grandes continúan abiertos para revisión; no se interpreta como autorización de merge automático, publicación de datos, costos cloud ni acceso Gmail anticipado. El siguiente bloque es backend, PostgreSQL, User y RLS, seguido por autenticación y core según el orden acordado.

## Puertas de revisión originales

P01 herramientas/workspace/calidad/CI; P02 diseño y shells con dashboard DEMO; P03 prototipo de IndexedDB/SQLite cifrados y seguridad local. La pausa de P03 ya fue presentada y la continuación fue autorizada arriba. P04–P14 construyen la beta manual; otra puerta antes de Gmail. No hacer merge automático de cambios grandes: los cambios se entregan mediante PR, apilados cuando dependan de un PR abierto.

## Publicación: evidencia previa

Auditado HEAD `a89077b203f7029d01691d97cf80b9fd8b2daf8f`, los tres commits alcanzables y árbol de trabajo. Gitleaks 8.30.1 con checksum de distribución verificado: escaneo `git --all` y `dir`, ambos sin hallazgos. Revisión de todos los nombres de archivos e inventario Git, autores noreply, texto completo de las diez páginas del PDF, metadatos y adjuntos (ninguno), además de búsqueda de datos financieros/contactos reales proporcionados en la conversación: sin hallazgos. Referencias de arquitectura a tokens/contraseñas son documentación, no valores secretos.

No había .env, tokens, API keys, cuentas de servicio, credenciales Google/Firebase/PostgreSQL, claves privadas, certificados, keystores o finanzas personales versionadas. Esta revisión describe su alcance y resultado, no garantiza ausencia universal de secretos futuros.

La API confirmó `visibility: public`, `private: false`, propietario SrEnderGYT. Protección main aplicada: PR obligatorio, check Integridad documental, conversaciones resueltas, sin force push ni eliminación, administradores incluidos. Único repositorio modificado: finanzas-personales. Secretos futuros irán a GitHub Secrets/Secret Manager/entorno seguro, nunca a Git.
