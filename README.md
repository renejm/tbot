# ABBTrade Bot

ABBTrade é um bot de automação de transações entre operadoras de criptomoedas (exchanges).


# Instalação:
Criar um arquivo chamado `.env` na raiz da aplicação. O conteúdo deste arquivo deve ter o seguinte formato:
```
# API da Binance
BIN_API_URL=https://api.binance.com
BIN_WS_URL=wss://stream.binance.com:9443/ws/bookTicker
BIN_API_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
BIN_SECRET_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# API da Kucoin
KUC_API_URL=https://api.kucoin.com
KUC_API_KEY=XXXXXXXXXXXXXXXXXXXXXXXX
KUC_SECRET_KEY=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
KUC_PASSPHRASE=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Definição de moedas
DOLLARCURRENCY=USDT
DOLLAR_BLOCKCHAIN=trx
CRYPTOCURRENCY=XRP
CRYPTO_BLOCKCHAIN=xrp

# Parâmetros gerais
ACCOUNTS_EQUALIZATION_THRESHOLD=90
LOG_RATES_THRESHOLD=0.1
MINIMUM_ORDER_IN_DOLLAR=10
WEBSOCKETS_INIT_IN_SECS=10
WEBSOCKET_LIFECYCLE=12
EQUALIZATION_CYCLE=20
STOP_ON_FIRST_ORDER=0
MINIMUM_RATE=0.3
ADDITIONAL_RATE_FOR_ORDERS=0.1
MAXIMUM_BUDGET_RATE=80
BALANCE_RATE_FOR_ORDERS=10
SELL_BEFORE_BUYING=1
MIRROR_ORDERS=0

# Definição da estratégia (1 ou 2)
PRICE_STRATEGY=1
QUANTITY_STRATEGY=1
# ===================================================================================================================================================
# PRICE_STRATEGY=1:    O preço ou cotação das ordens de compra e venda é o mesmo obtido pelo websocket no disparo.
# ---------------------------------------------------------------------------------------------------------------------------------------------------
# PRICE_STRATEGY=2:    O preço ou cotação da ordem de compra é o mesmo obtido pelo websocket no disparo.
#                      O preço ou cotação da ordem de venda é o preço de compra acrescido da porcentagem no momento do disparo
#                      somada com ADDITIONAL_RATE_FOR_ORDERS.
#                      Exemplo: Para ADDITIONAL_RATE_FOR_ORDERS=0.1, se a porcentagem entre as exchanges é de 0,16%, a compra é feita
#                               pelo preço do websocket e a venda pelo preço da compra mais 0,26% (0,16 + 0,1).
# ---------------------------------------------------------------------------------------------------------------------------------------------------
# QUANTITY_STRATEGY=1: Utilizar porcentagem entre exchanges (MINIMUM_RATE) para disparar a compra.
#                      O tamanho da ordem é o menor valor entre os dois resultados abaixo:
#                          1) menor valor em dólares entre "bid" de uma conta e "ask" da outra conta (obtidos pelo websocket no disparo);
#                          2) menor valor em dólares entre os saldos de compra e venda.
#                      Caso o resultado seja maior que MAXIMUM_BUDGET_RATE% do valor 2 acima, o tamanho da ordem será de
#                      MAXIMUM_BUDGET_RATE% do valor 2 acima.
# ---------------------------------------------------------------------------------------------------------------------------------------------------
# QUANTITY_STRATEGY=2: Utilizar porcentagem entre exchanges (MINIMUM_RATE) para disparar a compra.
#                      O tamanho da ordem é uma porcentagem (BALANCE_RATE_FOR_ORDERS) do menor valor em dólares entre os saldos de compra e venda.
#                      Caso o resultado da porcentagem acima for menor que MINIMUM_ORDER_IN_DOLLAR, o menor valor em dólares entre os
#                      saldos de compra e venda será utilizado (sem a aplicação da porcentagem).
#                      A quantidade de moedas na primeira camada não é considerada.
# ===================================================================================================================================================
```

