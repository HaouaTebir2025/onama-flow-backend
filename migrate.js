// migrate.js - Migre les données de SQLite vers PostgreSQL
const { Sequelize } = require('sequelize');
const sqlite3 = require('sqlite3');

// Connexion à SQLite (ancienne base)
const sqliteDb = new sqlite3.Database('./onama_pro.sqlite');

// Connexion à PostgreSQL (nouvelle base)
const pgSequelize = new Sequelize({
    dialect: 'postgres',
    database: 'onama_flow',
    username: 'onama_user',
    password: 'onama_pass',
    host: 'localhost',
    port: 5432,
    logging: false
});

async function migrate() {
    console.log('🔄 Début de la migration...\n');

    // 1. Migrer les Users
    console.log('📥 Migration des utilisateurs...');
    const users = await new Promise((resolve) => {
        sqliteDb.all('SELECT * FROM Users', (err, rows) => resolve(rows));
    });
    console.log(`   ${users.length} utilisateurs trouvés`);

    for (const user of users) {
        await pgSequelize.query(`
            INSERT INTO "Users" (id, nom, prenom, telephone, email, password, role, universite, filiere, anneeEtude, "directionAccess", service, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (id) DO NOTHING
        `, {
            bind: [user.id, user.nom, user.prenom, user.telephone, user.email, 
                   user.password, user.role, user.universite, user.filiere, 
                   user.anneeEtude, user.directionAccess, user.service, 
                   user.createdAt, user.updatedAt]
        });
    }
    console.log('   ✅ Utilisateurs migrés');

    // 2. Réinitialiser la séquence des IDs
    await pgSequelize.query(`SELECT setval('"Users_id_seq"', (SELECT MAX(id) FROM "Users"))`);
    
    console.log('\n🎉 Migration terminée avec succès !');
    await pgSequelize.close();
    sqliteDb.close();
}

migrate().catch(console.error);