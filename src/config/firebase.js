import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { Writable } from 'stream';
import crypto from 'crypto';

let db;
let bucket;

if (process.env.NODE_ENV === 'test') {
  console.log('⚠️ [TEST] Cargando Mocks en memoria para Firebase Firestore y Storage');

  const createQueryMock = (entries) => {
    return {
      _entries: entries,
      where(field, op, value) {
        const getNestedVal = (obj, path) => {
          if (!path) return undefined;
          return path.split('.').reduce((acc, part) => acc && acc[part], obj);
        };
        const filtered = this._entries.filter(data => {
          const val = getNestedVal(data, field);
          return val === value;
        });
        return createQueryMock(filtered);
      },
      orderBy(field, direction = 'asc') {
        const sorted = [...this._entries].sort((a, b) => {
          const valA = a[field] || '';
          const valB = b[field] || '';
          if (valA < valB) return direction === 'asc' ? -1 : 1;
          if (valA > valB) return direction === 'asc' ? 1 : -1;
          return 0;
        });
        return createQueryMock(sorted);
      },
      async get() {
        const docs = this._entries.map(data => ({
          id: data.id,
          data() { return data; }
        }));
        return {
          docs,
          forEach(callback) {
            docs.forEach(callback);
          }
        };
      }
    };
  };

  const mockDb = {
    _collections: new Map(),
    collection(colName) {
      if (!this._collections.has(colName)) {
        this._collections.set(colName, new Map());
      }
      const colMap = this._collections.get(colName);
      return {
        ...createQueryMock(Array.from(colMap.values())),
        doc(docId) {
          const actualDocId = docId || crypto.randomUUID();
          return {
            id: actualDocId,
            async set(data) {
              colMap.set(actualDocId, { ...data, id: actualDocId });
            },
            async get() {
              const data = colMap.get(actualDocId);
              return {
                exists: !!data,
                id: actualDocId,
                data() { return data || null; }
              };
            },
            async update(data) {
              const current = colMap.get(actualDocId) || {};
              const updated = { ...current };
              for (const [key, val] of Object.entries(data)) {
                if (key.includes('.')) {
                  const parts = key.split('.');
                  let currentObj = updated;
                  for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i];
                    if (!currentObj[part] || typeof currentObj[part] !== 'object') {
                      currentObj[part] = {};
                    }
                    currentObj[part] = { ...currentObj[part] };
                    currentObj = currentObj[part];
                  }
                  currentObj[parts[parts.length - 1]] = val;
                } else {
                  updated[key] = val;
                }
              }
              colMap.set(actualDocId, updated);
            },
            async delete() {
              colMap.delete(actualDocId);
            }
          };
        }
      };
    }
  };

  const mockBucket = {
    name: 'mock-storage-bucket',
    file(storagePath) {
      return {
        createWriteStream(options) {
          return new Writable({
            write(chunk, encoding, callback) {
              callback();
            }
          });
        },
        async delete() {
          return true;
        }
      };
    }
  };

  db = mockDb;
  bucket = mockBucket;
} else {
  initializeApp({
    credential: applicationDefault(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });
  db = getFirestore();
  bucket = getStorage().bucket();
}

export { db, bucket };
