# Azul ATS - Microservicios Backend

Servicio orquestador en Node.js desarrollado para ejecutarse en Google Cloud Run. Se encarga de gestionar la lógica de backend del ATS de Azul.

## RESUMEN GERENCIAL

### 1. Resumen Ejecutivo y Propósito
El servicio es un microservicio orquestador backend desarrollado en **Node.js 24 + Express**, concebido para ejecutarse en entorno serverless sobre **Google Cloud Run**. Su propósito central es gestionar el ciclo de vida del reclutamiento y selección de personal mediante tres ejes operativos:
1. **Captación de Candidatos (Portal B2C y Carga B2B con IA)**
2. **Catálogo de Búsquedas / Vacantes Requeridas (B2B)**
3. **Pipeline de Selecciones / Tablero Kanban (Relación N:N)**

---

### 2. Stack Tecnológico e Infraestructura
* **Runtime & Framework**: Node.js 24 / Express.
* **Base de Datos Transaccional**: Google Cloud Firestore (`firebase-admin`).
* **Almacenamiento de Binarios**: Firebase Storage (`gs://azul-ats-1.firebasestorage.app`).
* **Inteligencia Artificial / GenAI**: **Firebase Genkit** (`genkit`, `@genkit-ai/google-genai`) usando el modelo `vertexai/gemini-2.5-flash` sobre Google Vertex AI.
* **Validación de Datos**: **Zod** para estructuración de schemas JSON estrictos y extracción asistida por LLM.
* **Procesamiento de Binarios**: **Multer** (carga puramente en memoria RAM `< 5MB`, evitando saturar el almacenamiento efímero de Cloud Run).
* **Seguridad y Control de Accesos**: Middleware JWT `verificarToken` (Firebase Auth) y políticas dinámicas de CORS (`ALLOWED_ORIGINS`).
* **Analítica & Data Warehousing**: Sincronización continua Firestore → BigQuery mediante la extensión *Stream Firestore to BigQuery*.

---

### 3. Análisis Funcional por Módulos

#### A. Módulo de Candidatos / Postulantes (`/api/v1/candidatos`)
Garantiza el registro y administración de perfiles a través de dos canales:
1. **Portal Público (B2C - `POST /api/v1/candidatos`)**:
   * Endpoint abierto protegido únicamente por CORS dinámico.
   * Exige adjuntar CV en formato `.pdf`, `.doc` o `.docx` (< 5MB) y validación legal obligatoria de RGPD (`acepta_privacidad: true`).
   * **Mecanismo de Rollback Anti-Huérfanos**: Si tras subir el archivo a Firebase Storage la persistencia en Firestore falla, el sistema elimina automáticamente el CV subido para evitar archivos sin registro.
2. **Importación Asistida por IA (B2B - `POST /api/v1/candidatos/importar-ia`)**:
   * Endpoint administrativo que procesa un CV binario directamente con **Gemini 2.5 Flash**.
   * Extrae de forma estructurada los metadatos del postulante (`nombre_completo`, `email`, `telefono_movil`, `ubicacion`, `skills_principales`, `nivel_ingles`, `resumen`, `rubros`, etc.) forzando salida tipada mediante Zod.
3. **Gestión Administrativa B2B (`GET`, `PATCH`, `DELETE`)**:
   * **Inmutabilidad de Seguridad**: Bloquea modificaciones a campos críticos/legales (`url_cv`, `acepta_privacidad`, `origen`, `createdAt`, `id`).
   * **Descarte Operativo**: Manejo de *Soft Delete* marcando `estado_revision: "Descartado"`.
   * Lógica de *Hard Delete* (Derecho al Olvido / RGPD) documentada y comentada para borrado físico en cascada (Storage + Firestore).

---

#### B. Módulo de Búsquedas / Vacantes (`/api/v1/busquedas`)
Administra el catálogo de vacantes técnicas requeridas por el negocio:
* **Esquema Jerárquico en Bloques**:
  1. `identificacion`: Cliente, Hiring Manager, fecha de apertura.
  2. `perfil_tecnico`: Rol, seniority, skills excluyentes/deseables, nivel de inglés.
  3. `condiciones`: Modalidad (Remoto/Presencial/Híbrido), zona horaria.
  4. `estado_sla`: Presupuesto, estado (`Abierta`, `Pausada`, `Cerrada`), prioridad, link a Job Description.
  5. `criterios_screening`: Arreglo dinámico de preguntas de descarte/aceptación (`id` UUID inmutable, `pregunta`, `tipo` (`knockout` | `deseable`), `peso`).
* **Control de Modificaciones Controladas**: `PATCH /api/v1/busquedas/:id` permite actualizar `estado_busqueda`, `prioridad` y la modificación dinámica de `criterios_screening` sobre la marcha.

---

#### C. Módulo Pipeline de Entrevistas (`/api/v1/pipeline`)
Funciona como una **colección puente N a N** (`pipeline_entrevistas`) para conectar candidatos con vacantes y visualizar el avance en un tablero Kanban:
* **Fases del Flujo**:
  * `01 - Nuevo (Para Revisión)` (Fase inicial al vincular).
  * `02 - Selección en Marcha`
  * `03 - Entrevista Técnica`
  * `04 - Entrevista Cliente`
  * `Resolución` (`Contratado` / `Descartado`).
* **Estructura Interna Desagregada por Fase**:
  * `f1_descubrimiento`: Análisis semántico por IA (`fit_score`, fortalezas, debilidades), outreach.
  * `f2_evaluacion`: Puntaje técnico y notas del reclutador.
  * `f3_cliente`: Feedback del cliente.
  * `f4_cierre`: Condiciones de la oferta económica.
  * `resolucion`: Estado final, motivo de rechazo y fecha de resolución.
* **Criterios de Aceptación / Screening (`resultado_screening`)**:
  * `resultado_screening`: Arreglo de evaluaciones por criterio (`id_criterio`, `evaluacion` (`SI`|`INFERIDO`|`NO`), `evidencia_cv`, `es_knockout`, `puntaje_obtenido`).
  * `fit_score_screening`: Puntaje acumulado calculado automáticamente.
  * `tiene_knockout`: Booleano que indica si al menos un criterio excluyente no fue cumplido (`evaluacion === 'NO'`).
  * `fecha_modificacion_screening`: Timestamp ISO 8601 que registra el momento exacto del último cambio (evaluación IA o edición manual por reclutador).
  * Edición manual via `PATCH /api/v1/pipeline/:id` enviando `resultado_screening` para el ajuste *Human-in-the-Loop*.
* **Gestión Dinámica de Reuniones (`reuniones`)**:
  * Arreglos dinámicos en cada fase (F1 a F4).
  * Generación automática de `id_reunion` UUID v4 en el servidor y validación de fechas bajo estándar ISO 8601 mediante Zod.
* **Retrocompatibilidad**: Incluye un mapeador transparente que traduce peticiones enviadas con esquemas heredados/planos a los nuevos bloques por fase (`f2_evaluacion`, `f3_cliente`, `resolucion`).

---

### 4. Patrones Arquitectónicos y Seguridad Destacados

* **Cross-Project IAM Authentication (GCP)**: La inferencia de Inteligencia Artificial se ejecuta hacia un proyecto dedicado de IA/Analítica (`ultra-bearing-492817-k6` en `us-east1`). Se utiliza asignación de roles IAM (`roles/aiplatform.user` en la Service Account de Cloud Run), eliminando completamente el uso de API Keys rígidas.
* **Observabilidad Estratégica**: Implementación de logs estructurados en Cloud Logging categorizados en auditoría de seguridad CORS (`[SECURITY]`), confirmaciones transaccionales (`[SUCCESS]`) y trazabilidad de rollbacks (`[ERROR]`).
* **Estrategia de Pruebas Integradas**: Suite de pruebas con ejecuciones locales (`tests/prueba-postulantes.js`, `tests/prueba-busquedas.js`, `tests/prueba-pipeline.js`, `tests/prueba-importar-ia.js`) preparadas con mocks de autenticación (`NODE_ENV === 'test'`).


