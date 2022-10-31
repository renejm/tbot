function toNumber(stringValue) {
    try {
        if (isNaN(stringValue)) return Number(stringValue.replace(/[^0-9\.]+/g, ""));
        return Number(stringValue);
    } catch (e) {
        return 0;
    }
}

function formatValue(value, suffix = '', decimalPlaces = 4) {
    let formattedValue = toNumber(value).toFixed(decimalPlaces).replace(/\./g, ",");
    if (suffix.length > 0) formattedValue += (suffix === '%') ? suffix : ` ${suffix}`;
    return formattedValue;
}

function fixLength(txt, len = 10, align = "L") {
    let ret = String(txt).trim();
    if (ret.length === len) return ret;
    if (ret.length > len) return ret.slice(0, len);
    const spaces = len - ret.length;
    if (align.toUpperCase() === "L") return `${ret}${" ".repeat(spaces)}`;
    if (align.toUpperCase() === "R") return `${" ".repeat(spaces)}${ret}`;
    const halfspc = parseInt(spaces / 2);
    return `${" ".repeat(halfspc)}${ret}${" ".repeat(spaces - halfspc)}`;
}

function hoursFromDate(dt) {
    //dt = dd/mm/aaaa hh/mm/ss
    let arrDt = dt.split(" ");
    const dtnow = new Date();
    arrDt.push(...arrDt[0].split("/").reverse());
    const dtpar = new Date(`${arrDt[2]}-${arrDt[3]}-${arrDt[4]}T${arrDt[1]}.000-03:00`);
    var millisecs = dtnow.getTime() - dtpar.getTime();
    return ((millisecs / 1000) / 60) / 60;
}

// Provoca uma pausa de duração aleatória entre 20 e 30 segundos (padrão).
async function sleep(minSecs = 10, maxSecs = 15) {
    const minMs = minSecs * 1000;
    const maxMs = maxSecs * 1000;
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (maxMs - minMs + 1) + minMs)));
}

function errorMsg(location, code, message) {
    return {error: {location, code, message}};
}

async function getDateDaysFromDate(numOfDays, date = new Date()) {
    const days = new Date(date.getTime());
    days.setDate(date.getDate() + numOfDays);
    return days;
}

async function elapsedHours(date = {}) {
    const now = new Date();
    return (((now.getTime() - date.getTime()) / 1000) / 60) / 60;
}

async function elapsedSecs(date = {}) {
    const now = new Date();
    return ((now.getTime() - date.getTime()) / 1000);
}

async function getDateFromMillis(millis) {
    const date = new Date(millis);
    return date.toLocaleString('pt-BR');
}

module.exports = { formatValue, sleep, fixLength, hoursFromDate, errorMsg, getDateDaysFromDate, getDateFromMillis, elapsedHours, elapsedSecs };
