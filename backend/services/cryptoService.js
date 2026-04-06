const crypto = require('crypto');

const ENC_PREFIX = 'enc:v1';

function getEncryptionKey() {
    const envKey = process.env.APP_ENCRYPTION_KEY;
    if (envKey) {
        if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
            return Buffer.from(envKey, 'hex');
        }

        return crypto.createHash('sha256').update(envKey).digest();
    }

    const fallback = process.env.SESSION_SECRET || 'cloudcostguard-dev-secret-change-in-prod';
    return crypto.createHash('sha256').update(fallback).digest();
}

function encryptText(plainText) {
    if (plainText === undefined || plainText === null || plainText === '') {
        return '';
    }

    if (typeof plainText !== 'string') {
        plainText = String(plainText);
    }

    if (plainText.startsWith(`${ENC_PREFIX}:`)) {
        return plainText;
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${ENC_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptText(cipherText) {
    if (!cipherText) return '';
    if (typeof cipherText !== 'string') return '';
    if (!cipherText.startsWith(`${ENC_PREFIX}:`)) return cipherText;

    const parts = cipherText.split(':');
    if (parts.length !== 4) {
        throw new Error('Invalid encrypted payload format');
    }

    const key = getEncryptionKey();
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = Buffer.from(parts[3], 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}

module.exports = {
    encryptText,
    decryptText
};