## Detalles Funcionales y Técnicos

### Stack Tecnológico
- **Entorno de ejecución**: Node.js 24
- **Framework**: Express (servidor HTTP)
- **Base de datos transaccional**: Firestore (SDK `firebase-admin`)
- **Almacenamiento de archivos (B2C)**: Firebase Storage (SDK `firebase-admin/storage`)
- **Control de accesos y archivos**: CORS (`cors`) y Multer (`multer`)
- **Variables de entorno**: Gestionadas con `dotenv`
- **Orquestación de IA (GenAI)**: Firebase Genkit (`genkit`)
- **Integración de Modelos de IA**: Google Vertex AI (vía el plugin de Vertex AI provisto por `@genkit-ai/google-genai`) para el uso seguro de la familia Gemini de manera nativa sin API Keys
El usuario de servicios del proyecto de la app también requiere de permisos en el proyecto donde está la API de IA y BigQuery:
Cuenta: 795205053212-compute@developer.gserviceaccount.com
Role: Agent Platform User, BigQuery Data Editor, BigQuery Job User

- **Esquemas y Validación de Datos**: Zod (`zod`) para forzar salida estructurada (JSON Schemas) desde los LLMs

### Patrón Arquitectónico: Escritura Dual (Dual Write)
Para asegurar que las operaciones transaccionales y analíticas estén sincronizadas de forma consistente y en tiempo real, implementamos un patrón de **Escritura Dual (Dual Write)**. Cada mutación en el sistema se escribe simultáneamente y de forma coordinada en el almacenamiento transaccional (para la operativa diaria en tiempo real) y en el almacén analítico (para propósitos de análisis y reportería). 

Las escrituras se realizan de forma física hacia **Google Cloud Firestore** y **Google Cloud BigQuery** de forma coordinada e independiente a través del framework native de promesas concurrente de JavaScript.

### Flujo Arquitectónico: Portal Público de Candidatos (B2C)
El endpoint público `POST /api/v1/candidatos` expone un flujo coordinado en capas diseñado para gestionar la carga de currículums de forma segura y uniforme:
1. **Validación Dinámica de CORS**: Comprobación dinámica de orígenes a través de la whitelist `ALLOWED_ORIGINS` configurada en el entorno, bloqueando peticiones desde orígenes cruzados no autorizados con código `HTTP 403`.
2. **Procesamiento de Archivos en Memoria (Multer)**: Los binarios adjuntos no tocan el disco local del servidor (lo que saturaría el espacio efímero del contenedor en entornos serverless como Google Cloud Run), sino que se cargan en búferes de RAM temporales con restricciones rigurosas de tamaño (<5MB) y tipos MIME (.pdf, .doc, .docx).
3. **Persistencia Física (Firebase Storage)**: Carga incremental de archivos al bucket `gs://azul-ats-1.firebasestorage.app/cvs/` bajo una codificación asíncrona que antepone un UUID único al nombre del archivo (`<UUID>_<nombre_archivo_sanitizado>`) para prevenir cualquier colisión o sobreescritura accidental.
4. **Resguardo de Datos Transaccionales (Firestore)**: Tras completar la carga del binario a la nube, se persiste la información del candidato (incluyendo la dirección `gs://` del CV) en la colección transaccional `postulantes` de Firestore.
5. **Mecanismo de Rollback de Coexistencia (Consistencia de Datos)**: Si por cualquier falla del cliente o de la base de datos la inserción en Firestore es rechazada, se detona una rutina catch que elimina inmediatamente el archivo cargado en Firebase Storage, garantizando que el almacenamiento permanezca libre de "archivos de CV huérfanos".
6. **Streaming Analítico en BigQuery**: Sincronización automática unidireccional de los registros candidatos de la colección `postulantes` hacia BigQuery a través de Firebase Extensions.

### Gestión Administrativa de Candidatos (B2B)
Para la administración interna y la gestión del ciclo de vida de los perfiles espontáneos en el ATS (Etapas 1 y 2 del plan), la API expone un flujo seguro:
1. **Seguridad y Control de Accesos (Autorización)**: Los endpoints administrativos GET y PATCH están protegidos por el middleware `verificarToken` requiriendo tokens emitidos por Firebase. En ambiente de pruebas (`process.env.NODE_ENV === 'test'`), se admite el uso de tokens simulados (`mock-token-recruiter`) para agilizar los flujos locales de validación.
2. **Políticas de Mutabilidad e Historial Legal (Blindaje)**: Se implementó un control estricto que limita qué información del candidato puede ser actualizada. Campos asociados a la autoría inicial y trazabilidad legal del consentimiento (`acepta_privacidad`, `url_cv`, `origen`, `createdAt`, `id`) son absolutamente inmutables. Intentar sobrescribirlos mediante `PATCH` retorna HTTP 400 Bad Request.
3. **Control del Ciclo de Vida y Auditoría**: Se autoriza la modificación de los campos de contacto (`nombre_completo`, `email`, `linkedin_url`) y el estado de revisión del postulante (`estado_revision`). Cada modificación guardada genera automáticamente el campo de auditoría de actualización del servidor `updatedAt`.
4. **Descarte Operativo (Soft Delete)**: Las necesidades normales de reclutamiento para el descarte de perfiles no aptos se canalizan lógicamente a través de `PATCH /api/v1/candidatos/:id` estableciendo el campo `estado_revision` a `"Descartado"`. Esto permite mantener el registro documental e integridad transaccional histórica.
5. **Derecho al Olvido / RGPD (Hard Delete Comentado)**: La lógica cascada coordinada encargada del borrado físico definitivo del documento en Firestore y de la eliminación de su respectivo archivo adjunto (PDF) en Firebase Storage se ha plasmado comentada en el código fuente, documentando las directrices técnicas para su activación definitiva.

### Configuración de Conectores (GCP)
* **Firestore & Storage (`src/config/firebase.js`)**: Inicializado mediante el SDK oficial `firebase-admin` usando la autenticación implícita y segura `applicationDefault()`. Exporta la instancia de base de datos transaccional `db` y la conexión al bucket de almacenamiento binario `bucket` (asociado a `gs://azul-ats-1.firebasestorage.app` mediante la variable `FIREBASE_STORAGE_BUCKET` en `.env`).
* **BigQuery (`src/config/bigquery.js`)**: Inicializado utilizando la clase `@google-cloud/bigquery`.
* **Firebase Genkit & Vertex AI (`@genkit-ai/google-genai`)**: Inicializado importando el plugin `vertexAI` unificado. En cumplimiento con la política de seguridad para Cloud Run, descarta el uso de API Keys y utiliza estrictamente autenticación nativa vía IAM a través de Service Accounts. Debido a la arquitectura multi-proyecto (Cross-Project IAM) de Google Cloud, las llamadas de inferencia de IA se direccionan al proyecto dedicado de analítica/IA (`ultra-bearing-492817-k6`) bajo la región `us-east1` usando el modelo `vertexai/gemini-2.5-flash`. Para su correcto funcionamiento local y Cloud Run, la Service Account del proyecto principal (`azul-ats-1`) debe tener asignado explícitamente el rol de **Vertex AI User** (`roles/aiplatform.user`) en el proyecto de IA (`ultra-bearing-492817-k6`).

