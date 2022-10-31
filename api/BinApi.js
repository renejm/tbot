const log = require('../log');
const utils = require('../utils');
const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');

const apiKey = process.env.BIN_API_KEY;
const apiSecret = process.env.BIN_SECRET_KEY;
const apiUrl = process.env.BIN_API_URL;
const wsUrl = process.env.BIN_WS_URL;
const dollarchain = process.env.DOLLAR_BLOCKCHAIN;
const cryptochain = process.env.CRYPTO_BLOCKCHAIN;
const dollarCur = process.env.DOLLARCURRENCY.toUpperCase();
const cryptoCur = process.env.CRYPTOCURRENCY.toUpperCase();
const symbolCur = `${cryptoCur}${dollarCur}`;
const topic = `${cryptoCur.toLowerCase()}${dollarCur.toLowerCase()}@bookTicker`;
let bestAsk = -1; //menor oferta de venda
let bestBid = -1; //maior oferta de compra 

let ws = null;

async function callerFunction(depth = 4) {
    return (new Error().stack.split("at ")[depth]).replace(/(async|Object\.)/g, "").trim();
}

async function isGettingSpot() {
    if (ws === null) return false;
    return (ws.readyState === 1) ? true : false;
}

async function startWebsocket() {
    const monitor = require('../monitor');
    ws = new WebSocket(wsUrl);
    ws.onopen = async () => {
        if (ws.readyState === 1) {
            ws.send(JSON.stringify({
                "method": "SUBSCRIBE",
                "params": [topic],
                "id": 1
            }));
        };
        await monitor.setWebsocketsStartTime();
        log.record("Conectado ao websocket da Binance.");
    };
    ws.onmessage = async (m) => {
        if (ws.readyState === 1) {
            const dt = JSON.parse(m.data);
            if (dt.hasOwnProperty("a")) {
                const curBestAsk = parseFloat(dt.a);
                const bestAskQt = parseFloat(dt.A);
                const curBestBid = parseFloat(dt.b);
                const bestBidQt = parseFloat(dt.B);
                // Recalcular apenas se atualizou
                if (curBestAsk != bestAsk || curBestBid != bestBid) {
                    bestAsk = curBestAsk;
                    bestBid = curBestBid;
                    await monitor.calcPerc(bestBid, bestBidQt, bestAsk, bestAskQt, "BIN");
                }
            }
        }
    };
    ws.onerror = async (error) => {
        log.record(`Erro no websocket da Binance: ${error.message}`);
    };
}

async function stopWebsocket() {
    if (await isGettingSpot()) {
        ws.close();
        log.record("Desconectado do websocket da Binance.");
        bestAsk = -1;
        bestBid = -1;
    }
}

async function publicCall(path, data, method = 'GET') {
    try {
        const qs = data ? `?${new URLSearchParams(data).toString()}` : '';
        //console.log(qs);
        const result = await axios({
            method,
            url: `${apiUrl}${path}${qs}`
        });
        return result.data;
    }
    catch (err) {
        const errObj = utils.errorMsg(
            await callerFunction(),
            err.response.data.code,
            `${err.response.status} (${err.response.statusText}) • ${err.response.data.msg}`
        );
        await log.logError (errObj);
        return errObj;
    }
}