### Descrição:
- **BIN_API_URL:** URL base da API da Binance.
- **BIN_WS_URL:** URL base do websocket da Binance.
- **BIN_API_KEY:** API key da Binance.
- **BIN_SECRET_KEY:** Secret key da Binance.
- **KUC_API_URL:** URL base da API da Kucoin.
- **KUC_API_KEY:** API key da Kucoin.
- **KUC_SECRET_KEY:** Secret key da Kucoin.
- **KUC_PASSPHRASE:** Passphrase da Kucoin.
- **STOP_ON_FIRST_ORDER:** Se `1`: Após a primeira ordem de compra e venda, bem sucedida ou não, o robô é desligado automaticamente. Usar `0` para desabilitar esta funcionalidade.
- **STOP_ON_FIRST_TRANSFER:** Se `1`: Após a primeira transferência de equalização, o robô é desligado automaticamente. Usar `0` para desabilitar esta funcionalidade.
- **MINIMUM_RATE:** Porcentagem mínima entre compra e venda das exchanges para disparar as ordens de compra e venda.
- **LOG_RATES_THRESHOLD:** Todas as porcentagens acima do valor definido aqui serão registradas no log.
- **MAXIMUM_BUDGET_RATE:** Porcentagem do valor mínimo para as ordens de compra e venda.
- **ACCOUNTS_EQUALIZATION_THRESHOLD:** Porcentagem máxima da diferença de valores entre as exchanges.
- **DOLLAR_BLOCKCHAIN:** Rede a ser usada para dólares (USDC, USDT, etc).
- **CRYPTO_BLOCKCHAIN:** Rede a ser usada para criptomoedas.
- **DOLLARCURRENCY:** Símbolo da moeda Dólar.
- **CRYPTOCURRENCY:** Símbolo da criptomoeda.
- **MINIMUM_ORDER_IN_DOLLAR:** Valor mínimo em Dólares para uma ordem.
- **WEBSOCKETS_INIT_IN_SECS:** Tempo em segundos para a inicialização dos websockets. Ao inicializar os websockets, o sistema esperará este tempo para então começar a computar os valores.
- **WEBSOCKET_LIFECYCLE:** Tempo máximo em horas em que o bot manterá uma conexão ininterrupta com os websockets. Caso as conexões com os websockets não tenham sido reiniciadas pelo período determnado neste parâmetro, os websockets serão desligados por 10 segundos, retornando em seguida.
- **EQUALIZATION_CYCLE:** Tempo em horas para o ciclo de verificação para equalizar as contas nas exchanges.
- **ADDITIONAL_RATE_FOR_ORDERS:** Porcentagem adicional para precificar as ordens. Este parâmetro só é aplicado quando PRICE_STRATEGY é igual a `2`.
- **BALANCE_RATE_FOR_ORDERS:** Porcentagem do menor saldo para ser usado como valor da ordem de compra. Este parâmetro só é aplicado quando QUANTITY_STRATEGY é igual a `2`.
- **SELL_BEFORE_BUYING:** Se `1`: A venda de criptomoedas sempre ocorrerá antes da compra. Se `0`: A compra de criptomoedas sempre ocorrerá antes da venda.
- **MIRROR_ORDERS:** Se `1`: Para cada ordem feita em uma exchange, uma ordem de valores idênticos é postada na outra. Se `0`: Uma ordem de compra é postada em uma exchange e uma ordem de venda na outra (ou vice-versa, dependendo do valor do parâmetro `SELL_BEFORE_BUYING`).
- **ORDERS_LIFETIME:** Tempo (em horas) de vida de uma ordem aberta. Os cancelamentos de ordens expiradas irão ocorrer apenas nos horários cheios determinados pelo parâmetro `CLEANUP_TIME`.
- **CLEANUP_TIME:** Horários (hora cheia) em que ocorrerá a checagem de ordens expiradas (`ORDERS_LIFETIME`). Os horários deverão ser separados por hífen. Ex: `1-7-13-19` (4 vezes ao dia).
- **PRICE_STRATEGY:** Definição da estratégia de preço. Valor `1` ou `2` (verificar descrição no arquivo `.env`).
- **QUANTITY_STRATEGY:** Definição da estratégia de quantidade. Valor `1` ou `2` (verificar descrição no arquivo `.env`).


## Instalação dos pacotes:

Para instalar os pacotes, execute o comando abaixo na raiz do aplicativo:
```
npm install
```

## Execução do bot:

Para inicializar o bot, execute o comando abaixo na raiz do aplicativo:
```
npm start
```

## Verificação de saldos e ordens pendentes:

O comando abaixo exibirá os saldos e ordens pendentes nas duas exchanges:
```
npm run saldo
```

## Parar a execução do bot:

Para parar a execução do bot a qualquer momento, tecle ```Ctrl+C```.

