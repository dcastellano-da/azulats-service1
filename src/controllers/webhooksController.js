import { simpleParser } from 'mailparser';
import crypto from 'crypto';
import { z } from 'zod';
import { db, bucket } from '../config/firebase.js';
import { deleteFile } from '../services/storageService.js';
import { ai, modelRef } from '../config/genkit.js';

// Esquema Zod para forzar la salida estructurada de Gemini con Genkit
const ExtraccionCandidatoSchema = z.object({
  nombre_completo: z.string().describe('Nombre completo del candidato.'),
  email: z.string().describe('Dirección de correo electrónico de contacto.'),
  telefono_movil: z.string().nullable().describe('Número de teléfono celular o móvil.'),
  ubicacion: z.string().nullable().describe('Ubicación de residencia (ej: Ciudad, País).'),
  skills_principales: z.string().nullable().describe('Lista de 3 a 5 palabras clave de habilidades técnicas principales, separadas únicamente por comas.'),
  nivel_ingles: z.string().nullable().describe('Nivel de inglés.'),
  otros_idiomas: z.string().nullable().describe('Idiomas adicionales.'),
  linkedin_url: z.string().nullable().describe('URL completa del perfil de LinkedIn.'),
  notas_iniciales: z.string().nullable().describe('Extracto profesional o notas del evaluador de IA.'),
  resumen: z.string().nullable().describe('Un resumen profesional o perfil amplio que describe al candidato en el CV.'),
  rubros: z.string().nullable().describe('Rubros o mercados de las empresas donde se desempeñó el candidato (ej: Finanzas, Minería, Automotriz), separados únicamente por comas.'),
  canal_ingreso: z.string().nullable().describe('Canal o fuente de reclutamiento.')
});

/**
 * MimeTypes y extensiones permitidas para archivos CV de candidatos
 */
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];
const ALLOWED_EXTENSIONS_REGEX = /\.(pdf|doc|docx)$/i;

/**
 * Función auxiliar para verificar si un valor está presente y no es vacío/nulo en string
 */
const isPresent = (val) => val !== undefined && val !== null && String(val).trim() !== '' && String(val) !== 'null' && String(val) !== 'undefined';

/**
 * Extrae una dirección de email válida desde un texto o cabecera
 */
const extractEmailAddress = (rawFrom) => {
  if (!rawFrom) return null;
  const match = String(rawFrom).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
};

/**
 * POST /api/v1/webhooks/inbound-cv
 *
 * Procesa webhooks entrantes de SendGrid Inbound Parse ("POST raw MIME message").
 * 1. Parsea el mensaje MIME.
 * 2. Extrae y filtra adjuntos buscando CV (PDF, DOC, DOCX).
 * 3. Si no hay CV válido, retorna HTTP 200 { status: 'ignored' } para evitar reintentos de SendGrid.
 * 4. Analiza el CV mediante Genkit (Gemini 2.5 Flash).
 * 5. Si la IA no detecta email en el CV, aplica fallback al email remitente (From).
 * 6. Sube el CV a Firebase Storage y persiste en Firestore con origen "Email - Espontáneo" y estado "pendiente".
 */
