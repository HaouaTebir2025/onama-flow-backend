const express = require('express');
const cors = require('cors');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ============================================
// SÉCURITÉ - NOUVEAUX PACKAGES
// ============================================
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const helmet = require('helmet');

const app = express();

// ============================================
// SÉCURITÉ : HELMET (En-têtes HTTP protecteurs)
// ============================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
    },
  },
}));

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:4200';
app.use(cors({
    origin: [corsOrigin, 'https://kaleidoscopic-genie-d85682.netlify.app', 'https://onama-flow-frontend.netlify.app'],
    credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================
// SÉCURITÉ : RATE LIMITING (Protection force brute)
// ============================================

// Limiteur pour la connexion (5 tentatives max en 15 min)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives
  message: { success: false, message: 'Trop de tentatives. Réessayez dans 15 minutes.' }
});

// Limiteur général pour l'API (100 requêtes par minute)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requêtes max
  message: { success: false, message: 'Trop de requêtes. Veuillez ralentir.' }
});

// Application des limiteurs
app.use('/api/login', loginLimiter);
app.use('/api/', apiLimiter);

// ============================================
// CONFIGURATION JWT
// ============================================
const JWT_SECRET = process.env.JWT_SECRET || 'onama_flow_secret_key_2024';

// Stockage des refresh tokens (en production, utiliser Redis ou base de données)
let refreshTokens = [];

// ============================================
// CONFIGURATION EMAIL (NODEMAILER)
// ============================================
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER || 'halatebir@gmail.com',
        pass: process.env.EMAIL_PASS || 'nntmuppqxzorhnxn'
    }
});

async function sendEmail(to, subject, html) {
    try {
        await transporter.sendMail({
            from: `"ONAMA FLOW" <${process.env.EMAIL_USER || 'halatebir@gmail.com'}>`,
            to: to,
            subject: subject,
            html: html
        });
        console.log(`📧 Email envoyé à ${to}`);
        return true;
    } catch (error) {
        console.error('Erreur envoi email:', error);
        return false;
    }
}

async function sendConfirmationDepot(etudiant, numeroDossier) {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #1E3A5F; padding: 20px; text-align: center;">
                <h1 style="color: white;">ONAMA FLOW</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd;">
                <h2>Confirmation de dépôt de candidature</h2>
                <p>Bonjour <strong>${etudiant.prenom} ${etudiant.nom}</strong>,</p>
                <p>Nous avons bien reçu votre candidature de stage pour l'ONAMA.</p>
                <p>Votre numéro de dossier est : <strong style="font-size: 18px; color: #1E3A5F;">${numeroDossier}</strong></p>
                <p>Vous pouvez suivre l'état de votre candidature avec ce numéro sur notre site.</p>
                <hr>
                <p><strong>Prochaines étapes :</strong></p>
                <ul>
                    <li>📋 Votre dossier sera examiné par notre secrétariat</li>
                    <li>✅ Vous serez informé par email de la décision</li>
                </ul>
                <p>Cordialement,<br><strong>Direction des Ressources Humaines</strong><br>ONAMA - Tchad</p>
            </div>
        </div>
    `;
    return await sendEmail(etudiant.email, 'Confirmation de dépôt de candidature - ONAMA', html);
}

async function sendValidationSecretariat(etudiant, numeroDossier) {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #27AE60; padding: 20px; text-align: center;">
                <h1 style="color: white;">ONAMA FLOW</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd;">
                <h2>Votre candidature a été validée</h2>
                <p>Bonjour <strong>${etudiant.prenom} ${etudiant.nom}</strong>,</p>
                <p>Votre dossier (n°<strong>${numeroDossier}</strong>) a été validé par notre secrétariat et transmis à la DRH.</p>
                <p>Vous recevrez une réponse définitive sous 48h.</p>
                <p>Cordialement,<br><strong>Secrétariat ONAMA</strong></p>
            </div>
        </div>
    `;
    return await sendEmail(etudiant.email, 'Votre candidature a été validée - ONAMA', html);
}

async function sendRejetSecretariat(etudiant, numeroDossier, motif) {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #E74C3C; padding: 20px; text-align: center;">
                <h1 style="color: white;">ONAMA FLOW</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd;">
                <h2>Votre candidature n'a pas été retenue</h2>
                <p>Bonjour <strong>${etudiant.prenom} ${etudiant.nom}</strong>,</p>
                <p>Nous avons examiné votre dossier (n°<strong>${numeroDossier}</strong>).</p>
                <p><strong>Motif :</strong> ${motif}</p>
                <p>Nous vous invitons à postuler à nouveau lorsque votre dossier sera complet.</p>
                <p>Cordialement,<br><strong>Secrétariat ONAMA</strong></p>
            </div>
        </div>
    `;
    return await sendEmail(etudiant.email, 'Mise à jour de votre candidature - ONAMA', html);
}

async function sendValidationDRH(etudiant, numeroDossier) {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #27AE60; padding: 20px; text-align: center;">
                <h1 style="color: white;">ONAMA FLOW</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd;">
                <h2>Félicitations ! Votre candidature est acceptée</h2>
                <p>Bonjour <strong>${etudiant.prenom} ${etudiant.nom}</strong>,</p>
                <p>Votre candidature (n°<strong>${numeroDossier}</strong>) a été <strong>ACCEPTÉE</strong> par la Direction des Ressources Humaines.</p>
                <p>Un responsable vous contactera prochainement pour organiser votre stage.</p>
                <p>Bienvenue à l'ONAMA ! 🎉</p>
                <p>Cordialement,<br><strong>Direction des Ressources Humaines</strong><br>ONAMA - Tchad</p>
            </div>
        </div>
    `;
    return await sendEmail(etudiant.email, 'Félicitations ! Votre candidature est acceptée - ONAMA', html);
}

