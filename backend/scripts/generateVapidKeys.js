import webpush from 'web-push';

const vapidKeys = webpush.generateVAPIDKeys();

console.log('--- MealKhata VAPID Keys Generated ---');
console.log(`Public Key:\n${vapidKeys.publicKey}\n`);
console.log(`Private Key:\n${vapidKeys.privateKey}\n`);
console.log('Add these to backend/.env and Render environment settings:');
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:admin@example.com');