### Configuración de Seguridad y CORS (B2C)
Para mitigar accesos indebidos a los endpoints B2C y al almacenamiento de archivos, se utilizan políticas dinámicas de CORS:
* **Lista Blanca de Orígenes (`ALLOWED_ORIGINS`)**: Variable en `.env` (separada por comas, ej: `http://localhost:3000,https://digitalagil.es`) que restringe dinámicamente qué clientes web pueden realizar peticiones al microservicio, rechazando accesos con comodín general (`*`).

### Guía de Variables de Entorno y Seguridad

> [!WARNING]
> **Advertencia crítica sobre el formato de las variables:**
> * Las variables `ALLOWED_ORIGINS` (en la configuración de Google Cloud Run) y `NEXT_PUBLIC_ATS_API_URL` (en el frontend Next.js) deben ingresarse estrictamente como texto plano.
> * Está terminantemente prohibido utilizar barras diagonales finales (`/`) o caracteres de Markdown (como corchetes `[]` o paréntesis `()`). El uso de formatos incorrectos provocará fallas de enrutamiento y bloqueos en las políticas de seguridad.
> * En ambientes de **Preview**, la URL dinámica temporal generada debe registrarse anexándola a la variable de entorno `ALLOWED_ORIGINS` separada por comas para evitar que las peticiones de origen cruzado sean rechazadas por CORS.

### Esquema Firestore & Sincronización Analítica con BigQuery
Para recopilar la información y modelar análisis posteriores, se asume la configuración de la extensión oficial **Stream Firestore to BigQuery** para la colección de candidatos.
- **Colección Firestore**: `postulantes`
- **Esquema de Destino BigQuery**:
  | Campo Firestore | Tipo de Dato en BigQuery | Descripción |
  | :--- | :--- | :--- |
  | `id` | `STRING` | Identificador único UUIDv4 autogenerado |
  | `nombre_completo` | `STRING` | Nombre del aspirante |
  | `email` | `STRING` | Correo electrónico de contacto |
  | `acepta_privacidad` | `BOOLEAN` | Trazabilidad legal obligatoria (debe ser `true`) |
  | `puesto_postulacion` | `STRING` | Cargo al que aplica (por ejemplo, Frontend Engineer) |
  | `linkedin_url` | `STRING` | Perfil social de LinkedIn (puede ser nulo) |
  | `origen` | `STRING` | Canal de postulación (ej: landing) |
  | `url_cv` | `STRING` | Dirección canónica gs:// del binario guardado en Cloud Storage |
  | `resumen` | `STRING` | Resumen o extracto profesional descriptivo del candidato (puede ser nulo) |
  | `rubros` | `STRING` | Sectores o mercados de las empresas (separados por comas, puede ser nulo) |
  | `canal_ingreso` | `STRING` | Fuente comercial o canal de reclutamiento (ej: LinkedIn, Referido, Portal Web, puede ser nulo) |
  | `createdAt` | `TIMESTAMP` | Marca temporal de la postulación |

### Endpoints Disponibles

- **GET /ping**: Endpoint de salud y diagnóstico básico.
  - **Respuesta**: `{ "status": "ok", "message": "Azul ATS API operativa" }`
- **POST /api/v1/busquedas** 🔒 *(Ruta protegida)*: Crea una nueva búsqueda en el ATS almacenando la información de manera exclusiva en Firestore (BigQuery suspendido temporalmente).
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT emitido por Firebase Auth).
    * `HTTP 401 Unauthorized`: Si el header `Authorization` está ausente.
    * `HTTP 403 Forbidden`: Si el token es inválido o ha expirado.
  - **Cuerpo de la Petición (JSON) - Esquema agrupado jerárquico**:
    ```json
    {
      "id_busqueda": "REQ-MOCK-001",
      "identificacion": {
        "cliente": "Banco de Barcelona",
        "hiring_manager": "Andrés Iniesta",
        "fecha_apertura": "2026-07-20T00:00:00Z"
      },
      "perfil_tecnico": {
        "rol_solicitado": "Node.js Developer Senior",
        "seniority": "Senior",
        "skills_excluyentes": ["Node.js", "Firestore", "Docker"],
        "skills_deseables": ["GCP", "TypeScript"],
        "nivel_ingles_req": "B2 Conversacional"
      },
      "condiciones": {
        "modalidad": "Remoto",
        "zona_horaria_ubicacion": "Madrid (CET)"
      },
      "estado_sla": {
        "presupuesto_max": "60K EUR",
        "estado_busqueda": "Abierta",
        "prioridad": "Alta",
        "link_job_description": "https://docs.google.com/test-jd"
      }
    }
    ```
  - **Identificador de Búsqueda**: Si `id_busqueda` no se proporciona en el cuerpo, se autogenera mediante el ID del documento en Firestore.
  - **Validación de campos**: Los bloques `identificacion` (junto con su propiedad `cliente`), `perfil_tecnico` (con `rol_solicitado`) y `estado_sla` (con `estado_busqueda`) son requeridos en el cuerpo. Ante su ausencia, retorna un código `HTTP 400 Bad Request`.
  - **Respuestas**:
    * **HTTP 201 Created**: Escritura exitosa en Firestore.
    * **HTTP 500 Internal Server Error**: Error en la base de datos Firestore.
- **GET /api/v1/busquedas** 🔒 *(Ruta protegida)*: Lista todas las búsquedas almacenadas en Firestore.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT emitido por Firebase Auth).
    * `HTTP 401 Unauthorized`: Si el header `Authorization` está ausente.
    * `HTTP 403 Forbidden`: Si el token es inválido o ha expirado.
  - **Respuesta exitosa** (`HTTP 200 OK`):
    ```json
    { "status": "success", "total": 1, "data": [ { "id": "REQ-MOCK-001", "id_busqueda": "REQ-MOCK-001", "identificacion": { ... }, "perfil_tecnico": { ... }, "condiciones": { ... }, "estado_sla": { ... } } ] }
    ```
- **PATCH /api/v1/busquedas/:id** 🔒 *(Ruta protegida)*: Actualiza campos parciales de una búsqueda en Firestore.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT emitido por Firebase Auth).
    * `HTTP 401 Unauthorized`: Si el header `Authorization` está ausente.
    * `HTTP 403 Forbidden`: Si el token es inválido o ha expirado.
  - **Middleware de validación**: `validarPatchBusqueda` (basado en Zod). Aplica `.strip()` para ignorar de manera transparente cualquier propiedad no definida en el esquema en lugar de responder con `HTTP 400 Bad Request`.
  - **Parámetro de ruta**: `:id` — ID de la búsqueda en Firestore.
  - **Cuerpo de la Petición (JSON)**: Se pueden enviar los valores de actualización de forma plana en la raíz o agrupados en sus respectivos bloques anidados (`identificacion`, `perfil_tecnico`, `condiciones`, `estado_sla`).
  - **Campos permitidos para mutación**:
    * `identificacion.hiring_manager` (o plano `hiring_manager`)
    * `perfil_tecnico.skills_excluyentes` (o plano `skills_excluyentes`)
    * `perfil_tecnico.skills_deseables` (o plano `skills_deseables`)
    * `perfil_tecnico.nivel_ingles_req` (o plano `nivel_ingles_req`)
    * `condiciones.modalidad` (o plano `modalidad`)
    * `estado_sla.presupuesto_max` (o plano `presupuesto_max`)
    * `estado_sla.link_job_description` (o plano `link_job_description`)
    * `estado_sla.estado_busqueda` (o plano `estado_busqueda`)
    * `estado_sla.prioridad` (o plano `prioridad`)
    * `criterios_screening` (Arreglo de criterios con asignación inmutable de UUID)
  - **Respuestas**:
    * **HTTP 200 OK**: Éxito en la actualización. Devuelve el identificador de búsqueda y los campos mutados con `updatedAt`.
    * **HTTP 400 Bad Request**: Si el cuerpo no contiene ningún campo válido para actualizar tras aplicar `.strip()` o si se envían tipos/datos inválidos en los campos reconocidos.
    * **HTTP 404 Not Found**: Si la búsqueda especificada no existe en Firestore.
