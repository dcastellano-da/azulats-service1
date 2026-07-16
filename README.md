# Azul ATS - Microservicios Backend

Servicio orquestador en Node.js desarrollado para ejecutarse en Google Cloud Run. Se encarga de gestionar la lógica de backend del ATS de Azul.

## Detalles Funcionales y Técnicos

### Stack Tecnológico
- **Entorno de ejecución**: Node.js 24
- **Framework**: Express (servidor HTTP)
- **Base de datos transaccional**: Firestore (SDK `firebase-admin`)
- **Almacenamiento de archivos (B2C)**: Firebase Storage (SDK `firebase-admin/storage`)
- **Control de accesos y archivos**: CORS (`cors`) y Multer (`multer`)
- **Variables de entorno**: Gestionadas con `dotenv`

### Patrón Arquitectónico: Escritura Dual (Dual Write)
Para asegurar que las operaciones transaccionales y analíticas estén sincronizadas de forma consistente y en tiempo real, implementamos un patrón de **Escritura Dual (Dual Write)**. Cada mutación en el sistema se escribe simultáneamente y de forma coordinada en el almacenamiento transaccional (para la operativa diaria en tiempo real) y en el almacén analítico (para propósitos de análisis y reportería). 

Las escrituras se realizan de forma física hacia **Google Cloud Firestore** y **Google Cloud BigQuery** de forma coordinada e independiente a través del framework native de promesas concurrente de JavaScript.

### Configuración de Conectores (GCP)
* **Firestore & Storage (`src/config/firebase.js`)**: Inicializado mediante el SDK oficial `firebase-admin` usando la autenticación implícita y segura `applicationDefault()`. Exporta la instancia de base de datos transaccional `db` y la conexión al bucket de almacenamiento binario `bucket` (asociado a `gs://azul-ats-1.firebasestorage.app` mediante la variable `FIREBASE_STORAGE_BUCKET` en `.env`).
* **BigQuery (`src/config/bigquery.js`)**: Inicializado utilizando la clase `@google-cloud/bigquery`.

### Configuración de Seguridad y CORS (B2C)
Para mitigar accesos indebidos a los endpoints B2C y al almacenamiento de archivos, se utilizan políticas dinámicas de CORS:
* **Lista Blanca de Orígenes (`ALLOWED_ORIGINS`)**: Variable en `.env` (separada por comas, ej: `http://localhost:3000,https://digitalagil.es`) que restringe dinámicamente qué clientes web pueden realizar peticiones al microservicio, rechazando accesos con comodín general (`*`).

### Endpoints Disponibles
- **GET /ping**: Endpoint de salud y diagnóstico básico.
  - **Respuesta**: `{ "status": "ok", "message": "Azul ATS API operativa" }`
- **POST /api/v1/busquedas** 🔒 *(Ruta protegida)*: Crea una nueva búsqueda en el ATS y gatilla la Escritura Dual física en Firestore y BigQuery.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT emitido por Firebase Auth).
    * `HTTP 401 Unauthorized`: Si el header `Authorization` está ausente.
    * `HTTP 403 Forbidden`: Si el token es inválido o ha expirado.
  - **Cuerpo de la Petición (JSON) - Los 6 campos son obligatorios**:
    ```json
    {
      "cliente": "Azul ATS",
      "perfil_busqueda": "Desarrollador Backend Node.js",
      "estado_fase": "Reclutamiento",
      "responsable_operativo": "David C.",
      "responsable_validacion": "Sofía M.",
      "fecha_inicio_objetivo": "2026-08-01"
    }
    ```
  - **Enriquecimiento del Dato**: El controlador añade automáticamente tres propiedades adicionales al objeto de persistencia final:
    * `metricas_tracking: { dias_previstos_previa: 3, busqueda_avance: 0 }`
    * `contexto_ia: { prompt_base: "Analizar perfil según requisitos técnicos de la vacante." }`
    * `fecha_creacion`: Marca de tiempo en formato ISO de la fecha del sistema (`new Date().toISOString()`).
  - **Validación de campos**: Si falta alguno de los 6 parámetros requeridos en el cuerpo, el servidor responde con un código `HTTP 400 Bad Request`.
  - **Gestión de Respuestas Transaccionales (Manejo de Errores)**:
    * **HTTP 201 Created**: Escritura exitosa tanto en Firestore como en BigQuery.
    * **HTTP 207 Multi-Status**: Sincronización parcial. Éxito en un sistema, pero fallo en el otro. Permite identificar fallos parciales de consistencia sin abortar la operación transaccional.
    * **HTTP 500 Internal Server Error**: Error de sincronización crítico. Ambas promesas han sido rechazadas.
