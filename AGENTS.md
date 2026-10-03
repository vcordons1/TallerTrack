# TallerTrack — instrucciones para agentes

Este archivo dice **cómo se trabaja** en TallerTrack. No describe el estado del proyecto: eso vive en `docs/project-state.md` y cambia con cada ticket. Si algo de aquí contradice al estado real, gana `project-state.md` y la discrepancia se reporta.

## 1. Identidad

TallerTrack es un sistema móvil para la gestión y trazabilidad operativa de un taller automotriz (MVP académico, un solo taller).

Stack: React Native + Expo + JavaScript → API REST Node.js + Express → Oracle Database XE.

La implementación avanza por tickets verticales (`TT-0XX`), cada uno aceptado en un teléfono real. El dominio está clarificado: no se reinterpretan requisitos, reglas, contratos ni gates en silencio.

## 2. Fuentes y precedencia

Ante conflicto, este orden manda (de mayor a menor):

1. `docs/project-specification.md` (requisitos y reglas de negocio)
2. `docs/software-architecture.md` y `docs/TallerTrack_Arquitectura_Base_de_Datos.md`, leídos juntos
3. `docs/api-contract.md`
4. decisiones aceptadas en `docs/decisions/`
5. migraciones vigentes
6. código y pruebas (evidencia de lo implementado, no de lo correcto)
7. `docs/project-state.md`
8. vault de Obsidian
9. REVIEW_HANDOFF y resúmenes de conversaciones

Reglas:

- Una fuente inferior no cambia una superior. Si la contradice: sigue la superior, no lo resuelvas en silencio y regístralo como discrepancia.
- Un ticket tampoco cambia una fuente superior. Si el ticket pide algo que contradice el contrato (un código de error, un campo, un resultado esperado), sigue el contrato y repórtalo.
- Una idea en una nota no es requisito hasta que conste en decisión, contrato, `project-state.md`, migración o pruebas.
- `docs/project-specification.pdf` solo se consulta para verificar el original o material visual.

Lee solo las secciones necesarias para la tarea. No cargues la documentación completa por defecto.

## 3. Memoria del proyecto

| Dónde | Qué guarda | Cuándo se actualiza |
|---|---|---|
| `docs/project-state.md` | Estado actual compacto: migración, capacidades aceptadas, usuarios y datos de prueba, gates, limitaciones, siguiente paso | Al cerrar cada ticket que cambie algo de eso |
| `docs/decisions/` | Razones de decisiones significativas (seguir `docs/decisions/README.md`) | Cuando una decisión se acepta |
| `docs/lecciones.md` | Errores ya ocurridos y cómo evitarlos | Al cerrar cada ticket (§10) |
| Vault `C:\Users\V1k70\Personal\TallerTrack memory` | Historia, contexto y razonamiento entre sesiones | Al cerrar cada ticket |
| Código, migraciones y pruebas | Verdad de lo implementado | Durante el ticket |

`project-state.md` es compacto y actual, no cronológico. La historia va al vault.

Otros mecanismos de memoria o de instrucciones para agentes. No son fuentes (§2); si contradicen a este archivo, gana este archivo y se corrigen:

| Dónde | Qué es | Regla |
|---|---|---|
| Vault: nota `00-sistema/Guia de memoria` | Reglas de uso del vault | No repite reglas de este archivo; remite a él |
| Servidor MCP `tallertrack-memory` | Instrucciones que el servidor da al agente al conectarse | Las mantiene el propietario; deben coincidir con la `Guia de memoria` |
| `.codex/task-handoff.template.md` (versionado) | Antigua plantilla de memoria temporal de Codex | Solo remite a §12 y §13; no define otro formato de handoff |
| `.codex/config.toml` | Configuración de Codex (memorias desactivadas) | — |
| `.data/claude-project-context.md` (ignorado por git) | Instantánea de contexto para planear, corte tras TT-027 | Desactualizada; no se usa como estado |
| `docs/tickets/plantilla.md` | Estructura de un ticket nuevo | Se copia al redactar cada ticket |

