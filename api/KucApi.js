const log = require('../log');
const utils = require('../utils');
const crypto = require('crypto');
const sdk = require("kucoin-node-sdk");
const { features } = require('process');
const kucoinKeys = {
    baseUrl: process.env.KUC_API_URL,
    apiAuth: {
        key: process.env.KUC_API_KEY,
        secret: process.env.KUC_SECRET_KEY,
        passphrase: process.env.KUC_PASSPHRASE
    },
    authVersion: 2
};
const dollarchain = process.env.DOLLAR_BLOCKCHAIN;
const cryptochain = process.env.CRYPTO_BLOCKCHAIN;
const dollarCur = process.env.DOLLARCURRENCY.toUpperCase();
const cryptoCur = process.env.CRYPTOCURRENCY.toUpperCase();
const symbolCur = `${cryptoCur}-${dollarCur}`;
const topic = `/market/ticker:${symbolCur}`;
let bestAsk = -1; //menor oferta de venda
let bestBid = -1; //maior oferta de compra 

sdk.init(kucoinKeys);
let ws = null;
let cbId = 0; // Usado para parar o websocket.

async function callerFunction(depth = 2) {
    return (new Error().stack.split("at ")[depth]).replace(/(async|Object\.)/g, "").trim();
}

function randomNumber(min, max) {
    return String(Math.random() * (max - min) + min);
}

function getRandomUUID(size = 32) {
    const timestamp = Date.now();
    let id = crypto.createHmac('Sha256', kucoinKeys.apiAuth.passphrase)
        .update(new URLSearchParams({ ...kucoinKeys, timestamp }).toString())
        .digest('hex');
    let exceed = id.length - size;
    if (exceed < 1) return id;
    let start = exceed - randomNumber(0, exceed);
    return id.slice(start, start + size);
}

async function isGettingSpot() {
    if (ws === null) return false;
    return ws.trustConnected;
}

async function getSymbolInfo(symbol = symbolCur) {
    try {
        const symbolsLst = await sdk.rest.Market.Symbols.getSymbolsList();
        for (let i = 0; i < symbolsLst.data.length; i++) {
            if (symbolsLst.data[i].symbol === symbol) return symbolsLst.data[i];
        }
        return {};
    }
    catch (err) {
        return {};
    }
}

async function startWebsocket() {
    const monitor = require('../monitor');
    ws = new sdk.websocket.Datafeed();
    ws.connectSocket();
    await monitor.setWebsocketsStartTime();
    log.record("Conectado ao websocket da Kucoin.");
    cbId = ws.subscribe(topic, async (m) => {
        const curBestAsk = parseFloat(m.data.bestAsk);
        const bestAskQt = parseFloat(m.data.bestAskSize);
        const curBestBid = parseFloat(m.data.bestBid);
        const bestBidQt = parseFloat(m.data.bestBidSize);
        // Recalcular apenas se atualizou
        if (curBestAsk != bestAsk || curBestBid != bestBid) {
            bestAsk = curBestAsk;
            bestBid = curBestBid;
            await monitor.calcPerc(bestBid, bestBidQt, bestAsk, bestAskQt, "KUC");
        }
    });
}

async function stopWebsocket() {
    if (await isGettingSpot()) {
        ws.unsubscribe(topic, cbId);
        cbId = 0;
        bestAsk = -1;
        bestBid = -1;
        log.record("Desconectado do websocket da Kucoin.");
    }
}

async function getTotalCryptoBalance() {
    const bal = await getBalance(true);
    let bid = await getHighestBid('KCS-USDT'); //obtendo ask atual da KCS
    let sum = bal['KCS'] * bid[0]; //convertendo KCS em USDT
    sum += bal[dollarCur]; //somando USDT com o KCS convertido em USDT
    bid = await getLowestAsk(); //obtendo valor atual da crypto
    sum /= bid[0]; //dividindo USDT pelo valor atual da crypto
    sum += bal[cryptoCur]; //somando o resultado com o saldo em crypto
    return sum;
}

async function getBalance(total = false) {
    try {
        const data = {
            type: 'trade'
        }
        const accountList = await sdk.rest.User.Account.getAccountsList(data);
        let res = {};
        accountList.data.forEach((acc) => {
            res[acc.currency] = (total) ? parseFloat(acc.balance) : parseFloat(acc.available);
        });
        return res;
    }
    catch (err) {
        return {};
    }
}

// retorna um array com o valor do maior bid e a quantidade de moedas
async function getHighestBid(symbol = symbolCur) {
    const dep = await sdk.rest.Market.OrderBook.getLevel2_20(symbol);
    return dep.data.bids[0];
}