async function privateCall(path, data = {}, method = 'GET') {
    const timestamp = Date.now();
    const recvWindow = 6000;
    const signature = crypto.createHmac('Sha256', apiSecret)
        .update(new URLSearchParams({ ...data, timestamp, recvWindow }).toString())
        .digest('hex');
    const newData = { ...data, timestamp, recvWindow, signature };
    const qs = `?${new URLSearchParams(newData).toString()}`;
    //console.log(qs);

    try {
        const result = await axios({
            method,
            url: `${apiUrl}${path}${qs}`,
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        return result.data;
    }
    catch (err) {
        const statusText = (err.response.hasOwnProperty('statusText') && err.response.statusText.length > 0) ? ` (${err.response.statusText})` : '';
        const errObj = utils.errorMsg(
            await callerFunction(),
            err.response.data.code,
            `${err.response.status}${statusText} • ${err.response.data.msg}`
        );
        await log.logError (errObj);
        return errObj;
    }
}

async function cancelOrder(Id) {
    const symbol = symbolCur;
    const orderId = parseInt(Id);
    const data = { symbol, orderId };
    let res = await privateCall('/api/v3/order', data, 'DELETE');
    if (res.hasOwnProperty('error')) return res;
    return [res.orderId];
}

async function cancelAllOrders() {
    const symbol = symbolCur;
    const data = { symbol };
    let orders = await privateCall('/api/v3/openOrders', data, 'DELETE');
    if (orders.hasOwnProperty('error')) return orders;
    let res = [];
    orders.forEach((order) => {
        res.push (order.orderId);
    });
    return res;
}

async function newOrder(qtty, price, side = 'BUY') {
    const type = 'LIMIT';
    const symbol = symbolCur;
    const quantity = parseFloat(qtty).toFixed(4);
    const data = { symbol, side, type, quantity };
    if (price) data.price = parseFloat(price).toFixed(4);
    data.timeInForce = 'GTC';
    const res = await privateCall('/api/v3/order', data, 'POST');
    if (res.hasOwnProperty('error')) return res;
    return {
        orderId: res.orderId,
        clientOrderId: res.clientOrderId,
        operation: side,
        symbol: symbolCur,
        price: res.price,
        quantity: res.origQty
    }
}

async function getTotalCryptoBalance() {
    const bal = await getBalance(true);
    let bid = await getHighestBid('BNBUSDT'); //obtendo ask atual da BNB
    let sum = bal['BNB'] * bid[0]; //convertendo BNB em USDT
    sum += bal[dollarCur]; //somando USDT com o BNB convertido em USDT
    bid = await getLowestAsk(); //obtendo valor atual da crypto
    sum /= bid[0]; //dividindo USDT pelo valor atual da crypto
    sum += bal[cryptoCur]; //somando o resultado com o saldo em crypto
    return sum;
}

async function getBalance(total = false) {
    try {
        const accInfo = await privateCall('/api/v3/account');
        let res = {};
        accInfo.balances.forEach((acc) => {
            if (acc.asset === dollarCur || acc.asset === cryptoCur || acc.asset === "BNB") res[acc.asset] = (total) ? parseFloat(acc.locked) + parseFloat(acc.free) : parseFloat(acc.free);
        });
        return res;
    }
    catch (err) {
        return {};
    }
}

async function time() {
    return publicCall('/api/v3/time');
}

async function depth(symbol = symbolCur, limit = 2) {
    return publicCall('/api/v3/depth', { symbol, limit });
}

// retorna um array com o valor do maior valor de compra e a quantidade de moedas
async function getHighestBid(symbol = symbolCur) {
    const dep = await depth(symbol);
    return dep.bids[0];
}

// retorna um array com o valor do menor valor de venda e a quantidade de moedas
async function getLowestAsk(symbol = symbolCur) {
    const dep = await depth(symbol);
    return dep.asks[0];
}

async function exchangeInfo() {
    return publicCall('/api/v3/exchangeInfo');
}

async function Transfer(curType, amount, walletAddress, memoToken) {
    // curType: "DOLLAR" ou "CRYPTO"
    const currency = (curType.trim().toUpperCase() === 'DOLLAR') ? dollarCur : cryptoCur;
    let data = {
        coin: currency,
        address: walletAddress,
        addressTag: memoToken,
        amount: parseFloat(amount).toFixed(4),
        name: 'AbbTradeBot'
    };
    data.network = (currency === dollarCur) ? dollarchain : cryptochain;
    const res = await privateCall('/sapi/v1/capital/withdraw/apply', data, 'POST');
    //return res;
    if (res.hasOwnProperty('error')) return res;
    let ret = {
        address: walletAddress,
        memo: memoToken
    };
    ret.blockchain = (currency === dollarCur) ? dollarchain : cryptochain;
    return ret;
}

async function getWalletAddress(curType) {
    // curType: "DOLLAR" ou "CRYPTO"
    const currency = (curType.trim().toUpperCase() === 'DOLLAR') ? dollarCur : cryptoCur;
    const data = { coin: currency };
    data.network = (currency === dollarCur) ? dollarchain : cryptochain;
    const res = await privateCall('/sapi/v1/capital/deposit/address', data);
    if (res.hasOwnProperty('error')) return res;
    return {
        address: res.address,
        memo: res.tag
    };
}

async function getOrders() {
    const data = { symbol: symbolCur };
    const orderList = await privateCall('/api/v3/openOrders', data);
    if (orderList.hasOwnProperty('error')) return orderList;
    let res = [];
    orderList.forEach((order) => {
        const date = new Date(order.time);
        res.push ({
            orderId: order.orderId,
            clientOrderId: order.clientOrderId,
            side: order.side.toUpperCase(),
            symbol: order.symbol,
            price: order.price,
            quantity: order.origQty,
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
        let ret = (orderList.length > 1) ? `${ct1}BINANCE (${orderList.length} ordens pendentes):` : `${ct1}BINANCE (1 ordem pendente):`;
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
    return "\n\x1b[1;96mNão há ordens pendentes na Binance!\x1b[0;0";
}

module.exports = {
    isGettingSpot,
    startWebsocket,
    stopWebsocket,
    time,
    depth,
    getHighestBid,
    getLowestAsk,
    exchangeInfo,
    getTotalCryptoBalance,
    getBalance,
    cancelOrder,
    cancelAllOrders,
    newOrder,
    Transfer,
    getWalletAddress,
    getOrders,
    getFormattedOrdersList
};