Si aparece un mecanismo nuevo de memoria o de instrucciones para agentes, se añade a esta tabla.

Una semántica de producto o de negocio nunca se marca como aceptada sin acuerdo explícito del dueño del proyecto.

## 4. Protocolo de ticket

### 4.1 Fase de plan (sin implementar)

Todo ticket empieza solo con plan. No modifiques archivos hasta que el plan sea aprobado.

Lectura mínima obligatoria, en este orden:

1. este `AGENTS.md` y cualquier `AGENTS.md` de subcarpeta aplicable;
2. `docs/project-state.md` completo;
3. `docs/lecciones.md` completo;
4. en el vault: `00 - TallerTrack - Inicio`, `Estado actual` y la nota de cierre del ticket anterior;
5. las secciones de las fuentes canónicas que el ticket cite;
6. el código y las pruebas que el ticket vaya a tocar.

Todo lo demás (otras notas, ADR, otros módulos) se lee solo si el ticket lo pide o si el plan lo necesita. Lo que el ticket marque como lectura obligatoria es obligatorio: si no lo lees, dilo y explica por qué.

Verificaciones de arranque (solo lectura):

- el punto de partida que declara el ticket coincide con el repositorio y la base (migración, datos, usuarios, estados). Si no coincide, repórtalo en el plan antes de proponer nada;
- no hay una API corriendo en segundo plano (puerto 3000). Si la hay, detenla;
- línea base de grants de `TT_APP`.

Las dos últimas se hacen con `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/api-port.ps1 -Grants` (añade `-Stop` para detener una API node en el puerto 3000). Imprime la migración vigente y la huella `TT_APP=sistema:SELECT:EXECUTE:DML:roles:PKG_ORDENES`.

El plan contiene:

1. qué existe ya y qué falta, comprobado en código (no en notas);
2. respuesta a cada pregunta abierta del ticket, con la fuente que la respalda. Si una pregunta no se puede responder con las fuentes, propone opciones con su costo y **espera la decisión**;
3. discrepancias detectadas entre el ticket y las fuentes;
4. archivos a tocar, pruebas a escribir y si hace falta migración o grant (justificado);
5. cómo se hará la aceptación física.

### 4.2 Fase de implementación

- Implementa solo lo aprobado. Si aparece algo que cambia el alcance, detente y pregunta.
- Nada de refactors, renombres ni reorganización que el ticket no pida.
- No cambies dependencias ni el lockfile salvo necesidad justificada.
- Migración nueva, grant nuevo o cambio de fachada PL/SQL solo si el plan aprobado lo incluye.

### 4.3 Fase de aceptación

Ver §5. Cuando la aceptación física pase, **el código se congela**: después solo se tocan documentos.

### 4.4 Fase de cierre

1. actualizar `docs/project-state.md`;
2. actualizar el vault: `Estado actual`, nota de cierre del ticket y una nota por cada decisión o aprendizaje que deba sobrevivir;
3. añadir las lecciones nuevas a `docs/lecciones.md` (§10);
4. detener la API y cualquier proceso que hayas lanzado;
5. entregar el REVIEW_HANDOFF (§12) y detenerte para la revisión en Git.

## 5. Definición de terminado

La verificación en el teléfono es obligatoria si el ticket cambia algo que un usuario puede ver o hacer en la app, incluido un cambio solo de API que la app use. Los tickets de proceso definen su propia verificación en sus criterios de aceptación.

Un ticket que cambia la app está terminado solo si se cumple todo esto:

- la pregunta principal de aceptación del ticket se responde **sí**, demostrado en el teléfono (Samsung SM-G990E) con datos creados desde la app;
- cada pantalla nueva o modificada tiene prueba de render **y** se vio funcionando en el teléfono. Pruebas en verde sin verificación física no bastan;
- persistencia comprobada: cerrar a la fuerza, reabrir y refrescar la app conserva todo;
- las pruebas que existían siguen en verde y las nuevas cubren: caso feliz, permisos por rol, versión desactualizada, estado incompatible, idempotencia y, si hay comandos concurrentes, la carrera;
- evidencia final por API o por Oracle en **solo lectura**;
- todo lo diferido está listado como diferido, con el motivo.

