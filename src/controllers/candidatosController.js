import { db, bucket } from '../config/firebase.js';
import crypto from 'crypto';

/**
 * Controlador para el registro de candidatos B2C de forma segura.
 * Carga archivo en Firebase Storage y persiste datos en Firestore.
 * Implementa Rollback automático de binario si falla la base de datos Firestore.
 */
export const registrarCandidato = async (req, res) => {
  const { nombre_completo, email, acepta_privacidad, puesto_postulacion, linkedin_url, origen } = req.body;
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
      createdAt: new Date().toISOString()
    };

    try {
      await db.collection('postulantes').doc(candidatoId).set(candidatoData);

      return res.status(201).json({
        status: 'success',
        message: 'Postulación registrada con éxito en todos los sistemas.',
        data: {
          id: candidatoId,
          nombre_completo,
          email,
          puesto_postulacion: candidatoData.puesto_postulacion,
          url_cv: gsUri
        }
      });

    } catch (firestoreError) {
      // 3. Rollback de almacenamiento físico ante falla en Base de Datos Firestore (Archivo huérfano)
      console.error(`Error de guardado en Firestore para candidato ${candidatoId}. Iniciando rollback de Storage...`);
      try {
        await fileRef.delete();
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
