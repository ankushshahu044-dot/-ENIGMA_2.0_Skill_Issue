// firebase-messaging-sw.js — OxyTrace / ENIGMA Push Notification Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAvDsel_ZqQrqtCuMKBTDqQFVM_zP7VplQ",
  authDomain: "oxytrace-b1010.firebaseapp.com",
  projectId: "oxytrace-b1010",
  storageBucket: "oxytrace-b1010.firebasestorage.app",
  messagingSenderId: "535755454947",
  appId: "1:535755454947:web:024254448bbf50061848d6"
});

const messaging = firebase.messaging();

// Handles notifications when app is CLOSED / in background
messaging.onBackgroundMessage(function(payload) {
  const title = payload.notification?.title || 'OxyTrace Alert';
  const body  = payload.notification?.body  || 'Air quality update';
  self.registration.showNotification(title, {
    body,
    icon: 'https://cdn-icons-png.flaticon.com/512/2964/2964063.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2964/2964063.png',
    vibrate: [200, 100, 200],
    tag: 'oxytrace-alert',
    renotify: true
  });
});
