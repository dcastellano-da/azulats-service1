import 'dotenv/config';
import { db, bucket } from '../src/config/firebase.js';

async function cleanup() {
  const docId = 'e6fc4f29-6a27-45f9-8c53-20573d2cba21';
  const storagePath = `cvs/${docId}_candidato_cv.pdf`;

  console.log('Borrando datos residuales de prueba del bucket y base de datos...');
  try {
    await db.collection('postulantes').doc(docId).delete();
    console.log('✅ Documento de prueba eliminado con éxito de Firestore.');
  } catch (error) {
    console.error('Fallo al eliminar de Firestore:', error.message);
  }

  try {
    await bucket.file(storagePath).delete();
    console.log('✅ Archivo de prueba eliminado con éxito de Firebase Storage.');
  } catch (error) {
    console.log('El archivo de prueba no existía en Storage o ya fue removido.');
  }
  process.exit();
}

cleanup();
