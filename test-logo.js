// backend/test-logo.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const doc = new PDFDocument();
const stream = fs.createWriteStream('test-logo.pdf');
doc.pipe(stream);

const logoPath = path.join(__dirname, 'logo-onama.png');

console.log('Chemin du logo:', logoPath);
console.log('Logo existe:', fs.existsSync(logoPath));

if (fs.existsSync(logoPath)) {
    try {
        doc.image(logoPath, 50, 50, { width: 100 });
        console.log('✅ Logo ajouté avec succès');
    } catch (err) {
        console.error('❌ Erreur:', err.message);
    }
} else {
    console.log('❌ Logo non trouvé');
}

doc.text('Test d\'affichage du logo', 50, 200);
doc.end();

stream.on('finish', () => {
    console.log('✅ PDF test généré: test-logo.pdf');
});