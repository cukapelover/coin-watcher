from flask import Flask, render_template, request
from flask_sock import Sock
import requests
import json
import threading
import websocket

app = Flask(__name__)
sock = Sock(app)

TOP_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
    "DOGEUSDT", "ADAUSDT", "TRXUSDT", "AVAXUSDT", "LINKUSDT",
    "DOTUSDT", "MATICUSDT", "LTCUSDT", "BCHUSDT", "UNIUSDT"
]


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/symbols')
def get_symbols():
    return TOP_SYMBOLS


@app.route('/api/history')
def get_history():
    ticker = request.args.get('ticker', 'BTCUSDT')
    tf = request.args.get('timeframe', '15')
    tf_map = {'1d': 'D', '1w': 'W', '1M': 'M'}
    bybit_tf = tf_map.get(tf, tf)

    # УВЕЛИЧИЛИ ЛИМИТ ДО 1000
    url = f"https://api.bybit.com/v5/market/kline?category=spot&symbol={ticker}&interval={bybit_tf}&limit=1000"
    try:
        response = requests.get(url, timeout=10)
        data = response.json()
        if data.get('retCode') != 0: return {"error": data.get('retMsg')}, 500

        candles = []
        for row in data['result']['list']:
            candles.append({
                'time': int(row[0]) // 1000, 'open': float(row[1]), 'high': float(row[2]),
                'low': float(row[3]), 'close': float(row[4]), 'volume': float(row[5])
            })
        candles.reverse()
        return candles
    except Exception as e:
        return {"error": str(e)}, 500


# ПРАВИЛЬНЫЙ ПУТЬ: /api/v1/liquidations (из SDK MarginPad)
@app.route('/api/liquidations')
def get_liquidations():
    ticker = request.args.get('ticker', 'BTCUSDT')
    symbol = ticker.replace('USDT', '')

    url = f"https://marginpad.io/api/v1/liquidations?symbol={symbol}"

    try:
        response = requests.get(url, timeout=10)
        data = response.json()

        if isinstance(data, list):
            return data
        elif isinstance(data, dict) and 'data' in data:
            return data['data']
        else:
            return {"error": "Неожиданный формат"}, 500
    except Exception as e:
        return {"error": str(e)}, 500


@sock.route('/ws')
def ws_stream(ws):
    try:
        config = json.loads(ws.receive())
        ticker, tf = config.get('ticker', 'BTCUSDT'), config.get('timeframe', '15')
        bybit_tf = {'1d': 'D', '1w': 'W', '1M': 'M'}.get(tf, tf)
    except:
        return

    def on_message(ws_bybit, message):
        try:
            data = json.loads(message)
            if "data" in data and len(data["data"]) > 0:
                kline = data["data"][0]
                candle = {
                    'time': int(kline['start']) // 1000, 'open': float(kline['open']),
                    'high': float(kline['high']), 'low': float(kline['low']),
                    'close': float(kline['close']), 'volume': float(kline['volume'])
                }
                ws.send(json.dumps({"type": "update", "data": candle}))
        except:
            pass

    def on_open(ws_bybit):
        ws_bybit.send(json.dumps({"op": "subscribe", "args": [f"kline.{bybit_tf}.{ticker}"]}))

    ws_bybit = websocket.WebSocketApp("wss://stream.bybit.com/v5/public/spot", on_message=on_message, on_open=on_open)
    wst = threading.Thread(target=ws_bybit.run_forever);
    wst.daemon = True;
    wst.start()

    try:
        while True:
            if ws.receive() is None: break
    except:
        pass


@sock.route('/ws-orderbook')
def ws_orderbook(ws):
    try:
        config = json.loads(ws.receive())
        ticker = config.get('ticker', 'BTCUSDT')
    except:
        return

    def on_message(ws_bybit, message):
        try:
            data = json.loads(message)
            if "data" in data:
                ws.send(json.dumps({"type": "orderbook", "data": data["data"]}))
        except:
            pass

    def on_open(ws_bybit):
        ws_bybit.send(json.dumps({"op": "subscribe", "args": [f"orderbook.50.{ticker}"]}))

    ws_bybit = websocket.WebSocketApp("wss://stream.bybit.com/v5/public/spot", on_message=on_message, on_open=on_open)
    wst = threading.Thread(target=ws_bybit.run_forever);
    wst.daemon = True;
    wst.start()

    try:
        while True:
            if ws.receive() is None: break
    except:
        pass


if __name__ == '__main__':
    app.run(debug=False, port=5000)