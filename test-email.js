const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

transporter.sendMail({
    from: `"ONAMA FLOW" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: 'Test ONAMA FLOW',
    html: '<h1>✅ Configuration réussie !</h1><p>Les emails fonctionnent parfaitement.</p>'
}).then(() => console.log('✅ Email envoyé avec succès !'))
  .catch(err => console.error('❌ Erreur:', err.message));