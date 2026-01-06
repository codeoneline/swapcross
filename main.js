const { Web3 } = require('web3');
const axios = require('axios');
const dotenv = require('dotenv');
const CryptoJS = require('crypto-js');

// Load environment variables
dotenv.config();

// Connect to Base network
const web3 = new Web3(process.env.EVM_RPC_URL || 'https://mainnet.base.org');

// Your wallet information - REPLACE WITH YOUR OWN VALUES
const WALLET_ADDRESS = process.env.EVM_WALLET_ADDRESS || '';
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || '';

// Token addresses for swap on Base Chain
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // Native ETH

// Chain ID for Base Chain
const chainIndex = '8453';
// Chain ID for Ethereum Chain
const chainIndexEth = '1';

// API URL
const baseUrl = 'https://web3.okx.com/api/v6/';

/**
 * Generate API authentication headers
 */
function getHeaders(timestamp, method, requestPath, queryString = "", body = "") {
    const apiKey = process.env.OKX_API_KEY;
    const secretKey = process.env.OKX_SECRET_KEY;
    const apiPassphrase = process.env.OKX_API_PASSPHRASE;
    const projectId = process.env.OKX_PROJECT_ID;

    if (!apiKey || !secretKey || !apiPassphrase || !projectId) {
        throw new Error("Missing required environment variables for API authentication");
    }

    const stringToSign = timestamp + method + requestPath + (queryString || body);

    const headers = {
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": CryptoJS.enc.Base64.stringify(
            CryptoJS.HmacSHA256(stringToSign, secretKey)
        ),
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": apiPassphrase,
        "OK-ACCESS-PROJECT": projectId,
    };
    console.log(`path=${requestPath},query=${queryString},body=${body}, headers = ${JSON.stringify(headers, null, 2)}`)
    return headers
}

/**
 * Get transaction gas limit from Onchain gateway API
 * @param fromAddress - Sender address
 * @param toAddress - Target contract address
 * @param txAmount - Transaction amount (0 for approvals)
 * @param inputData - Transaction calldata
 * @returns Estimated gas limit
 */
async function getGasLimit(
  fromAddress,
  toAddress,
  txAmount = '0',
  inputData = ''
) {
  const path = 'dex/pre-transaction/gas-limit';
  const url = `${baseUrl}${path}`;
  const body = { chainIndex: chainIndex, fromAddress, toAddress, txAmount, extJson: { inputData } };
  
  const bodyString = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const headers = getHeaders(timestamp, 'POST', `/api/v6/${path}`, "", bodyString);

  const response = await axios.post(url, body, { headers });
  if (response.data.code === '0') {
    return response.data.data[0].gasLimit;
  }
  throw new Error(`API Error: ${response.data.msg || 'Unknown error'}`);
}

/**
 * Get swap data from OKX API
 */
async function getSwapData(
    fromTokenAddress,
    toTokenAddress,
    amount,
    slippagePercent = '0.5'
) {
    const path = 'dex/aggregator/swap';
    const url = `${baseUrl}${path}`;
    const params = { chainIndex: chainIndex, fromTokenAddress, toTokenAddress, amount, slippagePercent, userWalletAddress: WALLET_ADDRESS };
    
    const queryString = "?" + new URLSearchParams(params).toString();
    const timestamp = new Date().toISOString();
    const headers = getHeaders(timestamp, 'GET', `/api/v6/${path}`, queryString);


    const response = await axios.get(`${url}${queryString}`, { headers });
    const responseData = response.data;
    if (responseData.code === '0') {
        return responseData.data[0];
    }
    throw new Error(`Swap API Error: ${responseData.msg || 'Unknown error'}`);
}

/**
 * Get supported chain from OKX API
 */
async function getSupportedChain() {
    const path = 'dex/aggregator/supported/chain';
    const url = `${baseUrl}${path}`;
    const params = { chainIndex: chainIndex };
    
    const queryString = "?" + new URLSearchParams(params).toString();
    const timestamp = new Date().toISOString();
    const headers = getHeaders(timestamp, 'GET', `/api/v6/${path}`, queryString);


    const response = await axios.get(`${url}${queryString}`, { headers });
    const responseData = response.data;
    if (responseData.code === '0') {
        return responseData.data[0];
    }
    throw new Error(`Swap API Error: ${responseData.msg || 'Unknown error'}`);
}