«Implementado y probado» sin aceptación física es un estado intermedio, no terminado. Se reporta así.

## 6. Reglas de calidad

Estas reglas existen porque cada una ya falló antes (ver `docs/lecciones.md`).

**Contrato**

- Códigos de error, nombres de campos, estados y transiciones se copian de `docs/api-contract.md`. No se inventan, ni en código ni en mensajes.
- El resultado esperado de una carrera o de un reintento se deriva de las reglas del contrato. Si el contrato permite revisiones, dos confirmaciones simultáneas dan dos revisiones, no «gana una».

**Datos honestos**

- Ninguna respuesta devuelve valores de relleno con forma de dato real. Si un campo no se puede calcular todavía, se documenta como limitación y se avisa en `project-state.md` qué ticket futuro lo rompería.
- Ningún dato que decide el usuario (motivo, tipo de servicio, cantidades) queda fijo en la UI.

**Errores**

- Cada error de dominio que una pantalla puede recibir se muestra con un mensaje propio en español y su código. Los errores de red, timeout y resultado incierto también.
- El resultado incierto se resuelve reintentando con la misma clave de idempotencia, nunca con una clave nueva.

**Alcance**

- Distingue siempre **roto** de **fuera de alcance a propósito**. Si un ticket deja algo oculto o sin montar a propósito, lo dice en el handoff con esas palabras.
- Una prueba que fija una decisión temporal de alcance lleva un comentario que lo indica y el ticket que la levantaría. Quien levante la decisión cambia esa prueba y lo reporta.

**Datos de prueba**

- Los datos para la aceptación se crean desde la app. Nada de SQL manual, seeds, inserts ni scripts ad hoc.
- SQL solo de lectura para verificar.
- Los datos usados en una aceptación (órdenes, clientes, vehículos) no se reutilizan en la siguiente; se registran en `project-state.md`.

## 7. Arquitectura y base de datos

Dirección: app móvil → API REST → Oracle. Presentación, lógica de aplicación y persistencia separadas.

No introduzcas arquitectura nueva, capas genéricas, microservicios, CQRS, event sourcing, brokers ni estructura especulativa para funciones futuras. Implementa solo lo que el incremento actual necesita.

Conectividad: el MVP siempre está conectado. No hay modo offline, colas de escritura locales ni sincronización. Cache local solo para UX, sin cambiar la fuente de verdad.

Base de datos:

- cambios de esquema solo por migraciones versionadas (`Vxxx`), pequeñas y probadas;
- `TT_APP` opera solo mediante paquetes PL/SQL (fachadas). No recibe DML directo. Cualquier cambio de grants va en el plan y en el handoff (antes/después);
- respeta el orden global de locks de `docs/software-architecture.md`;
- errores de Oracle con el formato `-20xxx 'CODIGO [/pointer]'`.

## 8. Entorno local (Windows)

- Las suites Oracle se ejecutan desde **Git Bash**, en la raíz del repo, con `npm.cmd run test:db:integration` (las nueve). No hace falta ninguna variable de encoding (verificado en TT-030). Desde pwsh falla en i02 por el BOM (L12).
- Una suite que no se ejecutó con la configuración real (por ejemplo, `test:api:oracle` sin el TT_APP real) **no cuenta** como prueba pasada. Se reporta como no ejecutada.
- Al empezar, comprueba si hay una API en el puerto 3000 y detenla. Al terminar, detén la tuya y di en el handoff que el puerto quedó libre.
- Automatización del teléfono con `adb`: antes de teclear, verifica que el foco está en el campo correcto.

Los problemas de entorno nuevos van a `docs/lecciones.md` y a la nota `Entorno local` del vault.