- **POST /api/v1/candidatos**: Registra una postulación de candidato (B2C) en el sistema.
  - **Autenticación requerida**: Ninguna (Endpoint público B2C).
  - **Cabeceras obligatorias**: `Content-Type: multipart/form-data`
  - **Orígenes permitidos**: Whitelist de CORS (`ALLOWED_ORIGINS`).
  - **Parámetros del cuerpo (Campos requeridos)**:
    - `cv`: Archivo binario adjunto obligatorio (Formatos: `.pdf`, `.doc`, `.docx` con tamaño máximo de 5MB).
    - `nombre_completo`: Cadena de texto.
    - `email`: Cadena de texto.
    - `acepta_privacidad`: Booleano obligatoriamente fijado en `true` para la trazabilidad y auditoría legal.
  - **Parámetros del cuerpo (Campos opcionales)**:
    - `puesto_postulacion`: Cadena de texto (ej. "Fullstack Developer").
    - `linkedin_url`: Dirección URL del perfil.
    - `origen`: Cadena de texto (ej. "landing_top").
    - `estado_revision`: Cadena de texto (se inicializa automáticamente como `"pendiente"` si no se provee).
    - `telefono_movil`: Cadena de texto. Teléfono personal móvil (admite null o vacío).
    - `ubicacion`: Cadena de texto. Dirección o ciudad y país (admite null o vacío).
    - `skills_principales`: Cadena de texto. Lista de 3 a 5 palabras clave separadas por comas (se valida si no está vacío o nulo).
    - `nivel_ingles`: Cadena de texto. Nivel del idioma inglés (texto libre, admite null o vacío).
    - `otros_idiomas`: Cadena de texto. Otros idiomas hablados (admite null o vacío).
    - `notas_iniciales`: Cadena de texto. Notas o comentarios libres sobre el perfil (admite null o vacío).
    - `resumen`: Cadena de texto. Resumen del perfil profesional redactado por el postulante (admite null o vacío).
    - `rubros`: Cadena de texto. Rubros / industrias donde laboró el candidato, separados por comas (admite null o vacío).
    - `canal_ingreso`: Cadena de texto. Fuente o canal comercial de reclutamiento (ej. "LinkedIn", "Referido", "Portal Web", admite null o vacío).
  - **Respuestas**:
    - `HTTP 201 Created` (Éxito transaccional): Postulación completada exitosamente. Devuelve el identificador único UUID del candidato y la ruta de almacenamiento canónica `gs://` del CV.
    - `HTTP 400 Bad Request` (Error de validación): Si falta el archivo CV, excede los 5MB de tamaño, posee formato inválido, faltan campos obligatorios (nombre_completo, email, acepta_privacidad) o si `acepta_privacidad` no es enviado como `true` (requisito legal obligatorio).
    - `HTTP 403 Forbidden` (Violación de CORS): Si el origen de la consulta web viola la configuración dinámica de CORS.
    - `HTTP 500 Internal Server Error` (Fallo transaccional): Errores fatales al interactuar con Firebase Storage o Firestore (gatillándose la política automática de Rollback de archivo).
- **POST /api/v1/candidatos/importar-ia** 🔒 *(Ruta protegida)*: Endpoint administrativo B2B para importar candidatos y procesar currículums (PDF/DOC/DOCX, <5MB) mediante extracción de metadatos estructurados asistida por IA (Google Vertex AI con Gemini 2.5 Flash en el proyecto dedicado `ultra-bearing-492817-k6` y región `us-east1`).
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT de Firebase).
  - **Cabeceras obligatorias**: `Content-Type: multipart/form-data`
  - **Parámetros del cuerpo**:
    - `cv`: Archivo binario adjunto obligatorio.
  - **Funcionamiento**: Realiza la inferencia utilizando la instancia de Genkit en Vertex AI para extraer: `nombre_completo`, `email`, `telefono_movil`, `ubicacion`, `skills_principales` (3 a 5 separadas por comas), `nivel_ingles`, `otros_idiomas`, `linkedin_url`, `notas_iniciales`, `resumen`, `rubros` y `canal_ingreso`. Seguidamente, sube el binario a Firebase Storage con la ruta `gs://azul-ats-1.firebasestorage.app/cvs/<UUID>_<archivo>` y persiste la información en Firestore asignando por defecto `origen: "importacion_ia"`, `estado_revision: "pendiente"` y `acepta_privacidad: true`.
  - **Mecanismo de Rollback**: Si la inserción en la base de datos Firestore falla tras haber subido con éxito el archivo a Storage, se descarta automáticamente el binario subido en Storage para evitar archivos huérfanos.
  - **Respuestas**:
    - `HTTP 201 Created`: Importación exitosa. Retorna el objeto JSON del candidato persistido.
    - `HTTP 400 Bad Request`: Petición incorrecta o error de extracción de campos mínimos (nombre y correo).
    - `HTTP 500 Internal Server Error`: Falla en la inferencia de IA, almacenamiento o guardado en base de datos.
- **GET /api/v1/candidatos** 🔒 *(Ruta protegida)*: Recupera y lista los candidatos espontáneos almacenados en el sistema.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT de Firebase).
  - **Parámetros de consulta (Query params)**:
    - `estado_revision` (opcional): Filtro exacto de estado (ej: `pendiente`, `Revisado`, `Descartado`).
  - **Ordenamiento**: Las respuestas se ordenan de manera descendente obligatoria según `createdAt`.
  - **Requisito de Infraestructura**: Requiere dar de alta un **índice compuesto** en Firestore:
    * Colección: `postulantes`
    * Campo 1: `estado_revision` (Ascendente)
    * Campo 2: `createdAt` (Descendente)
  - **Respuestas**:
    - `HTTP 200 OK`: Devuelve el total de candidatos que coinciden y el array con sus perfiles completos.
    - `HTTP 401 Unauthorized`: Si el header `Authorization` está ausente o no tiene el formato correcto.
    - `HTTP 403 Forbidden`: Si el token es inválido o ha expirado.
    - `HTTP 500 Internal Server Error`: Errores al conectar o consultar Firestore.
- **PATCH /api/v1/candidatos/:id** 🔒 *(Ruta protegida)*: Actualización controlada de la ficha de un candidato.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT de Firebase).
  - **Parámetro de ruta**: `:id` — ID único UUIDv4 del candidato.
  - **Cuerpo de la Petición (JSON)**: Cualquier subconjunto de los siguientes campos permitidos:
    - `nombre_completo`
    - `email`
    - `linkedin_url`
    - `estado_revision`
    - `telefono_movil`
    - `ubicacion`
    - `skills_principales` (se valida tener entre 3 y 5 tags separados por comas si no es nulo o vacío)
    - `nivel_ingles`
    - `otros_idiomas`
    - `notas_iniciales`
    - `resumen`
    - `rubros`
    - `canal_ingreso`
    - `puesto_postulacion`
  - **Regla de Mutabilidad (Bloqueo de Inyección)**: Si se intenta modificar campos inmutables como `acepta_privacidad`, `url_cv`, `origen`, `createdAt` o el propio `id`, el endpoint rechazará la petición inmediatamente devolviendo `HTTP 400 Bad Request`.
  - **Comportamiento automático**: Inyecta y actualiza la propiedad `updatedAt` con la marca ISO del servidor.
  - **Respuestas**:
    - `HTTP 200 OK`: Modificación exitosa, devuelve los campos alterados y el timestamp `updatedAt`.
    - `HTTP 400 Bad Request`: Petición vacía o intento de modificar campos inmutables obligatorios.
    - `HTTP 404 Not Found`: No existe candidato con el `id` asignado.
    - `HTTP 401 / 403`: Errores de validación de autenticación.
