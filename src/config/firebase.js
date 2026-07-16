import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Inicializa Firebase Admin usando applicationDefault
initializeApp({
  credential: applicationDefault(),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});

export const db = getFirestore();
export const bucket = getStorage().bucket();
