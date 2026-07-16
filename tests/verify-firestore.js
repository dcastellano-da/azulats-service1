import 'dotenv/config';
import { db } from '../src/config/firebase.js';

async function testFetch() {
  try {
    const docId = 'e6fc4f29-6a27-45f9-8c53-20573d2cba21';
    console.log(`Buscando documento candidato en Firestore con ID: ${docId}...`);
    const doc = await db.collection('postulantes').doc(docId).get();
    
    if (doc.exists) {
      console.log('✅ DOCUMENTO ENCONTRADO EN FIRESTORE:');
      console.log(JSON.stringify(doc.data(), null, 2));
    } else {
      console.error('❌ ERROR: El documento no existe en la colección Firebase.');
    }
  } catch (error) {
    console.error('❌ Error de consulta:', error.message);
  }
  process.exit();
}

testFetch();
