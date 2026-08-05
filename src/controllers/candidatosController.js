import { db } from '../config/firebase.js';
import crypto from 'crypto';
import { deleteFile, deleteFileFromGsUri } from '../services/storageService.js';
import { bucket } from '../config/firebase.js';
import { z } from 'zod';
import { ai, modelRef } from '../config/genkit.js';

/**
 * Controlador para el registro de candidatos B2C de forma segura.
 * Carga archivo en Firebase Storage y persiste datos en Firestore.
 * Implementa Rollback automático de binario si falla la base de datos Firestore.
 */
export const registrarCandidato = async (req, res) => {
  const {
    nombre_completo,
    email,
    acepta_privacidad,
    puesto_postulacion,
    linkedin_url,
    origen,
    estado_revision,
    telefono_movil,
    ubicacion,
    skills_principales,
    nivel_ingles,
    otros_idiomas,
    notas_iniciales,
    resumen,
    rubros,
    canal_ingreso
  } = req.body;
  const file = req.file;

  // Blindaje duplicado del controlador para verificar campos requeridos
  if (!file) {
    return res.status(400).json({
      status: 'error',
      message: 'El archivo CV (pdf, doc, docx) es obligatorio en el campo "cv".'
    });
  }

  if (!nombre_completo || !email || acepta_privacidad === undefined) {
    return res.status(400).json({
      status: 'error',
      message: 'Los campos nombre_completo, email y acepta_privacidad son obligatorios.'
    });
  }

  const aceptaPrivacidadBool = acepta_privacidad === true || acepta_privacidad === 'true';
  if (!aceptaPrivacidadBool) {
    return res.status(400).json({
      status: 'error',
      message: 'Debe aceptar las políticas de privacidad para postularse (acepta_privacidad debe ser true).'
    });
  }

  const isPresent = (val) => val !== undefined && val !== null && String(val).trim() !== '' && String(val) !== 'null' && String(val) !== 'undefined';

  // Validación de skills_principales si no está vacío/nulo
  if (isPresent(skills_principales)) {
    const list = String(skills_principales).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length < 3 || list.length > 5) {
      return res.status(400).json({
        status: 'error',
        message: 'Las skills principales deben contener entre 3 y 5 etiquetas/habilidades separadas por comas.'
      });
    }
  }

  // Generar ID único de candidato y sanitizar el nombre del archivo
  const candidatoId = crypto.randomUUID();
  const originalNameClean = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `cvs/${candidatoId}_${originalNameClean}`;
  const fileRef = bucket.file(storagePath);

  try {
    // 1. Cargar archivo al bucket de Firebase Storage en memoria
    const blobStream = fileRef.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        metadata: {
          candidatoId: candidatoId,
          email: email
        }
      }
    });

    await new Promise((resolve, reject) => {
      blobStream.on('error', (err) => reject(err));
      blobStream.on('finish', () => resolve());
      blobStream.end(file.buffer);
    });

    // Construcción de la URL canónica tipo gs://
    const gsUri = `gs://${bucket.name}/${storagePath}`;

    // 2. Persistir datos del candidato en Firestore (Colección: postulantes)
    const candidatoData = {
      id: candidatoId,
      nombre_completo,
      email,
      acepta_privacidad: true,
      puesto_postulacion: puesto_postulacion || 'No especificado',
      linkedin_url: linkedin_url || null,
      origen: origen || 'directo',
      url_cv: gsUri,
      estado_revision: estado_revision || 'pendiente',
      createdAt: new Date().toISOString(),
      telefono_movil: isPresent(telefono_movil) ? telefono_movil : null,
      ubicacion: isPresent(ubicacion) ? ubicacion : null,
      skills_principales: isPresent(skills_principales) ? skills_principales : null,
      nivel_ingles: isPresent(nivel_ingles) ? nivel_ingles : null,
      otros_idiomas: isPresent(otros_idiomas) ? otros_idiomas : null,
      notas_iniciales: isPresent(notas_iniciales) ? notas_iniciales : null,
      resumen: isPresent(resumen) ? resumen : null,
      rubros: isPresent(rubros) ? rubros : null,
      canal_ingreso: isPresent(canal_ingreso) ? canal_ingreso : null
    };

    try {
      await db.collection('postulantes').doc(candidatoId).set(candidatoData);

      console.info(`[SUCCESS] Postulación registrada exitosamente. UUID: ${candidatoId} | Origen: ${candidatoData.origen}`);

      return res.status(201).json({
        status: 'success',
        message: 'Postulación registrada con éxito en todos los sistemas.',
        data: {
          id: candidatoId,
          nombre_completo,
          email,
          puesto_postulacion: candidatoData.puesto_postulacion,
          url_cv: gsUri,
          estado_revision: candidatoData.estado_revision,
          telefono_movil: candidatoData.telefono_movil,
          ubicacion: candidatoData.ubicacion,
          skills_principales: candidatoData.skills_principales,
          nivel_ingles: candidatoData.nivel_ingles,
          otros_idiomas: candidatoData.otros_idiomas,
          notas_iniciales: candidatoData.notas_iniciales,
          resumen: candidatoData.resumen,
          rubros: candidatoData.rubros,
          canal_ingreso: candidatoData.canal_ingreso
        }
      });

    } catch (firestoreError) {
      // 3. Rollback de almacenamiento físico ante falla en Base de Datos Firestore (Archivo huérfano)
      console.error("[ERROR] Fallo transaccional en pasarela de candidatos. Iniciando Rollback. Causa: ", firestoreError.message);
      try {
        await deleteFile(storagePath);
        console.log(`Rollback completado de forma exitosa de archivo huérfano: ${storagePath}`);
      } catch (storageDeleteError) {
        console.error(`Error FATAL: No se pudo eliminar el archivo huérfano en rollback (${storagePath}):`, storageDeleteError);
      }

      return res.status(500).json({
        status: 'error',
        message: 'Fallo al guardar el perfil del candidato en la base de datos. Se ejecutó el rollback de archivo en la nube.',
        detail: firestoreError.message
      });
    }

  } catch (storageUploadError) {
    console.error(`Error al cargar el archivo en Firebase Storage:`, storageUploadError);
    return res.status(500).json({
      status: 'error',
      message: 'Error al subir el archivo CV al almacenamiento en la nube.',
      detail: storageUploadError.message
    });
  }
};