- **DELETE /api/v1/candidatos/:id** *(Mejora Comentada / No activa)*: Borrado permanente cascada de cumplimiento normativo (RGPD) para Super Administradores.
  - **Nota**: El descarte diario operativo (Soft Delete) se gestiona de forma estándar mediante `PATCH /api/v1/candidatos/:id` actualizando `estado_revision` a `"Descartado"`. La lógica e integración física de cascada permanece comentada en código fuente como mejora futura.
- **POST /api/v1/pipeline** 🔒 *(Ruta protegida)*: Asocia un candidato con una búsqueda en el pipeline de selección (vínculo N a N).
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT de Firebase).
  - **Parámetros del cuerpo (JSON)**:
    * `id_busqueda`: ID de la búsqueda/vacante en Firestore.
    * `id_candidato`: ID único (UUIDv4) del candidato en Firestore.
  - **Validaciones**:
    * Valida que la búsqueda y el candidato existan en sus respectivas colecciones. En caso contrario, devuelve `HTTP 404 Not Found`.
    * Evita duplicidades: si la asociación ya existe en el pipeline, devuelve `HTTP 400 Bad Request`.
  - **Estructura Creada**: Se inicializa en la fase `"01 - Nuevo (Para Revisión)"` con el siguiente esquema:
    * `f1_descubrimiento`: `notas_reclutador` (Null) y `reuniones` (`[]`).
    * `f2_evaluacion`: `puntaje_tecnico` (Null), `notas_reclutador` (Null) y `reuniones` (`[]`).
    * `f3_cliente`: `feedback_cliente` (Null), `notas_reclutador` (Null) y `reuniones` (`[]`).
    * `f4_cierre`: `notas_reclutador` (Null), `condiciones_oferta` (Null) y `reuniones` (`[]`).
    * `resolucion`: `estado_final` (Null), `motivo_rechazo` (Null) y `fecha_resolucion` (Null).
  - **Respuestas**:
    * `HTTP 201 Created`: Vínculo guardado con éxito. Retorna el documento creado.
    * `HTTP 400 Bad Request`: Parámetros faltantes o duplicados detectados.
    * `HTTP 404 Not Found`: Búsqueda o candidato inexistente.
    
- **GET /api/v1/pipeline** 🔒 *(Ruta protegida)*: Recupera y lista los candidatos asociados a una búsqueda con fines de visualización en el tablero Kanban.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT de Firebase).
  - **Parámetros de consulta (Query params)**:
    * `id_busqueda` (Obligatorio): ID de la vacante.
    * `estado_actual` (Opcional): Filtro de fase Kanban específica.
  - **Requisito de Infraestructura**: Requiere dar de alta un **índice compuesto** en Firestore:
    * Colección: `pipeline_entrevistas`
    * Campo 1: `claves_conexion.id_busqueda` (Ascendente)
    * Campo 2: `flujo.estado_actual` (Ascendente)
  - **Respuestas**:
    * `HTTP 200 OK`: Array de candidatos en el pipeline que cumplen los filtros. Incluye explícitamente en la raíz del objeto del pipeline la propiedad `id`, `claves_conexion`, `resultado_screening`, `fit_score_screening`, `tiene_knockout` y `fecha_modificacion_screening`:
      ```json
      {
        "status": "success",
        "total": 1,
        "data": [
          {
            "id": "e72c673e-0c20-4773-a314-4baf72536520",
            "claves_conexion": {
              "id_busqueda": "REQ-001",
              "id_candidato": "09a1ff40-57c0-4806-95bf-bb1841dc726f"
            },
            "flujo": {
              "estado_actual": "01 - Nuevo (Para Revisión)",
              "fecha_ultimo_cambio": "2026-07-29T08:00:00Z"
            },
            "resultado_screening": [
              {
                "id_criterio": "crit_1",
                "evaluacion": "SI",
                "evidencia_cv": "Cita textual extraída del CV...",
                "es_knockout": false,
                "puntaje_obtenido": 20
              }
            ],
            "fit_score_screening": 85,
            "tiene_knockout": false,
            "fecha_modificacion_screening": "2026-07-29T08:00:00Z"
          }
        ]
      }
      ```
    * `HTTP 400 Bad Request`: Si no se proporciona `id_busqueda`.
- **PATCH /api/v1/pipeline/:id** 🔒 *(Ruta protegida)*: Actualiza el estado del pipeline, inyecta feedbacks de IA o gestiona las calificaciones, agendamientos y resoluciones.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT de Firebase).
  - **Parámetro de ruta**: `:id` — ID de la asociación en pipeline.
  - **Cuerpo de la Petición (JSON)**: Admite actualizar las siguientes propiedades anidadas o planas:
    * `estado_actual`: Provoca un cambio de estado en el flujo, actualizando `fecha_ultimo_cambio` y el historial.
    * `f1_descubrimiento`: Objeto o campos parciales (`notas_reclutador`, `reuniones`).
    * `f2_evaluacion`: Objeto o campos parciales (`puntaje_tecnico`, `notas_reclutador`, `reuniones`).
    * `f3_cliente`: Objeto o campos parciales (`feedback_cliente`, `notas_reclutador`, `reuniones`).
    * `f4_cierre`: Objeto o campos parciales (`notas_reclutador`, `condiciones_oferta`, `reuniones`).
    * `resolucion`: Objeto o campos parciales (`estado_final`, `motivo_rechazo`, `fecha_resolucion`).
    * **Dynamic Reuniones**: Los arreglos de `reuniones` de cada etapa reemplazan el listado existente tras validar con Zod. Cada reunión no provista con `id_reunion` recibirá un UUID autogenerado en el servidor. Intentar registrar una fecha no ISO 8601 en `fecha_hora` fallará con un error `HTTP 400 Bad Request`.
    * **Retrocompatibilidad**: Los envíos empleando las antiguas propiedades planas o sub-objetos `evaluacion` (`puntaje_tecnico`, `feedback_cliente`) y `cierre` (`fecha_cierre`, `motivo_rechazo`) continuarán siendo válidos y se mapearán de forma transparente a las nuevas fases (`f2_evaluacion`, `f3_cliente`, `resolucion`).
  - **Respuestas**:
    * `HTTP 200 OK`: Modificación exitosa, devuelve el documento completo actualizado en la nueva estructura.
    * `HTTP 400 Bad Request`: Cuerpo de petición sin campos válidos o error de validación de datos.
    * `HTTP 404 Not Found`: No existe la relación de pipeline con el `id` indicado.