async function sendRejetDRH(etudiant, numeroDossier, motif) {
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #E74C3C; padding: 20px; text-align: center;">
                <h1 style="color: white;">ONAMA FLOW</h1>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd;">
                <h2>Décision finale concernant votre candidature</h2>
                <p>Bonjour <strong>${etudiant.prenom} ${etudiant.nom}</strong>,</p>
                <p>Après examen de votre dossier (n°<strong>${numeroDossier}</strong>), votre candidature n'a pas été retenue.</p>
                <p><strong>Motif :</strong> ${motif}</p>
                <p>Nous vous souhaitons bonne chance dans vos recherches.</p>
                <p>Cordialement,<br><strong>Direction des Ressources Humaines</strong><br>ONAMA - Tchad</p>
            </div>
        </div>
    `;
    return await sendEmail(etudiant.email, 'Décision finale - Candidature ONAMA', html);
}

// ============================================
// CONNEXION BASE DE DONNÉES (SQLite ou PostgreSQL)
// ============================================

const usePostgres = process.env.USE_POSTGRES === 'true';

let sequelize;

if (usePostgres) {
    sequelize = new Sequelize({
        dialect: 'postgres',
        database: process.env.DB_NAME || 'onama_flow',
        username: process.env.DB_USER || 'onama_user',
        password: process.env.DB_PASSWORD || 'onama_pass',
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        logging: false
    });
    console.log('🔵 Utilisation de PostgreSQL');
} else {
    sequelize = new Sequelize({ 
        dialect: 'sqlite', 
        storage: './onama_pro.sqlite', 
        logging: false 
    });
    console.log('🟢 Utilisation de SQLite');
}

// ============================================
// CONFIGURATION MULTER POUR UPLOAD CANDIDATURE
// ============================================
const storageCandidature = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'uploads', 'candidatures');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const prefix = file.fieldname === 'cv' ? 'CV' : 'LETTRE';
        cb(null, `${prefix}_${req.user?.email || req.body.email}_${uniqueSuffix}${ext}`);
    }
});

const uploadCandidature = multer({
    storage: storageCandidature,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.doc', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Format non autorisé. Utilisez PDF, DOC ou DOCX'));
        }
    }
});

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Token requis' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ success: false, message: 'Token invalide' });
    }
};

// ============================================
// MODÈLE UTILISATEUR
// ============================================
const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    nom: { type: DataTypes.STRING, allowNull: false },
    prenom: { type: DataTypes.STRING, defaultValue: '' },
    telephone: { type: DataTypes.STRING, defaultValue: '' },
    email: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    role: { 
        type: DataTypes.ENUM('ADMIN', 'SECRETARIAT', 'DRH', 'DIRECTEUR', 'CHEF_SERVICE', 'ETUDIANT'),
        defaultValue: 'ETUDIANT'
    },
    universite: { type: DataTypes.STRING, defaultValue: '' },
    filiere: { type: DataTypes.STRING, defaultValue: '' },
    anneeEtude: { type: DataTypes.STRING, defaultValue: '' },
    directionAccess: { type: DataTypes.STRING, defaultValue: '' },
    service: { type: DataTypes.STRING, defaultValue: '' }
});

// ============================================
// MODÈLE CANDIDATURE
// ============================================
const Candidature = sequelize.define('Candidature', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, references: { model: User, key: 'id' } },
    numeroDossier: { type: DataTypes.STRING, unique: true },
    nom: { type: DataTypes.STRING, allowNull: false },
    prenom: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    telephone: DataTypes.STRING,
    universite: DataTypes.STRING,
    filiere: DataTypes.STRING,
    anneeEtude: DataTypes.STRING,
    periodeSouhaitee: DataTypes.STRING,
    cvPath: DataTypes.STRING,
    cvNom: DataTypes.STRING,
    lettrePath: DataTypes.STRING,
    lettreNom: DataTypes.STRING,
    statutCandidature: { 
        type: DataTypes.ENUM('EN_ATTENTE', 'VALIDE_SEC', 'REJETE_SEC', 'DRH_EN_ATTENTE', 'VALIDE_DRH', 'REJETE_DRH'),
        defaultValue: 'EN_ATTENTE'
    },
    commentaireSecretariat: DataTypes.TEXT,
    commentaireDRH: DataTypes.TEXT,
    dateDepot: { type: DataTypes.DATEONLY, defaultValue: DataTypes.NOW },
    dateTraitementSecretariat: DataTypes.DATEONLY,
    dateTraitementDRH: DataTypes.DATEONLY,
    createdBy: DataTypes.STRING,
    updatedBy: DataTypes.STRING
});

// ============================================
// MODÈLE STAGIAIRE (après validation DRH)
// ============================================
const Stagiaire = sequelize.define('Stagiaire', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    candidatureId: { type: DataTypes.INTEGER, references: { model: Candidature, key: 'id' } },
    nom: { type: DataTypes.STRING, allowNull: false },
    prenom: { type: DataTypes.STRING, allowNull: false },
    telephone: DataTypes.STRING,
    universite: DataTypes.STRING,
    email: { type: DataTypes.STRING, defaultValue: '' },
    type: { type: DataTypes.STRING, defaultValue: 'ACADEMIQUE' },
    dateDepot: { type: DataTypes.DATEONLY, defaultValue: DataTypes.NOW },
    direction: { type: DataTypes.STRING, defaultValue: '' },
    dateOrientation: { type: DataTypes.DATEONLY },
    service: { type: DataTypes.STRING, defaultValue: '' },
    sousDirection: { type: DataTypes.STRING, defaultValue: '' },
    chefService: { type: DataTypes.STRING, defaultValue: '' },
    dateDebut: { type: DataTypes.DATEONLY },
    dateFin: { type: DataTypes.DATEONLY },
    duree: { type: DataTypes.INTEGER, defaultValue: 2 },
    rotation: { type: DataTypes.JSON, defaultValue: [] },
    note: { type: DataTypes.FLOAT, defaultValue: 0 },
    rapport: { type: DataTypes.TEXT, defaultValue: '' },
    rapportDepose: { type: DataTypes.BOOLEAN, defaultValue: false },
    dateEvaluation: { type: DataTypes.DATEONLY },
    statut: { 
        type: DataTypes.ENUM('DEPOT', 'VALIDE', 'PROGRAMME', 'TERMINE'),
        defaultValue: 'DEPOT' 
    },
    createdBy: DataTypes.STRING,
    updatedBy: DataTypes.STRING
});

// ============================================
// MODÈLE LOG (pour journalisation)
// ============================================
const Log = sequelize.define('Log', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: true },
    userEmail: { type: DataTypes.STRING },
    action: { type: DataTypes.STRING, allowNull: false },
    details: { type: DataTypes.TEXT },
    ip: { type: DataTypes.STRING },
    date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// Middleware de logging
const logAction = (action, getDetails = null) => {
    return async (req, res, next) => {
        try {
            const details = getDetails ? getDetails(req) : '';
            await Log.create({
                userId: req.user?.id || null,
                userEmail: req.user?.email || 'anonymous',
                action: action,
                details: details,
                ip: req.ip || req.connection.remoteAddress
            });
        } catch (err) {
            console.error('Erreur logging:', err);
        }
        next();
    };
};

// ============================================
// 🔐 ROUTES D'AUTHENTIFICATION
// ============================================

// REFRESH TOKEN - Nouvelle route
app.post('/api/refresh-token', (req, res) => {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
        return res.status(401).json({ message: 'Refresh token requis' });
    }
    
    if (!refreshTokens.includes(refreshToken)) {
        return res.status(403).json({ message: 'Refresh token invalide' });
    }
    
    try {
        const decoded = jwt.verify(refreshToken, JWT_SECRET);
        const newAccessToken = jwt.sign(
            { id: decoded.id, email: decoded.email, role: decoded.role },
            JWT_SECRET,
            { expiresIn: '1h' }
        );
        
        res.json({ accessToken: newAccessToken });
    } catch (error) {
        res.status(403).json({ message: 'Refresh token expiré' });
    }
});

// INSCRIPTION - Créer un compte étudiant AVEC VALIDATION
app.post('/api/register', [
    body('nom').notEmpty().trim().withMessage('Le nom est requis'),
    body('prenom').optional().trim(),
    body('email').isEmail().normalizeEmail().withMessage('Email invalide'),
    body('password').isLength({ min: 6 }).withMessage('Le mot de passe doit contenir au moins 6 caractères')
], async (req, res) => {
    // Vérifier les erreurs de validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    
    try {
        const { nom, prenom, email, telephone, password, universite, filiere, anneeEtude } = req.body;

        if (!nom || !email || !password) {
            return res.status(400).json({ success: false, message: 'Tous les champs obligatoires doivent être remplis' });
        }

        const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            nom: nom.trim(),
            prenom: prenom?.trim() || '',
            email: email.toLowerCase().trim(),
            telephone: telephone?.trim() || '',
            universite: universite?.trim() || '',
            filiere: filiere?.trim() || '',
            anneeEtude: anneeEtude?.trim() || '',
            password: hashedPassword,
            role: 'ETUDIANT'
        });

        // Journalisation
        await Log.create({
            userId: user.id,
            userEmail: user.email,
            action: 'INSCRIPTION',
            details: `Nouvel utilisateur inscrit`,
            ip: req.ip
        });

        res.status(201).json({
            success: true,
            message: 'Inscription réussie ! Connectez-vous pour déposer votre candidature.',
            user: {
                id: user.id,
                nom: user.nom,
                prenom: user.prenom,
                email: user.email,
                universite: user.universite,
                filiere: user.filiere,
                anneeEtude: user.anneeEtude,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Erreur inscription:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// CONNEXION - Authentification avec refresh token
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
        
        if (!user) {
            // Journalisation échec
            await Log.create({
                userEmail: email,
                action: 'LOGIN_ECHEC',
                details: 'Utilisateur non trouvé',
                ip: req.ip
            });
            return res.status(401).json({ success: false, message: "Email ou mot de passe incorrect" });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (isPasswordValid) {
            const accessToken = jwt.sign(
                { id: user.id, email: user.email, role: user.role, nom: user.nom, prenom: user.prenom, universite: user.universite, telephone: user.telephone },
                JWT_SECRET,
                { expiresIn: '1h' } // 1 heure
            );
            
            const refreshToken = jwt.sign(
                { id: user.id, email: user.email },
                JWT_SECRET,
                { expiresIn: '7d' } // 7 jours
            );
            
            refreshTokens.push(refreshToken);
            
            // Journalisation succès
            await Log.create({
                userId: user.id,
                userEmail: user.email,
                action: 'LOGIN_SUCCES',
                details: 'Connexion réussie',
                ip: req.ip
            });
            
            res.json({ 
                success: true, 
                accessToken,
                refreshToken,
                user: { 
                    id: user.id,
                    nom: user.nom,
                    prenom: user.prenom,
                    email: user.email,
                    telephone: user.telephone,
                    universite: user.universite,
                    filiere: user.filiere,
                    anneeEtude: user.anneeEtude,
                    role: user.role, 
                    directionAccess: user.directionAccess,
                    service: user.service
                } 
            });
        } else {
            // Journalisation échec
            await Log.create({
                userId: user.id,
                userEmail: user.email,
                action: 'LOGIN_ECHEC',
                details: 'Mot de passe incorrect',
                ip: req.ip
            });
            res.status(401).json({ success: false, message: "Email ou mot de passe incorrect" });
        }
    } catch (error) {
        console.error('Erreur login:', error);
        res.status(500).json({ success: false, message: "Erreur serveur" });
    }
});

// PROFIL - Récupérer les informations
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: { exclude: ['password'] }
        });
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }
        
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// PROFIL - Modifier les informations
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }
        
        const { nom, prenom, email, telephone, currentPassword, newPassword } = req.body;
        
        if (email && email !== user.email) {
            const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
            if (existingUser) {
                return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
            }
        }
        
        if (nom) user.nom = nom.trim();
        if (prenom !== undefined) user.prenom = prenom?.trim() || '';
        if (email) user.email = email.toLowerCase().trim();
        if (telephone !== undefined) user.telephone = telephone?.trim() || '';
        
        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({ success: false, message: 'Veuillez saisir votre mot de passe actuel' });
            }
            
            const isValid = await bcrypt.compare(currentPassword, user.password);
            if (!isValid) {
                return res.status(401).json({ success: false, message: 'Mot de passe actuel incorrect' });
            }
            
            if (newPassword.length < 6) {
                return res.status(400).json({ success: false, message: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
            }
            
            user.password = await bcrypt.hash(newPassword, 10);
        }
        
        await user.save();
        
        // Journalisation
        await Log.create({
            userId: user.id,
            userEmail: user.email,
            action: 'PROFIL_MODIFIE',
            details: 'Profil utilisateur modifié',
            ip: req.ip
        });
        
        res.json({
            success: true,
            message: 'Profil mis à jour',
            user: {
                id: user.id,
                nom: user.nom,
                prenom: user.prenom,
                email: user.email,
                telephone: user.telephone,
                role: user.role
            }
        });
        
    } catch (error) {
        console.error('Erreur mise à jour:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur' });
    }
});

// ============================================
// 📋 ROUTES POUR LES STAGIAIRES
// ============================================

// GET - Liste des stagiaires (pour tableau de bord)
app.get('/api/stagiaires', authenticateToken, async (req, res) => {
    try {
        const stagiaires = await Stagiaire.findAll({
            order: [['createdAt', 'DESC']]
        });
        res.json(stagiaires);
    } catch (error) {
        console.error('❌ Erreur chargement stagiaires:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET - Liste des stagiaires pour DIRECTEUR
app.get('/api/stagiaires/direction', authenticateToken, async (req, res) => {
    try {
        const { direction } = req.query;
        console.log('📥 Requête direction:', direction);
        
        const whereClause = { direction: direction, statut: 'VALIDE' };
        
        const stagiaires = await Stagiaire.findAll({ 
            where: whereClause,
            order: [['createdAt', 'DESC']] 
        });
        
        console.log('📤 Stagiaires trouvés:', stagiaires.length);
        res.json(stagiaires);
    } catch (error) {
        console.error('❌ Erreur:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET - Mon dossier (pour étudiant)
app.get('/api/mon-dossier', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'ETUDIANT') {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }
        
        const dossier = await Stagiaire.findOne({ 
            where: { email: req.user.email }
        });
        
        res.json(dossier || null);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET - Liste filtrée selon le rôle
app.get('/api/stagiaires-filtre', authenticateToken, async (req, res) => {
    try {
        const { role, direction, service } = req.query;
        let whereClause = {};
        
        console.log('📥 Requête reçue:', { role, direction, service });
        
        if (role === 'DIRECTEUR' && direction) {
            whereClause.direction = direction;
            whereClause.statut = 'VALIDE';
        } else if (role === 'CHEF_SERVICE' && service) {
            whereClause.service = service;
            whereClause.statut = 'PROGRAMME';
        }
        
        const stagiaires = await Stagiaire.findAll({ 
            where: whereClause,
            order: [['createdAt', 'DESC']] 
        });
        
        console.log('📤 Stagiaires trouvés:', stagiaires.length);
        res.json(stagiaires);
    } catch (error) {
        console.error('❌ Erreur:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST - Créer un nouveau stagiaire
app.post('/api/stagiaires', authenticateToken, async (req, res) => {
    try {
        const stagiaire = await Stagiaire.create({
            ...req.body,
            statut: 'DEPOT',
            dateDepot: new Date().toISOString().split('T')[0],
            createdBy: req.user.email
        });
        
        // Journalisation
        await Log.create({
            userId: req.user.id,
            userEmail: req.user.email,
            action: 'STAGIAIRE_CREE',
            details: `Stagiaire ${stagiaire.nom} ${stagiaire.prenom} créé`,
            ip: req.ip
        });
        
        res.json(stagiaire);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH - Mettre à jour un stagiaire
app.patch('/api/stagiaires/:id', authenticateToken, async (req, res) => {
    try {
        const stagiaire = await Stagiaire.findByPk(req.params.id);
        
        if (!stagiaire) {
            return res.status(404).json({ error: 'Stagiaire non trouvé' });
        }
        
        const updates = { ...req.body, updatedBy: req.user.email };
        
        if (req.body.statut === 'VALIDE' && stagiaire.statut === 'DEPOT') {
            updates.dateOrientation = new Date().toISOString().split('T')[0];
        } else if (req.body.statut === 'PROGRAMME' && stagiaire.statut === 'VALIDE') {
            updates.dateDebut = updates.dateDebut || new Date().toISOString().split('T')[0];
        } else if (req.body.statut === 'TERMINE' && stagiaire.statut === 'PROGRAMME') {
            updates.dateEvaluation = new Date().toISOString().split('T')[0];
        }
        
        await stagiaire.update(updates);
        
        // Journalisation
        await Log.create({
            userId: req.user.id,
            userEmail: req.user.email,
            action: 'STAGIAIRE_MODIFIE',
            details: `Stagiaire ${stagiaire.nom} ${stagiaire.prenom} modifié - Nouveau statut: ${updates.statut || stagiaire.statut}`,
            ip: req.ip
        });
        
        res.json({ success: true, stagiaire });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE - Supprimer un stagiaire
app.delete('/api/stagiaires/:id', authenticateToken, async (req, res) => {
    try {
        const stagiaire = await Stagiaire.findByPk(req.params.id);
        
        // Journalisation
        await Log.create({
            userId: req.user.id,
            userEmail: req.user.email,
            action: 'STAGIAIRE_SUPPRIME',
            details: `Stagiaire ${stagiaire?.nom} ${stagiaire?.prenom} supprimé`,
            ip: req.ip
        });
        
        await Stagiaire.destroy({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET - Statistiques globales
app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const total = await Stagiaire.count();
        const parDirection = await Stagiaire.findAll({
            attributes: ['direction', [sequelize.fn('COUNT', 'direction'), 'count']],
            group: ['direction']
        });
        
        const parStatut = await Stagiaire.findAll({
            attributes: ['statut', [sequelize.fn('COUNT', 'statut'), 'count']],
            group: ['statut']
        });
        
        res.json({
            total,
            parDirection: parDirection.reduce((acc, item) => {
                acc[item.direction || 'NON_ORIENTE'] = item.dataValues.count;
                return acc;
            }, {}),
            parStatut: parStatut.reduce((acc, item) => {
                acc[item.statut] = item.dataValues.count;
                return acc;
            }, {})
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 📁 ROUTES DE DÉPÔT DE CANDIDATURE AVEC VALIDATION
// ============================================

// POST - Déposer une candidature (CV + Lettre) AVEC VALIDATION
app.post('/api/deposer-candidature', authenticateToken, [
    body('periodeSouhaitee').optional().trim(),
    body('telephone').optional().isLength({ min: 8 }).withMessage('Téléphone invalide'),
    body('universite').optional().trim(),
    body('filiere').optional().trim(),
    body('anneeEtude').optional().trim()
], uploadCandidature.fields([
    { name: 'cv', maxCount: 1 },
    { name: 'lettre', maxCount: 1 }
]), async (req, res) => {
    // Vérifier les erreurs de validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    
    try {
        if (req.user.role !== 'ETUDIANT') {
            return res.status(403).json({ error: 'Seuls les étudiants peuvent déposer une candidature' });
        }

        const existingCandidature = await Candidature.findOne({
            where: { 
                email: req.user.email,
                statutCandidature: ['EN_ATTENTE', 'VALIDE_SEC', 'DRH_EN_ATTENTE']
            }
        });

        if (existingCandidature) {
            return res.status(400).json({ 
                error: 'Vous avez déjà une candidature en cours de traitement',
                numeroDossier: existingCandidature.numeroDossier
            });
        }

        const date = new Date();
        const annee = date.getFullYear();
        const mois = String(date.getMonth() + 1).padStart(2, '0');
        const count = await Candidature.count() + 1;
        const numeroDossier = `CAND-${annee}${mois}-${String(count).padStart(4, '0')}`;

        const { periodeSouhaitee, telephone, universite, filiere, anneeEtude } = req.body;

        if (!req.files['cv'] || !req.files['lettre']) {
            return res.status(400).json({ error: 'CV et lettre de motivation sont obligatoires' });
        }

        const candidature = await Candidature.create({
            userId: req.user.id,
            numeroDossier: numeroDossier,
            nom: req.user.nom,
            prenom: req.user.prenom,
            email: req.user.email,
            telephone: telephone || req.user.telephone,
            universite: universite || req.user.universite,
            filiere: filiere || req.user.filiere,
            anneeEtude: anneeEtude || req.user.anneeEtude,
            periodeSouhaitee: periodeSouhaitee || '',
            cvPath: req.files['cv'][0].path,
            cvNom: req.files['cv'][0].originalname,
            lettrePath: req.files['lettre'][0].path,
            lettreNom: req.files['lettre'][0].originalname,
            statutCandidature: 'EN_ATTENTE',
            dateDepot: new Date().toISOString().split('T')[0],
            createdBy: req.user.email
        });

        await User.update({
            universite: universite || req.user.universite,
            filiere: filiere || req.user.filiere,
            anneeEtude: anneeEtude || req.user.anneeEtude,
            telephone: telephone || req.user.telephone
        }, {
            where: { id: req.user.id }
        });

        const etudiant = { nom: req.user.nom, prenom: req.user.prenom, email: req.user.email };
        await sendConfirmationDepot(etudiant, numeroDossier);

        const io = req.app.get('io');
        if (io) {
            io.emit('nouvelle_candidature', {
                candidatureId: candidature.id,
                numeroDossier: numeroDossier,
                nom: candidature.nom,
                prenom: candidature.prenom,
                universite: candidature.universite,
                date: candidature.dateDepot
            });
            console.log('📢 Nouvelle candidature reçue de:', candidature.nom, candidature.prenom);
        }

        res.json({ 
            success: true, 
            message: 'Candidature déposée avec succès !',
            numeroDossier: numeroDossier,
            candidature: {
                id: candidature.id,
                numeroDossier: numeroDossier,
                dateDepot: candidature.dateDepot,
                statut: candidature.statutCandidature
            }
        });

    } catch (error) {
        console.error('Erreur dépôt candidature:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET - Ma candidature (étudiant)
app.get('/api/ma-candidature', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'ETUDIANT') {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const candidature = await Candidature.findOne({
            where: { email: req.user.email },
            attributes: { exclude: ['cvPath', 'lettrePath'] },
            order: [['createdAt', 'DESC']]
        });

        res.json({ success: true, candidature: candidature || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET - Suivi candidature public
app.get('/api/suivi-candidature/:numeroDossier', async (req, res) => {
    try {
        const candidature = await Candidature.findOne({
            where: { numeroDossier: req.params.numeroDossier },
            attributes: ['numeroDossier', 'nom', 'prenom', 'statutCandidature', 'dateDepot', 
                        'commentaireSecretariat', 'commentaireDRH']
        });

        if (!candidature) {
            return res.status(404).json({ error: 'Dossier non trouvé' });
        }

        const statutInfo = {
            'EN_ATTENTE': { label: 'En attente de validation', color: 'orange', message: 'Votre dossier est en cours d\'examen par le secrétariat.' },
            'VALIDE_SEC': { label: 'Validé par le secrétariat', color: 'blue', message: 'Votre dossier a été validé et transmis à la DRH.' },
            'REJETE_SEC': { label: 'Rejeté par le secrétariat', color: 'red', message: 'Votre dossier n\'a pas été retenu.' },
            'DRH_EN_ATTENTE': { label: 'En attente DRH', color: 'purple', message: 'Votre dossier est en cours d\'examen par la DRH.' },
            'VALIDE_DRH': { label: 'Validé !', color: 'green', message: 'Félicitations ! Votre candidature est acceptée.' },
            'REJETE_DRH': { label: 'Non retenu', color: 'red', message: 'Votre candidature n\'a pas été retenue.' }
        };

        res.json({
            success: true,
            candidature: {
                ...candidature.toJSON(),
                statutInfo: statutInfo[candidature.statutCandidature]
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 📋 ROUTES POUR SECRÉTARIAT
// ============================================

// GET - Candidatures en attente
app.get('/api/candidatures-en-attente', authenticateToken, async (req, res) => {
    try {
        if (!['SECRETARIAT', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const candidatures = await Candidature.findAll({
            where: { statutCandidature: 'EN_ATTENTE' },
            attributes: ['id', 'numeroDossier', 'nom', 'prenom', 'email', 'universite', 
                        'telephone', 'filiere', 'anneeEtude', 'periodeSouhaitee', 'dateDepot', 
                        'cvNom', 'lettreNom'],
            order: [['dateDepot', 'DESC']]
        });

        res.json(candidatures);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET - Télécharger document
app.get('/api/telecharger-document/:id/:type', authenticateToken, async (req, res) => {
    try {
        const candidature = await Candidature.findByPk(req.params.id);
        
        if (!candidature) {
            return res.status(404).json({ error: 'Candidature non trouvée' });
        }

        if (!['SECRETARIAT', 'DRH', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        let filePath, fileName;
        if (req.params.type === 'cv') {
            filePath = candidature.cvPath;
            fileName = candidature.cvNom;
        } else if (req.params.type === 'lettre') {
            filePath = candidature.lettrePath;
            fileName = candidature.lettreNom;
        } else {
            return res.status(400).json({ error: 'Type de document invalide' });
        }

        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Fichier non trouvé' });
        }

        res.download(filePath, fileName);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST - Valider candidature (secrétariat)
app.post('/api/valider-candidature/:id', authenticateToken, async (req, res) => {
    try {
        if (!['SECRETARIAT', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const candidature = await Candidature.findByPk(req.params.id);
        
        if (!candidature) {
            return res.status(404).json({ error: 'Candidature non trouvée' });
        }

        if (candidature.statutCandidature !== 'EN_ATTENTE') {
            return res.status(400).json({ error: 'Cette candidature a déjà été traitée' });
        }

        candidature.statutCandidature = 'VALIDE_SEC';
        candidature.commentaireSecretariat = req.body.commentaire || '';
        candidature.dateTraitementSecretariat = new Date().toISOString().split('T')[0];
        await candidature.save();

        // Journalisation
        await Log.create({
            userId: req.user.id,
            userEmail: req.user.email,
            action: 'CANDIDATURE_VALIDEE_SEC',
            details: `Candidature ${candidature.numeroDossier} validée par le secrétariat`,
            ip: req.ip
        });

        const etudiant = { nom: candidature.nom, prenom: candidature.prenom, email: candidature.email };
        await sendValidationSecretariat(etudiant, candidature.numeroDossier);

        const io = req.app.get('io');
        if (io) {
            io.emit('candidature_validee_sec', {
                candidatureId: candidature.id,
                numeroDossier: candidature.numeroDossier,
                nom: candidature.nom,
                prenom: candidature.prenom
            });
        }

        res.json({ success: true, message: 'Candidature validée, transmise à la DRH' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST - Rejeter candidature (secrétariat)
app.post('/api/rejeter-candidature/:id', authenticateToken, async (req, res) => {
    try {
        if (!['SECRETARIAT', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const candidature = await Candidature.findByPk(req.params.id);
        
        if (!candidature) {
            return res.status(404).json({ error: 'Candidature non trouvée' });
        }

        if (candidature.statutCandidature !== 'EN_ATTENTE') {
            return res.status(400).json({ error: 'Cette candidature a déjà été traitée' });
        }

        candidature.statutCandidature = 'REJETE_SEC';
        candidature.commentaireSecretariat = req.body.commentaire || 'Dossier non conforme';
        candidature.dateTraitementSecretariat = new Date().toISOString().split('T')[0];
        await candidature.save();

        // Journalisation
        await Log.create({
            userId: req.user.id,
            userEmail: req.user.email,
            action: 'CANDIDATURE_REJETEE_SEC',
            details: `Candidature ${candidature.numeroDossier} rejetée par le secrétariat`,
            ip: req.ip
        });

        const etudiant = { nom: candidature.nom, prenom: candidature.prenom, email: candidature.email };
        await sendRejetSecretariat(etudiant, candidature.numeroDossier, candidature.commentaireSecretariat);

        res.json({ success: true, message: 'Candidature rejetée' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 📋 ROUTES POUR DRH
// ============================================

// GET - Candidatures pour DRH
app.get('/api/candidatures-drh', authenticateToken, async (req, res) => {
    try {
        if (!['DRH', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const candidatures = await Candidature.findAll({
            where: { statutCandidature: 'VALIDE_SEC' },
            attributes: ['id', 'numeroDossier', 'nom', 'prenom', 'email', 'telephone', 
                        'universite', 'filiere', 'anneeEtude', 'periodeSouhaitee', 
                        'dateDepot', 'commentaireSecretariat', 'cvNom', 'lettreNom'],
            order: [['dateDepot', 'DESC']]
        });

        res.json(candidatures);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST - Valider candidature DRH
app.post('/api/valider-candidature-drh/:id', authenticateToken, async (req, res) => {
    try {
        if (!['DRH', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const candidature = await Candidature.findByPk(req.params.id);
        
        if (!candidature) {
            return res.status(404).json({ error: 'Candidature non trouvée' });
        }

        if (candidature.statutCandidature !== 'VALIDE_SEC') {
            return res.status(400).json({ error: 'Cette candidature n\'est pas prête pour la validation DRH' });
        }

        const stagiaire = await Stagiaire.create({
            candidatureId: candidature.id,
            nom: candidature.nom,
            prenom: candidature.prenom,
            email: candidature.email,
            telephone: candidature.telephone,
            universite: candidature.universite,
            statut: 'DEPOT',
            dateDepot: new Date().toISOString().split('T')[0],
            createdBy: req.user.email
        });

        candidature.statutCandidature = 'VALIDE_DRH';
        candidature.commentaireDRH = req.body.commentaire || '';
        candidature.dateTraitementDRH = new Date().toISOString().split('T')[0];
        await candidature.save();

        // Journalisation
        await Log.create({
            userId: req.user.id,
            userEmail: req.user.email,
            action: 'CANDIDATURE_VALIDEE_DRH',
            details: `Candidature ${candidature.numeroDossier} validée par la DRH - Stagiaire créé ID: ${stagiaire.id}`,
            ip: req.ip
        });

        const etudiant = { nom: candidature.nom, prenom: candidature.prenom, email: candidature.email };
        await sendValidationDRH(etudiant, candidature.numeroDossier);

        res.json({
            success: true,
            message: 'Candidature validée par la DRH, stagiaire créé',
            stagiaireId: stagiaire.id
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST - Rejeter candidature DRH
app.post('/api/rejeter-candidature-drh/:id', authenticateToken, async (req, res) => {
    try {
        if (!['DRH', 'ADMIN'].includes(req.user.role)) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const candidature = await Candidature.findByPk(req.params.id);
        
        if (!candidature) {
            return res.status(404).json({ error: 'Candidature non trouvée' });
        }

        if (candidature.statutCandidature !== 'VALIDE_SEC') {
            return res.status(400).json({ error: 'Cette candidature ne peut pas être rejetée' });
        }

        candidature.statutCandidature = 'REJETE_DRH';
        candidature.commentaireDRH = req.body.commentaire || 'Dossier non retenu';
        candidature.dateTraitementDRH = new Date().toISOString().split('T')[0];
        await candidature.save();

        // Journalisation
        await Log.create({
            userId: req.user.id,
            userEmail: req.user.email,
            action: 'CANDIDATURE_REJETEE_DRH',
            details: `Candidature ${candidature.numeroDossier} rejetée par la DRH`,
            ip: req.ip
        });

        const etudiant = { nom: candidature.nom, prenom: candidature.prenom, email: candidature.email };
        await sendRejetDRH(etudiant, candidature.numeroDossier, candidature.commentaireDRH);

        res.json({ success: true, message: 'Candidature rejetée par la DRH' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 📄 ROUTE ATTESTATION - AVEC LOGO
// ============================================
app.post('/api/attestation/:id', authenticateToken, async (req, res) => {
    try {
        const stagiaire = await Stagiaire.findByPk(req.params.id);
        
        if (!stagiaire) {
            return res.status(404).json({ error: 'Stagiaire non trouvé' });
        }
        
        if (stagiaire.statut !== 'TERMINE') {
            return res.status(400).json({ error: 'Seuls les stagiaires terminés peuvent avoir une attestation' });
        }
        
        // Journalisation
        await Log.create({
            userId: req.user.id,
            userEmail: req.user.email,
            action: 'ATTESTATION_GENEREE',
            details: `Attestation générée pour ${stagiaire.nom} ${stagiaire.prenom}`,
            ip: req.ip
        });
        
        // Chemin du logo
        const logoPath = path.join(__dirname, 'logo-onama.png');
        const logoExists = fs.existsSync(logoPath);
        
        console.log(`🔍 Logo path: ${logoPath}`);
        console.log(`✅ Logo existe: ${logoExists}`);
        
        const doc = new PDFDocument({ 
            size: 'A4', 
            margin: 50,
            layout: 'portrait'
        });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=attestation_${stagiaire.nom}_${stagiaire.prenom}.pdf`);
        
        doc.pipe(res);
        
        let y = 70;
        const centerX = doc.page.width / 2;
        
        // ========== LOGO ==========
        if (logoExists) {
            try {
                doc.image(logoPath, 50, y - 20, { width: 50 });
                doc.fontSize(10).font('Helvetica-Bold').fillColor('#1B3A5C').text('ONAMA', 110, y - 12);
                doc.fontSize(6).font('Helvetica').fillColor('#5D6D7E').text('Office National des Médias Audiovisuels', 110, y - 4);
                console.log('✅ Logo chargé avec succès');
            } catch (err) {
                console.error('Erreur chargement logo:', err);
                fallbackLogo(doc, y);
            }
        } else {
            console.log('⚠️ Logo non trouvé, utilisation du fallback');
            fallbackLogo(doc, y);
        }
        
        function fallbackLogo(doc, y) {
            doc.circle(65, y - 5, 20).fill('#1B3A5C');
            doc.fontSize(16).font('Helvetica-Bold').fillColor('#FFFFFF').text('O', 57, y - 12);
            doc.fontSize(11).font('Helvetica-Bold').fillColor('#1B3A5C').text('ONAMA', 95, y - 10);
            doc.fontSize(7).font('Helvetica').fillColor('#5D6D7E').text('Office National des Médias Audiovisuels', 95, y - 2);
        }
        
        // Ligne décorative
        doc.strokeColor('#D4AF37').lineWidth(1.5).moveTo(45, y + 12).lineTo(doc.page.width - 45, y + 12).stroke();
        
        y = y + 35;
        doc.y = y;
        
        // ========== TITRE ==========
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#1B3A5C').text('ATTESTATION DE STAGE', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(8).fillColor('#7F8C8D').text(`N° ATT-${stagiaire.id}-${new Date().getFullYear()}`, { align: 'center' });
        doc.moveDown(1);
        
        // ========== CORPS ==========
        doc.fontSize(10).font('Helvetica').fillColor('#2C3E50');
        doc.text('Je soussigné, Directeur des Ressources Humaines de l\'Office National des Médias Audiovisuels,', { align: 'center' });
        doc.moveDown(0.2);
        doc.text('certifie que :', { align: 'center' });
        doc.moveDown(0.8);
        
        const nomComplet = `${stagiaire.prenom || ''} ${stagiaire.nom || ''}`.trim().toUpperCase();
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#1B3A5C').text(nomComplet || '_____', { align: 'center' });
        doc.moveDown(0.5);
        
        let directionName = stagiaire.direction || 'NON SPÉCIFIÉE';
        if (directionName === 'TV') directionName = 'TÉLÉVISION NATIONALE';
        else if (directionName === 'RADIO') directionName = 'RADIODIFFUSION NATIONALE';
        else if (directionName === 'COM') directionName = 'COMMUNICATION NATIONALE';
        
        doc.fontSize(10).font('Helvetica');
        doc.text(`a effectué un stage au sein de la ${directionName}`, { align: 'center' });
        doc.moveDown(0.2);
        doc.text(`Service : ${stagiaire.service || 'Non spécifié'}`, { align: 'center' });
        doc.moveDown(0.2);
        
        const formatDate = (dateStr) => {
            if (!dateStr) return '_____';
            const date = new Date(dateStr);
            return date.toLocaleDateString('fr-FR');
        };
        
        doc.text(`Période : du ${formatDate(stagiaire.dateDebut)} au ${formatDate(stagiaire.dateFin)}`, { align: 'center' });
        doc.moveDown(0.8);
        
        const note = stagiaire.note || 0;
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1B3A5C').text(`Évaluation obtenue : ${note}/20`, { align: 'center' });
        doc.moveDown(0.2);
        
        let mention = '';
        if (note >= 18) mention = 'EXCELLENT';
        else if (note >= 16) mention = 'TRÈS BIEN';
        else if (note >= 14) mention = 'BIEN';
        else if (note >= 12) mention = 'ASSEZ BIEN';
        else if (note >= 10) mention = 'PASSABLE';
        else mention = 'INSUFFISANT';
        
        doc.fontSize(9).font('Helvetica-Oblique').fillColor('#27AE60').text(`Mention : ${mention}`, { align: 'center' });
        doc.moveDown(1);
        
        doc.fontSize(9).font('Helvetica').fillColor('#2C3E50');
        doc.text('Cette attestation est délivrée à l\'intéressé pour faire valoir ce que de droit.', { align: 'center' });
        doc.moveDown(0.5);
        
        const today = new Date();
        doc.text(`Fait à N'Djamena, le ${today.toLocaleDateString('fr-FR')}`, { align: 'center' });
        doc.moveDown(1.2);
        
        // Signatures
        const signatureY = doc.y;
        doc.strokeColor('#1B3A5C').lineWidth(0.8);
        doc.moveTo(centerX - 130, signatureY).lineTo(centerX - 30, signatureY).stroke();
        doc.fontSize(7).fillColor('#5D6D7E').text('Le Directeur des Ressources Humaines', centerX - 130, signatureY + 5);
        
        doc.moveTo(centerX + 30, signatureY).lineTo(centerX + 130, signatureY).stroke();
        doc.fontSize(7).fillColor('#5D6D7E').text('Le Directeur Général', centerX + 30, signatureY + 5);
        
        // Pied
        const pageHeight = doc.page.height;
        doc.fontSize(6).fillColor('#A0A0A0');
        doc.text('Office National des Médias Audiovisuels - N\'Djamena, Tchad', centerX, pageHeight - 30, { align: 'center', width: 400 });
        
        doc.end();
        
        console.log('✅ Attestation PDF générée (1 page)');
        
    } catch (error) {
        console.error('❌ Erreur:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 🚀 INITIALISATION DU SERVEUR AVEC SOCKET.IO
// ============================================
const server = http.createServer(app);
const socketIo = require('socket.io');
const io = socketIo(server, {
    cors: {
        origin: ['http://localhost:4200', 'https://onama-flow-frontend.onrender.com'],
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.set('io', io);

io.on('connection', (socket) => {
    console.log('🔌 Nouveau client connecté');
    
    socket.on('disconnect', () => {
        console.log('🔌 Client déconnecté');
    });
});

// ============================================
// PORT DYNAMIQUE POUR L'HÉBERGEMENT
// ============================================
const PORT = process.env.PORT || 5000;

// ============================================
// SYNCHRONISATION DE LA BASE DE DONNÉES
// ============================================
const forceSync = process.env.FORCE_SYNC === 'true';
sequelize.sync({ alter: false, force: forceSync }).then(async () => {
    // Synchroniser aussi le modèle Log
    await Log.sync();
    console.log("✅ Base de données synchronisée");
    
    const userCount = await User.count();
    if (userCount === 0) {
        const hashedPassword = await bcrypt.hash('123', 10);
        const adminPassword = await bcrypt.hash('admin123', 10);
        
        await User.bulkCreate([
            { nom: "Administrateur", prenom: "Système", email: "admin@onama.td", password: adminPassword, role: "ADMIN", directionAccess: "ALL", service: "" },
            { nom: "Secrétariat", prenom: "Général", email: "secretariat@onama.td", password: hashedPassword, role: "SECRETARIAT", directionAccess: "ALL", service: "" },
            { nom: "Responsable", prenom: "DRH", email: "drh@onama.td", password: hashedPassword, role: "DRH", directionAccess: "ALL", service: "" },
            { nom: "Directeur", prenom: "Télévision", email: "direction.tv@onama.td", password: hashedPassword, role: "DIRECTEUR", directionAccess: "TV", service: "" },
            { nom: "Directeur", prenom: "Radio", email: "direction.radio@onama.td", password: hashedPassword, role: "DIRECTEUR", directionAccess: "RADIO", service: "" },
            { nom: "Directeur", prenom: "Communication", email: "direction.com@onama.td", password: hashedPassword, role: "DIRECTEUR", directionAccess: "COM", service: "" },
            { nom: "Chef", prenom: "Service TV", email: "chef.tv@onama.td", password: hashedPassword, role: "CHEF_SERVICE", directionAccess: "TV", service: "Service rédaction TV" },
            { nom: "Chef", prenom: "Service Radio", email: "chef.radio@onama.td", password: hashedPassword, role: "CHEF_SERVICE", directionAccess: "RADIO", service: "Service rédaction radio" },
            { nom: "Chef", prenom: "Service Communication", email: "chef.com@onama.td", password: hashedPassword, role: "CHEF_SERVICE", directionAccess: "COM", service: "Service communication institutionnelle" }
        ]);
        
        console.log("\n✅ COMPTES CRÉÉS");
        console.log("┌─────────────────────────────────────────────────────────────────────────────┐");
        console.log("│ COMPTES DE TEST                                                            │");
        console.log("├─────────────────────────────────────────────────────────────────────────────┤");
        console.log("│ ADMIN                      │ admin@onama.td          │ admin123             │");
        console.log("│ SECRÉTARIAT                │ secretariat@onama.td    │ 123                  │");
        console.log("│ DRH                        │ drh@onama.td            │ 123                  │");
        console.log("│ Directeur Télévision      │ direction.tv@onama.td   │ 123                  │");
        console.log("│ Directeur Radio           │ direction.radio@onama.td│ 123                  │");
        console.log("│ Directeur Communication   │ direction.com@onama.td  │ 123                  │");
        console.log("│ Chef Service TV           │ chef.tv@onama.td        │ 123                  │");
        console.log("│ Chef Service Radio        │ chef.radio@onama.td     │ 123                  │");
        console.log("│ Chef Service Communication│ chef.com@onama.td       │ 123                  │");
        console.log("└─────────────────────────────────────────────────────────────────────────────┘");
    }
    
    server.listen(PORT, () => {
        console.log(`\n🚀 SERVEUR DÉMARRÉ SUR http://localhost:${PORT}`);
        console.log("📋 API disponibles:");
        console.log("   POST   /api/register                - Inscription étudiant");
        console.log("   POST   /api/login                   - Connexion");
        console.log("   POST   /api/refresh-token           - Rafraîchir token");
        console.log("   POST   /api/deposer-candidature     - Déposer candidature (CV+lettre)");
        console.log("   GET    /api/ma-candidature          - Ma candidature");
        console.log("   GET    /api/suivi-candidature/:id   - Suivi public");
        console.log("   GET    /api/candidatures-en-attente - Candidatures (secrétariat)");
        console.log("   POST   /api/valider-candidature/:id - Valider candidature (secrétariat)");
        console.log("   POST   /api/rejeter-candidature/:id - Rejeter candidature (secrétariat)");
        console.log("   GET    /api/candidatures-drh        - Candidatures (DRH)");
        console.log("   POST   /api/valider-candidature-drh/:id - Valider (DRH)");
        console.log("   POST   /api/rejeter-candidature-drh/:id - Rejeter (DRH)");
        console.log("   GET    /api/telecharger-document/:id/:type - Télécharger document");
        console.log("   GET    /api/stagiaires              - Liste des stagiaires");
        console.log("   GET    /api/stagiaires/direction    - Liste des stagiaires par direction");
        console.log("   GET    /api/stats                   - Statistiques");
        console.log("   POST   /api/attestation/:id         - Générer attestation");
        console.log("   📡 WebSocket activé pour notifications\n");
        console.log("🔒 SÉCURITÉ ACTIVÉE:");
        console.log("   - Rate limiting (5 tentatives/15min pour login)");
        console.log("   - Validation des entrées (express-validator)");
        console.log("   - Helmet (en-têtes HTTP sécurisés)");
        console.log("   - Refresh tokens");
        console.log("   - Journalisation des actions (Logs)");
    });
});