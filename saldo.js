const utils = require('./utils');
const Bin = require('./api/BinApi');
const Kuc = require('./api/KucApi');
const dollarCur = process.env.DOLLARCURRENCY.toUpperCase();
const cryptoCur = process.env.CRYPTOCURRENCY.toUpperCase();
const ct = "\x1b[1;97m";
const cx = "\x1b[0;93m";
const ccr = "\x1b[0;95m";
const cdl = "\x1b[0;96m";

async function saldo() {
    const saldoBin = await Bin.getBalance();
    const saldoKuc = await Kuc.getBalance();
    let cryptosBin = await Kuc.getTotalCryptoBalance();
    let cryptosKuc = await Bin.getTotalCryptoBalance();

    console.log(`${ct}--------------------------------------------------
SALDO E ORDENS PENDENTES
--------------------------------------------------${cx}
    BINANCE: ${cdl}${utils.formatValue(saldoBin[dollarCur], dollarCur, 4)}${cx} e ${ccr}${utils.formatValue(saldoBin[cryptoCur], cryptoCur, 4)}${cx}
     KUCOIN: ${cdl}${utils.formatValue(saldoKuc[dollarCur], dollarCur, 4)}${cx} e ${ccr}${utils.formatValue(saldoKuc[cryptoCur], cryptoCur, 4)}${cx}
${ct}--------------------------------------------------${cx}
        TOTAL DE ${cryptoCur}s: ${ccr}${utils.formatValue(cryptosBin + cryptosKuc, cryptoCur, 4)}${ct}
${await Bin.getFormattedOrdersList()}
${await Kuc.getFormattedOrdersList()}
`);
}

module.exports = { saldo };

saldo();