/**
 * GET /api/v1/candidatos
 * Lista y previsualiza los candidatos espontáneos desde Firestore.
 * Soporta filtrado opcional por el parámetro query `estado_revision`.
 * Ordenación por defecto descendente según `createdAt`.
 */
export const obtenerCandidatos = async (req, res) => {
  const { estado_revision } = req.query;

  try {
    let query = db.collection('postulantes');

    if (estado_revision) {
      query = query.where('estado_revision', '==', estado_revision);
    }

    // Requiere índice compuesto en Firestore si se combina con filtros
    query = query.orderBy('createdAt', 'desc');

    const snapshot = await query.get();
    const candidatos = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json({
      status: 'success',
      total: candidatos.length,
      data: candidatos
    });
  } catch (error) {
    console.error('[ERROR] Error al recuperar candidatos desde Firestore:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Error al recuperar los candidatos de la base de datos.',
      detail: error.message
    });
  }
};

/**
 * PATCH /api/v1/candidatos/:id
 * Actualiza parcialmente la ficha de un candidato.
 * Restringe la edición a campos mutables autorizados para proteger la trazabilidad.
 */
export const actualizarCandidato = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El parámetro id de candidato es obligatorio.'
    });
  }

  if (!updates || Object.keys(updates).length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'El cuerpo de la petición no puede estar vacío.'
    });
  }

  // Control estricto de mutabilidad (Bloqueo de Inyección)
  const keys = Object.keys(updates);
  const strictlyAllowed = [
    'estado_revision',
    'nombre_completo',
    'email',
    'linkedin_url',
    'telefono_movil',
    'ubicacion',
    'skills_principales',
    'nivel_ingles',
    'otros_idiomas',
    'notas_iniciales',
    'resumen',
    'rubros',
    'canal_ingreso',
    'puesto_postulacion'
  ];
  const hasInvalidKey = keys.some(key => !strictlyAllowed.includes(key));

  if (hasInvalidKey) {
    return res.status(400).json({
      status: 'error',
      message: 'Intento de modificar campos no permitidos o inmutables (como acepta_privacidad, url_cv, origen o createdAt).'
    });
  }

  const isPresent = (val) => val !== undefined && val !== null && String(val).trim() !== '' && String(val) !== 'null' && String(val) !== 'undefined';

  // Validación de skills_principales si no está vacío/nulo en la actualización
  if ('skills_principales' in updates && isPresent(updates.skills_principales)) {
    const list = String(updates.skills_principales).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length < 3 || list.length > 5) {
      return res.status(400).json({
        status: 'error',
        message: 'Las skills principales deben contener entre 3 y 5 etiquetas/habilidades separadas por comas.'
      });
    }
  }

  // Normalizar valores vacíos/nulos para persistir consistentemente
  const mappedUpdates = { ...updates };
  for (const field of ['telefono_movil', 'ubicacion', 'skills_principales', 'nivel_ingles', 'otros_idiomas', 'notas_iniciales', 'linkedin_url', 'resumen', 'rubros', 'canal_ingreso']) {
    if (field in mappedUpdates) {
      mappedUpdates[field] = isPresent(mappedUpdates[field]) ? mappedUpdates[field] : null;
    }
  }
  if ('puesto_postulacion' in mappedUpdates) {
    mappedUpdates.puesto_postulacion = isPresent(mappedUpdates.puesto_postulacion) ? mappedUpdates.puesto_postulacion : 'No especificado';
  }

  try {
    const candidateRef = db.collection('postulantes').doc(id);
    const doc = await candidateRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        status: 'error',
        message: 'No se encontró el candidato especificado.'
      });
    }

    const payload = {
      ...mappedUpdates,
      updatedAt: new Date().toISOString()
    };

    await candidateRef.update(payload);

    return res.status(200).json({
      status: 'success',
      message: 'Ficha del candidato actualizada exitosamente.',
      data: {
        id,
        ...payload
      }
    });

  } catch (error) {
    console.error('[ERROR] Error al actualizar la ficha del candidato:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Error al actualizar el candidato en la base de datos.',
      detail: error.message
    });
  }
};

