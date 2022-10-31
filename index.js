const log = require('./log');
const Bin = require('./api/BinApi');
const Kuc = require('./api/KucApi');
const utils = require('./utils');
const dollarCur = process.env.DOLLARCURRENCY.toUpperCase();
const cryptoCur = process.env.CRYPTOCURRENCY.toUpperCase();
const priceStrategy = parseInt(process.env.PRICE_STRATEGY);
const quantityStrategy = parseInt(process.env.QUANTITY_STRATEGY);
const addRate = parseFloat(process.env.ADDITIONAL_RATE_FOR_ORDERS);
const balRate = parseInt(process.env.BALANCE_RATE_FOR_ORDERS);

log.record('Bot iniciado...');
log.record(`MOEDAS: ${dollarCur} e ${cryptoCur}`);
log.record(`ESTRATÉGIA DE PREÇO:.........${priceStrategy}${(priceStrategy === 2) ? ` (porcentagem adicional de ${utils.formatValue(addRate, '%', 3)})` : ""}`);
log.record(`ESTRATÉGIA DE QUANTIDADE:....${quantityStrategy}${(quantityStrategy === 2) ? ` (ordens no valor de ${balRate}% do saldo)` : ""}`);

Bin.startWebsocket();
Kuc.startWebsocket();
