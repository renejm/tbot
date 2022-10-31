const log = require('./log');
const utils = require('./utils');
const transaction = require('./transaction');
const dollarCur = process.env.DOLLARCURRENCY.toUpperCase();
const cryptoCur = process.env.CRYPTOCURRENCY.toUpperCase();
const minPerc = process.env.MINIMUM_RATE;
const minLogPerc = process.env.LOG_RATES_THRESHOLD;
const wsSecs = parseInt(process.env.WEBSOCKETS_INIT_IN_SECS);
let waitDot = "";

let checkForWebsocketsCounter = 0;
let timeWebsocketsStarted = {};

const currentSpot = {
    binance: {
        bestAsk: { // menor oferta de venda na Binance
            Price: -1,
            Quantity: -1
        },
        bestBid: { // maior oferta de compra na Binance
            Price: -1,
            Quantity: -1
        }
    },
    kucoin: {
        bestAsk: { // menor oferta de venda na Kucoin
            Price: -1,
            Quantity: -1
        },
        bestBid: { // maior oferta de compra na Kucoin
            Price: -1,
            Quantity: -1
        }
    },
    ratio: { // porcentagem para trade
        buyKucSellBin: 0,
        buyBinSellKuc: 0,
        maxBuyKucSellBin: 0,
        maxBuyBinSellKuc: 0
    }
};

async function setWebsocketsStartTime() {
    timeWebsocketsStarted = new Date();
}