// retorna um array com o valor do menor ask e a quantidade de moedas
async function getLowestAsk(symbol = symbolCur) {
    const dep = await sdk.rest.Market.OrderBook.getLevel2_20(symbol);
    return dep.data.asks[0];
}

async function cancelOrder(Id) {
    const res = await sdk.rest.Trade.Orders.cancelOrder(Id);
    if (res.code === '200000') return res.data.cancelledOrderIds;
    const errObj = utils.errorMsg(await callerFunction(), res.code, res.msg);
    //await log.logError(errObj);
    return errObj;
}

async function cancelAllOrders() {
    const baseParams = {
        symbol: symbolCur
    };
    const res = await sdk.rest.Trade.Orders.cancelAllOrders(baseParams);
    if (res.code === '200000') return res.data.cancelledOrderIds;
    const errObj = utils.errorMsg(await callerFunction(), res.code, res.msg);
    //await log.logError(errObj);
    return errObj;
}

async function newOrder(quantity, price, side = 'BUY') {
    const baseParams = {
        clientOid: getRandomUUID(),
        side: side.toLowerCase(),
        symbol: symbolCur
    };
    const orderParams = {
        price: parseFloat(price).toFixed(5),
        size: parseFloat(quantity).toFixed(5)
    }
    const res = await sdk.rest.Trade.Orders.postOrder(baseParams, orderParams);

    if (res.code === '200000') {
        return {
            orderId: res.data.orderId,
            clientOrderId: baseParams.clientOid,
            operation: side,
            symbol: symbolCur,
            price: price,
            quantity: quantity
        }
    }
    const errObj = utils.errorMsg(await callerFunction(), res.code, res.msg);
    await log.logError(errObj);
    return errObj;
}

async function getMinDollars() {
    try {
        const dollarInfo = await getSymbolInfo();
        return dollarInfo.quoteMinSize;
    }
    catch (err) {
        return 0;
    }
}

async function getMinCryptos() {
    try {
        const dollarInfo = await getSymbolInfo();
        return dollarInfo.baseMinSize;
    }
    catch (err) {
        return 0;
    }
}

async function moveAllToTradeAccount() {
    const mainDollars = await getBalance('DOLLAR', 'main');
    const mainCryptos = await getBalance('CRYPTO', 'main');
    let res = {};
    let transferOk = true;
    if (mainDollars > 0) {
        res = await sdk.rest.User.Account.innerTransfer(getRandomUUID(), dollarCur, 'main', 'trade', mainDollars);
        if (res.code != '200000') {
            await log.logError(utils.errorMsg(await callerFunction(), res.code, res.msg));
            transferOk = false;
        }
    }
    if (mainCryptos > 0) {
        res = await sdk.rest.User.Account.innerTransfer(getRandomUUID(), cryptoCur, 'main', 'trade', mainCryptos);
        if (res.code != '200000') {
            await log.logError(utils.errorMsg(await callerFunction(), res.code, res.msg));
            transferOk = false;
        }
    }
    return transferOk;
}

async function moveToMainAccount(amount, curType) {
    // curType: "DOLLAR" ou "CRYPTO"
    const currency = (curType.trim().toUpperCase() === 'DOLLAR') ? dollarCur : cryptoCur;
    let res = {};
    let transferOk = true;
    if (amount > 0) {
        res = await sdk.rest.User.Account.innerTransfer(getRandomUUID(), currency, 'trade', 'main', parseFloat(amount).toFixed(5));
        if (res.code != '200000') {
            await log.logError(utils.errorMsg(await callerFunction(), res.code, res.msg));
            transferOk = false;
        }
    }
    return transferOk;
}

/*
 * @param {string} currency - Currency
 * @param {string} address - Withdrawal address
 * @param {number} amount - Withdrawal amount, a positive number which is a multiple of the amount precision (fees excluded)
 * @param {Object}
 *  - {string} memo - [Optional] Address remark. If there’s no remark, it is empty. When you withdraw from other platforms to
 *      the KuCoin, you need to fill in memo(tag). If you do not fill memo (tag), your deposit may not be available, please be cautious.
 *  - {boolean} isInner - [Optional] Internal withdrawal or not. Default setup: false
 *  - {string} remark - [Optional] Remark
 *  - {string} chain - [Optional] The chain name of currency, e.g. The available value for USDT are OMNI, ERC20, TRC20, default is ERC20.
 *      This only apply for multi-chain currency, and there is no need for single chain currency.
*/
async function Transfer(curType, amount, walletAddress, memoToken) {
    // curType: "DOLLAR" ou "CRYPTO"
    const currency = (curType.trim().toUpperCase() === 'DOLLAR') ? dollarCur : cryptoCur;
    const depositObj = {
        memo: memoToken,
        isInner: false,
        remark: "AbbTradeBot"
    };
    depositObj.chain = (currency === dollarCur) ? dollarchain : cryptochain;
    const res = await sdk.rest.User.Withdrawals.applyWithdraw(currency, walletAddress, parseFloat(amount).toFixed(5), depositObj);
    //return res;
    if (res.code === '200000') {
        let ret = {
            address: walletAddress,
            memo: memoToken
        };
        ret.blockchain = (currency === dollarCur) ? dollarchain : cryptochain;
        return ret;
    }
    const errObj = utils.errorMsg(await callerFunction(), res.code, res.msg);
    await log.logError(errObj);
    return errObj;
}

