import { db, bucket } from '../config/firebase.js';
import { z } from 'zod';

const DEFAULT_CONFIG_AGENCIA = {
  id: 'p-cfg-01',
  nombre_comercial: 'Azul ATS Agency',
  logo_url: null,
  color_primario: '#1e3a8a',
  sello_texto: 'Powered by Azul ATS',
  email_contacto: null,
  telefono_contacto: null,
  direccion: null,
  updatedAt: null
};

const ConfiguracionAgenciaSchema = z.object({
  nombre_comercial: z.string().min(1, 'El nombre comercial de la agencia no puede estar vacío.').optional(),
  color_primario: z.string().optional(),
  sello_texto: z.string().optional(),
  email_contacto: z.string().email('Debe ser un email de contacto válido.').nullable().optional().or(z.literal('')),
  telefono_contacto: z.string().nullable().optional(),
  direccion: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional()
});

/**
 * GET /api/v1/configuracion-agencia
 * Recupera la configuración maestra de la agencia (p-cfg-01).
 * Si no existe aún en Firestore, retorna el objeto por defecto.
 */
export const obtenerConfiguracionAgencia = async (req, res) => {
  try {
    let docRef = db.collection('configuracion_agencia').doc('p-cfg-01');
    let snap = await docRef.get();

    if (!snap.exists) {
      docRef = db.collection('configuracion_agencia').doc('global');
      snap = await docRef.get();
    }

    if (!snap.exists) {
      return res.status(200).json({
        status: 'success',
        message: 'No se encontró configuración previa. Se retornan los valores iniciales por defecto.',
        data: DEFAULT_CONFIG_AGENCIA
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        id: snap.id,
        ...DEFAULT_CONFIG_AGENCIA,
        ...snap.data()
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al obtener la configuración de la agencia.',
      detail: error.message
    });
  }
};

/**
 * POST /api/v1/configuracion-agencia
 * Crea o actualiza los datos de configuración de la agencia en Firestore (p-cfg-01).
 */
export const guardarConfiguracionAgencia = async (req, res) => {
  const parseResult = ConfiguracionAgenciaSchema.safeParse(req.body || {});

  if (!parseResult.success) {
    const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    return res.status(400).json({
      status: 'error',
      message: `Datos de configuración inválidos: ${issues}`
    });
  }

  try {
    const docRef = db.collection('configuracion_agencia').doc('p-cfg-01');
    const timestamp = new Date().toISOString();

    const dataToSave = {
      ...parseResult.data,
      email_contacto: parseResult.data.email_contacto === '' ? null : parseResult.data.email_contacto,
      updatedAt: timestamp
    };

    // `.set` con `merge: true` crea la colección y documento si no existen o combina si existe
    await docRef.set(dataToSave, { merge: true });

    const updatedSnap = await docRef.get();
    const updatedData = updatedSnap.data();

    return res.status(200).json({
      status: 'success',
      message: 'Configuración de la agencia guardada exitosamente.',
      data: {
        id: docRef.id,
        ...DEFAULT_CONFIG_AGENCIA,
        ...updatedData
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al guardar la configuración de la agencia.',
      detail: error.message
    });
  }
};

/**
 * POST /api/v1/configuracion-agencia/logo
 * Recibe la imagen de logo en RAM (PNG, JPG, WEBP, SVG <5MB), la sube a Firebase Storage
 * y actualiza la propiedad logo_url en Firestore (p-cfg-01).
 */
export const cargarLogoAgencia = async (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({
      status: 'error',
      message: 'El archivo de imagen del logo (PNG, JPG, WEBP o SVG) es obligatorio en el campo "logo" (o "file").'
    });
  }

  try {
    const originalNameClean = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `agencia/logo_p-cfg-01_${Date.now()}_${originalNameClean}`;
    const fileRef = bucket.file(storagePath);
    const timestamp = new Date().toISOString();

    let logoUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

    if (process.env.NODE_ENV !== 'test') {
      const blobStream = fileRef.createWriteStream({
        metadata: {
          contentType: file.mimetype,
          metadata: {
            tipo: 'logo_agencia',
            uploadedAt: timestamp
          }
        }
      });

      await new Promise((resolve, reject) => {
        blobStream.on('error', (err) => reject(err));
        blobStream.on('finish', () => resolve());
        blobStream.end(file.buffer);
      });

      // Hacer archivo público si es posible o usar URL pública estándar
      try {
        await fileRef.makePublic();
        logoUrl = fileRef.publicUrl();
      } catch (pubErr) {
        logoUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
      }
    } else {
      logoUrl = `https://storage.googleapis.com/azul-ats-test-bucket/${storagePath}`;
    }

    // Actualizar logo_url en Firestore (p-cfg-01)
    const docRef = db.collection('configuracion_agencia').doc('p-cfg-01');
    await docRef.set({
      logo_url: logoUrl,
      updatedAt: timestamp
    }, { merge: true });

    const updatedSnap = await docRef.get();
    const updatedData = updatedSnap.data();

    return res.status(200).json({
      status: 'success',
      message: 'Logo de la agencia cargado y configurado exitosamente.',
      data: {
        id: docRef.id,
        ...DEFAULT_CONFIG_AGENCIA,
        ...updatedData,
        logo_url: logoUrl
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error al cargar el logo de la agencia.',
      detail: error.message
    });
  }
};
