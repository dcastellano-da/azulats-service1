import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Inicializa Firebase Admin usando applicationDefault
initializeApp({
  credential: applicationDefault()
});

export const db = getFirestore();
