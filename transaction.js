const log = require('./log');
const utils = require('./utils');
const Bin = require('./api/BinApi');
const Kuc = require('./api/KucApi');
const wsHours = process.env.WEBSOCKET_LIFECYCLE;
const eqHours = process.env.EQUALIZATION_CYCLE;
const dollarCur = process.env.DOLLARCURRENCY.toUpperCase();
const cryptoCur = process.env.CRYPTOCURRENCY.toUpperCase();
const minOrder = parseInt(process.env.MINIMUM_ORDER_IN_DOLLAR);
const maxBudget = parseFloat(process.env.MAXIMUM_BUDGET_RATE);
const eqPerc = parseFloat(process.env.ACCOUNTS_EQUALIZATION_THRESHOLD);
const stopOnFirstOrder = (parseInt(process.env.STOP_ON_FIRST_ORDER) === 1);
const stopOnFirstTransfer = (parseInt(process.env.STOP_ON_FIRST_TRANSFER) === 1);
const priceStrategy = parseInt(process.env.PRICE_STRATEGY);
const quantityStrategy = parseInt(process.env.QUANTITY_STRATEGY);
const addRate = parseFloat(process.env.ADDITIONAL_RATE_FOR_ORDERS).toFixed(3);
const balRate = parseInt(process.env.BALANCE_RATE_FOR_ORDERS);
const sellbuy = (parseInt(process.env.SELL_BEFORE_BUYING) === 1);
const mirror = (parseInt(process.env.MIRROR_ORDERS) === 1);
const ordersLifetime = parseInt(process.env.ORDERS_LIFETIME);
const cleanupHours = process.env.CLEANUP_TIME.split("-").map(hr => hr = parseInt(hr));
let isMirrorOk = true;
let lastEqualizationTime = new Date();
let inTrade = false;
let bidExchange = "";
let askExchange = "";

function isError(resObj) {
    return resObj.hasOwnProperty("error");
}

async function cleanupOrders() {
    const dt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hour = dt.getHours();
    const minute = dt.getMinutes();
    let ret = false;
    if (cleanupHours.includes(hour) && minute < 20) {
        const binOrders = await Bin.getOrders();
        const kucOrders = await Kuc.getOrders();
        binOrders.forEach(async (ord) => {
            if (utils.hoursFromDate(ord.createdAt) > ordersLifetime) {
                const res = await Bin.cancelOrder(ord.orderId);
                if (res.hasOwnProperty('error')) log.logError(res);
                else log.record(`BINANCE: A ordem ${ord.orderId} expirou e foi cancelada!`);
                ret = true;
            }
        });
        kucOrders.forEach(async (ord) => {
            if (utils.hoursFromDate(ord.createdAt) > ordersLifetime) {
                const res = await Kuc.cancelOrder(ord.orderId);
                if (res.hasOwnProperty('error')) log.logError(res);
                else log.record(`KUCOIN: A ordem ${ord.orderId} expirou e foi cancelada!`);
                ret = true;
            }
        });
    }
    return ret;
}

