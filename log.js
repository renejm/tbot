function getTimestamp(appendDash = true) {
    const dt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return (appendDash) ? `${dt} - ` : dt;
}

async function record(strLine, toScreen = false) {
    const fs = require('fs/promises');
    try {
        await fs.appendFile('./log.txt', `${getTimestamp()}${strLine}\n`);
        if (toScreen) console.log(strLine);
        return true;
    } catch (err) {
        return false;
    }
}

async function logError(errObj) {
    try {
        return record(`❌ ERRO EM ${errObj.error.location} ➟ Cód.: ${errObj.error.code} ➟ ${errObj.error.message}`);
    }
    catch(err) {
        return false;
    }
}

async function shutDown(msg) {
    try {
        if (typeof msg === 'object')
            console.log(JSON.stringify(msg, null, 4));
        else
            console.log(msg);
        process.exit(0);
    }
    catch(err) {
        process.exit(0);
    }
}

module.exports = { record, logError, shutDown, getTimestamp };