/*
// MEJORA FUTURA: Habilitar borrado físico para Super Administrador (cumplimiento RGPD / Derecho al olvido)
// Para su activación futura, descomuntar esta lógica, agregar la exportación e integrarla en rutas.
export const eliminarCandidatoFisico = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El parámetro id de candidato es obligatorio.'
    });
  }

  // Evaluar privilegios de administrador: email terminando en ".es" o claim rol === "Super Administrador"
  const isSuperAdmin = req.user.rol === 'Super Administrador' ||
                       req.user.role === 'Super Administrador' ||
                       (req.user.email && req.user.email.endsWith('.es'));

  if (!isSuperAdmin) {
    return res.status(403).json({
      status: 'error',
      message: 'Acceso denegado. Se requieren permisos de Super Administrador.'
    });
  }

  try {
    const candidateRef = db.collection('postulantes').doc(id);
    const doc = await candidateRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        status: 'error',
        message: 'No se encontró el candidato especificado.'
      });
    }

    const candidateData = doc.data();
    const gsUri = candidateData.url_cv;

    // 1. Invocar eliminación silenciosa del PDF en Storage
    if (gsUri) {
      try {
        await deleteFileFromGsUri(gsUri);
      } catch (storageError) {
        console.error('[HARD DELETE ERROR] Fallo al eliminar binario de Storage:', storageError.message);
        return res.status(500).json({
          status: 'error',
          message: 'Error al eliminar el archivo CV de Storage. Borrado de base de datos abortado.',
          detail: storageError.message
        });
      }
    }

    // 2. Tras éxito de borrado en Storage, eliminar documento respectivo en Firestore
    await candidateRef.delete();

    console.info(`[SUCCESS] Candidato eliminado físicamente (Hard Delete) de forma exitosa. ID: ${id}`);
    return res.status(200).json({
      status: 'success',
      message: 'Candidato y su CV asociado eliminados permanentemente del sistema.'
    });

  } catch (error) {
    console.error('[HARD DELETE ERROR] Error durante la transacción de eliminación física:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor durante la eliminación del candidato.',
      detail: error.message
    });
  }
};
*/

/**
 * GET /api/v1/candidatos/:id/cv
 * Descarga y transmite (stream) el archivo CV PDF del candidato desde Firebase Storage
 * utilizando credenciales de servicio (Admin SDK) para evitar problemas de permisos de cliente.
 */
