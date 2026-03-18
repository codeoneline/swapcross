const { Web3 } = require('web3');
const axios = require('axios');
const dotenv = require('dotenv');
const CryptoJS = require('crypto-js');

const { Common, Hardfork } = require('@ethereumjs/common');
const { Transaction, FeeMarketEIP1559Transaction } = require('@ethereumjs/tx');

dotenv.config();

// // 配置代理
// const { HttpsProxyAgent } = require('https-proxy-agent');
// const proxyUrl = 'http://127.0.0.1:7897'; // 你的代理地址
// const agent = new HttpsProxyAgent(proxyUrl);
// const proxiedFetch = (url, options = {}) => {
//     return fetch(url, { ...options, agent });
//   };
// const provider = new Web3.providers.HttpProvider(process.env.EVM_RPC_URL, {
//     timeout: 10000,         // 10s timeout
//     keepAlive: true,
//     withCredentials: false,
//     headers: [{ name: 'Connection', value: 'keep-alive' }],
//     providerOptions: {
//         fetchOptions: {
//           agent,                    // 部分版本走这里
//         },
//       },
//   })
// provider.request = async function(payload) {
//     const response = await proxiedFetch(this.clientUrl, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify(payload),
//     });
//     return response.json();
// };
const provider = new Web3.providers.HttpProvider(process.env.EVM_RPC_URL, {
    timeout: 10000,         // 10s timeout
    keepAlive: true,
    withCredentials: false,
    headers: [{ name: 'Connection', value: 'keep-alive' }],
  })
const web3 = new Web3(provider);

// Your wallet information - REPLACE WITH YOUR OWN VALUES
const WALLET_ADDRESS = process.env.EVM_WALLET_ADDRESS || '';
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || '';

// Token addresses for swap on Base Chain
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // Native ETH

// Chain ID for Base Chain
// const chainIndex = '8453'; // Base
const chainIndex = '1'; // Base

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

    const signContent = method === 'GET' ? queryString : body;
    const stringToSign = timestamp + method + requestPath + signContent;

    return {
        "Content-Type": "application/json",
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": CryptoJS.enc.Base64.stringify(
            CryptoJS.HmacSHA256(stringToSign, secretKey)
        ),
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": apiPassphrase,
        "OK-ACCESS-PROJECT": projectId,
    };
}

const getTimeStamp = () => {
  const t1 = new Date().toISOString()
  console.log(t1)
  const t2 = t1.slice(0, -5) + 'Z'
  console.log(t2)
  return t2;
}

/**
 * Get transaction gas limit from Onchain gateway API
 * @param {string} fromAddress - Sender address
 * @param {string} toAddress - Target contract address
 * @param {string} txAmount - Transaction amount (0 for approvals)
 * @param {string} inputData - Transaction calldata
 * @returns {Promise<string>} Estimated gas limit
 */