async function getWalletAddress(curType) {
    // curType: "DOLLAR" ou "CRYPTO"
    const currency = (curType.trim().toUpperCase() === 'DOLLAR') ? dollarCur : cryptoCur;
    let res = await sdk.rest.User.Deposit.getDepositAddressV2(currency);

    if (res.code === '200000') {
        if (res.data.length > 0) {
            return {
                address: res.data[0].address,
                memo: res.data[0].memo
            }
        }
        let ntw = {};
        ntw.chain = (currency === dollarCur) ? dollarchain : cryptochain;
        res = await sdk.rest.User.Deposit.getDepositAddress(currency, ntw);
        //console.log(res);
        if (res.code === '200000') {
            return {
                address: res.data[0].address,
                memo: res.data[0].memo
            }
        }
    }
    const errObj = utils.errorMsg(await callerFunction(), res.code, res.msg);
    await log.logError(errObj);
    return errObj;
}

async function getOrders() {
    const startDate = await utils.getDateDaysFromDate(-5);
    const endDate = await utils.getDateDaysFromDate(1);
    const params = {
        status: "active",
        startAt: startDate.getTime(),
        endAt: endDate.getTime()
    }
    const orderList = await sdk.rest.Trade.Orders.getOrdersList("TRADE", params);
    let res = [];
    orderList.data.items.forEach((order) => {
        const date = new Date(order.createdAt);
        res.push({
            orderId: order.id,
            clientOrderId: order.clientOid,
            side: order.side.toUpperCase(),
            symbol: order.symbol,
            price: order.price,
            quantity: order.size,
            createdAt: date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        });
    });
    return res;
}

async function getFormattedOrdersList() {
    const orderList = await getOrders();
    if (orderList.length > 0) {
        const ct1 = "\n\x1b[1;96m";
        const ct2 = "\n\x1b[1;93m";
        const cbuy = "\n\x1b[0;32m";
        const csel = "\n\x1b[0;31m";
        const cend = "\x1b[0;0m";
        let ret = (orderList.length > 1) ? `${ct1}KUCOIN (${orderList.length} ordens pendentes):` : `${ct1}KUCOIN (1 ordem pendente):`;
        ret += `\n${ct2}Id                        Operação           Preço     Quantidade  Ordem criada em`;
        ret += `\n--------------------------------------------------------------------------------------`;
        const spaces = " ".repeat(2);
        orderList.forEach((ord) => {
            if (ord.side === 'BUY') {
                ord.side = 'Compra';
                ret += cbuy;
            } else {
                ord.side = 'Venda';
                ret += csel;
            }
            ord.price = utils.formatValue(ord.price, dollarCur, 4);
            ord.quantity = utils.formatValue(ord.quantity, cryptoCur, 0);
            ret += utils.fixLength(ord.orderId, 25);
            ret += `${spaces}${utils.fixLength(ord.side, 8)}`;
            ret += `${spaces}${utils.fixLength(ord.price, 13, "R")}`;
            ret += `${spaces}${utils.fixLength(ord.quantity, 13, "R")}`;
            ret += `${spaces}${utils.fixLength(ord.createdAt, 19)}`;
        });
        ret += `${ct2}--------------------------------------------------------------------------------------${cend}`;
        return ret;
    }
    return "\n\x1b[1;96mNão há ordens pendentes na Kucoin!\x1b[0;0";
}

module.exports = {
    isGettingSpot,
    startWebsocket,
    stopWebsocket,
    getTotalCryptoBalance,
    getBalance,
    getHighestBid,
    getLowestAsk,
    cancelOrder,
    cancelAllOrders,
    newOrder,
    getMinCryptos,
    getMinDollars,
    Transfer,
    getWalletAddress,
    moveAllToTradeAccount,
    moveToMainAccount,
    getOrders,
    getFormattedOrdersList
};
