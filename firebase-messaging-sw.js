// Service Worker do Firebase Cloud Messaging (notificações push)
// Roda em segundo plano, independente da aba/app estar aberto ou não.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAAwR-TwQlWIgR4hBRjWtjfm_qFSkultUY",
  authDomain: "interliga-app.firebaseapp.com",
  projectId: "interliga-app",
  storageBucket: "interliga-app.firebasestorage.app",
  messagingSenderId: "913895237568",
  appId: "1:913895237568:web:faad95e8af089150e54a25",
});

const messaging = firebase.messaging();

// Mensagem chegando com o app em segundo plano ou fechado
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Interliga';
  const options = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

// Toque na notificação — abre (ou foca) o app na tela certa
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = event.notification.data?.tela === 'motorista' ? 'motorista.html' : 'index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      const existente = lista.find((c) => c.url.includes(destino));
      if (existente) return existente.focus();
      return clients.openWindow('./' + destino);
    })
  );
});