async function checkForEqualization() {
    if (await utils.elapsedHours(lastEqualizationTime) < eqHours) return await startWS();

    let binBalance = await Bin.getBalance();
    let kucBalance = await Kuc.getBalance();

    log.record(`Saldos: Binance (${utils.formatValue(binBalance[dollarCur], dollarCur, 2)} e ${utils.formatValue(binBalance[cryptoCur], cryptoCur, 2)}) | Kucoin (${utils.formatValue(kucBalance[dollarCur], dollarCur, 2)} e ${utils.formatValue(kucBalance[cryptoCur], cryptoCur, 2)})`);
    let dollarsFrom = (binBalance[dollarCur] > kucBalance[dollarCur]) ? 'bin' : 'kuc';
    let cryptosFrom = (binBalance[cryptoCur] > kucBalance[cryptoCur]) ? 'bin' : 'kuc';
    let minRate = 100 - eqPerc;
    let dollarsRate = (dollarsFrom === 'bin') ? ((kucBalance[dollarCur] / binBalance[dollarCur]) * 100) : ((binBalance[dollarCur] / kucBalance[dollarCur]) * 100);
    let cryptosRate = (cryptosFrom === 'bin') ? ((kucBalance[cryptoCur] / binBalance[cryptoCur]) * 100) : ((binBalance[cryptoCur] / kucBalance[cryptoCur]) * 100);
    
    if (dollarsRate <= minRate || cryptosRate <= minRate) {
        // A equalização é necessária!!!!
        // Verificar se há ordens pendentes...
        let binOrders = await Bin.getOrders();
        let kucOrders = await Kuc.getOrders();
        let qtBinOrders = binOrders.length;
        let qtKucOrders = kucOrders.length;
        let count = 0;

        log.record("*** EQUALIZAÇÃO NECESSÁRIA!!! ***");

        if (qtBinOrders + qtKucOrders > 0) {
            log.record(`Número de ordens pendentes => Binance: ${qtBinOrders} | Kucoin: ${qtKucOrders}`);
            log.record(`Iniciando checagem de ordens pendentes por 10 minutos...`);
            for (count = 0; count < 20; count++) {
                await utils.sleep(30, 30);
                binOrders = await Bin.getOrders();
                kucOrders = await Kuc.getOrders();
                qtBinOrders = binOrders.length;
                qtKucOrders = kucOrders.length;
                if (qtBinOrders === 0 && qtKucOrders === 0){
                    log.record(`Não há mais ordens pendentes!`);
                    break;
                }
            }
            if (count < 20) log.record(`Ordens ainda pendentes => Binance: ${qtBinOrders} | Kucoin: ${qtKucOrders}`);
            
            if (qtBinOrders > 0) {
                log.record("Orden(s) pendente(s) na Binance:");
                binOrders.forEach((order) => {
                    log.record(` ${(order.side.toUpperCase === "BUY") ? "Compra" : "Venda"} => Id: ${order.orderId} | ${utils.formatValue(order.price, dollarCur, 2)} | ${utils.formatValue(order.quantity, cryptoCur, 2)} | Criada em ${order.createdAt}`);
                });
            }
            if (qtKucOrders > 0) {
                log.record("Orden(s) pendente(s) na Kucoin:");
                kucOrders.forEach((order) => {
                    log.record(` ${(order.side.toUpperCase === "BUY") ? "Compra" : "Venda"} => Id: ${order.orderId} | ${utils.formatValue(order.price, dollarCur, 2)} | ${utils.formatValue(order.quantity, cryptoCur, 2)} | Criada em ${order.createdAt}`);
                });
            }

            binBalance = await Bin.getBalance();
            kucBalance = await Kuc.getBalance();

            log.record(`Saldos: Binance (${utils.formatValue(binBalance[dollarCur], dollarCur, 2)} e ${utils.formatValue(binBalance[cryptoCur], cryptoCur, 2)}) | Kucoin (${utils.formatValue(kucBalance[dollarCur], dollarCur, 2)} e ${utils.formatValue(kucBalance[cryptoCur], cryptoCur, 2)})`);
            dollarsFrom = (binBalance[dollarCur] > kucBalance[dollarCur]) ? 'bin' : 'kuc';
            cryptosFrom = (binBalance[cryptoCur] > kucBalance[cryptoCur]) ? 'bin' : 'kuc';
            minRate = 100 - eqPerc;
            dollarsRate = (dollarsFrom === 'bin') ? ((kucBalance[dollarCur] / binBalance[dollarCur]) * 100) : ((binBalance[dollarCur] / kucBalance[dollarCur]) * 100);
            cryptosRate = (cryptosFrom === 'bin') ? ((kucBalance[cryptoCur] / binBalance[cryptoCur]) * 100) : ((binBalance[cryptoCur] / kucBalance[cryptoCur]) * 100);
        }

        if (dollarsRate <= minRate) {
            if (dollarsFrom === 'bin') {
                const amt = ((binBalance[dollarCur] + kucBalance[dollarCur]) / 2) - kucBalance[dollarCur];
                log.record(`Transferindo ${utils.formatValue(amt, dollarCur, 2)} da Binance para a Kucoin.`);
                if (stopOnFirstOrder || stopOnFirstTransfer) {
                    log.record(`(([Bin $] + [Kuc $]) / 2) - [Kuc $] = ${amt}`);
                }
                await binToKuc('DOLLAR', amt);
            } else {
                const amt = ((kucBalance[dollarCur] + binBalance[dollarCur]) / 2) - binBalance[dollarCur];
                log.record(`Transferindo ${utils.formatValue(amt, dollarCur, 2)} da Kucoin para a Binance.`);
                if (stopOnFirstOrder || stopOnFirstTransfer) {
                    log.record(`(([Kuc $] + [Bin $]) / 2) - [Bin $] = ${amt}`);
                }
                await kucToBin('DOLLAR', amt);
            }
        }
        if (cryptosRate <= minRate) {
            if (cryptosFrom === 'bin') {
                const amt = ((binBalance[cryptoCur] + kucBalance[cryptoCur]) / 2) - kucBalance[cryptoCur];
                log.record(`Transferindo ${utils.formatValue(amt, cryptoCur, 2)} da Binance para a Kucoin.`);
                if (stopOnFirstOrder || stopOnFirstTransfer) {
                    log.record(`(([Bin #] + [Kuc #]) / 2) - [Kuc #] = ${amt}`);
                }
                await binToKuc('CRYPTO', amt);
            } else {
                const amt = ((kucBalance[cryptoCur] + binBalance[cryptoCur]) / 2) - binBalance[cryptoCur];
                log.record(`Transferindo ${utils.formatValue(amt, cryptoCur, 2)} da Kucoin para a Binance.`);
                if (stopOnFirstOrder || stopOnFirstTransfer) {
                    log.record(`(([Kuc #] + [Bin #]) / 2) - [Bin #] = ${amt}`);
                }
                await kucToBin('CRYPTO', amt);
            }
        }

        for (count = 0; count < 30; count++) {
            await utils.sleep(20, 20);
            const binCurBal = await Bin.getBalance();
            const kucCurBal = await Kuc.getBalance();
            if (binBalance[dollarCur] != binCurBal[dollarCur] || binBalance[cryptoCur] != binCurBal[cryptoCur] || kucBalance[dollarCur] != kucCurBal[dollarCur] || kucBalance[cryptoCur] != kucCurBal[cryptoCur]) {
                log.record(`A equalização foi concluída dentro dos 10 minutos de espera! Continuando com o bot...`);
                binBalance = binCurBal;
                kucBalance = kucCurBal;
                break;
            }
        }
        if (count < 30) log.record(`Após 10 minutos de espera, as transferências ainda não foram efetuadas! Continuando com o bot...`);

        log.record(`Saldos: Binance (${utils.formatValue(binBalance[dollarCur], dollarCur, 2)} e ${utils.formatValue(binBalance[cryptoCur], cryptoCur, 2)}) | Kucoin (${utils.formatValue(kucBalance[dollarCur], dollarCur, 2)} e ${utils.formatValue(kucBalance[cryptoCur], cryptoCur, 2)})`);
        
        if (stopOnFirstTransfer) {
            console.log(`**************************************************************************`);
            console.log(`O parâmetro "STOP_ON_FIRST_TRANSFER" está com valor 1, portanto, o`);
            console.log(`bot foi desligado após a primeira transferência de equalização (bem`);
            console.log(`sucedida ou não).`);
            console.log(`Favor checar o arquivo log.txt para analisar o que ocorreu nestas`);
            console.log(`transferências de equalização.`);
            console.log(`**************************************************************************`);
            process.exit(0);
        }
    } else {
        log.record("Equalização não é necessária no momento. Continuando com o bot...");
    }
    return await startWS();
}