- **POST /api/v1/pipeline/:id/evaluar-screening** 🔒 *(Ruta protegida)*: Ejecuta el Motor de Inferencia con IA (**Genkit + Gemini**) para evaluar automáticamente los Criterios de Aceptación / Descarte del candidato frente al CV.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT de Firebase).
  - **Parámetro de ruta**: `:id` — ID de la asociación en el pipeline (`pipeline_entrevistas`).
  - **Validación Temprana**: Verifica previamente que el candidato posea un archivo CV subido (`url_cv`). En caso contrario, retorna un error `HTTP 400 Bad Request` antes de realizar llamadas a la IA o Storage.
  - **Flujo de Ejecución**:
    1. Recupera las preguntas de `criterios_screening` desde la búsqueda asociada. Si la búsqueda no posee criterios, restablece `resultado_screening: []` y retorna `HTTP 200 OK`.
    2. Descarga el buffer del CV desde Firebase Storage.
    3. Invoca **Genkit + Gemini (Vertex AI)** forzando salida estructurada mediante **Zod Schema**:
       - `evaluacion`: `"SI"` | `"INFERIDO"` | `"NO"`.
       - `evidencia_cv`: Cita textual o fundamentación explícita (incluyendo causa aclaratoria en evaluaciones `"NO"`).
    4. Mapea la puntuación ponderada:
       - `"SI"` -> 100% del `peso`.
       - `"INFERIDO"` -> 50% del `peso` (`Math.round(peso / 2)`).
       - `"NO"` -> 0 puntos.
       - Criterio `knockout` en `"NO"` -> Activa bandera roja `es_knockout: true` y `tiene_knockout: true`.
    5. Persiste `resultado_screening`, `fit_score_screening`, `tiene_knockout` y actualiza `fecha_modificacion_screening` (ISO 8601).
  - **Respuestas**:
    * `HTTP 200 OK`: Evaluación procesada exitosamente. Devuelve el documento de pipeline actualizado.
    * `HTTP 400 Bad Request`: Candidato sin CV (`url_cv` ausente) o claves de conexión inválidas.
    * `HTTP 404 Not Found`: Vínculo de pipeline, candidato o búsqueda inexistente.
- **DELETE /api/v1/pipeline/:id** 🔒 *(Ruta protegida)*: Desvincula físicamente a un candidato de una vacante (eliminando el registro de pipeline) sin alterar los maestros correspondientes del candidato o de la búsqueda.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT de Firebase).
  - **Respuestas**:
    * `HTTP 200 OK`: Eliminación exitosa del vínculo.
    * `HTTP 404 Not Found`: No existe registro en el pipeline con ese ID.


### Estrategia de Observabilidad y Logs Estratégicos
El microservicio implementa logs a nivel de aplicación estructurados para facilitar la administración y el rastreo de eventos críticos en **Google Cloud Logging**, optimizando tanto la legibilidad como la administración de costos (evitando imprimir payloads pesados, objetos anidados completos o buffers de archivos):
* **Auditoría de Seguridad (CORS)**: Se emite una advertencia cada vez que una petición es bloqueada por las políticas de origen.
  * Log: `console.warn("[SECURITY] Petición bloqueada por CORS. Origen rechazado: <req.headers.origin>")`
* **Trazabilidad Transaccional de Éxito**: Ante un flujo de registro exitoso, se imprime un registro informativo conteniendo únicamente columnas no sensibles relevantes (identificadores y origen del formulario).
  * Log: `console.info("[SUCCESS] Postulación registrada exitosamente. UUID: <id_generado> | Origen: <origen_del_formulario>")`
* **Rastreo de Errores Críticos (Rollbacks)**: Si falla la persistencia en Firestore y se detona la remoción del binario subido a la nube para evitar archivos huérfanos, se imprime la causa exacta.
  * Log: `console.error("[ERROR] Fallo transaccional en pasarela de candidatos. Iniciando Rollback. Causa: <error.message>")`

## Estrategia de Control de Versiones con Git y GitHub
El desarrollo del microservicio sigue un flujo de ramificación ordenado para garantizar que el entorno de producción permanezca verificado y aislar el desarrollo de nuevas características:
* **Rama Principal (`main`)**: Rama oficial y de producción inmutable para código verificado. Todos los despliegues de Cloud Run se basan y cargan desde esta rama.
* **Ramas de Características (`feature/`)**: Cada nueva funcionalidad o fase de desarrollo incremental se ejecuta en su propia rama aislada (por ejemplo, `feature/candidatos-gateway`), previniendo cambios no probados en el tronco común de producción.
* **Ciclo de Integración**:
  1. **Inicialización local**: Crear y cambiar a la rama de funcionalidad desde main actualizado:
     ```bash
     git checkout -b feature/candidatos-gateway
     ```
  2. **Confirmaciones Incrementales**: Commits atómicos agrupados con mensajes significativos (`git commit -m "feat/fix/docs/test: descripción del cambio"`).
  3. **Copias de Seguridad / Sincronización Remota**: Subida inicial al repositorio seguro de GitHub:
     ```bash
     git push origin feature/candidatos-gateway
     ```
  4. **Merge y Consolidación de Main**: Después de pasar exitosamente los test integrados locales (`tests/prueba-postulantes.js`), se cambia a main local, se fusiona el feature, y se envía a producción:
     ```bash
     git checkout main
     git merge feature/candidatos-gateway
     git push origin main
     ```

## Instrucciones de Despliegue (CI/CD)
El microservicio está diseñado para ser contenerizado mediante Docker y desplegado en **Google Cloud Run**.

* **Plataforma de despliegue**: Google Cloud Run
* **Región de despliegue**: `us-east1` (por Argentina y España)
* **Contenerización**: Docker — imagen base `node:24-alpine`
* **Seguridad**: `--allow-unauthenticated` a nivel de Cloud Run (la seguridad se gestiona internamente con el middleware JWT `verificarToken`).


-------------------------------------------------------------------------------------------------------------------------
# DESPLIEGUE EN PRODUCCION

```bash
# 1. Autenticarse con Google Cloud (solo la primera vez o al renovar sesión)
gcloud auth list  # para ver la cuenta activa
gcloud auth login  # para iniciar sesión

# 2. Seleccionar el proyecto de Firebase/Firestore como proyecto activo
gcloud config list  # para ver el proyecto activo
gcloud config set project azul-ats-1

# 3. Desplegar el servicio en Cloud Run (build + push + deploy automatizados)
#    Las variables de entorno se inyectan directamente en el contenedor
gcloud run deploy azulats-service1 \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --update-env-vars GOOGLE_CLOUD_PROJECT=azul-ats-1,BIGQUERY_PROJECT_ID=ultra-bearing-492817-k6,FIREBASE_STORAGE_BUCKET=azul-ats-1.firebasestorage.app
```

> **Nota**: el comando `--source .` activa Cloud Build en remoto, que ejecuta el `Dockerfile` incluido en el repositorio. Las variables sensibles como `BIGQUERY_PROJECT_ID` no se incluyen en la imagen — solo se inyectan en el entorno de ejecución del contenedor.


------------------------------------------------------------------------------------------------------
# Notas para desarrollo local
Renovar sesión en local:
```bash
gcloud auth application-default login
```
Levantar el servicio local, en la terminal: `npm start`
Para probar la base Firestore local, (no usar, para desarrollo y prueba usamos la del Firebase Cloud):
```bash
NODE_ENV=test npm start
```

- Prueba: `curl -i http://localhost:8080/ping` debe dar ok operativa

- Prueba insertar una postulación: 
```bash
curl -i -X POST http://localhost:8080/api/v1/candidatos \
  -F "cv=@test_cv.pdf" \
  -F "nombre_completo=Candidato de Prueba 10" \
  -F "email=prueba@digitalagil.es" \
  -F "puesto_postulacion=Backend Dev" \
  -F "acepta_privacidad=true"
```

- Prueba usando el servicio en Cloud Run:

```bash
curl -i -X POST https://azulats-service1-795205053212.us-east1.run.app/api/v1/candidatos \
  -F "cv=@test_cv.pdf" \
  -F "nombre_completo=Candidato de Prueba Nube" \
  -F "email=prueba_nube@digitalagil.es" \
  -F "puesto_postulacion=Backend Dev" \
  -F "acepta_privacidad=true"
```



### Otras informaciones del desarrollo (Google Cloud CLI Integrado)
La infraestructura de desarrollo local ya cuenta con **Google Cloud CLI (gcloud)** integrado de forma automatizada y silenciosa (soportado por un intérprete portable de Python 3.10+ para omitir incompatibilidades de versión).

