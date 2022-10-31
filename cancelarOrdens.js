const Bin = require('./api/BinApi');
const Kuc = require('./api/KucApi');
const readlineSync = require('readline-sync');
const crd = "\x1b[0;91m";
const cyl = "\x1b[0;93m";
const ccy = "\x1b[0;96m";
const cwt = "\x1b[0;97m";
const crs = "\x1b[0;0m\n";

async function cancelar() {
    let confirm = "";
    let errmsg = "";

    while( !(confirm.length === 24 || confirm.length === 10 || confirm === "t" || confirm === "x") ) {
        process.stdout.write('\033c');
        console.log(`\n${errmsg}\n\n`);
        confirm = readlineSync.question(`${cyl}Informe a ordem a ser cancelada:\n${ccy}-Para cancelar 1 ordem, digite o Id da ordem.\n-Para cancelar todas as ordens, digite T.\n-Para sair, digite X.${cyl}\n\t➜   ${cwt}`);
        confirm = String(confirm).trim().toLowerCase();
        errmsg = `${crd}Parâmetro incorreto! Tente novamente.`;
    }
    switch (confirm) {
        case "t":
            Bin.cancelAllOrders();            
            Kuc.cancelAllOrders();
            console.log(`\n${cyl}TODAS AS ORDENS FORAM CANCELADAS!${crs}`);
            break;
        case "x":
            console.log(`\n${crd}Procedimento cancelado! Nenhuma ação foi feita.${crs}`);
            break;
        default:
            if (confirm.length === 24) {
                const res = await Kuc.cancelOrder(confirm);
                if (res.hasOwnProperty('error')) console.log(`\n${crd}ERRO NA KUCOIN: ${res.error.message}${crs}`);
                else console.log(`\n${cyl}1 ordem da Kucoin foi cancelada!${crs}`);
            } else {
                const res = await Bin.cancelOrder(confirm);
                if (res.hasOwnProperty('error')) console.log(`\n${crd}ERRO NA BINANCE: ${res.error.message}${crs}`);
                else console.log(`\n${cyl}1 ordem da Binance foi cancelada!${crs}`);
            }
    }
}

module.exports = { cancelar };

cancelar();