async function calcPerc(bestBidPc, bestBidQt, bestAskPc, bestAskQt, exchange) {
    if (bestBidPc < 0 || bestAskPc < 0) return false;
    switch (exchange) {
        case "KUC":
            currentSpot.kucoin.bestBid.Price = bestBidPc;
            currentSpot.kucoin.bestBid.Quantity = bestBidQt;
            currentSpot.kucoin.bestAsk.Price = bestAskPc;
            currentSpot.kucoin.bestAsk.Quantity = bestAskQt;
            break;
        case "BIN":
            currentSpot.binance.bestBid.Price = bestBidPc;
            currentSpot.binance.bestBid.Quantity = bestBidQt;
            currentSpot.binance.bestAsk.Price = bestAskPc;
            currentSpot.binance.bestAsk.Quantity = bestAskQt;
            break;
        default:
            return false;
    }
    // Calcular as porcentagens no dois sentidos
    currentSpot.ratio.buyBinSellKuc = ((currentSpot.kucoin.bestBid.Price / currentSpot.binance.bestAsk.Price) - 1) * 100;
    currentSpot.ratio.buyKucSellBin = ((currentSpot.binance.bestBid.Price / currentSpot.kucoin.bestAsk.Price) - 1) * 100;

    if (currentSpot.binance.bestAsk.Price < 0 || currentSpot.binance.bestBid.Price < 0 || currentSpot.kucoin.bestAsk.Price < 0 || currentSpot.kucoin.bestBid.Price < 0) return false;

    process.stdout.write('\033c');

    // Parar aqui caso ainda não tenha dado o tempo de inicialização dos websockets
    if (await utils.elapsedSecs(timeWebsocketsStarted) < wsSecs) {
        waitDot += "█";
        console.log(`\n\n\n⏳ \x1b[1;97mINICIALIZANDO WEBSOCKETS\n\n${waitDot}\x1b[0;30m\x1b[5;0H`);
        return true;
    }
    if (waitDot.length > 0) waitDot = "";

    console.log('\x1b[1;93mBINANCE:\x1b[0;0m');
    console.log(`  \x1b[1;32mMaior lance de compra: \x1b[0;92m${utils.formatValue(currentSpot.binance.bestBid.Price, dollarCur, 5)} \x1b[1;32m🠊\x1b[0;92m ${utils.formatValue(currentSpot.binance.bestBid.Quantity, cryptoCur, 2)}\x1b[0;0m`);
    console.log(`  \x1b[1;31mMenor oferta de venda: \x1b[0;91m${utils.formatValue(currentSpot.binance.bestAsk.Price, dollarCur, 5)} \x1b[1;31m🠊\x1b[0;91m ${utils.formatValue(currentSpot.binance.bestAsk.Quantity, cryptoCur, 2)}\x1b[0;0m`);
    console.log('\n\x1b[1;93mKUCOIN:\x1b[0;0m');
    console.log(`  \x1b[1;32mMaior lance de compra: \x1b[0;92m${utils.formatValue(currentSpot.kucoin.bestBid.Price, dollarCur, 5)} \x1b[1;32m🠊\x1b[0;92m ${utils.formatValue(currentSpot.kucoin.bestBid.Quantity, cryptoCur, 2)}\x1b[0;0m`);
    console.log(`  \x1b[1;31mMenor oferta de venda: \x1b[0;91m${utils.formatValue(currentSpot.kucoin.bestAsk.Price, dollarCur, 5)} \x1b[1;31m🠊\x1b[0;91m ${utils.formatValue(currentSpot.kucoin.bestAsk.Quantity, cryptoCur, 2)}\x1b[0;0m`);
    console.log(`\n\x1b[1;32mCompra na Binance \x1b[1;93me\x1b[1;31m venda na Kucoin: \x1b[0;96m${(currentSpot.ratio.buyBinSellKuc < 0) ? "-" : utils.formatValue(currentSpot.ratio.buyBinSellKuc, '%')}\x1b[0;0m`);
    console.log(`\x1b[1;32mCompra na Kucoin \x1b[1;93me\x1b[1;31m venda na Binance: \x1b[0;96m${(currentSpot.ratio.buyKucSellBin < 0) ? "-" : utils.formatValue(currentSpot.ratio.buyKucSellBin, '%')}\x1b[0;0m\n`);

    //Exibir relógio para saber se travou!
    console.log(`\x1b[0;34mÚltima atualização em ${log.getTimestamp(false)}\x1b[0;0m\n\n`);

    if (currentSpot.ratio.buyBinSellKuc > currentSpot.ratio.maxBuyBinSellKuc) {
        currentSpot.ratio.maxBuyBinSellKuc = currentSpot.ratio.buyBinSellKuc;
        log.record(`Novo pico para compra na Binance e venda na Kucoin: ${utils.formatValue(currentSpot.ratio.maxBuyBinSellKuc, '%')}`);
    } else if (currentSpot.ratio.buyBinSellKuc >= minLogPerc) {
        log.record(`% compra na Binance e venda na Kucoin:............. ${utils.formatValue(currentSpot.ratio.buyBinSellKuc, '%')}`);
    }

    if (currentSpot.ratio.buyKucSellBin > currentSpot.ratio.maxBuyKucSellBin) {
        currentSpot.ratio.maxBuyKucSellBin = currentSpot.ratio.buyKucSellBin;
        log.record(`Novo pico para compra na Kucoin e venda na Binance: ${utils.formatValue(currentSpot.ratio.maxBuyKucSellBin, '%')}`);
    } else if (currentSpot.ratio.buyKucSellBin >= minLogPerc) {
        log.record(`% compra na Kucoin e venda na Binance:............. ${utils.formatValue(currentSpot.ratio.buyKucSellBin, '%')}`);
    }

    // Caso tenha atingido ou ultrapassado a porcentagem mínima entre as contas, posicionar ordens de compra e venda.
    if (currentSpot.ratio.buyKucSellBin >= minPerc || currentSpot.ratio.buyBinSellKuc >= minPerc)
        await transaction.trade(currentSpot);
    else
        checkForWebsocketsCounter++;
        if (checkForWebsocketsCounter > 500) {
            await transaction.checkWebsocketsForRestarting(timeWebsocketsStarted);
            checkForWebsocketsCounter = 0;
        }

    return true;
}

module.exports = { calcPerc, setWebsocketsStartTime };