export const procesarInboundCV = async (req, res) => {
  try {
    let attachments = [];
    let senderEmail = null;
    let emailSubject = 'Candidatura Espontánea por Email';

    // 1. Obtener contenido MIME desde req.body.email (SendGrid Raw MIME) o req.files / req.body
    if (req.body && req.body.email) {
      const parsed = await simpleParser(req.body.email);

      emailSubject = parsed.subject || emailSubject;

      if (parsed.from) {
        if (parsed.from.value && parsed.from.value.length > 0) {
          senderEmail = parsed.from.value[0].address;
        } else if (parsed.from.text) {
          senderEmail = extractEmailAddress(parsed.from.text);
        }
      }

      attachments = (parsed.attachments || []).map(att => ({
        filename: att.filename || 'cv.pdf',
        mimetype: att.contentType,
        buffer: att.content
      }));
    } else if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      // Fallback si Multer captura directamente los archivos de la petición multipart
      attachments = req.files.map(f => ({
        filename: f.originalname,
        mimetype: f.mimetype,
        buffer: f.buffer
      }));
      senderEmail = extractEmailAddress(req.body?.from || req.body?.envelope);
    }

    // 2. Filtrar adjuntos buscando un archivo CV válido (PDF/DOC/DOCX)
    const validAttachment = attachments.find(att =>
      ALLOWED_MIME_TYPES.includes(att.mimetype) || ALLOWED_EXTENSIONS_REGEX.test(att.filename)
    );

    if (!validAttachment) {
      console.info('[INBOUND CV] Correo procesado sin adjunto CV válido. Respondiendo HTTP 200 descartado.');
      return res.status(200).json({
        status: 'ignored',
        message: 'No se encontró ningún archivo CV válido (PDF, DOC, DOCX) adjunto en el correo.'
      });
    }

    console.info(`[INBOUND CV] Archivo CV detectado: ${validAttachment.filename} (${validAttachment.mimetype}). Procesando con IA...`);

    // 3. Inferencia mediante Firebase Genkit + Gemini 2.5 Flash
    let extractedData = {};
    try {
      const base64File = validAttachment.buffer.toString('base64');
      const dataUrl = `data:${validAttachment.mimetype};base64,${base64File}`;

      const response = await ai.generate({
        model: modelRef,
        prompt: [
          {
            media: {
              url: dataUrl,
              contentType: validAttachment.mimetype
            }
          },
          { text: 'Analiza detalladamente este CV y extrae de forma estructurada los campos requeridos.' }
        ],
        output: { schema: ExtraccionCandidatoSchema }
      });

      extractedData = response.output || {};
    } catch (aiError) {
      console.error('[INBOUND CV ERROR] Error durante la extracción de datos con Genkit Vertex AI:', aiError.message);
      // No interrumpimos totalmente si podemos aplicar fallbacks mínimos
    }

    // 4. Determinar Email final del candidato con Fallback al Remitente del Email
    const extractedEmailValid = extractEmailAddress(extractedData.email);
    const emailFinal = extractedEmailValid || senderEmail;

    if (!emailFinal) {
      console.warn('[INBOUND CV WARNING] No se pudo determinar el email del candidato ni del CV ni del remitente.');
      return res.status(400).json({
        status: 'error',
        message: 'No se pudo identificar una dirección de correo electrónico válida para el candidato.'
      });
    }

    const nombreCompletoFinal = isPresent(extractedData.nombre_completo)
      ? extractedData.nombre_completo
      : (senderEmail ? senderEmail.split('@')[0] : 'Candidato Espontáneo');

    // 5. Cargar archivo al bucket de Firebase Storage
    const candidatoId = crypto.randomUUID();
    const originalNameClean = validAttachment.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `cvs/${candidatoId}_${originalNameClean}`;
    const fileRef = bucket.file(storagePath);

    try {
      const blobStream = fileRef.createWriteStream({
        metadata: {
          contentType: validAttachment.mimetype,
          metadata: {
            candidatoId: candidatoId,
            email: emailFinal,
            origen: 'Email - Espontáneo'
          }
        }
      });

      await new Promise((resolve, reject) => {
        blobStream.on('error', (err) => reject(err));
        blobStream.on('finish', () => resolve());
        blobStream.end(validAttachment.buffer);
      });

      const gsUri = `gs://${bucket.name}/${storagePath}`;

      // 6. Persistir en Firestore (Colección: postulantes)
      const candidatoData = {
        id: candidatoId,
        nombre_completo: nombreCompletoFinal,
        email: emailFinal,
        acepta_privacidad: true,
        puesto_postulacion: 'Candidatura Espontánea',
        linkedin_url: isPresent(extractedData.linkedin_url) ? extractedData.linkedin_url : null,
        origen: 'Email - Espontáneo',
        url_cv: gsUri,
        estado_revision: 'pendiente',
        createdAt: new Date().toISOString(),
        telefono_movil: isPresent(extractedData.telefono_movil) ? extractedData.telefono_movil : null,
        ubicacion: isPresent(extractedData.ubicacion) ? extractedData.ubicacion : null,
        skills_principales: isPresent(extractedData.skills_principales) ? extractedData.skills_principales : null,
        nivel_ingles: isPresent(extractedData.nivel_ingles) ? extractedData.nivel_ingles : null,
        otros_idiomas: isPresent(extractedData.otros_idiomas) ? extractedData.otros_idiomas : null,
        notas_iniciales: isPresent(extractedData.notas_iniciales) ? extractedData.notas_iniciales : `Importado vía Email: "${emailSubject}"`,
        resumen: isPresent(extractedData.resumen) ? extractedData.resumen : null,
        rubros: isPresent(extractedData.rubros) ? extractedData.rubros : null,
        canal_ingreso: 'Email'
      };

      try {
        await db.collection('postulantes').doc(candidatoId).set(candidatoData);

        console.info(`[SUCCESS] Candidatura espontánea registrada exitosamente. UUID: ${candidatoId} | Email: ${emailFinal}`);

        return res.status(201).json({
          status: 'success',
          message: 'Candidatura espontánea recibida y procesada correctamente.',
          data: candidatoData
        });

      } catch (firestoreError) {
        // Rollback de almacenamiento físico ante falla en Firestore
        console.error('[INBOUND CV ROLLBACK] Fallo al guardar candidato en Firestore. Eliminando archivo huérfano:', firestoreError.message);
        try {
          await deleteFile(storagePath);
        } catch (storageDeleteError) {
          console.error(`[FATAL ROLLBACK ERROR] Fallo al eliminar ${storagePath}:`, storageDeleteError.message);
        }

        return res.status(500).json({
          status: 'error',
          message: 'Error al registrar la candidatura espontánea en la base de datos.',
          detail: firestoreError.message
        });
      }

    } catch (storageUploadError) {
      console.error('[INBOUND CV STORAGE ERROR] Error al subir archivo a Firebase Storage:', storageUploadError.message);
      return res.status(500).json({
        status: 'error',
        message: 'Error al subir el archivo CV al almacenamiento en la nube.',
        detail: storageUploadError.message
      });
    }

  } catch (error) {
    console.error('[INBOUND CV UNHANDLED ERROR] Error inesperado procesando webhook:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor al procesar el correo entrante.',
      detail: error.message
    });
  }
};