- **GET /api/v1/busquedas** 🔒 *(Ruta protegida)*: Lista todas las búsquedas almacenadas en Firestore.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT emitido por Firebase Auth).
    * `HTTP 401 Unauthorized`: Si el header `Authorization` está ausente.
    * `HTTP 403 Forbidden`: Si el token es inválido o ha expirado.
  - **Respuesta exitosa** (`HTTP 200 OK`):
    ```json
    { "status": "success", "total": 3, "data": [ { "id": "<firestore_id>", "cliente": "...", "..." } ] }
    ```
- **PATCH /api/v1/busquedas/:id** 🔒 *(Ruta protegida)*: Actualiza campos parciales de una búsqueda con Dual Write.
  - **Autenticación requerida**: Header `Authorization: Bearer <token_firebase>` (JWT emitido por Firebase Auth).
    * `HTTP 401 Unauthorized`: Si el header `Authorization` está ausente.
    * `HTTP 403 Forbidden`: Si el token es inválido o ha expirado.
  - **Parámetro de ruta**: `:id` — ID del documento en Firestore.
  - **Cuerpo de la Petición (JSON)**: Cualquier subconjunto de campos a modificar.
  - **Dual Write**: Si el body contiene `estado_fase`, se ejecuta un `UPDATE` DML parametrizado en BigQuery (`ultra-bearing-492817-k6.db_reclutamiento1.maestro_busquedas`) para prevenir inyección SQL. Si no hay cambio de estado, la promesa analítica se omite automáticamente.
  - **Respuestas transaccionales**: `HTTP 200 OK` éxito total, `HTTP 207 Multi-Status` fallo parcial, `HTTP 500` fallo crítico.
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
  - **Respuestas**:
    - `HTTP 200 OK` (Fase 2 Mock): Retorna la confirmación y los metadatos del archivo.
    - `HTTP 400 Bad Request`: Si no se adjunta el archivo cv, si el archivo excede los 5MB, posee una extensión no permitida, faltan campos obligatorios o si `acepta_privacidad` no es evaluado como `true`.
    - `HTTP 403 Forbidden`: Si la petición web es de origen no autorizado (error de CORS).

## Instrucciones de Despliegue (CI/CD)

El microservicio está diseñado para ser contenerizado mediante Docker y desplegado en **Google Cloud Run**.

* **Plataforma de despliegue**: Google Cloud Run
* **Región de despliegue**: `us-east1` (por Argentina y España)
* **Contenerización**: Docker — imagen base `node:24-alpine`
* **Seguridad**: `--allow-unauthenticated` a nivel de Cloud Run (la seguridad se gestiona internamente con el middleware JWT `verificarToken`).

### Comandos de Despliegue (producción)

```bash
# 1. Autenticarse con Google Cloud (solo la primera vez o al renovar sesión)
gcloud auth login

# 2. Seleccionar el proyecto de Firebase/Firestore como proyecto activo
gcloud config set project azul-ats-1

# 3. Desplegar el servicio en Cloud Run (build + push + deploy automatizados)
#    Las variables de entorno se inyectan directamente en el contenedor
gcloud run deploy azulats-service1 \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=azul-ats-1,BIGQUERY_PROJECT_ID=ultra-bearing-492817-k6
```

> **Nota**: el comando `--source .` activa Cloud Build en remoto, que ejecuta el `Dockerfile` incluido en el repositorio. Las variables sensibles como `BIGQUERY_PROJECT_ID` no se incluyen en la imagen — solo se inyectan en el entorno de ejecución del contenedor.

### Notas para desarrollo local
Levantar el servicio local, en la terminal: `npm start`
Prueba: `curl -i http://localhost:8080/ping` debe dar ok operativa

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


---
## Log de Cambios (Changelog)

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