async function binToKuc(curType, amount) {
    //Pegar carteira da Kucoin para saque na Binance
    const wallet = await Kuc.getWalletAddress(curType);
    if (wallet.hasOwnProperty('error')) return false;
    //log.record(`Carteira ${(curType === "DOLLAR") ? "USDC" : "XRP"} da Kucoin: ${wallet.address}`, true);
    const res = await Bin.Transfer(curType, amount, wallet.address, wallet.memo);
    //return res;
    if (res.hasOwnProperty('error')) return false;
    return true;
}

async function kucToBin(curType, amount) {
    //Mover valores para a conta main
    if (await Kuc.moveToMainAccount(amount, curType)) {
        //Pegar carteira da Binance para saque na Kucoin
        const wallet = await Bin.getWalletAddress(curType);
        if (wallet.hasOwnProperty('error')) return false;
        //log.record(`Carteira ${(curType === "DOLLAR") ? "USDC" : "XRP"} da Binance: ${wallet.address}`, true);
        const res = await Kuc.Transfer(curType, amount, wallet.address, wallet.memo);
        //return res;
        if (res.hasOwnProperty('error')) return false;
        return true;
    }
    return false;
}

async function getOrderQuantity(highestBid, dollarsAvailable, lowestAsk, cryptosAvailable) {
    // menor valor entre os saldos
    const minBalance = Math.min(dollarsAvailable, (highestBid[0] * cryptosAvailable));
    if (quantityStrategy === 2) {
        const orderVal = (minBalance * balRate) / 100;
        const orderQtt = parseInt(orderVal / highestBid[0]);

        if (stopOnFirstOrder || stopOnFirstTransfer) {
            log.record("**************************************************************************");
            log.record("********************* Estratégia de Quantidade nº 2 **********************");
            log.record(`CÁLCULO DO VALOR MÁXIMO (MENOR VALOR) ($ = dólares | # = criptomoedas):`);
            log.record(`     $ = dólares`);
            log.record(`     # = criptomoedas`);
            log.record("--------------------------------------------------------------------------");
            log.record(`[saldo para compra $] = ${dollarsAvailable}`);
            log.record(`([${bidExchange} bid ($)] * [saldo para venda #]) = (${highestBid[0]} * ${cryptosAvailable}) = ${highestBid[0] * cryptosAvailable}`);
            log.record("--------------------------------------------------------------------------");
            log.record(`[MENOR SALDO] = ${minDollars}`);
            log.record(`[${balRate}% DO MENOR SALDO] = ${orderVal}`);
            log.record(`[QUANTIDADE DE MOEDAS] = ${orderQtt}`);
            log.record("**************************************************************************");
        }
        return (orderVal < minOrder) ? minBalance : orderQtt;
    }
    const minDollars = Math.min((lowestAsk[0] * lowestAsk[1]), (highestBid[0] * highestBid[1]), minBalance);
    // O valor da ordem de compra não deve ultrapassar "maxBudget"% do saldo.
    const orderMaxLimit = (minBalance * maxBudget) / 100;
    const orderVal = (minDollars > orderMaxLimit) ? orderMaxLimit : minDollars;
    const orderQtt = parseInt(orderVal / highestBid[0]);

    if (stopOnFirstOrder || stopOnFirstTransfer) {
        log.record("**************************************************************************");
        log.record("********************* Estratégia de Quantidade nº 1 **********************");
        log.record(`CÁLCULO DO VALOR MÁXIMO (MENOR VALOR) ($ = dólares | # = criptomoedas):`);
        log.record(`     $ = dólares`);
        log.record(`     # = criptomoedas`);
        log.record("--------------------------------------------------------------------------");
        log.record(`([${askExchange} ask ($)] * [${askExchange} ask (#)]) = (${lowestAsk[0]} * ${lowestAsk[1]}) = ${lowestAsk[0] * lowestAsk[1]}`);
        log.record(`([${bidExchange} bid ($)] * [${bidExchange} bid (#)]) = (${highestBid[0]} * ${highestBid[1]}) = ${highestBid[0] * highestBid[1]}`);
        log.record(`[saldo para compra $] = ${dollarsAvailable}`);
        log.record(`([${bidExchange} bid ($)] * [saldo para venda #]) = (${highestBid[0]} * ${cryptosAvailable}) = ${highestBid[0] * cryptosAvailable}`);
        log.record("--------------------------------------------------------------------------");
        log.record(`[MENOR VALOR] = ${minDollars}`);
        log.record(`[VALOR DA ORDEM (limitado a ${maxBudget}% do saldo)] = ${orderVal}`);
        log.record(`[QUANTIDADE DE MOEDAS] = ${orderQtt}`);
        log.record("**************************************************************************");
    }
    return (orderVal < minOrder) ? 0 : orderQtt;
}

