// fixDate.js
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize({ 
    dialect: 'sqlite', 
    storage: './onama_pro.sqlite', 
    logging: false 
});

async function fixDate() {
    try {
        // Corriger la date de fin pour le stagiaire ALI ADAM (id=1)
        const result = await sequelize.query(
            "UPDATE Stagiaires SET dateFin = '2026-05-29' WHERE id = 1 AND (dateFin IS NULL OR dateFin = '')"
        );
        console.log('✅ Date de fin corrigée pour le stagiaire ID 1');
        
        // Vérifier le résultat
        const stagiaire = await sequelize.query(
            "SELECT id, nom, prenom, dateDebut, dateFin FROM Stagiaires WHERE id = 1",
            { type: Sequelize.QueryTypes.SELECT }
        );
        console.log('📋 Stagiaire après correction:', stagiaire);
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
    }
    
    await sequelize.close();
}

fixDate();