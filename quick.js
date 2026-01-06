
const https = require('https');
const crypto = require('crypto');
const querystring = require('querystring');

// 定义 API 凭证
const api_config = {
  "api_key": 'dc3284bd-7da1-4b62-a6ad-be69d7974aaa',
  "secret_key": 'F021AF5B8EE5391CC1BF0B6CDF90A36D',
  "passphrase": 'Jkl456,,,...',
  "project_id": 'ed09a0bf98c4bdcf3ed9b2d43aef7e4d',
};

function preHash(timestamp, method, request_path, params) {
  // 根据字符串和参数创建预签名
  let query_string = '';
  if (method === 'GET' && params) {
    query_string = '?' + querystring.stringify(params);
  }
  if (method === 'POST' && params) {
    query_string = JSON.stringify(params);
  }
  console.log(`query_string ${query_string}`)
  return timestamp + method + request_path + query_string;
}

function sign(message, secret_key) {
  // 使用 HMAC-SHA256 对预签名字符串进行签名
  const hmac = crypto.createHmac('sha256', secret_key);
  hmac.update(message);
  return hmac.digest('base64');
}

function createSignature(method, request_path, params) {
  // 获取 ISO 8601 格式时间戳
  const timestamp = new Date().toISOString().slice(0, -5) + 'Z';
  // 生成签名
  const message = preHash(timestamp, method, request_path, params);
  const signature = sign(message, api_config['secret_key']);
  return { signature, timestamp };
}

function sendGetRequest(request_path, params) {
  // 生成签名
  const { signature, timestamp } = createSignature("GET", request_path, params);

  // 生成请求头
  const headers = {
    'OK-ACCESS-KEY': api_config['api_key'],
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': api_config['passphrase'],
    // "OK-ACCESS-PROJECT": api_config['project_id'],
  };

  const options = {
    hostname: 'web3.okx.com',
    path: request_path + (params ? `?${querystring.stringify(params)}` : ''),
    method: 'GET',
    headers: headers
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log(data);
    });
  });

  req.end();
}


function sendPostRequest(request_path, params) {
  // 生成签名
  const { signature, timestamp } = createSignature("POST", request_path, params);

  // 生成请求头
  const headers = {
    'OK-ACCESS-KEY': api_config['api_key'],
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': api_config['passphrase'],
    // "OK-ACCESS-PROJECT": api_config['project_id'],
    'Content-Type': 'application/json'
  };

  const options = {
    hostname: 'web3.okx.com',
    path: request_path,
    method: 'POST',
    headers: headers
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log(data);
    });
  });

  if (params) {
    req.write(JSON.stringify(params));
  }

  req.end();
}


// // GET 请求示例
// const getRequestPath = '/api/v6/dex/aggregator/quote';
// const getParams = {
//   'chainIndex': 42161,
//   'amount': 1000000000000,
//   'toTokenAddress': '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
//   'fromTokenAddress': '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
// };
// // ?chainIndex=42161&amount=1000000000000&toTokenAddress=0xff970a61a04b1ca14834a43f5de4533ebddb5cc8&fromTokenAddress=0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
// sendGetRequest(getRequestPath, getParams);

// // POST 请求示例
// const postRequestPath = '/api/v5/mktplace/nft/ordinals/listings';
// // {"slug":"sats"}
// const postParams = {
//   'slug': 'sats'
// };
// sendPostRequest(postRequestPath, postParams);


// sendGetRequest('/api/v6/dex/aggregator/supported/chain', {chainIndex: 1})
// sendGetRequest('/api/v6/dex/aggregator/all-tokens', {chainIndex: 1})

// ?chainIndex=1&amount=10000000000000&toTokenAddress=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48&fromTokenAddress=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee&slippage=0.05&userWalletAddress=0x6f9ffea7370310cd0f890dfde5e0e061059dcfb8'
// sendGetRequest('/api/v5/dex/aggregator/swap', {
//   chainIndex: 1,
//   amount: 10000000000000,
//   toTokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // usdc on base
//   fromTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // Native ETH
//   slippage: 0.05,
//   userWalletAddress: '0x6f9ffea7370310cd0f890dfde5e0e061059dcfb8'
// })
sendGetRequest('/api/v5/dex/aggregator/swap', {
  chainIndex: 1,
  amount: 10000000000000,
  toTokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // usdc on base
  fromTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // Native ETH
  slippagePercent: 0.05,
  userWalletAddress: '0x6f9ffea7370310cd0f890dfde5e0e061059dcfb8'
})

sendGetRequest('/api/v6/dex/aggregator/swap', {
  chainIndex: 1,
  amount: 10000000000000,
  toTokenAddress: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // USDT 
  fromTokenAddress: '0x55d398326f99059ff775485246999027b3197955', // WBNB
  slippagePercent: 0.05,
  userWalletAddress: '0x6f9ffea7370310cd0f890dfde5e0e061059dcfb8'
})