async function startWS() {
    if (stopOnFirstOrder) {
        console.log(`**************************************************************************`);
        console.log(`O parâmetro "STOP_ON_FIRST_ORDER" está com valor 1, portanto, o`);
        console.log(`bot foi desligado após a primeira ordem (bem sucedida ou não).`);
        console.log(`Favor checar o arquivo log.txt para analisar o que ocorreu nestas`);
        console.log(`ordens de compra e venda, bem como na possível equalização.`);
        console.log(`**************************************************************************`);
        process.exit(0);
    }
    await utils.sleep();
    await Bin.startWebsocket();
    await Kuc.startWebsocket();
    return true;
}

async function trade(spot = {}) {
    if (inTrade || spot === {}) return false;
    inTrade = true;

    console.log(`\n\x1b[1;93m💰 DISPARANDO ORDENS!\x1b[0;0m\n`);         

    // Parar websockets
    await Bin.stopWebsocket();
    await Kuc.stopWebsocket();

    let msg = "";
    let binBalance = {};
    let kucBalance = {};
    let highestBid = [];
    let lowestAsk = [];
    let orderQtty = 0;
    let res = {};
    let price = 0;

    if (spot.ratio.buyKucSellBin > spot.ratio.buyBinSellKuc) {
        bidExchange = "BIN";
        askExchange = "KUC";
        // Comprar na Kucoin e vender na Binance

        lowestAsk = [spot.kucoin.bestAsk.Price, spot.kucoin.bestAsk.Quantity];
        highestBid = [spot.binance.bestBid.Price, spot.binance.bestBid.Quantity];

        // Checar saldo na Kucoin
        kucBalance = await Kuc.getBalance();

        // Checar saldo na Binance
        binBalance = await Bin.getBalance();

        orderQtty = await getOrderQuantity(highestBid, kucBalance[dollarCur], lowestAsk, binBalance[cryptoCur]);
        if (orderQtty > 0) {
            if (sellbuy) {
                log.record(`★ Postando ordem de venda na Binance: ${orderQtty} ${cryptoCur} a ${utils.formatValue(highestBid[0], dollarCur, 4)}`);
                res = await Bin.newOrder(orderQtty, highestBid[0], 'SELL');
                if (!isError(res)) {
                    log.record(`🡅 Ordem de venda registrada na Binance sob Id ${res.orderId}`);
                    if (mirror) {
                        log.record(`☆ Espelhando ordem de venda na Kucoin: ${orderQtty} ${cryptoCur} a ${utils.formatValue(highestBid[0], dollarCur, 5)}`);
                        res = await Kuc.newOrder(orderQtty, highestBid[0], 'SELL');
                        isMirrorOk = !isError(res);
                        if (isMirrorOk) log.record(`⇧ Ordem de venda espelhada na Kucoin sob Id ${res.orderId}`);
                    }

                    //price = (priceStrategy === 2) ? (highestBid[0] * ( 1 - ((addRate / 100) + (spot.ratio.buyKucSellBin / 100)))) : lowestAsk[0];
                    price = (priceStrateg21y === 2) ? (highestBid[0] * ( 1 - (addRate / 100) )) : lowestAsk[0];

                    if (stopOnFirstOrder) {
                        log.record("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
                        log.record("CÁLCULO DO PREÇO DE COMPRA NA KUCOIN:   (vende e compra)");
                        log.record("price = (priceStrategy === 2) ? (bid * ( 1 - (addRate / 100) )) : ask;");
                        log.record(`price = (${priceStrategy} === 2) ? (${highestBid[0]} * ( 1 - (${addRate} / 100) )) : ${lowestAsk[0]};`);
                        log.record(` ==> Preço de venda na Binance = bid (${highestBid[0]})`);
                        log.record("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
                    }

                    log.record(`★ Postando ordem de compra na Kucoin: ${orderQtty} ${cryptoCur} a ${utils.formatValue(price, dollarCur, 5)}`);
                    res = await Kuc.newOrder(orderQtty, price);
                    if (!isError(res)) {
                        log.record(`🡇 Ordem de compra registrada na Kucoin sob Id ${res.orderId}`);
                        if (mirror && isMirrorOk) {
                            log.record(`☆ Espelhando ordem de compra na Binance: ${orderQtty} ${cryptoCur} a ${utils.formatValue(price, dollarCur, 4)}`);
                            res = await Bin.newOrder(orderQtty, price);
                            if (!isError(res)) log.record(`⇩ Ordem de compra espelhada na Binance sob Id ${res.orderId}`);
                        }
                    }
                }
            } else {
                log.record(`★ Postando ordem de compra na Kucoin: ${orderQtty} ${cryptoCur} a ${utils.formatValue(lowestAsk[0], dollarCur, 5)}`);
                res = await Kuc.newOrder(orderQtty, lowestAsk[0]);
                if (!isError(res)) {
                    log.record(`🡇 Ordem de compra registrada na Kucoin sob Id ${res.orderId}`);
                    if (mirror) {
                        log.record(`☆ Espelhando ordem de compra na Binance: ${orderQtty} ${cryptoCur} a ${utils.formatValue(lowestAsk[0], dollarCur, 4)}`);
                        res = await Bin.newOrder(orderQtty, lowestAsk[0]);
                        isMirrorOk = !isError(res);
                        if (isMirrorOk) log.record(`⇩ Ordem de compra espelhada na Binance sob Id ${res.orderId}`);
                    }

                    //price = (priceStrategy === 2) ? (lowestAsk[0] * ((addRate / 100) + (spot.ratio.buyKucSellBin / 100) + 1)) : highestBid[0];
                    price = (priceStrategy === 2) ? (lowestAsk[0] * ((addRate / 100) + 1)) : highestBid[0];

                    if (stopOnFirstOrder) {
                        log.record("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
                        log.record("CÁLCULO DO PREÇO DE VENDA NA BINANCE:   (compra e vende)");
                        log.record("price = (priceStrategy === 2) ? (ask * ((addRate / 100) + 1)) : bid;");
                        log.record(`price = (${priceStrategy} === 2) ? (${lowestAsk[0]} * ((${addRate} / 100) + 1 )) : ${highestBid[0]};`);
                        log.record(` ==> Preço de compra na Kucoin = ask (${lowestAsk[0]})`);
                        log.record("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
                    }
                    
                    log.record(`★ Postando ordem de venda na Binance: ${orderQtty} ${cryptoCur} a ${utils.formatValue(price, dollarCur, 4)}`);
                    res = await Bin.newOrder(orderQtty, price, 'SELL');
                    if (!isError(res)) {
                        log.record(`🡅 Ordem de venda registrada na Binance sob Id ${res.orderId}`);
                        if (mirror && isMirrorOk) {
                            log.record(`☆ Espelhando ordem de venda na Kucoin: ${orderQtty} ${cryptoCur} a ${utils.formatValue(price, dollarCur, 5)}`);
                            res = await Kuc.newOrder(orderQtty, price, 'SELL');
                            if (!isError(res)) log.record(`⇧ Ordem de venda espelhada na Kucoin sob Id ${res.orderId}`);
                        }
                    }
                }
            }
        } else {
            msg = `❌ A ordem não atingiu o valor mínimo definido em "MINIMUM_ORDER_IN_DOLLAR" (${utils.formatValue(minOrder, dollarCur, 5)})`;
            console.log(`\x1b[1;91m${msg}\x1b[0;0m`);
            log.record(msg);
        }
    } else {
        bidExchange = "KUC";
        askExchange = "BIN";
        // Comprar na Binance e vender na Kucoin

        lowestAsk = [spot.binance.bestAsk.Price, spot.binance.bestAsk.Quantity];
        highestBid = [spot.kucoin.bestBid.Price, spot.kucoin.bestBid.Quantity];

        // Checar saldo na Binance
        binBalance = await Bin.getBalance();

        // Checar saldo na Kucoin
        kucBalance = await Kuc.getBalance();

        orderQtty = await getOrderQuantity(highestBid, binBalance[dollarCur], lowestAsk, kucBalance[cryptoCur]);
        if (orderQtty > 0) {            
            if (sellbuy) {
                log.record(`★ Postando ordem de venda na Kucoin: ${orderQtty} ${cryptoCur} a ${utils.formatValue(highestBid[0], dollarCur, 5)}`);
                res = await Kuc.newOrder(orderQtty, highestBid[0], 'SELL');
                if (!isError(res)) {
                    log.record(`🡅 Ordem de venda registrada na Kucoin sob Id ${res.orderId}`);
                    if (mirror) {
                        log.record(`☆ Espelhando ordem de venda na Binance: ${orderQtty} ${cryptoCur} a ${utils.formatValue(highestBid[0], dollarCur, 4)}`);
                        res = await Bin.newOrder(orderQtty, highestBid[0], 'SELL');
                        isMirrorOk = !isError(res);
                        if (isMirrorOk) log.record(`⇧ Ordem de venda espelhada na Binance sob Id ${res.orderId}`);
                    }

                    //price = (priceStrategy === 2) ? (highestBid[0] * ( 1 - ((addRate / 100) + (spot.ratio.buyBinSellKuc / 100)))) : lowestAsk[0];
                    price = (priceStrategy === 2) ? (highestBid[0] * ( 1 - (addRate / 100) )) : lowestAsk[0];

                    if (stopOnFirstOrder) {
                        log.record("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
                        log.record("CÁLCULO DO PREÇO DE COMPRA NA BINANCE:   (vende e compra)");
                        log.record("price = (priceStrategy === 2) ? (bid * ( 1 - (addRate / 100) )) : ask;");
                        log.record(`price = (${priceStrategy} === 2) ? (${highestBid[0]} * ( 1 - (${addRate} / 100) )) : ${lowestAsk[0]};`);
                        log.record(` ==> Preço de venda na Kucoin = bid (${highestBid[0]})`);
                        log.record("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
                    }

                    log.record(`★ Postando ordem de compra na Binance: ${orderQtty} ${cryptoCur} a ${utils.formatValue(price, dollarCur, 4)}`);
                    res = await Bin.newOrder(orderQtty, price);
                    if (!isError(res)) {
                        log.record(`🡇 Ordem de compra registrada na Binance sob Id ${res.orderId}`);
                        if (mirror && isMirrorOk) {
                            log.record(`☆ Espelhando ordem de compra na Kucoin: ${orderQtty} ${cryptoCur} a ${utils.formatValue(price, dollarCur, 5)}`);
                            res = await Kuc.newOrder(orderQtty, price);
                            if (!isError(res)) log.record(`⇩ Ordem de compra espelhada na Kucoin sob Id ${res.orderId}`);
                        }
                    }
                }
            } else {
                log.record(`★ Postando ordem de compra na Binance: ${orderQtty} ${cryptoCur} a ${utils.formatValue(lowestAsk[0], dollarCur, 4)}`);
                res = await Bin.newOrder(orderQtty, lowestAsk[0]);
                if (!isError(res)) {
                    log.record(`🡇 Ordem de compra registrada na Binance sob Id ${res.orderId}`);
                    if (mirror) {
                        log.record(`☆ Espelhando ordem de compra na Kucoin: ${orderQtty} ${cryptoCur} a ${utils.formatValue(lowestAsk[0], dollarCur, 5)}`);
                        res = await Kuc.newOrder(orderQtty, lowestAsk[0]);
                        isMirrorOk = !isError(res);
                        if (isMirrorOk) log.record(`⇩ Ordem de compra espelhada na Kucoin sob Id ${res.orderId}`);
                    }

                    //price = (priceStrategy === 2) ? (lowestAsk[0] * ((addRate / 100) + (spot.ratio.buyBinSellKuc / 100) + 1)) : highestBid[0];
                    price = (priceStrategy === 2) ? (lowestAsk[0] * ((addRate / 100)  + 1 )) : highestBid[0];

                    if (stopOnFirstOrder) {
                        log.record("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
                        log.record("CÁLCULO DO PREÇO DE VENDA NA KUCOIN:   (compra e vende)");
                        log.record("price = (priceStrategy === 2) ? (ask * ((addRate / 100) + 1)) : bid;");
                        log.record(`price = (${priceStrategy} === 2) ? (${lowestAsk[0]} * ((${addRate} / 100) + 1 )) : ${highestBid[0]};`);
                        log.record(` ==> Preço de compra na Binance = ask (${lowestAsk[0]})`);
                        log.record("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@");
                    }
                    
                    log.record(`★ Postando ordem de venda na Kucoin: ${orderQtty} ${cryptoCur} a ${utils.formatValue(price, dollarCur, 5)}`);
                    res = await Kuc.newOrder(orderQtty, price, 'SELL');
                    if (!isError(res)) {
                        log.record(`🡅 Ordem de venda registrada na Kucoin sob Id ${res.orderId}`);
                        if (mirror && isMirrorOk) {
                            log.record(`☆ Espelhando ordem de venda na Binance: ${orderQtty} ${cryptoCur} a ${utils.formatValue(price, dollarCur, 4)}`);
                            res = await Bin.newOrder(orderQtty, price, 'SELL');
                            if (!isError(res)) log.record(`⇧ Ordem de venda espelhada na Binance sob Id ${res.orderId}`);
                        }
                    }
                }
            }
        } else {
            msg = `❌ A ordem não atingiu o valor mínimo definido em "MINIMUM_ORDER_IN_DOLLAR" (${utils.formatValue(minOrder, dollarCur, 5)})`;
            console.log(`\x1b[1;91m${msg}\x1b[0;0m`);
            log.record(msg);
        }
    }

    await cleanupOrders();

    await Kuc.moveAllToTradeAccount(); //Manter todo o capital da Kucoin na conta trade.

    const processoCompleto = await checkForEqualization();

    inTrade = false;
    return processoCompleto;
}

async function checkWebsocketsForRestarting(startTime) {    
    if (await utils.elapsedHours(startTime) > wsHours) {
        log.record(`Reiniciando websockets após ${wsHours} horas ininterruptas...`);
        await Bin.stopWebsocket();
        await Kuc.stopWebsocket();
        await utils.sleep(10, 10);
        await Bin.startWebsocket();
        await Kuc.startWebsocket();
    }
}

module.exports = { trade, checkWebsocketsForRestarting };