## 9. Secretos

- Las credenciales de los usuarios de prueba de la app están en `.data/local-credentials/<usuario>.txt` (ignorado por git). Léelas desde ahí **sin imprimirlas**: ni en comandos visibles, ni en logs, ni en salidas de herramientas, ni en documentos, ni en el vault.
- Las contraseñas de `TT_OWNER` y `TT_APP` no están en `.data/`: las introduce el propietario cuando `npm.cmd run start:users:local` las pide. Nunca se pasan al agente por chat (L11).
- No pidas ni aceptes contraseñas por chat. Si alguien las pega en la conversación, repórtalo para rotarlas.
- Para comprobar que ningún secreto de `.data/local-credentials/` quedó escrito, ejecuta `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/secret-scan.ps1`. Revisa `docs/`, el vault, los `*.log` y los archivos versionados del repo de código, e imprime solo `cuenta → archivo: N`. No conoce los secretos que no están en `.data/`.
- Los enlaces y tokens QR también son secretos: no se imprimen.
- Si un secreto aparece en una salida, repórtalo en el handoff con la cuenta afectada, sin repetir el valor.

## 10. Lecciones

`docs/lecciones.md` es el registro de errores ya ocurridos. Se lee entero al empezar cada ticket.

Al cerrar, por cada error, sorpresa o suposición falsa del ticket (tuya, del ticket o del entorno), añade una entrada con:

- qué pasó;
- causa;
- regla para evitarlo;
- ticket donde ocurrió.

No añadas entradas genéricas ni repitas una existente: si una lección se repite, anota el nuevo ticket en la entrada existente. Una lección que se repite es señal de que la regla no basta, y debe decirse en el handoff.

## 11. Git

Hay **dos repositorios**:

- el del código, en la raíz, con remoto en GitHub;
- el de documentación, en `docs/`, **solo local**. Nunca se le añade un remoto de GitHub y nunca se sube. El repo del código ignora `docs/`.

Permitido sin pedirlo, en ambos repos: `git status --short` y `git log -1 --oneline` al empezar y al terminar.

Prohibido salvo petición explícita del usuario en ese momento: `git diff` y equivalentes de revisión, `git add`, commit, push, rebase, merge y cualquier operación que modifique el índice o el historial. El usuario hace la revisión en Git.

## 12. REVIEW_HANDOFF

Al terminar, responde con este formato y detente:

1. **Resultado**: respuesta a la pregunta principal de aceptación (sí/no) y resumen en 3–5 líneas.
2. **Recorrido físico**: qué se hizo en el teléfono, con qué usuarios y qué datos se crearon.
3. **Preguntas del ticket**: respuesta a cada una, con su fuente.
4. **Brechas**: tabla con resuelta / diferida / discrepancia y el motivo.
5. **Cambios**: por endpoint y por pantalla, qué cambió y qué no.
6. **Pruebas**: totales antes y después por suite; pruebas nuevas; pruebas modificadas y por qué; suites no ejecutadas.
7. **Base de datos**: migración vigente; grants de `TT_APP` antes y después.
8. **Archivos**: lista separada para el repo de código y para el repo `docs/`.
9. **Lectura**: notas del vault y documentos leídos, y los obligatorios que no se leyeron (con el motivo).
10. **Memoria actualizada**: `project-state.md`, notas del vault y entradas de `docs/lecciones.md` añadidas.
11. **Errores y sorpresas**: qué salió distinto de lo previsto, incluidos errores del propio ticket.
12. **Secretos**: si alguno apareció en una salida (cuenta afectada, sin el valor).
13. **Limitaciones y gates abiertos.**
14. **Siguiente paso** propuesto.
15. **Procesos**: API detenida o corriendo, y el puerto.

## 13. Sesiones

Una sesión del agente es memoria de trabajo para un ticket. Antes de terminar, todo lo duradero queda en el repositorio y en el vault (§3). No uses el historial de conversaciones como fuente del estado cuando el repositorio tiene la respuesta.