/**
 * Build and sign transaction using gas limit
 */
async function buildAndSignTransaction(swapData, gasLimit) {
    const gasPrice = await web3.eth.getGasPrice();
    const nonce = await web3.eth.getTransactionCount(WALLET_ADDRESS, 'pending');
    
    const transaction = {
        from: swapData.tx.from,
        to: swapData.tx.to,
        data: swapData.tx.data,
        value: swapData.tx.value || '0x0',
        gas: gasLimit,
        gasPrice: gasPrice.toString(),
        nonce: Number(nonce),
        chainIndex: parseInt(chainIndex)
    };

    return await web3.eth.accounts.signTransaction(transaction, PRIVATE_KEY);
}

/**
 * Broadcast transaction using Onchain Gateway API
 */
async function broadcastTransaction(signedTx, chainIndex, walletAddress) {
    const path = 'dex/pre-transaction/broadcast-transaction';
    const url = `${baseUrl}${path}`;
    const rawTxHex = typeof signedTx.rawTransaction === 'string' ? signedTx.rawTransaction : web3.utils.bytesToHex(signedTx.rawTransaction);
    const body = { signedTx: rawTxHex, chainIndex: chainIndex, address: walletAddress };
    
    const bodyString = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    const headers = getHeaders(timestamp, 'POST', `/api/v6/${path}`, "", bodyString);

    const response = await axios.post(url, body, { headers });
    if (response.data.code === '0') {
        return response.data.data[0].orderId;
    }
    throw new Error(`Broadcast API Error: ${response.data.msg || 'Unknown error'}`);
}

function sleep(ms) {
	return new Promise(function (resolve, reject) {
		setTimeout(function () {
			resolve();
		}, ms);
	})
};

async function main() {
    try {
        console.log('EVM Gas Limit and Broadcast');
        console.log('================================');

        // Validate environment variables
        // if (!WALLET_ADDRESS || !PRIVATE_KEY) {
        //     throw new Error('Missing wallet address or private key in environment variables');
        // }

        console.log(`Wallet Address: ${WALLET_ADDRESS}`);
        console.log(`Chain ID: ${chainIndex}`);
        console.log(`RPC URL: ${process.env.EVM_RPC_URL || 'https://mainnet.base.org'}`);

        let chainInfo =  {
            "chainId": 8453,
            "chainIndex": 8453,
            "chainName": "Base",
            "dexTokenApproveAddress": "0x57df6092665eb6058DE53939612413ff4B09114E"
          }
        do {
            try {
                if (!chainInfo) {
                    chainInfo = await getSupportedChain()
                    console.log(`getSupportedChain ${JSON.stringify(chainInfo, null, 2)}`)
                }
            } catch (error) {
                await sleep(10000)
            }
        } while (true);

        // Example parameters
        // const fromToken = ETH_ADDRESS;
        // const toToken = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base
        // const amount = '100000000000000'; // 0.0001 ETH in wei
        // const slippagePercent = '0.5'; // 0.5%

        // // Step 1: Get swap data
        // const swapData = await getSwapData(fromToken, toToken, amount, slippagePercent);
        // console.log('Swap data obtained');

        // // Step 2: Get gas limit
        // const gasLimit = await getGasLimit(
        //     swapData.tx.from,
        //     swapData.tx.to,
        //     swapData.tx.value || '0',
        //     swapData.tx.data
        // );
        // console.log('Gas limit obtained', gasLimit);

        // Step 3: Build and sign transaction
        // const signedTx = await buildAndSignTransaction(swapData, gasLimit);
        // console.log('Transaction built and signed');

        // Step 4: Broadcast transaction
        try {
            // const orderId = await broadcastTransaction(signedTx, chainIndex, swapData.tx.from);
            // console.log(`Transaction broadcast successful. Order ID: ${orderId}`);
        } catch (broadcastError) {
            if (broadcastError.message.includes('API registration and whitelist required')) {
                console.log('Broadcast failed - API registration and whitelist required');
                console.log('Gas limit obtained successfully:', gasLimit);
            } else {
                throw broadcastError;
            }
        }
        
    } catch (error) {
        console.error('Main execution failed:', error.message);
        console.error('Main execution failed:', error);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = {
    getSwapData,
    getGasLimit,
    broadcastTransaction
};