export const obtenerDocumentoCV = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      status: 'error',
      message: 'El parámetro id de candidato es obligatorio.'
    });
  }

  try {
    const candidateRef = db.collection('postulantes').doc(id);
    const doc = await candidateRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        status: 'error',
        message: 'No se encontró el candidato especificado.'
      });
    }

    const candidateData = doc.data();
    const gsUri = candidateData.url_cv;

    if (!gsUri) {
      return res.status(404).json({
        status: 'error',
        message: 'El candidato no tiene un archivo CV registrado.'
      });
    }

    const prefix = `gs://${bucket.name}/`;
    if (!gsUri.startsWith(prefix)) {
      return res.status(400).json({
        status: 'error',
        message: 'El URI de Storage no pertenece al bucket configurado en el servidor.'
      });
    }

    const storagePath = gsUri.substring(prefix.length);
    const fileRef = bucket.file(storagePath);

    // Verificar si el archivo existe en el Storage
    const [exists] = await fileRef.exists();
    if (!exists) {
      return res.status(404).json({
        status: 'error',
        message: 'El archivo CV no existe físicamente en el almacenamiento de Firebase.'
      });
    }

    const [metadata] = await fileRef.getMetadata();
    const contentType = metadata.contentType || 'application/pdf';

    // Establecer Content-Type correcto y disposición inline para lectura directa en navegador
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${storagePath.split('/').pop()}"`);

    // Stream del archivo directo al cliente
    const readStream = fileRef.createReadStream();
    readStream.on('error', (streamError) => {
      console.error('[STREAM ERROR] Error en la transferencia del archivo:', streamError.message);
      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          message: 'Error al transmitir la lectura del archivo desde Firebase Storage.'
        });
      }
    });

    readStream.pipe(res);

  } catch (error) {
    console.error('[CV CONTROLLER ERROR] Error al intentar de obtener CV:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo interno al procesar e iniciar la descarga del CV.',
      detail: error.message
    });
  }
};

// Esquema Zod para forzar la salida estructurada de Gemini con Genkit
const ExtraccionCandidatoSchema = z.object({
  nombre_completo: z.string().describe('Nombre completo del candidato.'),
  email: z.string().describe('Dirección de correo electrónico de contacto.'),
  telefono_movil: z.string().nullable().describe('Número de teléfono celular o móvil.'),
  ubicacion: z.string().nullable().describe('Ubicación de residencia (ej: Ciudad, País).'),
  skills_principales: z.string().nullable().describe('Lista de 3 a 5 palabras clave de habilidades técnicas principales, separadas únicamente por comas. Debe tener entre 3 y 5 habilidades.'),
  nivel_ingles: z.string().nullable().describe('Nivel de inglés.'),
  otros_idiomas: z.string().nullable().describe('Idiomas adicionales.'),
  linkedin_url: z.string().nullable().describe('URL completa del perfil de LinkedIn.'),
  notas_iniciales: z.string().nullable().describe('Extracto profesional o notas del evaluador de IA.'),
  resumen: z.string().nullable().describe('Un resumen profesional o perfil amplio que describe al candidato en el CV.'),
  rubros: z.string().nullable().describe('Rubros o mercados de las empresas donde se desempeñó el candidato (ej: Finanzas, Minería, Automotriz), separados únicamente por comas.'),
  canal_ingreso: z.string().nullable().describe('Canal o fuente de reclutamiento (ej: LinkedIn, Portal Web, Referido, Headhunting).')
});

/**
 * POST /api/v1/candidatos/importar-ia
 * Orquesta la extracción de datos mediante Gemini 1.5 Flash (Genkit) y
 * realiza la carga en Cloud Storage y Firestore en un solo flujo transaccional con rollback.
 */