async function getGasLimit(
    fromAddress,
    toAddress,
    txAmount = '0',
    inputData = ''
) {
    try {
        console.log('Getting gas limit from Onchain Gateway API...');
        
        const path = 'dex/pre-transaction/gas-limit';
        const url = `${baseUrl}${path}`;

        const body = {
            chainIndex: chainIndex,
            fromAddress: fromAddress,
            toAddress: toAddress,
            txAmount: txAmount,
            extJson: {
                inputData: inputData
            }
        };

        // Prepare authentication with body included in signature
        const bodyString = JSON.stringify(body);
        const timestamp = getTimeStamp() ;
        const requestPath = `/api/v6/${path}`;
        const headers = getHeaders(timestamp, 'POST', requestPath, "", bodyString);

        const response = await axios.post(url, body, { headers });

        console.log('Gas Limit API Response:');
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.code === '0') {
            const gasLimit = response.data.data[0].gasLimit;
            console.log(`Gas Limit obtained: ${gasLimit}`);
            return gasLimit;
        } else {
            throw new Error(`API Error: ${response.data.msg || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Failed to get gas limit:', error.message);
        throw error;
    }
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
    try {
        console.log('Getting swap data from OKX API...');
        
        const path = 'dex/aggregator/swap';
        const url = `${baseUrl}${path}`;

        const params = {
            chainIndex: chainIndex,
            fromTokenAddress: fromTokenAddress,
            toTokenAddress: toTokenAddress,
            amount: amount,
            slippagePercent: slippagePercent,
            userWalletAddress: WALLET_ADDRESS
        };

        console.log('Swap API Request Parameters:');
        console.log(JSON.stringify(params, null, 2));

        // Prepare authentication with query string
        const queryString = "?" + new URLSearchParams(params).toString();
        const timestamp = getTimeStamp() ;
        const requestPath = `/api/v6/${path}`;
        const headers = getHeaders(timestamp, 'GET', requestPath, queryString);

        const response = await axios.get(`${url}${queryString}`, { headers });

        console.log('Swap API Response:');
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.code === '0') {
            return response.data.data[0];
        } else {
            throw new Error(`Swap API Error: ${response.data.msg || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Failed to get swap data:', error.message);
        throw error;
    }
}

/**
 * Simulate transaction using Onchain Gateway API
 */
async function simulateTransaction(swapData) {
    try {
        console.log('Simulating transaction with Onchain Gateway API...');
        
        const path = 'dex/pre-transaction/simulate';
        const url = `${baseUrl}${path}`;

        const body = {
            chainIndex: chainIndex,
            fromAddress: swapData.tx.from,
            toAddress: swapData.tx.to,
            txAmount: swapData.tx.value || '0',
            extJson: {
                inputData: swapData.tx.data
            }
        };

        // Prepare authentication with body included in signature
        const bodyString = JSON.stringify(body);
        const timestamp = getTimeStamp() ;
        const requestPath = `/api/v6/${path}`;
        const headers = getHeaders(timestamp, 'POST', requestPath, "", bodyString);

        const response = await axios.post(url, body, { headers });

        console.log('Simulation API Response:');
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.code === '0') {
            const simulationResult = response.data.data[0];
            // Check if simulation was successful (no failReason or empty failReason)
            if (!simulationResult.failReason || simulationResult.failReason === '') {
                console.log(`Transaction simulation successful. Gas used: ${simulationResult.gasUsed}`);
                return simulationResult;
            } else {
                throw new Error(`Simulation failed: ${simulationResult.failReason}`);
            }
        } else {
            throw new Error(`Simulation API Error: ${response.data.msg || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Transaction simulation failed:', error.message);
        throw error;
    }
}

/**
 * Broadcast transaction using Onchain Gateway API with RPC fallback
 */
async function broadcastTransaction(signedTx, chainIndex, walletAddress) {
    try {
        console.log('Broadcasting transaction via Onchain Gateway API...');
        
        const path = 'dex/pre-transaction/broadcast-transaction';
        const url = `${baseUrl}${path}`;

        // Convert rawTransaction to hex string
        const rawTxHex = typeof signedTx.rawTransaction === 'string' 
            ? signedTx.rawTransaction 
            : web3.utils.bytesToHex(signedTx.rawTransaction);

        const body = {
            signedTx: rawTxHex,
            chainIndex: chainIndex,
            address: walletAddress
            // See [MEV Section](#10-mev-protection) for MEV protection settings
        };

        console.log('Broadcast API Request Body:');
        console.log(JSON.stringify(body, null, 2));

        // Prepare authentication with body included in signature
        const bodyString = JSON.stringify(body);
        const timestamp = getTimeStamp() ;
        const requestPath = `/api/v6/${path}`;
        const headers = getHeaders(timestamp, 'POST', requestPath, "", bodyString);

        const response = await axios.post(url, body, { headers });

        console.log('Broadcast API Response:');
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.code === '0') {
            const orderId = response.data.data[0].orderId;
            console.log(`Transaction broadcast successful. Order ID: ${orderId}`);
            return orderId;
        } else {
            throw new Error(`Broadcast API Error: ${response.data.msg || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('API broadcast failed, trying RPC fallback:', error.message);
        
        // Fallback to RPC broadcast
        // try {
        //     console.log('Broadcasting via RPC fallback...');
        //     const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        //     console.log(`RPC broadcast successful. Transaction hash: ${receipt.transactionHash}`);
        //     return receipt.transactionHash.toString();
        // } catch (rpcError) {
        //     console.error('RPC broadcast also failed:', rpcError.message);
        //     throw new Error(`Both API and RPC broadcast failed. API Error: ${error.message}, RPC Error: ${rpcError.message}`);
        // }

    }
    return null
}

// 通过RPC直接广播交易
async function broadcastViaRPC(signedTx) {
    try {
        console.log('📡 通过RPC广播交易...');
        
        const txHash = await web3.eth.sendSignedTransaction(signedTx);
        
        console.log('✅ RPC广播成功:', txHash);
        return txHash;
    } catch (error) {
        console.error('❌ RPC广播失败:', error.message);
        
        // 解析错误信息
        if (error.message.includes('nonce too low')) {
            console.log('⚠️ 原因: Nonce太低，需要重新获取nonce');
        } else if (error.message.includes('already known')) {
            console.log('⚠️ 原因: 交易已存在于内存池中');
        } else if (error.message.includes('insufficient funds')) {
            console.log('⚠️ 原因: 余额不足');
        } else if (error.message.includes('replacement transaction underpriced')) {
            console.log('⚠️ 原因: 替换交易的gas价格太低');
        }
        
        return null;
    }
}

async function checkRpcSupport() {
    try {
        // 获取最新区块
        const block = await web3.eth.getBlock('latest');
        
        // 如果有baseFeePerGas字段，说明支持EIP-1559
        if (block.baseFeePerGas) {
            console.log('RPC supports EIP-1559');
            console.log('Base fee:', block.baseFeePerGas);
            return true;
        } else {
            console.log('RPC does NOT support EIP-1559');
            return false;
        }
    } catch (error) {
        console.error('Failed to check RPC support:', error);
        return false;
    }
}

async function signTransactionOffline(tx, privateKey, chainId) {
    const isSupport = await checkRpcSupport()
    if (!isSupport) {
        throw new Error(`unsupport txType 2`)
    }
    // 创建链配置
    const common = Common.custom({ chainId: chainId }, 
        { 
            hardfork: 'london',  // 必须指定伦敦硬分叉才能支持EIP-1559
            baseChain: 'mainnet' // 指定为基础链
        });
    // 构建交易对象
    const txParams = {
        nonce: '0x' + Number(tx.nonce).toString(16),
        gasLimit: '0x' + Number(tx.gas).toString(16),
        to: tx.to,
        value: '0x' + BigInt(tx.value).toString(16),
        data: tx.data,
        chainId: chainId,
        // type: 2,  // EIP-1559,
        maxFeePerGas: '0x' + BigInt(tx.maxFeePerGas).toString(16),
        maxPriorityFeePerGas: '0x' + BigInt(tx.maxPriorityFeePerGas).toString(16)
    };

    console.log('Transaction params for signing:', JSON.stringify(txParams, null, 2));
    
    // 创建交易对象
    const txObj = FeeMarketEIP1559Transaction.fromTxData(txParams, { common });
    
    // 签名
    const privateKeyBuffer = Buffer.from(privateKey.replace('0x', ''), 'hex');
    const signedTx = txObj.sign(privateKeyBuffer);
    
    // 返回序列化的交易
    const rawTransaction = '0x' + signedTx.serialize().toString('hex');
    
    return {
        messageHash: '0x' + signedTx.hash().toString('hex'),
        rawTransaction: rawTransaction,
        transactionHash: '0x' + signedTx.hash().toString('hex')
    };
}

/**
 * Execute swap with full transaction flow
 */
async function executeSwap(
    fromTokenAddress,
    toTokenAddress,
    amount,
    slippagePercent = '0.5'
) {
    try {
        // 0. 检查当前授权额度
        const ERC20_ABI = [
            {
                "constant": true,
                "inputs": [{"name": "_owner", "type": "address"}],
                "name": "balanceOf",
                "outputs": [{"name": "balance", "type": "uint256"}],
                "type": "function"
            },
            {
                "constant": true,
                "inputs": [
                    {"name": "_owner", "type": "address"},
                    {"name": "_spender", "type": "address"}
                ],
                "name": "allowance",
                "outputs": [{"name": "", "type": "uint256"}],
                "type": "function"
            },
            {
                "constant": false,
                "inputs": [
                    {"name": "_spender", "type": "address"},
                    {"name": "_value", "type": "uint256"}
                ],
                "name": "approve",
                "outputs": [{"name": "", "type": "bool"}],
                "type": "function"
            }
        ];
        const tokenContract = new web3.eth.Contract(ERC20_ABI, fromTokenAddress);
        const spenderAddress = '0x40aA958dd87FC8305b97f2BA922CDdCa374bcD7f'; // 
        const dexRouter = '0x5E1f62Dac767b0491e3CE72469C217365D5B48cC'; //
            
        const allowance = await tokenContract.methods.allowance(process.env.EVM_WALLET_ADDRESS, spenderAddress ).call()
        const allowance2 = await tokenContract.methods.allowance(process.env.EVM_WALLET_ADDRESS, dexRouter ).call()
        
        console.log(`📊 当前授权${spenderAddress}额度: ${allowance} (需要: ${amount})`);
        console.log(`📊 当前授权${dexRouter}额度: ${allowance2} (需要: ${amount})`);
        

        console.log('Starting swap execution...');
        // Step 1: Get swap data
        const swapData = await getSwapData(fromTokenAddress, toTokenAddress, amount, slippagePercent);
        console.log('Swap data obtained');

        // let needAllowance = swapData.tx.to.toLowerCase() === dexRouter.toLowerCase() ? allowance2 : allowance
        let needAllowance = allowance
        // 如果授权额度足够，直接返回
        if (BigInt(needAllowance) >= BigInt(amount)) {
            console.log('✅ 授权额度足够');
        } else {
            console.warn('✅ 授权额度不足');
            return true;
        }

        // Step 2: Simulate transaction
        // const simulationResult = await simulateTransaction(swapData);
        // console.log('Transaction simulation completed');
        // console.log('Simulation result', simulationResult.intention);

        // Step 3: Get gas limit
        // const gasLimit = await getGasLimit(
        //     swapData.tx.from,
        //     swapData.tx.to,
        //     swapData.tx.value,
        //     swapData.tx.data
        // );
          
          // Add 20% buffer
        //   const gasLimit = (BigInt(gasLimit) * BigInt(12) / BigInt(10)).toString();



        // Step 4: Get nonce
        const nonce = await web3.eth.getTransactionCount(WALLET_ADDRESS);
        console.log(`Nonce: ${nonce}`);

        // // Step 5: Get current gas price
        // const gasPrice = await web3.eth.getGasPrice();
        // console.log(`Current gas price: ${web3.utils.fromWei(gasPrice, 'gwei')} gwei`);
        // // Step 6: Build transaction
        // const transaction = {
        //     from: swapData.tx.from,
        //     to: swapData.tx.to,
        //     data: swapData.tx.data,
        //     value: swapData.tx.value || '0x0',
        //     gas: gasLimit,
        //     gasPrice: gasPrice.toString(),
        //     nonce: Number(nonce),
        //     // chainIndex: parseInt(chainIndex)
        //     chainId: parseInt(chainIndex)
        // };
        
        // Step 5: Get current gas price
        // const feeData = await web3.eth.calculateFeeData();
        // console.log(`Max Fee Per Gas: ${web3.utils.fromWei(feeData.maxFeePerGas, 'gwei')} gwei`);
        // console.log(`Max Priority Fee: ${web3.utils.fromWei(feeData.maxPriorityFeePerGas, 'gwei')} gwei`);
        // feeData.maxPriorityFeePerGas = 10000000
        // Step 6: Build transaction
        const transaction = {
            from: swapData.tx.from,
            to: swapData.tx.to,
            data: swapData.tx.data,
            value: swapData.tx.value,
            gas: swapData.tx.gas,
            // gasPrice: swapData.tx.gasPrice,
            maxFeePerGas: (BigInt(swapData.tx.gasPrice) * 1n).toString(), //feeData.maxFeePerGas.toString(),
            maxPriorityFeePerGas: (BigInt(swapData.tx.maxPriorityFeePerGas) * 1n).toString(),//feeData.maxPriorityFeePerGas.toString(),
            nonce: Number(nonce),
            // chainIndex: parseInt(chainIndex)
            chainId: parseInt(chainIndex),
            type: 2  // EIP-1559 交易类型
        };

        console.log('Transaction object:');
        console.log(JSON.stringify(transaction, null, 2));

        // Step 7: Sign transaction
        console.log('Signing transaction...');
        // const signedTx = await web3.eth.accounts.signTransaction(transaction, PRIVATE_KEY);
        const signedTx = await signTransactionOffline(transaction, PRIVATE_KEY, parseInt(chainIndex));
        console.log('Transaction signed');

        // // Step 8: Broadcast transaction
        // // const txHash = await broadcastTransaction(signedTx, chainIndex, WALLET_ADDRESS);
        // if (txHash) {

        //     console.log(`Transaction broadcast successful. Hash: ${txHash}`);

        //     // // Step 9: Track transaction
        //     console.log('Tracking transaction status...');
        //     const trackingResult = await trackTransaction(txHash);
        //     console.log('Transaction tracking completed');
        //     console.log('Tracking result', trackingResult);
        // }
        let txHash = await broadcastViaRPC(signedTx.rawTransaction);
        console.log(`txHash = ${txHash}`)

        return txHash;
    } catch (error) {
        console.error('Swap execution failed:', error.message);
        throw error;
    }
}

/**
 * Execute swap with simulation and detailed logging
 */
async function executeSwapWithSimulation(
    fromTokenAddress,
    toTokenAddress,
    amount,
    slippagePercent = '0.5'
) {
    try {
        console.log('Starting swap execution with simulation...');
        
        const txHash = await executeSwap(fromTokenAddress, toTokenAddress, amount, slippagePercent);
        
        console.log('Swap execution completed successfully!');
        console.log(`Transaction Hash: ${txHash}`);
        
        return { success: true, txHash };
    } catch (error) {
        console.error('Swap execution failed:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Tracking transaction confirmation status using the Onchain gateway API
 * @param {string} orderId - Order ID from broadcast response
 * @param {number} intervalMs - Polling interval in milliseconds
 * @param {number} timeoutMs - Maximum time to wait
 * @returns {Promise<any>} Final transaction confirmation status
 */
async function trackTransaction(
    orderId,
    intervalMs = 5000,
    timeoutMs = 300000
) {
    console.log(`Tracking transaction with Order ID: ${orderId}`);

    const startTime = Date.now();
    let lastStatus = '';

    while (Date.now() - startTime < timeoutMs) {
        try {
            const path = 'dex/post-transaction/orders';
            const url = `https://web3.okx.com/api/v6/${path}`;

            const params = {
                orderId: orderId,
                chainIndex: chainIndex,
                address: WALLET_ADDRESS,
                limit: '1'
            };

            const timestamp = getTimeStamp() ;
            const requestPath = `/api/v6/${path}`;
            const queryString = "?" + new URLSearchParams(params).toString();
            const headers = getHeaders(timestamp, 'GET', requestPath, queryString);

            const response = await axios.get(url, { params, headers });

            if (response.data.code === '0' && response.data.data && response.data.data.length > 0) {
                if (response.data.data[0].orders && response.data.data[0].orders.length > 0) {
                    const txData = response.data.data[0].orders[0];
                    const status = txData.txStatus;

                    if (status !== lastStatus) {
                        lastStatus = status;

                        if (status === '1') {
                            console.log(`Transaction pending: ${txData.txHash || 'Hash not available yet'}`);
                        } else if (status === '2') {
                            console.log(`Transaction successful: https://web3.okx.com/explorer/base/tx/${txData.txHash}`);
                            return txData;
                        } else if (status === '3') {
                            const failReason = txData.failReason || 'Unknown reason';
                            const errorMessage = `Transaction failed: ${failReason}`;

                            console.error(errorMessage);

                            const errorInfo = handleTransactionError(txData);
                            console.log(`Error type: ${errorInfo.error}`);
                            console.log(`Suggested action: ${errorInfo.action}`);

                            throw new Error(errorMessage);
                        }
                    }
                } else {
                    console.log(`No orders found for Order ID: ${orderId}`);
                }
            }
        } catch (error) {
            console.warn('Error checking transaction status:', error.message);
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error('Transaction tracking timed out');
}

/**
 * Comprehensive error handling with failReason
 * @param {any} txData - Transaction data from post-transaction/orders
 * @returns {Object} Structured error information
 */
function handleTransactionError(txData) {
    const failReason = txData.failReason || 'Unknown reason';

    console.error(`Transaction failed with reason: ${failReason}`);

    return {
        error: 'TRANSACTION_FAILED',
        message: failReason,
        action: 'Try again or contact support'
    };
}

// ======== Main Execution ========

async function simulateOnly(
    fromTokenAddress,
    toTokenAddress,
    amount,
    slippagePercent = '0.5'
) {
    try {
        console.log('Starting simulation-only mode...');
        console.log(`Simulation Details:`);
        console.log(`   From Token: ${fromTokenAddress}`);
        console.log(`   To Token: ${toTokenAddress}`);
        console.log(`   Amount: ${amount}`);
        console.log(`   SlippagePercent: ${slippagePercent}%`);

        // Step 1: Get swap data
        const swapData = await getSwapData(fromTokenAddress, toTokenAddress, amount, slippagePercent);
        console.log('Swap data obtained');

        // Step 2: Simulate transaction
        const simulationResult = await simulateTransaction(swapData);
        console.log('Transaction simulation completed');

        // Step 3: Get gas limit
        const gasLimit = await getGasLimit(
            swapData.tx.from,
            swapData.tx.to,
            swapData.tx.value || '0',
            swapData.tx.data
        );

        return {
            success: true,
            swapData,
            simulationResult,
            gasLimit,
            estimatedGasUsed: simulationResult.gasUsed,
        };
    } catch (error) {
        console.error('Simulation failed:', error.message);
        return { success: false, error: error.message };
    }
}
async function validateConfig() {
  console.log('Validating configuration...');
  
  // 检查 API 凭证
  const requiredEnvVars = [
      'OKX_API_KEY',
      'OKX_SECRET_KEY', 
      'OKX_API_PASSPHRASE',
      'OKX_PROJECT_ID',
      'EVM_WALLET_ADDRESS',
      'EVM_PRIVATE_KEY'
  ];
  
  const missing = requiredEnvVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  
  // 检查 RPC 连接
  try {
      const blockNumber = await web3.eth.getBlockNumber();
      console.log(`✅ RPC connected. Current block: ${blockNumber}`);
  } catch (error) {
      console.error('❌ RPC connection failed:', error.message);
      throw new Error('Cannot connect to RPC node');
  }
  
  // 检查钱包余额
  const balance = await web3.eth.getBalance(WALLET_ADDRESS);
  console.log(`✅ Wallet balance: ${web3.utils.fromWei(balance, 'ether')} ETH`);
  
  if (balance === '0') {
      console.warn('⚠️  Warning: Wallet has 0 balance!');
  }
}

async function main() {
    try {
      
        console.log('EVM Swap Tools with Onchain Gateway API');
        console.log('=====================================');

        await validateConfig();
        // Validate environment variables
        if (!WALLET_ADDRESS || !PRIVATE_KEY) {
            throw new Error('Missing wallet address or private key in environment variables');
        }

        console.log(`Wallet Address: ${WALLET_ADDRESS}`);
        console.log(`Chain ID: ${chainIndex}`);
        console.log(`RPC URL: ${process.env.EVM_RPC_URL || 'https://mainnet.base.org'}`);

        // Parse command line arguments
        const args = process.argv.slice(2);
        const mode = args[0] || 'simulate'; // Default to simulate mode
        
        // Example parameters
        const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH on ETH
        const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7'; // USDD on ETH
        const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC on ETH
        // const toToken = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base
        // const fromToken = ETH_ADDRESS;
        // const toToken = USDC_ADDRESS; // USDC on Base
        // const amount = '100000000000000'; // 0.0001 ETH in wei
        const fromToken = USDC_ADDRESS; // USDC on Base
        const toToken = USDT_ADDRESS; 
        const amount = '1000000'; // 1 usdc in wei
        const slippagePercent = '1'; // 0.5%

        console.log('\nConfiguration:');
        console.log(`   From: ${fromToken} (USDC)`);
        console.log(`   To: ${toToken} (USDT)`);
        console.log(`   Amount: ${web3.utils.fromWei(amount, 'ether')} ETH`);
        console.log(`   SlippagePercent: ${slippagePercent}%`);
        console.log(`   Mode: ${mode}`);


        let result;
        
        switch (mode.toLowerCase()) {
            case 'simulate':
            case 'sim':
                result = await simulateOnly(fromToken, toToken, amount, slippagePercent);
                break;
            case 'execute':
            case 'exec':
                result = await executeSwapWithSimulation(fromToken, toToken, amount, slippagePercent);
                break;
            default:
                console.log('\nAvailable modes:');
                console.log('   simulate/sim  - Only simulate the transaction');
                console.log('   execute/exec  - Execute the full swap');
                console.log('\nExample: npm run evm-swap simulate');
                return;
        }
        
        if (result.success) {
            console.log('\nOperation completed successfully!');
            if (mode === 'simulate' || mode === 'sim') {
                console.log(`Gas Limit: ${result.gasLimit}`);
            } else {
                console.log(`Transaction Hash: ${result.txHash}`);
            }
        } else {
            console.log('\nOperation failed!');
            console.log(`Error: ${result.error}`);
        }
    } catch (error) {
        console.error('Main execution failed:', error.message);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    setTimeout(async() => {
        const blockNumber = await web3.eth.getBlockNumber()
        const chainId = await web3.eth.getChainId()
        console.log(`${blockNumber} - ${chainId}`)
        await main();
    }, 0)
}

module.exports = {
    executeSwap,
    executeSwapWithSimulation,
    simulateOnly,
    getSwapData,
    simulateTransaction,
    getGasLimit,
    broadcastTransaction,
    trackTransaction
};

/**
/home/jsw/.nvm/versions/node/v22.21.1/bin/node ./okx-swap-claude.js execute
[dotenv@17.2.3] injecting env (0) from .env -- tip: 📡 add observability to secrets: https://dotenvx.com/ops
24682328 - 1
EVM Swap Tools with Onchain Gateway API
=====================================
Validating configuration...
✅ RPC connected. Current block: 24682328
✅ Wallet balance: 1.0014391344007151 ETH
Wallet Address: 0x34aabb238177ef195ed90fea056edd6648732014
Chain ID: 1
RPC URL: https://ethereum-rpc.publicnode.com

Configuration:
   From: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (USDC)
   To: 0xdac17f958d2ee523a2206206994597c13d831ec7 (USDT)
   Amount: 0.000000000001 ETH
   SlippagePercent: 1%
   Mode: execute
Starting swap execution with simulation...
📊 当前授权0x40aA958dd87FC8305b97f2BA922CDdCa374bcD7f额度: 6000000 (需要: 1000000)
📊 当前授权0x5E1f62Dac767b0491e3CE72469C217365D5B48cC额度: 0 (需要: 1000000)
Starting swap execution...
Getting swap data from OKX API...
Swap API Request Parameters:
{
  "chainIndex": "1",
  "fromTokenAddress": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "toTokenAddress": "0xdac17f958d2ee523a2206206994597c13d831ec7",
  "amount": "1000000",
  "slippagePercent": "1",
  "userWalletAddress": "0x34aabb238177ef195ed90fea056edd6648732014"
}
2026-03-18T05:38:56.418Z
2026-03-18T05:38:56Z
Swap API Response:
{
  "code": "0",
  "data": [
    {
      "routerResult": {
        "chainIndex": "1",
        "contextSlot": 24682324,
        "dexRouterList": [
          {
            "dexProtocol": {
              "dexName": "DODO V2",
              "percent": "100"
            },
            "fromToken": {
              "decimal": "6",
              "isHoneyPot": false,
              "taxRate": "0",
              "tokenContractAddress": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
              "tokenSymbol": "USDC",
              "tokenUnitPrice": "0.99996"
            },
            "fromTokenIndex": "0",
            "toToken": {
              "decimal": "6",
              "isHoneyPot": false,
              "taxRate": "0",
              "tokenContractAddress": "0xdac17f958d2ee523a2206206994597c13d831ec7",
              "tokenSymbol": "USDT",
              "tokenUnitPrice": "1.00031"
            },
            "toTokenIndex": "1"
          }
        ],
        "estimateGasFee": "273000",
        "fromToken": {
          "decimal": "6",
          "isHoneyPot": false,
          "taxRate": "0",
          "tokenContractAddress": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          "tokenSymbol": "USDC",
          "tokenUnitPrice": "0.99996"
        },
        "fromTokenAmount": "1000000",
        "priceImpactPercent": "0.01",
        "router": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48--0xdac17f958d2ee523a2206206994597c13d831ec7",
        "swapMode": "exactIn",
        "toToken": {
          "decimal": "6",
          "isHoneyPot": false,
          "taxRate": "0",
          "tokenContractAddress": "0xdac17f958d2ee523a2206206994597c13d831ec7",
          "tokenSymbol": "USDT",
          "tokenUnitPrice": "1.00031"
        },
        "toTokenAmount": "999701",
        "tradeFee": "0.03767526578984532"
      },
      "tx": {
        "data": "0xf2c426960000000000000000000000000000000000000000000000000000000000035418000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000f1a070000000000000000000000000000000000000000000000000000000069ba488000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000160000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000100000000000000000000000056bd269db96a089295d742351ba459fb0c279fe2000000000000000000000000000000000000000000000000000000000000000100000000000000000000000004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000180000000000000000001271004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000077777777111180000000000000000000000000000000000000000000000f4115777777771111000000000064fa00a9ed787f3793db668bff3e6e6e7db0f92a1b",
        "from": "0x34aabb238177ef195ed90fea056edd6648732014",
        "gas": "273000",
        "gasPrice": "103408823",
        "maxPriorityFeePerGas": "47994485",
        "maxSpendAmount": "",
        "minReceiveAmount": "989703",
        "signatureData": [
          ""
        ],
        "slippagePercent": "1",
        "to": "0x5E1f62Dac767b0491e3CE72469C217365D5B48cC",
        "value": "0"
      }
    }
  ],
  "msg": ""
}
Swap data obtained
✅ 授权额度足够
Nonce: 51
Transaction object:
{
  "from": "0x34aabb238177ef195ed90fea056edd6648732014",
  "to": "0x5E1f62Dac767b0491e3CE72469C217365D5B48cC",
  "data": "0xf2c426960000000000000000000000000000000000000000000000000000000000035418000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000f1a070000000000000000000000000000000000000000000000000000000069ba488000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000160000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000100000000000000000000000056bd269db96a089295d742351ba459fb0c279fe2000000000000000000000000000000000000000000000000000000000000000100000000000000000000000004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000180000000000000000001271004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000077777777111180000000000000000000000000000000000000000000000f4115777777771111000000000064fa00a9ed787f3793db668bff3e6e6e7db0f92a1b",
  "value": "0",
  "gas": "273000",
  "maxFeePerGas": "103408823",
  "maxPriorityFeePerGas": "47994485",
  "nonce": 51,
  "chainId": 1,
  "type": 2
}
Signing transaction...
RPC supports EIP-1559
Base fee: 38793130n
Transaction params for signing: {
  "nonce": "0x33",
  "gasLimit": "0x42a68",
  "to": "0x5E1f62Dac767b0491e3CE72469C217365D5B48cC",
  "value": "0x0",
  "data": "0xf2c426960000000000000000000000000000000000000000000000000000000000035418000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000f1a070000000000000000000000000000000000000000000000000000000069ba488000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000160000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000000100000000000000000000000056bd269db96a089295d742351ba459fb0c279fe2000000000000000000000000000000000000000000000000000000000000000100000000000000000000000004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000180000000000000000001271004571c32a4e1c5f39bc3a238cb95b215058c432c000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000077777777111180000000000000000000000000000000000000000000000f4115777777771111000000000064fa00a9ed787f3793db668bff3e6e6e7db0f92a1b",
  "chainId": 1,
  "maxFeePerGas": "0x629e4b7",
  "maxPriorityFeePerGas": "0x2dc5675"
}
Transaction signed
📡 通过RPC广播交易...
✅ RPC广播成功: {blockHash: '0xe4e39470269f46cfcebacb53acd3f6442cac9a628a4cad9439fb322f08c2517f', blockNumber: 24682340n, cumulativeGasUsed: 7374021n, effectiveGasPrice: 89363425n, from: '0x34aabb238177ef195ed90fea056edd6648732014', …}
txHash = [object Object]
Swap execution completed successfully!
Transaction Hash: [object Object]

Operation completed successfully!
Transaction Hash: [object Object]

 */