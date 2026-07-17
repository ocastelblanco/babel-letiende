// Configuración de desarrollo. Mismo proyecto Firebase que producción por ahora
// (Babel aún no tiene un ambiente productivo con configuración distinta) —
// ver CLAUDE.md, ADR-007 en MEMORY.md.
export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyCKZLrWGC-O_piAf5JFyvCueNQOVNS75X4',
    authDomain: 'comandante-letiende.firebaseapp.com',
    projectId: 'comandante-letiende',
    storageBucket: 'comandante-letiende.firebasestorage.app',
    messagingSenderId: '458748050433',
    appId: '1:458748050433:web:441a0ec326f149ab08d400',
  },
};