export const importarCandidatoIA = async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({
      status: 'error',
      message: 'El archivo CV (pdf, doc, docx) es obligatorio en el campo "cv".'
    });
  }

  const isPresent = (val) => val !== undefined && val !== null && String(val).trim() !== '' && String(val) !== 'null' && String(val) !== 'undefined';

  let extractedData;

  // 1. Inferencia mediante Firebase Genkit + Vertex AI
  try {
    const base64File = file.buffer.toString('base64');
    const dataUrl = `data:${file.mimetype};base64,${base64File}`;

    const response = await ai.generate({
      model: modelRef,
      prompt: [
        {
          media: {
            url: dataUrl,
            contentType: file.mimetype
          }
        },
        { text: 'Analiza detalladamente este CV y extrae de forma estructurada los campos requeridos.' }
      ],
      output: { schema: ExtraccionCandidatoSchema }
    });

    extractedData = response.output;
  } catch (aiError) {
    console.error('[ERROR] Error durante la extracción de datos con Genkit Vertex AI: ', aiError.message);
    return res.status(500).json({
      status: 'error',
      message: 'Fallo al procesar el archivo mediante Inteligencia Artificial (Genkit).',
      detail: aiError.message
    });
  }

  if (!extractedData) {
    return res.status(400).json({
      status: 'error',
      message: 'No se pudo generar respuesta de extracción estructurada desde el modelo de IA.'
    });
  }

  // Validación de campos mínimos obligatorios extraídos
  if (!extractedData.nombre_completo || !extractedData.email) {
    return res.status(400).json({
      status: 'error',
      message: 'La Inteligencia Artificial no pudo extraer de manera obligatoria el nombre completo o el correo electrónico del currículum.',
      extracted: extractedData
    });
  }

  // Validación de skills_principales (3-5 items si está presente)
  if (isPresent(extractedData.skills_principales)) {
    const list = String(extractedData.skills_principales).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length < 3 || list.length > 5) {
      return res.status(400).json({
        status: 'error',
        message: `Las skills principales extraídas no contienen entre 3 y 5 etiquetas (Encontradas: ${list.length}). Extracción: ${extractedData.skills_principales}`
      });
    }
  }

  // Generar ID único de candidato y sanitizar nombre de archivo
  const candidatoId = crypto.randomUUID();
  const originalNameClean = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
  const storagePath = `cvs/${candidatoId}_${originalNameClean}`;
  const fileRef = bucket.file(storagePath);

  // 2. Cargar archivo al bucket de Firebase Storage en memoria
  try {
    const blobStream = fileRef.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        metadata: {
          candidatoId: candidatoId,
          email: extractedData.email,
          origen: 'importacion_ia'
        }
      }
    });

    await new Promise((resolve, reject) => {
      blobStream.on('error', (err) => reject(err));
      blobStream.on('finish', () => resolve());
      blobStream.end(file.buffer);
    });

    // Construcción de la URL canónica tipo gs://
    const gsUri = `gs://${bucket.name}/${storagePath}`;

    // 3. Persistir datos del candidato en Firestore (Colección: postulantes)
    const candidatoData = {
      id: candidatoId,
      nombre_completo: extractedData.nombre_completo,
      email: extractedData.email,
      acepta_privacidad: true,
      puesto_postulacion: 'No especificado',
      linkedin_url: extractedData.linkedin_url || null,
      origen: 'importacion_ia',
      url_cv: gsUri,
      estado_revision: 'pendiente',
      createdAt: new Date().toISOString(),
      telefono_movil: isPresent(extractedData.telefono_movil) ? extractedData.telefono_movil : null,
      ubicacion: isPresent(extractedData.ubicacion) ? extractedData.ubicacion : null,
      skills_principales: isPresent(extractedData.skills_principales) ? extractedData.skills_principales : null,
      nivel_ingles: isPresent(extractedData.nivel_ingles) ? extractedData.nivel_ingles : null,
      otros_idiomas: isPresent(extractedData.otros_idiomas) ? extractedData.otros_idiomas : null,
      notas_iniciales: isPresent(req.body.notas_iniciales) ? req.body.notas_iniciales : (isPresent(extractedData.notas_iniciales) ? extractedData.notas_iniciales : null),
      resumen: isPresent(extractedData.resumen) ? extractedData.resumen : null,
      rubros: isPresent(extractedData.rubros) ? extractedData.rubros : null,
      canal_ingreso: isPresent(req.body.canal_ingreso) ? req.body.canal_ingreso : (isPresent(extractedData.canal_ingreso) ? extractedData.canal_ingreso : null)
    };

    try {
      await db.collection('postulantes').doc(candidatoId).set(candidatoData);

      console.info(`[SUCCESS] Postulación vía IA importada exitosamente. UUID: ${candidatoId} | Origen: ${candidatoData.origen}`);

      return res.status(201).json({
        status: 'success',
        message: 'Postulación registrada con éxito tras extracción con IA.',
        data: candidatoData
      });

    } catch (firestoreError) {
      // 4. Rollback de almacenamiento físico ante fallo en Base de Datos Firestore (Archivo huérfano)
      console.error("[ERROR] Fallo transaccional en importación de candidatos con IA. Iniciando Rollback. Causa: ", firestoreError.message);
      try {
        await deleteFile(storagePath);
        console.log(`Rollback completado de forma exitosa de archivo huérfano: ${storagePath}`);
      } catch (storageDeleteError) {
        console.error(`Error FATAL: No se pudo eliminar el archivo huérfano en rollback (${storagePath}):`, storageDeleteError);
      }

      return res.status(500).json({
        status: 'error',
        message: 'Fallo al guardar el candidato en la base de datos tras la extracción de IA. Se ejecutó el rollback de archivo en la nube.',
        detail: firestoreError.message
      });
    }

  } catch (storageUploadError) {
    console.error(`Error al cargar el archivo en Firebase Storage durante importación IA:`, storageUploadError);
    return res.status(500).json({
      status: 'error',
      message: 'Error al subir el archivo CV al almacenamiento en la nube.',
      detail: storageUploadError.message
    });
  }
};