Para autenticarse localmente y generar las Application Default Credentials (ADC) requeridas para la conexión con Firestore y BigQuery en desarrollo local, simplemente ejecuta (copia el link y pega en el navegador correcto):
```bash
gcloud auth application-default login
```
Set del proyecto Firestore: `gcloud config set project azul-ats-1`
Set del proyecto BigQuery: `gcloud auth application-default set-quota-project azul-ats-1`
Set usuario: `gcloud config set account dcastellano@digitalagil.es`
Ver usuario: `gcloud config get-value account`
Ver proyecto: `gcloud config get-value project`

Si no hace el deploy, login: `gcloud auth login`  debe dar owner, editor o admin
Previamente la cuenta de servicios debe tener permisos para storage admin,logs writer y artifactregstry writer.

## Troubleshooting y Resolución de Errores Frecuentes

A continuación, se detalla una guía rápida de diagnóstico y resolución de errores construida a partir de la arquitectura y la integración del sistema:

* **Fallo de Arranque en Cloud Run (Error: `Container failed to start...`)**:
  * **Causa**: Ocurre debido al blindaje de seguridad *Fail-Fast* cuando falta configurar en el entorno de ejecución alguna de las variables vitales de la aplicación (ej. `FIREBASE_STORAGE_BUCKET`).
  * **Solución**: Revisar el visor de logs (**Logs Explorer**) en la consola de Google Cloud, identificar la excepción fatal arrojada por Node.js e inyectar la variable faltante a través de la revisión del servicio.
* **Error 404 (Frontend no encuentra la API)**:
  * **Causa**: Ocurre si la variable de entorno `NEXT_PUBLIC_ATS_API_URL` posee un formato erróneo (como barras diagonales finales `/` u otros esquemas de formato como Markdown), forzando al cliente Next.js a realizar una petición relativa errónea hacia su propio host.
  * **Solución**: Limpiar el valor registrado en Firebase App Hosting a texto plano estricto y forzar una recompilación/despliegue (**Rollout**).
* **Error 403 Forbidden (Bloqueo de CORS)**:
  * **Causa**: Ocurre cuando el servidor está activo y funcional, pero rechaza la solicitud entrante debido a que el origen cliente (ej. un nuevo canal generado dinámicamente en una rama de **Preview**) no ha sido declarado en los orígenes permitidos.
  * **Solución**: Añadir el dominio a la variable `ALLOWED_ORIGINS` en la revisión correspondiente de Cloud Run de forma acumulativa y separada por comas.



--------------------------------------------------------------------------------------------------------------------------------------
# Log de Cambios (Changelog)

