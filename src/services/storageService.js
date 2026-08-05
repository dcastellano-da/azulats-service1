import { bucket } from '../config/firebase.js';

/**
 * Elimina un archivo de Firebase Storage dado su path relativo en el bucket.
 * @param {string} storagePath - Ruta del archivo en el bucket (ej: cvs/archivo.pdf)
 * @returns {Promise<void>}
 */
export const deleteFile = async (storagePath) => {
  if (!storagePath) return;
  const fileRef = bucket.file(storagePath);
  try {
    await fileRef.delete();
    console.info(`[STORAGE] Archivo eliminado con éxito de Storage: ${storagePath}`);
  } catch (error) {
    if (error.code === 404) {
      console.warn(`[STORAGE] El archivo no existía o ya fue eliminado: ${storagePath}`);
    } else {
      console.error(`[STORAGE ERROR] Fallo al eliminar archivo ${storagePath}:`, error.message);
      throw error;
    }
  }
};

/**
 * Elimina un archivo de Firebase Storage dado su URI canónico gs://
 * @param {string} gsUri - URI en formato gs://bucket_name/path/to/file
 * @returns {Promise<void>}
 */
export const deleteFileFromGsUri = async (gsUri) => {
  if (!gsUri) return;
  const prefix = `gs://${bucket.name}/`;
  if (!gsUri.startsWith(prefix)) {
    throw new Error('El URI de Storage no pertenece al bucket configurado.');
  }
  const storagePath = gsUri.substring(prefix.length);
  await deleteFile(storagePath);
};
