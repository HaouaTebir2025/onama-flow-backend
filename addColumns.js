// addColumn.js
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize({ 
    dialect: 'sqlite', 
    storage: './onama_pro.sqlite', 
    logging: console.log 
});

async function addMissingColumns() {
    console.log('🔧 Ajout des colonnes manquantes...\n');
    
    try {
        await sequelize.query("ALTER TABLE Stagiaires ADD COLUMN sousDirection TEXT DEFAULT ''");
        console.log('✅ Colonne "sousDirection" ajoutée');
    } catch (error) {
        if (error.message.includes('duplicate column name')) {
            console.log('⚠️ Colonne "sousDirection" existe déjà');
        } else {
            console.log('❌ Erreur:', error.message);
        }
    }
    
    try {
        await sequelize.query("ALTER TABLE Stagiaires ADD COLUMN chefService TEXT DEFAULT ''");
        console.log('✅ Colonne "chefService" ajoutée');
    } catch (error) {
        if (error.message.includes('duplicate column name')) {
            console.log('⚠️ Colonne "chefService" existe déjà');
        }
    }
    
    try {
        await sequelize.query("ALTER TABLE Stagiaires ADD COLUMN duree INTEGER DEFAULT 2");
        console.log('✅ Colonne "duree" ajoutée');
    } catch (error) {
        if (error.message.includes('duplicate column name')) {
            console.log('⚠️ Colonne "duree" existe déjà');
        }
    }
    
    try {
        await sequelize.query("ALTER TABLE Stagiaires ADD COLUMN rapport TEXT DEFAULT ''");
        console.log('✅ Colonne "rapport" ajoutée');
    } catch (error) {
        if (error.message.includes('duplicate column name')) {
            console.log('⚠️ Colonne "rapport" existe déjà');
        }
    }
    
    console.log('\n🎉 Mise à jour terminée !');
    await sequelize.close();
}

addMissingColumns();