* **2026-07-29**: Optimización de la respuesta y trazabilidad del Módulo Pipeline (`/api/v1/pipeline`). Se aseguró la presencia explícita de `id` en la raíz de cada objeto retornado en `GET /api/v1/pipeline`, la serialización en `snake_case` de `resultado_screening`, `fit_score_screening`, `tiene_knockout` y `fecha_modificacion_screening`, la eliminación de filtros/proyecciones de campos en Firestore y la coincidencia estricta entre `claves_conexion.id_candidato` y la clave primaria `id` del documento del candidato en Firestore (con búsqueda de respaldo ante IDs alternativos).
* **2026-07-25**: Reubicación del campo `canal_ingreso` desde el módulo Pipeline de Entrevistas (`f1_descubrimiento`) hacia el módulo maestro de Candidatos / Postulantes. Ahora `canal_ingreso` es un campo opcional y mutable del perfil del candidato, soportado en creación (B2C e inferencia/override en importación por IA), edición vía `PATCH` y schemas de Zod.
* **2026-07-24**: Soporte de campos `resumen` (resumen profesional) y `rubros` (sectores e industrias separadas por comas) de forma opcional en los controladores de creación, edición, extracción con inteligencia artificial (Zod schema e importar-ia) y verificación automatizada mediante suite de tests.
* **2026-07-23**: Rediseño y expansión del Módulo Pipeline de Entrevistas (Mejoras Julio 2026). Separación del bloque `evaluacion` en sub-bloques independientes `f2_evaluacion` (con `puntaje_tecnico`) y `f3_cliente` (con `feedback_cliente`). Reubicación global del descarte operativo al objeto `resolucion`. Flexibilización de agendamientos mediante arreglos dinámicos de `reuniones` en todas las fases (F1-F4) con validación mediante Zod y autogeneración de ID UUIDv4 para reuniones creadas por el servidor. Implementación de una batería de pruebas de integración completa (`tests/prueba-pipeline.js`) y de soporte transparente para retrocompatibilidad con esquemas heredados.
* **2026-07-20**: Configuración de Vertex AI Cross-Project y actualización de modelo a Gemini 2.5 Flash: Corrección del error 404 configurando de forma aislada e independiente en `src/config/genkit.js` el proyecto dedicado de analítica e IA (`ultra-bearing-492817-k6`) y la región `us-east1` para el SDK de Genkit, separándolo del proyecto transaccional principal (`azul-ats-1`). Se actualizó el modelo de producción a `'vertexai/gemini-2.5-flash'` y se documentaron los requerimientos de permisos IAM de Service Account entre proyectos (`roles/aiplatform.user`).
* **2026-07-20**: Migración del plugin de Firebase Genkit de la librería deprecada `@genkit-ai/vertexai` a la librería unificada moderna `@genkit-ai/google-genai` para mitigar advertencias de deprecación/eliminación futura y asegurar la compatibilidad con SDK de Google Gen AI, preservando la autenticación nativa por IAM/ADC.
* **2026-07-20**: Creación e integración del nuevo endpoint B2B de importación asistida por Inteligencia Artificial `POST /api/v1/candidatos/importar-ia`. Configuración del plugin `@genkit-ai/vertexai` integrado en `src/config/genkit.js` con bypass simulado (Mock) en entorno de pruebas (`NODE_ENV === 'test'`). Implementación del controlador `importarCandidatoIA` con validación estructurada y consistente de Zod, carga en Storage, persistencia en Firestore y mecanismo robusto de rollback transaccional ante fallos. Adición de suite de pruebas integradas (`tests/prueba-importar-ia.js`).
* **2026-07-20**: Incorporación de Firebase Genkit y Zod al backend. Instalación de la versión moderna de las librerías `genkit`, `@genkit-ai/vertexai` y `zod` para habilitar flujos de IA integrados con Gemini en Cloud Run. Se adoptó la autenticación nativa por IAM (Service Accounts) descartando claves de API rígidas.
* **2026-07-20**: Implementación del Módulo Pipeline de Entrevistas (Etapa 2). Creación de la colección puente `pipeline_entrevistas` y del controlador/rutas `/api/v1/pipeline` (métodos POST, GET, PATCH con mutabilidad extendida para evaluaciones/cierre y DELETE). Ajustes del simulador Firestore en memoria para soportar queries de claves compuestas y dot-notation. Diseño de suite de pruebas integradas (`prueba-pipeline.js`).
* **2026-07-20**: Refactorización del módulo de Búsquedas (Etapa 1). Transición del esquema de búsquedas plano a la estructura anidada jerárquica de 4 bloques (`identificacion`, `perfil_tecnico`, `condiciones`, `estado_sla`). Eliminación por completo del Dual Write hacia BigQuery (operación exclusiva en Firestore). Diseño e integración de pruebas automatizadas locales (`prueba-busquedas.js`).
* **2026-07-19**: Integración de los 6 nuevos campos opcionales para la ficha de candidatos: telefóno móvil, ubicación, skills principales (con validación de 3-5 tags), nivel de inglés, otros idiomas y notas iniciales. Ajustes de mutabilidad estricta y sanitización/normalización de valores nulos o vacíos. Implementación de pruebas de integración locales mockeadas en memoria local.
* **2026-07-18**: Implementación de la Etapa 2 del Módulo de Postulantes. Verificación automatizada del descarte operativo (Soft Delete) marcando el postulante con el estado `"Descartado"`. Inclusión de lógica estructurada y completamente comentada en candidatosController y candidatosRoutes para la eliminación física completa en cascada (Firebase Storage + Firestore JSON) bajo solicitudes de RGPD ("Derecho al olvido") por Super Administradores.
* **2026-07-18**: Implementación de la Etapa 1 del Módulo de Postulantes. Desarrollo de las rutas administrativas y controladas `GET /api/v1/candidatos` (con filtros de estado y orden descendente) y `PATCH /api/v1/candidatos/:id` (mutabilidad estricta y bloqueo de inyección). Integración de módulo centralizado de Storage `storageService.js` y bypass de autenticación con mock tokens para ambiente local `test`.
* **2026-07-18**: Éxito en integración end-to-end de pasarela B2C en ambiente de Preview. Ajustes de seguridad en lista dinámica CORS y corrección del pipeline de despliegue en Cloud Run implementando variables de entorno incrementales e inyección de Storage Bucket.
* **2026-07-18**: Implementación de observabilidad estratégica y registro de logs de auditoría de CORS (seguridad), éxito transaccional (B2C) y control de errores por reversión (rollback) en Google Cloud Logging.
* **2026-07-16**: Fase 3 de Pasarela B2C de Candidatos: Creación del controlador `src/controllers/candidatosController.js` con soporte para flujos en memoria de subida de archivos adjuntos a Firebase Storage, mapeo transaccional de perfiles en colección `postulantes` de Firestore, y mecanismo automatizado de rollback para remover archivos huérfanos del almacenamiento en la nube ante fallas de base de datos. Creación de tests automatizados native-fetch (`tests/prueba-postulantes.js`) y scripts de verificación.
* **2026-07-16**: Fase 2 de Pasarela B2C de Candidatos: Creación del enrutador `src/routes/candidatosRoutes.js` con soporte Multer en memoria para archivos CV (límite 5MB, filtros PDF/DOC/DOCX), validaciones de los parámetros obligatorios del cuerpo (como la trazabilidad de privacidad legal obligatoria `acepta_privacidad: true`), integración dinámica de CORS y mapeo de errores de CORS mediante respuestas JSON en `index.js`.
* **2026-07-16**: Fase 1 de Pasarela B2C de Candidatos: Inicialización del repositorio Git local, creación de la rama `feature/candidatos-gateway`, instalación de paquetes npm necesarios (`multer` y `cors`), configuración e inicialización de Firebase Storage en el conector `firebase.js` (apuntando al bucket `azul-ats-1.firebasestorage.app`), adición de nuevas variables de entorno en `.env` y validación de compilación del backend.
* **2026-07-11**: Preparación para despliegue en Cloud Run: creación del `Dockerfile` con imagen base `node:24-alpine` y el archivo `.dockerignore` (excluye `node_modules`, `.env`, `.git`, `README.md` y archivos del editor). Documentación de los comandos exactos de despliegue con `gcloud run deploy` en la región `europe-southwest1` con inyección de variables de entorno de producción.
* **2026-07-11**: Implementación de los endpoints REST `GET /api/v1/busquedas` y `PATCH /api/v1/busquedas/:id` con Dual Write y protección transversal por JWT. `GET` lista documentos desde Firestore con ID inyectado. `PATCH` actualiza Firestore con `.update()` y ejecuta un `UPDATE` DML parametrizado en BigQuery (solo si se modifica `estado_fase`) para prevenir inyección SQL. Ambas rutas protegidas por el middleware `verificarToken`.
* **2026-07-11**: Implementación del middleware de autenticación JWT (`src/middlewares/authMiddleware.js`) utilizando `firebase-admin/auth`. El middleware `verificarToken` extrae y valida el token del header `Authorization: Bearer`, inyecta el payload decodificado en `req.user` y devuelve `HTTP 401` si falta el token o `HTTP 403` si es inválido/expirado. Ruta `POST /api/v1/busquedas` protegida.
* **2026-07-11**: Corrección de condición de carrera de `dotenv` en ES Modules: se reemplazó `dotenv.config()` tardío por `import 'dotenv/config'` como **primera importación** en `index.js` para garantizar que todas las variables de entorno estén disponibles antes de que cualquier módulo se inicialice. Se añadió blindaje Fail-Fast en `src/config/bigquery.js` que lanza un error explícito al arranque si `BIGQUERY_PROJECT_ID` está indefinido, evitando silenciosamente que el SDK apunte al proyecto equivocado.
* **2026-07-11**: Adaptación del microservicio a la arquitectura "Cross-Project" y resolución de "Schema Mismatch" mediante mapeo diferenciado para la Escritura Dual: refactorización de BigQuery para conectarse a través del ID cargado de `.env` (`BIGQUERY_PROJECT_ID`), generación de ID de Firestore previo a escrituras, y bifurcación en esquemas diferenciados para Firestore y BigQuery estricto.
* **2026-07-11**: Configuración del Project ID de Google Cloud (`GOOGLE_CLOUD_PROJECT` y `GCLOUD_PROJECT` a `azul-ats-1`) en el archivo `.env` del microservicio para resolver problemas de autenticación de conexión local en Firestore y BigQuery.
* **2026-07-11**: Conexión física real de los conectores GCP (Firestore con `firebase-admin` y BigQuery con `@google-cloud/bigquery`) en el microservicio. Habilitación del flujo real de Escritura Dual concurrentes mediante `Promise.allSettled` y gestión avanzada de respuestas transaccionales en API de búsquedas (`201` Éxito total, `207` Multi-Status para fallas de sincronización parciales y `500` para errores críticos globales).
* **2026-07-11**: Integración de Google Cloud CLI (gcloud) en el entorno de desarrollo de forma silenciosa para macOS, resolviendo incompatibilidades del sistema host mediante la provisión del intérprete portable de Python 3.10+ y actualizando la configuración de bash profile/Zshrc.
* **2026-07-11**: Actualización de la documentación en README.md: detallada la arquitectura transaccional de Escritura Dual a nivel físico, inicialización de los conectores GCP (Firestore, BigQuery), políticas de enriquecimiento de la información persistida y del manejo avanzado de códigos de estado HTTP (207 Multi-Status y 500 para fallos completos).
* **2026-07-11**: Integración de los conectores reales de GCP: inicialización de Firestore y BigQuery, enriquecimiento del objeto de búsqueda (`metricas_tracking`, `contexto_ia` y `fecha_creacion`), implementación de la Escritura Dual física utilizando `Promise.allSettled`, y configuración de respuesta HTTP y trazabilidad con códigos `HTTP 207 Multi-Status` y `HTTP 500` según el estado de cada escritura.
* **2026-07-11**: Actualización de la documentación en README.md, detallando el stack tecnológico de almacenamiento (`firebase-admin` y `@google-cloud/bigquery`) y el nuevo endpoint `POST /api/v1/busquedas` con sus validaciones y formato de payload.
* **2026-07-11**: Implementación del núcleo transaccional de búsquedas: creación del controlador `crearBusqueda` con simulación de Escritura Dual (Firestore/BigQuery mediante `Promise.allSettled`), creación de rutas en `src/routes/busquedasRoutes.js`, montaje de la API bajo el prefijo `/api/v1/busquedas`, e instalación de los SDKs oficiales de Firebase Admin y BigQuery.
* **2026-07-11**: Inicialización del proyecto web server con Express y configuración de variables de entorno.
